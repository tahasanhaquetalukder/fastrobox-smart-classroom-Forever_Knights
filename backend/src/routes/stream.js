const express = require('express');
const { bus } = require('../services/eventBus');

const router = express.Router();

// GET /api/stream — Server-Sent Events feed for the live dashboard.
router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const send = (msg) => {
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