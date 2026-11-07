const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.get('/', (_req, res) => res.send('Gorila Tag multiplayer server online.'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e5
});

const rooms = new Map();
const MAX_PLAYERS = 12;

function cleanRoom(value) {
  return String(value || 'gt-casual1').toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 48);
}
function roomPlayers(room) {
  const ids = rooms.get(room) || new Set();
  return [...ids].map(id => {
    const s = io.sockets.sockets.get(id);
    return { id, state: s?.data.playerState || {} };
  });
}
function publish(room, left = []) {
  if (!room) return;
  io.to(room).emit('room-state', { peers: roomPlayers(room), left });
}
function leaveRoom(socket) {
  const room = socket.data.room;
  if (!room) return;
  socket.leave(room);
  const ids = rooms.get(room);
  if (ids) {
    ids.delete(socket.id);
    if (!ids.size) rooms.delete(room);
  }
  socket.data.room = null;
  publish(room, [socket.id]);
}

io.on('connection', socket => {
  socket.on('join-room', data => {
    leaveRoom(socket);
    const room = cleanRoom(data?.room);
    const ids = rooms.get(room) || new Set();
    if (ids.size >= MAX_PLAYERS) {
      socket.emit('room-error', { message: 'Sala cheia (máximo de 12 jogadores).' });
      return;
    }
    rooms.set(room, ids);
    ids.add(socket.id);
    socket.data.room = room;
    socket.data.playerState = {
      n: String(data?.nick || 'Jogador').slice(0, 16),
      srv: room.replace(/^gt-/, '').toUpperCase()
    };
    socket.join(room);
    socket.emit('joined', { count: ids.size, room });
    publish(room);
  });

  socket.on('player-state', state => {
    const room = socket.data.room;
    if (!room || !state || typeof state !== 'object') return;
    const prev = socket.data.playerState || {};
    const safe = { ...prev };
    for (const key of ['x','y','z','yw']) {
      if (key in state && Number.isFinite(Number(state[key]))) safe[key] = Number(state[key]);
    }
    if (Array.isArray(state.h)) safe.h = state.h.slice(0, 6).map(v => Number(v) || 0);
    if (typeof state.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(state.c)) safe.c = state.c;
    if (state.n !== undefined) safe.n = String(state.n || 'Jogador').slice(0, 16);
    if (state.d !== undefined) safe.d = Number(state.d) || 0;
    if (state.srv !== undefined) safe.srv = String(state.srv || room).slice(0, 48);
    if (state.kk && typeof state.kk === 'object') {
      safe.kk = {
        p: String(state.kk.p || '').slice(0, 64),
        t: Number(state.kk.t) || 0,
        m: Number(state.kk.m) === 2 ? 2 : 1
      };
    }
    socket.data.playerState = safe;
    publish(room);
  });

  socket.on('chat', data => {
    const room = socket.data.room;
    if (!room || !data) return;
    const t = String(data.t || '').trim().slice(0, 200);
    if (!t) return;
    io.to(room).emit('chat', { peer: socket.id, data: {
      n: String(data.n || 'Jogador').slice(0, 16), t
    }});
  });

  socket.on('rtc', packet => {
    const room = socket.data.room;
    const to = String(packet?.to || '');
    if (!room || !to || to === socket.id) return;
    const target = io.sockets.sockets.get(to);
    if (!target || target.data.room !== room) return;
    target.emit('rtc', { peer: socket.id, data: {
      to, k: String(packet.k || '').slice(0, 2), d: packet.d
    }});
  });

  socket.on('room-error', data => { socket.emit('room-error', { message: String(data?.message || 'Erro na sala').slice(0, 120) }); });
  socket.on('leave-room', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gorila Tag multiplayer server rodando na porta ${PORT}`);
});
