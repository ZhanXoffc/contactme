// ===================================================================
// ZhanChat - User Chat Logic (Personal Hub Interface)
// ===================================================================

let socket = null;
let rtcManager = null;
let currentUser = null;
let ownerUser = null;
let conversationId = null;

let stagedFiles = [];
let activeReplyMessage = null;
let typingTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initUserChat();
});

async function initUserChat() {
  try {
    // 1. Ambil data sesi pengguna & profil Owner
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (!data.success || !data.user) {
      window.location.href = '/auth.html';
      return;
    }

    // Jika yang login ternyata Owner, redirect ke dashboard Owner
    if (data.user.role === 'owner') {
      window.location.href = '/owner.html';
      return;
    }

    currentUser = data.user;
    ownerUser = data.owner;
    conversationId = currentUser.conversation_id;

    // Render info header Owner
    renderOwnerHeader();
    renderUserProfileHeader();

    // 2. Hubungkan Socket.IO
    socket = io({
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      socket.emit('join_conversation', conversationId);
    });

    // 3. Inisialisasi WebRTC Manager
    rtcManager = new WebRTCManager(socket, currentUser);

    // 4. Setup Socket Event Listeners
    setupSocketListeners();

    // 5. Muat riwayat pesan
    await loadMessages();

    // 6. Tandai pesan terbaca
    markConversationAsRead();

    // 7. Setup Form, Upload, dan Drag & Drop
    setupInputAndFileUpload();
    setupModalsAndEvents();

    requestNotificationPermission();
  } catch (err) {
    console.error('Error initializing chat:', err);
    showToast('Gagal memuat sesi chat. Silakan muat ulang.', 'danger');
  }
}

function renderOwnerHeader() {
  if (!ownerUser) return;
  document.getElementById('ownerHeaderName').textContent = ownerUser.name;
  document.getElementById('ownerHeaderBio').textContent = ownerUser.bio || 'Official Personal Hub';
  const avatarEl = document.getElementById('ownerHeaderAvatar');
  if (ownerUser.avatar) {
    avatarEl.innerHTML = `<img src="${escapeHtml(ownerUser.avatar)}" alt="Owner">`;
  } else {
    avatarEl.textContent = ownerUser.name.charAt(0);
  }
}

function renderUserProfileHeader() {
  const myName = document.getElementById('myUserName');
  if (myName) myName.textContent = currentUser.name;
  const myAvatar = document.getElementById('myUserAvatar');
  if (myAvatar) {
    if (currentUser.avatar) {
      myAvatar.innerHTML = `<img src="${escapeHtml(currentUser.avatar)}" alt="Me">`;
    } else {
      myAvatar.textContent = currentUser.name.charAt(0);
    }
  }
}

function setupSocketListeners() {
  // Pesan baru masuk
  socket.on('new_message', (msg) => {
    appendMessage(msg);
    scrollToBottom();

    if (msg.sender_id !== currentUser.id) {
      playMessageSound();
      showBrowserNotification(msg.sender_name, msg.content || '[Lampiran]');
      markConversationAsRead();
    }
  });

  // Pesan diedit
  socket.on('message_edited', ({ messageId, content }) => {
    const textEl = document.getElementById(`msg-text-${messageId}`);
    if (textEl) {
      textEl.textContent = content;
      const bubble = textEl.closest('.message-bubble');
      if (bubble && !bubble.querySelector('.edited-badge')) {
        const badge = document.createElement('span');
        badge.className = 'edited-badge';
        badge.style.fontSize = '10px';
        badge.style.opacity = '0.7';
        badge.style.marginLeft = '4px';
        badge.textContent = '(diedit)';
        textEl.appendChild(badge);
      }
    }
  });

  // Pesan dihapus
  socket.on('message_deleted', ({ messageId }) => {
    const textEl = document.getElementById(`msg-text-${messageId}`);
    if (textEl) {
      textEl.innerHTML = '<i style="color:var(--text-dim);">Pesan ini telah dihapus.</i>';
      const attWrap = document.getElementById(`msg-attachments-${messageId}`);
      if (attWrap) attWrap.remove();
    }
  });

  // Pesan telah dibaca oleh lawan bicara (Owner)
  socket.on('messages_read', () => {
    document.querySelectorAll('.check-status').forEach((el) => {
      el.textContent = '✓✓';
      el.classList.add('read');
    });
  });

  // Status mengetik Owner
  socket.on('user_typing', ({ userId, userName }) => {
    if (userId !== currentUser.id) {
      const statusEl = document.getElementById('ownerOnlineStatus');
      if (statusEl) {
        statusEl.textContent = 'Sedang mengetik...';
        statusEl.classList.add('typing');
      }
    }
  });

  socket.on('user_stopped_typing', ({ userId }) => {
    if (userId !== currentUser.id) {
      const statusEl = document.getElementById('ownerOnlineStatus');
      if (statusEl) {
        statusEl.textContent = 'Online';
        statusEl.classList.remove('typing');
      }
    }
  });

  // Status online / offline Owner
  socket.on('user_status_changed', (data) => {
    if (ownerUser && data.userId === ownerUser.id) {
      const statusEl = document.getElementById('ownerOnlineStatus');
      const badgeEl = document.getElementById('ownerStatusBadge');
      if (data.isOnline) {
        if (statusEl) statusEl.textContent = 'Online';
        if (badgeEl) { badgeEl.className = 'status-badge online'; }
      } else {
        if (statusEl) statusEl.textContent = 'Offline';
        if (badgeEl) { badgeEl.className = 'status-badge offline'; }
      }
    }
  });

  // Akun diblokir
  socket.on('account_blocked_status', ({ is_blocked }) => {
    if (is_blocked) {
      alert('Akun Anda telah diblokir oleh Owner.');
      window.location.reload();
    }
  });
}

// Muat riwayat pesan
async function loadMessages() {
  const container = document.getElementById('messagesContainer');
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><p>Memuat percakapan...</p></div>';

  try {
    const res = await fetch(`/api/conversations/${conversationId}/messages?limit=100`);
    const data = await res.json();

    if (!data.success) {
      container.innerHTML = '<div class="empty-state"><p>Gagal memuat pesan.</p></div>';
      return;
    }

    container.innerHTML = '';

    if (data.messages.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👋</div>
          <h3>Mulai Percakapan Pribadi</h3>
          <p style="max-width:320px; font-size:13px;">Halo! Kirimkan pesan atau berkas pertama Anda langsung kepada Owner. Pesan bersifat privat dan rahasia.</p>
        </div>
      `;
      return;
    }

    let lastDate = '';
    data.messages.forEach((msg) => {
      const msgDate = formatDateDivider(msg.created_at);
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.textContent = msgDate;
        container.appendChild(divider);
      }
      appendMessage(msg, false);
    });

    scrollToBottom();
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

// Tambahkan pesan ke DOM
function appendMessage(msg, shouldScroll = true) {
  const container = document.getElementById('messagesContainer');
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  const isMe = msg.sender_id === currentUser.id;
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isMe ? 'me' : 'other'}`;
  bubble.id = `msg-${msg.id}`;

  let replyHtml = '';
  if (msg.reply_to) {
    replyHtml = `
      <div class="reply-context">
        <div class="reply-author">${escapeHtml(msg.reply_to.sender_name)}</div>
        <div class="reply-text">${escapeHtml(msg.reply_to.content || '[Lampiran]')}</div>
      </div>
    `;
  }

  let attachmentsHtml = '';
  if (msg.attachments && msg.attachments.length > 0) {
    attachmentsHtml = `<div class="msg-attachment-grid" id="msg-attachments-${msg.id}">`;
    msg.attachments.forEach((att) => {
      const url = `/api/files/${att.id}`;
      if (att.mime_type.startsWith('image/')) {
        attachmentsHtml += `<img src="${url}" class="attachment-img-preview" alt="${escapeHtml(att.original_name)}" onclick="openLightbox('${url}')">`;
      } else if (att.mime_type.startsWith('video/')) {
        attachmentsHtml += `<video controls class="attachment-video-preview" src="${url}"></video>`;
      } else if (att.mime_type.startsWith('audio/')) {
        attachmentsHtml += `<audio controls class="attachment-audio-player" src="${url}"></audio>`;
      } else {
        attachmentsHtml += `
          <a href="${url}" target="_blank" class="attachment-doc-card" download="${escapeHtml(att.original_name)}">
            <span class="doc-icon">📄</span>
            <div class="doc-details">
              <div class="doc-name">${escapeHtml(att.original_name)}</div>
              <div class="doc-size">${formatFileSize(att.file_size)}</div>
            </div>
          </a>
        `;
      }
    });
    attachmentsHtml += `</div>`;
  }

  const checkMarks = isMe ? (msg.status === 'read' ? '<span class="check-status read">✓✓</span>' : '<span class="check-status">✓✓</span>') : '';

  bubble.innerHTML = `
    ${replyHtml}
    ${attachmentsHtml}
    <div id="msg-text-${msg.id}">${escapeHtml(msg.content)}</div>
    <div class="message-meta">
      <span>${formatMessageTime(msg.created_at)}</span>
      ${checkMarks}
      <button class="btn-icon" style="width:20px; height:20px; font-size:12px; margin-left:4px;" title="Balas" onclick="setReplyMessage('${msg.id}', '${escapeHtml(msg.sender_name)}', '${escapeHtml(msg.content || '')}')">↩</button>
    </div>
  `;

  container.appendChild(bubble);

  if (shouldScroll) {
    scrollToBottom();
  }
}

function scrollToBottom() {
  const container = document.getElementById('messagesContainer');
  container.scrollTop = container.scrollHeight;
}

// Set pesan yang dibalas (Reply)
function setReplyMessage(id, author, text) {
  activeReplyMessage = { id, author, text };
  document.getElementById('replyAuthor').textContent = author;
  document.getElementById('replyText').textContent = text || '[Lampiran]';
  document.getElementById('activeReplyBar').classList.add('show');
  document.getElementById('chatInput').focus();
}

function clearReply() {
  activeReplyMessage = null;
  document.getElementById('activeReplyBar').classList.remove('show');
}

// Input & Pengiriman Pesan
function setupInputAndFileUpload() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('btnSendMessage');
  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzoneOverlay');

  // Cancel reply button
  document.getElementById('btnCancelReply').addEventListener('click', clearReply);

  // Trigger file browser
  document.getElementById('btnAttachFile').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    handleSelectedFiles(Array.from(e.target.files));
    fileInput.value = '';
  });

  // Typing indicator trigger
  input.addEventListener('input', () => {
    socket.emit('typing_start', { conversationId });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('typing_stop', { conversationId });
    }, 2000);
  });

  // Enter to send
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  // Drag and drop file
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.clientX <= 0 || e.clientY <= 0) {
      dropzone.classList.remove('active');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleSelectedFiles(Array.from(e.dataTransfer.files));
    }
  });
}

function handleSelectedFiles(files) {
  stagedFiles = [...stagedFiles, ...files];
  renderStagedFiles();
}

function renderStagedFiles() {
  const bar = document.getElementById('uploadStagingBar');
  bar.innerHTML = '';

  if (stagedFiles.length === 0) {
    bar.classList.remove('show');
    return;
  }

  bar.classList.add('show');
  stagedFiles.forEach((file, idx) => {
    const pill = document.createElement('div');
    pill.className = 'staging-item';
    pill.innerHTML = `
      <span>📎</span>
      <span>${escapeHtml(file.name)}</span>
      <button onclick="removeStagedFile(${idx})" style="background:none; color:var(--text-dim);">&times;</button>
    `;
    bar.appendChild(pill);
  });
}

function removeStagedFile(idx) {
  stagedFiles.splice(idx, 1);
  renderStagedFiles();
}

// Proses pengiriman
async function handleSend() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();

  if (!text && stagedFiles.length === 0) {
    return;
  }

  const progressBar = document.getElementById('uploadProgressBar');
  const progressWrap = document.getElementById('uploadProgressWrap');

  let attachmentIds = [];

  // Jika ada file yang dilampirkan, unggah terlebih dahulu
  if (stagedFiles.length > 0) {
    progressWrap.classList.add('show');
    progressBar.style.width = '30%';

    const formData = new FormData();
    stagedFiles.forEach((file) => {
      formData.append('files', file);
    });

    try {
      const uploadRes = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData
      });
      const uploadData = await uploadRes.json();

      progressBar.style.width = '70%';

      if (!uploadData.success) {
        showToast(uploadData.message || 'Gagal mengunggah file.', 'danger');
        progressWrap.classList.remove('show');
        return;
      }

      attachmentIds = uploadData.attachments.map((a) => a.id);
    } catch (err) {
      console.error('Upload error:', err);
      showToast('Gagal mengunggah berkas.', 'danger');
      progressWrap.classList.remove('show');
      return;
    }
  }

  // Kirim data pesan
  try {
    const payload = {
      content: text,
      reply_to_id: activeReplyMessage ? activeReplyMessage.id : null,
      attachment_ids: attachmentIds
    };

    const res = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (progressBar) progressBar.style.width = '100%';
    setTimeout(() => {
      progressWrap.classList.remove('show');
      progressBar.style.width = '0%';
    }, 300);

    if (!data.success) {
      showToast(data.message || 'Gagal mengirim pesan.', 'danger');
      return;
    }

    // Reset input
    input.value = '';
    stagedFiles = [];
    renderStagedFiles();
    clearReply();
    playSentSound();
  } catch (err) {
    console.error('Error sending message:', err);
    showToast('Gagal mengirim pesan.', 'danger');
    progressWrap.classList.remove('show');
  }
}

// Tandai pesan dibaca
async function markConversationAsRead() {
  if (!conversationId) return;
  try {
    await fetch(`/api/conversations/${conversationId}/read`, { method: 'POST' });
  } catch (e) {}
}

// Setup Event Panggilan Suara & Video
function setupModalsAndEvents() {
  // Tombol Voice Call
  document.getElementById('btnVoiceCall').addEventListener('click', () => {
    if (!ownerUser) return;
    rtcManager.startCall(ownerUser.id, conversationId, 'audio', ownerUser.name);
  });

  // Tombol Video Call
  document.getElementById('btnVideoCall').addEventListener('click', () => {
    if (!ownerUser) return;
    rtcManager.startCall(ownerUser.id, conversationId, 'video', ownerUser.name);
  });

  // Tombol Logout
  document.getElementById('btnLogout').addEventListener('click', async () => {
    if (confirm('Yakin ingin keluar dari akun ZhanChat?')) {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/auth.html';
    }
  });

  // Modal Pengaturan Profil Saya
  const profileDialog = document.getElementById('profileDialog');
  setupDialogBackdropDismiss(profileDialog);

  document.getElementById('btnOpenProfile').addEventListener('click', () => {
    document.getElementById('editNameInput').value = currentUser.name;
    document.getElementById('editPhoneInput').value = currentUser.phone || '';
    document.getElementById('editBioInput').value = currentUser.bio || '';
    profileDialog.showModal();
  });

  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('editNameInput').value.trim();
    const phone = document.getElementById('editPhoneInput').value.trim();
    const bio = document.getElementById('editBioInput').value.trim();

    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, bio })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Profil berhasil disimpan.', 'success');
      currentUser.name = name;
      currentUser.phone = phone;
      currentUser.bio = bio;
      renderUserProfileHeader();
      profileDialog.close();
    } else {
      showToast(data.message || 'Gagal menyimpan profil.', 'danger');
    }
  });

  // Pencarian pesan di chat
  const searchInput = document.getElementById('searchChatInput');
  if (searchInput) {
    searchInput.addEventListener('input', async (e) => {
      const q = e.target.value.trim();
      if (!q) {
        document.querySelectorAll('.message-bubble').forEach((el) => {
          el.style.display = 'block';
        });
        return;
      }
      document.querySelectorAll('.message-bubble').forEach((el) => {
        const text = el.innerText.toLowerCase();
        el.style.display = text.includes(q.toLowerCase()) ? 'block' : 'none';
      });
    });
  }
}
