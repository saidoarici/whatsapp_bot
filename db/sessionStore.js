const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Veritabanı klasörü oluşturulmamışsa oluştur
const dbFolder = path.join(__dirname, 'data');
if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
}

// session.db dosyasını aç
const db = new Database(path.join(dbFolder, 'session.db'));

// Session tablosunu oluştur (eğer yoksa)
db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        request_id INTEGER,
        step TEXT,               -- Örn: waiting_for_decision, selecting_account, pdf_connect_selection
        session_type TEXT,       -- Örn: cash_request, pdf_connect, user_reply
        payload TEXT,            -- JSON (accounts, media vs.)
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).run();

module.exports = db;