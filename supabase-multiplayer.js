/* ═══════════════════════════════════════════════════════════════════════════
   CHRONIQUES OUBLIÉES — supabase-multiplayer.js
   Module Phase 3 Supabase : remplace WS, RoomManager, Session, NetworkAdapter

   Dépendance : Supabase JS v2 (chargé via CDN dans index.html)
   Usage     : inclure APRÈS style.css, AVANT script.js (ou à la place du bas)
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG SUPABASE
// ═══════════════════════════════════════════════════════════════════════════
const SUPABASE_URL    = 'https://vfekyuidsjnblcklamwv.supabase.co';
const SUPABASE_ANON   = 'sb_publishable_bQHw20gutJL3O6eey-8Y-Q_C1P3eBAv';

// ═══════════════════════════════════════════════════════════════════════════
//  INITIALISATION CLIENT
// ═══════════════════════════════════════════════════════════════════════════
const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: { params: { eventsPerSecond: 20 } }
});

// ═══════════════════════════════════════════════════════════════════════════
//  UTILITAIRES INTERNES
// ═══════════════════════════════════════════════════════════════════════════
const _uuid = () => crypto.randomUUID
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

const _esc = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Référence aux fonctions du script principal (disponibles après initApp())
const _$ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════════════════
//  SB_STATE — État Supabase local
// ═══════════════════════════════════════════════════════════════════════════
const SbState = {
  roomId:     null,   // UUID de la salle
  roomCode:   null,   // ex. "HKR-4829"
  playerId:   null,   // UUID du joueur local
  playerRole: 'mj',  // 'mj' | 'joueur'
  playerName: null,
  isGM:       false,
  channel:    null,   // Canal Supabase Realtime
  subscriptions: [],  // Channels postgres_changes
};

// ═══════════════════════════════════════════════════════════════════════════
//  PERSISTENCE LOCALE — Reconnexion après refresh
// ═══════════════════════════════════════════════════════════════════════════
const _PERSIST_KEY = 'co-sb-session';

function _saveSession() {
  try {
    localStorage.setItem(_PERSIST_KEY, JSON.stringify({
      roomId:     SbState.roomId,
      roomCode:   SbState.roomCode,
      playerId:   SbState.playerId,
      playerRole: SbState.playerRole,
      playerName: SbState.playerName,
    }));
  } catch(_) {}
}

function _loadSession() {
  try {
    const raw = localStorage.getItem(_PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(_) { return null; }
}

function _clearSession() {
  try { localStorage.removeItem(_PERSIST_KEY); } catch(_) {}
}

// ═══════════════════════════════════════════════════════════════════════════
//  CREATE ROOM — MJ crée une salle
// ═══════════════════════════════════════════════════════════════════════════
async function sbCreateRoom(name, gmName, maxPlayers) {
  try {
    _showStatus('connecting');
    const { data, error } = await _sb.rpc('create_room', {
      p_name:          name || 'Ma Campagne',
      p_gm_name:       gmName || 'Maître du Jeu',
      p_max_players:   parseInt(maxPlayers, 10) || 4,
      p_campaign_name: name || 'Ma Campagne',
    });

    if (error) throw error;

    SbState.roomId     = data.room_id;
    SbState.roomCode   = data.room_code;
    SbState.playerId   = data.player_id;
    SbState.playerRole = 'mj';
    SbState.playerName = gmName || 'Maître du Jeu';
    SbState.isGM       = true;

    // Synchroniser avec l'état global du VTT
    if (window.State) {
      State.playerId   = SbState.playerId;
      State.playerRole = 'mj';
    }

    _saveSession();
    await _subscribeRoom(SbState.roomId);
    _applyGMMode();
    _renderRoomPanel();
    _updateSessionIndicator(true);
    _showStatus('online');

    if (window.showToast)  showToast(`Salle créée : ${SbState.roomCode}`, 'success', '🌐');
    if (window.updateLog)  updateLog(`Salle ouverte — Code : ${SbState.roomCode}`);

    return { ok: true, roomCode: SbState.roomCode };
  } catch (err) {
    console.error('[Supabase] createRoom error:', err);
    _showStatus('offline');
    if (window.showToast) showToast('Erreur création salle : ' + (err.message || err), 'warning', '⚠');
    return { ok: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  JOIN ROOM — Joueur rejoint une salle
// ═══════════════════════════════════════════════════════════════════════════
async function sbJoinRoom(code, playerName, existingPlayerId = null) {
  try {
    _showStatus('connecting');
    const errEl = _$('room-join-error');
    if (errEl) errEl.style.display = 'none';

    const { data, error } = await _sb.rpc('join_room', {
      p_code:        code.toUpperCase().trim(),
      p_player_name: playerName,
      p_player_id:   existingPlayerId || null,
    });

    if (error) throw error;
    if (data.error) {
      if (errEl) { errEl.textContent = '⚠ ' + data.error; errEl.style.display = 'block'; }
      _showStatus('offline');
      return { ok: false, error: data.error };
    }

    const room = data.room || {};
    SbState.roomId     = room.id;
    SbState.roomCode   = room.code || code.toUpperCase();
    SbState.playerId   = data.player_id;
    SbState.playerRole = 'joueur';
    SbState.playerName = playerName;
    SbState.isGM       = false;

    if (window.State) {
      State.playerId   = SbState.playerId;
      State.playerRole = 'joueur';
    }

    _saveSession();

    // Appliquer le snapshot complet
    await _applySnapshot(data);

    await _subscribeRoom(SbState.roomId);
    _applyPlayerMode();
    _renderRoomPanel();
    _updateSessionIndicator(true);
    _showStatus('online');

    if (window.showToast) showToast('Vous avez rejoint la partie !', 'success', '🔗');
    if (window.updateLog) updateLog('Connecté : ' + (room.name || code));

    return { ok: true };
  } catch (err) {
    console.error('[Supabase] joinRoom error:', err);
    _showStatus('offline');
    if (window.showToast) showToast('Erreur : ' + (err.message || err), 'warning', '⚠');
    return { ok: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLOSE ROOM — MJ ferme la salle
// ═══════════════════════════════════════════════════════════════════════════
async function sbCloseRoom() {
  if (!SbState.roomId || !SbState.isGM) return;
  try {
    // Marquer salle fermée
    await _sb.from('rooms').update({ is_open: false }).eq('id', SbState.roomId);
    // Broadcaster via canal
    if (SbState.channel) {
      await SbState.channel.send({
        type: 'broadcast', event: 'ROOM_CLOSED',
        payload: { message: 'Le MJ a fermé la salle.' }
      });
    }
    await _unsubscribeRoom();
    _clearSession();
    _applyOfflineMode();
    if (window.showToast) showToast('Salle fermée', 'info', '🌐');
  } catch (err) {
    console.error('[Supabase] closeRoom error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RECONNECT — Tentative de reconnexion après refresh
// ═══════════════════════════════════════════════════════════════════════════
async function sbReconnect() {
  const saved = _loadSession();
  if (!saved || !saved.roomId) return false;

  try {
    // Vérifier que la salle existe toujours
    const { data: room } = await _sb.from('rooms')
      .select('id, code, is_open, name')
      .eq('id', saved.roomId)
      .single();

    if (!room || !room.is_open) {
      _clearSession();
      return false;
    }

    SbState.roomId     = saved.roomId;
    SbState.roomCode   = saved.roomCode;
    SbState.playerId   = saved.playerId;
    SbState.playerRole = saved.playerRole;
    SbState.playerName = saved.playerName;
    SbState.isGM       = saved.playerRole === 'mj';

    if (window.State) {
      State.playerId   = SbState.playerId;
      State.playerRole = SbState.playerRole;
    }

    // Marquer joueur online
    await _sb.from('players')
      .update({ is_online: true, last_seen: new Date().toISOString() })
      .eq('id', SbState.playerId);

    // Récupérer snapshot complet
    const { data: snap } = await _sb.rpc('get_room_snapshot', { p_room_id: SbState.roomId });
    if (snap) await _applySnapshot(snap);

    await _subscribeRoom(SbState.roomId);

    if (SbState.isGM) _applyGMMode();
    else              _applyPlayerMode();

    _renderRoomPanel();
    _updateSessionIndicator(true);
    _showStatus('online');
    if (window.showToast) showToast('Reconnecté à la partie', 'success', '🔗');
    return true;
  } catch(err) {
    console.error('[Supabase] reconnect error:', err);
    _clearSession();
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUPABASE REALTIME — Abonnement à la salle
// ═══════════════════════════════════════════════════════════════════════════
async function _subscribeRoom(roomId) {
  await _unsubscribeRoom();

  // Canal broadcast (messages directs entre clients)
  SbState.channel = _sb.channel(`room:${roomId}`, {
    config: { broadcast: { self: false } }
  });

  SbState.channel
    // ── Événements broadcast (temps réel peer-to-peer) ──────────────────
    .on('broadcast', { event: 'TOKEN_MOVED' },    (e) => _onTokenMoved(e.payload))
    .on('broadcast', { event: 'SCENE_CHANGED' },  (e) => _onSceneChanged(e.payload))
    .on('broadcast', { event: 'FOG_UPDATED' },    (e) => _onFogUpdated(e.payload))
    .on('broadcast', { event: 'COMBAT_UPDATED' }, (e) => _onCombatUpdated(e.payload))
    .on('broadcast', { event: 'MARKER_PLACED' },  (e) => _onMarkerPlaced(e.payload))
    .on('broadcast', { event: 'ROOM_CLOSED' },    (e) => _onRoomClosed(e.payload))
    .on('broadcast', { event: 'PLAYER_HEARTBEAT' },(e) => _onPlayerHeartbeat(e.payload))

    // ── Postgres Changes (persistance) ───────────────────────────────────
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'players',
      filter: `room_id=eq.${roomId}`
    }, (e) => _onPlayerChange(e))

    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'tokens',
      filter: `room_id=eq.${roomId}`
    }, (e) => _onTokenChange(e))

    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'chat_messages',
      filter: `room_id=eq.${roomId}`
    }, (e) => _onChatMessage(e.new))

    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'rooms',
      filter: `id=eq.${roomId}`
    }, (e) => _onRoomUpdate(e.new))

    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'scenes',
      filter: `room_id=eq.${roomId}`
    }, (e) => _onSceneChange(e))

    .subscribe((status) => {
      console.log('[Supabase Realtime]', status);
      if (status === 'SUBSCRIBED') {
        _showStatus('online');
        // Envoyer heartbeat immédiat
        _sendHeartbeat();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        _showStatus('offline');
      }
    });

  // Heartbeat toutes les 20s pour maintenir is_online = true
  SbState._heartbeatTimer = setInterval(_sendHeartbeat, 20000);
}

async function _unsubscribeRoom() {
  clearInterval(SbState._heartbeatTimer);
  if (SbState.channel) {
    await _sb.removeChannel(SbState.channel);
    SbState.channel = null;
  }
}

function _sendHeartbeat() {
  if (!SbState.channel || !SbState.playerId) return;
  SbState.channel.send({
    type: 'broadcast', event: 'PLAYER_HEARTBEAT',
    payload: { playerId: SbState.playerId, ts: Date.now() }
  });
  // Aussi mettre à jour la DB
  if (SbState.playerId) {
    _sb.from('players')
      .update({ is_online: true, last_seen: new Date().toISOString() })
      .eq('id', SbState.playerId)
      .then(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  BROADCAST HELPERS — Envoyer des événements aux autres clients
// ═══════════════════════════════════════════════════════════════════════════
function sbBroadcast(event, payload) {
  if (!SbState.channel) return;
  SbState.channel.send({ type: 'broadcast', event, payload: { ...payload, senderId: SbState.playerId } });
}

// ═══════════════════════════════════════════════════════════════════════════
//  ACTIONS JOUEUR → SUPABASE
// ═══════════════════════════════════════════════════════════════════════════

// -- Token : déplacer (broadcast immédiat + update DB)
async function sbMoveToken(tokenId, x, y) {
  // Broadcast immédiat pour fluidité
  sbBroadcast('TOKEN_MOVED', { tokenId, x, y });
  // Persistance DB
  await _sb.from('tokens').update({ x, y, updated_at: new Date().toISOString() }).eq('id', tokenId);
}

// -- Token : créer ou mettre à jour
async function sbUpsertToken(token) {
  if (!SbState.roomId) return;
  const row = {
    id:              token.id,
    room_id:         SbState.roomId,
    scene_id:        token.sceneId || null,
    name:            token.name,
    type:            token.type,
    hp:              token.hp,
    hp_max:          token.hpMax,
    size:            token.size,
    color:           token.color,
    icon:            token.icon || null,
    img_url:         token.imgUrl || null,
    x:               token.x,
    y:               token.y,
    owner_player_id: token.ownerPlayerId || null,
    is_visible:      token.isVisible !== false,
    updated_at:      new Date().toISOString(),
  };
  const { error } = await _sb.from('tokens').upsert(row, { onConflict: 'id' });
  if (error) console.error('[sbUpsertToken]', error);
}

// -- Token : supprimer
async function sbDeleteToken(tokenId) {
  await _sb.from('tokens').delete().eq('id', tokenId);
}

// -- Token : mettre à jour PV
async function sbUpdateTokenHp(tokenId, hp) {
  await _sb.from('tokens').update({ hp, updated_at: new Date().toISOString() }).eq('id', tokenId);
}

// -- Token : assigner propriétaire
async function sbAssignTokenOwner(tokenId, ownerPlayerId) {
  await _sb.from('tokens').update({ owner_player_id: ownerPlayerId }).eq('id', tokenId);
  await _sb.from('players').update({ controlled_token_id: tokenId }).eq('id', ownerPlayerId);
}

// -- Scène : changer la scène active
async function sbChangeScene(sceneId) {
  if (!SbState.isGM || !SbState.roomId) return;
  await _sb.from('rooms').update({ current_scene_id: sceneId }).eq('id', SbState.roomId);
  sbBroadcast('SCENE_CHANGED', { sceneId });
}

// -- Scène : créer ou mettre à jour
async function sbUpsertScene(scene) {
  if (!SbState.roomId) return;
  const row = {
    id:          scene.id,
    room_id:     SbState.roomId,
    name:        scene.name,
    description: scene.description || null,
    icon:        scene.icon || '🗺',
    map_url:     scene.mapUrl && !scene.mapUrl.startsWith('data:') ? scene.mapUrl : null,
    map_color:   scene.mapColor || '#1a1228',
    sort_order:  scene.sortOrder || 0,
    fog_data:    scene.fogData || {},
    updated_at:  new Date().toISOString(),
  };
  const { error } = await _sb.from('scenes').upsert(row, { onConflict: 'id' });
  if (error) console.error('[sbUpsertScene]', error);
}

// -- Brouillard : sauvegarder
async function sbUpdateFog(fogData, fogEnabled) {
  if (!SbState.isGM || !SbState.roomId) return;
  await _sb.from('rooms').update({ fog_data: fogData, fog_enabled: fogEnabled }).eq('id', SbState.roomId);
  sbBroadcast('FOG_UPDATED', { fogData, fogEnabled });
}

// -- Combat : mettre à jour
async function sbUpdateCombat(combatData) {
  if (!SbState.isGM || !SbState.roomId) return;
  const update = {};
  if (combatData.combatActive    !== undefined) update.combat_active     = combatData.combatActive;
  if (combatData.initiativeOrder !== undefined) update.initiative_order  = combatData.initiativeOrder;
  if (combatData.currentTurn     !== undefined) update.current_turn      = combatData.currentTurn;
  if (combatData.round           !== undefined) update.round_number      = combatData.round;
  await _sb.from('rooms').update(update).eq('id', SbState.roomId);
  sbBroadcast('COMBAT_UPDATED', combatData);
}

// -- Chat : envoyer un message
async function sbSendChat(text, msgType = 'chat', diceData = null) {
  if (!SbState.roomId || !SbState.playerId) return;
  const row = {
    room_id:     SbState.roomId,
    player_id:   SbState.playerId,
    author_name: SbState.playerName || 'Joueur',
    role:        SbState.playerRole,
    text:        String(text).slice(0, 500),
    msg_type:    msgType,
    dice_data:   diceData || null,
  };
  const { error } = await _sb.from('chat_messages').insert(row);
  if (error) console.error('[sbSendChat]', error);
}

// -- Joueur : mettre à jour caractère
async function sbUpdatePlayer(playerData) {
  if (!SbState.playerId) return;
  const update = {};
  if (playerData.character !== undefined) update.character_data = playerData.character;
  if (playerData.name      !== undefined) update.name           = playerData.name;
  if (playerData.color     !== undefined) update.color          = playerData.color;
  const { error } = await _sb.from('players').update(update).eq('id', SbState.playerId);
  if (error) console.error('[sbUpdatePlayer]', error);
}

// -- Marqueur : placer (broadcast seulement, pas persisté)
function sbPlaceMarker(marker) {
  sbBroadcast('MARKER_PLACED', { marker });
}

// ═══════════════════════════════════════════════════════════════════════════
//  HANDLERS — Événements reçus des autres clients
// ═══════════════════════════════════════════════════════════════════════════

function _isSelf(payload) {
  return payload.senderId === SbState.playerId;
}

// -- Token bougé (broadcast temps réel)
function _onTokenMoved(payload) {
  if (_isSelf(payload)) return;
  const { tokenId, x, y } = payload;
  const t = window.State?.tokens?.find(t => t.id === tokenId);
  if (!t) return;
  t.x = x; t.y = y;
  if (window.State) {
    const sizePx = State.gridCellSize * t.size;
    const el = document.getElementById('token-el-' + tokenId);
    if (el) { el.style.left = (x - sizePx/2) + 'px'; el.style.top = (y - sizePx/2) + 'px'; }
  }
}

// -- Token changé (postgres_changes)
function _onTokenChange(event) {
  const { eventType, new: newRow, old: oldRow } = event;

  if (eventType === 'DELETE') {
    const id = oldRow.id;
    document.getElementById('token-el-' + id)?.remove();
    if (window.State) State.tokens = State.tokens.filter(t => t.id !== id);
    if (window.updateInfoDisplay) updateInfoDisplay();
    return;
  }

  const token = _dbTokenToLocal(newRow);
  const existing = window.State?.tokens?.find(t => t.id === token.id);

  if (existing) {
    const imgData = existing.imgData;
    Object.assign(existing, token);
    if (imgData) existing.imgData = imgData;
    document.getElementById('token-el-' + token.id)?.remove();
    if (window.renderToken) renderToken(existing);
  } else if (eventType === 'INSERT') {
    if (window.State) State.tokens.push(token);
    if (window.renderToken) renderToken(token);
    if (window.updateInfoDisplay) updateInfoDisplay();
  }
}

// -- Scène changée (broadcast)
function _onSceneChanged(payload) {
  if (_isSelf(payload)) return;
  const scene = window.State?.scenes?.find(s => s.id === payload.sceneId);
  if (scene && window.loadScene) {
    loadScene(scene);
    if (window.showToast) showToast(`Nouvelle scène : ${scene.name}`, 'info', '🗺');
  }
}

// -- Scène changée (postgres_changes)
function _onSceneChange(event) {
  const { eventType, new: newRow } = event;
  if (eventType === 'DELETE') {
    if (window.State) State.scenes = State.scenes.filter(s => s.id !== event.old.id);
    if (window.renderScenesList) renderScenesList();
    if (window.renderScenesModal) renderScenesModal();
    return;
  }
  const scene = _dbSceneToLocal(newRow);
  const existing = window.State?.scenes?.find(s => s.id === scene.id);
  if (existing) Object.assign(existing, scene);
  else if (eventType === 'INSERT' && window.State) State.scenes.push(scene);
  if (window.renderScenesList) renderScenesList();
  if (window.renderScenesModal) renderScenesModal();
}

// -- Fog mis à jour (broadcast)
function _onFogUpdated(payload) {
  if (_isSelf(payload)) return;
  if (window.State) {
    if (payload.fogData    !== undefined) State.fogData    = payload.fogData;
    if (payload.fogEnabled !== undefined) State.fogEnabled = payload.fogEnabled;
    if (window.applyFogVisibility) applyFogVisibility();
    if (window.redrawFogCanvas)    redrawFogCanvas();
  }
}

// -- Combat mis à jour (broadcast)
function _onCombatUpdated(payload) {
  if (_isSelf(payload)) return;
  if (window.State) {
    if (payload.combatActive    !== undefined) State.combatActive    = payload.combatActive;
    if (payload.initiativeOrder !== undefined) State.initiativeOrder = payload.initiativeOrder;
    if (payload.currentTurn     !== undefined) State.currentTurn     = payload.currentTurn;
    if (payload.round           !== undefined) State.round           = payload.round;
    if (window.renderInitiativeTrack) renderInitiativeTrack();
    const rnEl = document.getElementById('round-number');
    if (rnEl) rnEl.textContent = State.round || '—';
    const irEl = document.getElementById('info-round');
    if (irEl) irEl.textContent = State.round || '—';
  }
}

// -- Joueur mis à jour (postgres_changes)
function _onPlayerChange(event) {
  const { eventType, new: newRow } = event;
  if (eventType === 'DELETE') return;

  const player = _dbPlayerToLocal(newRow);

  // Mettre à jour RoomManager.room.players si disponible
  if (window.RoomManager?.room) {
    const idx = RoomManager.room.players.findIndex(p => p.id === player.id);
    if (idx >= 0) Object.assign(RoomManager.room.players[idx], player);
    else RoomManager.room.players.push(player);
  }

  // Notif si quelqu'un rejoint/part
  if (player.id !== SbState.playerId) {
    if (eventType === 'INSERT') {
      if (window.showToast) showToast(`${player.name} a rejoint la partie`, 'info', '👤');
    }
  }

  // Mettre à jour le token assigné si c'est notre joueur
  if (player.id === SbState.playerId && player.controlledTokenId) {
    _updatePlayerHUD();
  }

  _renderPlayersPanel();
}

// -- Nouveau message chat (postgres_changes)
function _onChatMessage(row) {
  // Ne pas afficher les messages qu'on a nous-mêmes envoyés (déjà affichés optimistiquement)
  // mais ici on laisse passer car postgres_changes inclut les nôtres aussi
  const msg = _dbChatToLocal(row);
  if (window.ChatUI) {
    ChatUI.appendMessage(msg);
  }
}

// -- Room mise à jour (postgres_changes)
function _onRoomUpdate(newRow) {
  if (!window.State) return;
  // Mettre à jour l'état combat/fog si changé par le MJ
  if (newRow.current_scene_id && newRow.current_scene_id !== State.currentSceneId) {
    const scene = State.scenes?.find(s => s.id === newRow.current_scene_id);
    if (scene && window.loadScene) loadScene(scene);
  }
}

// -- Marqueur placé (broadcast)
function _onMarkerPlaced(payload) {
  if (_isSelf(payload)) return;
  if (window.MarkersV2 && payload.marker) MarkersV2.renderRemote(payload.marker);
}

// -- Salle fermée (broadcast)
function _onRoomClosed(payload) {
  _applyOfflineMode();
  _clearSession();
  if (window.showToast) showToast('Le MJ a fermé la salle.', 'warning', '🌐');
  if (window.updateLog) updateLog('Salle fermée par le MJ');
}

// -- Heartbeat joueur (broadcast)
function _onPlayerHeartbeat(payload) {
  if (window.RoomManager?.room && payload.playerId) {
    const p = RoomManager.room.players?.find(p => p.id === payload.playerId);
    if (p) { p.online = true; p.lastSeen = payload.ts; }
    _renderPlayersPanel();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SNAPSHOT — Appliquer l'état initial
// ═══════════════════════════════════════════════════════════════════════════
async function _applySnapshot(data) {
  if (!data) return;

  const room = data.room || {};

  // Créer/mettre à jour RoomManager.room
  if (window.RoomManager) {
    const players = (data.players || []).map(_dbPlayerToLocal);
    RoomManager.room = {
      id:         room.id,
      code:       room.code || SbState.roomCode,
      name:       room.name || room.campaign_name || 'Partie',
      gmId:       room.gm_id,
      gmName:     room.gm_name,
      maxPlayers: room.max_players,
      players:    players,
      createdAt:  room.created_at,
    };
  }

  // Scènes
  if (data.scenes && window.State) {
    const scenes = (data.scenes || []).map(_dbSceneToLocal);
    State.scenes = scenes;
    if (window.renderScenesList) renderScenesList();
    if (window.renderScenesModal) renderScenesModal();
    if (window.updateInfoDisplay) updateInfoDisplay();
  }

  // Tokens
  if (data.tokens && window.State) {
    // Vider les tokens existants
    document.querySelectorAll('.vtt-token').forEach(el => el.remove());
    State.tokens = (data.tokens || []).map(_dbTokenToLocal);
    State.tokens.forEach(t => { if (window.renderToken) renderToken(t); });
    if (window.updateInfoDisplay) updateInfoDisplay();
  }

  // Room state (fog, combat, scène active)
  if (window.State) {
    if (room.fog_enabled    !== undefined) State.fogEnabled       = room.fog_enabled;
    if (room.fog_data)                     State.fogData          = room.fog_data;
    if (room.fog_opacity)                  State.fogOpacity       = room.fog_opacity;
    if (room.combat_active  !== undefined) State.combatActive     = room.combat_active;
    if (room.initiative_order)             State.initiativeOrder  = room.initiative_order;
    if (room.current_turn   !== undefined) State.currentTurn      = room.current_turn;
    if (room.round_number   !== undefined) State.round            = room.round_number;
    if (room.grid_visible   !== undefined) State.gridVisible      = room.grid_visible;
    if (room.grid_cell_size)               State.gridCellSize     = room.grid_cell_size;
    if (room.grid_color)                   State.gridColor        = room.grid_color;
    if (room.campaign_name)                State.campaignName     = room.campaign_name;
    if (room.session_number)               State.sessionNumber    = room.session_number;

    if (window.applyFogVisibility) applyFogVisibility();
    if (window.redrawFogCanvas)    redrawFogCanvas();
    if (window.renderInitiativeTrack) renderInitiativeTrack();

    // Charger la scène active
    if (room.current_scene_id && State.scenes?.length) {
      const scene = State.scenes.find(s => s.id === room.current_scene_id);
      if (scene && window.loadScene) setTimeout(() => loadScene(scene), 100);
    }
  }

  // Chat
  if (data.chat && window.ChatUI) {
    const msgs = (data.chat || []).reverse().map(_dbChatToLocal);
    msgs.forEach(m => {
      if (!window.Session?.chatMessages?.find(c => c.id === m.id)) {
        window.Session?.chatMessages?.push(m);
      }
    });
    ChatUI.renderAll?.();
  }

  // Mise à jour du nom campagne
  if (room.campaign_name && window.updateCampaignDisplay) updateCampaignDisplay();
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONVERTISSEURS DB → Local
// ═══════════════════════════════════════════════════════════════════════════
function _dbTokenToLocal(row) {
  return {
    id:              row.id,
    sceneId:         row.scene_id,
    name:            row.name,
    type:            row.type,
    hp:              row.hp,
    hpMax:           row.hp_max,
    size:            row.size || 1,
    color:           row.color || '#c9a84c',
    icon:            row.icon || '',
    imgUrl:          row.img_url || null,
    imgData:         null, // pas de data: URLs en DB
    x:               row.x,
    y:               row.y,
    ownerPlayerId:   row.owner_player_id || null,
    isVisible:       row.is_visible !== false,
    conditions:      row.conditions || [],
  };
}

function _dbPlayerToLocal(row) {
  return {
    id:                 row.id,
    name:               row.name,
    role:               row.role,
    color:              row.color || '#c9a84c',
    online:             row.is_online !== false,
    controlledTokenId:  row.controlled_token_id || null,
    character:          row.character_data || null,
    lastSeen:           row.last_seen,
  };
}

function _dbSceneToLocal(row) {
  return {
    id:          row.id,
    name:        row.name,
    description: row.description || '',
    icon:        row.icon || '🗺',
    mapUrl:      row.map_url || null,
    mapColor:    row.map_color || '#1a1228',
    sortOrder:   row.sort_order || 0,
    fogData:     row.fog_data || {},
  };
}

function _dbChatToLocal(row) {
  return {
    id:         row.id,
    playerId:   row.player_id,
    authorName: row.author_name,
    role:       row.role,
    text:       row.text,
    type:       row.msg_type || 'chat',
    diceData:   row.dice_data || null,
    timestamp:  new Date(row.created_at).getTime(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  UI — Panneau MJ / Joueur / Hors-ligne
// ═══════════════════════════════════════════════════════════════════════════
function _applyGMMode() {
  document.querySelectorAll('.gm-only').forEach(el => el.style.display = '');
  document.querySelectorAll('.player-only').forEach(el => el.style.display = 'none');
  const playerHUD = document.getElementById('player-hud');
  if (playerHUD) playerHUD.classList.add('hidden');
  const panelRight = document.getElementById('panel-right');
  if (panelRight) panelRight.style.display = '';
}

function _applyPlayerMode() {
  document.querySelectorAll('.gm-only').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.player-only').forEach(el => el.style.display = '');
  _updatePlayerHUD();
  // Injecter bouton personnage dans le HUD
  if (window.CharacterSystem) CharacterSystem.injectPlayerButton?.();
}

function _applyOfflineMode() {
  SbState.roomId   = null;
  SbState.roomCode = null;
  _showStatus('offline');
  _renderOfflinePanel();
  if (window.RoomManager) RoomManager.room = null;
}

function _updatePlayerHUD() {
  const hud = document.getElementById('player-hud');
  if (!hud) return;
  hud.classList.remove('hidden');

  const campaign = document.getElementById('player-hud-campaign');
  if (campaign) campaign.textContent = window.State?.campaignName || '—';

  const code = document.getElementById('player-hud-code');
  if (code) code.textContent = SbState.roomCode || '—';

  // Token assigné
  const tokenDiv = document.getElementById('player-hud-token');
  if (!tokenDiv) return;
  const token = window.State?.tokens?.find(t => t.ownerPlayerId === SbState.playerId || t.id === _getMyPlayer()?.controlledTokenId);
  if (token) {
    tokenDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:32px;height:32px;border-radius:50%;background:${token.color};display:flex;align-items:center;justify-content:center;font-size:16px;">${_esc(token.icon||token.name[0])}</div>
        <div>
          <div style="font-size:0.85rem;color:#e8dfc0;font-weight:600;">${_esc(token.name)}</div>
          <div style="font-size:0.72rem;color:#7a6a50;">${token.hp}/${token.hpMax} PV</div>
        </div>
      </div>`;
  } else {
    tokenDiv.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem;font-style:italic;">Aucun personnage assigné</span>';
  }
}

function _getMyPlayer() {
  return window.RoomManager?.room?.players?.find(p => p.id === SbState.playerId) || null;
}

function _renderRoomPanel() {
  const soloView = document.getElementById('mp-solo-view');
  const roomView = document.getElementById('mp-room-view');
  if (!soloView || !roomView) return;

  if (!SbState.roomId) {
    soloView.style.display = '';
    roomView.style.display = 'none';
    return;
  }

  soloView.style.display = 'none';
  roomView.style.display = '';

  const codeEl = document.getElementById('mp-room-code');
  if (codeEl) codeEl.textContent = SbState.roomCode || '—';

  _renderPlayersPanel();
}

function _renderOfflinePanel() {
  const soloView = document.getElementById('mp-solo-view');
  const roomView = document.getElementById('mp-room-view');
  if (soloView) soloView.style.display = '';
  if (roomView) roomView.style.display = 'none';
  const dot = document.querySelector('.session-dot');
  const txt = document.querySelector('.session-text');
  if (dot) { dot.className = 'session-dot'; }
  if (txt) txt.textContent = 'Solo';
}

function _renderPlayersPanel() {
  const list = document.getElementById('mp-players-list');
  if (!list || !window.RoomManager?.room) return;
  list.innerHTML = '';

  const players = window.RoomManager.room.players || [];
  players.forEach(p => {
    const isSelf = p.id === SbState.playerId;
    const token = window.State?.tokens?.find(t => t.id === p.controlledTokenId);
    const char  = p.character;

    let charLine = '';
    if (char?.name) {
      charLine = `<div style="font-size:0.7rem;color:#a0956a;margin-top:1px;">${_esc(char.class||'')}${char.level ? ' niv.'+char.level : ''} · ${char.hp||0}/${char.hpMax||0} PV</div>`;
    } else if (token) {
      charLine = `<div style="font-size:0.7rem;color:#a0956a;margin-top:1px;">♟ ${_esc(token.name)}</div>`;
    }

    const dotColor = p.role === 'mj' ? '#e8c97a' : p.online ? '#27ae60' : '#7f8c8d';
    const row = document.createElement('div');
    row.className = 'mp-player-row';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.03);margin-bottom:4px;';
    row.innerHTML = `
      <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;box-shadow:0 0 4px ${dotColor}44;"></span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.82rem;color:${p.online?'#e8dfc0':'#7a7060'};font-weight:${isSelf?'600':'400'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${_esc(p.name)}${isSelf ? ' <span style="font-size:0.65rem;color:#7c4dff;">(vous)</span>' : ''}
        </div>
        <div style="font-size:0.7rem;color:#6a5a40;">${p.role === 'mj' ? '⚔ MJ' : '🧙 Joueur'}</div>
        ${charLine}
      </div>
      ${SbState.isGM && p.role === 'joueur' ? `<button class="mp-assign-btn" data-player-id="${p.id}" style="font-size:0.65rem;padding:3px 7px;background:rgba(124,77,255,0.12);border:1px solid rgba(124,77,255,0.3);border-radius:5px;color:#b39ddb;cursor:pointer;" title="Assigner un token">♟</button>` : ''}
    `;
    list.appendChild(row);
  });

  // Bouton assigner token → ouvre le modal pour le MJ
  list.querySelectorAll('.mp-assign-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const playerId = btn.dataset.playerId;
      _openAssignTokenModal(playerId);
    });
  });
}

function _openAssignTokenModal(playerId) {
  // Créer un sélecteur de token rapide
  const player = window.RoomManager?.room?.players?.find(p => p.id === playerId);
  if (!player) return;

  let modal = document.getElementById('modal-assign-token');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-assign-token';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-panel modal-panel-sm">
        <div class="modal-header">
          <h2>♟ Assigner un pion</h2>
          <button class="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px;" id="assign-player-label"></p>
          <div id="assign-token-list" style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;"></div>
          <button class="btn-fantasy" id="assign-none-btn" style="width:100%;margin-top:12px;background:rgba(192,57,43,0.12);border-color:var(--blood);">✕ Retirer l'assignation</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.modal-overlay')?.addEventListener('click', () => modal.classList.add('hidden'));
    modal.querySelector('.modal-close')?.addEventListener('click', () => modal.classList.add('hidden'));
  }

  const label = document.getElementById('assign-player-label');
  if (label) label.textContent = `Choisir le pion pour ${player.name} :`;

  const list = document.getElementById('assign-token-list');
  if (!list) return;
  list.innerHTML = '';

  (window.State?.tokens || []).forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'btn-fantasy';
    btn.style.cssText = 'width:100%;text-align:left;display:flex;gap:8px;align-items:center;margin-bottom:2px;';
    btn.innerHTML = `<span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:${t.color};text-align:center;line-height:24px;font-size:12px;">${_esc(t.icon||t.name[0])}</span> ${_esc(t.name)} <span style="font-size:0.7rem;color:var(--text-muted);margin-left:auto;">${t.hp}/${t.hpMax} PV</span>`;
    btn.addEventListener('click', async () => {
      await sbAssignTokenOwner(t.id, playerId);
      // Mettre à jour localement
      if (window.State) {
        const tok = State.tokens.find(tok => tok.id === t.id);
        if (tok) tok.ownerPlayerId = playerId;
        const pl = window.RoomManager?.room?.players?.find(p => p.id === playerId);
        if (pl) pl.controlledTokenId = t.id;
      }
      _renderPlayersPanel();
      modal.classList.add('hidden');
      if (window.showToast) showToast(`${t.name} assigné à ${player.name}`, 'success', '♟');
    });
    list.appendChild(btn);
  });

  document.getElementById('assign-none-btn')?.addEventListener('click', async () => {
    // Retirer assignation
    const currentToken = State.tokens.find(t => t.ownerPlayerId === playerId);
    if (currentToken) {
      await _sb.from('tokens').update({ owner_player_id: null }).eq('id', currentToken.id);
      currentToken.ownerPlayerId = null;
    }
    await _sb.from('players').update({ controlled_token_id: null }).eq('id', playerId);
    const pl = window.RoomManager?.room?.players?.find(p => p.id === playerId);
    if (pl) pl.controlledTokenId = null;
    _renderPlayersPanel();
    modal.classList.add('hidden');
    if (window.showToast) showToast('Assignation retirée', 'info', '♟');
  }, { once: true });

  modal.classList.remove('hidden');
}

function _showStatus(status) {
  const dot = document.querySelector('.session-dot');
  const txt = document.querySelector('.session-text');
  if (!dot || !txt) return;
  dot.className = 'session-dot';
  if (status === 'online') {
    dot.classList.add('live');
    txt.textContent = `En ligne · ${SbState.roomCode || ''}`;
  } else if (status === 'connecting') {
    dot.classList.add('connecting');
    txt.textContent = 'Connexion…';
  } else {
    txt.textContent = 'Solo';
  }
}

function _updateSessionIndicator(connected) {
  _showStatus(connected ? 'online' : 'offline');
}

// ═══════════════════════════════════════════════════════════════════════════
//  REMPLACEMENT RoomManager — Compatible avec le code original
// ═══════════════════════════════════════════════════════════════════════════
if (window.RoomManager) {
  // Override les méthodes clés de RoomManager pour brancher sur Supabase
  RoomManager.createRoom = (name, gmName, maxPlayers) => sbCreateRoom(name, gmName, maxPlayers);
  RoomManager.joinRoom   = (code, name) => sbJoinRoom(code, name);
  RoomManager.closeRoom  = () => sbCloseRoom();

  RoomManager._applyGMMode     = _applyGMMode;
  RoomManager._applyPlayerMode = _applyPlayerMode;
  RoomManager._renderRoomPanel = _renderRoomPanel;
  RoomManager._updateSessionIndicator = _updateSessionIndicator;
}

// ═══════════════════════════════════════════════════════════════════════════
//  REMPLACEMENT SyncManager — Branché sur Supabase
// ═══════════════════════════════════════════════════════════════════════════
if (window.SyncManager) {
  SyncManager.tokenMoved = (tokenId, x, y) => sbMoveToken(tokenId, x, y);
  SyncManager.sceneChanged = (sceneId) => sbChangeScene(sceneId);
  SyncManager.fogUpdated = (fogData, fogEnabled) => sbUpdateFog(fogData, fogEnabled ?? window.State?.fogEnabled);
}

// ═══════════════════════════════════════════════════════════════════════════
//  REMPLACEMENT WS.send — Branché sur Supabase
// ═══════════════════════════════════════════════════════════════════════════
if (window.WS) {
  WS.send = (type, payload) => {
    switch (type) {
      case 'MOVE_TOKEN':
        sbMoveToken(payload.tokenId, payload.x, payload.y); break;
      case 'UPSERT_TOKEN':
        if (payload.token) sbUpsertToken(payload.token); break;
      case 'DELETE_TOKEN':
        if (payload.tokenId) sbDeleteToken(payload.tokenId); break;
      case 'ASSIGN_TOKEN_OWNER':
        sbAssignTokenOwner(payload.tokenId, payload.ownerPlayerId); break;
      case 'UPDATE_TOKEN_HP':
        sbUpdateTokenHp(payload.tokenId, payload.hp); break;
      case 'UPDATE_PLAYER':
        if (payload.player) sbUpdatePlayer(payload.player); break;
      case 'CHANGE_SCENE':
        if (payload.sceneId) sbChangeScene(payload.sceneId); break;
      case 'UPDATE_FOG':
        sbUpdateFog(payload.fogData, payload.fogEnabled); break;
      case 'UPDATE_COMBAT':
        sbUpdateCombat(payload); break;
      case 'SEND_CHAT':
        if (payload.text) sbSendChat(payload.text); break;
      case 'PLACE_MARKER':
        if (payload.marker) sbPlaceMarker(payload.marker); break;
      case 'CLOSE_ROOM':
        sbCloseRoom(); break;
    }
  };
  WS.isConnected = () => !!SbState.roomId;
}

// ═══════════════════════════════════════════════════════════════════════════
//  OVERRIDE CharacterSystem._save → branché sur Supabase
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('click', async (e) => {
  if (e.target.closest('#btn-save-character')) {
    setTimeout(async () => {
      const myPlayer = window.Session?.getMyPlayer?.() || window.RoomManager?.room?.players?.find(p => p.id === SbState.playerId);
      if (myPlayer?.character) {
        await sbUpdatePlayer({ character: myPlayer.character });
        _renderPlayersPanel();
      }
    }, 50);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  OVERRIDE dice → envoyer au chat
// ═══════════════════════════════════════════════════════════════════════════
function _hookDiceToChat() {
  const diceGrid = document.querySelector('.dice-grid');
  if (!diceGrid || diceGrid._sbHooked) return;
  diceGrid._sbHooked = true;
  diceGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.dice-btn');
    if (!btn || !SbState.roomId) return;
    const sides = parseInt(btn.dataset.sides, 10);
    if (!sides) return;
    setTimeout(() => {
      const resultEl = document.getElementById('dice-result-value');
      if (!resultEl) return;
      const result = parseInt(resultEl.textContent, 10);
      if (!result || isNaN(result)) return;
      sbSendChat(`🎲 Lancer de d${sides} : **${result}**`, 'dice', { sides, result });
    }, 100);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOK SAUVEGARDE SCÈNES ET TOKENS — Brancher sur Supabase
// ═══════════════════════════════════════════════════════════════════════════
function _hookSaveEvents() {
  // Intercepter saveToStorage pour aussi sauver sur Supabase
  const _origSave = window.saveToStorage;
  if (_origSave) {
    window.saveToStorage = function() {
      _origSave(); // conserver localStorage
      // Sauve de la room courante si connecté
      if (SbState.roomId && SbState.isGM && window.State) {
        _sb.from('rooms').update({
          fog_data:         State.fogData,
          fog_enabled:      State.fogEnabled,
          fog_opacity:      State.fogOpacity,
          grid_visible:     State.gridVisible,
          grid_cell_size:   State.gridCellSize,
          grid_color:       State.gridColor,
          grid_opacity:     State.gridOpacity,
          campaign_name:    State.campaignName,
          session_number:   State.sessionNumber,
          updated_at:       new Date().toISOString(),
        }).eq('id', SbState.roomId).then(()=>{});
      }
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  EXPORT — Fonctions accessibles globalement
// ═══════════════════════════════════════════════════════════════════════════
window.Supabase = {
  // Accès direct
  client:      _sb,
  state:       SbState,

  // Actions principales
  createRoom:  sbCreateRoom,
  joinRoom:    sbJoinRoom,
  closeRoom:   sbCloseRoom,
  reconnect:   sbReconnect,

  // Actions jeu
  moveToken:      sbMoveToken,
  upsertToken:    sbUpsertToken,
  deleteToken:    sbDeleteToken,
  updateTokenHp:  sbUpdateTokenHp,
  assignToken:    sbAssignTokenOwner,
  changeScene:    sbChangeScene,
  upsertScene:    sbUpsertScene,
  updateFog:      sbUpdateFog,
  updateCombat:   sbUpdateCombat,
  sendChat:       sbSendChat,
  updatePlayer:   sbUpdatePlayer,
  placeMarker:    sbPlaceMarker,
  broadcast:      sbBroadcast,

  // UI
  renderPlayers: _renderPlayersPanel,
  updateHUD:     _updatePlayerHUD,
};

// ═══════════════════════════════════════════════════════════════════════════
//  INIT — Exécuté quand le DOM est prêt
// ═══════════════════════════════════════════════════════════════════════════
function _sbInit() {
  console.info('[Supabase] Phase 3 chargé ✓');

  // Marquer joueur offline quand la page se ferme
  window.addEventListener('beforeunload', () => {
    if (SbState.playerId) {
      navigator.sendBeacon
        ? navigator.sendBeacon(
            `${SUPABASE_URL}/rest/v1/players?id=eq.${SbState.playerId}`,
            JSON.stringify({ is_online: false })
          )
        : _sb.from('players').update({ is_online: false }).eq('id', SbState.playerId);
    }
  });

  // Hooks après init de l'app
  const _waitApp = setInterval(() => {
    if (!window.State) return;
    clearInterval(_waitApp);
    _hookSaveEvents();
    _hookDiceToChat();

    // Tentative de reconnexion automatique
    sbReconnect().then(ok => {
      if (!ok) console.info('[Supabase] Pas de session sauvegardée — mode solo');
    });
  }, 200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _sbInit);
} else {
  _sbInit();
}
