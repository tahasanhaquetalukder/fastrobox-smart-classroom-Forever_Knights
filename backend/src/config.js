const path = require('path');
const dotenv = require('dotenv');

// Load .env from the repo root (backend/src -> ../../). On Render the env vars
// are already present and dotenv does not override existing process.env.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  pgSsl: String(process.env.PGSSL || 'false').toLowerCase() === 'true',
  // Optional shared bootstrap token; per-device tokens live hashed in the DB.
  deviceToken: process.env.DEVICE_TOKEN || '',
  // Optional guard for mutating dashboard routes (settings/door).
  adminToken: process.env.ADMIN_TOKEN || '',
  // Seed only; runtime-editable via /api/settings.
  defaultRoomId: process.env.DEFAULT_ROOM_ID || 'ROOM-1',
};

module.exports = config;