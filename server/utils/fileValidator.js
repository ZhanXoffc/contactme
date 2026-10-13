const path = require('path');

// Ekstensi yang diizinkan untuk dikirim
const ALLOWED_EXTENSIONS = new Set([
  // Gambar
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  // Video
  '.mp4', '.webm', '.mov', '.mkv',
  // Audio
  '.mp3', '.wav', '.ogg', '.m4a', '.aac',
  // Dokumen
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  // Arsip
  '.zip', '.rar', '.7z', '.tar', '.gz'
]);

// Ekstensi berbahaya yang mutlak dilarang dieksekusi
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.bash', '.php', '.phtml', '.js', '.mjs',
  '.vbs', '.py', '.rb', '.pl', '.dll', '.so', '.scr', '.msi', '.com',
  '.jar', '.apk', '.iso', '.bin', '.cgi', '.action', '.jsp', '.asp', '.aspx'
]);

function isExtensionAllowed(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return false;
  }
  return ALLOWED_EXTENSIONS.has(ext);
}

function getSafeMimeCategory(mimeType) {
  if (!mimeType) return 'document';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf')) return 'pdf';
  return 'document';
}

module.exports = {
  ALLOWED_EXTENSIONS,
  DANGEROUS_EXTENSIONS,
  isExtensionAllowed,
  getSafeMimeCategory
};
