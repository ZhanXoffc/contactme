const express = require('express');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./config/config');
const db = require('./models/db');
const seedOwner = require('./utils/seed');
const { initSocket } = require('./socket/socketHandler');

const { authenticateToken, requireOwner, requireConversationAccess } = require('./middleware/authMiddleware');
const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');
const upload = require('./middleware/uploadMiddleware');

const authController = require('./controllers/authController');
const chatController = require('./controllers/chatController');
const ownerController = require('./controllers/ownerController');
const fileController = require('./controllers/fileController');
const callController = require('./controllers/callController');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Simpan instance IO di app untuk akses dari controller
app.set('io', io);

// Middleware dasar
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(cors());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// File statis frontend
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// ==========================================
// API ROUTES
// ==========================================

// 1. Auth API
app.post('/api/auth/register', authLimiter, authController.register);
app.post('/api/auth/login', authLimiter, authController.login);
app.post('/api/auth/logout', authController.logout);
app.get('/api/auth/me', authenticateToken, authController.getMe);
app.put('/api/auth/profile', authenticateToken, authController.updateProfile);

// 2. Chat & Message API (Protected & isolated per user)
app.get('/api/conversations/:conversationId', authenticateToken, requireConversationAccess, chatController.getConversation);
app.get('/api/conversations/:conversationId/messages', authenticateToken, requireConversationAccess, chatController.getMessages);
app.post('/api/conversations/:conversationId/messages', authenticateToken, requireConversationAccess, apiLimiter, chatController.sendMessage);
app.put('/api/conversations/:conversationId/messages/:messageId', authenticateToken, requireConversationAccess, chatController.editMessage);
app.delete('/api/conversations/:conversationId/messages/:messageId', authenticateToken, requireConversationAccess, chatController.deleteMessage);
app.post('/api/conversations/:conversationId/read', authenticateToken, requireConversationAccess, chatController.markAsRead);
app.get('/api/conversations/:conversationId/search', authenticateToken, requireConversationAccess, chatController.searchMessages);
app.get('/api/conversations/:conversationId/calls', authenticateToken, requireConversationAccess, callController.getConversationCalls);

// 3. File Upload & Authorized Retrieval
app.post('/api/files/upload', authenticateToken, apiLimiter, upload.array('files', 10), fileController.uploadFiles);
app.get('/api/files/:fileId', authenticateToken, fileController.getFile);

// 4. Call Management & WebRTC
app.get('/api/calls/ice-servers', authenticateToken, callController.getIceServers);
app.post('/api/calls/initiate', authenticateToken, callController.initiateCall);
app.put('/api/calls/:callId/status', authenticateToken, callController.updateCallStatus);

// 5. Owner Dashboard Dedicated API (Protected role: owner only)
app.get('/api/owner/conversations', authenticateToken, requireOwner, ownerController.getAllConversations);
app.put('/api/owner/conversations/:conversationId', authenticateToken, requireOwner, ownerController.updateConversationMeta);
app.delete('/api/owner/conversations/:conversationId', authenticateToken, requireOwner, ownerController.deleteConversation);
app.post('/api/owner/users/:userId/block', authenticateToken, requireOwner, ownerController.toggleBlockUser);
app.get('/api/owner/calls', authenticateToken, requireOwner, ownerController.getAllCalls);
app.get('/api/owner/settings', authenticateToken, requireOwner, ownerController.getSettings);
app.put('/api/owner/settings', authenticateToken, requireOwner, ownerController.updateSettings);

// Error handler untuk upload file multer
app.use((err, req, res, next) => {
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: `Ukuran file melebihi batas maksimal (${config.maxFileSizeMb}MB).` });
    }
    return res.status(400).json({ success: false, message: `Kesalahan upload: ${err.message}` });
  }
  if (err) {
    return res.status(500).json({ success: false, message: err.message || 'Terjadi kesalahan internal server.' });
  }
  next();
});

// Fallback route 404
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).sendFile(path.resolve(__dirname, '..', 'public', '404.html'));
  }
  res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' });
});

// Inisialisasi Socket.IO
initSocket(io);

// Jalankan Server
async function startServer() {
  try {
    await seedOwner();
    server.listen(config.port, config.host, () => {
      console.log('====================================================');
      console.log(`🚀 ZhanChat Server berjalan di http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
      console.log(`📱 Mode: ${config.nodeEnv}`);
      console.log(`🔐 Akun Owner default siap digunakan.`);
      console.log('====================================================');
    });
  } catch (err) {
    console.error('Gagal menjalankan server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, io };
