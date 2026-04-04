const { ENV } = require('./config-mxl');
const fetch = require('node-fetch');

async function llamarGemini(prompt, reintentos = 2) {
    // Intento con las 4 llaves de Gemini
    for (const llave of ENV.GEMINI_KEYS) {
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${llave}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await res.json();
            const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (texto) return texto;
        } catch (e) { console.log("⚠️ Falló una llave Gemini"); }
    }

    // REFUERZO DE ORO: DEEPSEEK
    if (ENV.DEEPSEEK_API_KEY) {
        console.log("🚀 Entrando DeepSeek al relevo...");
        try {
            const res = await fetch(`${ENV.DEEPSEEK_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ENV.DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.8
                })
            });
            const data = await res.json();
            return data.choices?.[0]?.message?.content;
        } catch (e) { console.log("💀 DeepSeek también falló"); }
    }
    throw new Error("Todas las IA fallaron");
}

module.exports = { llamarGemini };
