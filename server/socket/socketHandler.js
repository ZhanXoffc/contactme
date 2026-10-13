const jwt = require('jsonwebtoken');
const config = require('../config/config');
const db = require('../models/db');

// Map untuk melacak koneksi pengguna aktif: userId -> Set(socketId)
const activeUsers = new Map();

function initSocket(io) {
  // Middleware autentikasi Socket.IO
  io.use((socket, next) => {
    let token = null;

    if (socket.handshake.auth && socket.handshake.auth.token) {
      token = socket.handshake.auth.token;
    } else if (socket.handshake.headers.cookie) {
      const match = socket.handshake.headers.cookie.match(/zhanchat_token=([^;]+)/);
      if (match) {
        token = match[1];
      }
    }

    if (!token) {
      return next(new Error('Autentikasi Socket gagal: Token tidak ditemukan.'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const user = db.prepare('SELECT id, name, email, role, is_blocked FROM users WHERE id = ?').get(decoded.id);

      if (!user || user.is_blocked) {
        return next(new Error('Pengguna tidak valid atau diblokir.'));
      }

      socket.user = user;
      next();
    } catch (err) {
      return next(new Error('Autentikasi Socket gagal: Token kedaluwarsa.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    const userId = user.id;

    // Tambahkan socket ke activeUsers
    if (!activeUsers.has(userId)) {
      activeUsers.set(userId, new Set());
    }
    activeUsers.get(userId).add(socket.id);

    // Gabung ke room pribadi
    socket.join(`user_${userId}`);

    // Jika Owner, gabung ke room khusus owner
    if (user.role === 'owner') {
      socket.join('owner_room');
    }

    // Broadcast status online ke semua pengguna
    io.emit('user_status_changed', {
      userId,
      isOnline: true,
      role: user.role
    });

    // 1. Bergabung / keluar ke room percakapan
    socket.on('join_conversation', (conversationId) => {
      // Verifikasi hak akses sebelum join
      if (user.role === 'owner') {
        socket.join(`conv_${conversationId}`);
      } else {
        const conv = db.prepare('SELECT id, user_id FROM conversations WHERE id = ?').get(conversationId);
        if (conv && conv.user_id === userId) {
          socket.join(`conv_${conversationId}`);
        }
      }
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conv_${conversationId}`);
    });

    // 2. Typing indicator (Status mengetik)
    socket.on('typing_start', ({ conversationId }) => {
      socket.to(`conv_${conversationId}`).emit('user_typing', {
        conversationId,
        userId,
        userName: user.name
      });
    });

    socket.on('typing_stop', ({ conversationId }) => {
      socket.to(`conv_${conversationId}`).emit('user_stopped_typing', {
        conversationId,
        userId
      });
    });

    // 3. WebRTC Call Signaling (Audio & Video)
    socket.on('call_request', (data) => {
      const { receiverId, conversationId, callType, callId } = data;
      // Kirim sinyal panggilan masuk ke room penerima
      io.to(`user_${receiverId}`).emit('incoming_call', {
        callId,
        conversationId,
        callType,
        caller: {
          id: user.id,
          name: user.name,
          role: user.role
        }
      });
    });

    socket.on('call_accept', (data) => {
      const { callerId, callId } = data;
      io.to(`user_${callerId}`).emit('call_accepted', {
        callId,
        acceptedBy: {
          id: user.id,
          name: user.name
        }
      });
    });

    socket.on('call_reject', (data) => {
      const { callerId, callId, reason } = data;
      io.to(`user_${callerId}`).emit('call_rejected', {
        callId,
        reason: reason || 'Panggilan ditolak.'
      });
    });

    socket.on('call_end', (data) => {
      const { peerId, callId, durationSeconds } = data;
      if (peerId) {
        io.to(`user_${peerId}`).emit('call_ended', {
          callId,
          durationSeconds: durationSeconds || 0
        });
      }
    });

    socket.on('webrtc_offer', (data) => {
      const { targetId, sdp, callId } = data;
      io.to(`user_${targetId}`).emit('webrtc_offer', {
        sdp,
        callId,
        fromId: user.id
      });
    });

    socket.on('webrtc_answer', (data) => {
      const { targetId, sdp, callId } = data;
      io.to(`user_${targetId}`).emit('webrtc_answer', {
        sdp,
        callId,
        fromId: user.id
      });
    });

    socket.on('webrtc_ice_candidate', (data) => {
      const { targetId, candidate, callId } = data;
      io.to(`user_${targetId}`).emit('webrtc_ice_candidate', {
        candidate,
        callId,
        fromId: user.id
      });
    });

    // 4. Periksa apakah user lain online
    socket.on('check_online', ({ targetUserId }, callback) => {
      const isOnline = activeUsers.has(targetUserId) && activeUsers.get(targetUserId).size > 0;
      if (typeof callback === 'function') {
        callback({ isOnline });
      }
    });

    // 5. Disconnect
    socket.on('disconnect', () => {
      if (activeUsers.has(userId)) {
        activeUsers.get(userId).delete(socket.id);
        if (activeUsers.get(userId).size === 0) {
          activeUsers.delete(userId);

          // Update last_seen di database
          db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(userId);

          io.emit('user_status_changed', {
            userId,
            isOnline: false,
            role: user.role,
            lastSeen: new Date().toISOString()
          });
        }
      }
    });
  });
}

function isUserOnline(userId) {
  return activeUsers.has(userId) && activeUsers.get(userId).size > 0;
}

module.exports = {
  initSocket,
  isUserOnline
};
