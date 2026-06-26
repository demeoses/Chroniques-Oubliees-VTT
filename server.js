/**
 * CHRONIQUES OUBLIÉES — Serveur WebSocket Phase 3 (version réelle)
 * 
 * npm install ws
 * node server.js
 * 
 * Événements client → serveur :
 *   CREATE_ROOM, JOIN_ROOM, REJOIN_ROOM
 *   MOVE_TOKEN, UPSERT_TOKEN, DELETE_TOKEN, ASSIGN_TOKEN_OWNER, UPDATE_TOKEN_HP
 *   CHANGE_SCENE, UPDATE_FOG, UPDATE_COMBAT
 *   SEND_CHAT, PLACE_MARKER, REMOVE_MARKER
 *   UPDATE_PLAYER (mise à jour perso/infos joueur)
 *   REQUEST_SNAPSHOT, PING
 *
 * Événements serveur → client :
 *   ROOM_CREATED, ROOM_JOINED, ROOM_ERROR, SNAPSHOT
 *   PLAYER_JOINED, PLAYER_LEFT, PLAYER_UPDATED
 *   TOKEN_MOVED, TOKEN_UPSERTED, TOKEN_DELETED, TOKEN_OWNER_ASSIGNED, TOKEN_HP_UPDATED
 *   SCENE_CHANGED, FOG_UPDATED, COMBAT_UPDATED
 *   CHAT_MESSAGE, MARKER_PLACED, MARKER_REMOVED
 *   PONG
 */

'use strict';

const { WebSocketServer } = require('ws');
const http = require('http');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;

// ── État en mémoire ──────────────────────────────────────────────────────────
/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {Map<WebSocket, SocketInfo>} */
const sockets = new Map();

/**
 * @typedef {{ id:string, name:string, role:'mj'|'joueur', online:boolean, color?:string, character?:object, controlledTokenId?:string }} Player
 * @typedef {{ code:string, id:string, hostPlayerId:string, players:Player[], maxPlayers:number, sessionState:SessionState, createdAt:number }} Room
 * @typedef {{ tokens:any[], currentSceneId:string|null, fogData:object, fogEnabled:boolean, combatActive:boolean, currentTurn:number, round:number, initiativeOrder:any[], chatMessages:any[], markers:any[] }} SessionState
 * @typedef {{ playerId:string, roomCode:string, playerName:string, role:'mj'|'joueur' }} SocketInfo
 */

// ── Utilitaires ──────────────────────────────────────────────────────────────
function generateRoomCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 3; i++) code += L[Math.floor(Math.random() * L.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += Math.floor(Math.random() * 10);
  return rooms.has(code) ? generateRoomCode() : code;
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify({ type, payload })); } catch (_) {}
}

/** Envoie à tous les membres de la salle SAUF le ws exclu */
function broadcast(roomCode, type, payload, excludeWs = null) {
  for (const [ws, info] of sockets) {
    if (info.roomCode === roomCode && ws !== excludeWs && ws.readyState === 1) {
      send(ws, type, payload);
    }
  }
}

/** Envoie à TOUS les membres de la salle y compris l'émetteur */
function broadcastAll(roomCode, type, payload) {
  for (const [ws, info] of sockets) {
    if (info.roomCode === roomCode && ws.readyState === 1) {
      send(ws, type, payload);
    }
  }
}

function getRoom(code) { return rooms.get((code||'').toUpperCase().trim()) || null; }

function getInfo(ws) { return sockets.get(ws) || null; }

function isMJ(ws) { return sockets.get(ws)?.role === 'mj'; }

/** Snapshot complet de la salle envoyé aux clients */
function snapshot(room) {
  return {
    roomCode:       room.code,
    hostPlayerId:   room.hostPlayerId,
    players:        room.players,
    tokens:         room.sessionState.tokens         || [],
    currentSceneId: room.sessionState.currentSceneId || null,
    fogData:        room.sessionState.fogData         || {},
    fogEnabled:     room.sessionState.fogEnabled      || false,
    combatActive:   room.sessionState.combatActive    || false,
    currentTurn:    room.sessionState.currentTurn     || 0,
    round:          room.sessionState.round           || 0,
    initiativeOrder:room.sessionState.initiativeOrder || [],
    chatMessages:   room.sessionState.chatMessages    || [],
    markers:        room.sessionState.markers         || [],
  };
}

/** Supprime les salles inactives depuis 30 minutes */
function scheduleRoomCleanup(code) {
  setTimeout(() => {
    const r = rooms.get(code);
    if (r && r.players.every(p => !p.online)) {
      rooms.delete(code);
      console.log(`[Room] Supprimée (inactivité) : ${code}`);
    }
  }, 30 * 60 * 1000);
}

// ── HTTP (health check) ──────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const body = req.url === '/health'
    ? JSON.stringify({ ok: true, rooms: rooms.size, players: sockets.size, ts: Date.now() })
    : 'Chroniques Oubliées VTT\n';
  res.writeHead(200, { 'Content-Type': req.url === '/health' ? 'application/json' : 'text/plain' });
  res.end(body);
});

// ── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log(`[WS] Connexion. Clients actifs : ${sockets.size + 1}`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg?.type) return;

    const { type, payload = {} } = msg;
    const info = getInfo(ws);

    switch (type) {

      // ── CREATE_ROOM ───────────────────────────────────────────────────────
      case 'CREATE_ROOM': {
        const playerId = payload.playerId || randomUUID();
        const code = generateRoomCode();
        /** @type {Room} */
        const room = {
          code,
          id: 'room-' + Date.now(),
          hostPlayerId: playerId,
          players: [{ id: playerId, name: payload.playerName || 'Maître du Jeu', role: 'mj', online: true, color: '#c9a84c' }],
          maxPlayers: Number(payload.maxPlayers) || 4,
          sessionState: {
            tokens:          (payload.initialState?.tokens || []).map(t => ({ ...t, imgData: undefined })),
            currentSceneId:  payload.initialState?.currentSceneId || null,
            fogData:         payload.initialState?.fogData || {},
            fogEnabled:      payload.initialState?.fogEnabled || false,
            combatActive: false, currentTurn: 0, round: 0,
            initiativeOrder: [], chatMessages: [], markers: [],
          },
          createdAt: Date.now(),
        };
        rooms.set(code, room);
        sockets.set(ws, { playerId, roomCode: code, playerName: room.players[0].name, role: 'mj' });
        send(ws, 'ROOM_CREATED', { roomCode: code, roomId: room.id, playerId });
        console.log(`[Room] Créée : ${code} par ${room.players[0].name}`);
        break;
      }

      // ── JOIN_ROOM ─────────────────────────────────────────────────────────
      case 'JOIN_ROOM': {
        const code = (payload.roomCode || '').toUpperCase().trim();
        const room = getRoom(code);
        if (!room) { send(ws, 'ROOM_ERROR', { message: `Salle "${code}" introuvable.` }); break; }
        const onlineCount = room.players.filter(p => p.online).length;
        if (onlineCount >= room.maxPlayers && !room.players.find(p => p.id === payload.playerId)) {
          send(ws, 'ROOM_ERROR', { message: 'La salle est complète.' }); break;
        }
        const playerId = payload.playerId || randomUUID();
        let player = room.players.find(p => p.id === playerId);
        if (player) {
          player.online = true;
          player.name = payload.playerName || player.name;
        } else {
          player = { id: playerId, name: payload.playerName || 'Aventurier', role: 'joueur', online: true, color: '#7c4dff' };
          room.players.push(player);
        }
        sockets.set(ws, { playerId, roomCode: code, playerName: player.name, role: player.role });
        send(ws, 'ROOM_JOINED', { snapshot: snapshot(room), playerId });
        broadcast(code, 'PLAYER_JOINED', { player }, ws);
        console.log(`[Room] ${player.name} a rejoint ${code}`);
        break;
      }

      // ── REJOIN_ROOM (reconnexion automatique) ────────────────────────────
      case 'REJOIN_ROOM': {
        const code = (payload.roomCode || '').toUpperCase().trim();
        const room = getRoom(code);
        if (!room) { send(ws, 'ROOM_ERROR', { message: 'Salle expirée ou introuvable.' }); break; }
        const playerId = payload.playerId || randomUUID();
        let player = room.players.find(p => p.id === playerId);
        if (player) {
          player.online = true;
        } else {
          player = { id: playerId, name: payload.playerName || 'Joueur', role: payload.role || 'joueur', online: true };
          room.players.push(player);
        }
        sockets.set(ws, { playerId, roomCode: code, playerName: player.name, role: player.role });
        send(ws, 'SNAPSHOT', { snapshot: snapshot(room) });
        broadcast(code, 'PLAYER_JOINED', { player }, ws);
        console.log(`[Room] Reconnexion de ${player.name} dans ${code}`);
        break;
      }

      // ── UPDATE_PLAYER (personnage, infos joueur) ─────────────────────────
      case 'UPDATE_PLAYER': {
        if (!info) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        const { player: updates } = payload;
        if (!updates || updates.id !== info.playerId) break; // Sécurité : on ne peut mettre à jour que soi-même
        let player = room.players.find(p => p.id === info.playerId);
        if (!player) break;
        // Fusion : on interdit de changer son propre rôle
        const { role: _discardRole, ...safeUpdates } = updates;
        Object.assign(player, safeUpdates);
        broadcastAll(info.roomCode, 'PLAYER_UPDATED', { player });
        break;
      }

      // ── MOVE_TOKEN ────────────────────────────────────────────────────────
      case 'MOVE_TOKEN': {
        if (!info) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        const { tokenId, x, y } = payload;
        const token = room.sessionState.tokens.find(t => t.id === tokenId);
        if (!token) break;
        if (info.role !== 'mj' && token.ownerPlayerId !== info.playerId) break;
        token.x = x; token.y = y;
        broadcast(info.roomCode, 'TOKEN_MOVED', { tokenId, x, y, playerId: info.playerId }, ws);
        break;
      }

      // ── UPSERT_TOKEN ──────────────────────────────────────────────────────
      case 'UPSERT_TOKEN': {
        if (!info || !isMJ(ws)) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        const token = { ...payload.token, imgData: undefined };
        const idx = room.sessionState.tokens.findIndex(t => t.id === token.id);
        if (idx >= 0) Object.assign(room.sessionState.tokens[idx], token);
        else room.sessionState.tokens.push(token);
        broadcast(info.roomCode, 'TOKEN_UPSERTED', { token, playerId: info.playerId }, ws);
        break;
      }

      // ── DELETE_TOKEN ──────────────────────────────────────────────────────
      case 'DELETE_TOKEN': {
        if (!info || !isMJ(ws)) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        room.sessionState.tokens = room.sessionState.tokens.filter(t => t.id !== payload.tokenId);
        broadcast(info.roomCode, 'TOKEN_DELETED', { tokenId: payload.tokenId, playerId: info.playerId }, ws);
        break;
      }

      // ── ASSIGN_TOKEN_OWNER ────────────────────────────────────────────────
      case 'ASSIGN_TOKEN_OWNER': {
        if (!info || !isMJ(ws)) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        const { tokenId, ownerPlayerId } = payload;
        const token = room.sessionState.tokens.find(t => t.id === tokenId);
        if (token) token.ownerPlayerId = ownerPlayerId;
        const player = room.players.find(p => p.id === ownerPlayerId);
        if (player) player.controlledTokenId = tokenId;
        broadcastAll(info.roomCode, 'TOKEN_OWNER_ASSIGNED', { tokenId, ownerPlayerId });
        // Broadcast aussi PLAYER_UPDATED pour que tous voient le lien joueur → token
        if (player) broadcastAll(info.roomCode, 'PLAYER_UPDATED', { player });
        break;
      }

      // ── UPDATE_TOKEN_HP ───────────────────────────────────────────────────
      case 'UPDATE_TOKEN_HP': {
        if (!info) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        const { tokenId, hp } = payload;
        const token = room.sessionState.tokens.find(t => t.id === tokenId);
        if (!token) break;
        if (info.role !== 'mj' && token.ownerPlayerId !== info.playerId) break;
        token.hp = hp;
        broadcast(info.roomCode, 'TOKEN_HP_UPDATED', { tokenId, hp, playerId: info.playerId }, ws);
        break;
      }

      // ── CHANGE_SCENE ──────────────────────────────────────────────────────
      case 'CHANGE_SCENE': {
        if (!info || !isMJ(ws)) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        room.sessionState.currentSceneId = payload.sceneId;
        broadcast(info.roomCode, 'SCENE_CHANGED', { sceneId: payload.sceneId, playerId: info.playerId }, ws);
        break;
      }

      // ── UPDATE_FOG ────────────────────────────────────────────────────────
      case 'UPDATE_FOG': {
        if (!info || !isMJ(ws)) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        if (payload.fogData !== undefined) room.sessionState.fogData = payload.fogData;
        if (payload.fogEnabled !== undefined) room.sessionState.fogEnabled = payload.fogEnabled;
        broadcast(info.roomCode, 'FOG_UPDATED', {
          fogData: room.sessionState.fogData,
          fogEnabled: room.sessionState.fogEnabled,
          playerId: info.playerId,
        }, ws);
        break;
      }

      // ── UPDATE_COMBAT ─────────────────────────────────────────────────────
      case 'UPDATE_COMBAT': {
        if (!info || !isMJ(ws)) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        const ss = room.sessionState;
        if (payload.combatActive   !== undefined) ss.combatActive   = payload.combatActive;
        if (payload.initiativeOrder !== undefined) ss.initiativeOrder = payload.initiativeOrder;
        if (payload.currentTurn    !== undefined) ss.currentTurn    = payload.currentTurn;
        if (payload.round          !== undefined) ss.round          = payload.round;
        broadcast(info.roomCode, 'COMBAT_UPDATED', { ...payload, playerId: info.playerId }, ws);
        break;
      }

      // ── SEND_CHAT ─────────────────────────────────────────────────────────
      case 'SEND_CHAT': {
        if (!info) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        const message = {
          id:         'msg-' + Date.now() + '-' + Math.floor(Math.random() * 99999),
          playerId:   info.playerId,
          authorName: info.playerName || 'Joueur',
          role:       info.role || 'joueur',
          text:       String(payload.text || '').trim().slice(0, 300),
          timestamp:  Date.now(),
        };
        if (!message.text) break;
        room.sessionState.chatMessages.push(message);
        if (room.sessionState.chatMessages.length > 200) {
          room.sessionState.chatMessages = room.sessionState.chatMessages.slice(-200);
        }
        // Envoyer à TOUS (y compris l'expéditeur) pour garantir la réception
        broadcastAll(info.roomCode, 'CHAT_MESSAGE', { message });
        break;
      }

      // ── PLACE_MARKER ──────────────────────────────────────────────────────
      case 'PLACE_MARKER': {
        if (!info) break;
        const room = getRoom(info.roomCode);
        if (!room) break;
        const marker = { ...payload.marker, placedBy: info.playerId };
        // Broadcast à tous sauf l'émetteur (il l'a déjà rendu localement)
        broadcast(info.roomCode, 'MARKER_PLACED', { marker }, ws);
        const delay = Math.max(200, (marker.expiresAt || Date.now() + 3000) - Date.now());
        setTimeout(() => broadcastAll(info.roomCode, 'MARKER_REMOVED', { markerId: marker.id }), delay);
        break;
      }

      // ── REMOVE_MARKER ─────────────────────────────────────────────────────
      case 'REMOVE_MARKER': {
        if (!info) break;
        broadcast(info.roomCode, 'MARKER_REMOVED', { markerId: payload.markerId }, ws);
        break;
      }

      // ── REQUEST_SNAPSHOT ──────────────────────────────────────────────────
      case 'REQUEST_SNAPSHOT': {
        if (!info) break;
        const room = getRoom(info.roomCode);
        if (room) send(ws, 'SNAPSHOT', { snapshot: snapshot(room) });
        break;
      }

      // ── PING ──────────────────────────────────────────────────────────────
      case 'PING': {
        send(ws, 'PONG', { ts: Date.now() });
        break;
      }

      default:
        console.warn(`[WS] Événement inconnu : ${type}`);
    }
  });

  ws.on('close', () => {
    const info = getInfo(ws);
    if (info?.roomCode) {
      const room = getRoom(info.roomCode);
      if (room) {
        const player = room.players.find(p => p.id === info.playerId);
        if (player) {
          player.online = false;
          broadcast(info.roomCode, 'PLAYER_LEFT', { playerId: info.playerId });
          // Cleanup si personne n'est en ligne
          if (room.players.every(p => !p.online)) scheduleRoomCleanup(info.roomCode);
        }
      }
    }
    sockets.delete(ws);
    console.log(`[WS] Déconnexion. Clients restants : ${sockets.size}`);
  });

  ws.on('error', (err) => console.warn('[WS] Erreur socket:', err.message));
});

server.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Chroniques Oubliées — Serveur Phase 3 ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`  HTTP : http://localhost:${PORT}/health`);
  console.log(`  WS   : ws://localhost:${PORT}`);
  console.log('  Dans l\'app : entrez l\'URL WS et cliquez ⚡\n');
});
