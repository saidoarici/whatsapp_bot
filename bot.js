const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch'); // 🔹 Flask'a istek atmak için gerekli

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', qr => {
    console.log('📱 QR Kodu aşağıda, telefonla tarayın:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot başarıyla bağlandı!');
});

// 🔒 İzin verilen gruplar ve numaralar
const allowedGroupNames = ['GENRS-Muhasebe', 'Alssata accounting']; // istediğin grup isimlerini yaz
const allowedNumbers = ['905431205525@c.us', '905319231182@c.us']; // tam JID formatında

client.on('message', async msg => {
    const chat = await msg.getChat();
    if (chat.isGroup) {
        if (!allowedGroupNames.includes(chat.name)) return;
    } else {
        if (!allowedNumbers.includes(msg.from)) return;
    }

    console.log(`📥 Mesaj geldi → ${msg.from}: ${msg.body}`);

    // ✅ Yanıtlanan mesajı kontrol et
    let quotedBody = null;
    if (msg.hasQuotedMsg) {
        try {
            const quotedMsg = await msg.getQuotedMessage();
            quotedBody = quotedMsg.body;
        } catch (err) {
            console.error('⚠️ Yanıtlanan mesaj alınamadı:', err);
        }
    }

    // ✅ Medya kontrolü
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();

            if (media.mimetype === 'application/pdf') {
                console.log('📎 PDF dosyası alındı, Flask API’ye gönderiliyor...');

                await fetch("http://127.0.0.1:5000/process_whatsapp_pdf", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        filename: media.filename || 'dosya.pdf',
                        data: media.data,
                        mimetype: media.mimetype,
                        quoted_msg_id: msg.id._serialized,
                        quoted_text: quotedBody,
                        sender: msg.from
                    })
                });

                console.log('✅ PDF başarıyla Flask sunucusuna gönderildi.');
            }
        } catch (err) {
            console.error('❌ PDF işlenirken hata:', err);
        }
    }
});

client.initialize();

// 📦 HTTP API KISMI
const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

// ✅ GRUBA MESAJ + PDF GÖNDER
app.post('/send-to-group', async (req, res) => {
    const { groupName, message, files } = req.body;

    try {
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup && chat.name === groupName);

        if (!group) {
            return res.status(404).json({ error: '❌ Grup bulunamadı' });
        }

        await client.sendMessage(group.id._serialized, message);

        if (files && files.length > 0) {
            for (const file of files) {
                const media = new MessageMedia('application/pdf', file.base64, file.filename);
                await client.sendMessage(group.id._serialized, media);
            }
        }

        res.json({ success: true, message: '✅ Grup mesajı ve dosyalar gönderildi.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '❌ Mesaj gönderme hatası', detail: err.message });
    }
});

// ✅ NUMARAYA MESAJ + PDF GÖNDER
app.post('/send-to-user', async (req, res) => {
    const { phoneNumber, message, files } = req.body;

    try {
        await client.sendMessage(phoneNumber, message);

        if (files && files.length > 0) {
            for (const file of files) {
                const media = new MessageMedia('application/pdf', file.base64, file.filename);
                await client.sendMessage(phoneNumber, media);
            }
        }

        res.json({ success: true, message: '✅ Kullanıcıya mesaj ve dosyalar gönderildi.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '❌ Mesaj gönderme hatası', detail: err.message });
    }
});

// ✅ MESAJI YANITLA
app.post('/reply-to-message', async (req, res) => {
    const { phoneNumber, message, quotedMsgId, file } = req.body;

    try {
        const chats = await client.getChats();
        const chat = chats.find(chat => chat.id._serialized === phoneNumber || chat.name === phoneNumber);

        if (!chat) {
            return res.status(404).json({ error: '❌ Kişi veya grup bulunamadı' });
        }

        // Mesajı yanıtla
        await client.sendMessage(chat.id._serialized, message, {
            quotedMessageId: quotedMsgId
        });

        // PDF varsa onu da aynı mesaja yanıt olarak gönder
        if (file) {
            const media = new MessageMedia('application/pdf', file.base64, file.filename);
            await client.sendMessage(chat.id._serialized, media, {
                quotedMessageId: quotedMsgId
            });
        }

        res.json({ success: true, message: '✅ Mesaj yanıtlandı ve dosya gönderildi (varsa).' });
    } catch (err) {
        console.error('❌ Yanıt mesajı hatası:', err);
        res.status(500).json({ error: 'Mesaj yanıtlanamadı', detail: err.message });
    }
});

// 🚀 EXPRESS PORT: 2222
const PORT = 2222;
app.listen(PORT, () => {
    console.log(`🌐 WhatsApp bot HTTP servisi dinliyor: http://localhost:${PORT}`);
});
