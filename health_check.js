// health_check.js
const { execSync } = require('child_process');
const axios = require('axios');

const CHECK_URL = 'http://localhost:3500/get-groups';
const ALERT_NUMBER = '905431205525@c.us';

async function sendMessage(phone, text) {
    try {
        await axios.post('http://localhost:3500/send-to-user', {
            phoneNumber: phone,
            message: text
        });
        console.log('✅ WhatsApp mesajı gönderildi:', text);
    } catch (err) {
        console.error('❌ WhatsApp mesajı gönderilemedi:', err.message);
    }
}

async function checkAndRestart() {
    try {
        const res = await axios.get(CHECK_URL);
        if (!res.data.success) throw new Error("Bot yanıt vermedi");

        console.log('🟢 Bot aktif durumda.');
    } catch (err) {
        console.error('🔴 Bot aktif değil. Yeniden başlatılıyor...');

        await sendMessage(ALERT_NUMBER, '⚠️ WhatsApp bot bağlantısı KAPANDI. PM2 ile yeniden başlatılıyor...');

        try {
            execSync('pm2 restart whatsapp');
            console.log('🔄 PM2 ile bot yeniden başlatıldı.');

            await sendMessage(ALERT_NUMBER, '✅ WhatsApp bot yeniden başlatıldı ve bağlantı sağlandı.');
        } catch (restartErr) {
            console.error('❌ PM2 yeniden başlatma hatası:', restartErr.message);
            await sendMessage(ALERT_NUMBER, '❌ Bot yeniden başlatılamadı. Manuel müdahale gerekebilir.');
        }
    }
}

checkAndRestart();