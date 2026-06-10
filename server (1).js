const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ─── Game Config ────────────────────────────────────────────────────────────
const TRACK_LENGTH = 100;   // arbitrary units
const RACE_COUNTDOWN = 3;   // seconds
const FINISH_DELAY = 5000;  // ms after first finish before showing results

const SKINS = [
  { id: 'classic',   emoji: '🫏', name: 'کلاسیک',       color: '#7c6bff' },
  { id: 'swift',     emoji: '🐴', name: 'تندرو',        color: '#ff6b6b' },
  { id: 'wild',      emoji: '🦓', name: 'وحشی',         color: '#6bffb8' },
  { id: 'golden',    emoji: '🌟', name: 'طلایی',        color: '#ffd700' },
  { id: 'shadow',    emoji: '🖤', name: 'سایه',         color: '#9b59b6' },
  { id: 'fire',      emoji: '🔥', name: 'آتشین',        color: '#ff4500' },
];

const PRIZES = [
  { rank: 1, icon: '🥇', label: 'قهرمان!',     coins: 100 },
  { rank: 2, icon: '🥈', label: 'نقره‌ای!',    coins: 60  },
  { rank: 3, icon: '🥉', label: 'برنزی!',      coins: 30  },
  { rank: 4, icon: '4️⃣', label: 'چهارم!',      coins: 10  },
  { rank: 5, icon: '5️⃣', label: 'پنجم!',       coins: 5   },
  { rank: 6, icon: '💀', label: 'آخر!',         coins: 0   },
];

// ─── State ───────────────────────────────────────────────────────────────────
let rooms = {};   // roomId -> RoomState
let clients = {}; // socketId -> { ws, roomId, playerId }

function createRoom(roomId) {
  return {
    id: roomId,
    phase: 'lobby',   // lobby | countdown | racing | finished
    players: {},      // playerId -> PlayerState
    finishOrder: [],
    countdownTimer: null,
    finishTimer: null,
    tickInterval: null,
    startTime: null,
  };
}

function createPlayer(id, name, skinId) {
  return {
    id,
    name: name || 'ناشناس',
    skin: SKINS.find(s => s.id === skinId) || SKINS[0],
    position: 0,
    lane: 0,
    finished: false,
    rank: null,
    coins: 0,
    swipeBuffer: 0,
    lastSwipeTime: 0,
    connected: true,
  };
}

// ─── WebSocket Handshake (RFC 6455) ──────────────────────────────────────────
function wsHandshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
}

function parseFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) { payloadLen = buffer.readUInt16BE(2); offset = 4; }
  else if (payloadLen === 127) { payloadLen = Number(buffer.readBigUInt64BE(2)); offset = 10; }

  if (buffer.length < offset + (masked ? 4 : 0) + payloadLen) return null;

  let payload;
  if (masked) {
    const mask = buffer.slice(offset, offset + 4);
    offset += 4;
    payload = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) payload[i] = buffer[offset + i] ^ mask[i % 4];
  } else {
    payload = buffer.slice(offset, offset + payloadLen);
  }
  return { opcode, payload };
}

function buildFrame(data) {
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; header[1] = len;
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

function sendTo(socket, msg) {
  try { socket.write(buildFrame(JSON.stringify(msg))); } catch(e) {}
}

function broadcast(roomId, msg, excludeId) {
  const room = rooms[roomId];
  if (!room) return;
  Object.values(clients).forEach(c => {
    if (c.roomId === roomId && c.socketId !== excludeId) sendTo(c.ws, msg);
  });
}

function broadcastAll(roomId, msg) {
  broadcast(roomId, msg, null);
}

// ─── Game Logic ──────────────────────────────────────────────────────────────
function assignLanes(room) {
  const players = Object.values(room.players);
  players.forEach((p, i) => { p.lane = i; p.position = 0; p.finished = false; p.rank = null; p.swipeBuffer = 0; });
}

function startCountdown(room) {
  room.phase = 'countdown';
  broadcastAll(room.id, { type: 'phase', phase: 'countdown', countdown: RACE_COUNTDOWN });

  let n = RACE_COUNTDOWN;
  const tick = () => {
    broadcastAll(room.id, { type: 'countdown', n });
    n--;
    if (n < 0) {
      startRace(room);
    } else {
      room.countdownTimer = setTimeout(tick, 1000);
    }
  };
  room.countdownTimer = setTimeout(tick, 100);
}

function startRace(room) {
  room.phase = 'racing';
  room.startTime = Date.now();
  room.finishOrder = [];
  broadcastAll(room.id, { type: 'phase', phase: 'racing' });
  broadcastState(room);

  // Game tick ~30fps
  room.tickInterval = setInterval(() => {
    broadcastState(room);
  }, 33);
}

function broadcastState(room) {
  const players = Object.values(room.players).map(p => ({
    id: p.id, name: p.name, skin: p.skin,
    position: p.position, lane: p.lane,
    finished: p.finished, rank: p.rank,
  }));
  broadcastAll(room.id, { type: 'state', players, finishOrder: room.finishOrder });
}

function handleSwipe(room, playerId, direction) {
  if (room.phase !== 'racing') return;
  const player = room.players[playerId];
  if (!player || player.finished) return;

  const now = Date.now();
  const timeSinceLast = now - player.lastSwipeTime;
  // boost: fast swipes give more speed
  let boost = direction === 'right' ? 2.5 : (direction === 'left' ? 1.2 : 1.5);
  // rapid swipe bonus
  if (timeSinceLast < 300) boost *= 1.3;
  player.lastSwipeTime = now;

  player.position = Math.min(TRACK_LENGTH, player.position + boost);

  if (player.position >= TRACK_LENGTH && !player.finished) {
    player.finished = true;
    player.position = TRACK_LENGTH;
    room.finishOrder.push(playerId);
    const rank = room.finishOrder.length;
    player.rank = rank;
    const prize = PRIZES[Math.min(rank - 1, PRIZES.length - 1)];
    player.coins = prize.coins;

    broadcastAll(room.id, {
      type: 'finish',
      playerId, rank,
      prize,
      finishOrder: room.finishOrder,
    });

    // check if all finished
    const total = Object.values(room.players).filter(p => p.connected).length;
    if (room.finishOrder.length >= total) {
      endRace(room);
    } else if (room.finishOrder.length === 1) {
      // start finish timer
      room.finishTimer = setTimeout(() => endRace(room), FINISH_DELAY);
    }
  }
}

function endRace(room) {
  clearInterval(room.tickInterval);
  clearTimeout(room.finishTimer);
  room.phase = 'finished';

  // assign remaining ranks
  const unfinished = Object.values(room.players).filter(p => !p.finished && p.connected);
  unfinished.sort((a, b) => b.position - a.position);
  unfinished.forEach(p => {
    room.finishOrder.push(p.id);
    p.rank = room.finishOrder.length;
    p.finished = true;
    const prize = PRIZES[Math.min(p.rank - 1, PRIZES.length - 1)];
    p.coins = prize.coins;
  });

  const results = room.finishOrder.map((pid, i) => {
    const p = room.players[pid];
    const prize = PRIZES[Math.min(i, PRIZES.length - 1)];
    return { id: pid, name: p?.name, skin: p?.skin, rank: i + 1, coins: p?.coins || 0, prize };
  });

  broadcastAll(room.id, { type: 'phase', phase: 'finished', results });

  // reset room after delay for rematch
  setTimeout(() => resetRoom(room), 10000);
}

function resetRoom(room) {
  clearInterval(room.tickInterval);
  clearTimeout(room.finishTimer);
  clearTimeout(room.countdownTimer);
  room.phase = 'lobby';
  room.finishOrder = [];
  Object.values(room.players).forEach(p => {
    p.position = 0; p.finished = false; p.rank = null; p.coins = 0;
  });
  broadcastAll(room.id, { type: 'phase', phase: 'lobby' });
  broadcastAll(room.id, { type: 'lobby', players: getLobbyPlayers(room) });
}

function getLobbyPlayers(room) {
  return Object.values(room.players).filter(p => p.connected).map(p => ({
    id: p.id, name: p.name, skin: p.skin,
  }));
}

// ─── Message Handler ─────────────────────────────────────────────────────────
function handleMessage(socketId, msg) {
  const client = clients[socketId];
  let data;
  try { data = JSON.parse(msg); } catch { return; }

  if (data.type === 'join') {
    const roomId = data.roomId || 'main';
    if (!rooms[roomId]) rooms[roomId] = createRoom(roomId);
    const room = rooms[roomId];

    const playerId = socketId;
    const player = createPlayer(playerId, data.name, data.skinId);
    room.players[playerId] = player;
    client.roomId = roomId;
    client.playerId = playerId;

    sendTo(client.ws, {
      type: 'joined',
      playerId,
      roomId,
      skins: SKINS,
      phase: room.phase,
      players: getLobbyPlayers(room),
    });

    broadcast(roomId, {
      type: 'playerJoined',
      player: { id: playerId, name: player.name, skin: player.skin },
      players: getLobbyPlayers(room),
    }, socketId);

    console.log(`[${roomId}] ${player.name} joined (${Object.keys(room.players).length} players)`);
    return;
  }

  if (!client.roomId) return;
  const room = rooms[client.roomId];
  if (!room) return;
  const playerId = client.playerId;

  if (data.type === 'changeSkin') {
    const skin = SKINS.find(s => s.id === data.skinId);
    if (skin && room.players[playerId]) {
      room.players[playerId].skin = skin;
      broadcastAll(room.id, { type: 'lobby', players: getLobbyPlayers(room) });
    }
  }

  if (data.type === 'ready') {
    if (room.phase === 'lobby') {
      const connected = Object.values(room.players).filter(p => p.connected);
      if (connected.length >= 1) {
        assignLanes(room);
        startCountdown(room);
      }
    }
  }

  if (data.type === 'swipe') {
    handleSwipe(room, playerId, data.direction);
  }

  if (data.type === 'rematch') {
    if (room.phase === 'finished') resetRoom(room);
  }
}

function handleDisconnect(socketId) {
  const client = clients[socketId];
  if (!client) return;
  const { roomId, playerId } = client;
  if (roomId && rooms[roomId] && playerId) {
    const room = rooms[roomId];
    if (room.players[playerId]) room.players[playerId].connected = false;
    broadcast(roomId, { type: 'playerLeft', playerId, players: getLobbyPlayers(room) }, null);
    // cleanup empty rooms
    const active = Object.values(room.players).filter(p => p.connected).length;
    if (active === 0) {
      clearInterval(room.tickInterval);
      clearTimeout(room.finishTimer);
      clearTimeout(room.countdownTimer);
      delete rooms[roomId];
    }
  }
  delete clients[socketId];
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

// ─── WebSocket Upgrade ────────────────────────────────────────────────────────
let socketCounter = 0;
server.on('upgrade', (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  wsHandshake(req, socket);

  const socketId = 'S' + (++socketCounter);
  clients[socketId] = { ws: socket, socketId, roomId: null, playerId: null };

  let buffer = Buffer.alloc(0);

  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      const frame = parseFrame(buffer);
      if (!frame) break;
      // recalculate consumed bytes
      const payloadLen = frame.payload.length;
      let headerLen = 2;
      const rawLen = buffer[1] & 0x7f;
      if (rawLen === 126) headerLen = 4;
      else if (rawLen === 127) headerLen = 10;
      const masked = (buffer[1] & 0x80) !== 0;
      if (masked) headerLen += 4;
      buffer = buffer.slice(headerLen + payloadLen);

      if (frame.opcode === 8) { socket.destroy(); return; } // close
      if (frame.opcode === 9) { // ping
        const pong = Buffer.alloc(2); pong[0] = 0x8a; pong[1] = 0;
        try { socket.write(pong); } catch(e) {}
        continue;
      }
      if (frame.opcode === 1 || frame.opcode === 2) {
        handleMessage(socketId, frame.payload.toString());
      }
    }
  });

  socket.on('close', () => handleDisconnect(socketId));
  socket.on('error', () => handleDisconnect(socketId));
});

server.listen(PORT, () => {
  console.log(`🫏 Donkey Race Server running on http://0.0.0.0:${PORT}`);
  console.log(`   Share this link: http://YOUR_VPS_IP:${PORT}`);
});
