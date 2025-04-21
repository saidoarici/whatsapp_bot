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

client.on('message', async msg => {
    console.log(`📥 Mesaj geldi → ${msg.from}: ${msg.body}`);

    // ✅ Cevaplanmış mesaj kontrolü
    let quotedBody = null;
    if (msg.hasQuotedMsg) {
        try {
            const quotedMsg = await msg.getQuotedMessage();
            quotedBody = quotedMsg.body;
            console.log('🔁 Bu mesaj şu mesaja yanıttır:');
            console.log(`   📝 Yanıtlanan: ${quotedBody}`);
        } catch (err) {
            console.error('⚠️ Yanıtlanan mesaj alınamadı:', err);
        }
    }

    // ✅ Medya kontrolü (PDF geldi mi?)
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
                        quoted_text: quotedBody,
                        sender: msg.from
                    })
                });

                console.log('✅ PDF başarıyla Flask sunucusuna gönderildi.');
            } else {
                console.log(`⛔ Desteklenmeyen medya türü: ${media.mimetype}`);
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

// 🚀 EXPRESS PORT: 2222
const PORT = 2222;
app.listen(PORT, () => {
    console.log(`🌐 WhatsApp bot HTTP servisi dinliyor: http://localhost:${PORT}`);
});
