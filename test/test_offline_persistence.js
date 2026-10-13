const assert = require('assert');
const { app, server } = require('../server/server');
const config = require('../server/config/config');

let baseUrl = 'http://127.0.0.1:3098';

async function testOfflineAndExpiry() {
  console.log('====================================================');
  console.log('🧪 PENGUJIAN PERSISTENSI OFFLINE & SESI KEDALUWARSA');
  console.log('====================================================');

  await new Promise((resolve) => {
    server.listen(3098, '127.0.0.1', resolve);
  });

  try {
    // 1. Buat user baru
    const email = `offline_tester_${Date.now()}@test.local`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tester Offline',
        email,
        password: 'Password123!'
      })
    });
    const regData = await regRes.json();
    const userToken = regData.token;
    const convId = regData.user.conversation_id;

    // 2. Kirim 3 pesan saat Owner sama sekali tidak login / offline
    console.log('\n[SKENARIO] Mengirim 3 pesan saat Owner offline...');
    for (let i = 1; i <= 3; i++) {
      await fetch(`${baseUrl}/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: `Pesan offline ke-${i}` })
      });
    }
    console.log('  ✓ 3 Pesan terkirim ke server.');

    // 3. Owner sekarang login kembali
    console.log('\n[SKENARIO] Owner baru login kembali...');
    const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: config.owner.email,
        password: config.owner.password
      })
    });
    const ownerData = await ownerLogin.json();
    const ownerToken = ownerData.token;

    // 4. Periksa apakah Owner melihat 3 pesan unread dari tester ini
    const listRes = await fetch(`${baseUrl}/api/owner/conversations?filter=unread`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const listData = await listRes.json();
    const targetConv = listData.conversations.find((c) => c.id === convId);
    assert.ok(targetConv, 'Percakapan harus muncul di filter belum dibaca');
    assert.strictEqual(targetConv.unread_count, 3, 'Harus ada 3 pesan belum dibaca');
    assert.strictEqual(targetConv.last_message_content, 'Pesan offline ke-3');
    console.log(`  ✓ Semua pesan tersimpan persisten saat offline (Unread count: ${targetConv.unread_count}).`);

    // 5. Uji penolakan token palsu / tidak valid (Expired / Tampered token)
    console.log('\n[SKENARIO] Pengujian Penolakan Token Palsu / Kedaluwarsa...');
    const fakeTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer fake_invalid_token_12345' }
    });
    assert.strictEqual(fakeTokenRes.status, 401, 'Token palsu harus ditolak dengan 401 Unauthorized');
    console.log('  ✓ Token tidak sah berhasil ditolak (401 Unauthorized).');

    console.log('\n====================================================');
    console.log('🎉 PENGUJIAN PERSISTENSI OFFLINE SELESAI DENGAN SUKSES!');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ Gagal:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

testOfflineAndExpiry();
