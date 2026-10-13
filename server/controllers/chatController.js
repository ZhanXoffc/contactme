const crypto = require('crypto');
const db = require('../models/db');

// Ambil percakapan aktif & info lawan bicara
function getConversation(req, res) {
  try {
    const conv = req.conversation;
    // Ambil detail pengunjung
    const user = db.prepare('SELECT id, name, email, avatar, bio, phone, is_blocked, last_seen FROM users WHERE id = ?').get(conv.user_id);
    // Ambil detail Owner
    const owner = db.prepare("SELECT id, name, email, avatar, bio, phone, last_seen FROM users WHERE role = 'owner'").get();

    return res.json({
      success: true,
      conversation: conv,
      user,
      owner
    });
  } catch (err) {
    console.error('Error in getConversation:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat percakapan.' });
  }
}

// Ambil daftar pesan dalam percakapan dengan relasi lampiran & balasan
function getMessages(req, res) {
  try {
    const convId = req.conversation.id;
    const limit = parseInt(req.query.limit, 10) || 50;
    const before = req.query.before; // timestamp untuk infinite scroll / pagination

    let query = `
      SELECT m.*, u.name as sender_name, u.role as sender_role, u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
    `;
    const params = [convId];

    if (before) {
      query += ` AND m.created_at < ?`;
      params.push(before);
    }

    query += ` ORDER BY m.created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    // Urutkan kembali secara kronologis (terlama ke terbaru)
    const messages = rows.reverse();

    // Lampirkan data file (attachments) & info reply jika ada
    const msgIds = messages.map(m => m.id);
    let attachmentsMap = {};
    let replyMap = {};

    if (msgIds.length > 0) {
      const placeholders = msgIds.map(() => '?').join(',');
      const attachRows = db.prepare(`
        SELECT * FROM attachments WHERE message_id IN (${placeholders})
      `).all(...msgIds);

      for (const att of attachRows) {
        if (!attachmentsMap[att.message_id]) {
          attachmentsMap[att.message_id] = [];
        }
        attachmentsMap[att.message_id].push(att);
      }

      // Ambil reply preview jika ada reply_to_id
      const replyIds = messages.filter(m => m.reply_to_id).map(m => m.reply_to_id);
      if (replyIds.length > 0) {
        const replyPlaceholders = replyIds.map(() => '?').join(',');
        const replyRows = db.prepare(`
          SELECT m.id, m.content, m.sender_id, u.name as sender_name
          FROM messages m
          JOIN users u ON m.sender_id = u.id
          WHERE m.id IN (${replyPlaceholders})
        `).all(...replyIds);

        for (const rep of replyRows) {
          replyMap[rep.id] = rep;
        }
      }
    }

    const enrichedMessages = messages.map(msg => ({
      ...msg,
      attachments: attachmentsMap[msg.id] || [],
      reply_to: msg.reply_to_id ? (replyMap[msg.reply_to_id] || null) : null
    }));

    return res.json({
      success: true,
      messages: enrichedMessages,
      has_more: rows.length === limit
    });
  } catch (err) {
    console.error('Error in getMessages:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat pesan.' });
  }
}

// Kirim pesan teks dan/atau lampiran
function sendMessage(req, res) {
  try {
    const convId = req.conversation.id;
    const senderId = req.user.id;
    const { content, reply_to_id, attachment_ids } = req.body;

    const trimmedContent = (content || '').trim();

    if (!trimmedContent && (!attachment_ids || attachment_ids.length === 0)) {
      return res.status(400).json({ success: false, message: 'Pesan atau lampiran tidak boleh kosong.' });
    }

    // Periksa apakah pengguna diblokir
    if (req.user.is_blocked) {
      return res.status(403).json({ success: false, message: 'Akun Anda diblokir dari mengirim pesan.' });
    }

    const messageId = crypto.randomUUID();

    // Buat pesan di DB
    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, content, reply_to_id, status)
      VALUES (?, ?, ?, ?, ?, 'sent')
    `).run(messageId, convId, senderId, trimmedContent, reply_to_id || null);

    // Hubungkan attachments ke message_id
    if (Array.isArray(attachment_ids) && attachment_ids.length > 0) {
      const updateAttach = db.prepare('UPDATE attachments SET message_id = ? WHERE id = ?');
      for (const attId of attachment_ids) {
        updateAttach.run(messageId, attId);
      }
    }

    // Perbarui waktu percakapan
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(convId);

    // Ambil data pesan lengkap untuk response & broadcast
    const savedMsg = db.prepare(`
      SELECT m.*, u.name as sender_name, u.role as sender_role, u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(messageId);

    const attachments = db.prepare('SELECT * FROM attachments WHERE message_id = ?').all(messageId);

    let replyTo = null;
    if (savedMsg.reply_to_id) {
      replyTo = db.prepare(`
        SELECT m.id, m.content, m.sender_id, u.name as sender_name
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(savedMsg.reply_to_id);
    }

    const fullMessage = {
      ...savedMsg,
      attachments,
      reply_to: replyTo
    };

    // Emit via Socket.IO jika tersedia
    if (req.app.get('io')) {
      const io = req.app.get('io');
      // Kirim ke room percakapan dan notifikasi ke owner
      io.to(`conv_${convId}`).emit('new_message', fullMessage);
      io.to('owner_room').emit('owner_new_message', {
        conversation_id: convId,
        message: fullMessage
      });
    }

    return res.status(201).json({
      success: true,
      message: fullMessage
    });
  } catch (err) {
    console.error('Error in sendMessage:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengirim pesan.' });
  }
}

// Edit pesan
function editMessage(req, res) {
  try {
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Isi pesan tidak boleh kosong.' });
    }

    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!msg) {
      return res.status(404).json({ success: false, message: 'Pesan tidak ditemukan.' });
    }

    // Hanya pengirim yang boleh mengedit
    if (msg.sender_id !== req.user.id && req.user.role !== 'owner') {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki hak untuk mengedit pesan ini.' });
    }

    if (msg.is_deleted) {
      return res.status(400).json({ success: false, message: 'Pesan yang sudah dihapus tidak dapat diedit.' });
    }

    db.prepare(`
      UPDATE messages SET content = ?, is_edited = 1, updated_at = datetime('now') WHERE id = ?
    `).run(content.trim(), messageId);

    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(`conv_${msg.conversation_id}`).emit('message_edited', {
        messageId,
        content: content.trim(),
        conversation_id: msg.conversation_id
      });
    }

    return res.json({ success: true, message: 'Pesan berhasil diperbarui.' });
  } catch (err) {
    console.error('Error in editMessage:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengedit pesan.' });
  }
}

// Hapus pesan (soft delete)
function deleteMessage(req, res) {
  try {
    const { messageId } = req.params;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);

    if (!msg) {
      return res.status(404).json({ success: false, message: 'Pesan tidak ditemukan.' });
    }

    if (msg.sender_id !== req.user.id && req.user.role !== 'owner') {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki hak untuk menghapus pesan ini.' });
    }

    db.prepare(`
      UPDATE messages SET is_deleted = 1, content = 'Pesan ini telah dihapus.', updated_at = datetime('now') WHERE id = ?
    `).run(messageId);

    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(`conv_${msg.conversation_id}`).emit('message_deleted', {
        messageId,
        conversation_id: msg.conversation_id
      });
    }

    return res.json({ success: true, message: 'Pesan berhasil dihapus.' });
  } catch (err) {
    console.error('Error in deleteMessage:', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus pesan.' });
  }
}

// Tandai pesan sudah dibaca (read receipts)
function markAsRead(req, res) {
  try {
    const convId = req.conversation.id;
    const currentUserId = req.user.id;

    // Tandai semua pesan yang dikirim oleh lawan bicara sebagai 'read'
    db.prepare(`
      UPDATE messages
      SET status = 'read', updated_at = datetime('now')
      WHERE conversation_id = ? AND sender_id != ? AND status != 'read'
    `).run(convId, currentUserId);

    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(`conv_${convId}`).emit('messages_read', {
        conversation_id: convId,
        reader_id: currentUserId
      });
    }

    return res.json({ success: true, message: 'Pesan ditandai telah dibaca.' });
  } catch (err) {
    console.error('Error in markAsRead:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui status baca.' });
  }
}

// Pencarian pesan di dalam percakapan
function searchMessages(req, res) {
  try {
    const convId = req.conversation.id;
    const query = req.query.q;

    if (!query || !query.trim()) {
      return res.json({ success: true, messages: [] });
    }

    const results = db.prepare(`
      SELECT m.*, u.name as sender_name, u.role as sender_role
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ? AND m.is_deleted = 0 AND m.content LIKE ?
      ORDER BY m.created_at DESC
      LIMIT 30
    `).all(convId, `%${query.trim()}%`);

    return res.json({ success: true, messages: results });
  } catch (err) {
    console.error('Error in searchMessages:', err);
    return res.status(500).json({ success: false, message: 'Gagal mencari pesan.' });
  }
}

module.exports = {
  getConversation,
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  markAsRead,
  searchMessages
};
