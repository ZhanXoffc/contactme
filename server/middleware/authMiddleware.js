const jwt = require('jsonwebtoken');
const config = require('../config/config');
const db = require('../models/db');

function authenticateToken(req, res, next) {
  let token = null;

  if (req.cookies && req.cookies.zhanchat_token) {
    token = req.cookies.zhanchat_token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Autentikasi dibutuhkan. Silakan masuk terlebih dahulu.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT id, name, email, role, avatar, bio, phone, is_blocked FROM users WHERE id = ?').get(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Akun tidak ditemukan atau telah dihapus.' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, message: 'Akun Anda telah diblokir oleh Owner.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Sesi tidak valid atau telah kedaluwarsa.' });
  }
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({ success: false, message: 'Akses ditolak. Fitur ini hanya untuk Owner.' });
  }
  next();
}

function requireConversationAccess(req, res, next) {
  const conversationId = req.params.conversationId || req.query.conversationId || req.body.conversationId;

  if (!conversationId) {
    return res.status(400).json({ success: false, message: 'ID percakapan tidak disertakan.' });
  }

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  if (!conv) {
    return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan.' });
  }

  // Owner punya akses ke semua percakapan
  if (req.user.role === 'owner') {
    req.conversation = conv;
    return next();
  }

  // Pengguna biasa HANYA boleh mengakses percakapannya sendiri
  if (conv.user_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Akses ditolak. Anda tidak memiliki izin untuk percakapan ini.' });
  }

  req.conversation = conv;
  next();
}

module.exports = {
  authenticateToken,
  requireOwner,
  requireConversationAccess
};
