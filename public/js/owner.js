// ===================================================================
// ZhanChat - Owner Dashboard Logic (Professional Hub)
// ===================================================================

let socket = null;
let rtcManager = null;
let ownerUser = null;

let conversations = [];
let activeConversation = null;
let activeFilter = 'all'; // all, unread, unreplied, in_progress, favorite, archived
let searchQuery = '';

let stagedFiles = [];
let activeReplyMessage = null;
let typingTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initOwnerDashboard();
});

async function initOwnerDashboard() {
  try {
    // 1. Ambil sesi Owner
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (!data.success || !data.user || data.user.role !== 'owner') {
      window.location.href = '/auth.html';
      return;
    }

    ownerUser = data.user;
    renderOwnerProfile();

    // 2. Hubungkan Socket.IO
    socket = io({
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      // Otomatis join owner_room di backend
    });

    // 3. Inisialisasi WebRTC Manager
    rtcManager = new WebRTCManager(socket, ownerUser);

    // 4. Setup Socket Listeners Khusus Owner
    setupOwnerSocketListeners();

    // 5. Muat daftar percakapan
    await loadConversations();

    // 6. Setup Event UI & Filter
    setupFilterEvents();
    setupChatAreaEvents();
    setupSettingsEvents();

    requestNotificationPermission();
  } catch (err) {
    console.error('Error initializing owner dashboard:', err);
    showToast('Gagal memuat dashboard Owner.', 'danger');
  }
}

function renderOwnerProfile() {
  const nameEl = document.getElementById('ownerProfileName');
  if (nameEl) nameEl.textContent = ownerUser.name;
  const avatarEl = document.getElementById('ownerProfileAvatar');
  if (avatarEl) {
    if (ownerUser.avatar) {
      avatarEl.innerHTML = `<img src="${escapeHtml(ownerUser.avatar)}" alt="Owner">`;
    } else {
      avatarEl.textContent = ownerUser.name.charAt(0);
    }
  }
}

function setupOwnerSocketListeners() {
  // Notifikasi real-time jika ada user manapun mengirim pesan baru
  socket.on('owner_new_message', ({ conversation_id, message }) => {
    playMessageSound();
    showBrowserNotification(`Pesan dari ${message.sender_name}`, message.content || '[Lampiran]');

    // Jika percakapan ini sedang aktif dibuka oleh Owner
    if (activeConversation && activeConversation.id === conversation_id) {
      appendMessage(message);
      scrollToBottom();
      markActiveConversationRead();
    }

    // Perbarui daftar percakapan di sidebar secara real-time
    updateConversationInList(conversation_id, message);
  });

  // Pesan diedit
  socket.on('message_edited', ({ messageId, content, conversation_id }) => {
    if (activeConversation && activeConversation.id === conversation_id) {
      const textEl = document.getElementById(`msg-text-${messageId}`);
      if (textEl) {
        textEl.textContent = content;
      }
    }
  });

  // Pesan dihapus
  socket.on('message_deleted', ({ messageId, conversation_id }) => {
    if (activeConversation && activeConversation.id === conversation_id) {
      const textEl = document.getElementById(`msg-text-${messageId}`);
      if (textEl) {
        textEl.innerHTML = '<i style="color:var(--text-dim);">Pesan ini telah dihapus.</i>';
        const attWrap = document.getElementById(`msg-attachments-${messageId}`);
        if (attWrap) attWrap.remove();
      }
    }
  });

  // Status mengetik dari pengguna tertentu
  socket.on('user_typing', ({ conversationId, userId, userName }) => {
    const item = document.getElementById(`conv-snippet-${conversationId}`);
    if (item) {
      item.textContent = 'Sedang mengetik...';
      item.classList.add('typing');
    }
    if (activeConversation && activeConversation.id === conversationId) {
      const statusEl = document.getElementById('activeUserStatus');
      if (statusEl) statusEl.textContent = 'Sedang mengetik...';
    }
  });

  socket.on('user_stopped_typing', ({ conversationId }) => {
    const item = document.getElementById(`conv-snippet-${conversationId}`);
    if (item) {
      // Kembalikan ke teks pesan terakhir
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv) {
        item.textContent = conv.last_message_content || 'Belum ada pesan';
        item.classList.remove('typing');
      }
    }
    if (activeConversation && activeConversation.id === conversationId) {
      const statusEl = document.getElementById('activeUserStatus');
      if (statusEl) statusEl.textContent = 'Online';
    }
  });

  // Status online / offline pengguna
  socket.on('user_status_changed', (data) => {
    const badge = document.getElementById(`user-status-badge-${data.userId}`);
    if (badge) {
      badge.className = `status-badge ${data.isOnline ? 'online' : 'offline'}`;
    }
    if (activeConversation && activeConversation.user_id === data.userId) {
      const statusEl = document.getElementById('activeUserStatus');
      if (statusEl) {
        statusEl.textContent = data.isOnline ? 'Online' : 'Terakhir dilihat baru saja';
        statusEl.className = `header-status ${data.isOnline ? 'online' : ''}`;
      }
    }
  });
}

// Muat daftar seluruh percakapan dari API
async function loadConversations() {
  try {
    const url = `/api/owner/conversations?filter=${activeFilter}&search=${encodeURIComponent(searchQuery)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Gagal memuat daftar percakapan.', 'danger');
      return;
    }

    conversations = data.conversations || [];
    renderConversationList();

    // Perbarui badge unread pada rail tab
    const totalUnread = conversations.reduce((acc, c) => acc + (c.unread_count || 0), 0);
    const railBadge = document.getElementById('railUnreadBadge');
    if (railBadge) {
      railBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
      railBadge.style.display = totalUnread > 0 ? 'flex' : 'none';
    }
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

// Render daftar percakapan di kolom kiri
function renderConversationList() {
  const listEl = document.getElementById('conversationList');
  listEl.innerHTML = '';

  if (conversations.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>Tidak ada percakapan ditemukan.</p>
      </div>
    `;
    return;
  }

  conversations.forEach((conv) => {
    const li = document.createElement('li');
    li.className = `conversation-item ${activeConversation && activeConversation.id === conv.id ? 'active' : ''}`;
    li.id = `conv-item-${conv.id}`;
    li.onclick = () => selectConversation(conv.id);

    const isUnread = conv.unread_count > 0;
    const priorityBadge = conv.priority && conv.priority !== 'normal'
      ? `<span class="badge badge-${conv.priority}">${conv.priority}</span>`
      : '';

    li.innerHTML = `
      <div class="avatar">
        ${conv.user_avatar ? `<img src="${escapeHtml(conv.user_avatar)}" alt="${escapeHtml(conv.user_name)}">` : conv.user_name.charAt(0)}
        <div class="status-badge offline" id="user-status-badge-${conv.user_id}"></div>
      </div>
      <div class="conv-info">
        <div class="conv-top">
          <div class="conv-name">${escapeHtml(conv.user_name)}</div>
          <div class="conv-time">${formatMessageTime(conv.last_message_time || conv.updated_at)}</div>
        </div>
        <div class="conv-bottom">
          <div class="conv-snippet" id="conv-snippet-${conv.id}">
            ${escapeHtml(conv.last_message_content || 'Percakapan baru dibuat')}
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            ${priorityBadge}
            ${isUnread ? `<span class="badge badge-unread">${conv.unread_count}</span>` : ''}
          </div>
        </div>
      </div>
    `;

    listEl.appendChild(li);

    // Periksa status online socket
    if (socket) {
      socket.emit('check_online', { targetUserId: conv.user_id }, ({ isOnline }) => {
        const badge = document.getElementById(`user-status-badge-${conv.user_id}`);
        if (badge && isOnline) {
          badge.className = 'status-badge online';
        }
      });
    }
  });
}

// Update item percakapan di sidebar ketika pesan baru tiba
function updateConversationInList(convId, message) {
  let conv = conversations.find((c) => c.id === convId);
  if (conv) {
    conv.last_message_content = message.content || '[Lampiran]';
    conv.last_message_time = message.created_at;
    if (!activeConversation || activeConversation.id !== convId) {
      conv.unread_count = (conv.unread_count || 0) + 1;
    }
    // Pindahkan percakapan ke urutan paling atas
    conversations = [conv, ...conversations.filter((c) => c.id !== convId)];
    renderConversationList();
  } else {
    // Muat ulang daftar untuk menampilkan user baru
    loadConversations();
  }
}

// Buka dan pilih salah satu percakapan
async function selectConversation(convId) {
  const conv = conversations.find((c) => c.id === convId);
  if (!conv) return;

  // Jika sebelumnya ada room percakapan yang aktif, tinggalkan
  if (activeConversation && socket) {
    socket.emit('leave_conversation', activeConversation.id);
  }

  activeConversation = conv;
  conv.unread_count = 0; // reset local unread
  renderConversationList();

  // Aktifkan room di Socket
  if (socket) {
    socket.emit('join_conversation', conv.id);
  }

  // Tampilkan container chat & sembunyikan placeholder
  document.getElementById('noChatSelected').style.display = 'none';
  document.getElementById('activeChatContainer').style.display = 'flex';

  // Render Header Chat Aktif
  renderActiveChatHeader();

  // Render Catatan & Metadata Panel Kanan
  renderRightDetailsPanel();

  // Muat riwayat pesan percakapan ini
  await loadActiveMessages();

  // Tandai pesan sudah dibaca di backend
  markActiveConversationRead();

  // Responsif mobile: tandai chat aktif
  document.querySelector('.app-container').classList.add('chat-active');
}

function renderActiveChatHeader() {
  const conv = activeConversation;
  document.getElementById('activeUserName').textContent = conv.user_name;
  document.getElementById('activeUserStatus').textContent = 'Online';

  const avatarEl = document.getElementById('activeUserAvatar');
  if (conv.user_avatar) {
    avatarEl.innerHTML = `<img src="${escapeHtml(conv.user_avatar)}" alt="${escapeHtml(conv.user_name)}">`;
  } else {
    avatarEl.textContent = conv.user_name.charAt(0);
  }

  // Update status tombol blokir
  const btnBlock = document.getElementById('btnToggleBlock');
  if (btnBlock) {
    btnBlock.textContent = conv.user_is_blocked ? 'Buka Blokir' : 'Blokir Pengguna';
    btnBlock.className = conv.user_is_blocked ? 'btn-secondary' : 'btn-danger';
  }
}

function renderRightDetailsPanel() {
  const conv = activeConversation;
  document.getElementById('detailsUserName').textContent = conv.user_name;
  document.getElementById('detailsUserEmail').textContent = conv.user_email || '-';
  document.getElementById('detailsUserPhone').textContent = conv.user_phone || '-';
  document.getElementById('detailsUserBio').textContent = conv.user_bio || 'Pengguna ZhanChat';

  const notesInput = document.getElementById('ownerNotesInput');
  if (notesInput) notesInput.value = conv.owner_notes || '';

  const prioritySelect = document.getElementById('convPrioritySelect');
  if (prioritySelect) prioritySelect.value = conv.priority || 'normal';

  const statusSelect = document.getElementById('convStatusSelect');
  if (statusSelect) statusSelect.value = conv.status || 'active';
}

// Muat riwayat pesan di panel tengah
async function loadActiveMessages() {
  const container = document.getElementById('messagesContainer');
  container.innerHTML = '<div class="empty-state"><p>Memuat pesan...</p></div>';

  try {
    const res = await fetch(`/api/conversations/${activeConversation.id}/messages?limit=100`);
    const data = await res.json();

    if (!data.success) {
      container.innerHTML = '<div class="empty-state"><p>Gagal memuat pesan.</p></div>';
      return;
    }

    container.innerHTML = '';
    if (data.messages.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💬</div>
          <h3>Belum Ada Pesan</h3>
          <p style="font-size:13px;">Pengguna belum mengirimkan pesan. Anda dapat memulai menyapa terlebih dahulu.</p>
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
    console.error('Error loading active messages:', err);
  }
}

// Tambahkan bubble pesan
function appendMessage(msg, shouldScroll = true) {
  const container = document.getElementById('messagesContainer');
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  const isMe = msg.sender_id === ownerUser.id;
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

// Setup Event Input dan Pengiriman
function setupChatAreaEvents() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('btnSendMessage');
  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzoneOverlay');

  document.getElementById('btnCancelReply').addEventListener('click', clearReply);

  document.getElementById('btnAttachFile').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    handleSelectedFiles(Array.from(e.target.files));
    fileInput.value = '';
  });

  // Typing indicator
  input.addEventListener('input', () => {
    if (activeConversation) {
      socket.emit('typing_start', { conversationId: activeConversation.id });
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        socket.emit('typing_stop', { conversationId: activeConversation.id });
      }, 2000);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleOwnerSend();
    }
  });

  sendBtn.addEventListener('click', handleOwnerSend);

  // Drag and drop
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dropzone) dropzone.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.clientX <= 0 || e.clientY <= 0) {
      if (dropzone) dropzone.classList.remove('active');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dropzone) dropzone.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleSelectedFiles(Array.from(e.dataTransfer.files));
    }
  });

  // Voice Call & Video Call dari Owner ke Pengguna
  document.getElementById('btnVoiceCall').addEventListener('click', () => {
    if (!activeConversation) return;
    rtcManager.startCall(activeConversation.user_id, activeConversation.id, 'audio', activeConversation.user_name);
  });

  document.getElementById('btnVideoCall').addEventListener('click', () => {
    if (!activeConversation) return;
    rtcManager.startCall(activeConversation.user_id, activeConversation.id, 'video', activeConversation.user_name);
  });

  // Tombol Blokir / Buka Blokir
  document.getElementById('btnToggleBlock').addEventListener('click', async () => {
    if (!activeConversation) return;
    const actionText = activeConversation.user_is_blocked ? 'membuka blokir' : 'memblokir';
    if (!confirm(`Yakin ingin ${actionText} pengguna ${activeConversation.user_name}?`)) return;

    const res = await fetch(`/api/owner/users/${activeConversation.user_id}/block`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      activeConversation.user_is_blocked = data.is_blocked ? 1 : 0;
      renderActiveChatHeader();
    } else {
      showToast(data.message || 'Gagal mengubah status blokir.', 'danger');
    }
  });

  // Auto-save Catatan Owner & Prioritas
  const saveNotesBtn = document.getElementById('btnSaveNotes');
  if (saveNotesBtn) {
    saveNotesBtn.addEventListener('click', async () => {
      if (!activeConversation) return;
      const notes = document.getElementById('ownerNotesInput').value;
      const priority = document.getElementById('convPrioritySelect').value;
      const status = document.getElementById('convStatusSelect').value;

      const res = await fetch(`/api/owner/conversations/${activeConversation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_notes: notes, priority, status })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Catatan & pengaturan percakapan disimpan.', 'success');
        activeConversation.owner_notes = notes;
        activeConversation.priority = priority;
        activeConversation.status = status;
        renderConversationList();
      } else {
        showToast(data.message || 'Gagal menyimpan catatan.', 'danger');
      }
    });
  }

  // Tombol Hapus Percakapan
  document.getElementById('btnDeleteConversation').addEventListener('click', async () => {
    if (!activeConversation) return;
    if (!confirm(`Hapus seluruh riwayat percakapan dengan ${activeConversation.user_name}? Tindakan ini tidak dapat dibatalkan.`)) return;

    const res = await fetch(`/api/owner/conversations/${activeConversation.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Percakapan berhasil dihapus.', 'info');
      conversations = conversations.filter((c) => c.id !== activeConversation.id);
      activeConversation = null;
      document.getElementById('noChatSelected').style.display = 'flex';
      document.getElementById('activeChatContainer').style.display = 'none';
      renderConversationList();
    } else {
      showToast(data.message || 'Gagal menghapus percakapan.', 'danger');
    }
  });

  // Tombol kembali di mobile
  document.getElementById('btnBackToList').addEventListener('click', () => {
    document.querySelector('.app-container').classList.remove('chat-active');
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

// Owner Mengirim Pesan
async function handleOwnerSend() {
  if (!activeConversation) return;
  const input = document.getElementById('chatInput');
  const text = input.value.trim();

  if (!text && stagedFiles.length === 0) return;

  const progressBar = document.getElementById('uploadProgressBar');
  const progressWrap = document.getElementById('uploadProgressWrap');
  let attachmentIds = [];

  if (stagedFiles.length > 0) {
    progressWrap.classList.add('show');
    progressBar.style.width = '30%';

    const formData = new FormData();
    stagedFiles.forEach((f) => formData.append('files', f));

    try {
      const uploadRes = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData
      });
      const uploadData = await uploadRes.json();
      progressBar.style.width = '70%';

      if (!uploadData.success) {
        showToast(uploadData.message || 'Gagal mengunggah berkas.', 'danger');
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

  try {
    const payload = {
      content: text,
      reply_to_id: activeReplyMessage ? activeReplyMessage.id : null,
      attachment_ids: attachmentIds
    };

    const res = await fetch(`/api/conversations/${activeConversation.id}/messages`, {
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

async function markActiveConversationRead() {
  if (!activeConversation) return;
  try {
    await fetch(`/api/conversations/${activeConversation.id}/read`, { method: 'POST' });
  } catch (e) {}
}

// Setup Event Filter & Tab Navigasi Rail
function setupFilterEvents() {
  // Tabs Rail Kiri (Semua Chat, Belum Dibaca, Belum Dibalas, Riwayat Panggilan, Pengaturan)
  document.querySelectorAll('.rail-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;

      if (tab === 'calls') {
        openCallHistoryModal();
      } else if (tab === 'settings') {
        openSettingsModal();
      } else {
        activeFilter = tab;
        loadConversations();
      }
    });
  });

  // Tabs Filter di atas daftar chat
  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      loadConversations();
    });
  });

  // Pencarian pengguna di sidebar
  const searchInput = document.getElementById('searchUsersInput');
  if (searchInput) {
    let searchDebounce;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchQuery = e.target.value.trim();
        loadConversations();
      }, 300);
    });
  }

  // Tombol Logout Owner
  document.getElementById('btnOwnerLogout').addEventListener('click', async () => {
    if (confirm('Keluar dari sesi Owner ZhanChat?')) {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/auth.html';
    }
  });
}

// Modal Riwayat Panggilan
async function openCallHistoryModal() {
  const dialog = document.getElementById('callHistoryDialog');
  setupDialogBackdropDismiss(dialog);

  const container = document.getElementById('callHistoryList');
  container.innerHTML = '<p>Memuat riwayat...</p>';
  dialog.showModal();

  try {
    const res = await fetch('/api/owner/calls');
    const data = await res.json();
    if (!data.success || !data.calls || data.calls.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim); text-align:center;">Belum ada riwayat panggilan.</p>';
      return;
    }

    container.innerHTML = '';
    data.calls.forEach((c) => {
      const item = document.createElement('div');
      item.style.padding = '10px';
      item.style.borderBottom = '1px solid var(--border-color)';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';

      const typeIcon = c.call_type === 'video' ? '📹' : '📞';
      const mins = Math.floor(c.duration_seconds / 60);
      const secs = c.duration_seconds % 60;
      const durStr = `${mins}m ${secs}s`;

      item.innerHTML = `
        <div>
          <div style="font-weight:600;">${typeIcon} ${escapeHtml(c.caller_name)} ➔ ${escapeHtml(c.receiver_name)}</div>
          <div style="font-size:12px; color:var(--text-dim);">${formatMessageTime(c.started_at)} | Status: <b>${c.status}</b></div>
        </div>
        <div style="font-size:13px; color:var(--accent-cyan); font-weight:600;">${durStr}</div>
      `;
      container.appendChild(item);
    });
  } catch (err) {
    container.innerHTML = '<p>Gagal memuat riwayat.</p>';
  }
}

// Modal Pengaturan Aplikasi
async function openSettingsModal() {
  const dialog = document.getElementById('settingsDialog');
  setupDialogBackdropDismiss(dialog);
  dialog.showModal();

  try {
    const res = await fetch('/api/owner/settings');
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      if (document.getElementById('settingMaxFileSize')) document.getElementById('settingMaxFileSize').value = s.max_file_size_mb || '50';
      if (document.getElementById('settingAllowReg')) document.getElementById('settingAllowReg').checked = s.allow_registration === 'true';
      if (document.getElementById('settingAllowVoice')) document.getElementById('settingAllowVoice').checked = s.allow_voice_call === 'true';
      if (document.getElementById('settingAllowVideo')) document.getElementById('settingAllowVideo').checked = s.allow_video_call === 'true';
    }
  } catch (err) {}
}

function setupSettingsEvents() {
  const form = document.getElementById('settingsForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const settings = {
        max_file_size_mb: document.getElementById('settingMaxFileSize').value,
        allow_registration: document.getElementById('settingAllowReg').checked ? 'true' : 'false',
        allow_voice_call: document.getElementById('settingAllowVoice').checked ? 'true' : 'false',
        allow_video_call: document.getElementById('settingAllowVideo').checked ? 'true' : 'false'
      };

      const res = await fetch('/api/owner/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Pengaturan aplikasi berhasil disimpan.', 'success');
        document.getElementById('settingsDialog').close();
      } else {
        showToast(data.message || 'Gagal menyimpan pengaturan.', 'danger');
      }
    });
  }
}
