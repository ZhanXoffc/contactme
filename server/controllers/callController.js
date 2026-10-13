const crypto = require('crypto');
const db = require('../models/db');
const config = require('../config/config');

// Ambil konfigurasi ICE servers (STUN/TURN) untuk WebRTC
function getIceServers(req, res) {
  return res.json({
    success: true,
    iceServers: config.iceServers
  });
}

// Inisialisasi catatan panggilan baru
function initiateCall(req, res) {
  try {
    const { conversationId, receiverId, callType } = req.body;

    if (!conversationId || !receiverId || !callType) {
      return res.status(400).json({ success: false, message: 'Data panggilan tidak lengkap.' });
    }

    if (!['audio', 'video'].includes(callType)) {
      return res.status(400).json({ success: false, message: 'Tipe panggilan harus audio atau video.' });
    }

    // Periksa apakah panggilan diizinkan di pengaturan sistem
    const settingKey = callType === 'audio' ? 'allow_voice_call' : 'allow_video_call';
    const setting = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(settingKey);
    if (setting && setting.value === 'false') {
      return res.status(403).json({
        success: false,
        message: `Panggilan ${callType} sedang dinonaktifkan oleh Owner.`
      });
    }

    const callId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO calls (id, conversation_id, caller_id, receiver_id, call_type, status, duration_seconds)
      VALUES (?, ?, ?, ?, ?, 'ringing', 0)
    `).run(callId, conversationId, req.user.id, receiverId, callType);

    return res.status(201).json({
      success: true,
      callId,
      message: 'Panggilan berhasil diinisiasi.'
    });
  } catch (err) {
    console.error('Error in initiateCall:', err);
    return res.status(500).json({ success: false, message: 'Gagal menginisiasi panggilan.' });
  }
}

// Perbarui status panggilan (diterima, ditolak, tidak terjawab, berakhir dengan durasi)
function updateCallStatus(req, res) {
  try {
    const { callId } = req.params;
    const { status, durationSeconds } = req.body;

    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call) {
      return res.status(404).json({ success: false, message: 'Catatan panggilan tidak ditemukan.' });
    }

    const updates = [];
    const params = [];

    if (status && ['ringing', 'accepted', 'rejected', 'missed', 'ended'].includes(status)) {
      updates.push('status = ?');
      params.push(status);
    }

    if (durationSeconds !== undefined) {
      updates.push('duration_seconds = ?');
      params.push(parseInt(durationSeconds, 10) || 0);
    }

    if (status === 'ended' || status === 'rejected' || status === 'missed') {
      updates.push("ended_at = datetime('now')");
    }

    if (updates.length > 0) {
      params.push(callId);
      db.prepare(`UPDATE calls SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    return res.json({ success: true, message: 'Status panggilan diperbarui.' });
  } catch (err) {
    console.error('Error in updateCallStatus:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui status panggilan.' });
  }
}

// Ambil riwayat panggilan pada percakapan ini
function getConversationCalls(req, res) {
  try {
    const convId = req.conversation.id;
    const calls = db.prepare(`
      SELECT c.*,
        u_caller.name as caller_name,
        u_receiver.name as receiver_name
      FROM calls c
      JOIN users u_caller ON c.caller_id = u_caller.id
      JOIN users u_receiver ON c.receiver_id = u_receiver.id
      WHERE c.conversation_id = ?
      ORDER BY c.started_at DESC
      LIMIT 50
    `).all(convId);

    return res.json({ success: true, calls });
  } catch (err) {
    console.error('Error in getConversationCalls:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat riwayat panggilan.' });
  }
}

module.exports = {
  getIceServers,
  initiateCall,
  updateCallStatus,
  getConversationCalls
};
