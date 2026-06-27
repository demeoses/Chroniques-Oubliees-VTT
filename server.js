/**
 * CHRONIQUES OUBLIÉES — Serveur WebSocket Phase 3 FINAL
 * Usage : node server.js
 * Requires: npm install ws
 */

const { WebSocketServer } = require('ws');
const http = require('http');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;

// ─── État en mémoire ────────────────────────────────────────────────────────
const rooms   = new Map(); // roomCode → RoomData
const sockets = new Map(); // ws → { playerId, roomCode, playerName, role }

// ─── Utilitaires ────────────────────────────────────────────────────────────
function generateRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 3; i++) code += letters[Math.floor(Math.random() * letters.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += Math.floor(Math.random() * 10);
  return rooms.has(code) ? generateRoomCode() : code;
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify({ type, payload })); } catch (_) {}
}

function broadcastRoom(roomCode, type, payload, excludeWs = null) {
  for (const [ws, info] of sockets) {
    if (info.roomCode === roomCode && ws !== excludeWs && ws.readyState === 1) {
      send(ws, type, payload);
    }
  }
}

function broadcastAll(roomCode, type, payload) {
  for (const [ws, info] of sockets) {
    if (info.roomCode === roomCode && ws.readyState === 1) {
      send(ws, type, payload);
    }
  }
}

function getRoomSnapshot(room) {
  return {
    roomCode:       room.code,
    hostPlayerId:   room.hostPlayerId,
    players:        room.players,          // includes character field
    tokens:         room.state.tokens,
    currentSceneId: room.state.currentSceneId,
    fogData:        room.state.fogData,
    fogEnabled:     room.state.fogEnabled,
    combatActive:   room.state.combatActive,
    initiativeOrder:room.state.initiativeOrder,
    currentTurn:    room.state.currentTurn,
    round:          room.state.round,
    chatMessages:   room.state.chatMessages,
    markers:        room.state.markers,
  };
}

// Permission : MJ peut tout, joueur peut les actions listées
function isMJ(ws) {
  const info = sockets.get(ws);
  return info && info.role === 'mj';
}

function getInfo(ws) { return sockets.get(ws); }

// ─── Serveur HTTP (health check) ────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      players: sockets.size,
      uptime: Math.round(process.uptime()),
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Chroniques Oubliées VTT — Serveur Phase 3\n');
  }
});

// ─── WebSocket Server ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log(`[WS] +1 client (total: ${wss.clients.size})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || !msg.type) return;

    const { type, payload = {} } = msg;
    const info = getInfo(ws);

    // ── CREATE_ROOM ─────────────────────────────────────────────────────────
    if (type === 'CREATE_ROOM') {
      const playerId = payload.playerId || randomUUID();
      const code = generateRoomCode();
      const gm = { id: playerId, name: payload.playerName || 'MJ', role: 'mj', online: true };
      const room = {
        code, id: 'room-' + Date.now(),
        hostPlayerId: playerId,
        players: [gm],
        maxPlayers: payload.maxPlayers || 4,
        state: {
          tokens:          payload.initialState?.tokens         || [],
          currentSceneId:  payload.initialState?.currentSceneId || null,
          fogData:         payload.initialState?.fogData        || {},
          fogEnabled:      payload.initialState?.fogEnabled     || false,
          combatActive: false, currentTurn: 0, round: 0,
          initiativeOrder: [], chatMessages: [], markers: [],
        },
        createdAt: Date.now(),
      };
      rooms.set(code, room);
      sockets.set(ws, { playerId, roomCode: code, playerName: gm.name, role: 'mj' });
      send(ws, 'ROOM_CREATED', { roomCode: code, roomId: room.id, playerId });
      console.log(`[Room] Créée: ${code} par ${gm.name}`);
    }

    // ── JOIN_ROOM ────────────────────────────────────────────────────────────
    else if (type === 'JOIN_ROOM') {
      const code = (payload.roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { send(ws, 'ROOM_ERROR', { message: `Salle "${code}" introuvable.` }); return; }
      if (room.players.filter(p => p.online).length >= room.maxPlayers) {
        send(ws, 'ROOM_ERROR', { message: 'Salle complète.' }); return;
      }
      const playerId = payload.playerId || randomUUID();
      let player = room.players.find(p => p.id === playerId);
      if (player) {
        player.online = true;
        player.name = payload.playerName || player.name;
      } else {
        player = { id: playerId, name: payload.playerName || 'Aventurier', role: 'joueur', online: true };
        room.players.push(player);
      }
      sockets.set(ws, { playerId, roomCode: code, playerName: player.name, role: player.role });
      send(ws, 'ROOM_JOINED', { snapshot: getRoomSnapshot(room), playerId });
      broadcastRoom(code, 'PLAYER_JOINED', { player }, ws);
      console.log(`[Room] ${player.name} rejoint ${code}`);
    }

    // ── REJOIN_ROOM ──────────────────────────────────────────────────────────
    else if (type === 'REJOIN_ROOM') {
      const code = (payload.roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { send(ws, 'ROOM_ERROR', { message: 'Salle expirée ou introuvable.' }); return; }
      const playerId = payload.playerId;
      let player = room.players.find(p => p.id === playerId);
      if (!player) {
        player = { id: playerId, name: payload.playerName || 'Joueur', role: payload.role || 'joueur', online: true };
        room.players.push(player);
      } else {
        player.online = true;
      }
      sockets.set(ws, { playerId, roomCode: code, playerName: player.name, role: player.role });
      send(ws, 'SNAPSHOT', { snapshot: getRoomSnapshot(room) });
      broadcastRoom(code, 'PLAYER_JOINED', { player }, ws);
      console.log(`[Room] Reconnexion: ${player.name} dans ${code}`);
    }

    // ── MOVE_TOKEN ───────────────────────────────────────────────────────────
    else if (type === 'MOVE_TOKEN') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const { tokenId, x, y } = payload;
      const token = room.state.tokens.find(t => t.id === tokenId);
      if (!token) return;
      // Joueur ne peut déplacer que son propre token
      if (info.role !== 'mj' && token.ownerPlayerId !== info.playerId) return;
      token.x = x; token.y = y;
      broadcastRoom(info.roomCode, 'TOKEN_MOVED', { tokenId, x, y, playerId: info.playerId }, ws);
    }

    // ── UPSERT_TOKEN ─────────────────────────────────────────────────────────
    else if (type === 'UPSERT_TOKEN') {
      if (!isMJ(ws)) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const tok = payload.token;
      if (!tok || !tok.id) return;
      const idx = room.state.tokens.findIndex(t => t.id === tok.id);
      if (idx >= 0) room.state.tokens[idx] = { ...room.state.tokens[idx], ...tok };
      else room.state.tokens.push(tok);
      broadcastRoom(info.roomCode, 'TOKEN_UPSERTED', { token: tok, playerId: info.playerId }, ws);
    }

    // ── DELETE_TOKEN ─────────────────────────────────────────────────────────
    else if (type === 'DELETE_TOKEN') {
      if (!isMJ(ws)) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      room.state.tokens = room.state.tokens.filter(t => t.id !== payload.tokenId);
      broadcastRoom(info.roomCode, 'TOKEN_DELETED', { tokenId: payload.tokenId, playerId: info.playerId }, ws);
    }

    // ── ASSIGN_TOKEN_OWNER ───────────────────────────────────────────────────
    else if (type === 'ASSIGN_TOKEN_OWNER') {
      if (!isMJ(ws)) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const { tokenId, ownerPlayerId } = payload;
      const tok = room.state.tokens.find(t => t.id === tokenId);
      if (tok) tok.ownerPlayerId = ownerPlayerId;
      const player = room.players.find(p => p.id === ownerPlayerId);
      if (player) player.controlledTokenId = tokenId;
      broadcastAll(info.roomCode, 'TOKEN_OWNER_ASSIGNED', { tokenId, ownerPlayerId });
    }

    // ── UPDATE_TOKEN_HP ──────────────────────────────────────────────────────
    else if (type === 'UPDATE_TOKEN_HP') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const { tokenId, hp } = payload;
      const tok = room.state.tokens.find(t => t.id === tokenId);
      // Vérification propriété : MJ peut tout, joueur seulement son token
      if (tok && (info.role === 'mj' || tok.ownerPlayerId === info.playerId)) {
        tok.hp = hp;
        broadcastRoom(info.roomCode, 'TOKEN_HP_UPDATED', { tokenId, hp, playerId: info.playerId }, ws);
      }
    }

    // ── UPDATE_PLAYER — Mise à jour du personnage ────────────────────────────
    else if (type === 'UPDATE_PLAYER') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const { player: playerUpdate } = payload;
      if (!playerUpdate) return;
      // Un joueur ne peut mettre à jour que ses propres données (sauf MJ qui peut tout)
      const targetId = playerUpdate.id || info.playerId;
      if (info.role !== 'mj' && targetId !== info.playerId) return;
      const player = room.players.find(p => p.id === targetId);
      if (player) {
        // Merger uniquement les champs autorisés
        if (playerUpdate.character !== undefined) player.character = playerUpdate.character;
        if (playerUpdate.name !== undefined)      player.name = playerUpdate.name;
        if (playerUpdate.color !== undefined)     player.color = playerUpdate.color;
        // Broadcaster à tous les autres joueurs
        broadcastAll(info.roomCode, 'PLAYER_UPDATED', { player });
        console.log(`[Player] ${player.name} mis à jour dans ${info.roomCode}`);
      }
    }

    // ── CHANGE_SCENE ─────────────────────────────────────────────────────────
    else if (type === 'CHANGE_SCENE') {
      if (!isMJ(ws)) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      room.state.currentSceneId = payload.sceneId;
      broadcastRoom(info.roomCode, 'SCENE_CHANGED', { sceneId: payload.sceneId, playerId: info.playerId }, ws);
    }

    // ── UPDATE_FOG ───────────────────────────────────────────────────────────
    else if (type === 'UPDATE_FOG') {
      if (!isMJ(ws)) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      if (payload.fogData    !== undefined) room.state.fogData    = payload.fogData;
      if (payload.fogEnabled !== undefined) room.state.fogEnabled = payload.fogEnabled;
      broadcastRoom(info.roomCode, 'FOG_UPDATED', {
        fogData: room.state.fogData,
        fogEnabled: room.state.fogEnabled,
        playerId: info.playerId,
      }, ws);
    }

    // ── UPDATE_COMBAT ────────────────────────────────────────────────────────
    else if (type === 'UPDATE_COMBAT') {
      if (!isMJ(ws)) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const s = room.state;
      if (payload.combatActive    !== undefined) s.combatActive    = payload.combatActive;
      if (payload.initiativeOrder !== undefined) s.initiativeOrder = payload.initiativeOrder;
      if (payload.currentTurn     !== undefined) s.currentTurn     = payload.currentTurn;
      if (payload.round           !== undefined) s.round           = payload.round;
      broadcastRoom(info.roomCode, 'COMBAT_UPDATED', { ...payload, playerId: info.playerId }, ws);
    }

    // ── SEND_CHAT ────────────────────────────────────────────────────────────
    else if (type === 'SEND_CHAT') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const message = {
        id: 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 99999),
        playerId:   info.playerId,
        authorName: info.playerName || 'Joueur',
        role:       info.role || 'joueur',
        text:       String(payload.text || '').slice(0, 500),
        timestamp:  Date.now(),
      };
      room.state.chatMessages.push(message);
      if (room.state.chatMessages.length > 300) {
        room.state.chatMessages = room.state.chatMessages.slice(-300);
      }
      // Envoyer à TOUS (y compris l'expéditeur)
      broadcastAll(info.roomCode, 'CHAT_MESSAGE', { message });
    }

    // ── PLACE_MARKER ─────────────────────────────────────────────────────────
    else if (type === 'PLACE_MARKER') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const marker = { ...payload.marker, placedBy: info.playerId };
      broadcastRoom(info.roomCode, 'MARKER_PLACED', { marker }, ws);
      const delay = Math.max(100, (marker.expiresAt || Date.now() + 3000) - Date.now());
      setTimeout(() => broadcastAll(info.roomCode, 'MARKER_REMOVED', { markerId: marker.id }), delay);
    }

    // ── REQUEST_SNAPSHOT ──────────────────────────────────────────────────────
    else if (type === 'REQUEST_SNAPSHOT') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (room) send(ws, 'SNAPSHOT', { snapshot: getRoomSnapshot(room) });
    }

    // ── PING ─────────────────────────────────────────────────────────────────
    else if (type === 'PING') {
      send(ws, 'PONG', { ts: Date.now() });
    }

    // ── CLOSE_ROOM ───────────────────────────────────────────────────────────
    else if (type === 'CLOSE_ROOM') {
      if (!isMJ(ws)) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      broadcastRoom(info.roomCode, 'ROOM_CLOSED', { message: 'Le MJ a fermé la salle.' }, ws);
      rooms.delete(info.roomCode);
      console.log(`[Room] Fermée par MJ: ${info.roomCode}`);
    }
  });

  ws.on('close', () => {
    const info = sockets.get(ws);
    if (info?.roomCode) {
      const room = rooms.get(info.roomCode);
      if (room) {
        const player = room.players.find(p => p.id === info.playerId);
        if (player) player.online = false;
        broadcastRoom(info.roomCode, 'PLAYER_LEFT', { playerId: info.playerId });
        // Nettoyer salle vide après 30 minutes
        const onlineCount = room.players.filter(p => p.online).length;
        if (onlineCount === 0) {
          setTimeout(() => {
            const r = rooms.get(info.roomCode);
            if (r && r.players.every(p => !p.online)) {
              rooms.delete(info.roomCode);
              console.log(`[Room] Supprimée (inactivité): ${info.roomCode}`);
            }
          }, 30 * 60 * 1000);
        }
      }
    }
    sockets.delete(ws);
    console.log(`[WS] -1 client (total: ${wss.clients.size})`);
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`\n⚔  Chroniques Oubliées — Serveur Phase 3 FINAL`);
  console.log(`   HTTP:   http://localhost:${PORT}/health`);
  console.log(`   WS:     ws://localhost:${PORT}`);
  console.log(`   Prêt !\n`);
});
