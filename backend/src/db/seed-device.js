// Register a device and issue its token. The token is stored HASHED; the
// plaintext is printed once here so you can enter it on the device.
//   npm run seed:device -- --device-id classroom-01 --room ROOM-1 [--token <t>]
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function run() {
  const deviceId = arg('device-id', 'classroom-01');
  const room = arg('room', config.defaultRoomId);
  let token = arg('token', '');
  if (!token) token = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await db.query(
    `INSERT INTO devices (device_id, name, room_id, token_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (device_id)
     DO UPDATE SET room_id = EXCLUDED.room_id, token_hash = EXCLUDED.token_hash`,
    [deviceId, deviceId, room, tokenHash]
  );

  console.log('Device registered:');
  console.log('  device_id:', deviceId);
  console.log('  room_id  :', room);
  console.log('  token    :', token);
  console.log('Enter this token on the device provisioning page.');
  console.log('It is stored hashed; this is the only time the plaintext is shown.');
}

run()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error('[seed:device] failed:', err.message);
    process.exitCode = 1;
    db.pool.end();
  });