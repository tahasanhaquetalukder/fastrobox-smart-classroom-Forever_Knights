const { EventEmitter } = require('events');

// In-process fan-out to SSE clients. Single-instance demo; a multi-instance
// deployment would swap this for Redis pub/sub (clean extension point).
const bus = new EventEmitter();
bus.setMaxListeners(0);

function publish(type, data) {
  bus.emit('message', { type, data, ts: Date.now() });
}

module.exports = { bus, publish };