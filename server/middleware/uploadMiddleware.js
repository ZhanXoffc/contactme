const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config/config');
const db = require('../models/db');
const { isExtensionAllowed } = require('../utils/fileValidator');

// Pastikan folder upload ada
if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  }
});

function fileFilter(req, file, cb) {
  if (!isExtensionAllowed(file.originalname)) {
    return cb(new Error('Format file tidak diizinkan atau berpotensi membahayakan.'));
  }
  cb(null, true);
}

function getMaxFileSize() {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'max_file_size_mb'").get();
    if (row && row.value) {
      return parseInt(row.value, 10) * 1024 * 1024;
    }
  } catch (err) {
    // fallback
  }
  return config.maxFileSizeMb * 1024 * 1024;
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024,
    files: 10 // maksimal 10 file sekaligus
  }
});

module.exports = upload;
