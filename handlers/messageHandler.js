const fs = require('fs');
const fetch = require('node-fetch');
const { MessageMedia } = require('whatsapp-web.js');

module.exports = function setupMessageHandler(client) {
    const allowedGroupNames = ['GENRS-Muhasebe', 'Alssata accounting', 'BOT TEST'];
    const allowedNumbers = ['905431205525@c.us', '905319231182@c.us'];

    client.on('message', async msg => {
        try {
            const chat = await msg.getChat();
            if (chat.isGroup && !allowedGroupNames.includes(chat.name)) return;
            if (!chat.isGroup && !allowedNumbers.includes(msg.from)) return;

            const handlerFns = [
                require('./subhandlers/handlePdf'),
                require('./subhandlers/handleConnect'),
                require('./subhandlers/handleSelection')
            ];

            for (const fn of handlerFns) {
                const handled = await fn(msg, client);
                if (handled === true) break; // işlenmişse diğerlerine geçme
            }

        } catch (err) {
            console.error("❌ Global message handler hatası:", err);
        }
    });
};