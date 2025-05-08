const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');

// 📦 Yardımcı modüller
const setupMessageHandler = require('./handlers/messageHandler');
const setupHttpRoutes = require('./routes/httpRoutes');

// 🧠 WhatsApp client'ı oluştur
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// 🧾 QR kod çıktısı
client.on('qr', qr => {
    console.log('📱 QR Kodu aşağıda, telefonla tarayın:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot başarıyla bağlandı!');
});

// ✅ Mesajları işle (modüler yapı)
setupMessageHandler(client);

// ✅ HTTP sunucu ve API rotaları
const app = express();
app.use(bodyParser.json({ limit: '50mb' }));
setupHttpRoutes(app, client);

// 🌐 Sunucuyu başlat
const PORT = 3500;
app.listen(PORT, () => {
    console.log(`🌐 WhatsApp bot HTTP servisi dinliyor: http://localhost:${PORT}`);
});

client.initialize();