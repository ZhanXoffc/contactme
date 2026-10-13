const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Pastikan environment testing
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';

const { app, server } = require('../server/server');
const db = require('../server/models/db');
const config = require('../server/config/config');

let baseUrl = 'http://127.0.0.1:3099';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 MEMULAI RANGKAIAN PENGUJIAN OTOMATIS ZHANCHAT');
  console.log('====================================================');

  await new Promise((resolve) => {
    server.listen(3099, '127.0.0.1', () => {
      console.log('✓ Server testing berjalan pada port 3099');
      resolve();
    });
  });

    let ownerToken = null;
    let ownerId = null;
    let userAToken = null;
    let userBToken = null;
    let userAConvId = null;
    let userBConvId = null;
    let userAId = null;
    let userBId = null;
    let uploadedFileId = null;

  try {
    console.log('\n[TEST 0] Pengujian health check deployment...');
    {
      const res = await fetch(`${baseUrl}/health`);
      const data = await res.json();
      assert.strictEqual(res.status, 200, 'Health check harus mengembalikan HTTP 200');
      assert.deepStrictEqual(data, { status: 'ok' }, 'Health check harus menyatakan server sehat');
      console.log('  ✓ Health check siap digunakan platform hosting.');
    }

    // ----------------------------------------------------
    // TEST 1: Login Akun Owner Awal
    // ----------------------------------------------------
    console.log('\n[TEST 1] Pengujian Autentikasi Owner...');
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: config.owner.email,
          password: config.owner.password
        })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200, 'Owner harus berhasil login');
      assert.strictEqual(data.user.role, 'owner', 'Role harus owner');
      assert.ok(data.token, 'Token JWT harus dikembalikan');
      ownerToken = data.token;
      ownerId = data.user.id;
      console.log('  ✓ Login Owner valid berhasil.');
    }

    // ----------------------------------------------------
    // TEST 2: Registrasi Pengguna A & B
    // ----------------------------------------------------
    console.log('\n[TEST 2] Pengujian Registrasi Pengguna A & Pengguna B...');
    {
      // User A
      const emailA = `user_a_${Date.now()}@test.local`;
      const resA = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Pengguna Alpha',
          email: emailA,
          password: 'Password123!',
          phone: '+628111111111'
        })
      });
      const dataA = await resA.json();
      assert.strictEqual(resA.status, 201, 'User A harus berhasil mendaftar');
      userAToken = dataA.token;
      userAConvId = dataA.user.conversation_id;
      userAId = dataA.user.id;
      assert.ok(userAConvId, 'User A harus otomatis dibuatkan percakapan dengan Owner');
      console.log(`  ✓ User A terdaftar: ${dataA.user.name} (Conv ID: ${userAConvId})`);

      // User B
      const emailB = `user_b_${Date.now()}@test.local`;
      const resB = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Pengguna Beta',
          email: emailB,
          password: 'Password123!',
          phone: '+628222222222'
        })
      });
      const dataB = await resB.json();
      assert.strictEqual(resB.status, 201, 'User B harus berhasil mendaftar');
      userBToken = dataB.token;
      userBConvId = dataB.user.conversation_id;
      userBId = dataB.user.id;
      assert.ok(userBConvId, 'User B harus otomatis dibuatkan percakapan terpisah');
      assert.notStrictEqual(userAConvId, userBConvId, 'ID percakapan User A dan User B harus berbeda');
      console.log(`  ✓ User B terdaftar: ${dataB.user.name} (Conv ID: ${userBConvId})`);
    }

    // ----------------------------------------------------
    // TEST 3: Pencegahan Pengguna Menyamar Sebagai Owner
    // ----------------------------------------------------
    console.log('\n[TEST 3] Pengujian Keamanan Hak Akses (User biasa dilarang akses endpoint Owner)...');
    {
      const res = await fetch(`${baseUrl}/api/owner/conversations`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.strictEqual(res.status, 403, 'User A tidak boleh mengakses /api/owner/conversations');
      console.log('  ✓ Endpoint Owner dilindungi role-based access control (403 Forbidden).');
    }

    // ----------------------------------------------------
    // TEST 4: Isolasi Privasi Antar Pengguna
    // ----------------------------------------------------
    console.log('\n[TEST 4] Pengujian Isolasi Privasi (User A tidak boleh membaca percakapan User B)...');
    {
      const res = await fetch(`${baseUrl}/api/conversations/${userBConvId}/messages`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.strictEqual(res.status, 403, 'User A harus ditolak saat mencoba membuka chat User B');
      console.log('  ✓ User A ditolak mengakses percakapan User B (403 Forbidden).');
    }

    // ----------------------------------------------------
    // TEST 5: Pengiriman Pesan Real-Time & Balasan Terarah
    // ----------------------------------------------------
    console.log('\n[TEST 5] Pengujian Pengiriman Pesan & Balasan Owner...');
    {
      // User A mengirim pesan ke Owner
      const resMsgA = await fetch(`${baseUrl}/api/conversations/${userAConvId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userAToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: 'Halo Owner dari User Alpha!' })
      });
      const dataMsgA = await resMsgA.json();
      assert.strictEqual(resMsgA.status, 201, 'Pesan User A harus tersimpan');
      console.log('  ✓ Pesan User A berhasil dikirim.');

      // User B mengirim pesan ke Owner pada waktu bersamaan
      const resMsgB = await fetch(`${baseUrl}/api/conversations/${userBConvId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userBToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: 'Halo Owner dari User Beta!' })
      });
      const dataMsgB = await resMsgB.json();
      assert.strictEqual(resMsgB.status, 201, 'Pesan User B harus tersimpan');
      console.log('  ✓ Pesan User B berhasil dikirim.');

      // Owner memeriksa daftar percakapan
      const resOwnerList = await fetch(`${baseUrl}/api/owner/conversations`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      const dataOwnerList = await resOwnerList.json();
      assert.strictEqual(resOwnerList.status, 200);
      assert.ok(dataOwnerList.conversations.length >= 2, 'Owner harus melihat percakapan kedua user');
      console.log(`  ✓ Owner berhasil melihat ${dataOwnerList.conversations.length} percakapan terpisah.`);

      // Owner membalas pesan User A secara spesifik
      const resReplyA = await fetch(`${baseUrl}/api/conversations/${userAConvId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: 'Halo Alpha, ini balasan resmi dari Owner.',
          reply_to_id: dataMsgA.message.id
        })
      });
      assert.strictEqual(resReplyA.status, 201, 'Owner harus berhasil membalas User A');
      console.log('  ✓ Owner mengirimkan balasan spesifik untuk User A.');

      // Periksa pesan User A
      const resGetA = await fetch(`${baseUrl}/api/conversations/${userAConvId}/messages`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      const dataGetA = await resGetA.json();
      assert.strictEqual(dataGetA.messages.length, 2, 'User A harus melihat 2 pesan');
      assert.strictEqual(dataGetA.messages[1].content, 'Halo Alpha, ini balasan resmi dari Owner.');
      console.log('  ✓ User A menerima balasan Owner dengan konteks reply.');

      // Periksa pesan User B (harus tetap HANYA berisi pesan User B, tanpa bocor balasan A)
      const resGetB = await fetch(`${baseUrl}/api/conversations/${userBConvId}/messages`, {
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      const dataGetB = await resGetB.json();
      assert.strictEqual(dataGetB.messages.length, 1, 'User B hanya boleh melihat 1 pesan');
      assert.strictEqual(dataGetB.messages[0].content, 'Halo Owner dari User Beta!');
      console.log('  ✓ Balasan Owner untuk User A TIDAK bocor ke User B.');
    }

    // ----------------------------------------------------
    // TEST 6: Pengujian Upload Berkas Aman & Otorisasi
    // ----------------------------------------------------
    console.log('\n[TEST 6] Pengujian Upload Berkas & Otorisasi Akses File...');
    {
      // Buat file dummy aman
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const fileContent = 'Data dokumen laporan pribadi ZhanChat 2026.';
      const body =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="laporan_rahasia.txt"\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `${fileContent}\r\n` +
        `--${boundary}--\r\n`;

      const resUpload = await fetch(`${baseUrl}/api/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userAToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: Buffer.from(body)
      });
      const dataUpload = await resUpload.json();
      assert.strictEqual(resUpload.status, 201, 'File harus berhasil diunggah');
      assert.ok(dataUpload.attachments.length > 0, 'Attachment ID harus ada');
      uploadedFileId = dataUpload.attachments[0].id;
      console.log(`  ✓ Berkas berhasil diunggah (Attachment ID: ${uploadedFileId}).`);

      // Kirim pesan dengan lampiran file ini di chat User A
      await fetch(`${baseUrl}/api/conversations/${userAConvId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userAToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: 'Ini berkas lampiran saya.',
          attachment_ids: [uploadedFileId]
        })
      });

      // User A (pemilik) mengunduh file -> Sukses
      const resDownloadA = await fetch(`${baseUrl}/api/files/${uploadedFileId}`, {
        headers: { Authorization: `Bearer ${userAToken}` }
      });
      assert.strictEqual(resDownloadA.status, 200, 'User A harus diizinkan mengunduh file miliknya');
      console.log('  ✓ User A berhasil mengunduh berkas miliknya.');

      // Owner mengunduh file User A -> Sukses
      const resDownloadOwner = await fetch(`${baseUrl}/api/files/${uploadedFileId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(resDownloadOwner.status, 200, 'Owner harus diizinkan mengunduh file User A');
      console.log('  ✓ Owner berhasil mengunduh berkas User A.');

      // User B mencoba mengunduh file User A -> Ditolak 403 Forbidden!
      const resDownloadB = await fetch(`${baseUrl}/api/files/${uploadedFileId}`, {
        headers: { Authorization: `Bearer ${userBToken}` }
      });
      assert.strictEqual(resDownloadB.status, 403, 'User B harus ditolak mengakses file User A');
      console.log('  ✓ User B ditolak saat mencoba mengunduh file User A (403 Forbidden).');
    }

    // ----------------------------------------------------
    // TEST 7: Penolakan File Berbahaya (Anti-Executable)
    // ----------------------------------------------------
    console.log('\n[TEST 7] Pengujian Keamanan Format File Berbahaya (Executable)...');
    {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const body =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="script_jahat.bat"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n` +
        `@echo off\r\n` +
        `--${boundary}--\r\n`;

      const resBadUpload = await fetch(`${baseUrl}/api/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userAToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: Buffer.from(body)
      });
      assert.notStrictEqual(resBadUpload.status, 201, 'File .bat berbahaya tidak boleh diterima');
      console.log('  ✓ File ekstensi berbahaya (.bat) berhasil ditolak oleh server.');
    }

    // ----------------------------------------------------
    // TEST 8: Inisiasi Panggilan WebRTC & Riwayat Panggilan
    // ----------------------------------------------------
    console.log('\n[TEST 8] Pengujian Inisiasi WebRTC Call & Status Durasi...');
    {
      // User A memulai voice call ke Owner
      const resCallInit = await fetch(`${baseUrl}/api/calls/initiate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userAToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          conversationId: userAConvId,
          receiverId: ownerId,
          callType: 'audio'
        })
      });
      const dataCall = await resCallInit.json();
      assert.strictEqual(resCallInit.status, 201);
      assert.ok(dataCall.callId);
      console.log(`  ✓ Panggilan suara diinisiasi (Call ID: ${dataCall.callId}).`);

      // Update panggilan menjadi ended dengan durasi 45 detik
      const resCallEnd = await fetch(`${baseUrl}/api/calls/${dataCall.callId}/status`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userAToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: 'ended',
          durationSeconds: 45
        })
      });
      assert.strictEqual(resCallEnd.status, 200);
      console.log('  ✓ Status panggilan dan durasi 45s berhasil dicatat di database.');

      // Owner memeriksa riwayat panggilan
      const resCallsOwner = await fetch(`${baseUrl}/api/owner/calls`, {
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      const dataCallsOwner = await resCallsOwner.json();
      assert.strictEqual(resCallsOwner.status, 200);
      assert.ok(dataCallsOwner.calls.length > 0, 'Riwayat panggilan harus tercatat');
      console.log(`  ✓ Riwayat panggilan diverifikasi di dashboard Owner (${dataCallsOwner.calls.length} panggilan).`);
    }

    // ----------------------------------------------------
    // TEST 9: Blokir Pengguna & Pembatasan
    // ----------------------------------------------------
    console.log('\n[TEST 9] Pengujian Fitur Blokir Pengguna oleh Owner...');
    {
      // Owner memblokir User B
      const resBlock = await fetch(`${baseUrl}/api/owner/users/${userBId}/block`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      const dataBlock = await resBlock.json();
      assert.strictEqual(resBlock.status, 200);
      assert.strictEqual(dataBlock.is_blocked, true);
      console.log('  ✓ User B berhasil diblokir oleh Owner.');

      // User B mencoba mengirim pesan -> Harus ditolak (403)
      const resBlockedMsg = await fetch(`${baseUrl}/api/conversations/${userBConvId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userBToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: 'Pesan saat diblokir' })
      });
      assert.strictEqual(resBlockedMsg.status, 403, 'Pengguna yang diblokir dilarang mengirim pesan');
      console.log('  ✓ Pengiriman pesan dari pengguna yang diblokir berhasil dicegah.');
    }

    console.log('\n====================================================');
    console.log('🎉 SEMUA 9 PENGUJIAN OTOMATIS BERHASIL DENGAN SUKSES! (100% PASS)');
    console.log('====================================================');
  } catch (err) {
    console.error('\n❌ PENGUJIAN GAGAL:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runTests();
