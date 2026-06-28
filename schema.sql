-- ═══════════════════════════════════════════════════════════════════════════
--  CHRONIQUES OUBLIÉES — Supabase Schema Phase 3
--  À exécuter dans le SQL Editor de Supabase : https://supabase.com/dashboard
-- ═══════════════════════════════════════════════════════════════════════════

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
--  TABLE : rooms  (salles de jeu)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.rooms (
  id            uuid primary key default uuid_generate_v4(),
  code          text unique not null,           -- ex. "HKR-4829"
  name          text not null default 'Partie', -- nom de la campagne
  gm_id         uuid not null,                  -- player_id du MJ
  gm_name       text not null default 'Maître du Jeu',
  max_players   int  not null default 4,
  is_open       bool not null default true,
  current_scene_id uuid,                        -- scène active (FK optionnelle)
  campaign_name text,
  session_number int not null default 1,
  fog_enabled   bool not null default false,
  fog_opacity   float not null default 0.85,
  fog_data      jsonb not null default '{}',    -- { "col,row": true }
  combat_active bool not null default false,
  current_turn  int not null default 0,
  round_number  int not null default 0,
  initiative_order jsonb not null default '[]',
  grid_visible  bool not null default false,
  grid_cell_size int not null default 60,
  grid_color    text not null default '#c9a84c',
  grid_opacity  float not null default 0.25,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
--  TABLE : players  (joueurs connectés à une salle)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.players (
  id              uuid primary key default uuid_generate_v4(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  name            text not null default 'Aventurier',
  role            text not null default 'joueur' check (role in ('mj', 'joueur')),
  color           text not null default '#c9a84c',
  is_online       bool not null default true,
  controlled_token_id uuid,                     -- FK sur tokens (nullable)
  character_data  jsonb,                        -- { name, class, race, level, hp, hpMax, notes }
  last_seen       timestamptz default now(),
  created_at      timestamptz default now()
);

create index if not exists idx_players_room_id on public.players(room_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  TABLE : scenes  (cartes / scènes de la campagne)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.scenes (
  id          uuid primary key default uuid_generate_v4(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  name        text not null default 'Scène',
  description text,
  icon        text default '🗺',
  map_url     text,                             -- URL Supabase Storage ou data URL
  map_color   text default '#1a1228',
  sort_order  int not null default 0,
  fog_data    jsonb not null default '{}',      -- fog par scène
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_scenes_room_id on public.scenes(room_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  TABLE : tokens  (pions sur la carte)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.tokens (
  id              uuid primary key default uuid_generate_v4(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  scene_id        uuid references public.scenes(id) on delete set null,
  name            text not null default 'Pion',
  type            text not null default 'pnj' check (type in ('joueur', 'ennemi', 'pnj')),
  hp              int not null default 30,
  hp_max          int not null default 30,
  size            int not null default 1,
  color           text not null default '#c9a84c',
  icon            text,
  img_url         text,
  x               float not null default 60,
  y               float not null default 60,
  owner_player_id uuid references public.players(id) on delete set null,
  is_visible      bool not null default true,
  conditions      jsonb not null default '[]',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_tokens_room_id   on public.tokens(room_id);
create index if not exists idx_tokens_scene_id  on public.tokens(scene_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  TABLE : chat_messages  (messages du chat)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id          uuid primary key default uuid_generate_v4(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  player_id   uuid,                            -- peut être null (système)
  author_name text not null default 'Système',
  role        text not null default 'joueur',
  text        text not null,
  msg_type    text not null default 'chat' check (msg_type in ('chat', 'dice', 'system', 'emote')),
  dice_data   jsonb,                           -- { sides, result } pour les lancers
  created_at  timestamptz default now()
);

create index if not exists idx_chat_room_id on public.chat_messages(room_id);
create index if not exists idx_chat_created on public.chat_messages(created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
--  FONCTIONS & TRIGGERS — updated_at automatique
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_rooms_updated_at   before update on public.rooms   for each row execute function public.set_updated_at();
create trigger trg_scenes_updated_at  before update on public.scenes  for each row execute function public.set_updated_at();
create trigger trg_tokens_updated_at  before update on public.tokens  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
--  FONCTION : generate_room_code — génère un code unique
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.generate_room_code()
returns text language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  nums  text := '0123456789';
  code  text;
  tries int := 0;
begin
  loop
    code := '';
    code := code || substr(chars, (floor(random()*length(chars))::int)+1, 1);
    code := code || substr(chars, (floor(random()*length(chars))::int)+1, 1);
    code := code || substr(chars, (floor(random()*length(chars))::int)+1, 1);
    code := code || '-';
    code := code || substr(nums, (floor(random()*10)::int)+1, 1);
    code := code || substr(nums, (floor(random()*10)::int)+1, 1);
    code := code || substr(nums, (floor(random()*10)::int)+1, 1);
    code := code || substr(nums, (floor(random()*10)::int)+1, 1);
    exit when not exists (select 1 from public.rooms where rooms.code = code);
    tries := tries + 1;
    if tries > 50 then raise exception 'Code generation failed'; end if;
  end loop;
  return code;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
--  RPC : create_room — crée salle + joueur MJ en une transaction
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_room(
  p_name          text,
  p_gm_name       text,
  p_max_players   int,
  p_campaign_name text default null,
  p_gm_id         uuid default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_code      text;
  v_room_id   uuid;
  v_player_id uuid;
  v_gm_id     uuid;
begin
  v_code    := public.generate_room_code();
  v_gm_id   := coalesce(p_gm_id, uuid_generate_v4());
  v_room_id := uuid_generate_v4();

  insert into public.rooms (id, code, name, gm_id, gm_name, max_players, campaign_name)
  values (v_room_id, v_code, p_name, v_gm_id, p_gm_name, p_max_players, coalesce(p_campaign_name, p_name))
  returning id into v_room_id;

  insert into public.players (id, room_id, name, role, color)
  values (v_gm_id, v_room_id, p_gm_name, 'mj', '#c9a84c')
  returning id into v_player_id;

  return jsonb_build_object(
    'room_id',   v_room_id,
    'room_code', v_code,
    'player_id', v_player_id,
    'gm_id',     v_gm_id
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
--  RPC : join_room — rejoint une salle via code
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.join_room(
  p_code        text,
  p_player_name text,
  p_player_id   uuid default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_room        public.rooms;
  v_player_id   uuid;
  v_player      public.players;
  v_player_count int;
begin
  -- Trouver la salle
  select * into v_room from public.rooms where code = upper(trim(p_code)) and is_open = true;
  if not found then
    return jsonb_build_object('error', 'Salle introuvable ou code invalide.');
  end if;

  -- Vérifier capacité (hors MJ)
  select count(*) into v_player_count
  from public.players where room_id = v_room.id and role = 'joueur';
  if v_player_count >= v_room.max_players then
    return jsonb_build_object('error', 'Salle complète.');
  end if;

  v_player_id := coalesce(p_player_id, uuid_generate_v4());

  -- Upsert joueur
  insert into public.players (id, room_id, name, role, color, is_online)
  values (v_player_id, v_room.id, p_player_name, 'joueur', '#7c4dff', true)
  on conflict (id) do update set
    name      = excluded.name,
    is_online = true,
    last_seen = now();

  -- Snapshot complet
  return jsonb_build_object(
    'player_id', v_player_id,
    'room',      row_to_json(v_room),
    'players',   (select jsonb_agg(row_to_json(p)) from public.players p where p.room_id = v_room.id),
    'tokens',    (select jsonb_agg(row_to_json(t)) from public.tokens  t where t.room_id = v_room.id),
    'scenes',    (select jsonb_agg(row_to_json(s)) from public.scenes  s where s.room_id = v_room.id),
    'chat',      (select jsonb_agg(row_to_json(m) order by m.created_at asc)
                  from (select * from public.chat_messages where room_id = v_room.id
                        order by created_at desc limit 100) m)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
--  RPC : get_room_snapshot — snapshot complet d'une salle
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_room_snapshot(p_room_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found then
    return jsonb_build_object('error', 'Salle introuvable.');
  end if;

  return jsonb_build_object(
    'room',    row_to_json(v_room),
    'players', (select jsonb_agg(row_to_json(p)) from public.players p where p.room_id = p_room_id),
    'tokens',  (select jsonb_agg(row_to_json(t)) from public.tokens  t where t.room_id = p_room_id),
    'scenes',  (select jsonb_agg(row_to_json(s)) from public.scenes  s where s.room_id = p_room_id),
    'chat',    (select jsonb_agg(row_to_json(m) order by m.created_at asc)
                from (select * from public.chat_messages where room_id = p_room_id
                      order by created_at desc limit 100) m)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY — Politique permissive basée sur room_id
--  (Accès public via anon key — sécurité = code de salle)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.rooms          enable row level security;
alter table public.players        enable row level security;
alter table public.scenes         enable row level security;
alter table public.tokens         enable row level security;
alter table public.chat_messages  enable row level security;

-- Politique : accès total via la clé anonyme (le code de salle = la sécurité)
create policy "anon_rooms_all"         on public.rooms         for all to anon using (true) with check (true);
create policy "anon_players_all"       on public.players       for all to anon using (true) with check (true);
create policy "anon_scenes_all"        on public.scenes        for all to anon using (true) with check (true);
create policy "anon_tokens_all"        on public.tokens        for all to anon using (true) with check (true);
create policy "anon_chat_all"          on public.chat_messages for all to anon using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
--  REALTIME — Activer les publications temps réel sur toutes les tables
-- ─────────────────────────────────────────────────────────────────────────────
-- À exécuter dans le dashboard Supabase > Database > Replication
-- Ou via SQL :
begin;
  -- Supprimer si déjà présent pour éviter les erreurs
  drop publication if exists supabase_realtime;
  create publication supabase_realtime for table
    public.rooms,
    public.players,
    public.scenes,
    public.tokens,
    public.chat_messages;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
--  INDEX SUPPLÉMENTAIRES pour les performances
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_rooms_code        on public.rooms(code);
create index if not exists idx_rooms_gm_id       on public.rooms(gm_id);
create index if not exists idx_players_room_online on public.players(room_id, is_online);
create index if not exists idx_tokens_room_scene on public.tokens(room_id, scene_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  CLEANUP AUTO — Supprimer les salles inactives depuis 24h (optionnel)
-- ─────────────────────────────────────────────────────────────────────────────
-- Créer un pg_cron job dans le dashboard Supabase > Extensions > pg_cron
-- SELECT cron.schedule('cleanup-old-rooms', '0 3 * * *', $$
--   DELETE FROM public.rooms WHERE updated_at < now() - interval '24 hours';
-- $$);
