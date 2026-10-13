const db = require('../models/db');

// Ambil daftar seluruh percakapan beserta cuplikan pesan terakhir, unread count, dan status pengguna
function getAllConversations(req, res) {
  try {
    const filter = req.query.filter || 'all'; // all, unread, unreplied, in_progress, favorite, archived
    const search = req.query.search || '';
    const ownerId = req.user.id;

    let sql = `
      SELECT
        c.id, c.user_id, c.status, c.priority, c.owner_notes, c.updated_at, c.created_at,
        u.name as user_name, u.email as user_email, u.avatar as user_avatar,
        u.phone as user_phone, u.bio as user_bio, u.is_blocked as user_is_blocked,
        u.last_seen as user_last_seen,
        (
          SELECT content FROM messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC LIMIT 1
        ) as last_message_content,
        (
          SELECT created_at FROM messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC LIMIT 1
        ) as last_message_time,
        (
          SELECT sender_id FROM messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC LIMIT 1
        ) as last_message_sender_id,
        (
          SELECT COUNT(*) FROM messages
          WHERE conversation_id = c.id AND sender_id != ? AND status != 'read'
        ) as unread_count
      FROM conversations c
      JOIN users u ON c.user_id = u.id
      WHERE 1=1
    `;

    const params = [ownerId];

    if (search.trim()) {
      sql += ` AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (filter === 'unread') {
      sql += ` AND (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND status != 'read') > 0`;
      params.push(ownerId);
    } else if (filter === 'unreplied') {
      // Terakhir kali pesan dikirim oleh user, belum dibalas oleh owner
      sql += ` AND (
        SELECT sender_id FROM messages
        WHERE conversation_id = c.id
        ORDER BY created_at DESC LIMIT 1
      ) != ?`;
      params.push(ownerId);
    } else if (filter === 'in_progress') {
      sql += ` AND c.status = 'in_progress'`;
    } else if (filter === 'favorite') {
      sql += ` AND c.status = 'favorite'`;
    } else if (filter === 'archived') {
      sql += ` AND c.status = 'archived'`;
    } else {
      // Default: kecuali archived jika membuka tab utama
      sql += ` AND c.status != 'archived'`;
    }

    sql += ` ORDER BY COALESCE(last_message_time, c.updated_at) DESC`;

    const conversations = db.prepare(sql).all(...params);

    return res.json({
      success: true,
      conversations
    });
  } catch (err) {
    console.error('Error in getAllConversations:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat daftar percakapan Owner.' });
  }
}

// Perbarui metadata percakapan (status, prioritas, catatan Owner)
function updateConversationMeta(req, res) {
  try {
    const { conversationId } = req.params;
    const { status, priority, owner_notes } = req.body;

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan.' });
    }

    const updates = [];
    const params = [];

    if (status && ['active', 'archived', 'in_progress', 'favorite'].includes(status)) {
      updates.push('status = ?');
      params.push(status);
    }
    if (priority && ['normal', 'high', 'urgent'].includes(priority)) {
      updates.push('priority = ?');
      params.push(priority);
    }
    if (owner_notes !== undefined) {
      updates.push('owner_notes = ?');
      params.push(owner_notes.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada perubahan yang diberikan.' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(conversationId);

    db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return res.json({ success: true, message: 'Metadata percakapan berhasil diperbarui.' });
  } catch (err) {
    console.error('Error in updateConversationMeta:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui metadata percakapan.' });
  }
}

// Blokir atau buka blokir pengguna
function toggleBlockUser(req, res) {
  try {
    const { userId } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
    }

    if (user.role === 'owner') {
      return res.status(400).json({ success: false, message: 'Akun Owner tidak dapat diblokir.' });
    }

    const newBlockedState = user.is_blocked ? 0 : 1;
    db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(newBlockedState, userId);

    // Kirim notifikasi socket jika pengguna sedang terkoneksi
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(`user_${userId}`).emit('account_blocked_status', { is_blocked: newBlockedState === 1 });
    }

    return res.json({
      success: true,
      message: newBlockedState === 1 ? 'Pengguna berhasil diblokir.' : 'Blokir pengguna berhasil dibuka.',
      is_blocked: newBlockedState === 1
    });
  } catch (err) {
    console.error('Error in toggleBlockUser:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui status blokir.' });
  }
}

// Hapus percakapan (berserta pesan dan relasinya)
function deleteConversation(req, res) {
  try {
    const { conversationId } = req.params;

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Percakapan tidak ditemukan.' });
    }

    db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);

    return res.json({ success: true, message: 'Percakapan dan seluruh riwayat pesan berhasil dihapus.' });
  } catch (err) {
    console.error('Error in deleteConversation:', err);
    return res.status(500).json({ success: false, message: 'Gagal menghapus percakapan.' });
  }
}

// Ambil riwayat seluruh panggilan
function getAllCalls(req, res) {
  try {
    const calls = db.prepare(`
      SELECT c.*,
        u_caller.name as caller_name, u_caller.avatar as caller_avatar,
        u_receiver.name as receiver_name, u_receiver.avatar as receiver_avatar
      FROM calls c
      JOIN users u_caller ON c.caller_id = u_caller.id
      JOIN users u_receiver ON c.receiver_id = u_receiver.id
      ORDER BY c.started_at DESC
      LIMIT 100
    `).all();

    return res.json({ success: true, calls });
  } catch (err) {
    console.error('Error in getAllCalls:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat riwayat panggilan.' });
  }
}

// Ambil dan simpan pengaturan aplikasi oleh Owner
function getSettings(req, res) {
  try {
    const rows = db.prepare('SELECT key, value FROM app_settings').all();
    const settings = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    return res.json({ success: true, settings });
  } catch (err) {
    console.error('Error in getSettings:', err);
    return res.status(500).json({ success: false, message: 'Gagal memuat pengaturan aplikasi.' });
  }
}

function updateSettings(req, res) {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, message: 'Data pengaturan tidak valid.' });
    }

    const upsert = db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(settings)) {
      upsert.run(key, String(value));
    }

    return res.json({ success: true, message: 'Pengaturan sistem berhasil disimpan.' });
  } catch (err) {
    console.error('Error in updateSettings:', err);
    return res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan.' });
  }
}

module.exports = {
  getAllConversations,
  updateConversationMeta,
  toggleBlockUser,
  deleteConversation,
  getAllCalls,
  getSettings,
  updateSettings
};
