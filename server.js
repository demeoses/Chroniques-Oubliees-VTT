/**
 * CHRONIQUES OUBLIÉES — Serveur WebSocket Phase 3
 * 
 * Usage : node server.js
 * Clients se connectent à ws://localhost:3000
 * 
 * Requires: npm install ws
 */

const { WebSocketServer } = require('ws');
const http = require('http');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;

// ─── État en mémoire ────────────────────────────────────────────────────────
const rooms = new Map(); // roomCode → RoomData
const sockets = new Map(); // ws → { playerId, roomCode, playerName, role }

// ─── Utilitaires ────────────────────────────────────────────────────────────
function generateRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 3; i++) code += letters[Math.floor(Math.random() * letters.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += Math.floor(Math.random() * 10);
  // Ensure unique
  return rooms.has(code) ? generateRoomCode() : code;
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify({ type, payload })); } catch (e) {}
}

function broadcastToRoom(roomCode, type, payload, excludeWs = null) {
  for (const [ws, info] of sockets) {
    if (info.roomCode === roomCode && ws !== excludeWs && ws.readyState === 1) {
      send(ws, type, payload);
    }
  }
}

function broadcastToAll(roomCode, type, payload) {
  for (const [ws, info] of sockets) {
    if (info.roomCode === roomCode && ws.readyState === 1) {
      send(ws, type, payload);
    }
  }
}

function getRoomSnapshot(room) {
  return {
    roomCode: room.code,
    hostPlayerId: room.hostPlayerId,
    players: room.players,
    tokens: room.sessionState.tokens || [],
    currentSceneId: room.sessionState.currentSceneId,
    fogData: room.sessionState.fogData || {},
    fogEnabled: room.sessionState.fogEnabled || false,
    combatActive: room.sessionState.combatActive || false,
    initiativeOrder: room.sessionState.initiativeOrder || [],
    currentTurn: room.sessionState.currentTurn || 0,
    round: room.sessionState.round || 0,
    chatMessages: room.sessionState.chatMessages || [],
    markers: room.sessionState.markers || [],
  };
}

function canPerformAction(ws, action) {
  const info = sockets.get(ws);
  if (!info) return false;
  if (info.role === 'mj') return true;
  const playerActions = ['MOVE_TOKEN', 'SEND_CHAT', 'PLACE_MARKER', 'REMOVE_MARKER', 'PING'];
  return playerActions.includes(action);
}

// ─── Serveur HTTP (pour health check) ──────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, players: sockets.size }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Chroniques Oubliées VTT Server\n');
  }
});

// ─── WebSocket Server ───────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[WS] Nouveau client connecté');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || !msg.type) return;

    const { type, payload = {} } = msg;
    const info = sockets.get(ws);

    // ── CREATE_ROOM ────────────────────────────────────────────────────
    if (type === 'CREATE_ROOM') {
      const playerId = payload.playerId || randomUUID();
      const code = generateRoomCode();
      const room = {
        code,
        id: 'room-' + Date.now(),
        hostPlayerId: playerId,
        players: [{ id: playerId, name: payload.playerName || 'MJ', role: 'mj', online: true }],
        maxPlayers: payload.maxPlayers || 4,
        sessionState: {
          tokens: (payload.initialState?.tokens) || [],
          currentSceneId: payload.initialState?.currentSceneId || null,
          fogData: payload.initialState?.fogData || {},
          fogEnabled: payload.initialState?.fogEnabled || false,
          combatActive: false, currentTurn: 0, round: 0,
          initiativeOrder: [], chatMessages: [], markers: [],
        },
        createdAt: Date.now(),
      };
      rooms.set(code, room);
      sockets.set(ws, { playerId, roomCode: code, playerName: room.players[0].name, role: 'mj' });
      send(ws, 'ROOM_CREATED', { roomCode: code, roomId: room.id, playerId });
      console.log('[Room] Créée:', code, 'par', room.players[0].name);
    }

    // ── JOIN_ROOM ──────────────────────────────────────────────────────
    else if (type === 'JOIN_ROOM') {
      const code = (payload.roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        send(ws, 'ROOM_ERROR', { message: `Salle ${code} introuvable.` });
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        send(ws, 'ROOM_ERROR', { message: 'Salle complète.' });
        return;
      }
      const playerId = payload.playerId || randomUUID();
      const player = { id: playerId, name: payload.playerName || 'Aventurier', role: 'joueur', online: true };
      // Vérifier si déjà dans la room (reconnexion)
      const existing = room.players.find(p => p.id === playerId);
      if (existing) existing.online = true;
      else room.players.push(player);

      sockets.set(ws, { playerId, roomCode: code, playerName: player.name, role: 'joueur' });
      send(ws, 'ROOM_JOINED', { snapshot: getRoomSnapshot(room), playerId });
      broadcastToRoom(code, 'PLAYER_JOINED', { player: existing || player }, ws);
      console.log('[Room] Joueur rejoint:', code, player.name);
    }

    // ── REJOIN_ROOM (reconnexion) ──────────────────────────────────────
    else if (type === 'REJOIN_ROOM') {
      const code = (payload.roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { send(ws, 'ROOM_ERROR', { message: 'Salle expirée.' }); return; }
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
      broadcastToRoom(code, 'PLAYER_JOINED', { player }, ws);
      console.log('[Room] Reconnexion:', code, player.name);
    }

    // ── MOVE_TOKEN ────────────────────────────────────────────────────
    else if (type === 'MOVE_TOKEN') {
      if (!info || !canPerformAction(ws, 'MOVE_TOKEN')) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const { tokenId, x, y } = payload;
      const token = room.sessionState.tokens.find(t => t.id === tokenId);
      if (!token) return;
      // Vérifier propriété
      if (info.role !== 'mj' && token.ownerPlayerId !== info.playerId) return;
      token.x = x; token.y = y;
      broadcastToRoom(info.roomCode, 'TOKEN_MOVED', { tokenId, x, y, playerId: info.playerId }, ws);
    }

    // ── UPSERT_TOKEN ───────────────────────────────────────────────────
    else if (type === 'UPSERT_TOKEN') {
      if (!info || info.role !== 'mj') return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const token = payload.token;
      const idx = room.sessionState.tokens.findIndex(t => t.id === token.id);
      if (idx >= 0) room.sessionState.tokens[idx] = { ...room.sessionState.tokens[idx], ...token };
      else room.sessionState.tokens.push(token);
      broadcastToRoom(info.roomCode, 'TOKEN_UPSERTED', { token, playerId: info.playerId }, ws);
    }

    // ── DELETE_TOKEN ───────────────────────────────────────────────────
    else if (type === 'DELETE_TOKEN') {
      if (!info || info.role !== 'mj') return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      room.sessionState.tokens = room.sessionState.tokens.filter(t => t.id !== payload.tokenId);
      broadcastToRoom(info.roomCode, 'TOKEN_DELETED', { tokenId: payload.tokenId, playerId: info.playerId }, ws);
    }

    // ── ASSIGN_TOKEN_OWNER ─────────────────────────────────────────────
    else if (type === 'ASSIGN_TOKEN_OWNER') {
      if (!info || info.role !== 'mj') return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const { tokenId, ownerPlayerId } = payload;
      const token = room.sessionState.tokens.find(t => t.id === tokenId);
      if (token) token.ownerPlayerId = ownerPlayerId;
      const player = room.players.find(p => p.id === ownerPlayerId);
      if (player) player.controlledTokenId = tokenId;
      broadcastToAll(info.roomCode, 'TOKEN_OWNER_ASSIGNED', { tokenId, ownerPlayerId });
    }

    // ── UPDATE_TOKEN_HP ────────────────────────────────────────────────
    else if (type === 'UPDATE_TOKEN_HP') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const { tokenId, hp } = payload;
      const token = room.sessionState.tokens.find(t => t.id === tokenId);
      if (token) token.hp = hp;
      broadcastToRoom(info.roomCode, 'TOKEN_HP_UPDATED', { tokenId, hp, playerId: info.playerId }, ws);
    }

    // ── CHANGE_SCENE ───────────────────────────────────────────────────
    else if (type === 'CHANGE_SCENE') {
      if (!info || info.role !== 'mj') return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      room.sessionState.currentSceneId = payload.sceneId;
      broadcastToRoom(info.roomCode, 'SCENE_CHANGED', { sceneId: payload.sceneId, playerId: info.playerId }, ws);
    }

    // ── UPDATE_FOG ────────────────────────────────────────────────────
    else if (type === 'UPDATE_FOG') {
      if (!info || info.role !== 'mj') return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      if (payload.fogData !== undefined) room.sessionState.fogData = payload.fogData;
      if (payload.fogEnabled !== undefined) room.sessionState.fogEnabled = payload.fogEnabled;
      broadcastToRoom(info.roomCode, 'FOG_UPDATED', { fogData: room.sessionState.fogData, fogEnabled: room.sessionState.fogEnabled, playerId: info.playerId }, ws);
    }

    // ── UPDATE_COMBAT ─────────────────────────────────────────────────
    else if (type === 'UPDATE_COMBAT') {
      if (!info || info.role !== 'mj') return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      Object.assign(room.sessionState, {
        combatActive: payload.combatActive ?? room.sessionState.combatActive,
        initiativeOrder: payload.initiativeOrder ?? room.sessionState.initiativeOrder,
        currentTurn: payload.currentTurn ?? room.sessionState.currentTurn,
        round: payload.round ?? room.sessionState.round,
      });
      broadcastToRoom(info.roomCode, 'COMBAT_UPDATED', { ...payload, playerId: info.playerId }, ws);
    }

    // ── SEND_CHAT ─────────────────────────────────────────────────────
    else if (type === 'SEND_CHAT') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const message = {
        id: 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 99999),
        playerId: info.playerId,
        authorName: info.playerName || 'Joueur',
        role: info.role || 'joueur',
        text: String(payload.text || '').slice(0, 300),
        timestamp: Date.now(),
      };
      room.sessionState.chatMessages.push(message);
      // Garder 200 messages max
      if (room.sessionState.chatMessages.length > 200) room.sessionState.chatMessages = room.sessionState.chatMessages.slice(-200);
      // Envoyer à tous, y compris l'expéditeur
      broadcastToAll(info.roomCode, 'CHAT_MESSAGE', { message });
    }

    // ── PLACE_MARKER ──────────────────────────────────────────────────
    else if (type === 'PLACE_MARKER') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      const marker = { ...payload.marker, placedBy: info.playerId };
      // Broadcast à tous sauf l'émetteur
      broadcastToRoom(info.roomCode, 'MARKER_PLACED', { marker }, ws);
      // Auto-remove après expiration
      const delay = Math.max(100, (marker.expiresAt || Date.now() + 3000) - Date.now());
      setTimeout(() => {
        broadcastToAll(info.roomCode, 'MARKER_REMOVED', { markerId: marker.id });
      }, delay);
    }

    // ── REMOVE_MARKER ─────────────────────────────────────────────────
    else if (type === 'REMOVE_MARKER') {
      if (!info) return;
      broadcastToRoom(info.roomCode, 'MARKER_REMOVED', { markerId: payload.markerId }, ws);
    }

    // ── REQUEST_SNAPSHOT ──────────────────────────────────────────────
    else if (type === 'REQUEST_SNAPSHOT') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (room) send(ws, 'SNAPSHOT', { snapshot: getRoomSnapshot(room) });
    }

    // ── PING ──────────────────────────────────────────────────────────
    else if (type === 'PING') {
      send(ws, 'PONG', { ts: Date.now() });
    }
  });

  ws.on('close', () => {
    const info = sockets.get(ws);
    if (info && info.roomCode) {
      const room = rooms.get(info.roomCode);
      if (room) {
        const player = room.players.find(p => p.id === info.playerId);
        if (player) player.online = false;
        broadcastToRoom(info.roomCode, 'PLAYER_LEFT', { playerId: info.playerId });
        // Nettoyer les salles vides après 30 minutes
        const onlinePlayers = room.players.filter(p => p.online);
        if (onlinePlayers.length === 0) {
          setTimeout(() => {
            const r = rooms.get(info.roomCode);
            if (r && r.players.every(p => !p.online)) {
              rooms.delete(info.roomCode);
              console.log('[Room] Supprimée (inactivité):', info.roomCode);
            }
          }, 30 * 60 * 1000);
        }
      }
    }
    sockets.delete(ws);
    console.log('[WS] Client déconnecté. Total:', sockets.size);
  });
});

server.listen(PORT, () => {
  console.log(`\n🌐 Chroniques Oubliées — Serveur Phase 3`);
  console.log(`   HTTP:  http://localhost:${PORT}/health`);
  console.log(`   WS:    ws://localhost:${PORT}`);
  console.log(`   Configurez l'URL WS dans l'application pour activer le multijoueur.\n`);
});
