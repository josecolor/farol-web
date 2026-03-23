// ═══════════════════════════════════════════════════════════════
// PATCH PARA server.js V34.0 — ROTACIÓN DE 4 KEYS GEMINI
// Instrucciones: aplica estos 2 cambios al server.js en GitHub
// ═══════════════════════════════════════════════════════════════

// ── CAMBIO 1: Reemplaza esta línea (~línea 53): ──
// ANTES:
// if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }
//
// DESPUÉS (pegar en su lugar):

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL requerido'); process.exit(1); }

const GEMINI_KEYS = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY2,
    process.env.GEMINI_API_KEY3,
    process.env.GEMINI_API_KEY4,
].filter(Boolean);

if (!GEMINI_KEYS.length) { console.error('❌ Se necesita al menos GEMINI_API_KEY'); process.exit(1); }
console.log(`✅ Gemini: ${GEMINI_KEYS.length} key(s) configuradas — rotación automática activa`);

let _keyIdx = 0;
const _keyCooldown = {}; // ms hasta que cada key se libera del 429

function getKey() {
    const now = Date.now();
    // Buscar key activa (sin cooldown)
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        const idx = (_keyIdx + i) % GEMINI_KEYS.length;
        if (now >= (_keyCooldown[idx] || 0)) {
            _keyIdx = idx;
            return { key: GEMINI_KEYS[idx], idx };
        }
    }
    // Todas en cooldown → esperar la más próxima a liberar
    let minTime = Infinity, minIdx = 0;
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        if ((_keyCooldown[i] || 0) < minTime) { minTime = _keyCooldown[i] || 0; minIdx = i; }
    }
    return { key: GEMINI_KEYS[minIdx], idx: minIdx, wait: Math.max(0, minTime - now) };
}

// ── CAMBIO 2: Reemplaza la función llamarGemini COMPLETA (~línea 300):
// ANTES: async function llamarGemini(prompt, reintentos = 3) { ... }
// DESPUÉS:

async function llamarGemini(prompt, reintentos = 5) {
    for (let i = 0; i < reintentos; i++) {
        const { key, idx, wait } = getKey();
        
        // Si hay espera, dormir antes de continuar
        if (wait > 0) {
            console.log(`   ⏳ Key ${idx+1} libre en ${Math.round(wait/1000)}s...`);
            await new Promise(r => setTimeout(r, wait));
        }

        try {
            console.log(`   🤖 Gemini key ${idx+1}/${GEMINI_KEYS.length} (intento ${i+1})`);

            // Espacio entre llamadas
            const desde = Date.now() - (GS.lastRequest || 0);
            if (desde < 2000) await new Promise(r => setTimeout(r, 2000 - desde));
            GS.lastRequest = Date.now();

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.8,
                            maxOutputTokens: 4000,
                            stopSequences: []
                        }
                    })
                }
            );

            if (res.status === 429) {
                // Esta key está saturada — ponerla en cooldown y rotar
                const cooldownMs = Math.pow(2, i) * 15000; // 15s, 30s, 60s, 120s, 240s
                _keyCooldown[idx] = Date.now() + cooldownMs;
                _keyIdx = (idx + 1) % GEMINI_KEYS.length; // rotar a la siguiente
                console.log(`   ⚠️ Key ${idx+1} → 429 | Cooldown ${cooldownMs/1000}s | Rotando a key ${_keyIdx+1}`);
                continue;
            }

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!texto) throw new Error('Respuesta vacía de Gemini');
            
            console.log(`   ✅ Gemini key ${idx+1} OK`);
            return texto;

        } catch (err) {
            console.error(`   ❌ Key ${idx+1} intento ${i+1}: ${err.message}`);
            if (i < reintentos - 1) await new Promise(r => setTimeout(r, 3000));
        }
    }
    throw new Error('Gemini: todas las keys fallaron');
}

// NOTA: mantener esta línea que ya existe:
const GS = { lastRequest: 0 };
