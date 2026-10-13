const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models/db');
const config = require('../config/config');

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function setTokenCookie(res, token) {
  res.cookie('zhanchat_token', token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 hari
  });
}

// Registrasi pengguna baru
function register(req, res) {
  try {
    const { name, email, password, phone, bio } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Nama, email, dan kata sandi wajib diisi.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Kata sandi minimal 6 karakter.' });
    }

    // Periksa apakah registrasi diperbolehkan
    const regSetting = db.prepare("SELECT value FROM app_settings WHERE key = 'allow_registration'").get();
    if (regSetting && regSetting.value === 'false') {
      return res.status(403).json({ success: false, message: 'Pendaftaran akun baru sedang dinonaktifkan oleh Owner.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email sudah terdaftar. Silakan masuk.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userId = crypto.randomUUID();

    // Buat akun user
    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, bio, phone, is_blocked)
      VALUES (?, ?, ?, ?, 'user', ?, ?, 0)
    `).run(userId, name.trim(), cleanEmail, passwordHash, (bio || '').trim(), (phone || '').trim());

    // Buat percakapan otomatis antara user ini dan Owner
    const conversationId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO conversations (id, user_id, status, priority, owner_notes)
      VALUES (?, ?, 'active', 'normal', '')
    `).run(conversationId, userId);

    const user = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      role: 'user',
      avatar: '',
      bio: (bio || '').trim(),
      phone: (phone || '').trim(),
      conversation_id: conversationId
    };

    const token = createToken(user);
    setTokenCookie(res, token);

    return res.status(201).json({
      success: true,
      message: 'Registrasi berhasil. Selamat datang di ZhanChat!',
      user,
      token
    });
  } catch (err) {
    console.error('Error in register:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server saat registrasi.' });
  }
}

// Login untuk Pengguna dan Owner
function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email dan kata sandi wajib diisi.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Email atau kata sandi tidak sesuai.' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, message: 'Akun Anda telah diblokir oleh Owner.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Email atau kata sandi tidak sesuai.' });
    }

    // Perbarui waktu terakhir aktif
    db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(user.id);

    let conversationId = null;
    if (user.role === 'user') {
      let conv = db.prepare('SELECT id FROM conversations WHERE user_id = ?').get(user.id);
      if (!conv) {
        conversationId = crypto.randomUUID();
        db.prepare('INSERT INTO conversations (id, user_id) VALUES (?, ?)').run(conversationId, user.id);
      } else {
        conversationId = conv.id;
      }
    }

    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      bio: user.bio,
      phone: user.phone,
      conversation_id: conversationId
    };

    const token = createToken(userData);
    setTokenCookie(res, token);

    return res.json({
      success: true,
      message: 'Login berhasil.',
      user: userData,
      token
    });
  } catch (err) {
    console.error('Error in login:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server saat login.' });
  }
}

// Logout
function logout(req, res) {
  res.clearCookie('zhanchat_token');
  return res.json({ success: true, message: 'Berhasil keluar.' });
}

// Ambil profil sesi aktif
function getMe(req, res) {
  try {
    const user = req.user;
    let conversationId = null;
    let unreadCount = 0;

    if (user.role === 'user') {
      const conv = db.prepare('SELECT id FROM conversations WHERE user_id = ?').get(user.id);
      if (conv) {
        conversationId = conv.id;
        // Hitung pesan yang belum dibaca dari Owner
        const countRow = db.prepare(`
          SELECT COUNT(*) as count FROM messages
          WHERE conversation_id = ? AND sender_id != ? AND status != 'read'
        `).get(conv.id, user.id);
        unreadCount = countRow ? countRow.count : 0;
      }
    } else if (user.role === 'owner') {
      // Hitung total pesan belum dibaca dari semua pengguna
      const countRow = db.prepare(`
        SELECT COUNT(*) as count FROM messages
        WHERE sender_id != ? AND status != 'read'
      `).get(user.id);
      unreadCount = countRow ? countRow.count : 0;
    }

    // Ambil data Owner untuk ditampilkan kepada pengguna
    const ownerData = db.prepare(`
      SELECT id, name, email, avatar, bio, phone, last_seen FROM users WHERE role = 'owner'
    `).get();

    return res.json({
      success: true,
      user: {
        ...user,
        conversation_id: conversationId,
        unread_count: unreadCount
      },
      owner: ownerData || null
    });
  } catch (err) {
    console.error('Error in getMe:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat profil pengguna.' });
  }
}

// Update profil sendiri
function updateProfile(req, res) {
  try {
    const { name, bio, phone, avatar } = req.body;
    const updates = [];
    const params = [];

    if (name && name.trim()) {
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (bio !== undefined) {
      updates.push('bio = ?');
      params.push(bio.trim());
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone.trim());
    }
    if (avatar !== undefined) {
      updates.push('avatar = ?');
      params.push(avatar.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada data profil yang diperbarui.' });
    }

    params.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updatedUser = db.prepare('SELECT id, name, email, role, avatar, bio, phone FROM users WHERE id = ?').get(req.user.id);
    return res.json({ success: true, message: 'Profil berhasil diperbarui.', user: updatedUser });
  } catch (err) {
    console.error('Error in updateProfile:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui profil.' });
  }
}

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateProfile
};
