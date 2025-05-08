const fs = require('fs');
const fetch = require('node-fetch');

module.exports = async function handleConnect(msg, client) {
    if (!msg.hasQuotedMsg || !msg.body.toLowerCase().includes("connect")) return false;

    try {
        const quotedMsgObj = await msg.getQuotedMessage();
        const media = await quotedMsgObj.downloadMedia();

        if (!media || media.mimetype !== 'application/pdf') return false;

        // Ödeme isteklerini getir
        const response = await fetch("http://127.0.0.1:3000/get_approved_requests_json");
        const data = await response.json();
        const requests = data.requests;

        if (!requests || requests.length === 0) {
            await client.sendMessage(msg.from, "❌ No approved payment requests found.");
            return true;
        }

        let messageText = "*Please choose one of the approved payment requests:*\n";
        requests.forEach((req, index) => {
            messageText += `\n*${index + 1}.* ${req.company_name} | ${req.invoice_number} | ${req.amount} ${req.currency}`;
        });

        const listMsg = await client.sendMessage(msg.from, messageText, {
            quotedMessageId: msg.id._serialized
        });

        // Geçici dosya oluştur
        fs.mkdirSync("temp", { recursive: true });
        fs.writeFileSync(`temp/${listMsg.id._serialized}.json`, JSON.stringify({
            sender: msg.from,
            quoted_pdf_msg_id: quotedMsgObj.id._serialized,
            list_msg_id: listMsg.id._serialized,
            media: media,
            approvedRequests: requests
        }));

        return true;

    } catch (err) {
        console.error("❌ Connect komutu işlenirken hata:", err);
        return false;
    }
};