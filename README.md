# ZhanChat — Personal Chat Hub

**ZhanChat** adalah platform komunikasi pribadi real-time terpusat terinspirasi WhatsApp Web yang memungkinkan banyak pengguna/klien menghubungi satu akun utama (**Owner**). Seluruh komunikasi antar-pengguna terisolasi secara ketat sehingga pengguna hanya dapat berinteraksi dengan Owner tanpa dapat melihat chat, kontak, atau berkas pengguna lain.

---

## 🌟 Fitur Utama

### 1. Sistem Komunikasi Terpusat
- **Akun Tunggal Owner**: Satu akun Owner menangani seluruh pesan yang masuk secara manual dan eksklusif (bebas dari bot palsu).
- **Isolasi Privasi Pengguna**: Setiap pengunjung/pengguna memiliki ruang percakapan privat. Pengguna A tidak dapat melihat nama, riwayat, atau berkas milik Pengguna B.
- **Pesan Real-Time**: Sinkronisasi pesan instan melalui Socket.IO, status terkirim (`✓✓`), terbaca (biru `✓✓`), status sedang mengetik (*typing indicator*), dan riwayat pesan persisten.
- **Fitur Pesan Lengkap**: Dukungan balasan pesan (*reply*), pengeditan pesan (*edit*), penghapusan pesan (*delete*), dan pencarian pesan.

### 2. Panggilan Suara & Video WebRTC (Aktif & Berfungsi Penuh)
- **Voice & Video Call Dua Arah**: Komunikasi audio dan video berlatensi rendah menggunakan WebRTC standar industri.
- **Kontrol Panggilan**: Tombol mute/unmute mikrofon, on/off kamera, pergantian kamera depan dan belakang (*flip camera*), durasi panggilan (*timer*), serta penolakan/penerimaan panggilan.
- **Ringtone Audio Nyata**: Menggunakan Web Audio API synthesizer bawaan browser (bebas ketergantungan file eksternal yang rentan rusak/404).
- **Riwayat Panggilan Terpusat**: Durasi panggilan, tipe, status (missed, rejected, answered, ended), dan waktu tercatat rapi di database.

### 3. Pengiriman & Pengelolaan Berkas Aman
- **Format yang Didukung**:
  - Gambar: JPG, JPEG, PNG, WEBP, GIF (dengan pratinjau Lightbox modal).
  - Video: MP4, WEBM, MOV (dengan pemutar HTML5 inline).
  - Audio: MP3, WAV, OGG, M4A, AAC (dengan pemutar audio).
  - Dokumen: PDF (pratinjau inline), DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV.
  - Arsip: ZIP, RAR, 7Z, TAR, GZ.
- **Validasi Keamanan**: Blokir mutlak terhadap file eksekusi berbahaya (`.exe`, `.bat`, `.sh`, `.php`, `.js`, dll.).
- **Otorisasi Unduhan Privat**: Berkas disimpan di penyimpanan privat server dan hanya dapat diunduh/dilihat oleh pengirim, penerima yang sah, atau Owner (`Content-Security-Policy: sandbox; default-src 'none'`).
- **Drag-and-Drop & Multi-Upload**: Seret berkas langsung ke area chat dengan indikator progres bar (*upload progress bar*).

### 4. Dashboard Owner Profesional (WhatsApp Web Style)
- **Sidebar Navigasi & Filter Lengkap**:
  - Semua Chat (*All Chats*)
  - Belum Dibaca (*Unread*)
  - Belum Dibalas (*Unreplied*)
  - Sedang Ditangani (*In Progress*)
  - Favorit (*Favorites*)
  - Arsip (*Archived*)
  - Riwayat Panggilan (*Call History*)
  - Pengaturan Sistem (*Settings*)
- **Manajemen Kontak & Prioritas**: Label prioritas (*Normal, High, Urgent*), catatan pribadi rahasia Owner (*Private Notes*), dan tombol blokir/buka blokir instan.
- **Notifikasi Real-Time**: Pembaruan badge unread otomatis dan suara notifikasi saat ada pesan dari pengguna mana pun.

---

## 📁 Struktur Direktori

```
webcontact/
├── .env.example                  # Contoh variabel lingkungan
├── .env                          # Konfigurasi aktif server & kredensial
├── .gitignore                    # File & folder yang diabaikan Git
├── package.json                  # Konfigurasi dependensi Node.js
├── README.md                     # Dokumentasi komprehensif
├── database.sqlite               # Database SQLite lokal (dibuat otomatis)
│
├── server/
│   ├── config/
│   │   └── config.js             # Parser konfigurasi lingkungan
│   ├── controllers/
│   │   ├── authController.js     # Registrasi, login, & profil
│   │   ├── chatController.js     # Pesan, balasan, edit, hapus, read status
│   │   ├── ownerController.js    # Filter percakapan, blokir, catatan Owner
│   │   ├── fileController.js     # Upload & otorisasi unduhan file privat
│   │   └── callController.js     # WebRTC inisiasi, status, & riwayat
│   ├── middleware/
│   │   ├── authMiddleware.js     # Verifikasi token JWT & isolasi role
│   │   ├── rateLimiter.js        # Pencegah brute-force & spamming
│   │   └── uploadMiddleware.js   # Multer file storage & whitelist filter
│   ├── models/
│   │   ├── schema.sql            # Skema tabel relasional SQLite
│   │   └── db.js                 # Koneksi native node:sqlite (Node 24)
│   ├── socket/
│   │   └── socketHandler.js      # Socket.IO & signaling WebRTC audio/video
│   ├── utils/
│   │   ├── fileValidator.js      # Whitelist ekstensi & deteksi malware
│   │   └── seed.js               # Inisialisasi awal akun Owner & setting
│   └── server.js                 # Entrypoint server Express & Socket.IO
│
├── public/
│   ├── index.html                # Landing page utama
│   ├── auth.html                 # Login, registrasi, & portal Owner
│   ├── chat.html                 # Antarmuka chat pengguna privat
│   ├── owner.html                # Dashboard Owner bergaya WhatsApp Web
│   ├── 404.html                  # Halaman error not found
│   ├── css/
│   │   └── style.css             # Tema modern Dark & Blue responsif
│   └── js/
│       ├── utils.js              # Synthesizer audio, toast, format tanggal
│       ├── webrtc.js             # Engine panggilan audio & video WebRTC
│       ├── chat.js               # Logika antarmuka pengguna
│       └── owner.js              # Logika dashboard Owner
│
├── storage/
│   └── uploads/                  # Penyimpanan berkas privat aman
│
└── test/
    ├── test_suite.js             # Pengujian otomatis end-to-end utama
    └── test_offline_persistence.js # Pengujian pesan saat Owner offline
```

---

## 🚀 Panduan Menjalankan Secara Lokal (Windows / macOS / Linux)

### 1. Prasyarat
- **Node.js**: Versi 20+ atau 24 LTS (direkomendasikan).
- **NPM**: Versi 10+.

### 2. Instalasi Dependensi
Buka terminal PowerShell atau Command Prompt di folder proyek:
```powershell
npm install
```

### 3. Konfigurasi Lingkungan (`.env`)
Salin file konfigurasi contoh `.env.example` menjadi `.env`:
```powershell
Copy-Item .env.example .env
```

Isi file `.env`:
```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
JWT_SECRET=ganti-dengan-secret-acak-yang-panjang
JWT_EXPIRES_IN=7d

# Kredensial Akun Owner Awal
OWNER_NAME="Owner ZhanChat"
OWNER_EMAIL="owner@example.com"
OWNER_PASSWORD="ganti-dengan-password-kuat"
OWNER_PHONE="+6281234567890"

# Batas Ukuran Upload Berkas (MB)
MAX_FILE_SIZE_MB=50
```

Jangan gunakan nilai contoh tersebut untuk server publik. Gunakan secret acak dan password unik yang hanya Anda ketahui.

### 4. Inisialisasi Database & Akun Owner
Jalankan perintah seed untuk membuat tabel dan akun Owner awal:
```powershell
npm run seed
```

### 5. Menjalankan Server
```powershell
npm start
```
Atau untuk mode auto-reload saat pengembangan:
```powershell
npm run dev
```

Buka browser Anda di:
- **Landing Page**: [http://localhost:3000](http://localhost:3000)
- **Login / Register**: [http://localhost:3000/auth.html](http://localhost:3000/auth.html)
- **Owner Dashboard**: [http://localhost:3000/owner.html](http://localhost:3000/owner.html)

---

## 🔑 Kredensial Akun Bawaan

| Akun | Email | Kata Sandi | Halaman Akses |
|---|---|---|---|
| **Owner (Admin)** | Email dari `OWNER_EMAIL` | Password dari `OWNER_PASSWORD` saat akun Owner pertama kali dibuat | `/owner.html` |
| **Pengguna Baru** | Mendaftar sendiri via tombol "Daftar" | Bebas (min. 6 karakter) | `/chat.html` |

---

## 🧪 Pengujian Otomatis

Proyek ini dilengkapi dengan 2 suite pengujian otomatis yang menguji seluruh fitur penting:
- Isolasi privasi antar-pengguna (User A dilarang mengakses chat User B).
- Pembatasan endpoint Owner dari pengguna biasa.
- Pengiriman pesan real-time & balasan tersimpan persisten.
- Upload berkas privat dan pemblokiran unduhan tanpa izin.
- Penolakan file berekstensi berbahaya (`.bat`, `.exe`).
- Inisiasi panggilan WebRTC dan pencatatan durasi panggilan.
- Pengiriman pesan saat Owner sedang offline & verifikasi unread badge.
- Penolakan token kedaluwarsa atau palsu.

Jalankan seluruh tes dengan perintah:
```powershell
npm test
```

---

## 🌐 Panduan Deployment, HTTPS, & TURN Server

### Deploy publik di Render

Proyek ini sudah menyediakan `render.yaml` untuk membuat layanan web Node.js dengan HTTPS otomatis, Socket.IO, health check, dan disk persisten untuk database SQLite serta file upload.

1. Pastikan proyek sudah berada di repository GitHub Anda. Jangan unggah file `.env` atau kredensial.
2. Di Render, pilih **New > Blueprint**, hubungkan repository tersebut, lalu deploy blueprint dari `render.yaml`.
3. Saat diminta, isi `OWNER_EMAIL` dan `OWNER_PASSWORD` dengan kredensial kuat milik Anda. Simpan password tersebut: akun Owner dibuat pada startup pertama dan password tidak dicetak ke log.
4. Setelah deploy selesai, buka URL `https://...onrender.com` yang diberikan Render. Bagikan URL tersebut agar orang lain bisa membukanya dari Chrome.

Blueprint menggunakan paket Render berbayar karena disk persisten diperlukan agar akun, pesan, dan berkas tidak hilang saat layanan di-deploy ulang. URL `onrender.com` bisa langsung digunakan; domain sendiri bersifat opsional. Jangan gunakan kembali password yang pernah disimpan sebagai nilai bawaan atau contoh di source code.

Server lokal sudah bind ke `0.0.0.0`, tetapi alamat `localhost` hanya bisa dibuka pada komputer itu sendiri. Untuk akses internet publik, gunakan deployment di atas, bukan hanya mengganti alamat browser.

### 1. Mengapa HTTPS Diperlukan?
WebRTC dan Web Audio API mewajibkan **koneksi aman (HTTPS)** pada browser modern agar mikrofon dan kamera dapat diakses secara resmi.

### 2. Konfigurasi HTTPS dengan Nginx Reverse Proxy (Contoh di Linux/VPS)
```nginx
server {
    listen 80;
    server_name chat.domainanda.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name chat.domainanda.com;

    ssl_certificate /etc/letsencrypt/live/chat.domainanda.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.domainanda.com/privkey.pem;

    client_max_body_size 60M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Konfigurasi STUN & TURN Server untuk WebRTC
Secara default, ZhanChat menggunakan STUN publik Google:
`stun:stun.l.google.com:19302`

Jika panggilan dilakukan lintas jaringan seluler (4G/5G) atau di balik firewall Symmetric NAT yang ketat, tambahkan relay TURN server (misal dari Coturn atau Xirsys) ke file `.env`:
```env
ICE_SERVERS='[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:turn.domainanda.com:3478"],"username":"user1","credential":"passwordrahasia"}]'
```

---

## 🛡️ Kebijakan Keamanan & Kepatuhan
1. **Password Hashing**: Menggunakan `bcryptjs` dengan salting aman 12 putaran.
2. **Perlindungan Session**: Token JWT disimpan dalam cookie `HttpOnly` dengan atribut `SameSite: Lax` dan proteksi `Secure` di lingkungan produksi.
3. **Pencegahan Eksploitasi File**: Header `X-Content-Type-Options: nosniff` dan sandbox `Content-Security-Policy` memastikan file tidak dapat mengeksekusi skrip berbahaya di browser pengguna.
4. **Anti-Spam & Rate Limiter**: Membatasi percobaan login (maks. 30 per 15 menit) dan pengiriman API untuk menjamin kestabilan server.
