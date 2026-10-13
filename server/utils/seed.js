const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../models/db');
const config = require('../config/config');

async function seedOwner() {
  console.log('[Seed] Memeriksa akun Owner di database...');

  const existingOwner = db.prepare('SELECT * FROM users WHERE role = ?').get('owner');

  if (!existingOwner) {
    const salt = bcrypt.genSaltSync(12);
    const passwordHash = bcrypt.hashSync(config.owner.password, salt);
    const ownerId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, bio, phone, is_blocked)
      VALUES (?, ?, ?, ?, 'owner', 'Official Owner of ZhanChat', ?, 0)
    `).run(
      ownerId,
      config.owner.name,
      config.owner.email.toLowerCase(),
      passwordHash,
      config.owner.phone
    );

    console.log(`[Seed] Berhasil membuat akun Owner:`);
    console.log(`  Email    : ${config.owner.email}`);
    console.log('  Password : tersimpan dengan aman (tidak ditampilkan).');
  } else {
    console.log(`[Seed] Akun Owner sudah ada (${existingOwner.email}). Lewati pembuatan.`);
  }

  // Inisialisasi pengaturan default aplikasi
  const defaultSettings = [
    ['max_file_size_mb', String(config.maxFileSizeMb)],
    ['allow_registration', 'true'],
    ['allow_voice_call', 'true'],
    ['allow_video_call', 'true'],
    ['sound_notifications', 'true']
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const [key, value] of defaultSettings) {
    insertSetting.run(key, value);
  }

  console.log('[Seed] Pengaturan default aplikasi berhasil disiapkan.');
}

if (require.main === module) {
  seedOwner().then(() => {
    console.log('[Seed] Selesai.');
    process.exit(0);
  }).catch((err) => {
    console.error('[Seed] Terjadi kesalahan:', err);
    process.exit(1);
  });
}

module.exports = seedOwner;
