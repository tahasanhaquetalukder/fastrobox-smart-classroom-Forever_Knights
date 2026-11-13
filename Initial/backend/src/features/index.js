const express = require('express');

// Extension point for later phases/levels: camera snapshots, face recognition,
// OTA firmware history, and level-specific features. Register feature routers
// here; they are mounted under /api/features in server.js. Empty in Phase 1.
//
// Example (later phase):
//   router.use('/vision', require('./vision'));
//   router.use('/ota', require('./ota'));
const router = express.Router();

module.exports = router;