// Issue a random per-device token. The plaintext is printed once for manual
// provisioning; only its SHA-256 hash is stored.
//   npm run seed:device -- --device-id classroom-01 --room ROOM-1 [--name NAME]
// Running it again for an active device rotates its token.
const db = require('../db');
const config = require('../config');
const devices = require('../services/deviceService');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].trim() : '';
}

async function run() {
  const deviceId = arg('device-id');
  const roomId = arg('room');
  if (!deviceId || !roomId) throw new Error('--device-id and --room are required');

  let result;
  try {
    result = await devices.createDevice({ deviceId, roomId, name: arg('name') });
  } catch (err) {
    if (err.status !== 409 || err.message !== 'device already exists') throw err;
    result = await devices.rotateDeviceToken(deviceId);
  }

  console.log('Device registered:');
  console.log('  device_id:', result.device.device_id);
  console.log('  room_id  :', result.device.room_id);
  console.log('  token    :', result.token);
  console.log('Enter this token on the device provisioning page.');
  console.log('It is stored hashed; this is the only time the plaintext is shown.');
}

run()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error(`[seed:device] failed: code=${err.code || 'n/a'} message=${config.redact(err.message)}`);
    process.exitCode = 1;
    db.pool.end();
  });
