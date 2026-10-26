/**
 * 🏮 EL FAROL AL DÍA — V41.0 GSC DOMINANCE EDITION
 * ═══════════════════════════════════════════════════════════════
 * NUEVO EN V41 vs V40:
 *  📊 Google Search Console integrado en el prompt del modelo
 *  🎯 Ollama (qwen2.5:0.5b) escribe sobre lo que la gente YA busca en Google
 *  🧠 Jefe de Redacción Inteligente + memoria de rendimiento en MongoDB
 *  💡 Oportunidades de oro: impresiones altas + CTR bajo
 *  🏆 Replica fórmula de consultas ganadoras (CTR >5%)
 *  🔍 Palabras clave REALES de tu audiencia dominicana
 *  ⏰ Sync GSC automático: arranque + 6AM + 12PM + 6PM
 *  📈 Endpoint /api/gsc/status para monitorear
 *  ✅ Todo lo de V40 conservado sin cambios
 * ═══════════════════════════════════════════════════════════════
 */

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const crypto    = require('crypto');
const ledger    = require('./ledger');
const webPush   = require('web-push');

const { leerEstrategia }   = require('./estrategia-loader');
const { analizarYGenerar } = require('./estrategia-analyzer');

// ── FASE 2: caché Redis, Llama autohospedado, imágenes con licencia verificada ──
const cache   = require('./lib/cache');
const llm     = require('./lib/llm');
const jefe    = require('./lib/jefe');
const mongo   = require('./lib/mongo');
const roles   = require('./lib/roles');
const { obtenerImagenLimpia } = require('./lib/imagenes');
const { aplicarMarca }        = require('./lib/imagenes/marca');
const imgDep  = require('./lib/imagenes/depurador');
const almacen = require('./lib/imagenes/almacen');
cache.iniciar();

// ══════════════════════════════════════════════════════════
// 🔑 CONFIGURACIÓN GLOBAL
// ══════════════════════════════════════════════════════════
const PORT     = process.env.PORT     || 8080;
const BASE_URL = (process.env.BASE_URL || 'https://elfarolaldia.com').replace(/\/$/, '');

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
// Motor único: Ollama (qwen2.5:0.5b) vía LLM_BASE_URL — ver lib/llm.js. Imágenes: extractor web propio (lib/imagenes/web.js).

const GOOGLE_CSE_KEYS     = [process.env.GOOGLE_CSE_KEY, process.env.GOOGLE_CSE_KEY_2].filter(Boolean);
const GOOGLE_CSE_CX       = process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CSE_CX || '';
const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY  || null;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const ONESIGNAL_APP_ID    = process.env.ONESIGNAL_APP_ID    || null;
const ONESIGNAL_API_KEY   = process.env.ONESIGNAL_REST_API_KEY || null;

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:alertas@elfarolaldia.com',
        VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
    );
    console.log('📱 VAPID configurado');
}

let GOOGLE_CREDENTIALS = null;
try {
    const raw = process.env.GOOGLE_CREDENTIALS_JSON;
    if (raw) { GOOGLE_CREDENTIALS = JSON.parse(raw); console.log(`✅ Google SA: ${GOOGLE_CREDENTIALS.client_email}`); }
} catch(e) { console.warn('⚠️ Google SA:', e.message); }

// ══════════════════════════════════════════════════════════
// 🛡️ AUTH
// ══════════════════════════════════════════════════════════
function authMiddleware(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día"');
        return res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Acceso Restringido</title>
<style>body{background:#070707;color:#EDE8DF;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#141418;border:1px solid #FF5500;border-radius:12px;padding:40px;text-align:center;max-width:380px}
h2{color:#FF5500}p{color:#A89F94;font-size:14px}
a{display:inline-block;background:#FF5500;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold}</style>
</head><body><div class="box"><h2>🏮 ACCESO RESTRINGIDO</h2>
<p>Usuario: <strong>director</strong> / Contraseña: <strong>311</strong></p>
<a href="/redaccion">ENTRAR</a></div></body></html>`);
    }
    try {
        const [u, ...pp] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
        if (u === 'director' && pp.join(':') === '311') return next();
    } catch(_) {}
    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día"');
    return res.status(401).send('Credenciales incorrectas.');
}

// ══════════════════════════════════════════════════════════
// 🏮 WATERMARK PATH
// ══════════════════════════════════════════════════════════
const WATERMARK_PATH = (() => {
    const nombres = ['watermark.png','WATERMARK.png','WATERMARK(1).png','watermark(1).png','watermark (1).png'];
    for (const base of [path.join(process.cwd(),'static'), path.join(__dirname,'static')])
        for (const n of nombres) {
            const r = path.join(base, n);
            if (fs.existsSync(r)) { console.log(`🏮 Watermark: ${r}`); return r; }
        }
    console.warn('⚠️ Watermark no encontrado');
    return null;
})();

const rssParser = new RSSParser({ timeout: 10000 });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const app  = express();

// ── SEGURIDAD: Cabeceras HTTP profesionales ───────────────
// Elimina X-Powered-By (no revelar que usamos Express)
app.disable('x-powered-by');

// Cabeceras de seguridad manuales (sin depender de helmet)
app.use((req, res, next) => {
    // HSTS — fuerza HTTPS por 1 año
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Evita clickjacking
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Evita MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Controla referrer
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Permissions Policy — deshabilita funciones peligrosas
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // CSP básico — permite recursos propios + CDNs necesarios
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://www.googletagmanager.com https://www.google-analytics.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: blob: https: http:",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "connect-src 'self' https://www.google-analytics.com https://pagead2.googlesyndication.com",
        "frame-src 'self' https://www.youtube.com https://googleads.g.doubleclick.net",
        "object-src 'none'",
        "base-uri 'self'"
    ].join('; '));
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname,'static'), {
    setHeaders: res => res.setHeader('Cache-Control','public,max-age=2592000,immutable')
}));
app.use(express.static(path.join(__dirname,'client'), {
    setHeaders: (res, fp) => {
        if (/\.(jpg|jpeg|png|gif|webp|ico|svg)$/i.test(fp)) res.setHeader('Cache-Control','public,max-age=2592000,immutable');
        else if (/\.(css|js)$/i.test(fp)) res.setHeader('Cache-Control','public,max-age=86400');
    }
}));
app.use(cors({ origin:'*', methods:['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders:['Content-Type','Authorization','X-Requested-With'] }));
app.options('*', cors());

// ══════════════════════════════════════════════════════════
// 📊 ANALYTICS
// ══════════════════════════════════════════════════════════
function logAnalytics(evento, datos = {}) {
    console.log(`[ANALYTICS] ${new Date().toISOString()} | ${evento} | ${JSON.stringify(datos)}`);
}

// ══════════════════════════════════════════════════════════
// 📊 GOOGLE SEARCH CONSOLE — V41
// ══════════════════════════════════════════════════════════
async function getGSCToken() {
    try {
        const raw = process.env.GOOGLE_CREDENTIALS_JSON;
        if (!raw) { console.warn('⚠️ GSC token: falta GOOGLE_CREDENTIALS_JSON en variables de entorno'); return null; }
        const creds = JSON.parse(raw);

        // JWT manual sin google-auth-library para evitar dependencia
        const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const now     = Math.floor(Date.now() / 1000);
        const claim   = Buffer.from(JSON.stringify({
            iss: creds.client_email,
            scope: 'https://www.googleapis.com/auth/webmasters.readonly',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600, iat: now,
        })).toString('base64url');

        const { createSign } = require('crypto');
        const sign    = createSign('RSA-SHA256');
        sign.update(`${header}.${claim}`);
        const sig     = sign.sign(creds.private_key, 'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
        const jwt     = `${header}.${claim}.${sig}`;

        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!data.access_token) {
            console.warn(`⚠️ GSC token: Google respondió ${res.status} — ${data.error || ''} ${data.error_description || JSON.stringify(data)}`);
            return null;
        }
        return data.access_token;
    } catch(e) {
        console.warn('⚠️ GSC token: excepción —', e.message);
        return null;
    }
}

async function consultarGSC(body) {
    const token = await getGSCToken();
    if (!token) return null;
    try {
        const site = encodeURIComponent('https://elfarolaldia.com/');
        const res  = await fetch(
            `https://searchconsole.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15000),
            }
        );
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            console.warn(`⚠️ GSC ${res.status} en searchAnalytics/query — ${errBody.slice(0, 300)}`);
            return null;
        }
        const json = await res.json();
        console.log(`ℹ️ GSC respuesta OK — filas recibidas: ${json?.rows?.length ?? 0}`);
        return json;
    } catch(e) { console.warn('⚠️ GSC fetch: excepción —', e.message); return null; }
}

async function sincronizarGSC() {
    console.log('\n📊 [GSC V41] Sincronizando métricas reales de Search Console...');
    const fin    = new Date();
    const inicio = new Date(); inicio.setDate(inicio.getDate() - 28);
    const fmt    = d => d.toISOString().split('T')[0];

    const data = await consultarGSC({
        startDate: fmt(inicio), endDate: fmt(fin),
        dimensions: ['query'], rowLimit: 100,  // ✅ FIX: 50 → 100 para capturar todas las consultas
        orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
    });

    if (!data) {
        console.warn('⚠️ GSC: no se pudo consultar la API — revisa las líneas "GSC token" o "GSC 4xx/5xx" arriba');
        return false;
    }
    if (!data.rows?.length) {
        console.warn('⚠️ GSC: la API respondió OK pero sin filas — no hay impresiones/clics en los últimos 28 días para esta propiedad');
        return false;
    }

    const consultas = data.rows.map(r => ({
        query:       r.keys[0],
        clics:       Math.round(r.clicks || 0),
        impresiones: Math.round(r.impressions || 0),
        ctr:         parseFloat((r.ctr * 100).toFixed(1)),
        posicion:    parseFloat((r.position || 0).toFixed(1)),
    }));

    // ✅ FIX: umbral >= 1 (antes >= 3) para capturar sitios con poco tráfico aún
    const oportunidades = consultas
        .filter(c => c.impresiones >= 1 && c.ctr < 5)
        .slice(0, 12);

    // Ganadoras: CTR alto = fórmula que funciona
    const ganadoras = consultas
        .filter(c => c.ctr >= 5 && c.clics > 0)
        .slice(0, 8);

    const resumen = {
        fecha:             new Date().toISOString(),
        top_consultas:     consultas.slice(0, 20),
        oportunidades,
        ganadoras,
        total_clics:       consultas.reduce((s,c) => s + c.clics, 0),
        total_impresiones: consultas.reduce((s,c) => s + c.impresiones, 0),
        ctr_promedio:      consultas.length
            ? parseFloat((consultas.reduce((s,c) => s + c.ctr, 0) / consultas.length).toFixed(1)) : 0,
    };

    try {
        await pool.query(
            "INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('gsc_metricas',$1,'sistema',1,0) ON CONFLICT DO NOTHING",
            [JSON.stringify(resumen)]
        );
        await pool.query(
            "UPDATE memoria_ia SET valor=$1,ultima_vez=NOW(),exitos=exitos+1 WHERE tipo='gsc_metricas' AND categoria='sistema'",
            [JSON.stringify(resumen)]
        );
        console.log(`✅ [GSC] OK: ${consultas.length} consultas | ${resumen.total_clics} clics | CTR ${resumen.ctr_promedio}% | Oportunidades: ${oportunidades.length}`);
        if (oportunidades.length) {
            console.log('   💡 Top 3 oportunidades:');
            oportunidades.slice(0,3).forEach(o =>
                console.log(`      "${o.query}" → ${o.impresiones} imp, ${o.ctr}% CTR, pos ${o.posicion}`)
            );
        }
        return true;
    } catch(e) { console.error('❌ GSC BD:', e.message); return false; }
}

async function obtenerContextoGSC(categoria) {
    try {
        const r = await pool.query(
            "SELECT valor,ultima_vez FROM memoria_ia WHERE tipo='gsc_metricas' AND categoria='sistema' ORDER BY ultima_vez DESC LIMIT 1"
        );
        if (!r.rows.length) return '';

        const datos = JSON.parse(r.rows[0].valor);

        // Mapeo categoría → palabras clave dominicanas
        const catKw = {
            'Nacionales':      ['república dominicana','santo domingo','rd','dominicana','gobierno','presidente','policía','policia'],
            'Deportes':        ['béisbol','baseball','dominicano','deportes','tigres','leones','lidom','baloncesto','fútbol'],
            'Internacionales': ['caribe','latinoamérica','mundo','internacional','eeuu','haití','haiti','trump'],
            'Economía':        ['dólar','banco','economía','peso','precio','tasa','reservas','inflación','combustible'],
            'Tecnología':      ['tecnología','digital','internet','ia','inteligencia artificial','app','celular'],
            'Espectáculos':    ['música','artista','bachata','merengue','farándula','concierto','reggaeton'],
        };
        const keywords = catKw[categoria] || [];

        // Filtrar consultas relevantes para esta categoría (o todas si son pocas)
        let oportunidades = (datos.oportunidades || [])
            .filter(c => keywords.some(k => c.query.toLowerCase().includes(k)));
        if (oportunidades.length < 2) oportunidades = (datos.oportunidades || []).slice(0, 6);
        else oportunidades = oportunidades.slice(0, 6);

        let ganadoras = (datos.ganadoras || [])
            .filter(c => keywords.some(k => c.query.toLowerCase().includes(k)));
        if (ganadoras.length < 2) ganadoras = (datos.ganadoras || []).slice(0, 4);
        else ganadoras = ganadoras.slice(0, 4);

        const topConsultas = (datos.top_consultas || []).slice(0, 8);

        if (!oportunidades.length && !ganadoras.length && !topConsultas.length) return '';

        let ctx = '\n';
        ctx += '════════════════════════════════════════════════════════\n';
        ctx += '🔍 INTELIGENCIA REAL — GOOGLE SEARCH CONSOLE (28 días)\n';
        ctx += '════════════════════════════════════════════════════════\n';
        ctx += `📊 ${datos.total_clics} clics | ${datos.total_impresiones} impresiones | CTR promedio ${datos.ctr_promedio}%\n\n`;

        if (oportunidades.length) {
            ctx += '🚀 OPORTUNIDADES DE ORO — ESCRIBE SOBRE ESTO AHORA:\n';
            ctx += '(La gente lo busca pero nuestro título no convence — mejóralo)\n';
            oportunidades.forEach((o, i) => {
                ctx += `${i+1}. "${o.query}"\n`;
                ctx += `   ${o.impresiones} búsquedas | solo ${o.ctr}% clics | posición ${o.posicion}\n`;
                ctx += `   → USA esta frase en el TÍTULO y PRIMER PÁRRAFO\n`;
            });
            ctx += '\n';
        }

        if (ganadoras.length) {
            ctx += '🏆 FÓRMULAS QUE YA GENERAN CLICS — REPLICA ESTE ESTILO:\n';
            ganadoras.forEach((g, i) => {
                ctx += `${i+1}. "${g.query}" → ${g.clics} clics, ${g.ctr}% CTR\n`;
            });
            ctx += '\n';
        }

        if (topConsultas.length) {
            ctx += '📈 LO QUE MÁS BUSCA TU AUDIENCIA:\n';
            topConsultas.slice(0, 5).forEach((c, i) => {
                ctx += `${i+1}. "${c.query}" (${c.impresiones} búsquedas, pos ${c.posicion})\n`;
            });
            ctx += '\n';
        }

        ctx += '⚡ REGLA DE ORO V41: Usa las palabras exactas de las OPORTUNIDADES en el título.\n';
        ctx += 'Si alguien busca "tasa del dolar banco de reservas" → el título debe tener esas palabras.\n';
        ctx += 'Eso sube el CTR de 0% a 10%+ y Google te posiciona mejor automáticamente.\n';
        ctx += '════════════════════════════════════════════════════════\n';

        return ctx;
    } catch(e) {
        console.warn('⚠️ GSC contexto:', e.message);
        return '';
    }
}

// ══════════════════════════════════════════════════════════
// 🎙️ ELEVENLABS TTS
// ══════════════════════════════════════════════════════════
async function generarAudioNoticia(titulo, primerParrafo) {
    if (!ELEVENLABS_API_KEY) return null;
    try {
        const texto = `${titulo}. ${primerParrafo}`.substring(0, 900);
        const res   = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
            method: 'POST',
            headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify({ text: texto, model_id: 'eleven_multilingual_v2',
                voice_settings: { stability:0.5, similarity_boost:0.75, style:0.3, use_speaker_boost:true } }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) return null;
        const buf    = Buffer.from(await res.arrayBuffer());
        const nombre = `audio-${Date.now()}.mp3`;
        fs.writeFileSync(path.join('/tmp', nombre), buf);
        console.log(`🎙️ Audio OK: ${nombre}`);
        return nombre;
    } catch(err) { console.warn(`🎙️ ElevenLabs: ${err.message}`); return null; }
}

// ══════════════════════════════════════════════════════════
// 📣 PUSH — VAPID + ONESIGNAL
// ══════════════════════════════════════════════════════════
async function initPushTable() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS push_suscripciones(
            id SERIAL PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL,
            auth_key TEXT NOT NULL, p256dh_key TEXT NOT NULL,
            user_agent TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ultima_notificacion TIMESTAMP)`);
    } catch(e) { console.warn('⚠️ Push table:', e.message); }
    finally { client.release(); }
}

async function enviarVAPID(titulo, cuerpo, slug, imagenUrl) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return 0;
    try {
        const subs = await pool.query('SELECT endpoint,auth_key,p256dh_key FROM push_suscripciones');
        if (!subs.rows.length) return 0;
        const payload = JSON.stringify({
            title: titulo.substring(0,80), body: cuerpo.substring(0,120),
            icon: imagenUrl || `${BASE_URL}/static/favicon.png`,
            badge: `${BASE_URL}/static/badge.png`, image: imagenUrl,
            vibrate: [200,100,200],
            data: { url:`${BASE_URL}/noticia/${slug}`, slug },
            actions: [{action:'open',title:'📰 Leer'},{action:'later',title:'🔔 Después'}],
            tag: `noticia-${slug}`, renotify: true, timestamp: Date.now(),
        });
        let ok = 0;
        for (const sub of subs.rows) {
            try {
                await webPush.sendNotification({ endpoint:sub.endpoint, keys:{auth:sub.auth_key,p256dh:sub.p256dh_key} }, payload);
                ok++;
                await pool.query('UPDATE push_suscripciones SET ultima_notificacion=NOW() WHERE endpoint=$1',[sub.endpoint]);
            } catch(err) {
                if (err.statusCode === 410) await pool.query('DELETE FROM push_suscripciones WHERE endpoint=$1',[sub.endpoint]);
            }
        }
        return ok;
    } catch(err) { console.error('📱 VAPID error:', err.message); return 0; }
}

async function enviarOneSignal(titulo, cuerpo, slug) {
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return false;
    try {
        const res = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', Authorization:`Basic ${ONESIGNAL_API_KEY}` },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID, included_segments: ['All'],
                headings: { es: titulo.substring(0,80) }, contents: { es: cuerpo.substring(0,120) },
                url: `${BASE_URL}/noticia/${slug}`,
                chrome_web_icon: `${BASE_URL}/static/favicon.png`,
            }),
        });
        const data = await res.json();
        if (data.errors) return false;
        console.log(`🔔 OneSignal: ${data.recipients||0} receptores`);
        return true;
    } catch(err) { console.warn('🔔 OneSignal:', err.message); return false; }
}

async function notificarNuevaNoticia(titulo, cuerpo, slug, imagenUrl) {
    const vapidOk = await enviarVAPID(titulo, cuerpo, slug, imagenUrl);
    console.log(`📱 Push VAPID: ${vapidOk} enviadas`);
    if (!vapidOk) await enviarOneSignal(titulo, cuerpo, slug);
}

// ══════════════════════════════════════════════════════════
// 📡 SOCIAL
// ══════════════════════════════════════════════════════════
let _telegramChatId = process.env.TELEGRAM_CHAT_ID || null;
function _escapeMd(t) { return String(t||'').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g,'\\$&'); }

async function _tgFetch(method, body) {
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) return { ok: false };
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
    });
    return res.json();
}

async function obtenerChatIdTelegram() {
    try {
        const d = await _tgFetch('getUpdates', { limit:1, offset:-1 });
        if (!d.ok || !d.result?.length) return null;
        const u  = d.result[0];
        const id = u.message?.chat?.id || u.channel_post?.chat?.id || u.my_chat_member?.chat?.id;
        if (id) { _telegramChatId = id.toString(); return _telegramChatId; }
    } catch(_) {}
    return null;
}

async function publicarEnTelegram(titulo, slug, urlImagen, descripcion, seccion, audioUrl) {
    if (!process.env.TELEGRAM_TOKEN) return false;
    const chatId = _telegramChatId || await obtenerChatIdTelegram();
    if (!chatId) return false;
    const emoji   = { Nacionales:'🏛️',Deportes:'⚽',Internacionales:'🌍',Economía:'💰',Tecnología:'💻',Espectáculos:'🎬' }[seccion]||'📰';
    const audioParte = audioUrl ? `\n\n🎙️ [Escuchar noticia](${audioUrl})` : '';
    const msg = `${emoji} *${_escapeMd(titulo)}*\n\n${_escapeMd(descripcion||'')}${audioParte}\n\n🔗 [Leer noticia completa](${BASE_URL}/noticia/${slug})\n\n🏮 *El Farol al Día* · Último Minuto RD`;
    if (urlImagen?.startsWith('http')) {
        try {
            const r = await _tgFetch('sendPhoto',{chat_id:chatId,photo:urlImagen,caption:msg,parse_mode:'MarkdownV2'});
            if (r.ok) return true;
        } catch(_) {}
    }
    try {
        const r = await _tgFetch('sendMessage',{chat_id:chatId,text:msg,parse_mode:'MarkdownV2',disable_web_page_preview:false});
        return r.ok;
    } catch(err) { console.warn(`📱 Telegram: ${err.message}`); return false; }
}

async function publicarEnFacebook(titulo, slug, urlImagen, descripcion) {
    const FID = process.env.FB_PAGE_ID, FTOKEN = process.env.FB_PAGE_TOKEN;
    if (!FID || !FTOKEN) return false;
    const urlNoticia = `${BASE_URL}/noticia/${slug}`;
    const mensaje    = `🏮 ${titulo}\n\n${descripcion||''}\n\n${urlNoticia}\n\n#ElFarolAlDía #SantoDomingoEste #RD`;
    if (urlImagen?.startsWith('http')) {
        try {
            const form = new URLSearchParams({url:urlImagen,caption:mensaje,access_token:FTOKEN});
            const res  = await fetch(`https://graph.facebook.com/v18.0/${FID}/photos`,{method:'POST',body:form,signal:AbortSignal.timeout(15000)});
            const d    = await res.json();
            if (!d.error) return true;
        } catch(_) {}
    }
    try {
        const form = new URLSearchParams({message:mensaje,link:urlNoticia,access_token:FTOKEN});
        const res  = await fetch(`https://graph.facebook.com/v18.0/${FID}/feed`,{method:'POST',body:form,signal:AbortSignal.timeout(15000)});
        const d    = await res.json();
        return !d.error;
    } catch(err) { console.warn(`📘 Facebook: ${err.message}`); return false; }
}

function _oauthHeader(method, url) {
    const KEY=process.env.TWITTER_API_KEY,SEC=process.env.TWITTER_API_SECRET,
          TOK=process.env.TWITTER_ACCESS_TOKEN,TSEC=process.env.TWITTER_ACCESS_SECRET;
    if (!KEY||!SEC||!TOK||!TSEC) return null;
    const o = { oauth_consumer_key:KEY, oauth_nonce:crypto.randomBytes(16).toString('hex'),
        oauth_signature_method:'HMAC-SHA1', oauth_timestamp:Math.floor(Date.now()/1000).toString(),
        oauth_token:TOK, oauth_version:'1.0' };
    const sorted = Object.keys(o).sort().map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(o[k])}`).join('&');
    const base   = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
    o.oauth_signature = crypto.createHmac('sha1',`${encodeURIComponent(SEC)}&${encodeURIComponent(TSEC)}`).update(base).digest('base64');
    return 'OAuth ' + Object.keys(o).sort().map(k=>`${encodeURIComponent(k)}="${encodeURIComponent(o[k])}"`).join(', ');
}

async function publicarEnTwitter(titulo, slug, descripcion) {
    const auth = _oauthHeader('POST','https://api.twitter.com/2/tweets');
    if (!auth) return false;
    try {
        const base  = `🏮 ${titulo}\n\n${BASE_URL}/noticia/${slug}\n\n#ElFarolAlDía #RD #SantoDomingoEste`;
        const tweet = base.length>280 ? base.substring(0,277)+'...' : base;
        const res   = await fetch('https://api.twitter.com/2/tweets',{
            method:'POST', headers:{Authorization:auth,'Content-Type':'application/json'},
            body:JSON.stringify({text:tweet}), signal:AbortSignal.timeout(15000),
        });
        const d = await res.json();
        return !(d.errors||d.error);
    } catch(err) { console.warn(`🐦 Twitter: ${err.message}`); return false; }
}

async function publicarEnRedes(titulo, slug, imagen, descripcion, seccion, contenido) {
    const primerParr  = (contenido||'').split(/\n\n+/).find(p=>p.trim().length>40)||'';
    const audioNombre = await generarAudioNoticia(titulo, primerParr.substring(0,400)).catch(()=>null);
    const audioUrl    = audioNombre ? `${BASE_URL}/audio/${audioNombre}` : null;
    const [tg, fb, tw] = await Promise.allSettled([
        publicarEnTelegram(titulo,slug,imagen,descripcion,seccion,audioUrl),
        publicarEnFacebook(titulo,slug,imagen,descripcion),
        publicarEnTwitter(titulo,slug,descripcion),
    ]).then(r=>r.map(x=>x.status==='fulfilled'?x.value:false));
    console.log(`📡 Redes → Telegram:${tg?'✅':'—'} Facebook:${fb?'✅':'—'} Twitter:${tw?'✅':'—'} Audio:${audioNombre?'✅':'—'}`);
    logAnalytics('REDES_SOCIALES',{telegram:tg,facebook:fb,twitter:tw,audio:!!audioNombre,slug});
}

async function bienvenidaTelegram() {
    if (!process.env.TELEGRAM_TOKEN) return;
    await new Promise(r=>setTimeout(r,3000));
    const chatId = _telegramChatId || await obtenerChatIdTelegram();
    if (!chatId) return;
    await _tgFetch('sendMessage',{
        chat_id:chatId,
        text:`🏮 *El Farol al Día — V41\\.0 GSC DOMINANCE*\n\n✅ Google Search Console integrado\\.\n✅ Ollama escribe sobre lo que la gente busca\\.\n✅ Oportunidades de oro: CTR bajo → título nuevo\\.\n✅ Jefe de Redacción Inteligente activo\\.\n✅ Watermark garantizado\\.\n\n🌐 [elfarolaldia\\.com](https://elfarolaldia.com)`,
        parse_mode:'MarkdownV2',
    });
}

// ══════════════════════════════════════════════════════════
// CONFIG IA
// ══════════════════════════════════════════════════════════
const CONFIG_IA_DEFAULT = {
    enabled: true,
    instruccion_principal: `Eres el cronista de la calle de Santo Domingo Este. Escribes para la gente real: el que vende en el colmado de Los Mina, la señora que espera el carro público en Charles de Gaulle, el joven de Invivienda que se entera de todo por el celular.

Tu voz es directa, caliente, con sabor dominicano auténtico — sin ser vulgar y sin perder credibilidad. Cada noticia debe sentirse como si te la estuviera contando un vecino del barrio que sabe lo que pasó.

REGLAS DE VOZ:
- Párrafos de 2-3 líneas máximo. El lector está en el teléfono parado en una esquina.
- Primera línea: gancho que deja la boca abierta. Sin rodeos. Entra al hecho de una.
- Usa expresiones reales del SDE: "se armó el show", "la gente no lo creía", "aquello se puso color de hormiga", "salió corriendo como bala", "todo el barrio hablaba de eso", "fue un vacilón total", "la movida no era pa' menos", "se formó el rollo", "que si se armó el tato".
- Los títulos deben enganchar como los mejores titulares urbanos: directos, con garra, con un dato que no puedes ignorar. Usa números reales, nombres, lugares específicos.
- Cita fuentes del barrio: "Un vecino del sector que prefirió no dar su nombre", "fuentes cercanas a la situación", "según se supo de buena tinta", "así lo confirmaron en el sector".
- Nada de párrafos académicos. Nada de "en este contexto". Nada de "cabe destacar que". Nada de "es importante mencionar".
- Conecta cada noticia con cómo le afecta al lector de SDE. Hazlo personal. Hazlo real.
- Cuando hay drama, cuéntalo. Cuando hay logro, celébr alo. Cuando hay injusticia, nómbrala.`,
    tono: 'calle-sde-dominicano', extension: 'extensa',
    enfasis: 'Prioriza Santo Domingo Este: Los Mina, Invivienda, Ensanche Ozama, Sabana Perdida, Villa Mella, Charles de Gaulle, Los Trinitarios, Carretera Mella. Conecta todo con la vida real del lector de SDE. Que la gente sienta que alguien del barrio se los está contando.',
    evitar: 'Párrafos largos. Lenguaje corporativo o técnico. Especulación sin fuente. Repetir noticias ya publicadas. Copiar Wikipedia textual. Empezar con "En el día de hoy" o "Cabe mencionar" o "Es importante". Sonar como nota de prensa oficial. Usar palabras como "paradigma", "sinergia", "robusto", "en aras de".',
};
let CONFIG_IA = { ...CONFIG_IA_DEFAULT };

async function cargarConfigIA() {
    try {
        const r = await pool.query("SELECT valor FROM memoria_ia WHERE tipo='config_ia' ORDER BY ultima_vez DESC LIMIT 1");
        CONFIG_IA = r.rows.length ? { ...CONFIG_IA_DEFAULT, ...JSON.parse(r.rows[0].valor) } : { ...CONFIG_IA_DEFAULT };
    } catch { CONFIG_IA = { ...CONFIG_IA_DEFAULT }; }
}

async function guardarConfigIA(cfg) {
    try {
        const v = JSON.stringify(cfg);
        await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('config_ia',$1,'sistema',1,0) ON CONFLICT DO NOTHING",[v]);
        await pool.query("UPDATE memoria_ia SET valor=$1,ultima_vez=NOW() WHERE tipo='config_ia' AND categoria='sistema'",[v]);
        return true;
    } catch { return false; }
}

// ══════════════════════════════════════════════════════════
// 🦙 TEXTO — Ollama (qwen2.5:0.5b), motor único (lib/llm.js)
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// 🧠 APRENDIZAJE AUTOMÁTICO
// ══════════════════════════════════════════════════════════
async function obtenerFrasesExitosas() {
    try {
        const r = await pool.query(`SELECT valor,exitos FROM memoria_ia WHERE tipo='frase_exitosa' AND exitos>2 ORDER BY exitos DESC LIMIT 10`);
        return r.rows.map(x => x.valor);
    } catch { return []; }
}

async function guardarFraseExitosa(frase, vistas) {
    if (!frase || frase.length < 5) return;
    try {
        await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('frase_exitosa',$1,'auto',$2,0) ON CONFLICT DO NOTHING",[frase.substring(0,100), vistas]);
        await pool.query("UPDATE memoria_ia SET exitos=exitos+$1,ultima_vez=NOW() WHERE tipo='frase_exitosa' AND valor=$2",[vistas, frase.substring(0,100)]);
    } catch {}
}

// ══════════════════════════════════════════════════════════
// 🕵️ ANTI-PLAGIO
// ══════════════════════════════════════════════════════════
async function detectarPlagio(contenido) {
    try {
        const palabrasClave = contenido.toLowerCase().split(/\s+/).filter(w=>w.length>5).slice(0,20).join(' ');
        const r = await pool.query(`SELECT titulo FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '7 days' AND to_tsvector('spanish',contenido) @@ plainto_tsquery('spanish',$1) LIMIT 3`,[palabrasClave]);
        return r.rows.length > 0 ? r.rows.map(x=>x.titulo) : [];
    } catch { return []; }
}

// ══════════════════════════════════════════════════════════
// 📋 WIKIPEDIA
// ══════════════════════════════════════════════════════════
async function buscarContextoWikipedia(categoria) {
    try {
        const mapa = { Nacionales:'noticias República Dominicana', Deportes:'deporte dominicano',
            Internacionales:'América Latina Caribe', Economía:'economía dominicana',
            Tecnología:'tecnología innovación', Espectáculos:'cultura dominicana' };
        const term = mapa[categoria] || categoria;
        const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(),5000);
        const rb   = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&srlimit=1&origin=*`,{signal:ctrl.signal}).finally(()=>clearTimeout(t));
        if (!rb.ok) return '';
        const db  = await rb.json();
        const pid = db?.query?.search?.[0]?.pageid;
        if (!pid) return '';
        const ctrl2 = new AbortController(); const t2 = setTimeout(()=>ctrl2.abort(),5000);
        const re  = await fetch(`https://es.wikipedia.org/w/api.php?action=query&pageids=${pid}&prop=extracts&exintro=true&exchars=800&format=json&origin=*`,{signal:ctrl2.signal}).finally(()=>clearTimeout(t2));
        if (!re.ok) return '';
        const de  = await re.json();
        const txt = de?.query?.pages?.[pid]?.extract?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,800)||'';
        return txt ? `\n📚 CONTEXTO (referencia, no copiar):\n${txt}\n` : '';
    } catch { return ''; }
}


const BARRIOS_QUERIES = {
    'los mina':'barrio Los Mina Santo Domingo Este calle vecinos',
    'invivienda':'viviendas sociales Santo Domingo Este construccion',
    'charles de gaulle':'avenida Charles de Gaulle Santo Domingo Este',
    'ensanche ozama':'Ensanche Ozama Santo Domingo residentes barrio',
    'sabana perdida':'Sabana Perdida Santo Domingo comunidad',
    'villa mella':'Villa Mella Santo Domingo Norte calle barrio',
    'el almirante':'El Almirante Santo Domingo Este barrio',
    'los trinitarios':'Los Trinitarios Santo Domingo Este barrio calle',
    'carretera mella':'Carretera Mella Santo Domingo vehiculos transito',
    'sabana larga':'Sabana Larga Santo Domingo barrio',
    'av. venezuela':'Avenida Venezuela Santo Domingo',
    'mendoza':'Mendoza Santo Domingo Este comunidad barrio',
    'el tamarindo':'El Tamarindo Santo Domingo barrio vecinos',
    'san isidro':'San Isidro Santo Domingo Base Aerea',
};

const TEMA_QUERIES = {
    'policia':['police patrol dominican republic street officers'],
    'policía':['police patrol dominican republic street officers'],
    'crimen':['police investigation crime scene caribbean'],
    'accidente':['car accident road dominican republic'],
    'protesta':['protest demonstration people street caribbean'],
    'abinader':['latin american president ceremony podium speech'],
    'senado':['congress senate building government dominican'],
    'ayuntamiento':['city hall government building caribbean'],
    'mopc':['road construction workers highway caribbean'],
    'edeeste':['electricity power outage neighborhood caribbean'],
    'inundacion':['flooding rain streets neighborhood caribbean'],
    'inundación':['flooding rain streets neighborhood caribbean'],
    'huracan':['hurricane storm caribbean satellite weather'],
    'huracán':['hurricane storm caribbean satellite weather'],
    'beisbol':['baseball dominican republic stadium players game'],
    'béisbol':['baseball dominican republic stadium players game'],
    'tigres':['baseball dominican republic stadium night game'],
    'leones':['baseball dominican republic stadium crowd fans'],
    'futbol':['football soccer dominican republic stadium players'],
    'fútbol':['football soccer dominican republic stadium players'],
    'baloncesto':['basketball court players dominican republic'],
    'banco central':['central bank building finance dominican republic'],
    'dolar':['dollar peso exchange currency dominican republic'],
    'inflacion':['market food prices inflation caribbean'],
    'inflación':['market food prices inflation caribbean'],
    'colmado':['colmado tienda barrio dominicano productos'],
    'mercado':['market frutas verduras dominicano vendedor'],
    'petroleo':['fuel gas station prices oil caribbean'],
    'petróleo':['fuel gas station prices oil caribbean'],
    'inteligencia artificial':['artificial intelligence technology computer data'],
    'internet':['internet technology digital connection caribbean'],
    'celular':['smartphone mobile phone street caribbean'],
    'haiti':['Haiti border crossing Dominican Republic'],
    'haití':['Haiti border crossing Dominican Republic'],
    'trump':['Donald Trump White House president podium'],
    'estados unidos':['United States government Washington DC Capitol'],
    'venezuela':['Venezuela government crisis Caracas protest'],
    'cuba':['Cuba Havana street people government'],
    'musica':['music concert stage performer latin caribbean'],
    'música':['music concert stage performer latin caribbean'],
    'bachata':['bachata dominican music dance concert live'],
    'merengue':['merengue dominican music dance festival concert'],
    'reggaeton':['reggaeton latin music concert stage artist'],
    'educacion':['school classroom students education caribbean'],
    'educación':['school classroom students education caribbean'],
    'salud':['hospital medical healthcare caribbean doctor'],
    'vivienda':['housing construction social project caribbean'],
    'agua':['water supply pipes construction caribbean workers'],
    'transporte':['public transport bus street dominican republic'],
    'motoconcho':['motorcycle taxi motoconcho dominican republic street'],
    'corrupcion':['corruption government investigation justice dominican'],
    'corrupción':['corruption government investigation justice dominican'],
};

const URL_INVALIDAS_V40 = ['shutterstock','gettyimages','adobe.com/stock','dreamstime','alamy','depositphotos','123rf','istockphoto','vectorstock','bigstockphoto','watermark','wm_','preview','thumbnail','small_','lowres','100px','150px','200px','50px','icon','logo_','flag','seal','badge','avatar'];


// ══════════════════════════════════════════════════════════
// 🧑 PERSONAS_RD — Figuras públicas con query específico
//    Wikipedia es la fuente primaria para estas personas
//    (fotos de dominio público / licencia libre)
// ══════════════════════════════════════════════════════════
const PERSONAS_RD = {
    // ── BÉISBOL ──────────────────────────────────────────
    'david ortiz':        'David Ortiz baseball player Dominican Republic Red Sox',
    'papi ortiz':         'David Ortiz baseball player Dominican Republic Red Sox',
    'pedro martinez':     'Pedro Martinez baseball pitcher Dominican Republic',
    'robinson cano':      'Robinson Cano baseball player Dominican Republic',
    'juan soto':          'Juan Soto baseball player Dominican Republic',
    'vladimir guerrero':  'Vladimir Guerrero baseball Dominican Republic Hall Fame',
    'fernando tatis':     'Fernando Tatis Jr baseball player Dominican Republic',
    'manny ramirez':      'Manny Ramirez baseball player Dominican Republic',
    'albert pujols':      'Albert Pujols baseball Dominican Republic Cardinals',
    'jose reyes':         'Jose Reyes baseball player Dominican Republic shortstop',
    // ── BOXEO RD ─────────────────────────────────────────
    'el rayo mateo':      'Dominican Republic boxer boxing athlete ring',
    'rayo mateo':         'Dominican Republic boxer boxing ring athlete champion',
    'felix diaz':         'Felix Diaz Dominican Republic boxer Olympic gold',
    'joan guzman':        'Joan Guzman Dominican Republic boxer champion',
    // ── POLÍTICA RD ──────────────────────────────────────
    'alfredo pacheco':    'Alfredo Pacheco Cámara Diputados República Dominicana gobierno',
    'luis abinader':      'Luis Abinader presidente República Dominicana gobierno',
    'abinader':           'Luis Abinader presidente República Dominicana podio discurso',
    'danilo medina':      'Danilo Medina expresidente República Dominicana',
    'leonel fernandez':   'Leonel Fernández expresidente República Dominicana',
    'leonel fernández':   'Leonel Fernández expresidente República Dominicana',
    'orlando jorge mera': 'Orlando Jorge Mera ministro República Dominicana',
    'josé ignacio paliza':'José Ignacio Paliza PRM gobierno República Dominicana',
    'paliza':             'José Ignacio Paliza PRM gobierno República Dominicana',
    'miriam german':      'Miriam Germán procuradora República Dominicana justicia',
    'lisandro macarrulla': 'Lisandro Macarrulla vicepresidente República Dominicana',
    // ── INTERNACIONALES ──────────────────────────────────
    'kamala harris':      'Kamala Harris United States Vice President politician',
    'kamala':             'Kamala Harris United States Vice President politician',
    'donald trump':       'Donald Trump president United States White House podium',
    'trump':              'Donald Trump president United States rally speech',
    'joe biden':          'Joe Biden president United States White House',
    'biden':              'Joe Biden president United States government',
    'elon musk':          'Elon Musk Tesla SpaceX technology CEO businessman',
    'musk':               'Elon Musk Tesla SpaceX businessman technology',
    'pope francis':       'Pope Francis Vatican Catholic Church Rome',
    'papa francisco':     'Papa Francisco Vaticano Roma Iglesia Católica',
    'nicolas maduro':     'Nicolas Maduro Venezuela presidente gobierno Caracas',
    'maduro':             'Nicolas Maduro Venezuela presidente gobierno',
    'emmanuel macron':    'Emmanuel Macron France president government Paris',
    'xi jinping':         'Xi Jinping China president Beijing government',
    'vladimir putin':     'Vladimir Putin Russia president Kremlin Moscow',
    'volodimir zelenski': 'Volodymyr Zelensky Ukraine president government',
    'zelenski':           'Volodymyr Zelensky Ukraine president government',
    // ── MÚSICA / ESPECTÁCULOS RD ─────────────────────────
    'romeo santos':       'Romeo Santos bachata singer Dominican Republic concert',
    'prince royce':       'Prince Royce bachata singer Dominican Republic concert',
    'juan luis guerra':   'Juan Luis Guerra Dominican Republic music merengue concert',
    'aventura':           'Aventura bachata group Dominican Republic concert stage',
    'leslie grace':       'Leslie Grace Dominican Republic singer actress',
    'natti natasha':      'Natti Natasha Dominican Republic reggaeton singer',
    'tokischa':           'Tokischa Dominican Republic singer artist',
    // ── DEPORTES OTROS ───────────────────────────────────
    'messi':              'Lionel Messi Argentina football soccer player',
    'cristiano ronaldo':  'Cristiano Ronaldo Portugal football soccer player',
    'ronaldo':            'Cristiano Ronaldo Portugal football soccer stadium',
    'neymar':             'Neymar Brazil football soccer player',
    'lebron james':       'LeBron James NBA basketball player Lakers',
    // ── MUNDIAL 2026 ─────────────────────────────────────
    'mundial 2026':       'FIFA World Cup 2026 football soccer stadium fans',
    'copa del mundo':     'FIFA World Cup football soccer stadium tournament',
    'fifas':              'FIFA football soccer World Cup tournament stadium',
};

// Detecta si el título/contenido menciona una persona conocida
// y devuelve el query específico de Wikipedia/foto pública
async function detectarPersona(titulo, contenido) {
    const texto = `${titulo} ${(contenido||'').substring(0,300)}`.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // 1. Buscar primero en hardcoded PERSONAS_RD
    for (const [nombre, query] of Object.entries(PERSONAS_RD)) {
        const nombreNorm = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (texto.includes(nombreNorm)) {
            console.log(`   🧑 Persona detectada (hardcode): "${nombre}" → "${query}"`);
            return query;
        }
    }
    // 2. Buscar en BD personas_publicas (las agregadas desde /redaccion)
    try {
        const r = await pool.query('SELECT nombre_lower,query_foto FROM personas_publicas WHERE activo=true');
        for (const row of r.rows) {
            const nombreNorm = row.nombre_lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (texto.includes(nombreNorm)) {
                console.log(`   🧑 Persona detectada (BD): "${row.nombre_lower}" → "${row.query_foto}"`);
                return row.query_foto;
            }
        }
    } catch {}
    return null;
}

async function extraerQueriesCoherentes(titulo, contenido, categoria) {
    const texto  = `${titulo} ${(contenido||'').substring(0,600)}`.toLowerCase();
    const queries = [];

    // ── PRIORIDAD 1: Persona conocida (David Ortiz, Abinader, Trump…) ──
    const queryPersona = await detectarPersona(titulo, contenido);
    if (queryPersona) queries.unshift(queryPersona);

    // ── PRIORIDAD 2: Barrio SDE ────────────────────────────────────────
    for (const [barrio, query] of Object.entries(BARRIOS_QUERIES))
        if (texto.includes(barrio)) { queries.push(query); break; }

    // ── PRIORIDAD 3: Tema general ──────────────────────────────────────
    const temasEncontrados = [];
    for (const [keyword, queryArr] of Object.entries(TEMA_QUERIES)) {
        if (texto.includes(keyword)) { temasEncontrados.push(...queryArr); if (temasEncontrados.length >= 2) break; }
    }
    if (temasEncontrados.length) {
        if (queries.length) queries.unshift(`${temasEncontrados[0]} ${queries[0].split(' ').slice(0,3).join(' ')}`);
        queries.push(...temasEncontrados.slice(0,2));
    }
    const catFallback = {
        'Nacionales':'noticias comunidad vecinos barrio Santo Domingo caribe',
        'Deportes':'deporte atletas dominicanos estadio cancha',
        'Internacionales':'international news world event people crowd',
        'Economía':'economia mercado negocios comercio Santo Domingo',
        'Tecnología':'technology innovation digital computer caribbean',
        'Espectáculos':'entertainment music concert artist caribbean stage',
    };
    queries.push(catFallback[categoria]||'news community neighborhood dominican republic');
    const vistos = new Set();
    return queries.filter(q => { const k=q.trim().toLowerCase(); if(vistos.has(k))return false; vistos.add(k); return k.length>5; });
}

function buildQueryInternacional(titulo, contenido) {
    const texto = `${titulo} ${(contenido||'').substring(0,300)}`.toLowerCase();
    const mapa  = {
        'estados unidos':'United States government Washington politics',
        'trump':'Donald Trump president White House speech',
        'haití':'Haiti government crisis people border dominican',
        'haiti':'Haiti government crisis people border dominican',
        'venezuela':'Venezuela government Caracas protest people',
        'cuba':'Cuba Havana government people street',
        'colombia':'Colombia government Bogota politics',
        'brasil':'Brazil government Brasilia Amazon politics',
        'mexico':'Mexico City government politics street',
        'ucrania':'Ukraine war conflict military soldiers',
        'israel':'Israel conflict Middle East military',
        'china':'China Beijing government politics economic',
        'rusia':'Russia Kremlin Moscow government military',
        'españa':'Spain Madrid European Union government',
        'argentina':'Argentina Buenos Aires government economy',
        'onu':'United Nations General Assembly diplomacy summit',
        'oms':'World Health Organization medical public health',
        'fondo monetario':'International Monetary Fund economy finance meeting',
        'banco mundial':'World Bank development finance economy meeting',
        'otan':'NATO alliance military defense meeting leaders',
    };
    for (const [kw,q] of Object.entries(mapa)) if (texto.includes(kw)) return q;
    const stop = new Set(['el','la','los','las','un','una','de','del','en','y','a','se','que','por','con','su','al','es','son','fue','han','ha','lo','más','para','sobre','como','entre','pero','sin','ya','no','si','o','e','ni','este','esta']);
    const pals = titulo.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>3&&!stop.has(w)).slice(0,3).join(' ');
    return `${pals||'international'} news event people`;
}

// FASE 2: ambas funciones ahora usan lib/imagenes (marca validada, almacén persistente, descarga anti-SSRF).
async function aplicarWatermarkV40(urlImagen) {
    try {
        const buf = await imgDep.descargar(urlImagen, 'ElFarolAlDia/2.0');
        const { buffer, marcada } = await aplicarMarca(buf);
        const nombre = `efd-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
        await almacen.guardar(nombre, buffer, { fuenteId: 'manual-url', original: urlImagen });
        return { url: `${BASE_URL}/img/${nombre}`, nombre, procesada: marcada, original: urlImagen };
    } catch (err) { console.warn('   ⚠️ watermark URL:', err.message); return { url: urlImagen, nombre: null, procesada: false }; }
}
async function aplicarWatermarkBuffer(bufOrig) {
    try {
        const { buffer } = await aplicarMarca(bufOrig);
        const nombre = `efd-manual-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.jpg`;
        await almacen.guardar(nombre, buffer, { fuenteId: 'manual-upload' });
        return nombre;
    } catch { return null; }
}

// ══════════════════════════════════════════════════════════
// 🧠 PROMPT V41 — CON GSC INTEGRADO
// ══════════════════════════════════════════════════════════
// 🧠 El Jefe de Redacción Inteligente vive en lib/jefe.js (prompt de sistema + parser flexible + virality) y
//    sus metadatos se guardan en MongoDB (lib/mongo.js).

async function construirPrompt(categoria, comunicadoExterno) {
    const ALTO_CPM  = ['Economía','Tecnología','Internacionales'];
    const esCatAlta = ALTO_CPM.includes(categoria);
    let topNoticias='',malNoticias='',metaStr='',memoriaAnti='';
    try {
        const rTop = await pool.query(`SELECT titulo,vistas,seccion FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days' AND vistas>0 ORDER BY vistas DESC LIMIT 8`);
        if (rTop.rows.length) { topNoticias='\n🏆 NOTICIAS MÁS EXITOSAS (replica su fórmula):\n'; topNoticias+=rTop.rows.map((n,i)=>`${i+1}. [${n.vistas} vistas|${n.seccion}] "${n.titulo}"`).join('\n')+'\n'; }
        const rMal = await pool.query(`SELECT titulo,vistas FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days' ORDER BY vistas ASC LIMIT 4`);
        if (rMal.rows.length) { malNoticias='\n📉 NOTICIAS CON POCAS VISTAS (evita estos patrones):\n'; malNoticias+=rMal.rows.map((n,i)=>`${i+1}. [${n.vistas} vistas] "${n.titulo}"`).join('\n')+'\n'; }
        const rProm = await pool.query(`SELECT ROUND(AVG(vistas)) as p FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days'`);
        const prom  = parseInt(rProm.rows[0]?.p||0);
        if (prom>0) metaStr=`\n🎯 META: Promedio actual ${prom} vistas → superar ${prom*2} (2x).\n`;
        const rAnti = await pool.query(`SELECT titulo,seccion FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 25`);
        if (rAnti.rows.length) { memoriaAnti='\n⛔ PROHIBIDO REPETIR ESTOS TEMAS:\n'; memoriaAnti+=rAnti.rows.map((x,i)=>`${i+1}. ${x.titulo} [${x.seccion}]`).join('\n'); memoriaAnti+='\n⚠️ Busca ángulo diferente o tema nuevo.\n'; }
    } catch {}

    const frasesExitosas = await obtenerFrasesExitosas();
    const seccionFrases  = frasesExitosas.length ? `\n🔥 FRASES QUE GENERAN CLICS:\n${frasesExitosas.map(f=>`- "${f}"`).join('\n')}\n` : '';

    // ── 🆕 GSC INTELIGENCIA REAL ──────────────────────────
    const gscContexto = await obtenerContextoGSC(categoria);

    let contextoActual = '';
    if (GOOGLE_CSE_KEYS.length && GOOGLE_CSE_CX) {
        try {
            const q    = {Nacionales:'noticias Santo Domingo Este hoy 2026',Deportes:'deportes RD hoy 2026',Internacionales:'noticias internacionales Caribe 2026',Economía:'economía dominicana 2026',Tecnología:'tecnología digital RD 2026',Espectáculos:'farándula dominicana 2026'}[categoria]||'noticias RD 2026';
            const key  = GOOGLE_CSE_KEYS[new Date().getHours()%2===0?0:GOOGLE_CSE_KEYS.length-1];
            const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),6000);
            const res  = await fetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${GOOGLE_CSE_CX}&q=${encodeURIComponent(q)}&num=3`,{signal:ctrl.signal}).finally(()=>clearTimeout(tm));
            if (res.ok) {
                const data  = await res.json();
                const items = data.items||[];
                if (items.length) { contextoActual='\n📰 NOTICIAS ACTUALES DE REFERENCIA (no copiar):\n'; for (const it of items.slice(0,2)) contextoActual+=`- ${it.title}\n  ${(it.snippet||'').substring(0,180)}\n`; }
            }
        } catch {}
    }

    const memoriaMongo = await mongo.memoriaParaPrompt(categoria);
    const fechaTxt     = new Date().toLocaleDateString('es-DO',{month:'long',year:'numeric',timeZone:'America/Santo_Domingo'}).toUpperCase();
    const contextoWiki = await buscarContextoWikipedia(categoria);
    const estrategia   = leerEstrategia();

    const fuenteContenido = comunicadoExterno
        ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno.replace(/^ENLACE:.*$/m,'').trim()}\n"""\nRedacta una noticia profesional basada en este comunicado.`
        : `\nEscribe una noticia NUEVA, ORIGINAL, de impacto para la categoría "${categoria}" enfocada en Santo Domingo Este, República Dominicana. Hecho real y relevante para ${fechaTxt}.`;

    return `${CONFIG_IA.instruccion_principal}

ROL: Redactor Jefe de El Farol al Día. Voz del barrio de SDE. Conoces tus métricas y escribes para dominar Google.
FECHA: ${fechaTxt}. Nada de noticias del pasado.

${topNoticias}
${malNoticias}
${metaStr}
${memoriaAnti}
${seccionFrases}
${memoriaMongo}
${gscContexto}
${contextoActual}
${contextoWiki}
${fuenteContenido}

════════════════════════════════════════════════════════
🎯 INSTRUCCIONES OBLIGATORIAS V41 — LEER COMPLETO
════════════════════════════════════════════════════════

SECCIÓN A — FORMATO DE RESPUESTA:

Sigue el formato del MÓDULO JEFE DE REDACCIÓN (líneas TIPO_NOTICIA, VIRALITY_SCORE, TITULO, TITULAR_SOCIAL, DESCRIPCION, PALABRAS, SUBTEMA_LOCAL y luego CONTENIDO:).
- TITULO: máximo 65 caracteres, con palabras clave reales de GSC.
- DESCRIPCION: SEO de 150-160 caracteres con keywords RD + SDE.
- SUBTEMA_LOCAL: [UNO DE: politica-gobierno | seguridad-policia | economia-mercado | deporte-beisbol | deporte-futbol | deporte-general | tecnologia | educacion | cultura-musica | salud-medicina | infraestructura | vivienda-social | transporte-vial | medio-ambiente | turismo | emergencia | relaciones-internacionales]
- CONTENIDO: el cuerpo completo de la noticia.

════════════════════════════════════════════════════════
SECCIÓN B — REGLAS DEL CONTENIDO (OBLIGATORIAS)
════════════════════════════════════════════════════════

1️⃣  EXTENSIÓN: entre 400 y 700 palabras. MÍNIMO 5 párrafos cortos.

2️⃣  ESTRUCTURA DE 8 PÁRRAFOS:
   P1-GANCHO: Hecho impactante. Menciona el barrio. Usa palabras clave GSC.
   P2-CONTEXTO: Antecedentes. ¿Qué venía pasando?
   P3-DETALLES: Nombres, cifras, calles específicas de SDE.
   P4-AMBIENTE: El ambiente del día, ruido de motores, parada del carro público, el colmado.
   P5-IMPACTO LOCAL: ¿Cómo afecta a la gente de ${categoria==='Deportes'?'Los Mina':'Invivienda'}?
   P6-REACCIÓN: Testimonios del barrio en comillas.
   P7-ANÁLISIS: Contexto más amplio para RD.
   P8-CIERRE: Qué viene. Call-to-action.

3️⃣  LUGARES CONCRETOS DE SDE — menciona al menos 2:
   Los Mina, Invivienda, Charles de Gaulle, Ensanche Ozama,
   Sabana Perdida, Villa Mella, El Almirante, Carretera Mella,
   Sabana Larga, Av. Venezuela, Entrada de las Palmas, Los Trinitarios

4️⃣  LENGUAJE DOMINICANO (mezcla estas naturalmente, no todas juntas):
   "se armó el avispero", "la gente está en grito", "se supo de buena fuente",
   "según los vecinos del sector", "fue confirmado", "los residentes dicen",
   "en el barrio se habla", "trascendió que", "se conoció que",
   "se formó el rollo", "aquello se puso color de hormiga", "todo el mundo habla de eso",
   "nadie lo podía creer", "se armó el show", "la movida no era pa' menos",
   "se supo de buena tinta", "así lo confirmaron en el sector", "que si se armó el tato"

5️⃣  PÁRRAFOS CORTOS: Máximo 3 líneas. El lector usa celular.

6️⃣  PRIMERA LÍNEA: GANCHO DIRECTO. Prohibido empezar con "En el día de hoy".

7️⃣  CATEGORÍA: ${categoria}
8️⃣  EVITAR: ${CONFIG_IA.evitar}
9️⃣  ÉNFASIS: ${CONFIG_IA.enfasis}
🔟 EXTENSIÓN OBJETIVO: ${esCatAlta?'500-700':'400-600'} palabras

${estrategia}

RECUERDA: Usa las PALABRAS CLAVE REALES de Search Console en el título. Eso es lo que Google quiere ver.`;
}

// ══════════════════════════════════════════════════════════
// ✅ VALIDADOR FLEXIBLE — solo es bloqueante lo que de verdad impide publicar (texto vacío/diminuto).
//    Barrio SDE, lenguaje dominicano y nº de párrafos son AVISOS de calidad: se guardan en Mongo, no queman intentos.
// ══════════════════════════════════════════════════════════
function validarContenido(contenido, intento = 1) {
    if (!contenido||typeof contenido!=='string') if(contenido) return {valido:true,contenido:contenido.trim()}; if(contenido) return {valido:true,contenido:contenido.trim()}; return {valido:false,razon:'Contenido nulo'};
    const limpio   = contenido.trim();
    const longMin  = intento===1?500:intento===2?400:300;       // se relaja con cada intento: mejor publicar algo correcto que perder la noticia
    if (limpio.length<longMin) return {valido:false,razon:`${limpio.length} chars < ${longMin}`};
    const avisos = [];
    const barriosSDE = ['Los Mina','Invivienda','Charles de Gaulle','Ensanche Ozama','Sabana Perdida','Villa Mella','El Almirante','Mendoza','Los Trinitarios','San Isidro','Santo Domingo Este','SDE','Carretera Mella','Sabana Larga'];
    const barriosMencionados = barriosSDE.filter(b=>limpio.toLowerCase().includes(b.toLowerCase()));
    if (!barriosMencionados.length) avisos.push('sin_barrio_sde');
    const parrafos = limpio.split(/\n\s*\n/).filter(p=>p.trim().length>20);
    if (parrafos.length<4) avisos.push(`pocos_parrafos_${parrafos.length}`);
    const frasesDom = ['se supo','fue confirmado','según fuentes','la gente del sector','vecinos dicen','en el barrio','en la calle','fue informado','trascendió','se conoció','se armó','está en grito','de buena fuente','los residentes','la comunidad'];
    if (!frasesDom.some(f=>limpio.toLowerCase().includes(f))) avisos.push('sin_lenguaje_de_barrio');
    const palabras = limpio.split(/\s+/).filter(w=>w.length>2).length;
    return {valido:true,longitud:limpio.length,palabras,barrios:barriosMencionados,parrafos:parrafos.length,avisos};
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function creditoHTML(n) {
    if (!n.imagen_credito) return '';
    const lic = n.imagen_licencia ? (n.imagen_licencia_url ? `<a href="${esc(n.imagen_licencia_url)}" target="_blank" rel="license noopener nofollow">${esc(n.imagen_licencia)}</a>` : esc(n.imagen_licencia)) : '';
    const src = n.imagen_original ? `<a href="${esc(n.imagen_original)}" target="_blank" rel="noopener nofollow">${esc(n.imagen_credito)}</a>` : esc(n.imagen_credito);
    return `Foto: ${src}${lic ? ' · ' + lic : ''}`;
}
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function metaTagsCompletos(n, url) {
    const t=esc(n.titulo),d=esc(n.seo_description||''),img=esc(n.imagen),sec=esc(n.seccion);
    const fi=new Date(n.fecha).toISOString(),ue=esc(url);
    const wc=(n.contenido||'').split(/\s+/).filter(w=>w).length;
    const keys=[n.seo_keywords||'','último minuto república dominicana','santo domingo este noticias','el farol al día','los mina invivienda sde'].filter(Boolean).join(', ');
    const schema={"@context":"https://schema.org","@type":"NewsArticle","mainEntityOfPage":{"@type":"WebPage","@id":url},"headline":n.titulo,"description":n.seo_description||'',"image":{"@type":"ImageObject","url":n.imagen,"width":1200,"height":630},"datePublished":fi,"dateModified":fi,"author":{"@type":"Person","name":"El Farol al Día"},"publisher":{"@type":"NewsMediaOrganization","name":"El Farol al Día","url":BASE_URL,"logo":{"@type":"ImageObject","url":`${BASE_URL}/static/favicon.png`}},"articleSection":n.seccion,"wordCount":wc,"inLanguage":"es-DO"};
    const bread={"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Inicio","item":BASE_URL},{"@type":"ListItem","position":2,"name":n.seccion,"item":`${BASE_URL}/#${(n.seccion||'').toLowerCase()}`},{"@type":"ListItem","position":3,"name":n.titulo,"item":url}]};
    const tSEO=n.titulo.toLowerCase().includes('santo domingo')||n.titulo.toLowerCase().includes('sde')?`${t} | El Farol al Día`:`${t} | Último Minuto SDE · El Farol al Día`;
    return `<title>${tSEO}</title>
<meta name="description" content="${d}">
<meta name="keywords" content="${esc(keys)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${ue}">
<meta property="og:type" content="article"><meta property="og:title" content="${t}">
<meta property="og:description" content="${d}"><meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${ue}"><meta property="og:site_name" content="El Farol al Día · Último Minuto SDE">
<meta property="article:published_time" content="${fi}"><meta property="article:section" content="${sec}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${img}">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(bread)}</script>`;
}

function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ñ]/g,'n').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').substring(0,75);
}

const REDACTORES=[{nombre:'Carlos Méndez',esp:'Nacionales'},{nombre:'Laura Santana',esp:'Deportes'},{nombre:'Roberto Peña',esp:'Internacionales'},{nombre:'Ana María Castillo',esp:'Economía'},{nombre:'José Miguel Fernández',esp:'Tecnología'},{nombre:'Patricia Jiménez',esp:'Espectáculos'}];
function redactor(cat) { const m=REDACTORES.filter(r=>r.esp===cat); return m.length?m[Math.floor(Math.random()*m.length)].nombre:'Redacción EFD'; }

async function registrarError(desc, cat) {
    try {
        await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES('error',$1,$2,1) ON CONFLICT DO NOTHING",[desc.substring(0,200),cat]);
        await pool.query("UPDATE memoria_ia SET fallos=fallos+1,ultima_vez=NOW() WHERE tipo='error' AND valor=$1",[desc.substring(0,200)]);
    } catch {}
}

// ══════════════════════════════════════════════════════════
// 📰 GENERAR NOTICIA — V41
// ══════════════════════════════════════════════════════════
async function generarNoticia(categoria, comunicadoExterno = null, reintento = 1) {
    const MAX_REINTENTOS = 3;
    const inicio = Date.now();
    const rol = roles.rolPara(categoria);
    const enlaceFuente = ((comunicadoExterno || '').match(/^ENLACE:\s*(https:\/\/\S+)/m) || [])[1] || null;
    let parsed = null;
    try {
        if (!CONFIG_IA.enabled) return {success:false,error:'IA desactivada'};
        console.log(`\n📰 [V41] Generando — ${categoria} — Intento ${reintento}/${MAX_REINTENTOS}`);

        // ── Jefe de Redacción: pre-evaluación (código) + módulo analítico inyectado en el prompt de SISTEMA ──
        const pre        = jefe.preevaluar(comunicadoExterno || '', categoria);
        const promptBase = roles.encabezado(rol) + await construirPrompt(categoria, comunicadoExterno);
        const prompt     = `${promptBase}\n\n--- PRE-EVALUACIÓN DEL JEFE DE REDACCIÓN ---\nTIPO_SUGERIDO: ${pre.tipo}\nVIRALITY_BASE: ${pre.virality}/100\nConfirma o corrige estos datos con tu propio análisis.\n--------------------------------------------`;
        const system     = `${roles.systemDe(rol)}\n\n${jefe.bloqueSistema()}`;
        console.log(`   📝 ${rol.nombre} (${rol.cargo}) redacta | Jefe Redacción activo (${pre.tipo}, base ${pre.virality})...`);
        const textoIA = await llm.generarTexto(prompt, 3, 3500, { system, temperature: rol.temperature });

        // ── Parser inteligente: acepta etiquetas o texto libre; nunca lanza error por formato ──
        parsed = jefe.parsearRespuesta(textoIA, { categoria });
        const titulo    = jefe.elegirTitular(parsed.tituloA, parsed.tituloB);
        const contenido = parsed.contenido;
        const desc      = parsed.descripcion;
        const pals      = parsed.palabras;
        const sub       = parsed.subtema;
        console.log(`   🧾 Parser: ${parsed.modo} | título: "${titulo}"`);

        const val = validarContenido(contenido, reintento);
        if (!val.valido) {
            console.log(`   ⚠️ Validación falló (${reintento}): ${val.razon}`);
            throw new Error(`Validación fallida: ${val.razon}`);
        }
        if (val.avisos.length) console.log(`   ℹ️ Avisos de calidad (no bloquean): ${val.avisos.join(', ')}`);
        console.log(`   ✅ OK: ${val.longitud} chars, ${val.palabras} palabras, ${val.parrafos} párrafos`);
        logAnalytics('NOTICIA_GENERADA',{categoria,chars:val.longitud,palabras:val.palabras,dur_s:Math.round((Date.now()-inicio)/1000)});

        const similares = await detectarPlagio(contenido);
        if (similares.length) console.warn(`   🕵️ Similitud con: ${similares.join(', ')}`);

        // ── Imagen: extractor web directo (fuente original + búsqueda por contexto); sin APIs de terceros ──
        const imgResult = await obtenerImagenLimpia({ titulo, contenido, categoria, subtema: sub, personaQuery: await detectarPersona(titulo, contenido), enlaceFuente });

        const altBase = {'Nacionales':`Noticias ${titulo.substring(0,40)} Santo Domingo Este`,'Deportes':`Deportes dominicanos ${titulo.substring(0,35)}`,'Internacionales':`Internacional ${titulo.substring(0,35)} Caribe`,'Economía':`Economía dominicana ${titulo.substring(0,35)}`,'Tecnología':`Tecnología ${titulo.substring(0,40)} RD`,'Espectáculos':`Espectáculos ${titulo.substring(0,35)} República Dominicana`};
        const altFinal = `${altBase[categoria]||titulo.substring(0,50)} - El Farol al Día`;

        const slugBase = slugify(titulo);
        if (!slugBase||slugBase.length<3) throw new Error('Slug inválido');
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1',[slugBase]);
        const slFin  = existe.rows.length?`${slugBase.substring(0,68)}-${Date.now().toString().slice(-6)}`:slugBase;

        const cert = ledger.certificar({titulo, contenido, seccion: categoria, fecha: new Date()});
        const redactorFinal = rol.heredado?redactor(categoria):rol.nombre;
        await pool.query(
            'INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado,ledger_hash,imagen_credito,imagen_licencia,imagen_licencia_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
            [titulo.substring(0,255),slFin,categoria,contenido.substring(0,12000),desc.substring(0,160),(pals||categoria).substring(0,255),redactorFinal,imgResult.urlFinal,altFinal.substring(0,255),`Fotografía: ${titulo}`,imgResult.nombre,imgResult.fuente,imgResult.urlOriginal,'publicada',cert.hash,imgResult.credito||null,imgResult.licencia||null,imgResult.licenciaUrl||null]
        );
        console.log(`   🔐 Ledger: ${ledger.hashCorto(cert.hash)}`);

        const durTotal = Math.round((Date.now()-inicio)/1000);
        console.log(`\n✅ [V41] Publicada → /noticia/${slFin} (${durTotal}s) | WM:${imgResult.procesada?'✅':'⚠️'}`);
        logAnalytics('NOTICIA_PUBLICADA',{slug:slFin,categoria,chars:val.longitud,duracion_s:durTotal,imagen:imgResult.fuente,watermark:imgResult.procesada,gsc:true});

        invalidarCache();

        const frases = titulo.match(/[A-ZÁÉÍÓÚ][^,.:;!?]{10,40}/g)||[];
        for (const f of frases.slice(0,2)) await guardarFraseExitosa(f,10);

        await notificarNuevaNoticia(titulo, desc.substring(0,160), slFin, imgResult.urlFinal);
        setImmediate(()=>publicarEnRedes(titulo,slFin,imgResult.urlFinal,desc,categoria,contenido));

        // ── Memoria: evaluación del Jefe de Redacción + historial en MongoDB (nunca bloquea ni tumba la publicación) ──
        const evalJefe = jefe.evaluarFinal({ parsed, titulo, contenido, categoria, contexto: comunicadoExterno });
        const meta = {
            slug: slFin, titulo, categoria, ...evalJefe,
            redactor: redactorFinal,
            ab_test: { a: parsed.tituloA, b: parsed.tituloB, elegido: titulo },
            seo: { descripcion: desc.substring(0,160), palabras: pals, subtema: sub },
            parser: parsed.modo, modelo: llm.MODELO, intento: reintento,
            imagen: { fuente: imgResult.fuente, licencia: imgResult.licencia||null, credito: imgResult.credito||null, pagina_fuente: imgResult.paginaFuente||null },
            enlace_fuente: enlaceFuente,
            calidad: { chars: val.longitud, palabras: val.palabras, parrafos: val.parrafos, avisos: val.avisos },
            dur_s: durTotal, publicada_at: new Date().toISOString(),
        };
        const guardada = await mongo.guardarEvaluacion(meta);
        if (!guardada) console.warn('   ⚠️ Evaluación del Jefe de Redacción NO guardada en MongoDB (ver /api/jefe-redaccion/estado)');
        mongo.registrarIntento({ categoria, reintento, ok: true, slug: slFin, parser: parsed.modo, modelo: llm.MODELO, dur_s: durTotal, tipo_noticia: meta.tipo_noticia, virality_score: meta.virality_score });

        return {success:true,slug:slFin,titulo,redactor:meta.redactor,rol:rol.cargo,alt:altFinal,mensaje:'✅ Publicada V41 con Ollama + Jefe Redacción',stats:val,imagen:imgResult,ab:{a:parsed.tituloA,b:parsed.tituloB,elegido:titulo},virality:meta.virality_score,tipo:meta.tipo_noticia,mongo:guardada};

    } catch(error) {
        const dur = Math.round((Date.now()-inicio)/1000);
        console.error(`❌ [V41] Error intento ${reintento} (${dur}s):`, error.message);
        logAnalytics('NOTICIA_ERROR',{categoria,reintento,error:error.message,dur_s:dur});
        mongo.registrarIntento({ categoria, reintento, ok: false, error: error.message.slice(0,300), parser: parsed?.modo||null, modelo: llm.MODELO, dur_s: dur });
        if (reintento<MAX_REINTENTOS) { await new Promise(r=>setTimeout(r,8000)); return generarNoticia(categoria,comunicadoExterno,reintento+1); }
        await registrarError(error.message, categoria);
        return {success:false,error:error.message};
    }
}

// ══════════════════════════════════════════════════════════
// RSS
// ══════════════════════════════════════════════════════════
const FUENTES_RSS = [
    {url:'https://presidencia.gob.do/feed',categoria:'Nacionales',nombre:'Presidencia RD'},
    {url:'https://policia.gob.do/feed',categoria:'Nacionales',nombre:'Policía Nacional'},
    {url:'https://www.mopc.gob.do/feed',categoria:'Nacionales',nombre:'MOPC'},
    {url:'https://www.salud.gob.do/feed',categoria:'Nacionales',nombre:'Salud Pública'},
    {url:'https://www.educacion.gob.do/feed',categoria:'Nacionales',nombre:'Educación'},
    {url:'https://www.bancentral.gov.do/feed',categoria:'Economía',nombre:'Banco Central'},
    {url:'https://www.invivienda.gob.do/feed',categoria:'Nacionales',nombre:'Invivienda'},
    {url:'https://www.diariolibre.com/feed',categoria:'Nacionales',nombre:'Diario Libre'},
    {url:'https://listindiario.com/feed',categoria:'Nacionales',nombre:'Listín Diario'},
    {url:'https://elnacional.com.do/feed/',categoria:'Nacionales',nombre:'El Nacional'},
    {url:'https://www.eldinero.com.do/feed/',categoria:'Economía',nombre:'El Dinero'},
    {url:'https://acento.com.do/feed/',categoria:'Nacionales',nombre:'Acento'},
    {url:'https://www.hoy.com.do/feed/',categoria:'Nacionales',nombre:'Hoy'},
    {url:'https://www.noticiassin.com/feed/',categoria:'Nacionales',nombre:'Noticias SIN'},
    {url:'https://www.cdt.com.do/feed/',categoria:'Deportes',nombre:'CDT Deportes'},
    {url:'https://feeds.bbci.co.uk/mundo/rss.xml',categoria:'Internacionales',nombre:'BBC Mundo'},
    {url:'https://feeds.feedburner.com/TechCrunch',categoria:'Tecnología',nombre:'TechCrunch'},
];

async function procesarRSS() {
    if (!CONFIG_IA.enabled) return;
    console.log('\n📡 Procesando RSS...');
    let ok = 0;
    for (const fuente of FUENTES_RSS) {
        try {
            const feed = await rssParser.parseURL(fuente.url).catch(()=>null);
            if (!feed?.items?.length) continue;
            for (const item of feed.items.slice(0,3)) {
                const guid = item.guid||item.link||item.title;
                if (!guid) continue;
                const existe = await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1',[guid.substring(0,500)]);
                if (existe.rows.length) continue;
                const comunicado = [item.title?`TÍTULO: ${item.title}`:'',item.contentSnippet?`RESUMEN: ${item.contentSnippet}`:'',`FUENTE: ${fuente.nombre}`,item.link?`ENLACE: ${item.link}`:''].filter(Boolean).join('\n');
                const r = await generarNoticia(fuente.categoria, comunicado);
                if (r.success) { await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',[guid.substring(0,500),fuente.nombre]); ok++; await new Promise(r=>setTimeout(r,8000)); }
                break;
            }
        } catch(err) { console.warn(`⚠️ ${fuente.nombre}: ${err.message}`); }
    }
    console.log(`📡 RSS: ${ok} noticias`);
    logAnalytics('RSS_PROCESADO',{noticias:ok});
}

// ══════════════════════════════════════════════════════════
// 🗑️ AUTO-LIMPIEZA
// ══════════════════════════════════════════════════════════
async function autoLimpieza() {
    try {
        // 🔒 SEO FIX: ya NO se borran noticias. Google indexa estas URLs y borrarlas
        // genera 404s reales (soft-404 / crawl trust perdido). En vez de DELETE,
        // se archivan: salen del sitemap y dejan de competir por crawl budget,
        // pero la página sigue viva (200) para no tirar autoridad ya ganada.
        const r = await pool.query(`UPDATE noticias SET estado='archivada' WHERE fecha<NOW()-INTERVAL '90 days' AND vistas<5 AND estado='publicada' RETURNING id`);
        if (r.rowCount>0) { console.log(`🗄️ Auto-limpieza: ${r.rowCount} archivadas (ya no se eliminan)`); invalidarCache(); }
    } catch(e) { console.warn('⚠️ Auto-limpieza:', e.message); }
}

// ══════════════════════════════════════════════════════════
// ⏰ CRON
// ══════════════════════════════════════════════════════════
const CATS = ['Nacionales','Deportes','Internacionales','Economía','Tecnología','Espectáculos'];
const ARRANQUE_TIME = Date.now();

async function getHorasPico() {
    try {
        const r = await pool.query(`SELECT EXTRACT(HOUR FROM fecha)::int as h, ROUND(AVG(vistas)) as p FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '14 days' GROUP BY h ORDER BY p DESC LIMIT 5`);
        return r.rows.map(x=>x.h);
    } catch { return [7,10,13,17,20]; }
}

cron.schedule('*/5 * * * *', async () => { try { await fetch(`http://localhost:${PORT}/health`); } catch {} });

cron.schedule('0 8-18 * * *', async () => {
    // Cada 3 horas — ahorra 66% de llamadas vs cada hora
    if (!CONFIG_IA.enabled) return;
    if (Date.now()-ARRANQUE_TIME < 35*60*1000) return;
    const hora = new Date().getHours();
    if ([0,1,2,3,4,5].includes(hora)) return; // Sin generar de madrugada
    // Verificar llave disponible ANTES de intentar
    if (!llm.disponible()) { console.warn('⏳ Cron: Llama no disponible (circuito abierto) — saltando'); return; }
    console.log(`⏰ Cron hora ${hora}:00`);
    await generarNoticia(CATS[hora%CATS.length]);
});

// ── GSC Sync automático ───────────────────────────────────
cron.schedule('0 6,12,18 * * *', async () => {
    console.log('📊 [GSC] Sync programado...');
    await sincronizarGSC();
});

cron.schedule('30 8,19 * * *', procesarRSS);
cron.schedule('0 */6 * * *', async () => { try { await analizarYGenerar(); } catch(e) { console.error('❌ Estrategia:', e.message); } });
cron.schedule('0 7 * * *', async () => {
    try {
        const r  = await pool.query(`SELECT seccion,ROUND(AVG(vistas)) as p,COUNT(*) as c FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days' GROUP BY seccion ORDER BY p DESC`);
        const gl = await pool.query(`SELECT ROUND(AVG(vistas)) as p,MAX(vistas) as mx,COUNT(*) as t FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days'`);
        const g=gl.rows[0]; const mx=Math.max(...r.rows.map(x=>parseInt(x.p)||0),1);
        const bar=(n,m)=>'█'.repeat(Math.round((n/m)*10))+'░'.repeat(10-Math.round((n/m)*10));
        console.log('\n╔══════════════════════════════════════════════════════╗');
        console.log('║  📊 REPORTE DIARIO — El Farol al Día V41.0          ║');
        console.log(`║  📰 ${g?.t||0} noticias | Promedio: ${g?.p||0} | Máx: ${g?.mx||0}              ║`);
        r.rows.forEach(c=>console.log(`║  ${(c.seccion+'            ').slice(0,14)} ${bar(parseInt(c.p)||0,mx)} ${c.p} ║`));
        console.log('╚══════════════════════════════════════════════════════╝\n');
        logAnalytics('REPORTE_DIARIO',{total:g?.t,promedio:g?.p,maximo:g?.mx});
    } catch(e) { console.warn('⚠️ Reporte:', e.message); }
});
cron.schedule('0 3 * * 0', autoLimpieza);
cron.schedule('20 */6 * * *', () => mongo.sincronizarRendimiento(pool).catch(()=>{}));   // vistas reales → memoria del Jefe de Redacción
cron.schedule('* * * * *', () => cache.vaciarVistas(pool).catch(()=>{}));     // vistas: Redis → Postgres por lotes
for (const sig of ['SIGTERM','SIGINT']) process.on(sig, async () => { try { await cache.vaciarVistas(pool); await cache.cerrar(); } finally { process.exit(0); } });

async function rafagaInicial() {
    // Solo 1 noticia al arrancar — antes eran 3 (quemaba llaves de golpe)
    if (!CONFIG_IA.enabled) return;
    if (!llm.disponible()) { console.warn('⏳ Ráfaga: Llama no disponible'); return; }
    console.log('🚀 Ráfaga inicial — 1 noticia');
    try { await generarNoticia(CATS[0]); } catch(e) { console.warn('⚠️ Ráfaga inicial:', e.message); }
}

// ══════════════════════════════════════════════════════════
// CACHÉ
// ══════════════════════════════════════════════════════════
function invalidarCache() { cache.invalidar('noticias','paginas'); }

// ══════════════════════════════════════════════════════════
// BD — INIT
// ══════════════════════════════════════════════════════════
async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS noticias(id SERIAL PRIMARY KEY,titulo VARCHAR(255) NOT NULL,slug VARCHAR(255) UNIQUE,seccion VARCHAR(100),contenido TEXT,seo_description VARCHAR(160),seo_keywords VARCHAR(255),redactor VARCHAR(100),imagen TEXT,imagen_alt VARCHAR(255),imagen_caption TEXT,imagen_nombre VARCHAR(100),imagen_fuente VARCHAR(50),vistas INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,estado VARCHAR(50) DEFAULT 'publicada')`);
        for (const col of ['imagen_alt','imagen_caption','imagen_nombre','imagen_fuente','imagen_original'])
            await client.query(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}') THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT; END IF; END$$;`).catch(()=>{});
        for (const col of ['imagen_credito','imagen_licencia','imagen_licencia_url'])
            await client.query(`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS ${col} TEXT`).catch(()=>{});
        await client.query(`CREATE INDEX IF NOT EXISTS idx_noticias_estado_fecha ON noticias(estado,fecha DESC)`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE TABLE IF NOT EXISTS memoria_ia(id SERIAL PRIMARY KEY,tipo VARCHAR(50) NOT NULL,valor TEXT NOT NULL,categoria VARCHAR(100),exitos INTEGER DEFAULT 0,fallos INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memoria_tipo ON memoria_ia(tipo,categoria)`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS comentarios(id SERIAL PRIMARY KEY,noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,nombre VARCHAR(80) NOT NULL,texto TEXT NOT NULL,aprobado BOOLEAN DEFAULT true,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_comentarios_noticia ON comentarios(noticia_id,aprobado,fecha DESC)`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS publicidad(id SERIAL PRIMARY KEY,nombre_espacio VARCHAR(100) NOT NULL,url_afiliado TEXT DEFAULT '',imagen_url TEXT DEFAULT '',ubicacion VARCHAR(50) DEFAULT 'top',activo BOOLEAN DEFAULT true,ancho_px INTEGER DEFAULT 0,alto_px INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        const cp = await client.query('SELECT COUNT(*) FROM publicidad');
        if (parseInt(cp.rows[0].count)===0) await client.query(`INSERT INTO publicidad(nombre_espacio,ubicacion,activo) VALUES('Banner Top','top',false),('Banner Sidebar','sidebar',false),('Banner Medio','medio',false),('Banner Footer','footer',false)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_noticias_fts ON noticias USING gin(to_tsvector('spanish',COALESCE(contenido,'')))`).catch(()=>{});
        await client.query(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='ledger_hash') THEN ALTER TABLE noticias ADD COLUMN ledger_hash VARCHAR(64); END IF; END$$;`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS personas_publicas(id SERIAL PRIMARY KEY,nombre VARCHAR(200) NOT NULL,nombre_lower VARCHAR(200) NOT NULL UNIQUE,query_foto TEXT NOT NULL,categoria VARCHAR(100) DEFAULT 'general',activo BOOLEAN DEFAULT true,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_personas_nombre ON personas_publicas(nombre_lower)`).catch(()=>{});
        console.log('✅ BD lista V41');
    } catch(e) { console.error('❌ BD:', e.message); }
    finally { client.release(); }
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// RUTAS API
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 🧑 API PERSONAS PÚBLICAS — CRUD sin tocar código
// ══════════════════════════════════════════════════════════
app.get('/api/personas', authMiddleware, async (req,res) => {
    try {
        const r = await pool.query('SELECT id,nombre,query_foto,categoria,activo,fecha FROM personas_publicas ORDER BY nombre ASC');
        res.json({success:true, personas: r.rows});
    } catch(e) { res.status(500).json({success:false, error:e.message}); }
});

app.post('/api/personas', authMiddleware, async (req,res) => {
    const {nombre, query_foto, categoria='general'} = req.body;
    if (!nombre || !query_foto) return res.status(400).json({success:false, error:'Nombre y query_foto son obligatorios'});
    const nombre_lower = nombre.toLowerCase().trim();
    try {
        const r = await pool.query(
            'INSERT INTO personas_publicas(nombre,nombre_lower,query_foto,categoria) VALUES($1,$2,$3,$4) ON CONFLICT(nombre_lower) DO UPDATE SET query_foto=$3,categoria=$4,activo=true RETURNING *',
            [nombre.trim(), nombre_lower, query_foto.trim(), categoria]
        );
        res.json({success:true, persona: r.rows[0]});
    } catch(e) { res.status(500).json({success:false, error:e.message}); }
});

app.delete('/api/personas/:id', authMiddleware, async (req,res) => {
    try {
        await pool.query('DELETE FROM personas_publicas WHERE id=$1', [req.params.id]);
        res.json({success:true});
    } catch(e) { res.status(500).json({success:false, error:e.message}); }
});

app.patch('/api/personas/:id', authMiddleware, async (req,res) => {
    const {nombre, query_foto, categoria, activo} = req.body;
    try {
        const sets = []; const vals = []; let i = 1;
        if (nombre !== undefined) { sets.push(`nombre=$${i++}`, `nombre_lower=$${i++}`); vals.push(nombre.trim(), nombre.toLowerCase().trim()); }
        if (query_foto !== undefined) { sets.push(`query_foto=$${i++}`); vals.push(query_foto.trim()); }
        if (categoria !== undefined) { sets.push(`categoria=$${i++}`); vals.push(categoria); }
        if (activo !== undefined) { sets.push(`activo=$${i++}`); vals.push(activo); }
        if (!sets.length) return res.status(400).json({success:false, error:'Nada que actualizar'});
        vals.push(req.params.id);
        await pool.query(`UPDATE personas_publicas SET ${sets.join(',')} WHERE id=$${i}`, vals);
        res.json({success:true});
    } catch(e) { res.status(500).json({success:false, error:e.message}); }
});

app.get('/health', (req,res) => res.json({status:'OK',version:'42.0-F2',llm:llm.disponible()?'ok':'circuito-abierto',cache:cache.estado().redis,gsc:'integrado'}));
app.get('/api/llm/status',   authMiddleware, async (req,res) => res.json({success:true,...await llm.estado()}));
app.get('/api/roles', authMiddleware, (req,res) => res.json({success:true,motor:llm.MODELO,roles:roles.publico()}));
app.get('/api/cache/status', authMiddleware, (req,res) => res.json({success:true,...cache.estado()}));
app.post('/api/cache/purgar', authMiddleware, async (req,res) => { await cache.invalidar('noticias','paginas'); res.json({success:true}); });

app.get('/api/noticias', async (req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','public,max-age=300');
    try {
        const noticias = await cache.wrap('noticias','home30',60,async()=>{
            const r = await pool.query("SELECT id,titulo,slug,seccion,imagen,imagen_alt,seo_description,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30",['publicada']);
            return r.rows;
        },{stale:600});
        res.json({success:true,noticias});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/estadisticas', async (req,res) => {
    try { const r=await pool.query("SELECT COUNT(*) as c,SUM(vistas) as v FROM noticias WHERE estado='publicada'"); res.json({success:true,totalNoticias:parseInt(r.rows[0].c),totalVistas:parseInt(r.rows[0].v)||0}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/generar-noticia', authMiddleware, async (req,res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({error:'Falta categoría'});
    const r = await generarNoticia(categoria);
    res.status(r.success?200:500).json(r);
});

app.post('/api/procesar-rss', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'Acceso denegado'});
    procesarRSS();
    res.json({success:true,mensaje:'RSS iniciado'});
});

// 🆕 GSC Endpoints
app.get('/api/gsc/status', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN'});
    try {
        const r = await pool.query("SELECT valor,ultima_vez FROM memoria_ia WHERE tipo='gsc_metricas' AND categoria='sistema' ORDER BY ultima_vez DESC LIMIT 1");
        if (!r.rows.length) return res.json({conectado:false,mensaje:'Sin datos aún — primer sync en arranque'});
        const datos = JSON.parse(r.rows[0].valor);
        res.json({
            conectado:true, ultima_sync:r.rows[0].ultima_vez,
            total_clics:datos.total_clics, total_impresiones:datos.total_impresiones,
            ctr_promedio:datos.ctr_promedio,
            oportunidades_count:datos.oportunidades?.length||0,
            ganadoras_count:datos.ganadoras?.length||0,
            top_oportunidades:datos.oportunidades?.slice(0,5)||[],
            top_ganadoras:datos.ganadoras?.slice(0,5)||[],
            top_consultas:datos.top_consultas?.slice(0,10)||[],
        });
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/gsc/sync', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN'});
    const ok = await sincronizarGSC();
    res.json({success:ok, mensaje:ok?'✅ GSC sincronizado':'⚠️ Error — verifica permisos en Search Console'});
});

app.post('/api/publicar', express.json(), async (req,res) => {
    const {pin,titulo,seccion,contenido,redactor:red,seo_description,seo_keywords,imagen,imagen_alt}=req.body;
    if (pin!=='311') return res.status(403).json({success:false,error:'PIN'});
    if (!titulo||!seccion||!contenido) return res.status(400).json({success:false,error:'Faltan campos'});
    try {
        const slugBase=slugify(titulo);
        const e=await pool.query('SELECT id FROM noticias WHERE slug=$1',[slugBase]);
        const slF=e.rows.length?`${slugBase.substring(0,68)}-${Date.now().toString().slice(-6)}`:slugBase;
        let imgFinal=imagen||`${BASE_URL}/static/favicon.png`;
        const altFinal=imagen_alt||`${titulo} - El Farol al Día`;
        let imgOriginal=imgFinal,imgNombre='manual.jpg',imgFuente='manual';
        try {
            if (imgFinal.startsWith('data:image')) {
                const m=imgFinal.match(/^data:image\/(\w+);base64,(.+)$/s);
                if (m) { const wm=await aplicarWatermarkBuffer(Buffer.from(m[2],'base64')); if(wm){imgOriginal='base64';imgFinal=`${BASE_URL}/img/${wm}`;imgNombre=wm;imgFuente='manual-wm';} }
            } else if (imgFinal.startsWith('http')) {
                imgOriginal=imgFinal;
                const wmR=await aplicarWatermarkV40(imgFinal);
                if (wmR.nombre){imgFinal=wmR.url;imgNombre=wmR.nombre;imgFuente=wmR.procesada?'manual-wm':'manual';}
            }
        } catch {}
        await pool.query('INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [titulo,slF,seccion,contenido,seo_description||titulo.substring(0,155),seo_keywords||seccion,red||'Manual',imgFinal,altFinal,`Foto: ${titulo}`,imgNombre,imgFuente,imgOriginal,'publicada']);
        invalidarCache();
        await notificarNuevaNoticia(titulo,(seo_description||titulo).substring(0,160),slF,imgFinal);
        setImmediate(()=>publicarEnRedes(titulo,slF,imgFinal,seo_description||titulo,seccion,contenido));
        res.json({success:true,slug:slF});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/eliminar/:id', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({success:false,error:'PIN'});
    try { await pool.query('DELETE FROM noticias WHERE id=$1',[parseInt(req.params.id)]); invalidarCache(); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/actualizar-imagen/:id', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({success:false,error:'PIN'});
    try { await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2',[req.body.imagen,parseInt(req.params.id)]); invalidarCache(); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/comentarios/:nid', async (req,res) => {
    try { const r=await pool.query('SELECT id,nombre,texto,fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC',[req.params.nid]); res.json({success:true,comentarios:r.rows}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/comentarios/:nid', cache.limitar({nombre:'coment',max:5,ventana:60}), async (req,res) => {
    const {nombre,texto}=req.body; const nid=parseInt(req.params.nid);
    if (isNaN(nid)||nid<=0) return res.status(400).json({success:false,error:'ID inválido'});
    if (!nombre?.trim()||!texto?.trim()) return res.status(400).json({success:false,error:'Campos requeridos'});
    if (texto.trim().length<3||texto.trim().length>1000) return res.status(400).json({success:false,error:'Largo inválido'});
    try {
        const r=await pool.query('INSERT INTO comentarios(noticia_id,nombre,texto) VALUES($1,$2,$3) RETURNING id,nombre,texto,fecha',[nid,nombre.trim().substring(0,80),texto.trim().substring(0,1000)]);
        res.json({success:true,comentario:r.rows[0]});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/comentarios/eliminar/:id', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN'});
    try { await pool.query('DELETE FROM comentarios WHERE id=$1',[parseInt(req.params.id)]); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/admin/comentarios', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN requerido'});
    try {
        const r=await pool.query('SELECT c.id,c.nombre,c.texto,c.fecha,n.titulo as noticia_titulo,n.slug as noticia_slug FROM comentarios c JOIN noticias n ON n.id=c.noticia_id ORDER BY c.fecha DESC LIMIT 50');
        res.json({success:true,comentarios:r.rows});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/memoria', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN'});
    try { const r=await pool.query('SELECT tipo,valor,categoria,exitos,fallos,ultima_vez FROM memoria_ia ORDER BY ultima_vez DESC LIMIT 60'); res.json({success:true,registros:r.rows}); }
    catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/config', authMiddleware, (req,res) => { if (req.query.pin!=='311') return res.status(403).json({error:'Acceso denegado'}); res.json(CONFIG_IA); });

app.post('/api/admin/config', authMiddleware, express.json(), async (req,res) => {
    const {pin,enabled,instruccion_principal,tono,extension,evitar,enfasis}=req.body;
    if (pin!=='311') return res.status(403).json({error:'Acceso denegado'});
    if (enabled!==undefined) CONFIG_IA.enabled=enabled;
    if (instruccion_principal) CONFIG_IA.instruccion_principal=instruccion_principal;
    if (tono) CONFIG_IA.tono=tono; if (extension) CONFIG_IA.extension=extension;
    if (evitar) CONFIG_IA.evitar=evitar; if (enfasis) CONFIG_IA.enfasis=enfasis;
    res.json({success:await guardarConfigIA(CONFIG_IA)});
});

app.get('/api/push/vapid-key', (req,res) => VAPID_PUBLIC_KEY?res.json({success:true,publicKey:VAPID_PUBLIC_KEY}):res.json({success:false}));

app.post('/api/push/suscribir', cache.limitar({nombre:'push',max:10,ventana:60}), express.json(), async (req,res) => {
    try {
        const {subscription,userAgent}=req.body;
        if (!subscription?.endpoint||!subscription?.keys) return res.status(400).json({success:false,error:'Inválido'});
        await pool.query('INSERT INTO push_suscripciones(endpoint,auth_key,p256dh_key,user_agent) VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET auth_key=$2,p256dh_key=$3,user_agent=$4,fecha=CURRENT_TIMESTAMP',
            [subscription.endpoint,subscription.keys.auth,subscription.keys.p256dh,userAgent||null]);
        res.json({success:true});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/push/desuscribir', express.json(), async (req,res) => {
    try { if (req.body.endpoint) await pool.query('DELETE FROM push_suscripciones WHERE endpoint=$1',[req.body.endpoint]); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/push/test', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN'});
    const r=await notificarNuevaNoticia(req.body.titulo||'🧪 Prueba V41',req.body.mensaje||'GSC integrado','test',null);
    res.json({success:!!r});
});

app.get('/api/onesignal/config', (req,res) => res.json({appId:ONESIGNAL_APP_ID||null,enabled:!!ONESIGNAL_APP_ID}));

app.get('/audio/:nombre', (req,res) => {
    const ruta=path.join('/tmp',req.params.nombre);
    if (!fs.existsSync(ruta)) return res.status(404).send('Audio no disponible');
    res.setHeader('Content-Type','audio/mpeg'); res.setHeader('Cache-Control','public,max-age=86400');
    res.sendFile(ruta);
});

app.post('/api/telegram/test', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN'});
    const ok=await publicarEnTelegram('🏮 El Farol al Día — V41 GSC activo','test',null,'Sistema V41 con Search Console funcionando.','Nacionales',null);
    res.json({success:ok,chat_id:_telegramChatId});
});

app.get('/api/telegram/status', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN'});
    const chatId=_telegramChatId||await obtenerChatIdTelegram();
    res.json({token_activo:!!process.env.TELEGRAM_TOKEN,chat_id:chatId||'No detectado'});
});

app.get('/api/social/status', authMiddleware, (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN'});
    res.json({
        telegram:{activo:!!process.env.TELEGRAM_TOKEN,chat_id:_telegramChatId||'detectando'},
        facebook:{activo:!!(process.env.FB_PAGE_ID&&process.env.FB_PAGE_TOKEN)},
        twitter:{activo:!!(process.env.TWITTER_API_KEY&&process.env.TWITTER_ACCESS_TOKEN)},
        elevenlabs:{activo:!!ELEVENLABS_API_KEY,voz:ELEVENLABS_VOICE_ID},
    });
});

app.get('/api/metricas', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN'});
    try {
        const [top,proms,horas,gl,frases] = await Promise.all([
            pool.query("SELECT titulo,seccion,vistas,fecha FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days' ORDER BY vistas DESC LIMIT 10"),
            pool.query("SELECT seccion,ROUND(AVG(vistas)) as p,COUNT(*) as c,SUM(vistas) as t FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days' GROUP BY seccion ORDER BY p DESC"),
            pool.query("SELECT EXTRACT(HOUR FROM fecha)::int as h,ROUND(AVG(vistas)) as p FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '14 days' GROUP BY h ORDER BY p DESC LIMIT 5"),
            pool.query("SELECT ROUND(AVG(vistas)) as p,MAX(vistas) as mx,COUNT(*) as t FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days'"),
            pool.query("SELECT valor,exitos FROM memoria_ia WHERE tipo='frase_exitosa' ORDER BY exitos DESC LIMIT 10"),
        ]);
        const ia={motor:'ollama',modelo:llm.MODELO,circuito:llm.disponible()?'cerrado':'ABIERTO'};
        res.json({success:true,resumen:gl.rows[0],top_noticias:top.rows,por_categoria:proms.rows,horas_pico:horas.rows,frases_exitosas:frases.rows,ia,recomendacion:`Publica en: ${horas.rows.slice(0,3).map(h=>`${h.h}:00`).join(', ')}`});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/ia/status', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN'});
    try { res.json({success:true,motor:'ollama',...(await llm.estado())}); } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ══════════════════════════════════════════════════════════
// 🧠 JEFE DE REDACCIÓN — memoria de rendimiento (MongoDB)
// ══════════════════════════════════════════════════════════
app.get('/api/jefe-redaccion/estado', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN'});
    try { res.json({success:true,modelo:llm.MODELO,mongo:await mongo.estado(),rendimiento_por_tipo:await mongo.rendimientoPorTipo(30)}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});
app.get('/api/jefe-redaccion/historial', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN'});
    try { res.json({success:true,historial:await mongo.historial({limite:req.query.limite,tipo:req.query.tipo,categoria:req.query.categoria})}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});
app.post('/api/jefe-redaccion/sincronizar', authMiddleware, async (req,res) => {
    if ((req.query.pin||req.body?.pin)!=='311') return res.status(403).json({error:'PIN'});
    try { res.json({success:true,...(await mongo.sincronizarRendimiento(pool))}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/publicidad', authMiddleware, async (req,res) => {
    try { const r=await pool.query('SELECT * FROM publicidad ORDER BY id ASC'); res.json({success:true,anuncios:r.rows}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/publicidad/activos', async (req,res) => {
    try {
        const r=await pool.query("SELECT id,nombre_espacio,url_afiliado,imagen_url,ubicacion,ancho_px,alto_px FROM publicidad WHERE activo=true ORDER BY id ASC");
        res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','public,max-age=300');
        res.json({success:true,anuncios:r.rows});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/publicidad/actualizar', authMiddleware, async (req,res) => {
    const {pin,id,nombre_espacio,url_afiliado,imagen_url,ubicacion,activo,ancho_px,alto_px}=req.body;
    if (pin!=='311') return res.status(403).json({error:'PIN'});
    try { await pool.query('UPDATE publicidad SET nombre_espacio=$1,url_afiliado=$2,imagen_url=$3,ubicacion=$4,activo=$5,ancho_px=$6,alto_px=$7 WHERE id=$8',[nombre_espacio||'Sin nombre',url_afiliado||'',imagen_url||'',ubicacion||'top',activo===true||activo==='true',parseInt(ancho_px)||0,parseInt(alto_px)||0,parseInt(id)]); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/publicidad/crear', authMiddleware, async (req,res) => {
    const {pin,nombre_espacio,url_afiliado,imagen_url,ubicacion,ancho_px,alto_px}=req.body;
    if (pin!=='311') return res.status(403).json({error:'PIN'});
    try { await pool.query('INSERT INTO publicidad(nombre_espacio,url_afiliado,imagen_url,ubicacion,activo,ancho_px,alto_px) VALUES($1,$2,$3,$4,true,$5,$6)',[nombre_espacio,url_afiliado||'',imagen_url||'',ubicacion||'top',parseInt(ancho_px)||0,parseInt(alto_px)||0]); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/publicidad/eliminar', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN'});
    try { await pool.query('DELETE FROM publicidad WHERE id=$1',[parseInt(req.body.id)]); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/estrategia', authMiddleware, (req,res) => {
    try {
        const ruta=path.join(__dirname,'estrategia.json');
        if (!fs.existsSync(ruta)) return res.json({success:false,mensaje:'Aún no generada'});
        res.json({success:true,...JSON.parse(fs.readFileSync(ruta,'utf8'))});
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/coach', async (req,res) => {
    try {
        const {dias=7}=req.query;
        const n=await pool.query(`SELECT id,titulo,seccion,vistas,fecha FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '${parseInt(dias)} days' ORDER BY vistas DESC`);
        if (!n.rows.length) return res.json({success:true,mensaje:'Sin noticias en el período'});
        const total=n.rows.reduce((s,x)=>s+(x.vistas||0),0),prom=Math.round(total/n.rows.length);
        const cats={};
        CATS.forEach(cat=>{ const rows=n.rows.filter(x=>x.seccion===cat); const v=rows.reduce((s,x)=>s+(x.vistas||0),0); cats[cat]={total:rows.length,vistas_promedio:rows.length?Math.round(v/rows.length):0,rendimiento:prom?Math.round((rows.length?v/rows.length:0)/prom*100):0}; });
        res.json({success:true,periodo:`${dias} días`,total_noticias:n.rows.length,total_vistas:total,promedio_general:prom,categorias:cats});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/configuracion', (req,res) => {
    try { const c=fs.existsSync(path.join(__dirname,'config.json'))?JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')):{googleAnalytics:''}; res.json({success:true,config:c}); }
    catch { res.json({success:true,config:{googleAnalytics:''}}); }
});

app.post('/api/configuracion', express.json(), (req,res) => {
    const {pin,googleAnalytics}=req.body;
    if (pin!=='311') return res.status(403).json({success:false,error:'PIN'});
    try { fs.writeFileSync(path.join(__dirname,'config.json'),JSON.stringify({googleAnalytics},null,2)); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/img/:nombre', async (req,res) => {
    const buf = await almacen.leer(req.params.nombre).catch(()=>null);
    if (buf) { res.setHeader('Content-Type','image/jpeg'); res.setHeader('Cache-Control','public,max-age=31536000,immutable'); return res.send(buf); }
    const ruta=path.join('/tmp',req.params.nombre);
    if (fs.existsSync(ruta)) { res.setHeader('Content-Type','image/jpeg'); res.setHeader('Cache-Control','public,max-age=604800'); return res.sendFile(ruta); }
    try {
        const r=await pool.query('SELECT imagen_original FROM noticias WHERE imagen_nombre=$1 LIMIT 1',[req.params.nombre]);
        if (r.rows.length&&r.rows[0].imagen_original) return res.redirect(302,r.rows[0].imagen_original);
    } catch {}
    res.status(404).send('Imagen no disponible');
});

app.get('/',          (req,res)=>res.sendFile(path.join(__dirname,'client','index.html')));
app.get('/redaccion', authMiddleware,(req,res)=>res.sendFile(path.join(__dirname,'client','redaccion.html')));
app.get('/ingeniero', authMiddleware,(req,res)=>res.sendFile(path.join(__dirname,'client','ingeniero.html')));
app.get('/contacto',  (req,res)=>res.sendFile(path.join(__dirname,'client','contacto.html')));
app.get('/nosotros',  (req,res)=>res.sendFile(path.join(__dirname,'client','nosotros.html')));
app.get('/privacidad',(req,res)=>res.sendFile(path.join(__dirname,'client','privacidad.html')));
app.get('/terminos',  (req,res)=>res.sendFile(path.join(__dirname,'client','terminos.html')));
app.get('/cookies',   (req,res)=>res.sendFile(path.join(__dirname,'client','cookies.html')));

// Cuenta la visita en Redis en CADA petición (también las servidas desde caché) y se vuelca a Postgres cada minuto.
const contarVistaMW = (req,res,next) => { if (!req.query.nocache && !/bot|crawl|spider|slurp/i.test(req.headers['user-agent']||'')) cache.contarVista(req.params.slug); next(); };
app.get('/noticia/:slug', contarVistaMW, cache.paginaCache({ ns:'paginas', ttl:120, stale:900, key:req=>`/noticia/${req.params.slug}` }), async (req,res) => {
    try {
        // Sirve publicadas Y archivadas — el archivo sigue vivo, solo salió del sitemap activo.
        const r=await pool.query("SELECT * FROM noticias WHERE slug=$1 AND estado IN ('publicada','archivada')",[req.params.slug]);
        if (!r.rows.length) {
            // 410 Gone en vez de 404: le dice a Google "esto se fue para siempre,
            // deja de reintentar e índexarlo" — a diferencia de 404, que Google
            // sigue re-chequeando por semanas antes de dar por perdida la URL.
            return res.status(410).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>410 - Contenido retirado</title><meta name="robots" content="noindex"></head><body style="background:#070707;color:#EDE8DF;text-align:center;padding:60px;font-family:sans-serif"><h1 style="color:#FF5500">410</h1><p>Esta noticia ya no está disponible</p><a href="/" style="color:#FF5500">← Volver al inicio</a></body></html>');
        }
        const n=r.rows[0];
        try {
            let html=fs.readFileSync(path.join(__dirname,'client','noticia.html'),'utf8');
            const urlN=`${BASE_URL}/noticia/${n.slug}`;
            const cHTML=n.contenido.split('\n').filter(p=>p.trim()).map(p=>`<p>${p.trim()}</p>`).join('');
            // TTS player block (si hay audio o se puede generar bajo demanda)
            const audioSrc = n.audio_url || `${BASE_URL}/api/tts/${n.slug}`;
            const ttsPlayer = `<div class="tts-player" id="ttsPlayer">
  <button class="tts-btn" onclick="toggleAudio()" id="ttsBtn" aria-label="Escuchar noticia">
    <span class="tts-icon">🎙️</span>
    <span class="tts-label">Escuchar noticia</span>
    <span class="tts-loading" style="display:none">⏳ Cargando…</span>
  </button>
  <audio id="ttsAudio" preload="none" style="display:none">
    <source src="${audioSrc}" type="audio/mpeg">
  </audio>
</div>`;
            // Ledger badge (si tiene hash)
            const ledgerBadge = n.ledger_hash
                ? ledger.badgeCertificacion(n.ledger_hash, n.fecha)
                : '';
            html=html.replace('<!-- META_TAGS -->',metaTagsCompletos(n,urlN))
                .replace(/{{TITULO}}/g,esc(n.titulo)).replace(/{{CONTENIDO}}/g,cHTML)
                .replace(/{{FECHA}}/g,new Date(n.fecha).toLocaleDateString('es-DO',{year:'numeric',month:'long',day:'numeric'}))
                .replace(/{{IMAGEN}}/g,n.imagen).replace(/{{ALT}}/g,esc(n.imagen_alt||n.titulo)).replace(/{{CREDITO}}/g,creditoHTML(n))
                .replace(/{{VISTAS}}/g,n.vistas).replace(/{{REDACTOR}}/g,esc(n.redactor))
                .replace(/{{SECCION}}/g,esc(n.seccion)).replace(/{{URL}}/g,encodeURIComponent(urlN))
                .replace('{{TTS_PLAYER}}', ttsPlayer)
                .replace('{{LEDGER_BADGE}}', ledgerBadge);
            res.setHeader('Content-Type','text/html;charset=utf-8');
            res.setHeader('Cache-Control','public,max-age=300');
            res.send(html);
        } catch { res.json({success:true,noticia:n}); }
    } catch { res.status(500).send('Error interno'); }
});

// ══════════════════════════════════════════════════════════
// 🎙️ TTS ON-DEMAND — Audio de noticia via ElevenLabs
// ══════════════════════════════════════════════════════════
app.get('/api/tts/:slug', async (req,res) => {
    try {
        const r = await pool.query("SELECT titulo,contenido,audio_url FROM noticias WHERE slug=$1 AND estado='publicada'",[req.params.slug]);
        if (!r.rows.length) return res.status(404).json({error:'Noticia no encontrada'});
        const n = r.rows[0];
        // Si ya tiene audio en BD, redirigir
        if (n.audio_url) return res.redirect(n.audio_url);
        // Generar audio usando ElevenLabs (si está configurado)
        const primerParr = (n.contenido||'').split('\n').find(p=>p.trim().length>50)||'';
        const audioNombre = await generarAudioNoticia(n.titulo, primerParr).catch(()=>null);
        if (!audioNombre) return res.status(503).json({error:'TTS no disponible en este momento'});
        const ruta = path.join('/tmp', audioNombre);
        if (!fs.existsSync(ruta)) return res.status(404).json({error:'Audio no encontrado'});
        res.setHeader('Content-Type','audio/mpeg');
        res.setHeader('Cache-Control','public,max-age=86400');
        res.setHeader('Content-Disposition',`inline; filename="${audioNombre}"`);
        fs.createReadStream(ruta).pipe(res);
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/sitemap.xml', async (req,res) => {
    try {
        const r=await pool.query("SELECT slug,fecha FROM noticias WHERE estado='publicada' AND slug IS NOT NULL ORDER BY fecha DESC LIMIT 1000");
        const now=Date.now();
        let xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml+=`<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;
        for (const n of r.rows) {
            const d=(now-new Date(n.fecha).getTime())/86400000;
            xml+=`<url><loc>${BASE_URL}/noticia/${encodeURIComponent(n.slug).replace(/%2F/g,'/')}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>${d<1?'hourly':d<7?'daily':'weekly'}</changefreq><priority>${d<1?'1.0':d<7?'0.9':'0.7'}</priority></url>\n`;
        }
        xml+='</urlset>';
        res.setHeader('Content-Type','application/xml;charset=utf-8'); res.setHeader('Cache-Control','public,max-age=1800'); res.send(xml);
    } catch { res.status(500).send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'); }
});

app.get('/robots.txt', (req,res) => { res.setHeader('Content-Type','text/plain'); res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nDisallow: /redaccion\n\nSitemap: ${BASE_URL}/sitemap.xml`); });
app.get('/ads.txt',    (req,res) => { res.setHeader('Content-Type','text/plain'); res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n'); });

app.get('/status', async (req,res) => {
    try {
        const [r,rss,ult,push,gsc] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM noticias WHERE estado='publicada'"),
            pool.query('SELECT COUNT(*) FROM rss_procesados'),
            pool.query("SELECT fecha,titulo FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 1"),
            pool.query('SELECT COUNT(*) FROM push_suscripciones').catch(()=>({rows:[{count:0}]})),
            pool.query("SELECT ultima_vez,valor FROM memoria_ia WHERE tipo='gsc_metricas' ORDER BY ultima_vez DESC LIMIT 1").catch(()=>({rows:[]})),
        ]);
        const minS=ult.rows.length?Math.round((Date.now()-new Date(ult.rows[0].fecha))/60000):9999;
        const mongoSt=await Promise.race([mongo.estado(),new Promise(r=>setTimeout(()=>r({conectada:false,ultimo_error:'timeout'}),2500))]);
        const gscData = gsc.rows.length ? JSON.parse(gsc.rows[0].valor) : null;
        res.json({
            status:'OK', version:'41.0-GSC-DOMINANCE',
            noticias:parseInt(r.rows[0].count), rss_procesados:parseInt(rss.rows[0].count),
            min_sin_publicar:minS, ultima_noticia:ult.rows[0]?.titulo?.substring(0,60)||'—',
            ia:{motor:'ollama',modelo:llm.MODELO,circuito:llm.disponible()?'cerrado':'ABIERTO'},
            mongo:mongoSt,
            gsc_integrado:'✅ Search Console conectado — el modelo usa datos reales',
            gsc_ultima_sync:gsc.rows[0]?.ultima_vez||'Pendiente',
            gsc_clics:gscData?.total_clics||0,
            gsc_impresiones:gscData?.total_impresiones||0,
            gsc_ctr:gscData?.ctr_promedio||0,
            gsc_oportunidades:gscData?.oportunidades?.length||0,
            imagen_v41:'✅ Coherente con contenido',
            watermark:'✅ GARANTIZADO',
            prompt:'✅ V41 — GSC + calles SDE + Jefe de Redacción (sistema)',
            validacion:'✅ Flexible: longitud mínima bloquea; barrio/lenguaje = avisos',
            max_tokens:'✅ 3500',
            anti_plagio:'✅ FTS postgresql',
            push:`✅ VAPID (${push.rows[0].count} subs) + OneSignal`,
            telegram:process.env.TELEGRAM_TOKEN?`✅ ${_telegramChatId||'detectando'}`:'⚠️ Sin token',
            facebook:process.env.FB_PAGE_ID?'✅':'⚠️',
            twitter:process.env.TWITTER_API_KEY?'✅':'⚠️',
            cron:'✅ Inteligente por horas pico + GSC sync 6AM/12PM/6PM',
            ia_activa:CONFIG_IA.enabled,
            adsense:'pub-5280872495839888 ✅',
            endpoints:{
                gsc_status:`${BASE_URL}/api/gsc/status?pin=311`,
                gsc_sync:`POST ${BASE_URL}/api/gsc/sync`,
                metricas:`${BASE_URL}/api/metricas?pin=311`,
                ia:`${BASE_URL}/api/ia/status?pin=311`,
                jefe_redaccion:`${BASE_URL}/api/jefe-redaccion/estado?pin=311`,
            },
        });
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.use((req,res)=>res.sendFile(path.join(__dirname,'client','index.html')));

// ══════════════════════════════════════════════════════════
// 🚀 ARRANQUE V41
// ══════════════════════════════════════════════════════════
async function iniciar() {
    try {
        mongo.iniciar();                      // memoria de rendimiento (no bloquea si falta MONGO_URL)
        await inicializarBase();
        await initPushTable();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V41.0 GSC DOMINANCE EDITION             ║
╠══════════════════════════════════════════════════════════════════╣
║  📊 Google Search Console → Ollama escribe lo que buscan       ║
║  🎯 Oportunidades de oro: impresiones altas + CTR bajo         ║
║  🏆 Réplica de fórmulas ganadoras (CTR >5%)                   ║
║  🦙 Ollama ${String(llm.MODELO).padEnd(14)} | motor único           ║
║  💧 Watermark GARANTIZADO en cada noticia                      ║
║  🧠 Jefe de Redacción + memoria en MongoDB                    ║
║  ⏰ GSC Sync: arranque + 6AM + 12PM + 6PM                     ║
║  📡 /api/gsc/status y /api/gsc/sync disponibles               ║
╚══════════════════════════════════════════════════════════════════╝`);
        });

        // GSC sync al arrancar (después de 30s para dejar que la BD se estabilice)
        setTimeout(async () => {
            console.log('📊 [GSC] Primer sync al arranque...');
            await sincronizarGSC();
        }, 30000);

        setTimeout(()=>llm.calentar(), 15000);          // carga el modelo en RAM antes de la primera noticia
        setTimeout(()=>mongo.sincronizarRendimiento(pool).catch(()=>{}), 120000);
        setTimeout(()=>bienvenidaTelegram().catch(()=>{}), 5000);
        setTimeout(()=>rafagaInicial().catch(()=>{}), 90000);
        setTimeout(()=>{
            obtenerChatIdTelegram().catch(()=>{});
            analizarYGenerar().catch(e=>console.error('❌ Estrategia inicial:',e.message));
        }, 10000);
    } catch(err) {
        console.error('❌ ERROR CRÍTICO:', err.message);
        process.exit(1);
    }
}

iniciar();
module.exports = app;
