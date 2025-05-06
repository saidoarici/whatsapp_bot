const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const cors = require('cors'); // CORS ekledim - API erişim sorunlarını çözmek için

// Express uygulamasını bir kez oluştur ve sonra hep aynı örneği kullan
const app = express();

// Middleware'leri uygulama başlatılmadan önce ekle
app.use(cors()); // Tüm kaynaklardan erişime izin ver
app.use(bodyParser.json({ limit: '50mb' }));

// WhatsApp istemcisini yapılandır
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// İzin verilen gruplar ve numaralar
const allowedGroupNames = ['GENRS-Muhasebe', 'Alssata accounting'];
const allowedNumbers = ['905431205525@c.us', '905319231182@c.us'];

// Temel kontrol rotası - Erişilebilirlik testi için
app.get('/', (req, res) => {
    res.json({ status: "online", message: "WhatsApp bot API çalışıyor" });
});

// API Rotaları - Tüm rotaları tek bir yerde tanımla
// Gruba mesaj gönderme
app.post('/send-to-group', async (req, res) => {
    console.log("📤 /send-to-group isteği alındı:", req.body);
    const { groupName, message, files } = req.body;

    if (!groupName || !message) {
        return res.status(400).json({
            error: '❌ Grup adı ve mesaj gerekli',
            receivedData: req.body
        });
    }

    try {
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup && chat.name === groupName);

        if (!group) {
            console.log(`❓ "${groupName}" adlı grup bulunamadı`);
            return res.status(404).json({ error: '❌ Grup bulunamadı' });
        }

        console.log(`✅ Grup bulundu: ${group.name}`);
        await client.sendMessage(group.id._serialized, message);

        if (files && files.length > 0) {
            for (const file of files) {
                const media = new MessageMedia('application/pdf', file.base64, file.filename);
                await client.sendMessage(group.id._serialized, media);
            }
        }

        res.json({ success: true, message: '✅ Grup mesajı ve dosyalar gönderildi.' });
    } catch (err) {
        console.error('❌ Grup mesajı hatası:', err);
        res.status(500).json({ error: '❌ Mesaj gönderme hatası', detail: err.message });
    }
});

// Kullanıcıya mesaj gönderme
app.post('/send-to-user', async (req, res) => {
    console.log("📤 /send-to-user isteği alındı:", req.body);
    const { phoneNumber, message, files } = req.body;

    if (!phoneNumber || !message) {
        return res.status(400).json({
            error: '❌ Telefon numarası ve mesaj gerekli',
            receivedData: req.body
        });
    }

    try {
        // Telefon numarası formatını kontrol et
        const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
        console.log(`🔄 Mesaj gönderiliyor: ${chatId}`);

        await client.sendMessage(chatId, message);

        if (files && files.length > 0) {
            for (const file of files) {
                const media = new MessageMedia('application/pdf', file.base64, file.filename);
                await client.sendMessage(chatId, media);
            }
        }

        res.json({ success: true, message: '✅ Kullanıcıya mesaj ve dosyalar gönderildi.' });
    } catch (err) {
        console.error('❌ Kullanıcı mesajı hatası:', err);
        res.status(500).json({ error: '❌ Mesaj gönderme hatası', detail: err.message });
    }
});

// Mesaj yanıtlama - Önemli: Bu rotayı Flask uygulaması kullanıyor
app.post('/reply-to-message', async (req, res) => {
    console.log("💌 /reply-to-message isteği alındı:", JSON.stringify(req.body));

    const { phoneNumber, message, quotedMsgId, file } = req.body;

    if (!phoneNumber || !message) {
        return res.status(400).json({
            error: '❌ Telefon numarası ve mesaj gerekli',
            receivedData: req.body
        });
    }

    try {
        // İlk olarak doğrudan göndermeyi dene
        const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
        console.log(`🔄 Yanıt gönderiliyor: ${chatId}, Alıntılanan Mesaj: ${quotedMsgId}`);

        try {
            await client.sendMessage(chatId, message, {
                quotedMessageId: quotedMsgId
            });

            if (file) {
                const media = new MessageMedia('application/pdf', file.base64, file.filename);
                await client.sendMessage(chatId, media, {
                    quotedMessageId: quotedMsgId
                });
            }

            console.log('✅ Yanıt doğrudan gönderildi');
            return res.json({ success: true, message: '✅ Mesaj yanıtlandı' });
        } catch (directErr) {
            console.log('⚠️ Doğrudan gönderme başarısız, sohbeti bulma deneniyor:', directErr.message);

            // Eğer doğrudan gönderme başarısız olursa, sohbeti bulmayı dene
            const chats = await client.getChats();
            const chat = chats.find(chat =>
                chat.id._serialized === phoneNumber ||
                chat.name === phoneNumber
            );

            if (!chat) {
                console.log(`❓ "${phoneNumber}" ile ilgili sohbet bulunamadı`);
                return res.status(404).json({
                    error: '❌ Kişi veya grup bulunamadı',
                    phoneNumber
                });
            }

            console.log(`✅ Sohbet bulundu: ${chat.name || chat.id._serialized}`);

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

            console.log('✅ Yanıt sohbet yoluyla gönderildi');
            return res.json({ success: true, message: '✅ Mesaj yanıtlandı' });
        }
    } catch (err) {
        console.error('❌ Yanıt mesajı hatası:', err);
        res.status(500).json({
            error: 'Mesaj yanıtlanamadı',
            detail: err.message
        });
    }
});

// Test amaçlı ping rotası
app.get('/ping', (req, res) => {
    res.json({
        status: "online",
        time: new Date().toISOString(),
        clientConnected: client.info ? true : false
    });
});

// WhatsApp olaylarını dinlemeye başla
client.on('qr', qr => {
    console.log('📱 QR Kodu aşağıda, telefonla tarayın:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot başarıyla bağlandı!');
});

client.on('message', async msg => {
    try {
        const chat = await msg.getChat();

        // İzin kontrolü
        let isAllowed = false;
        if (chat.isGroup) {
            isAllowed = allowedGroupNames.includes(chat.name);
        } else {
            isAllowed = allowedNumbers.includes(msg.from);
        }

        if (!isAllowed) return;

        console.log(`📥 Mesaj geldi → ${msg.from}: ${msg.body}`);

        // Yanıtlanan mesajı kontrol et
        let quotedBody = null;
        if (msg.hasQuotedMsg) {
            try {
                const quotedMsg = await msg.getQuotedMessage();
                quotedBody = quotedMsg.body;
            } catch (err) {
                console.error('⚠️ Yanıtlanan mesaj alınamadı:', err);
            }
        }

        // Medya kontrolü
        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();

                if (media.mimetype === 'application/pdf') {
                    console.log('📎 PDF dosyası alındı, Flask API\'ye gönderiliyor...');

                    // Flask sunucusuna bağlantı için 127.0.0.1 yerine localhost kullan
                    // (Bazı sistemlerde farklı davranabilir)
                    try {
                        const response = await fetch("http://localhost:5000/process_whatsapp_pdf", {
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

                        const responseData = await response.text();
                        console.log(`✅ Flask yanıtı: ${response.status} ${responseData}`);
                    } catch (fetchErr) {
                        console.error('❌ Flask API bağlantı hatası:', fetchErr);
                        // Bağlantı hatası durumunda alternatif adresleri dene
                        try {
                            console.log('🔄 Alternatif Flask URL deneniyor...');
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
                            console.log('✅ Alternatif Flask URL ile PDF gönderildi');
                        } catch (altFetchErr) {
                            console.error('❌ Alternatif Flask URL hatası:', altFetchErr);
                        }
                    }
                }
            } catch (err) {
                console.error('❌ PDF işlenirken hata:', err);
            }
        }
    } catch (msgErr) {
        console.error('❌ Mesaj işleme hatası:', msgErr);
    }
});

// WhatsApp istemcisini başlat
client.initialize().catch(err => {
    console.error('❌ WhatsApp istemcisi başlatılamadı:', err);
});

// Önce tüm rotalar tanımlanmalı, ardından sunucu dinlemeye başlamalı
const PORT = 2222;
const HOST = '0.0.0.0'; // Tüm ağ arabirimlerini dinle (önemli)

// Express sunucusunu başlat
app.listen(PORT, HOST, () => {
    console.log(`🚀 WhatsApp bot HTTP servisi başlatıldı`);
    console.log(`📡 Dinlenen adres: http://${HOST}:${PORT}`);
    console.log(`🔗 API rotaları:`);
    console.log(`   - GET  /`);
    console.log(`   - GET  /ping`);
    console.log(`   - POST /send-to-group`);
    console.log(`   - POST /send-to-user`);
    console.log(`   - POST /reply-to-message`);
});