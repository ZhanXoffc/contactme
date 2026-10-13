// ===================================================================
// ZhanChat WebRTC Voice & Video Call Engine
// ===================================================================

class WebRTCManager {
  constructor(socket, currentUser) {
    this.socket = socket;
    this.currentUser = currentUser;

    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;

    this.currentCallId = null;
    this.currentPeerId = null;
    this.currentConversationId = null;
    this.callType = 'audio'; // 'audio' | 'video'
    this.isCaller = false;

    this.callTimerInterval = null;
    this.callSeconds = 0;
    this.iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

    this.isMicMuted = false;
    this.isVideoOff = false;
    this.currentFacingMode = 'user'; // 'user' atau 'environment'

    this.initUI();
    this.initSocketEvents();
    this.fetchIceServers();
  }

  async fetchIceServers() {
    try {
      const res = await fetch('/api/calls/ice-servers');
      const data = await res.json();
      if (data.success && data.iceServers && data.iceServers.length > 0) {
        this.iceServers = data.iceServers;
      }
    } catch (e) {
      console.warn('Menggunakan STUN server fallback:', e);
    }
  }

  initUI() {
    // Modal dialog panggilan utama
    this.callDialog = document.getElementById('callDialog');
    if (!this.callDialog) {
      this.callDialog = document.createElement('dialog');
      this.callDialog.id = 'callDialog';
      this.callDialog.className = 'call-modal';
      this.callDialog.innerHTML = `
        <div class="call-content">
          <div class="video-stream-container" id="videoStreamContainer">
            <video id="remoteVideo" class="remote-video" autoplay playsinline></video>
            <video id="localVideo" class="local-video" autoplay playsinline muted></video>
            <div id="audioDisplay" class="audio-call-display">
              <div class="pulse-avatar" id="callAvatar">📞</div>
              <h3 id="callPeerName" style="margin-top:12px; font-size:20px;">Memanggil...</h3>
              <div class="call-status-label" id="callStatusLabel">Menghubungkan...</div>
              <div class="call-timer" id="callDurationDisplay">00:00</div>
            </div>
          </div>
          <div class="call-controls-bar">
            <button class="call-ctrl-btn" id="btnToggleMic" title="Mute/Unmute Mic">🎤</button>
            <button class="call-ctrl-btn" id="btnToggleVideo" title="Kamera On/Off">📹</button>
            <button class="call-ctrl-btn" id="btnFlipCamera" title="Ganti Kamera">🔄</button>
            <button class="call-ctrl-btn btn-hangup" id="btnHangup" title="Akhiri Panggilan">❌</button>
          </div>
        </div>
      `;
      document.body.appendChild(this.callDialog);
    }

    // Popup Panggilan Masuk (Incoming Call)
    this.incomingBox = document.getElementById('incomingCallBox');
    if (!this.incomingBox) {
      this.incomingBox = document.createElement('div');
      this.incomingBox.id = 'incomingCallBox';
      this.incomingBox.className = 'incoming-call-box';
      this.incomingBox.innerHTML = `
        <div class="avatar avatar-md" id="incomingCallerAvatar">?</div>
        <div>
          <h4 id="incomingCallerName" style="font-size:15px; font-weight:600;">Panggilan Masuk</h4>
          <p id="incomingCallType" style="font-size:12px; color:var(--text-dim);">Panggilan Suara...</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-accept-call" id="btnAcceptIncoming" title="Terima Panggilan">📞</button>
          <button class="btn-reject-call" id="btnRejectIncoming" title="Tolak Panggilan">❌</button>
        </div>
      `;
      document.body.appendChild(this.incomingBox);
    }

    // Bind event kontrol panggilan
    document.getElementById('btnToggleMic').addEventListener('click', () => this.toggleMic());
    document.getElementById('btnToggleVideo').addEventListener('click', () => this.toggleVideo());
    document.getElementById('btnFlipCamera').addEventListener('click', () => this.flipCamera());
    document.getElementById('btnHangup').addEventListener('click', () => this.endCall());

    document.getElementById('btnAcceptIncoming').addEventListener('click', () => this.acceptCall());
    document.getElementById('btnRejectIncoming').addEventListener('click', () => this.rejectCall());
  }

  initSocketEvents() {
    // 1. Panggilan masuk diterima
    this.socket.on('incoming_call', (data) => {
      this.handleIncomingCall(data);
    });

    // 2. Lawan bicara menerima panggilan
    this.socket.on('call_accepted', async (data) => {
      stopRingtone();
      this.updateCallStatusDisplay('Tersambung');
      this.startTimer();
      // Caller membuat WebRTC Offer
      await this.createOffer();
    });

    // 3. Lawan bicara menolak panggilan
    this.socket.on('call_rejected', (data) => {
      stopRingtone();
      showToast(`Panggilan ditolak: ${data.reason}`, 'warning');
      this.cleanupCall();
    });

    // 4. Panggilan diakhiri oleh lawan bicara
    this.socket.on('call_ended', (data) => {
      stopRingtone();
      showToast('Panggilan telah diakhiri oleh lawan bicara.', 'info');
      this.cleanupCall();
    });

    // 5. Signaling WebRTC Offer
    this.socket.on('webrtc_offer', async (data) => {
      await this.handleOffer(data);
    });

    // 6. Signaling WebRTC Answer
    this.socket.on('webrtc_answer', async (data) => {
      await this.handleAnswer(data);
    });

    // 7. Signaling ICE Candidate
    this.socket.on('webrtc_ice_candidate', async (data) => {
      if (this.peerConnection && data.candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.warn('Error adding ICE candidate:', e);
        }
      }
    });
  }

  // Mulai memanggil (Caller)
  async startCall(peerId, conversationId, callType = 'audio', peerName = 'Pengguna') {
    if (this.currentCallId) {
      showToast('Anda sedang berada dalam panggilan aktif.', 'warning');
      return;
    }

    try {
      this.isCaller = true;
      this.currentPeerId = peerId;
      this.currentConversationId = conversationId;
      this.callType = callType;
      this.callSeconds = 0;

      // Inisiasi ke backend API
      const res = await fetch('/api/calls/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          receiverId: peerId,
          callType
        })
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.message || 'Gagal memulai panggilan.', 'danger');
        return;
      }

      this.currentCallId = data.callId;

      // Dapatkan akses perangkat media
      await this.getMediaStream(callType);

      // Tampilkan UI modal panggilan
      this.showCallModal(peerName, callType, 'Memanggil...');
      startRingtone();

      // Kirim sinyal panggilan ke server
      this.socket.emit('call_request', {
        receiverId: peerId,
        conversationId,
        callType,
        callId: this.currentCallId
      });
    } catch (err) {
      console.error('Error starting call:', err);
      showToast('Gagal mengakses mikrofon atau kamera. Pastikan izin telah diberikan.', 'danger');
      this.cleanupCall();
    }
  }

  // Tangani panggilan masuk (Receiver)
  handleIncomingCall(data) {
    this.pendingCallData = data;
    this.currentCallId = data.callId;
    this.currentPeerId = data.caller.id;
    this.currentConversationId = data.conversationId;
    this.callType = data.callType;
    this.isCaller = false;

    // Tampilkan notifikasi panggilan masuk
    document.getElementById('incomingCallerName').textContent = data.caller.name;
    document.getElementById('incomingCallType').textContent = `Panggilan ${data.callType === 'video' ? 'Video' : 'Suara'} Masuk...`;
    document.getElementById('incomingCallerAvatar').textContent = data.caller.name.charAt(0);

    this.incomingBox.classList.add('show');
    startRingtone();
    showBrowserNotification('Panggilan Masuk!', `${data.caller.name} memanggil Anda.`);
  }

  // Terima panggilan
  async acceptCall() {
    this.incomingBox.classList.remove('show');
    stopRingtone();

    if (!this.pendingCallData) return;

    try {
      await this.getMediaStream(this.callType);
      this.showCallModal(this.pendingCallData.caller.name, this.callType, 'Menghubungkan...');

      // Beritahu caller bahwa panggilan diterima
      this.socket.emit('call_accept', {
        callerId: this.pendingCallData.caller.id,
        callId: this.currentCallId
      });

      // Update backend
      fetch(`/api/calls/${this.currentCallId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' })
      });

      this.setupPeerConnection();
      this.startTimer();
    } catch (err) {
      console.error('Error accepting call:', err);
      showToast('Gagal membuka perangkat media.', 'danger');
      this.rejectCall();
    }
  }

  // Tolak panggilan
  rejectCall() {
    this.incomingBox.classList.remove('show');
    stopRingtone();

    if (this.currentCallId && this.currentPeerId) {
      this.socket.emit('call_reject', {
        callerId: this.currentPeerId,
        callId: this.currentCallId,
        reason: 'Panggilan ditolak oleh penerima.'
      });

      fetch(`/api/calls/${this.currentCallId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      });
    }

    this.cleanupCall();
  }

  // Akhiri panggilan (Hang up)
  endCall() {
    stopRingtone();
    if (this.currentCallId && this.currentPeerId) {
      this.socket.emit('call_end', {
        peerId: this.currentPeerId,
        callId: this.currentCallId,
        durationSeconds: this.callSeconds
      });

      fetch(`/api/calls/${this.currentCallId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ended',
          durationSeconds: this.callSeconds
        })
      });
    }

    this.cleanupCall();
  }

  // Akses MediaStream kamera/mikrofon
  async getMediaStream(callType) {
    const constraints = {
      audio: true,
      video: callType === 'video' ? { facingMode: this.currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } } : false
    };

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    const localVideo = document.getElementById('localVideo');
    if (callType === 'video') {
      localVideo.srcObject = this.localStream;
      localVideo.style.display = 'block';
    } else {
      localVideo.style.display = 'none';
    }
  }

  // Buat RTCPeerConnection
  setupPeerConnection() {
    if (this.peerConnection) return;

    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    // Tambahkan track lokal ke PeerConnection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Tangani track remote masuk
    this.peerConnection.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      const remoteVideo = document.getElementById('remoteVideo');
      remoteVideo.srcObject = this.remoteStream;
      if (this.callType === 'video') {
        remoteVideo.style.display = 'block';
        document.getElementById('audioDisplay').style.display = 'none';
      }
    };

    // Tangani ICE Candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.currentPeerId) {
        this.socket.emit('webrtc_ice_candidate', {
          targetId: this.currentPeerId,
          candidate: event.candidate,
          callId: this.currentCallId
        });
      }
    };

    // Status koneksi berubah
    this.peerConnection.onconnectionstatechange = () => {
      if (this.peerConnection) {
        const state = this.peerConnection.connectionState;
        if (state === 'connected') {
          this.updateCallStatusDisplay('Terhubung');
        } else if (state === 'disconnected' || state === 'failed') {
          this.updateCallStatusDisplay('Mencoba menyambungkan kembali...');
        }
      }
    };
  }

  // Caller: Create Offer
  async createOffer() {
    this.setupPeerConnection();
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.socket.emit('webrtc_offer', {
        targetId: this.currentPeerId,
        sdp: offer,
        callId: this.currentCallId
      });
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  }

  // Receiver: Handle Offer & Create Answer
  async handleOffer(data) {
    this.setupPeerConnection();
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.socket.emit('webrtc_answer', {
        targetId: data.fromId,
        sdp: answer,
        callId: this.currentCallId
      });
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  }

  // Caller: Handle Answer
  async handleAnswer(data) {
    try {
      if (this.peerConnection) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  }

  // Kontrol audio (Mute/Unmute)
  toggleMic() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.isMicMuted = !this.isMicMuted;
      audioTrack.enabled = !this.isMicMuted;
      const btn = document.getElementById('btnToggleMic');
      btn.textContent = this.isMicMuted ? '🔇' : '🎤';
      btn.classList.toggle('active-off', this.isMicMuted);
      showToast(this.isMicMuted ? 'Mikrofon dinonaktifkan (Muted)' : 'Mikrofon aktif', 'info');
    }
  }

  // Kontrol video (Kamera On/Off)
  toggleVideo() {
    if (!this.localStream || this.callType !== 'video') return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      this.isVideoOff = !this.isVideoOff;
      videoTrack.enabled = !this.isVideoOff;
      const btn = document.getElementById('btnToggleVideo');
      btn.textContent = this.isVideoOff ? '🚫' : '📹';
      btn.classList.toggle('active-off', this.isVideoOff);
    }
  }

  // Ganti kamera depan / belakang (Flip Camera)
  async flipCamera() {
    if (this.callType !== 'video' || !this.localStream) return;
    this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.currentFacingMode }
      });
      const newVideoTrack = newStream.getVideoTracks()[0];

      // Ganti track pada RTCPeerConnection
      const sender = this.peerConnection.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }

      this.localStream.removeTrack(videoTrack);
      this.localStream.addTrack(newVideoTrack);
      document.getElementById('localVideo').srcObject = this.localStream;
      showToast('Kamera dialihkan.', 'info');
    } catch (err) {
      console.warn('Gagal membalik kamera:', err);
    }
  }

  // Tampilkan Modal Panggilan
  showCallModal(peerName, callType, initialStatus) {
    document.getElementById('callPeerName').textContent = peerName;
    document.getElementById('callStatusLabel').textContent = initialStatus;
    document.getElementById('callDurationDisplay').textContent = '00:00';

    const remoteVideo = document.getElementById('remoteVideo');
    const localVideo = document.getElementById('localVideo');
    const audioDisplay = document.getElementById('audioDisplay');
    const btnFlip = document.getElementById('btnFlipCamera');
    const btnVideo = document.getElementById('btnToggleVideo');

    if (callType === 'video') {
      remoteVideo.style.display = 'block';
      localVideo.style.display = 'block';
      audioDisplay.style.display = 'none';
      btnFlip.style.display = 'flex';
      btnVideo.style.display = 'flex';
    } else {
      remoteVideo.style.display = 'none';
      localVideo.style.display = 'none';
      audioDisplay.style.display = 'flex';
      btnFlip.style.display = 'none';
      btnVideo.style.display = 'none';
    }

    this.callDialog.showModal();
  }

  updateCallStatusDisplay(text) {
    const el = document.getElementById('callStatusLabel');
    if (el) el.textContent = text;
  }

  startTimer() {
    if (this.callTimerInterval) clearInterval(this.callTimerInterval);
    this.callSeconds = 0;
    this.callTimerInterval = setInterval(() => {
      this.callSeconds++;
      const mins = String(Math.floor(this.callSeconds / 60)).padStart(2, '0');
      const secs = String(this.callSeconds % 60).padStart(2, '0');
      const display = document.getElementById('callDurationDisplay');
      if (display) display.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  cleanupCall() {
    stopRingtone();
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.callDialog && this.callDialog.open) {
      this.callDialog.close();
    }

    this.currentCallId = null;
    this.currentPeerId = null;
    this.currentConversationId = null;
    this.isCaller = false;
    this.pendingCallData = null;
  }
}

window.WebRTCManager = WebRTCManager;
