const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../models/db');
const config = require('../config/config');

// Upload file baru (mendukung multi-file sekaligus)
function uploadFiles(req, res) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah.' });
    }

    const savedAttachments = [];
    const insertStmt = db.prepare(`
      INSERT INTO attachments (id, message_id, uploader_id, original_name, stored_name, mime_type, file_size, file_path)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
    `);

    for (const file of req.files) {
      const attId = crypto.randomUUID();
      insertStmt.run(
        attId,
        req.user.id,
        file.originalname,
        file.filename,
        file.mimetype,
        file.size,
        file.path
      );

      savedAttachments.push({
        id: attId,
        original_name: file.originalname,
        mime_type: file.mimetype,
        file_size: file.size,
        url: `/api/files/${attId}`
      });
    }

    return res.status(201).json({
      success: true,
      message: `${req.files.length} file berhasil diunggah.`,
      attachments: savedAttachments
    });
  } catch (err) {
    console.error('Error in uploadFiles:', err);
    return res.status(500).json({ success: false, message: 'Gagal memproses unggahan file.' });
  }
}

// Download atau streaming preview file dengan otorisasi ketat
function getFile(req, res) {
  try {
    const { fileId } = req.params;
    const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(fileId);

    if (!attachment) {
      return res.status(404).json({ success: false, message: 'File tidak ditemukan.' });
    }

    // Owner selalu boleh mengakses semua berkas
    if (req.user.role !== 'owner') {
      // Jika user bukan uploader, periksa apakah file terhubung ke percakapannya
      if (attachment.uploader_id && attachment.uploader_id !== req.user.id) {
        if (attachment.message_id) {
          const msg = db.prepare(`
            SELECT c.user_id
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            WHERE m.id = ?
          `).get(attachment.message_id);

          if (!msg || msg.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Akses ditolak. Anda tidak memiliki izin untuk melihat file ini.' });
          }
        } else {
          return res.status(403).json({ success: false, message: 'Akses ditolak. Anda tidak memiliki izin untuk melihat file ini.' });
        }
      }
    }

    const filePath = path.resolve(config.uploadDir, attachment.stored_name);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File fisik tidak ditemukan pada server.' });
    }

    // Header keamanan agar file tidak dieksekusi secara berbahaya
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    const isPreviewable =
      attachment.mime_type.startsWith('image/') ||
      attachment.mime_type.startsWith('video/') ||
      attachment.mime_type.startsWith('audio/') ||
      attachment.mime_type === 'application/pdf';

    const disposition = isPreviewable ? 'inline' : 'attachment';
    const safeFilename = encodeURIComponent(attachment.original_name);

    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${safeFilename}`);
    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Error streaming file:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Gagal membaca file.' });
      }
    });

    stream.pipe(res);
  } catch (err) {
    console.error('Error in getFile:', err);
    return res.status(500).json({ success: false, message: 'Gagal mengambil file.' });
  }
}

module.exports = {
  uploadFiles,
  getFile
};
