/**
 * CHRONIQUES OUBLIÉES — Serveur WebSocket Phase 3
 * SANS DÉPENDANCES EXTERNES — Node.js natif uniquement
 *
 * Usage : node server.js
 * WS:    ws://localhost:3000
 * HTTP:  http://localhost:3000/health
 */

'use strict';
const http   = require('http');
const crypto = require('crypto');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════════════════════════
//  WEBSOCKET FRAMING — Implémentation native (pas besoin du module 'ws')
// ══════════════════════════════════════════════════════════════════════════════

function wsAcceptKey(key) {
  return crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

/** Parse tous les frames WebSocket disponibles dans un Buffer */
function parseFrames(buf) {
  const messages = [];
  let pos = 0;
  while (pos + 2 <= buf.length) {
    const b0 = buf[pos], b1 = buf[pos + 1];
    const opcode = b0 & 0x0f;
    const masked  = !!(b1 & 0x80);
    let payLen = b1 & 0x7f;
    let hLen = 2;

    if (payLen === 126) {
      if (pos + 4 > buf.length) break;
      payLen = buf.readUInt16BE(pos + 2);
      hLen = 4;
    } else if (payLen === 127) {
      if (pos + 10 > buf.length) break;
      payLen = Number(buf.readBigUInt64BE(pos + 2));
      hLen = 10;
    }

    const maskStart = masked ? pos + hLen : -1;
    if (masked) hLen += 4;

    if (pos + hLen + payLen > buf.length) break;

    let payload = Buffer.from(buf.slice(pos + hLen, pos + hLen + payLen));
    if (masked) {
      for (let i = 0; i < payload.length; i++)
        payload[i] ^= buf[maskStart + (i % 4)];
    }

    if      (opcode === 0x1) messages.push({ type: 'text',  data: payload.toString('utf8') });
    else if (opcode === 0x2) messages.push({ type: 'binary',data: payload });
    else if (opcode === 0x8) messages.push({ type: 'close' });
    else if (opcode === 0x9) messages.push({ type: 'ping' });
    else if (opcode === 0xa) messages.push({ type: 'pong' });

    pos += hLen + payLen;
  }
  return { messages, consumed: pos };
}

/** Encode un message texte en frame WebSocket */
function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

const FRAME_CLOSE = Buffer.from([0x88, 0x00]);
const FRAME_PONG  = Buffer.from([0x8a, 0x00]);

// ══════════════════════════════════════════════════════════════════════════════
//  WS CONNECTION WRAPPER
// ══════════════════════════════════════════════════════════════════════════════

class WSClient {
  constructor(socket) {
    this.socket    = socket;
    this.readyState = 1; // OPEN
    this._buf      = Buffer.alloc(0);
    this._handlers = {};

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close',  () => this._close());
    socket.on('error',  () => this._close());
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    const { messages, consumed } = parseFrames(this._buf);
    this._buf = this._buf.slice(consumed);
    for (const f of messages) {
      if (f.type === 'text')  this._fire('message', f.data);
      if (f.type === 'ping')  { try { this.socket.write(FRAME_PONG); } catch(_) {} }
      if (f.type === 'close') { this._close(); }
    }
  }

  _close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    try { this.socket.write(FRAME_CLOSE); } catch(_) {}
    try { this.socket.destroy(); } catch(_) {}
    this._fire('close', {});
  }

  _fire(event, data) {
    (this._handlers[event] || []).forEach(fn => { try { fn(data); } catch(e) { console.warn('[handler error]', e.message); } });
  }

  on(event, fn) { (this._handlers[event] = this._handlers[event] || []).push(fn); return this; }

  send(type, payload = {}) {
    if (this.readyState !== 1) return;
    try { this.socket.write(encodeFrame(JSON.stringify({ type, payload }))); } catch(_) {}
  }

  close() { this._close(); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ÉTAT EN MÉMOIRE
// ══════════════════════════════════════════════════════════════════════════════

const rooms   = new Map(); // roomCode → Room
const clients = new Map(); // WSClient → ClientInfo { playerId, roomCode, playerName, role }

function generateCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 3; i++) c += L[Math.floor(Math.random() * L.length)];
  c += '-';
  for (let i = 0; i < 4; i++) c += Math.floor(Math.random() * 10);
  return rooms.has(c) ? generateCode() : c;
}

function newRoom(code, hostPlayerId, hostName, maxPlayers, initialState = {}) {
  return {
    code, id: 'room-' + Date.now(),
    hostPlayerId,
    players: [{ id: hostPlayerId, name: hostName, role: 'mj', online: true }],
    maxPlayers: maxPlayers || 4,
    state: {
      tokens:          initialState.tokens         || [],
      currentSceneId:  initialState.currentSceneId || null,
      fogData:         initialState.fogData        || {},
      fogEnabled:      !!initialState.fogEnabled,
      combatActive: false, currentTurn: 0, round: 0,
      initiativeOrder: [], chatMessages: [], markers: [],
    },
    createdAt: Date.now(),
  };
}

function snapshot(room) {
  return {
    roomCode:        room.code,
    hostPlayerId:    room.hostPlayerId,
    players:         room.players,
    tokens:          room.state.tokens,
    currentSceneId:  room.state.currentSceneId,
    fogData:         room.state.fogData,
    fogEnabled:      room.state.fogEnabled,
    combatActive:    room.state.combatActive,
    initiativeOrder: room.state.initiativeOrder,
    currentTurn:     room.state.currentTurn,
    round:           room.state.round,
    chatMessages:    room.state.chatMessages,
    markers:         room.state.markers,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  BROADCAST HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function broadcastRoom(roomCode, type, payload, excludeClient = null) {
  for (const [c, info] of clients) {
    if (info.roomCode === roomCode && c !== excludeClient && c.readyState === 1) {
      c.send(type, payload);
    }
  }
}

function broadcastAll(roomCode, type, payload) {
  for (const [c, info] of clients) {
    if (info.roomCode === roomCode && c.readyState === 1) {
      c.send(type, payload);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  SERVEUR HTTP (health check + CORS pour WebSocket)
// ══════════════════════════════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      clients: clients.size,
      uptime: Math.round(process.uptime()),
      node: process.version,
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Chroniques Oubliées — Serveur VTT Phase 3\n' +
            `Salles actives : ${rooms.size} | Clients : ${clients.size}\n`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  UPGRADE HTTP → WEBSOCKET
// ══════════════════════════════════════════════════════════════════════════════

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers['upgrade']?.toLowerCase() !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + wsAcceptKey(key),
    '', ''
  ].join('\r\n'));

  const client = new WSClient(socket);
  console.log(`[+] Client connecté. Total: ${clients.size + 1}`);

  client.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg?.type) return;
    handleMessage(client, msg.type, msg.payload || {});
  });

  client.on('close', () => {
    const info = clients.get(client);
    if (info?.roomCode) {
      const room = rooms.get(info.roomCode);
      if (room) {
        const player = room.players.find(p => p.id === info.playerId);
        if (player) player.online = false;
        broadcastRoom(info.roomCode, 'PLAYER_LEFT', { playerId: info.playerId });
        // Nettoyage salle vide après 30 min
        const online = room.players.filter(p => p.online).length;
        if (online === 0) {
          setTimeout(() => {
            const r = rooms.get(info.roomCode);
            if (r && r.players.every(p => !p.online)) {
              rooms.delete(info.roomCode);
              console.log(`[Room] Supprimée: ${info.roomCode}`);
            }
          }, 30 * 60 * 1000);
        }
      }
    }
    clients.delete(client);
    console.log(`[-] Client déconnecté. Total: ${clients.size}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GESTIONNAIRE DE MESSAGES
// ══════════════════════════════════════════════════════════════════════════════

function handleMessage(client, type, payload) {
  const info = clients.get(client);
  const isMJ = info?.role === 'mj';

  // ── CREATE_ROOM ────────────────────────────────────────────────────────────
  if (type === 'CREATE_ROOM') {
    const playerId = payload.playerId || randomUUID();
    const name     = payload.playerName || 'Maître du Jeu';
    const code     = generateCode();
    const room     = newRoom(code, playerId, name, payload.maxPlayers, payload.initialState);
    rooms.set(code, room);
    clients.set(client, { playerId, roomCode: code, playerName: name, role: 'mj' });
    client.send('ROOM_CREATED', { roomCode: code, roomId: room.id, playerId });
    console.log(`[Room] Créée: ${code} par "${name}"`);
    return;
  }

  // ── JOIN_ROOM ──────────────────────────────────────────────────────────────
  if (type === 'JOIN_ROOM') {
    const code = (payload.roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      client.send('ROOM_ERROR', { message: `Salle "${code}" introuvable. Vérifiez le code.` });
      return;
    }
    const onlineCount = room.players.filter(p => p.online).length;
    if (onlineCount >= room.maxPlayers) {
      client.send('ROOM_ERROR', { message: `Salle "${code}" complète (${room.maxPlayers} joueurs max).` });
      return;
    }
    const playerId = payload.playerId || randomUUID();
    const pName    = payload.playerName || 'Aventurier';
    let player     = room.players.find(p => p.id === playerId);
    if (player) {
      player.online = true;
      player.name   = pName;
    } else {
      player = { id: playerId, name: pName, role: 'joueur', online: true };
      room.players.push(player);
    }
    clients.set(client, { playerId, roomCode: code, playerName: pName, role: player.role });
    client.send('ROOM_JOINED', { snapshot: snapshot(room), playerId });
    broadcastRoom(code, 'PLAYER_JOINED', { player }, client);
    console.log(`[Room] "${pName}" rejoint ${code}`);
    return;
  }

  // ── REJOIN_ROOM ────────────────────────────────────────────────────────────
  if (type === 'REJOIN_ROOM') {
    const code = (payload.roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      client.send('ROOM_ERROR', { message: `Salle "${code}" expirée ou introuvable.` });
      return;
    }
    const playerId = payload.playerId || randomUUID();
    const pName    = payload.playerName || 'Joueur';
    let player     = room.players.find(p => p.id === playerId);
    if (player) {
      player.online = true;
    } else {
      player = { id: playerId, name: pName, role: payload.role || 'joueur', online: true };
      room.players.push(player);
    }
    clients.set(client, { playerId, roomCode: code, playerName: pName, role: player.role });
    client.send('SNAPSHOT', { snapshot: snapshot(room) });
    broadcastRoom(code, 'PLAYER_JOINED', { player }, client);
    console.log(`[Room] Reconnexion de "${pName}" dans ${code}`);
    return;
  }

  // Toutes les actions suivantes nécessitent d'être dans une salle
  if (!info?.roomCode) return;
  const room = rooms.get(info.roomCode);
  if (!room) return;

  // ── MOVE_TOKEN ─────────────────────────────────────────────────────────────
  if (type === 'MOVE_TOKEN') {
    const { tokenId, x, y } = payload;
    const tok = room.state.tokens.find(t => t.id === tokenId);
    if (!tok) return;
    if (!isMJ && tok.ownerPlayerId !== info.playerId) return; // permission
    tok.x = x; tok.y = y;
    broadcastRoom(info.roomCode, 'TOKEN_MOVED', { tokenId, x, y, playerId: info.playerId }, client);
    return;
  }

  // ── UPSERT_TOKEN ────────────────────────────────────────────────────────────
  if (type === 'UPSERT_TOKEN') {
    if (!isMJ) return;
    const tok = payload.token;
    if (!tok?.id) return;
    const idx = room.state.tokens.findIndex(t => t.id === tok.id);
    if (idx >= 0) Object.assign(room.state.tokens[idx], tok);
    else room.state.tokens.push(tok);
    broadcastRoom(info.roomCode, 'TOKEN_UPSERTED', { token: tok, playerId: info.playerId }, client);
    return;
  }

  // ── DELETE_TOKEN ────────────────────────────────────────────────────────────
  if (type === 'DELETE_TOKEN') {
    if (!isMJ) return;
    room.state.tokens = room.state.tokens.filter(t => t.id !== payload.tokenId);
    broadcastRoom(info.roomCode, 'TOKEN_DELETED', { tokenId: payload.tokenId, playerId: info.playerId }, client);
    return;
  }

  // ── ASSIGN_TOKEN_OWNER ──────────────────────────────────────────────────────
  if (type === 'ASSIGN_TOKEN_OWNER') {
    if (!isMJ) return;
    const { tokenId, ownerPlayerId } = payload;
    const tok = room.state.tokens.find(t => t.id === tokenId);
    if (tok) tok.ownerPlayerId = ownerPlayerId;
    const pl = room.players.find(p => p.id === ownerPlayerId);
    if (pl) pl.controlledTokenId = tokenId;
    broadcastAll(info.roomCode, 'TOKEN_OWNER_ASSIGNED', { tokenId, ownerPlayerId });
    return;
  }

  // ── UPDATE_TOKEN_HP ─────────────────────────────────────────────────────────
  if (type === 'UPDATE_TOKEN_HP') {
    const { tokenId, hp } = payload;
    const tok = room.state.tokens.find(t => t.id === tokenId);
    if (tok && (isMJ || tok.ownerPlayerId === info.playerId)) {
      tok.hp = hp;
      broadcastRoom(info.roomCode, 'TOKEN_HP_UPDATED', { tokenId, hp, playerId: info.playerId }, client);
    }
    return;
  }

  // ── UPDATE_PLAYER ────────────────────────────────────────────────────────────
  if (type === 'UPDATE_PLAYER') {
    const upd = payload.player;
    if (!upd) return;
    const targetId = upd.id || info.playerId;
    if (!isMJ && targetId !== info.playerId) return; // can't update others
    const pl = room.players.find(p => p.id === targetId);
    if (pl) {
      if (upd.character !== undefined) pl.character = upd.character;
      if (upd.name      !== undefined) pl.name      = upd.name;
      if (upd.color     !== undefined) pl.color      = upd.color;
      broadcastAll(info.roomCode, 'PLAYER_UPDATED', { player: pl });
      console.log(`[Player] "${pl.name}" mis à jour dans ${info.roomCode}`);
    }
    return;
  }

  // ── CHANGE_SCENE ────────────────────────────────────────────────────────────
  if (type === 'CHANGE_SCENE') {
    if (!isMJ) return;
    room.state.currentSceneId = payload.sceneId;
    broadcastRoom(info.roomCode, 'SCENE_CHANGED', { sceneId: payload.sceneId, playerId: info.playerId }, client);
    return;
  }

  // ── UPDATE_FOG ──────────────────────────────────────────────────────────────
  if (type === 'UPDATE_FOG') {
    if (!isMJ) return;
    if (payload.fogData    !== undefined) room.state.fogData    = payload.fogData;
    if (payload.fogEnabled !== undefined) room.state.fogEnabled = payload.fogEnabled;
    broadcastRoom(info.roomCode, 'FOG_UPDATED', {
      fogData: room.state.fogData, fogEnabled: room.state.fogEnabled, playerId: info.playerId,
    }, client);
    return;
  }

  // ── UPDATE_COMBAT ────────────────────────────────────────────────────────────
  if (type === 'UPDATE_COMBAT') {
    if (!isMJ) return;
    const s = room.state;
    if (payload.combatActive    !== undefined) s.combatActive    = payload.combatActive;
    if (payload.initiativeOrder !== undefined) s.initiativeOrder = payload.initiativeOrder;
    if (payload.currentTurn     !== undefined) s.currentTurn     = payload.currentTurn;
    if (payload.round           !== undefined) s.round           = payload.round;
    broadcastRoom(info.roomCode, 'COMBAT_UPDATED', { ...payload, playerId: info.playerId }, client);
    return;
  }

  // ── SEND_CHAT ────────────────────────────────────────────────────────────────
  if (type === 'SEND_CHAT') {
    const message = {
      id:         'msg-' + Date.now() + '-' + Math.floor(Math.random() * 99999),
      playerId:   info.playerId,
      authorName: info.playerName || 'Joueur',
      role:       info.role       || 'joueur',
      text:       String(payload.text || '').slice(0, 500),
      timestamp:  Date.now(),
    };
    room.state.chatMessages.push(message);
    if (room.state.chatMessages.length > 300)
      room.state.chatMessages = room.state.chatMessages.slice(-300);
    broadcastAll(info.roomCode, 'CHAT_MESSAGE', { message }); // inclut l'expéditeur
    return;
  }

  // ── PLACE_MARKER ────────────────────────────────────────────────────────────
  if (type === 'PLACE_MARKER') {
    const marker = { ...payload.marker, placedBy: info.playerId };
    broadcastRoom(info.roomCode, 'MARKER_PLACED', { marker }, client);
    const delay = Math.max(100, (marker.expiresAt || Date.now() + 3000) - Date.now());
    setTimeout(() => broadcastAll(info.roomCode, 'MARKER_REMOVED', { markerId: marker.id }), delay);
    return;
  }

  // ── REQUEST_SNAPSHOT ─────────────────────────────────────────────────────────
  if (type === 'REQUEST_SNAPSHOT') {
    client.send('SNAPSHOT', { snapshot: snapshot(room) });
    return;
  }

  // ── CLOSE_ROOM ───────────────────────────────────────────────────────────────
  if (type === 'CLOSE_ROOM') {
    if (!isMJ) return;
    broadcastRoom(info.roomCode, 'ROOM_CLOSED', { message: 'Le MJ a fermé la salle.' }, client);
    rooms.delete(info.roomCode);
    console.log(`[Room] Fermée par MJ: ${info.roomCode}`);
    return;
  }

  // ── PING ─────────────────────────────────────────────────────────────────────
  if (type === 'PING') {
    client.send('PONG', { ts: Date.now() });
    return;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  DÉMARRAGE
// ══════════════════════════════════════════════════════════════════════════════

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n⚔  Chroniques Oubliées — Serveur VTT Phase 3');
  console.log(`   Node:    ${process.version}`);
  console.log(`   HTTP:    http://localhost:${PORT}/health`);
  console.log(`   WS:      ws://localhost:${PORT}`);
  console.log(`   Réseau:  ws://<votre-ip>:${PORT}`);
  console.log('\n   Aucune dépendance externe requise.\n');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} déjà utilisé. Changez PORT=XXXX node server.js\n`);
  } else {
    console.error('Erreur serveur:', e.message);
  }
  process.exit(1);
});
