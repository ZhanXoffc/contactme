const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(__dirname, 'schema.sql');

const db = new DatabaseSync(require('../config/config').databasePath);

// Konfigurasi performa & relasi
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// Inisialisasi skema tabel jika belum ada
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);

module.exports = db;
