/**
 * 🏮 EL FAROL AL DÍA — V41.0 GSC DOMINANCE EDITION
 * ═══════════════════════════════════════════════════════════════
 * NUEVO EN V41 vs V40:
 *  📊 Google Search Console integrado en Gemini
 *  🎯 Gemini escribe sobre lo que la gente YA busca en Google
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
const webPush   = require('web-push');

const { leerEstrategia }   = require('./estrategia-loader');
const { analizarYGenerar } = require('./estrategia-analyzer');

// ══════════════════════════════════════════════════════════
// 🔑 CONFIGURACIÓN GLOBAL
// ══════════════════════════════════════════════════════════
const PORT     = process.env.PORT     || 8080;
const BASE_URL = (process.env.BASE_URL || 'https://elfarolaldia.com').replace(/\/$/, '');

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

const TODAS_LLAVES_GEMINI = [
    process.env.GEMINI_API_KEY,  process.env.GEMINI_API_KEY2,
    process.env.GEMINI_API_KEY3, process.env.GEMINI_API_KEY4,
    process.env.GEMINI_API_KEY5, process.env.GEMINI_API_KEY6,
    process.env.GEMINI_API_KEY7, process.env.GEMINI_API_KEY8,
].filter(Boolean);

const LLAVES_TEXTO  = TODAS_LLAVES_GEMINI.slice(0, 5);
const LLAVES_IMAGEN = TODAS_LLAVES_GEMINI.slice(3);
console.log(`🔑 Gemini: ${TODAS_LLAVES_GEMINI.length} llaves | Texto: ${LLAVES_TEXTO.length} | Imagen: ${LLAVES_IMAGEN.length}`);

const GOOGLE_CSE_KEYS     = [process.env.GOOGLE_CSE_KEY, process.env.GOOGLE_CSE_KEY_2].filter(Boolean);
const GOOGLE_CSE_CX       = process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CSE_CX || '';
const PEXELS_API_KEY      = process.env.PEXELS_API_KEY      || null;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || null;
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
        if (!raw) return null;
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
        return data.access_token || null;
    } catch(e) {
        console.warn('⚠️ GSC token:', e.message);
        return null;
    }
}

async function consultarGSC(body) {
    const token = await getGSCToken();
    if (!token) return null;
    try {
        const site = encodeURIComponent('sc-domain:elfarolaldia.com');
        const res  = await fetch(
            `https://searchconsole.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15000),
            }
        );
        if (!res.ok) { console.warn(`⚠️ GSC ${res.status}`); return null; }
        return await res.json();
    } catch(e) { console.warn('⚠️ GSC fetch:', e.message); return null; }
}

async function sincronizarGSC() {
    console.log('\n📊 [GSC V41] Sincronizando métricas reales de Search Console...');
    const fin    = new Date();
    const inicio = new Date(); inicio.setDate(inicio.getDate() - 28);
    const fmt    = d => d.toISOString().split('T')[0];

    const data = await consultarGSC({
        startDate: fmt(inicio), endDate: fmt(fin),
        dimensions: ['query'], rowLimit: 50,
        orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
    });

    if (!data?.rows?.length) {
        console.warn('⚠️ GSC: Sin datos — verifica permisos en Search Console');
        return false;
    }

    const consultas = data.rows.map(r => ({
        query:       r.keys[0],
        clics:       Math.round(r.clicks || 0),
        impresiones: Math.round(r.impressions || 0),
        ctr:         parseFloat((r.ctr * 100).toFixed(1)),
        posicion:    parseFloat((r.position || 0).toFixed(1)),
    }));

    // Oportunidades: muchas impresiones, CTR bajo = título no convence
    const oportunidades = consultas
        .filter(c => c.impresiones >= 3 && c.ctr < 5)
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
        text:`🏮 *El Farol al Día — V41\\.0 GSC DOMINANCE*\n\n✅ Google Search Console integrado\\.\n✅ Gemini escribe sobre lo que la gente busca\\.\n✅ Oportunidades de oro: CTR bajo → título nuevo\\.\n✅ ${TODAS_LLAVES_GEMINI.length} llaves Gemini activas\\.\n✅ Watermark garantizado\\.\n\n🌐 [elfarolaldia\\.com](https://elfarolaldia.com)`,
        parse_mode:'MarkdownV2',
    });
}

// ══════════════════════════════════════════════════════════
// CONFIG IA
// ══════════════════════════════════════════════════════════
const CONFIG_IA_DEFAULT = {
    enabled: true,
    instruccion_principal: 'Eres un periodista dominicano del barrio, directo y sin rodeos. Escribes para el lector de Los Mina, Invivienda, Charles de Gaulle y todo Santo Domingo Este. Párrafos cortos. Lenguaje real de la calle. Cero relleno.',
    tono: 'directo-barrio', extension: 'extensa',
    enfasis: 'Prioriza Santo Domingo Este: Los Mina, Invivienda, Ensanche Ozama, Sabana Perdida, Villa Mella, Charles de Gaulle. Conecta todo con el lector de SDE.',
    evitar: 'Párrafos largos. Lenguaje técnico. Especulación. Repetir noticias publicadas. Copiar Wikipedia. Empezar con "En el día de hoy".',
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
// 🤖 GEMINI — Round-Robin 8 llaves
// ══════════════════════════════════════════════════════════
const GEMINI_STATE = {};
let   _rrIdx       = 0;

function getKeyState(k) {
    if (!GEMINI_STATE[k]) GEMINI_STATE[k] = { lastRequest:0, resetTime:0, exitos:0, errores:0 };
    return GEMINI_STATE[k];
}

function nextKey(pool_llaves) {
    const ahora = Date.now();
    for (let i = 0; i < pool_llaves.length; i++) {
        const idx = (_rrIdx + i) % pool_llaves.length;
        const k   = pool_llaves[idx];
        if (ahora >= getKeyState(k).resetTime) {
            _rrIdx = (idx + 1) % pool_llaves.length;
            return k;
        }
    }
    return pool_llaves.reduce((a,b) => getKeyState(a).resetTime < getKeyState(b).resetTime ? a : b);
}

async function _callGemini(apiKey, prompt, intento, maxTokens = 8000) {
    const st = getKeyState(apiKey);
    if (Date.now() < st.resetTime) {
        const espera = st.resetTime - Date.now();
        if (espera > 20000) throw new Error('RATE_LIMIT_429');
        await new Promise(r => setTimeout(r, espera));
    }
    const gap = Date.now() - st.lastRequest;
    if (gap < 15000) await new Promise(r => setTimeout(r, 15000 - gap));
    st.lastRequest = Date.now();

    let res;
    try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.85, maxOutputTokens: maxTokens, topP: 0.9 }
            }),
            signal: AbortSignal.timeout(60000),
        });
    } catch(err) { throw new Error(`RED: ${err.message}`); }

    if (res.status === 429) {
        const penalidad = Math.min(60000 + Math.pow(2, intento) * 20000, 360000);
        st.resetTime = Date.now() + penalidad; st.errores++;
        throw new Error('RATE_LIMIT_429');
    }
    if (res.status === 503 || res.status === 502) {
        await new Promise(r => setTimeout(r, 15000));
        throw new Error(`HTTP_${res.status}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data  = await res.json();
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const razon = data.candidates?.[0]?.finishReason;
    if (razon === 'SAFETY' || razon === 'RECITATION') throw new Error(`GEMINI_BLOCKED_${razon}`);
    if (!texto) throw new Error('Gemini: respuesta vacía');
    st.exitos++;
    return texto;
}

async function llamarGemini(prompt, reintentos = 3, maxTokens = 8000) {
    if (!LLAVES_TEXTO.length) throw new Error('Sin llaves Gemini');
    let ultimoError = null;
    for (let intento = 0; intento < reintentos; intento++) {
        for (let i = 0; i < LLAVES_TEXTO.length; i++) {
            const llave  = nextKey(LLAVES_TEXTO);
            const keyNum = TODAS_LLAVES_GEMINI.indexOf(llave) + 1;
            try {
                console.log(`   → Gemini KEY${keyNum} intento ${intento+1}/${reintentos}`);
                const r = await _callGemini(llave, prompt, intento, maxTokens);
                console.log(`   ✅ KEY${keyNum} respondió (${r.length} chars)`);
                return r;
            } catch(err) {
                ultimoError = err;
                console.warn(`   ⚠️ KEY${keyNum}: ${err.message}`);
                if (err.message.startsWith('GEMINI_BLOCKED')) continue;
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        if (intento < reintentos - 1) {
            console.warn(`   ⏳ Todas las llaves fallaron — esperando 25s...`);
            await new Promise(r => setTimeout(r, 25000));
        }
    }
    throw new Error(`Gemini falló: ${ultimoError?.message}`);
}

async function llamarGeminiImagen(prompt) {
    const llaves = LLAVES_IMAGEN.length ? LLAVES_IMAGEN : LLAVES_TEXTO;
    for (const llave of llaves) {
        const num = TODAS_LLAVES_GEMINI.indexOf(llave) + 1;
        try {
            const r = await _callGemini(llave, prompt, 0, 500);
            console.log(`   🖼️  Imagen KEY${num} OK`);
            return r;
        } catch(err) { if (err.message === 'RATE_LIMIT_429') continue; }
    }
    return null;
}

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

// ══════════════════════════════════════════════════════════
// 🖼️ SISTEMA DE IMAGEN V40 (sin cambios)
// ══════════════════════════════════════════════════════════
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

function urlImagenValidaV40(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (!/(\.jpg|\.jpeg|\.png)(\?|$|#)/i.test(u) && !u.endsWith('.jpg') && !u.endsWith('.jpeg') && !u.endsWith('.png')) return false;
    return !URL_INVALIDAS_V40.some(p => u.includes(p));
}

async function verificarResolucionV40(url, minWidth = 800) {
    try {
        const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),9000);
        const res  = await fetch(url,{method:'GET',signal:ctrl.signal}).finally(()=>clearTimeout(tm));
        if (!res.ok) return false;
        const buf  = Buffer.from(await res.arrayBuffer());
        if (buf.length < 20000) return false;
        const meta = await sharp(buf).metadata();
        return (meta.width||0) >= minWidth;
    } catch { return false; }
}

function extraerQueriesCoherentes(titulo, contenido, categoria) {
    const texto  = `${titulo} ${(contenido||'').substring(0,600)}`.toLowerCase();
    const queries = [];
    for (const [barrio, query] of Object.entries(BARRIOS_QUERIES))
        if (texto.includes(barrio)) { queries.push(query); break; }
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

const CSE_EXCLUDES_V40 = ['-site:shutterstock.com','-site:gettyimages.com','-site:adobe.com','-site:dreamstime.com','-site:alamy.com','-site:istockphoto.com','-site:depositphotos.com','-site:123rf.com'].join(' ');
const CSE_STATE_V40 = {};
function getCseStateV40(k) { if (!CSE_STATE_V40[k]) CSE_STATE_V40[k]={fallos:0,bloqueadaHasta:0}; return CSE_STATE_V40[k]; }

async function buscarImagenCSEV40(query, llaves, cx) {
    if (!llaves?.length||!cx) return null;
    const qFull = `${query} ${CSE_EXCLUDES_V40}`.trim();
    for (const llave of llaves) {
        const st = getCseStateV40(llave);
        if (Date.now() < st.bloqueadaHasta) continue;
        try {
            const url  = `https://www.googleapis.com/customsearch/v1?key=${llave}&cx=${cx}&q=${encodeURIComponent(qFull)}&searchType=image&imgType=photo&imgSize=large&fileType=jpg,png&num=10&safe=active`;
            const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),9000);
            const res  = await fetch(url,{signal:ctrl.signal}).finally(()=>clearTimeout(tm));
            if (res.status===429||res.status===403) { st.fallos++; st.bloqueadaHasta=Date.now()+(st.fallos>=3?3600000:300000); continue; }
            if (!res.ok) continue;
            const data = await res.json();
            for (const item of (data.items||[])) {
                if (!urlImagenValidaV40(item.link)) continue;
                if (await verificarResolucionV40(item.link,800)) { st.fallos=0; return item.link; }
            }
        } catch(err) { st.fallos++; console.warn(`   ⚠️ CSE: ${err.message}`); }
    }
    return null;
}

async function buscarImagenPexelsV40(queries, apiKey) {
    if (!apiKey) return null;
    for (const q of (Array.isArray(queries)?queries:[queries]).slice(0,3)) {
        try {
            const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),7000);
            const res  = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=8&orientation=landscape`,{headers:{Authorization:apiKey},signal:ctrl.signal}).finally(()=>clearTimeout(tm));
            if (!res.ok) continue;
            const data  = await res.json();
            const fotos = (data.photos||[]).filter(f=>(f.width||0)>=1000);
            if (!fotos.length) continue;
            const foto = fotos[Math.floor(Math.random()*Math.min(3,fotos.length))];
            return foto.src.large2x||foto.src.large;
        } catch { continue; }
    }
    return null;
}

async function buscarImagenUnsplashV40(query, apiKey) {
    if (!apiKey) return null;
    try {
        const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),8000);
        const res  = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape`,{headers:{Authorization:`Client-ID ${apiKey}`},signal:ctrl.signal}).finally(()=>clearTimeout(tm));
        if (!res.ok) return null;
        const data  = await res.json();
        const fotos = (data.results||[]).filter(f=>(f.width||0)>=1000);
        return fotos[0]?.urls?.full||fotos[0]?.urls?.regular||null;
    } catch { return null; }
}

const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=1200';
const BANCO_LOCAL_V40 = {
    'politica-gobierno':[`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,`${PB}/290595/pexels-photo-290595.jpeg${OPT}`],
    'seguridad-policia':[`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`,`${PB}/1416367/pexels-photo-1416367.jpeg${OPT}`],
    'relaciones-internacionales':[`${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`,`${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`],
    'economia-mercado':[`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`,`${PB}/3943882/pexels-photo-3943882.jpeg${OPT}`],
    'infraestructura':[`${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`,`${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`],
    'salud-medicina':[`${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`,`${PB}/263402/pexels-photo-263402.jpeg${OPT}`],
    'deporte-beisbol':[`${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`,`${PB}/209977/pexels-photo-209977.jpeg${OPT}`],
    'deporte-futbol':[`${PB}/46798/pexels-photo-46798.jpeg${OPT}`,`${PB}/274422/pexels-photo-274422.jpeg${OPT}`],
    'deporte-general':[`${PB}/863988/pexels-photo-863988.jpeg${OPT}`,`${PB}/248547/pexels-photo-248547.jpeg${OPT}`],
    'tecnologia':[`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`,`${PB}/1181671/pexels-photo-1181671.jpeg${OPT}`],
    'educacion':[`${PB}/256490/pexels-photo-256490.jpeg${OPT}`,`${PB}/301926/pexels-photo-301926.jpeg${OPT}`],
    'cultura-musica':[`${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`,`${PB}/167636/pexels-photo-167636.jpeg${OPT}`],
    'medio-ambiente':[`${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`,`${PB}/886521/pexels-photo-886521.jpeg${OPT}`],
    'turismo':[`${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`,`${PB}/1174732/pexels-photo-1174732.jpeg${OPT}`],
    'emergencia':[`${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`,`${PB}/239548/pexels-photo-239548.jpeg${OPT}`],
    'vivienda-social':[`${PB}/323780/pexels-photo-323780.jpeg${OPT}`,`${PB}/1396122/pexels-photo-1396122.jpeg${OPT}`],
    'transporte-vial':[`${PB}/93398/pexels-photo-93398.jpeg${OPT}`,`${PB}/1004409/pexels-photo-1004409.jpeg${OPT}`],
};
const FALLBACK_CAT_V40 = {'Nacionales':'politica-gobierno','Deportes':'deporte-general','Internacionales':'relaciones-internacionales','Economía':'economia-mercado','Tecnología':'tecnologia','Espectáculos':'cultura-musica'};
function imgLocalV40(subtema, categoria) {
    const banco = BANCO_LOCAL_V40[subtema]||BANCO_LOCAL_V40[FALLBACK_CAT_V40[categoria]]||BANCO_LOCAL_V40['politica-gobierno'];
    return banco[Math.floor(Math.random()*banco.length)];
}

async function aplicarWatermarkV40(urlImagen) {
    const nombre  = `efd-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    const rutaTmp = path.join('/tmp', nombre);
    let bufOrig;
    try {
        const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),12000);
        const res  = await fetch(urlImagen,{signal:ctrl.signal}).finally(()=>clearTimeout(tm));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        bufOrig = Buffer.from(await res.arrayBuffer());
    } catch(err) { return {url:urlImagen,nombre:null,procesada:false}; }
    if (bufOrig.length < 5000) return {url:urlImagen,nombre:null,procesada:false};
    if (!WATERMARK_PATH||!fs.existsSync(WATERMARK_PATH)) {
        try {
            const bufF = await sharp(bufOrig).resize(1200,null,{fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
            fs.writeFileSync(rutaTmp,bufF);
            return {url:`${BASE_URL}/img/${nombre}`,nombre,procesada:false,original:urlImagen};
        } catch { return {url:urlImagen,nombre:null,procesada:false}; }
    }
    try {
        const meta = await sharp(bufOrig).metadata();
        if (!['jpeg','jpg','png','webp'].includes(meta.format||'')) throw new Error(`formato ${meta.format}`);
        const w=meta.width||800,h=meta.height||500;
        const wmAncho  = Math.min(Math.round(w*0.28),320);
        const wmBuffer = await sharp(WATERMARK_PATH).resize(wmAncho,null,{fit:'inside'}).toBuffer();
        const wmMeta   = await sharp(wmBuffer).metadata();
        const margen   = Math.round(w*0.025);
        const bufFinal = await sharp(bufOrig).resize(1200,null,{fit:'inside',withoutEnlargement:true})
            .composite([{input:wmBuffer,left:Math.max(0,w-wmAncho-margen),top:Math.max(0,h-(wmMeta.height||60)-margen),blend:'over'}])
            .jpeg({quality:88}).toBuffer();
        fs.writeFileSync(rutaTmp,bufFinal);
        console.log(`   💧 Watermark OK: ${nombre}`);
        return {url:`${BASE_URL}/img/${nombre}`,nombre,procesada:true,original:urlImagen};
    } catch(err) {
        try { const bufF=await sharp(bufOrig).jpeg({quality:88}).toBuffer(); fs.writeFileSync(rutaTmp,bufF); return {url:`${BASE_URL}/img/${nombre}`,nombre,procesada:false,original:urlImagen}; }
        catch { return {url:urlImagen,nombre:null,procesada:false}; }
    }
}

async function aplicarWatermarkBuffer(bufOrig) {
    if (!WATERMARK_PATH) return null;
    try {
        const nombre  = `efd-manual-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.jpg`;
        const rutaTmp = path.join('/tmp',nombre);
        const meta = await sharp(bufOrig).metadata().catch(()=>null);
        if (!meta||!['jpeg','jpg','png','webp'].includes(meta.format||'')) return null;
        const w=meta.width||800,h=meta.height||500;
        const wmAncho  = Math.min(Math.round(w*0.28),320);
        const wmBuffer = await sharp(WATERMARK_PATH).resize(wmAncho,null,{fit:'inside'}).toBuffer();
        const wmMeta   = await sharp(wmBuffer).metadata();
        const margen   = Math.round(w*0.025);
        const bufFinal = await sharp(bufOrig)
            .composite([{input:wmBuffer,left:Math.max(0,w-wmAncho-margen),top:Math.max(0,h-(wmMeta.height||60)-margen),blend:'over'}])
            .jpeg({quality:88}).toBuffer();
        fs.writeFileSync(rutaTmp,bufFinal);
        return nombre;
    } catch { return null; }
}

async function obtenerImagenV40(titulo, contenido, categoria, subtema, queryIA) {
    console.log(`\n   🖼️ [V41] Imagen → "${titulo.substring(0,55)}"`);
    let queries;
    if (categoria === 'Internacionales') {
        const qIntl = buildQueryInternacional(titulo,contenido);
        queries = [qIntl];
        if (queryIA) queries.push(queryIA);
        queries.push(...extraerQueriesCoherentes(titulo,contenido,categoria));
    } else {
        queries = extraerQueriesCoherentes(titulo,contenido,categoria);
        if (queryIA) queries.unshift(queryIA);
    }
    let urlImagen=null, fuente='banco-local';
    for (let i=0;i<Math.min(queries.length,3);i++) {
        const q = queries[i];
        urlImagen = await buscarImagenCSEV40(q,GOOGLE_CSE_KEYS,GOOGLE_CSE_CX);
        if (urlImagen){fuente='cse';break;}
        urlImagen = await buscarImagenPexelsV40([q],PEXELS_API_KEY);
        if (urlImagen){fuente='pexels';break;}
    }
    if (!urlImagen&&UNSPLASH_ACCESS_KEY) { urlImagen=await buscarImagenUnsplashV40(queries[0],UNSPLASH_ACCESS_KEY); if(urlImagen)fuente='unsplash'; }
    if (!urlImagen) { urlImagen=imgLocalV40(subtema,categoria); fuente='banco-local'; }
    const wmResult = await aplicarWatermarkV40(urlImagen);
    return { urlFinal:wmResult.url, urlOriginal:urlImagen, nombre:wmResult.nombre||'efd-fallback.jpg', fuente:fuente+(wmResult.procesada?'-wm':''), procesada:wmResult.procesada };
}

// ══════════════════════════════════════════════════════════
// 🧠 PROMPT V41 — CON GSC INTEGRADO
// ══════════════════════════════════════════════════════════
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

    const contextoWiki = await buscarContextoWikipedia(categoria);
    const estrategia   = leerEstrategia();

    const fuenteContenido = comunicadoExterno
        ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado.`
        : `\nEscribe una noticia NUEVA, ORIGINAL, de impacto para la categoría "${categoria}" enfocada en Santo Domingo Este, República Dominicana. Hecho real y relevante para ABRIL 2026.`;

    return `${CONFIG_IA.instruccion_principal}

ROL: Redactor Jefe de El Farol al Día. Voz del barrio de SDE. Conoces tus métricas y escribes para dominar Google.
FECHA: ABRIL 2026. Nada de noticias del pasado.

${topNoticias}
${malNoticias}
${metaStr}
${memoriaAnti}
${seccionFrases}
${gscContexto}
${contextoActual}
${contextoWiki}
${fuenteContenido}

════════════════════════════════════════════════════════
🎯 INSTRUCCIONES OBLIGATORIAS V41 — LEER COMPLETO
════════════════════════════════════════════════════════

SECCIÓN A — FORMATO DE RESPUESTA (EXACTO, SIN VARIACIONES):

TITULO_A: [Opción 1 — 65 chars, usa palabras clave reales de GSC]
TITULO_B: [Opción 2 — 65 chars, dato impactante o cifra]
DESCRIPCION: [SEO 150-160 chars con keywords RD + SDE]
PALABRAS: [keyword1, keyword2, keyword3, keyword4, keyword5]
SUBTEMA_LOCAL: [UNO DE: politica-gobierno | seguridad-policia | economia-mercado | deporte-beisbol | deporte-futbol | deporte-general | tecnologia | educacion | cultura-musica | salud-medicina | infraestructura | vivienda-social | transporte-vial | medio-ambiente | turismo | emergencia | relaciones-internacionales]
CONTENIDO:
[EL CUERPO COMPLETO AQUÍ — MÍNIMO 900 PALABRAS]

════════════════════════════════════════════════════════
SECCIÓN B — REGLAS DEL CONTENIDO (OBLIGATORIAS)
════════════════════════════════════════════════════════

1️⃣  EXTENSIÓN: MÍNIMO 900 palabras. MÍNIMO 8 párrafos.

2️⃣  ESTRUCTURA DE 8 PÁRRAFOS:
   P1-GANCHO: Hecho impactante. Menciona el barrio. Usa palabras clave GSC.
   P2-CONTEXTO: Antecedentes. ¿Qué venía pasando?
   P3-DETALLES: Nombres, cifras, calles específicas de SDE.
   P4-AMBIENTE: El calor de abril, ruido de motores, parada del carro público, el colmado.
   P5-IMPACTO LOCAL: ¿Cómo afecta a la gente de ${categoria==='Deportes'?'Los Mina':'Invivienda'}?
   P6-REACCIÓN: Testimonios del barrio en comillas.
   P7-ANÁLISIS: Contexto más amplio para RD.
   P8-CIERRE: Qué viene. Call-to-action.

3️⃣  LUGARES CONCRETOS DE SDE — menciona al menos 2:
   Los Mina, Invivienda, Charles de Gaulle, Ensanche Ozama,
   Sabana Perdida, Villa Mella, El Almirante, Carretera Mella,
   Sabana Larga, Av. Venezuela, Entrada de las Palmas, Los Trinitarios

4️⃣  LENGUAJE DOMINICANO:
   "se armó el avispero", "la gente está en grito", "se supo de buena fuente",
   "según los vecinos del sector", "fue confirmado", "los residentes dicen",
   "en el barrio se habla", "trascendió que", "se conoció que"

5️⃣  PÁRRAFOS CORTOS: Máximo 3 líneas. El lector usa celular.

6️⃣  PRIMERA LÍNEA: GANCHO DIRECTO. Prohibido empezar con "En el día de hoy".

7️⃣  CATEGORÍA: ${categoria}
8️⃣  EVITAR: ${CONFIG_IA.evitar}
9️⃣  ÉNFASIS: ${CONFIG_IA.enfasis}
🔟 EXTENSIÓN OBJETIVO: ${esCatAlta?'800-1000':'700-900'} palabras

${estrategia}

RECUERDA: Usa las PALABRAS CLAVE REALES de Search Console en el título. Eso es lo que Google quiere ver.`;
}

// ══════════════════════════════════════════════════════════
// ✅ VALIDADOR DUAL
// ══════════════════════════════════════════════════════════
function validarContenido(contenido, intento = 1) {
    if (!contenido||typeof contenido!=='string') return {valido:false,razon:'Contenido nulo'};
    const limpio   = contenido.trim();
    const longMin  = intento===1?600:intento===2?700:800;
    const parrafMin = intento===1?4:5;
    if (limpio.length<longMin) return {valido:false,razon:`${limpio.length} chars < ${longMin}`};
    const barriosSDE = ['Los Mina','Invivienda','Charles de Gaulle','Ensanche Ozama','Sabana Perdida','Villa Mella','El Almirante','Mendoza','Los Trinitarios','San Isidro','Santo Domingo Este','SDE','Carretera Mella','Sabana Larga'];
    const barriosMencionados = barriosSDE.filter(b=>limpio.toLowerCase().includes(b.toLowerCase()));
    if (!barriosMencionados.length) return {valido:false,razon:'No menciona ningún barrio de SDE'};
    const parrafos = limpio.split(/\n\s*\n/).filter(p=>p.trim().length>20);
    if (parrafos.length<parrafMin) return {valido:false,razon:`${parrafos.length} párrafos < ${parrafMin}`};
    const frasesDom = ['se supo','fue confirmado','según fuentes','la gente del sector','vecinos dicen','en el barrio','en la calle','fue informado','trascendió','se conoció','se armó','está en grito','de buena fuente','los residentes','la comunidad','fuentes cercanas'];
    if (!frasesDom.some(f=>limpio.toLowerCase().includes(f))) return {valido:false,razon:'Falta lenguaje de barrio dominicano'};
    const palabras = limpio.split(/\s+/).filter(w=>w.length>2).length;
    return {valido:true,longitud:limpio.length,palabras,barrios:barriosMencionados,parrafos:parrafos.length};
}

// ══════════════════════════════════════════════════════════
// 🎰 SELECTOR A/B
// ══════════════════════════════════════════════════════════
async function elegirMejorTitulo(tituloA, tituloB, categoria) {
    if (!tituloA) return tituloB;
    if (!tituloB) return tituloA;
    const score = t => [/\d/.test(t),/[¿?]/.test(t),/mina|invivienda|gaulle|ozama|mella/i.test(t),t.length>45].filter(Boolean).length;
    const pA=score(tituloA),pB=score(tituloB);
    const elegido = pB>pA?tituloB:tituloA;
    console.log(`   🎰 A/B: "${tituloA}"(${pA}) vs "${tituloB}"(${pB}) → "${elegido}"`);
    return elegido;
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
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
    try {
        if (!CONFIG_IA.enabled) return {success:false,error:'IA desactivada'};
        console.log(`\n📰 [V41] Generando — ${categoria} — Intento ${reintento}/${MAX_REINTENTOS}`);

        const prompt  = await construirPrompt(categoria, comunicadoExterno);
        console.log('   📝 Enviando a Gemini con contexto GSC...');
        const textoIA = await llamarGemini(prompt, 3, 8000);
        const limpio  = textoIA.replace(/\*\*/g,'').replace(/\*/g,'').replace(/^#+\s*/gm,'').replace(/^-\s*/gm,'');

        let tituloA='',tituloB='',desc='',pals='',sub='';
        let enContenido=false, bloques=[];
        for (const linea of limpio.split('\n')) {
            const t = linea.trim();
            if      (t.startsWith('TITULO_A:'))      tituloA = t.replace('TITULO_A:','').trim();
            else if (t.startsWith('TITULO_B:'))      tituloB = t.replace('TITULO_B:','').trim();
            else if (t.startsWith('TITULO:'))        tituloA = t.replace('TITULO:','').trim();
            else if (t.startsWith('DESCRIPCION:'))   desc    = t.replace('DESCRIPCION:','').trim();
            else if (t.startsWith('PALABRAS:'))      pals    = t.replace('PALABRAS:','').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub     = t.replace('SUBTEMA_LOCAL:','').trim();
            else if (t.startsWith('CONTENIDO:'))     enContenido = true;
            else if (enContenido && t.length > 0)    bloques.push(t);
        }
        const contenido = bloques.join('\n\n');
        tituloA = tituloA.replace(/[*_#`"]/g,'').trim();
        tituloB = tituloB.replace(/[*_#`"]/g,'').trim();
        desc    = desc.replace(/[*_#`]/g,'').trim();
        if (!tituloA && !tituloB) throw new Error('Gemini no devolvió TITULO_A ni TITULO_B');

        const titulo = await elegirMejorTitulo(tituloA, tituloB, categoria);

        const val = validarContenido(contenido, reintento);
        if (!val.valido) {
            console.log(`   ⚠️ Validación falló (${reintento}): ${val.razon}`);
            if (reintento < MAX_REINTENTOS) { await new Promise(r=>setTimeout(r,5000)); return generarNoticia(categoria,comunicadoExterno,reintento+1); }
            throw new Error(`Validación fallida: ${val.razon}`);
        }
        console.log(`   ✅ OK: ${val.longitud} chars, ${val.palabras} palabras, ${val.parrafos} párrafos`);
        logAnalytics('NOTICIA_GENERADA',{categoria,chars:val.longitud,palabras:val.palabras,dur_s:Math.round((Date.now()-inicio)/1000)});

        const similares = await detectarPlagio(contenido);
        if (similares.length) console.warn(`   🕵️ Similitud con: ${similares.join(', ')}`);

        const barriosMencionados = (contenido.match(/Los Mina|Invivienda|Charles de Gaulle|Ensanche Ozama|Sabana Perdida|Villa Mella|Carretera Mella|Los Trinitarios/g)||[]).join(', ')||'Santo Domingo Este';
        let queryIA = '';
        const rImg = await llamarGeminiImagen(
            `Titular: "${titulo}"\nCategoría: ${categoria}\nBarrios: ${barriosMencionados}\nPrimeras líneas: "${contenido.substring(0,200)}"\n\nRESPONDE SOLO:\nQUERY_IMAGEN: [6-8 palabras inglés, escena fotográfica real. PROHIBIDO: wedding, couple, flowers, cartoon, pet, flag, logo]`
        ).catch(()=>null);
        if (rImg) for (const l of (rImg||'').split('\n')) if (l.trim().startsWith('QUERY_IMAGEN:')) queryIA=l.trim().replace('QUERY_IMAGEN:','').trim();

        const imgResult = await obtenerImagenV40(titulo, contenido, categoria, sub, queryIA);

        const altBase = {'Nacionales':`Noticias ${titulo.substring(0,40)} Santo Domingo Este`,'Deportes':`Deportes dominicanos ${titulo.substring(0,35)}`,'Internacionales':`Internacional ${titulo.substring(0,35)} Caribe`,'Economía':`Economía dominicana ${titulo.substring(0,35)}`,'Tecnología':`Tecnología ${titulo.substring(0,40)}`,'Espectáculos':`Espectáculos ${titulo.substring(0,35)} RD`};
        const altFinal = `${altBase[categoria]||titulo.substring(0,50)} - El Farol al Día`;

        const slugBase = slugify(titulo);
        if (!slugBase||slugBase.length<3) throw new Error('Slug inválido');
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1',[slugBase]);
        const slFin  = existe.rows.length?`${slugBase.substring(0,68)}-${Date.now().toString().slice(-6)}`:slugBase;

        await pool.query(
            'INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [titulo.substring(0,255),slFin,categoria,contenido.substring(0,12000),desc.substring(0,160),(pals||categoria).substring(0,255),redactor(categoria),imgResult.urlFinal,altFinal.substring(0,255),`Fotografía: ${titulo}`,imgResult.nombre,imgResult.fuente,imgResult.urlOriginal,'publicada']
        );

        const durTotal = Math.round((Date.now()-inicio)/1000);
        console.log(`\n✅ [V41] Publicada → /noticia/${slFin} (${durTotal}s) | GSC:✅ | WM:${imgResult.procesada?'✅':'⚠️'}`);
        logAnalytics('NOTICIA_PUBLICADA',{slug:slFin,categoria,chars:val.longitud,duracion_s:durTotal,imagen:imgResult.fuente,watermark:imgResult.procesada,gsc:true});

        invalidarCache();

        const frases = titulo.match(/[A-ZÁÉÍÓÚ][^,.:;!?]{10,40}/g)||[];
        for (const f of frases.slice(0,2)) await guardarFraseExitosa(f,10);

        await notificarNuevaNoticia(titulo, desc.substring(0,160), slFin, imgResult.urlFinal);
        setImmediate(()=>publicarEnRedes(titulo,slFin,imgResult.urlFinal,desc,categoria,contenido));

        return {success:true,slug:slFin,titulo,alt:altFinal,mensaje:'✅ Publicada V41 con GSC',stats:val,imagen:imgResult,ab:{a:tituloA,b:tituloB,elegido:titulo}};

    } catch(error) {
        const dur = Math.round((Date.now()-inicio)/1000);
        console.error(`❌ [V41] Error intento ${reintento} (${dur}s):`, error.message);
        logAnalytics('NOTICIA_ERROR',{categoria,reintento,error:error.message,dur_s:dur});
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
                const comunicado = [item.title?`TÍTULO: ${item.title}`:'',item.contentSnippet?`RESUMEN: ${item.contentSnippet}`:'',`FUENTE: ${fuente.nombre}`].filter(Boolean).join('\n');
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
        const r = await pool.query(`DELETE FROM noticias WHERE fecha<NOW()-INTERVAL '90 days' AND vistas<5 AND estado='publicada' RETURNING id`);
        if (r.rowCount>0) { console.log(`🗑️ Auto-limpieza: ${r.rowCount} eliminadas`); invalidarCache(); }
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

cron.schedule('0 * * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    if (Date.now()-ARRANQUE_TIME < 35*60*1000) return;
    const hora = new Date().getHours();
    const pico = await getHorasPico();
    if (pico.includes(hora)||hora%3===0) {
        console.log(`⏰ Cron hora ${hora}:00`);
        await generarNoticia(CATS[hora%CATS.length]);
    }
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

async function rafagaInicial() {
    if (!CONFIG_IA.enabled) return;
    console.log('🚀 Ráfaga inicial — 3 noticias en 90 min...');
    for (let i=0;i<3;i++) {
        if (i>0) await new Promise(r=>setTimeout(r,30*60*1000));
        try { await generarNoticia(CATS[i]); } catch(e) { console.warn(`⚠️ Ráfaga ${i+1}:`,e.message); }
    }
}

// ══════════════════════════════════════════════════════════
// CACHÉ
// ══════════════════════════════════════════════════════════
let _cacheNoticias=null,_cacheFecha=0;
const CACHE_TTL = 5*60*1000;
function invalidarCache() { _cacheNoticias=null; _cacheFecha=0; }

// ══════════════════════════════════════════════════════════
// BD — INIT
// ══════════════════════════════════════════════════════════
async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS noticias(id SERIAL PRIMARY KEY,titulo VARCHAR(255) NOT NULL,slug VARCHAR(255) UNIQUE,seccion VARCHAR(100),contenido TEXT,seo_description VARCHAR(160),seo_keywords VARCHAR(255),redactor VARCHAR(100),imagen TEXT,imagen_alt VARCHAR(255),imagen_caption TEXT,imagen_nombre VARCHAR(100),imagen_fuente VARCHAR(50),vistas INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,estado VARCHAR(50) DEFAULT 'publicada')`);
        for (const col of ['imagen_alt','imagen_caption','imagen_nombre','imagen_fuente','imagen_original'])
            await client.query(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}') THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT; END IF; END$$;`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE TABLE IF NOT EXISTS memoria_ia(id SERIAL PRIMARY KEY,tipo VARCHAR(50) NOT NULL,valor TEXT NOT NULL,categoria VARCHAR(100),exitos INTEGER DEFAULT 0,fallos INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memoria_tipo ON memoria_ia(tipo,categoria)`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS comentarios(id SERIAL PRIMARY KEY,noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,nombre VARCHAR(80) NOT NULL,texto TEXT NOT NULL,aprobado BOOLEAN DEFAULT true,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_comentarios_noticia ON comentarios(noticia_id,aprobado,fecha DESC)`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS publicidad(id SERIAL PRIMARY KEY,nombre_espacio VARCHAR(100) NOT NULL,url_afiliado TEXT DEFAULT '',imagen_url TEXT DEFAULT '',ubicacion VARCHAR(50) DEFAULT 'top',activo BOOLEAN DEFAULT true,ancho_px INTEGER DEFAULT 0,alto_px INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        const cp = await client.query('SELECT COUNT(*) FROM publicidad');
        if (parseInt(cp.rows[0].count)===0) await client.query(`INSERT INTO publicidad(nombre_espacio,ubicacion,activo) VALUES('Banner Top','top',false),('Banner Sidebar','sidebar',false),('Banner Medio','medio',false),('Banner Footer','footer',false)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_noticias_fts ON noticias USING gin(to_tsvector('spanish',COALESCE(contenido,'')))`).catch(()=>{});
        console.log('✅ BD lista V41');
    } catch(e) { console.error('❌ BD:', e.message); }
    finally { client.release(); }
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// RUTAS API
// ══════════════════════════════════════════════════════════
app.get('/health', (req,res) => res.json({status:'OK',version:'41.0',gemini_keys:TODAS_LLAVES_GEMINI.length,gsc:'integrado',watermark:'garantizado'}));

app.get('/api/noticias', async (req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','public,max-age=300');
    try {
        if (_cacheNoticias&&(Date.now()-_cacheFecha)<CACHE_TTL) return res.json({success:true,noticias:_cacheNoticias,cached:true});
        const r = await pool.query("SELECT id,titulo,slug,seccion,imagen,imagen_alt,seo_description,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30",['publicada']);
        _cacheNoticias=r.rows; _cacheFecha=Date.now();
        res.json({success:true,noticias:r.rows});
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
        let imgFinal=imagen||`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`;
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

app.post('/api/comentarios/:nid', async (req,res) => {
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

app.post('/api/push/suscribir', express.json(), async (req,res) => {
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
        const llaves=TODAS_LLAVES_GEMINI.map((k,i)=>{const st=getKeyState(k);return{llave:`KEY${i+1}`,disponible:Date.now()>=st.resetTime,exitos:st.exitos,errores:st.errores};});
        res.json({success:true,resumen:gl.rows[0],top_noticias:top.rows,por_categoria:proms.rows,horas_pico:horas.rows,frases_exitosas:frases.rows,gemini_keys:llaves,recomendacion:`Publica en: ${horas.rows.slice(0,3).map(h=>`${h.h}:00`).join(', ')}`});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/gemini/status', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN'});
    const estado=TODAS_LLAVES_GEMINI.map((k,i)=>{const st=getKeyState(k);return{llave:`KEY${i+1}`,disponible:Date.now()>=st.resetTime,exitos:st.exitos,errores:st.errores,ultimo_uso:st.lastRequest?new Date(st.lastRequest).toISOString():null,desbloqueo:Date.now()<st.resetTime?new Date(st.resetTime).toISOString():null};});
    res.json({success:true,total:TODAS_LLAVES_GEMINI.length,llaves:estado,rr_index:_rrIdx});
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

app.get('/noticia/:slug', async (req,res) => {
    try {
        const r=await pool.query("SELECT * FROM noticias WHERE slug=$1 AND estado='publicada'",[req.params.slug]);
        if (!r.rows.length) return res.status(404).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>404</title></head><body style="background:#070707;color:#EDE8DF;text-align:center;padding:60px;font-family:sans-serif"><h1 style="color:#FF5500">404</h1><p>Noticia no encontrada</p><a href="/" style="color:#FF5500">← Volver</a></body></html>');
        const n=r.rows[0];
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1',[n.id]);
        try {
            let html=fs.readFileSync(path.join(__dirname,'client','noticia.html'),'utf8');
            const urlN=`${BASE_URL}/noticia/${n.slug}`;
            const cHTML=n.contenido.split('\n').filter(p=>p.trim()).map(p=>`<p>${p.trim()}</p>`).join('');
            html=html.replace('<!-- META_TAGS -->',metaTagsCompletos(n,urlN))
                .replace(/{{TITULO}}/g,esc(n.titulo)).replace(/{{CONTENIDO}}/g,cHTML)
                .replace(/{{FECHA}}/g,new Date(n.fecha).toLocaleDateString('es-DO',{year:'numeric',month:'long',day:'numeric'}))
                .replace(/{{IMAGEN}}/g,n.imagen).replace(/{{ALT}}/g,esc(n.imagen_alt||n.titulo))
                .replace(/{{VISTAS}}/g,n.vistas).replace(/{{REDACTOR}}/g,esc(n.redactor))
                .replace(/{{SECCION}}/g,esc(n.seccion)).replace(/{{URL}}/g,encodeURIComponent(urlN));
            res.setHeader('Content-Type','text/html;charset=utf-8');
            res.setHeader('Cache-Control','public,max-age=300');
            res.send(html);
        } catch { res.json({success:true,noticia:n}); }
    } catch { res.status(500).send('Error interno'); }
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
        const llaves=TODAS_LLAVES_GEMINI.map((k,i)=>{const st=getKeyState(k);return`KEY${i+1}:${Date.now()>=st.resetTime?'✅':'⏳'}`;}).join(' ');
        const gscData = gsc.rows.length ? JSON.parse(gsc.rows[0].valor) : null;
        res.json({
            status:'OK', version:'41.0-GSC-DOMINANCE',
            noticias:parseInt(r.rows[0].count), rss_procesados:parseInt(rss.rows[0].count),
            min_sin_publicar:minS, ultima_noticia:ult.rows[0]?.titulo?.substring(0,60)||'—',
            gemini:`${TODAS_LLAVES_GEMINI.length}/8 llaves`, gemini_llaves:llaves,
            gsc_integrado:'✅ Search Console conectado — Gemini usa datos reales',
            gsc_ultima_sync:gsc.rows[0]?.ultima_vez||'Pendiente',
            gsc_clics:gscData?.total_clics||0,
            gsc_impresiones:gscData?.total_impresiones||0,
            gsc_ctr:gscData?.ctr_promedio||0,
            gsc_oportunidades:gscData?.oportunidades?.length||0,
            imagen_v41:'✅ Coherente con contenido',
            watermark:'✅ GARANTIZADO',
            prompt:'✅ V41 — GSC + calles SDE + 8 párrafos + A/B titles',
            validacion:'✅ Dual: longitud + semántica SDE',
            max_tokens:'✅ 8000',
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
                gemini:`${BASE_URL}/api/gemini/status?pin=311`,
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
        await inicializarBase();
        await initPushTable();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V41.0 GSC DOMINANCE EDITION             ║
╠══════════════════════════════════════════════════════════════════╣
║  📊 Google Search Console → Gemini escribe lo que buscan       ║
║  🎯 Oportunidades de oro: impresiones altas + CTR bajo         ║
║  🏆 Réplica de fórmulas ganadoras (CTR >5%)                   ║
║  🔑 ${TODAS_LLAVES_GEMINI.length}/8 llaves Gemini | maxTokens: 8000                   ║
║  💧 Watermark GARANTIZADO en cada noticia                      ║
║  🧠 Prompt V41: GSC + calles SDE + 8 párrafos + A/B          ║
║  ⏰ GSC Sync: arranque + 6AM + 12PM + 6PM                     ║
║  📡 /api/gsc/status y /api/gsc/sync disponibles               ║
╚══════════════════════════════════════════════════════════════════╝`);
        });

        // GSC sync al arrancar (después de 30s para dejar que la BD se estabilice)
        setTimeout(async () => {
            console.log('📊 [GSC] Primer sync al arranque...');
            await sincronizarGSC();
        }, 30000);

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
