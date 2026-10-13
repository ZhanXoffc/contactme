const rateLimit = require('express-rate-limit');

// Batasi percobaan login & register untuk mencegah brute force & spam
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 30, // Maksimal 30 percobaan per IP per 15 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Terlalu banyak permintaan autentikasi. Silakan coba kembali dalam 15 menit.'
  }
});

// Batasi pengiriman pesan & upload file untuk mencegah spamming
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  max: 120, // Maksimal 120 request per menit
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Terlalu banyak permintaan API. Mohon perlambat aktivitas Anda.'
  }
});

module.exports = {
  authLimiter,
  apiLimiter
};
