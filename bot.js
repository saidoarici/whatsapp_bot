// bot.js - hardened version
const {Client, LocalAuth, MessageMedia} = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const crypto = require('crypto');
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

// --- Güvenli env tabanlı izin listeleri (boşsa eski varsayılanlara düşer) ---
const allowedGroupNames =
  (process.env.ALLOWED_GROUPS || 'Alssata accounting,BOT TEST,SALARY & DEBT')
    .split(',').map(s => s.trim()).filter(Boolean);

const allowedNumbers =
  (process.env.ALLOWED_NUMBERS || '905431205525@c.us,905319231182@c.us,905496616695@c.us')
    .split(',').map(s => s.trim()).filter(Boolean);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: puppeteer.executablePath(),
        defaultViewport: null
    }
});

// --- helpers ---
async function resolveUserJid(raw) {
    try {
        // zaten JID ise
        if (typeof raw === 'string' && raw.endsWith('@c.us')) {
            const ok = await client.isRegisteredUser(raw);
            return ok ? raw : null;
        }
        // sadece rakamları al
        const digits = String(raw || '').replace(/\D/g, '');
        if (!digits) return null;

        // numarayı JID'e çevir ve kayıtlı mı bak
        const wid = await client.getNumberId(digits); // null olabilir
        if (!wid || !wid._serialized) return null;
        const jid = wid._serialized;
        const ok = await client.isRegisteredUser(jid);
        return ok ? jid : null;
    } catch (err) {
        console.error('❌ resolveUserJid hata:', err.message);
        return null;
    }
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// --- HMAC helpers (Flask ile birebir uyumlu) ---
function hmacSign(secret, ts, nonce, rawBodyBuf) {
    const prefix = Buffer.from(String(ts) + '.' + nonce + '.', 'utf8');
    const msg = Buffer.concat([prefix, rawBodyBuf]);
    return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

async function postSigned(path, payloadObj, timeoutMs = 10000) {
    const base = process.env.PY_BACKEND_BASE || 'http://127.0.0.1:3001';
    const url = base.replace(/\/$/, '') + path;

    const rawBody = Buffer.from(JSON.stringify(payloadObj || {}), 'utf8');
    const ts = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');
    const secret = process.env.BOT_WEBHOOK_SECRET || '';
    const sig = hmacSign(secret, ts, nonce, rawBody);

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Timestamp': String(ts),
                'X-Nonce': nonce,
                'X-Signature': sig
            },
            body: rawBody,
            signal: ctrl.signal
        });
        const text = await res.text();
        const json = (() => { try { return JSON.parse(text); } catch { return {}; } })();
        return { ok: res.ok, status: res.status, text, json };
    } finally {
        clearTimeout(to);
    }
}

// --- client events ---
client.on('qr', qr => {
    console.log('📱 QR Kodu oluşturuldu:');
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    console.log('✅ WhatsApp bot hazır!');
    console.log(`🔗 Bağlı numara: ${client.info?.wid?.user || 'Bilinmiyor'}`);
});

client.on('auth_failure', msg => {
    console.error('❌ Kimlik doğrulama hatası:', msg);
});

client.on('disconnected', reason => {
    console.warn('⚠️ Bot bağlantısı koptu:', reason);
    process.exit(1);
});

client.on('message', async msg => {
    let chat;
    try {
        chat = await msg.getChat();
    } catch (err) {
        console.error('❌ Chat alınamadı:', err.message);
        return;
    }

    if (chat.isGroup && !isProd && !allowedGroupNames.includes(chat.name)) return;
    if (!chat.isGroup && !allowedNumbers.includes(msg.from)) return;

    let quoted = null;
    try {
        if (msg.hasQuotedMsg) quoted = await msg.getQuotedMessage();
    } catch (err) {
        console.error('❌ Quoted mesaj alınamadı:', err.message);
    }

    const payload = {
        from: msg.from,
        id: msg.id._serialized,
        chat_id: chat.id._serialized,
        name: chat.name || null,
        is_group: chat.isGroup,
        type: chat.isGroup ? 'group' : 'private',
        is_reply: msg.hasQuotedMsg,
        quoted_msg_id: quoted?.id._serialized || null,
        quoted_text: quoted?.body || null,
        text: msg.body,
        timestamp: msg.timestamp
    };

    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            payload.filename = media.filename || 'file.pdf';
            payload.data = media.data;
            payload.mimetype = media.mimetype;
        } catch (err) {
            console.error('❌ Medya alınamadı:', err.message);
        }
    }

    if (quoted && quoted.hasMedia) {
        try {
            const qm = await quoted.downloadMedia();
            payload.quoted_mimetype = qm.mimetype;
            payload.quoted_data = qm.data;
            payload.quoted_filename = qm.filename || 'file.pdf';
        } catch (err) {
            console.error('❌ Quoted medya alınamadı:', err.message);
        }
    }

    try {
        // Python servisine İMZALI aktar
        const resp = await postSigned('/message', payload, 15000);
        if (!resp.ok) {
            console.error(`❌ Python /message ${resp.status}: ${String(resp.text).slice(0, 500)}`);
            return;
        }
        const result = resp.json || {};

        if (result.reply) {
            try {
                await client.sendMessage(msg.from, result.reply, {
                    quotedMessageId: result.quoted_id || undefined
                });
            } catch (sendErr) {
                console.error('❌ Python reply gönderilemedi:', sendErr.message);
            }
        }
    } catch (err) {
        console.error('❌ Python mesaj işleme hatası:', err.message);
    }
});

client.initialize();

// --- HTTP API ---
const app = express();
app.use(bodyParser.json({limit: '50mb'}));

// --- API güvenlik middleware'i (IP allowlist + API key) ---
function clientIp(req) {
    const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return xff || req.socket.remoteAddress || '';
}

const allowlistIPs = (process.env.API_ALLOWLIST || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function apiGuard(req, res, next) {
    if (allowlistIPs.length) {
        const ip = clientIp(req);
        const ok = allowlistIPs.some(a => a && ip.includes(a));
        if (!ok) return res.status(403).json({ error: 'forbidden_ip' });
    }
    const key = req.headers['x-api-key'];
    if (!key || key !== (process.env.BOT_API_KEY || '')) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
}

// Basit sağlık kontrolü
app.get('/healthz', (_req, res) => {
    res.json({ok: true, time: new Date().toISOString()});
});

app.post('/send-to-group', apiGuard, async (req, res) => {
    const {groupName, message, files} = req.body;
    if (!groupName || !message) {
        return res.status(400).json({error: '❌ groupName ve message zorunlu'});
    }
    try {
        const chats = await client.getChats();
        const group = chats.find(c => c.isGroup && c.name === groupName);
        if (!group) return res.status(404).json({error: '❌ Grup bulunamadı'});

        const sentMsg = await client.sendMessage(group.id._serialized, message);

        if (files?.length) {
            for (const file of files) {
                if (!file?.base64) continue;
                const media = new MessageMedia(file.mimetype || 'application/pdf', file.base64, file.filename || 'file.pdf');
                await client.sendMessage(group.id._serialized, media);
            }
        }
        res.json({success: true, messageId: sentMsg.id._serialized});
    } catch (err) {
        console.error('❌ Grup mesajı hatası:', err.message);
        res.status(500).json({error: 'Mesaj gönderilemedi', detail: err.message});
    }
});

app.post('/send-to-user', apiGuard, async (req, res) => {
    const {phoneNumber, message, files} = req.body;
    if (!phoneNumber || !message) {
        return res.status(400).json({error: '❌ phoneNumber ve message zorunlu'});
    }
    try {
        const jid = await resolveUserJid(phoneNumber) || phoneNumber; // isim/jid doğrudan gelebilir
        const sentMsg = await client.sendMessage(jid, message);

        if (files?.length) {
            for (const file of files) {
                if (!file?.base64) continue;
                const media = new MessageMedia(file.mimetype || 'application/pdf', file.base64, file.filename || 'file.pdf');
                await client.sendMessage(jid, media);
            }
        }
        res.json({success: true, messageId: sentMsg.id._serialized});
    } catch (err) {
        console.error('❌ Kullanıcı mesajı hatası:', err.message);
        res.status(500).json({error: 'Mesaj gönderilemedi', detail: err.message});
    }
});

app.post('/reply-to-message', apiGuard, async (req, res) => {
    const {phoneNumber, message, file, returnMsgId} = req.body;
    // quotedMessageId ve quotedMsgId her ikisini de destekle
    const quotedMessageId = req.body.quotedMessageId || req.body.quotedMsgId || undefined;

    console.log('📥 [İSTEK ALINDI] /reply-to-message', {
        phoneNumber, message, quotedMessageId, file: file ? file.filename : 'YOK', returnMsgId
    });

    if (!phoneNumber || (!message && !file)) {
        return res.status(400).json({error: '❌ phoneNumber ve (message || file) zorunlu'});
    }

    try {
        // chat’i ID ya da isimden bul; yoksa JID çözmeyi dene
        const chats = await client.getChats();
        let chat = chats.find(c => c.id._serialized === phoneNumber || c.name === phoneNumber);
        if (!chat) {
            const jid = await resolveUserJid(phoneNumber);
            if (!jid) return res.status(404).json({error: '❌ Alıcı bulunamadı / WhatsApp’ta kayıtlı değil'});
            chat = chats.find(c => c.id._serialized === jid) || {id: {_serialized: jid}};
        }

        let sentMessage = null;

        // --- mesaj gönderimi (alıntılı dene → alıntısız fallback) ---
        if (message) {
            try {
                sentMessage = await client.sendMessage(chat.id._serialized, message, {quotedMessageId});
            } catch (msgErr) {
                console.warn('⚠️ Alıntılı mesaj gönderimi başarısız, alıntısız dene:', msgErr.message);
                try {
                    sentMessage = await client.sendMessage(chat.id._serialized, message);
                } catch (fallbackErr) {
                    console.error('❌ Mesaj gönderilemedi:', fallbackErr.message);
                }
            }
        }

        // --- dosya gönderimi (MIME + base64 doğrula) ---
        if (file) {
            if (!file.base64 || typeof file.base64 !== 'string') {
                return res.status(400).json({error: '❌ Geçersiz dosya: base64 yok'});
            }
            const mimetype = file.mimetype || 'application/pdf';
            const filename = file.filename || 'file.pdf';
            try {
                const media = new MessageMedia(mimetype, file.base64, filename);
                try {
                    const m = await client.sendMessage(chat.id._serialized, media, {quotedMessageId});
                    sentMessage = m || sentMessage;
                } catch (fileErr) {
                    console.warn('⚠️ Alıntılı dosya gönderimi başarısız, alıntısız dene:', fileErr.message);
                    const m2 = await client.sendMessage(chat.id._serialized, media);
                    sentMessage = m2 || sentMessage;
                }
            } catch (wrapErr) {
                console.error('❌ Dosya hazırlama hatası:', wrapErr.message);
            }
        }

        if (!sentMessage) {
            return res.status(500).json({error: '❌ Hiçbir mesaj gönderilemedi'});
        }

        const responsePayload = returnMsgId
            ? {success: true, message_id: sentMessage.id._serialized}
            : {success: true};

        console.log('📤 [YANIT GÖNDERİLDİ] /reply-to-message:', responsePayload);
        return res.json(responsePayload);

    } catch (err) {
        console.error('❌ Genel hata (reply-to-message):', err.message);
        res.status(500).json({error: 'Yanıt gönderilemedi', detail: err.message});
    }
});

app.get('/get-groups', async (_req, res) => {
    try {
        const chats = await client.getChats();
        const groups = chats.filter(c => c.isGroup).map(c => ({
            id: c.id._serialized,
            name: c.name
        }));
        console.log('📋 [GET] /get-groups →', groups.length, 'adet grup bulundu.');
        res.json({success: true, groups});
    } catch (err) {
        console.error('❌ Grup listesi alınamadı:', err.message);
        res.status(500).json({success: false, error: err.message});
    }
});

const PORT = 3500;
app.listen(PORT, () => {
    console.log(`🌐 HTTP API aktif: http://localhost:${PORT}`);
});

// --- Graceful shutdown ---
function shutdown() {
    console.log('🛑 Shutting down...');
    client.destroy().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);