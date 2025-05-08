const fs = require('fs');
const fetch = require('node-fetch');

module.exports = async function handleSelection(msg, client) {
    if (!msg.hasQuotedMsg || isNaN(msg.body.trim())) return false;

    try {
        const quotedMsg = await msg.getQuotedMessage();
        const tempPath = `temp/${quotedMsg.id._serialized}.json`;

        if (!fs.existsSync(tempPath)) {
            console.log(`❌ Seçim dosyası bulunamadı: ${tempPath}`);
            return true;
        }

        const tempData = JSON.parse(fs.readFileSync(tempPath));
        const selectedIndex = parseInt(msg.body.trim()) - 1;
        const selectedRequest = tempData.approvedRequests[selectedIndex];

        if (!selectedRequest) {
            await client.sendMessage(msg.from, "❌ Invalid selection.");
            return true;
        }

        const res = await fetch("http://127.0.0.1:3000/api/bot/link_receipt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                payment_request_id: selectedRequest.id,
                filename: tempData.media.filename,
                mimetype: tempData.media.mimetype,
                data: tempData.media.data
            })
        });

        const text = await res.text();
        let resJson;
        try {
            resJson = JSON.parse(text);
        } catch (e) {
            console.error("❌ JSON parse hatası. Dönen içerik:", text);
            await client.sendMessage(msg.from, "❌ Server error: Invalid response.");
            return true;
        }

        if (resJson.success) {
            await client.sendMessage(msg.from, `✅ PDF has been linked to request #${selectedRequest.id} successfully.`);
            fs.unlinkSync(tempPath);
        } else {
            await client.sendMessage(msg.from, `❌ An error occurred: ${resJson.error}`);
        }

        return true;

    } catch (err) {
        console.error("❌ Sayı ile seçim yapılırken hata:", err);
        return false;
    }
};