const fetch = require('node-fetch');

module.exports = async function handlePdf(msg, client) {
    if (!msg.hasMedia) return false;

    try {
        const media = await msg.downloadMedia();

        if (media.mimetype !== 'application/pdf') return false;

        console.log('📎 PDF dosyası alındı, Flask API’ye gönderiliyor...');

        let quotedBody = null;
        if (msg.hasQuotedMsg) {
            try {
                const quotedMsgObj = await msg.getQuotedMessage();
                quotedBody = quotedMsgObj.body;
            } catch (err) {
                console.error('⚠️ Yanıtlanan mesaj alınamadı (PDF sırasında):', err);
            }
        }

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
        return true;

    } catch (err) {
        console.error('❌ PDF işlenirken hata:', err);
        return false;
    }
};