const { MessageMedia } = require('whatsapp-web.js');

module.exports = function setupHttpRoutes(app, client) {
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

    // ✅ Yanıt olarak mesaj gönder
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
                return res.status(404).json({
                    error: '❌ Kişi veya grup bulunamadı',
                    phoneNumber
                });
            }

            await client.sendMessage(chat.id._serialized, message, {
                quotedMessageId: quotedMsgId
            });

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
};