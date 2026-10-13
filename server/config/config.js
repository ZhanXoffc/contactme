const path = require('path');
require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'development-only-insecure-secret-do-not-deploy';
const ownerPassword = process.env.OWNER_PASSWORD || 'development-only-change-this-password';

if (nodeEnv === 'production' && (!process.env.JWT_SECRET || !process.env.OWNER_PASSWORD)) {
  throw new Error('JWT_SECRET dan OWNER_PASSWORD wajib diatur di lingkungan production.');
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  owner: {
    name: process.env.OWNER_NAME || 'Owner ZhanChat',
    email: process.env.OWNER_EMAIL || 'owner@zhanchat.local',
    password: ownerPassword,
    phone: process.env.OWNER_PHONE || '+6281234567890'
  },

  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50,
  uploadDir: path.resolve(__dirname, '..', '..', process.env.UPLOAD_DIR || 'storage/uploads'),
  databasePath: path.resolve(__dirname, '..', '..', process.env.DATABASE_PATH || 'database.sqlite'),

  iceServers: (() => {
    try {
      return JSON.parse(process.env.ICE_SERVERS || '[]');
    } catch {
      return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    }
  })()
};

module.exports = config;
