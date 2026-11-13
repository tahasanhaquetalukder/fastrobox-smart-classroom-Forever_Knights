const express = require('express');
const db = require('../db');
const { anyAuth, roomIdsForUser } = require('../middleware/userAuth');
const { bus } = require('../services/eventBus');

const router = express.Router();

async function streamScope(req) {
  const user = req.user;
  if (!user) return { all: true }; // legacy read/admin token
  if (user.role === 'admin') return { all: true };
  if (user.role === 'student') return { all: false, studentId: user.id, rooms: [] };
  if (user.role === 'guardian') {
    const { rows } = await db.query('SELECT student_id FROM guardian_links WHERE guardian_id = $1', [user.id]);
    return { all: false, studentIds: rows.map((r) => r.student_id), rooms: [] };
  }
  return { all: false, rooms: await roomIdsForUser(user) };
}

function allowed(scope, message) {
  if (scope.all) return true;
  const data = message.data || {};
  if (message.type === 'attendance') {
    if (scope.studentId) return Number(data.user_id) === Number(scope.studentId);
    if (scope.studentIds) return scope.studentIds.map(Number).includes(Number(data.user_id));
    return scope.rooms.includes(data.room_id);
  }
  if (scope.studentId || scope.studentIds) return false;
  if (data.room_id) return scope.rooms.includes(data.room_id);
  return false;
}

// GET /api/stream — Server-Sent Events feed for the live dashboard.
router.get('/', anyAuth, async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const scope = await streamScope(req).catch(() => ({ all: false, rooms: [] }));

  const send = (msg) => {
    if (!allowed(scope, msg)) return;
    res.write(`event: ${msg.type}\n`);
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };
  const onMsg = (msg) => send(msg);
  bus.on('message', onMsg);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  send({ type: 'hello', data: { ok: true }, ts: Date.now() });

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('message', onMsg);
  });
});

module.exports = router;
