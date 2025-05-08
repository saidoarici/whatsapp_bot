const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
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
    console.log('📱 QR Kodu aşağıda, telefonla tarayın:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot başarıyla bağlandı!');
});

const allowedGroupNames = ['GENRS-Muhasebe', 'Alssata accounting'];
const allowedNumbers = ['905431205525@c.us', '905319231182@c.us'];

client.on('message', async msg => {
    const chat = await msg.getChat();
    if (chat.isGroup) {
        if (!allowedGroupNames.includes(chat.name)) return;
    } else {
        if (!allowedNumbers.includes(msg.from)) return;
    }

    console.log(`📥 Mesaj geldi → ${msg.from}: ${msg.body}`);

    let quotedBody = null;
    let quotedMsgObj = null;

    if (msg.hasQuotedMsg) {
        try {
            quotedMsgObj = await msg.getQuotedMessage();
            quotedBody = quotedMsgObj.body;
        } catch (err) {
            console.error('⚠️ Yanıtlanan mesaj alınamadı:', err);
        }
    }

    // ✅ PDF gönderildiyse: Flask'a gönder
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();

            if (media.mimetype === 'application/pdf') {
                console.log('📎 PDF dosyası alındı, Flask API’ye gönderiliyor...');

                await fetch("http://127.0.0.1:3000/process_whatsapp_pdf", {
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

    // ✅ connect komutu geldiyse: liste gönder ve PDF'yi geçici kaydet
    if (msg.hasQuotedMsg && msg.body.toLowerCase().includes("connect")) {
        try {
            const media = await quotedMsgObj.downloadMedia();

            if (media && media.mimetype === 'application/pdf') {
                const response = await fetch("http://127.0.0.1:3000/get_approved_requests_json");
                const data = await response.json();
                const requests = data.requests;

                if (!requests || requests.length === 0) {
                    await client.sendMessage(msg.from, "❌ No approved payment requests found.");
                    return;
                }

                let messageText = "*Please choose one of the approved payment requests:*\n";
                requests.forEach((req, index) => {
                    messageText += `\n*${index + 1}.* ${req.company_name} | ${req.invoice_number} | ${req.amount} ${req.currency}`;
                });

                const listMsg = await client.sendMessage(msg.from, messageText, {
                    quotedMessageId: msg.id._serialized
                });

                fs.mkdirSync("temp", { recursive: true });
                fs.writeFileSync(`temp/${listMsg.id._serialized}.json`, JSON.stringify({
                    sender: msg.from,
                    quoted_pdf_msg_id: quotedMsgObj.id._serialized,
                    list_msg_id: listMsg.id._serialized,
                    media: media,
                    approvedRequests: requests
                }));
            }
        } catch (err) {
            console.error('❌ Connect komutunda hata:', err);
        }
    }

    // ✅ Sayı geldiyse ve bir mesaj yanıtlandıysa: PDF'yi seçilen talebe bağla
    if (!isNaN(msg.body.trim()) && msg.hasQuotedMsg) {
        try {
            const quotedMsg = await msg.getQuotedMessage();
            const tempPath = `temp/${quotedMsg.id._serialized}.json`;

            if (!fs.existsSync(tempPath)) {
                console.log(`❌ Seçim dosyası bulunamadı: ${tempPath}`);
                return;
            }

            const tempData = JSON.parse(fs.readFileSync(tempPath));
            const selectedIndex = parseInt(msg.body.trim()) - 1;
            const selectedRequest = tempData.approvedRequests[selectedIndex];

            if (!selectedRequest) {
                await client.sendMessage(msg.from, "❌ Invalid selection.");
                return;
            }

            // PDF'yi bu ödeme isteğine bağla
            const res = await fetch("http://127.0.0.1:3000/api/bot/link_receipt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    payment_request_id: selectedRequest.id,
                    filename: tempData.media.filename,
                    mimetype: tempData.media.mimetype,
                    data: tempData.media.data // base64
                })
            });

            const text = await res.text();
            let resJson;
            try {
                resJson = JSON.parse(text);
            } catch (e) {
                console.error("❌ JSON parse hatası. Dönen içerik:", text);
                await client.sendMessage(msg.from, "❌ Sunucu hatası: Geçersiz yanıt.");
                return;
            }

            if (resJson.success) {
                await client.sendMessage(msg.from, `✅ PDF has been linked to request #${selectedRequest.id} successfully.`);
                fs.unlinkSync(tempPath);
            } else {
                await client.sendMessage(msg.from, `❌ An error occurred: ${resJson.error}`);
            }
        } catch (err) {
            console.error('❌ Sayı ile seçim yapılırken hata:', err);
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

// WhatsApp bot tarafında şu kodları kontrol edin:
app.post('/reply-to-message', async (req, res) => {
    console.log("💌 /reply-to-message isteği alındı:", req.body);

    const { phoneNumber, message, quotedMsgId, file } = req.body;

    if (!phoneNumber || !message) {
        return res.status(400).json({
            error: '❌ Telefon numarası ve mesaj gerekli',
            receivedData: req.body
        });
    }

    try {
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

        res.json({ success: true, message: '✅ Mesaj yanıtlandı' });
    } catch (err) {
        console.error('❌ Yanıt mesajı hatası:', err);
        res.status(500).json({
            error: 'Mesaj yanıtlanamadı',
            detail: err.message
        });
    }
});




// 🚀 EXPRESS PORT: 3500
const PORT = 3500;
app.listen(PORT, () => {
    console.log(`🌐 WhatsApp bot HTTP servisi dinliyor: http://localhost:${PORT}`);
});
