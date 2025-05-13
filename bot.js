const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', qr => {
    console.log('📱 QR Kodu oluşturuldu:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp bot hazır!');
});

const allowedGroupNames = ['GENRS-Muhasebe', 'Alssata accounting', 'BOT TEST'];
const allowedNumbers = ['905431205525@c.us', '905319231182@c.us'];

client.on('message', async msg => {
    const chat = await msg.getChat();
    if (chat.isGroup && !allowedGroupNames.includes(chat.name)) return;
    if (!chat.isGroup && !allowedNumbers.includes(msg.from)) return;

    const text = msg.body.trim();
    const quoted = msg.hasQuotedMsg ? await msg.getQuotedMessage() : null;

    let payload = {
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

    // Medya varsa ekle
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            payload.filename = media.filename || 'file.pdf';
            payload.data = media.data;
            payload.mimetype = media.mimetype;
        } catch (err) {
            console.error('❌ Medya alınamadı:', err);
        }
    }

    if (msg.hasQuotedMsg) {
    const quoted = await msg.getQuotedMessage();
    payload.quoted_msg_id = quoted?.id._serialized || null;
    payload.quoted_text = quoted?.body || null;

    // 📎 Quoted mesaj PDF ise, her zaman quoted media bilgilerini gönder
    if (quoted.hasMedia) {
        try {
            const quotedMedia = await quoted.downloadMedia();
            payload.quoted_mimetype = quotedMedia.mimetype;
            payload.quoted_data = quotedMedia.data;
            payload.quoted_filename = quotedMedia.filename || 'file.pdf';
        } catch (err) {
            console.error('❌ Quoted medya alınamadı:', err);
        }
    }
}

    // Python'a gönder
    try {
        const response = await fetch('http://127.0.0.1:3000/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.reply) {
            await client.sendMessage(msg.from, result.reply, {
                quotedMessageId: result.quoted_id || undefined
            });
        }
    } catch (err) {
        console.error('❌ Python mesaj işleme hatası:', err);
    }
});

client.initialize();


// 🌐 HTTP API
const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

app.post('/send-to-group', async (req, res) => {
    const { groupName, message, files } = req.body;
    try {
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup && chat.name === groupName);
        if (!group) return res.status(404).json({ error: '❌ Grup bulunamadı' });

        const sentMsg = await client.sendMessage(group.id._serialized, message);

        if (files && files.length > 0) {
            for (const file of files) {
                const media = new MessageMedia('application/pdf', file.base64, file.filename);
                await client.sendMessage(group.id._serialized, media);
            }
        }

        res.json({ success: true, messageId: sentMsg.id._serialized });
    } catch (err) {
        console.error('❌ Grup mesajı hatası:', err);
        res.status(500).json({ error: 'Mesaj gönderilemedi', detail: err.message });
    }
});

app.post('/send-to-user', async (req, res) => {
    const { phoneNumber, message, files } = req.body;
    try {
        const sentMsg = await client.sendMessage(phoneNumber, message);

        if (files && files.length > 0) {
            for (const file of files) {
                const media = new MessageMedia('application/pdf', file.base64, file.filename);
                await client.sendMessage(phoneNumber, media);
            }
        }

        res.json({ success: true, messageId: sentMsg.id._serialized });
    } catch (err) {
        console.error('❌ Kullanıcı mesajı hatası:', err);
        res.status(500).json({ error: 'Mesaj gönderilemedi', detail: err.message });
    }
});

app.post('/reply-to-message', async (req, res) => {
    const { phoneNumber, message, quotedMsgId, file, returnMsgId } = req.body;

    // Gelen istek detaylarını logla
    console.log("📥 [İSTEK ALINDI] /reply-to-message");
    console.log("👉 phoneNumber:", phoneNumber);
    console.log("👉 message:", message);
    console.log("👉 quotedMsgId:", quotedMsgId);
    console.log("👉 file:", file ? file.filename : "YOK");
    console.log("👉 returnMsgId:", returnMsgId);

    try {
        const chats = await client.getChats();
        const chat = chats.find(c => c.id._serialized === phoneNumber || c.name === phoneNumber);

        if (!chat) {
            console.error("❌ HATA: Alıcı bulunamadı →", phoneNumber);
            return res.status(404).json({ error: '❌ Alıcı bulunamadı' });
        }

        let sentMessage = null;

        // Mesaj gönderimi
        if (message) {
            try {
                sentMessage = await client.sendMessage(chat.id._serialized, message, {
                    quotedMessageId: quotedMsgId
                });
                console.log("✅ Mesaj metni gönderildi:", message);
            } catch (msgErr) {
                console.error("❌ Mesaj gönderme hatası:", msgErr);
            }
        }

        // Dosya gönderimi
        if (file) {
            try {
                const media = new MessageMedia('application/pdf', file.base64, file.filename);
                sentMessage = await client.sendMessage(chat.id._serialized, media, {
                    quotedMessageId: quotedMsgId
                });
                console.log("📎 Dosya gönderildi:", file.filename);
            } catch (fileErr) {
                console.error("❌ Dosya gönderme hatası:", fileErr);
            }
        }

        // Yanıtı hazırla ve logla
        const responsePayload = returnMsgId && sentMessage
            ? { success: true, message_id: sentMessage.id._serialized }
            : { success: true };

        console.log("📤 [YANIT GÖNDERİLDİ] /reply-to-message:", responsePayload);
        return res.json(responsePayload);

    } catch (err) {
        console.error('❌ Genel hata (reply-to-message):', err);
        res.status(500).json({ error: 'Yanıt gönderilemedi', detail: err.message });
    }
});

const PORT = 3500;
app.listen(PORT, () => {
    console.log(`🌐 HTTP API aktif: http://localhost:${PORT}`);
});