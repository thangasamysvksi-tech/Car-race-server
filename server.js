// Car Race 3D multiplayer server (Node.js + Socket.io)
// Players create a room code; friends join with that code.
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Car Race 3D multiplayer server is running');
});
const io = new Server(httpServer, { cors: { origin: '*' }, maxHttpBufferSize: 1e5 });

const rooms = new Map();   // code -> Map(socketId -> presence object)
const timers = new Map();  // code -> pending broadcast timer

const genCode = () => {
  let c;
  do { c = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X'); }
  while (rooms.has(c));
  return c;
};

const clean = (p) => {
  try {
    const s = JSON.stringify(p || {});
    return s.length > 2000 ? {} : JSON.parse(s);
  } catch (e) { return {}; }
};

// send the full room state to everyone (max ~30 times per second per room)
function broadcast(code) {
  if (timers.has(code)) return;
  timers.set(code, setTimeout(() => {
    timers.delete(code);
    const room = rooms.get(code);
    if (!room) return;
    io.to(code).emit('peers', [...room.entries()].map(([id, p]) => ({ id, p })));
  }, 33));
}

io.on('connection', (socket) => {
  let code = null;

  const enter = (c, p) => {
    code = c;
    socket.join(c);
    rooms.get(c).set(socket.id, clean(p));
    broadcast(c);
  };

  // host creates a room (custom code optional)
  socket.on('create', (d, ack) => {
    if (typeof ack !== 'function') return;
    let c = String((d && d.code) || '').toUpperCase();
    if (c) {
      if (!/^[A-Z0-9]{3,8}$/.test(c)) return ack({ ok: false, err: 'Code 3-8 letters/numbers' });
      if (rooms.has(c)) return ack({ ok: false, err: 'Code already used' });
    } else {
      c = genCode();
    }
    rooms.set(c, new Map());
    enter(c, d && d.p);
    ack({ ok: true, code: c });
  });

  // friends join with the code
  socket.on('join', (d, ack) => {
    if (typeof ack !== 'function') return;
    const c = String((d && d.code) || '').toUpperCase();
    const room = rooms.get(c);
    if (!room) return ack({ ok: false, err: 'Room illa' });
    if (room.size >= MAX_PLAYERS) return ack({ ok: false, err: 'Room full' });
    enter(c, d && d.p);
    ack({ ok: true, code: c });
  });

  // player state (position, lap, name, car...)
  socket.on('p', (p) => {
    const room = code && rooms.get(code);
    if (room && room.has(socket.id)) {
      room.set(socket.id, clean(p));
      broadcast(code);
    }
  });

  socket.on('disconnect', () => {
    const room = code && rooms.get(code);
    if (!room) return;
    room.delete(socket.id);
    if (room.size === 0) rooms.delete(code);
    else broadcast(code);
  });
});

httpServer.listen(PORT, () => console.log('Listening on port ' + PORT));
