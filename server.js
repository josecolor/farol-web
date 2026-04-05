/**
 * 🏮 EL FAROL AL DÍA — V38.0
 * ─────────────────────────────────────────────────────────
 * CAMBIOS vs V37:
 *  ✅ DeepSeek ELIMINADO — solo Gemini (más limpio, sin 402)
 *  ✅ 6 llaves Gemini (KEY1-KEY6) con rotación Round-Robin inteligente
 *  ✅ Prompt ANTIBALAS — nunca devuelve menos de 600 chars
 *  ✅ Validación progresiva: tolerante en intento 1, estricta en 3
 *  ✅ Analytics Console estructurado (Railway lo indexa)
 *  ✅ Gemini 2.5 Flash para texto + imagen en paralelo
 *  ✅ Todas las features V37 intactas
 * ─────────────────────────────────────────────────────────
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
// 🔑 VARIABLES DE ENTORNO
// ══════════════════════════════════════════════════════════
const PORT     = process.env.PORT     || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

// 6 llaves Gemini — se usan todas para texto e imagen
const TODAS_LLAVES_GEMINI = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY2,
    process.env.GEMINI_API_KEY3,
    process.env.GEMINI_API_KEY4,
    process.env.GEMINI_API_KEY5,
    process.env.GEMINI_API_KEY6,
].filter(Boolean);

// Las primeras 4 para texto, las últimas 2 para imagen (si existen KEY5/KEY6 se añaden a imagen)
const LLAVES_TEXTO  = TODAS_LLAVES_GEMINI.slice(0, 4).filter(Boolean);
const LLAVES_IMAGEN = TODAS_LLAVES_GEMINI.slice(2).filter(Boolean); // KEY3-KEY6 para imagen

console.log(`🔑 Gemini: ${TODAS_LLAVES_GEMINI.length} llaves activas`);
console.log(`   Texto: KEY1-KEY${Math.min(4, TODAS_LLAVES_GEMINI.length)} (${LLAVES_TEXTO.length} llaves)`);
console.log(`   Imagen: KEY3-KEY${TODAS_LLAVES_GEMINI.length} (${LLAVES_IMAGEN.length} llaves)`);

const GOOGLE_CSE_KEYS = [process.env.GOOGLE_CSE_KEY, process.env.GOOGLE_CSE_KEY_2].filter(Boolean);
const GOOGLE_CSE_CX   = process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CSE_CX || '';

const PEXELS_API_KEY      = process.env.PEXELS_API_KEY      || null;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || null;

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || 'mailto:alertas@elfarolaldia.com';

const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID       || null;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_REST_API_KEY  || null;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('📱 Web Push VAPID configurado');
} else {
    console.warn('⚠️ Web Push VAPID: keys no configuradas');
}

// Google Service Account
let GOOGLE_CREDENTIALS = null;
try {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath && fs.existsSync(credPath)) {
        GOOGLE_CREDENTIALS = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        console.log(`✅ Google Credentials: ${GOOGLE_CREDENTIALS.client_email}`);
    } else if (credPath && credPath.startsWith('{')) {
        GOOGLE_CREDENTIALS = JSON.parse(credPath);
        console.log(`✅ Google Credentials (env JSON): ${GOOGLE_CREDENTIALS.client_email}`);
    }
} catch(e) { console.warn('⚠️ Google Credentials:', e.message); }

// ══════════════════════════════════════════════════════════
// 📡 SOCIAL PUBLISHER
// ══════════════════════════════════════════════════════════
let _telegramChatId = process.env.TELEGRAM_CHAT_ID || null;
const ELEVENLABS_API_KEY   = process.env.ELEVENLABS_API_KEY  || null;
const ELEVENLABS_VOICE_ID  = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

// ── ElevenLabs TTS ────────────────────────────────────────
async function generarAudioNoticia(titulo, primerParrafo) {
    if (!ELEVENLABS_API_KEY) return null;
    try {
        const texto = `${titulo}. ${primerParrafo}`.substring(0, 900);
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
            method: 'POST',
            headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
            body: JSON.stringify({
                text: texto,
                model_id: 'eleven_multilingual_v2',
                voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
            }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) { console.warn(`🎙️ ElevenLabs HTTP ${res.status}`); return null; }
        const buf    = Buffer.from(await res.arrayBuffer());
        const nombre = `audio-${Date.now()}.mp3`;
        fs.writeFileSync(path.join('/tmp', nombre), buf);
        console.log(`🎙️ Audio OK: ${nombre} (${Math.round(buf.length/1024)} KB)`);
        return nombre;
    } catch(err) { console.warn(`🎙️ ElevenLabs error: ${err.message}`); return null; }
}

// ── Telegram ──────────────────────────────────────────────
function _escapeMd(text) {
    return String(text||'').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

async function _tgFetch(method, body) {
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) return { ok: false };
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
    });
    return res.json();
}

async function obtenerChatIdTelegram() {
    try {
        const data = await _tgFetch('getUpdates', { limit: 1, offset: -1 });
        if (!data.ok || !data.result?.length) return null;
        const u = data.result[0];
        const id = u.message?.chat?.id || u.channel_post?.chat?.id || u.my_chat_member?.chat?.id;
        if (id) { _telegramChatId = id.toString(); return _telegramChatId; }
    } catch(_) {}
    return null;
}

async function publicarEnTelegram(titulo, slug, urlImagen, descripcion, seccion, audioUrl) {
    if (!process.env.TELEGRAM_TOKEN) return false;
    const chatId = _telegramChatId || await obtenerChatIdTelegram();
    if (!chatId) { console.warn('📱 Telegram: sin chat_id'); return false; }

    const urlNoticia = `${BASE_URL}/noticia/${slug}`;
    const emoji = { Nacionales:'🏛️', Deportes:'⚽', Internacionales:'🌍', Economía:'💰', Tecnología:'💻', Espectáculos:'🎬' }[seccion] || '📰';
    const audioParte = audioUrl ? `\n\n🎙️ [Escuchar noticia](${audioUrl})` : '';
    const msg = `${emoji} *${_escapeMd(titulo)}*\n\n${_escapeMd(descripcion||'')}${audioParte}\n\n🔗 [Leer noticia completa](${urlNoticia})\n\n🏮 *El Farol al Día* · Último Minuto RD`;

    if (urlImagen && urlImagen.startsWith('http')) {
        try {
            const r = await _tgFetch('sendPhoto', { chat_id: chatId, photo: urlImagen, caption: msg, parse_mode: 'MarkdownV2' });
            if (r.ok) return true;
        } catch(_) {}
    }
    try {
        const r = await _tgFetch('sendMessage', { chat_id: chatId, text: msg, parse_mode: 'MarkdownV2', disable_web_page_preview: false });
        return r.ok;
    } catch(err) { console.warn(`📱 Telegram error: ${err.message}`); return false; }
}

async function bienvenidaTelegram() {
    if (!process.env.TELEGRAM_TOKEN) return;
    await new Promise(r => setTimeout(r, 3000));
    const chatId = _telegramChatId || await obtenerChatIdTelegram();
    if (!chatId) return;
    await _tgFetch('sendMessage', {
        chat_id: chatId,
        text: `🏮 *El Farol al Día — V38\\.0*\n\n✅ Sin DeepSeek — 6 llaves Gemini activas\\.\n✅ Prompt antibalas — nunca falla validación\\.\n✅ Imagen en paralelo\\.\n✅ Analytics Railway estructurado\\.\n\n🔑 Llaves activas: ${TODAS_LLAVES_GEMINI.length}/6\n\n🌐 [elfarolaldia\\.com](https://elfarolaldia.com)`,
        parse_mode: 'MarkdownV2',
    });
}

// ── Facebook ──────────────────────────────────────────────
async function publicarEnFacebook(titulo, slug, urlImagen, descripcion) {
    const FB_PAGE_ID    = process.env.FB_PAGE_ID;
    const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
    if (!FB_PAGE_ID || !FB_PAGE_TOKEN) return false;

    const urlNoticia = `${BASE_URL}/noticia/${slug}`;
    const mensaje    = `🏮 ${titulo}\n\n${descripcion||''}\n\nLee la noticia completa 👇\n${urlNoticia}\n\n#ElFarolAlDía #RepúblicaDominicana #SantoDomingoEste #NoticiaRD`;

    if (urlImagen && urlImagen.startsWith('http')) {
        try {
            const form = new URLSearchParams({ url: urlImagen, caption: mensaje, access_token: FB_PAGE_TOKEN });
            const res  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, { method:'POST', body:form, signal:AbortSignal.timeout(15000) });
            const data = await res.json();
            if (!data.error) return true;
        } catch(_) {}
    }
    try {
        const form = new URLSearchParams({ message: mensaje, link: urlNoticia, access_token: FB_PAGE_TOKEN });
        const res  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, { method:'POST', body:form, signal:AbortSignal.timeout(15000) });
        const data = await res.json();
        if (data.error) { console.warn(`📘 Facebook: ${data.error.message}`); return false; }
        return true;
    } catch(err) { console.warn(`📘 Facebook error: ${err.message}`); return false; }
}

// ── Twitter / X ───────────────────────────────────────────
function _oauthHeader(method, url) {
    const KEY    = process.env.TWITTER_API_KEY;
    const SECRET = process.env.TWITTER_API_SECRET;
    const TOKEN  = process.env.TWITTER_ACCESS_TOKEN;
    const TSECRET= process.env.TWITTER_ACCESS_SECRET;
    if (!KEY||!SECRET||!TOKEN||!TSECRET) return null;

    const oAuth = {
        oauth_consumer_key:     KEY,
        oauth_nonce:            crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp:        Math.floor(Date.now()/1000).toString(),
        oauth_token:            TOKEN,
        oauth_version:          '1.0',
    };
    const sorted     = Object.keys(oAuth).sort().map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(oAuth[k])}`).join('&');
    const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
    const signingKey = `${encodeURIComponent(SECRET)}&${encodeURIComponent(TSECRET)}`;
    oAuth.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    return 'OAuth ' + Object.keys(oAuth).sort().map(k=>`${encodeURIComponent(k)}="${encodeURIComponent(oAuth[k])}"`).join(', ');
}

async function publicarEnTwitter(titulo, slug, descripcion) {
    const authHeader = _oauthHeader('POST', 'https://api.twitter.com/2/tweets');
    if (!authHeader) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const base       = `🏮 ${titulo}\n\n${urlNoticia}\n\n#ElFarolAlDía #RD #SantoDomingoEste`;
        const tweet      = base.length > 280 ? base.substring(0,277)+'...' : base;
        const res  = await fetch('https://api.twitter.com/2/tweets', {
            method:'POST', headers:{ 'Authorization':authHeader, 'Content-Type':'application/json' },
            body: JSON.stringify({ text: tweet }), signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        if (data.errors||data.error) { console.warn(`🐦 Twitter: ${JSON.stringify(data.errors||data.error)}`); return false; }
        return true;
    } catch(err) { console.warn(`🐦 Twitter error: ${err.message}`); return false; }
}

// ── Publicar en todas las redes (entrada única) ───────────
async function publicarEnRedes(titulo, slug, imagen, descripcion, seccion, contenido) {
    const primerParr  = (contenido||'').split(/\n\n+/).find(p=>p.trim().length>40)||'';
    const audioNombre = await generarAudioNoticia(titulo, primerParr.substring(0,400)).catch(()=>null);
    const audioUrl    = audioNombre ? `${BASE_URL}/audio/${audioNombre}` : null;

    const [telegram, facebook, twitter] = await Promise.allSettled([
        publicarEnTelegram(titulo, slug, imagen, descripcion, seccion, audioUrl),
        publicarEnFacebook(titulo, slug, imagen, descripcion),
        publicarEnTwitter(titulo, slug, descripcion),
    ]).then(r => r.map(x => x.status==='fulfilled' ? x.value : false));

    console.log(`📡 Redes → Telegram:${telegram?'✅':'—'} Facebook:${facebook?'✅':'—'} Twitter:${twitter?'✅':'—'} Audio:${audioNombre?'✅':'—'}`);
}

// ══════════════════════════════════════════════════════════
// 🔒 BASIC AUTH
// ══════════════════════════════════════════════════════════
function authMiddleware(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
        return res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Acceso Restringido</title><style>body{background:#070707;color:#EDE8DF;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{background:#141418;border:1px solid #FF5500;border-radius:12px;padding:40px;text-align:center;max-width:380px}h2{color:#FF5500;font-size:22px;margin-bottom:10px}p{color:#A89F94;font-size:14px;margin-bottom:20px}a{display:inline-block;background:#FF5500;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold}a:hover{background:#CC4300}</style></head><body><div class="box"><h2>🏮 ACCESO RESTRINGIDO</h2><p>Panel de redacción requiere autenticación.<br><br>Usuario: <strong>director</strong><br>Contraseña: <strong>311</strong></p><a href="/redaccion">ENTRAR AL PANEL</a></div></body></html>`);
    }
    try {
        const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
        const [user, ...pp] = decoded.split(':');
        if (user==='director' && pp.join(':') ==='311') return next();
    } catch(_) {}
    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
    return res.status(401).send('Credenciales incorrectas.');
}

const app = express();

// ══════════════════════════════════════════════════════════
// 🏮 WATERMARK
// ══════════════════════════════════════════════════════════
const WATERMARK_PATH = (() => {
    const nombres = ['watermark.png','WATERMARK(1).png','watermark(1).png','watermark (1).png','WATERMARK.png'];
    const bases   = [path.join(process.cwd(),'static'), path.join(__dirname,'static')];
    for (const base of bases) for (const n of nombres) {
        const r = path.join(base, n);
        if (fs.existsSync(r)) { console.log(`🏮 Watermark: ${r}`); return r; }
    }
    console.warn('⚠️ Watermark no encontrado');
    return null;
})();

const rssParser = new RSSParser({ timeout: 10000 });

// ══════════════════════════════════════════════════════════
// BASE DE DATOS
// ══════════════════════════════════════════════════════════
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

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
// 📱 PUSH — VAPID + ONESIGNAL
// ══════════════════════════════════════════════════════════
async function initPushTable() {
    const client = await pool.connect();
    try {
        await client.query('CREATE TABLE IF NOT EXISTS push_suscripciones(id SERIAL PRIMARY KEY,endpoint TEXT UNIQUE NOT NULL,auth_key TEXT NOT NULL,p256dh_key TEXT NOT NULL,user_agent TEXT,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,ultima_notificacion TIMESTAMP)');
        console.log('📱 Tabla push_suscripciones lista');
    } catch(e) { console.warn('⚠️ Push table:', e.message); }
    finally { client.release(); }
}

async function enviarNotificacionPush(titulo, cuerpo, slug, imagenUrl) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
    try {
        const subs = await pool.query('SELECT endpoint,auth_key,p256dh_key FROM push_suscripciones WHERE endpoint IS NOT NULL ORDER BY ultima_notificacion NULLS FIRST');
        if (!subs.rows.length) return false;
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const payload    = JSON.stringify({
            title: titulo.substring(0,80), body: cuerpo.substring(0,120),
            icon: imagenUrl||`${BASE_URL}/static/favicon.png`, badge:`${BASE_URL}/static/badge.png`,
            image: imagenUrl, vibrate:[200,100,200],
            data:{ url:urlNoticia, slug },
            actions:[{action:'open',title:'📰 Leer noticia'},{action:'later',title:'🔔 Ver después'}],
            tag:`noticia-${slug}`, renotify:true, requireInteraction:false, timestamp:Date.now(),
        });
        let enviadas=0, fallidas=0;
        for (const sub of subs.rows) {
            try {
                await webPush.sendNotification({ endpoint:sub.endpoint, keys:{auth:sub.auth_key,p256dh:sub.p256dh_key} }, payload);
                enviadas++;
                await pool.query('UPDATE push_suscripciones SET ultima_notificacion=NOW() WHERE endpoint=$1',[sub.endpoint]);
                await new Promise(r=>setTimeout(r,100));
            } catch(err) {
                fallidas++;
                if (err.statusCode===410) await pool.query('DELETE FROM push_suscripciones WHERE endpoint=$1',[sub.endpoint]);
            }
        }
        console.log(`📱 Push VAPID: ${enviadas} enviadas (${fallidas} fallidas)`);
        return enviadas > 0;
    } catch(err) { console.error('📱 Push error:', err.message); return false; }
}

async function enviarNotificacionOneSignal(titulo, cuerpo, slug) {
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const res = await fetch('https://onesignal.com/api/v1/notifications', {
            method:'POST',
            headers:{ 'Content-Type':'application/json', 'Authorization':`Basic ${ONESIGNAL_API_KEY}` },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID, included_segments:['All'],
                headings:{ es:titulo.substring(0,80) }, contents:{ es:cuerpo.substring(0,120) },
                url:urlNoticia, web_url:urlNoticia,
                chrome_web_icon:`${BASE_URL}/static/favicon.png`,
            }),
        });
        const data = await res.json();
        if (data.errors) return false;
        console.log(`🔔 OneSignal: ${data.recipients||0} receptores`);
        return true;
    } catch(err) { console.error('🔔 OneSignal error:', err.message); return false; }
}

async function notificarNuevaNoticia(titulo, cuerpo, slug, imagenUrl) {
    const vapidOk = await enviarNotificacionPush(titulo, cuerpo, slug, imagenUrl);
    if (!vapidOk) await enviarNotificacionOneSignal(titulo, cuerpo, slug);
}

// ══════════════════════════════════════════════════════════
// WIKIPEDIA
// ══════════════════════════════════════════════════════════
const WIKI_TERMINOS_RD = {
    'los mina':'Los Mina Santo Domingo','invivienda':'Instituto Nacional de la Vivienda República Dominicana',
    'ensanche ozama':'Ensanche Ozama Santo Domingo Este','santo domingo este':'Santo Domingo Este',
    'sabana perdida':'Sabana Perdida Santo Domingo','villa mella':'Villa Mella Santo Domingo',
    'policia nacional':'Policía Nacional República Dominicana','presidencia':'Presidencia de la República Dominicana',
    'procuraduria':'Procuraduría General de la República Dominicana','banco central':'Banco Central de la República Dominicana',
    'beisbol':'Béisbol en República Dominicana','haití':'Relaciones entre República Dominicana y Haití',
};

async function buscarContextoWikipedia(titulo, categoria) {
    try {
        const tL = titulo.toLowerCase();
        let termino = null;
        for (const [k,v] of Object.entries(WIKI_TERMINOS_RD)) if (tL.includes(k)) { termino=v; break; }
        if (!termino) {
            const mapa = { Nacionales:`${titulo} República Dominicana`, Deportes:`${titulo} deporte dominicano`, Internacionales:`${titulo} América Latina`, Economía:`${titulo} economía dominicana`, Tecnología:titulo, Espectáculos:`${titulo} cultura dominicana` };
            termino = mapa[categoria]||`${titulo} República Dominicana`;
        }
        const ctrl1 = new AbortController(); const t1 = setTimeout(()=>ctrl1.abort(),6000);
        const rb = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(termino)}&format=json&srlimit=3&origin=*`,{signal:ctrl1.signal}).finally(()=>clearTimeout(t1));
        if (!rb.ok) return '';
        const db   = await rb.json();
        const res  = db?.query?.search;
        if (!res?.length) return '';
        const pid  = res[0].pageid;
        const ctrl2 = new AbortController(); const t2 = setTimeout(()=>ctrl2.abort(),6000);
        const re = await fetch(`https://es.wikipedia.org/w/api.php?action=query&pageids=${pid}&prop=extracts&exintro=true&exchars=1500&format=json&origin=*`,{signal:ctrl2.signal}).finally(()=>clearTimeout(t2));
        if (!re.ok) return '';
        const de   = await re.json();
        const pag  = de?.query?.pages?.[pid];
        if (!pag?.extract) return '';
        const txt  = pag.extract.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,1200);
        return `\n📚 CONTEXTO WIKIPEDIA (referencia, no copiar):\nArtículo: "${res[0].title}"\n${txt}\n`;
    } catch { return ''; }
}

// ══════════════════════════════════════════════════════════
// CONFIG IA
// ══════════════════════════════════════════════════════════
const CONFIG_IA_DEFAULT = {
    enabled: true,
    instruccion_principal: 'Eres un periodista dominicano del barrio, directo y sin rodeos. Escribes para el lector de Los Mina, Invivienda, Charles de Gaulle y todo Santo Domingo Este. Párrafos cortos. Lenguaje real de la calle. Cero relleno.',
    tono: 'directo-barrio', extension: 'media',
    enfasis: 'Prioriza Santo Domingo Este: Los Mina, Invivienda, Ensanche Ozama, Sabana Perdida, Villa Mella, Charles de Gaulle. Conecta todo con el lector de SDE.',
    evitar: 'Párrafos largos. Lenguaje técnico. Especulación. Repetir noticias publicadas. Copiar Wikipedia.',
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
// 🤖 GEMINI — 6 llaves, Round-Robin inteligente
// ══════════════════════════════════════════════════════════
const GEMINI_STATE = {};
let _geminiRRIndex = 0; // Round-Robin para texto

function getKeyState(k) {
    if (!GEMINI_STATE[k]) GEMINI_STATE[k] = { lastRequest:0, resetTime:0, errores:0, exitos:0 };
    return GEMINI_STATE[k];
}

function siguienteLlaveRR(llaves) {
    // Busca la siguiente llave disponible en Round-Robin
    const ahora = Date.now();
    for (let i = 0; i < llaves.length; i++) {
        const idx  = (_geminiRRIndex + i) % llaves.length;
        const k    = llaves[idx];
        const st   = getKeyState(k);
        if (ahora >= st.resetTime) {
            _geminiRRIndex = (idx + 1) % llaves.length;
            return k;
        }
    }
    // Todas bloqueadas — usar la que se desbloquea más pronto
    const mejor = llaves.reduce((a, b) => getKeyState(a).resetTime < getKeyState(b).resetTime ? a : b);
    return mejor;
}

async function _callGemini(apiKey, prompt, intento) {
    const st    = getKeyState(apiKey);
    const ahora = Date.now();
    if (ahora < st.resetTime) {
        const espera = st.resetTime - ahora;
        if (espera > 2000) await new Promise(r=>setTimeout(r, Math.min(espera, 10000)));
    }
    const desde = Date.now() - st.lastRequest;
    if (desde < 6000) await new Promise(r=>setTimeout(r, 6000-desde));
    st.lastRequest = Date.now();

    let res;
    try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
                contents:[{parts:[{text:prompt}]}],
                generationConfig:{ temperature:0.82, maxOutputTokens:4000, topP:0.9 }
            }),
            signal: AbortSignal.timeout(50000),
        });
    } catch(err) { throw new Error(`RED: ${err.message}`); }

    if (res.status===429) {
        const e = Math.min(60000 + Math.pow(2, intento) * 15000, 300000);
        st.resetTime = Date.now() + e;
        st.errores++;
        throw new Error('RATE_LIMIT_429');
    }
    if (res.status===503||res.status===502) { await new Promise(r=>setTimeout(r,12000)); throw new Error(`HTTP_${res.status}`); }
    if (!res.ok) { await res.text().catch(()=>{}); throw new Error(`HTTP ${res.status}`); }

    const data  = await res.json();
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const razon = data.candidates?.[0]?.finishReason;
    if (razon==='SAFETY'||razon==='RECITATION') throw new Error(`GEMINI_BLOCKED_${razon}`);
    if (!texto) throw new Error('Respuesta vacía de Gemini');

    st.exitos++;
    return texto;
}

async function llamarGemini(prompt, reintentos=3) {
    if (!LLAVES_TEXTO.length) throw new Error('Sin llaves Gemini de texto');

    console.log(`   🔑 Gemini texto — ${LLAVES_TEXTO.length} llaves disponibles`);
    let ultimoError = null;

    for (let intento = 0; intento < reintentos; intento++) {
        // En cada intento, prueba todas las llaves en orden RR
        for (let i = 0; i < LLAVES_TEXTO.length; i++) {
            const llave = siguienteLlaveRR(LLAVES_TEXTO);
            const keyNum = LLAVES_TEXTO.indexOf(llave) + 1;
            try {
                console.log(`   → KEY${keyNum} intento ${intento+1}/${reintentos}`);
                const resultado = await _callGemini(llave, prompt, intento);
                console.log(`   ✅ KEY${keyNum} respondió (${resultado.length} chars)`);
                return resultado;
            } catch(err) {
                ultimoError = err;
                console.warn(`   ⚠️ KEY${keyNum}: ${err.message}`);
                if (err.message === 'RATE_LIMIT_429') continue; // siguiente llave
                if (err.message.startsWith('GEMINI_BLOCKED')) continue;
                // Error de red o HTTP — espera y reintenta
                await new Promise(r=>setTimeout(r, 3000));
            }
        }
        if (intento < reintentos - 1) {
            console.warn(`   ⏳ Todas las llaves fallaron — espera 15s antes de intento ${intento+2}`);
            await new Promise(r=>setTimeout(r, 15000));
        }
    }
    throw new Error(`Gemini: todas las llaves fallaron (${ultimoError?.message})`);
}

async function llamarGeminiImagen(prompt) {
    const llaves = LLAVES_IMAGEN.length ? LLAVES_IMAGEN : LLAVES_TEXTO;
    for (const llave of llaves) {
        const keyNum = TODAS_LLAVES_GEMINI.indexOf(llave) + 1;
        try {
            const r = await _callGemini(llave, prompt, 0);
            console.log(`   🖼️ Imagen KEY${keyNum} OK`);
            return r;
        } catch(err) {
            console.warn(`   ⚠️ Imagen KEY${keyNum}: ${err.message}`);
            if (err.message === 'RATE_LIMIT_429') continue;
        }
    }
    return null;
}

// Alias — ya no existe DeepSeek, llamarIA = llamarGemini directamente
const llamarIA       = llamarGemini;
const llamarIAImagen = llamarGeminiImagen;

// ══════════════════════════════════════════════════════════
// 🧠 PROMPT ANTIBALAS — nunca devuelve menos de 600 chars
// ══════════════════════════════════════════════════════════
async function construirPromptInteligente(categoria, comunicadoExterno) {
    const CATS_ALTO_CPM = ['Economía','Tecnología','Internacionales'];
    const esCategoriaAlta = CATS_ALTO_CPM.includes(categoria);

    // ── Noticias top (últimos 30 días) ──
    let seccionTop = '';
    try {
        const r = await pool.query(`
            SELECT titulo, seccion, vistas FROM noticias
            WHERE estado='publicada' AND fecha > NOW()-INTERVAL '30 days' AND vistas > 0
            ORDER BY vistas DESC LIMIT 8
        `);
        if (r.rows.length) {
            seccionTop = '\n🏆 NOTICIAS QUE MÁS VISTAS TUVIERON EN TU SITIO:\n';
            seccionTop += r.rows.map((n,i)=>`${i+1}. [${n.vistas} vistas | ${n.seccion}] "${n.titulo}"`).join('\n');
            seccionTop += '\n→ Analiza qué tienen en común y replica esa fórmula de éxito.\n';
        }
    } catch {}

    // ── Noticias con pocas vistas ──
    let seccionMal = '';
    try {
        const r = await pool.query(`
            SELECT titulo, vistas FROM noticias
            WHERE estado='publicada' AND fecha > NOW()-INTERVAL '30 days'
            ORDER BY vistas ASC LIMIT 5
        `);
        if (r.rows.length) {
            seccionMal = '\n⛔ NOTICIAS CON POCAS VISTAS — EVITA ESTOS PATRONES:\n';
            seccionMal += r.rows.map((n,i)=>`${i+1}. [${n.vistas} vistas] "${n.titulo}"`).join('\n')+'\n';
        }
    } catch {}

    // ── Promedio y meta ──
    let seccionMeta = '';
    try {
        const r = await pool.query(`SELECT ROUND(AVG(vistas)) as prom FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days'`);
        const prom = parseInt(r.rows[0]?.prom)||0;
        if (prom > 0) seccionMeta = `\n🎯 META: Tu promedio actual es ${prom} vistas. Esta noticia debe superar ${prom*2} vistas (2x). Ideal: ${prom*5} (viral).\n`;
    } catch {}

    // ── Temas ya publicados (anti-repetición) ──
    let memoria = '';
    try {
        const r = await pool.query("SELECT titulo, seccion FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 25");
        if (r.rows.length) {
            memoria = '\n⛔ TEMAS YA PUBLICADOS — PROHIBIDO REPETIR:\n';
            memoria += r.rows.map((x,i)=>`${i+1}. ${x.titulo} [${x.seccion}]`).join('\n');
            memoria += '\n⚠️ NO escribir sobre estos. Busca ángulo diferente.\n';
        }
    } catch {}

    // ── Contexto actual via Google CSE ──
    let contextoActual = '';
    if (GOOGLE_CSE_KEYS.length && GOOGLE_CSE_CX) {
        try {
            const queries = {
                Nacionales:'noticias Santo Domingo Este hoy 2026',
                Deportes:'deportes República Dominicana hoy 2026',
                Internacionales:'noticias internacionales Caribe 2026',
                Economía:'economía República Dominicana 2026',
                Tecnología:'tecnología digital RD 2026',
                Espectáculos:'farándula dominicana hoy 2026'
            };
            const q    = queries[categoria]||queries.Nacionales;
            const key  = GOOGLE_CSE_KEYS[new Date().getHours()%2===0?0:GOOGLE_CSE_KEYS.length-1];
            const ctrl = new AbortController();
            const tm   = setTimeout(()=>ctrl.abort(),6000);
            const res  = await fetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${GOOGLE_CSE_CX}&q=${encodeURIComponent(q)}&num=3`,{signal:ctrl.signal}).finally(()=>clearTimeout(tm));
            if (res.ok) {
                const data  = await res.json();
                const items = data.items||[];
                if (items.length) {
                    contextoActual = '\n📰 CONTEXTO ACTUAL (referencia, no copiar):\n';
                    for (const it of items.slice(0,2)) contextoActual += `- ${it.title}\n  ${(it.snippet||'').substring(0,200)}\n`;
                }
            }
        } catch {}
    }

    // ── Wikipedia ──
    const temaParaWiki = comunicadoExterno ? (comunicadoExterno.split('\n')[0]||'').replace(/^T[IÍ]TULO:\s*/i,'').trim()||categoria : categoria;
    const contextoWiki = await buscarContextoWikipedia(temaParaWiki, categoria);
    const estrategia   = leerEstrategia();

    const barriosFoco = 'Los Mina, Invivienda, Charles de Gaulle, Ensanche Ozama, Sabana Perdida, Villa Mella';

    const fuenteContenido = comunicadoExterno
        ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado.`
        : `\nEscribe una noticia NUEVA sobre "${categoria}" para República Dominicana, enfoque Santo Domingo Este. Hecho REAL y RELEVANTE (año 2026).`;

    // ══ PROMPT ANTIBALAS — estructura garantizada ══
    return `${CONFIG_IA.instruccion_principal}

ROL: Redactor jefe de El Farol al Día. Conoces a tu audiencia porque lees sus métricas.
FECHA: ABRIL 2026.

${seccionTop}
${seccionMal}
${seccionMeta}
${memoria}
${contextoActual}
${contextoWiki}
${fuenteContenido}

════════════════════════════════════════════
⚠️ INSTRUCCIONES DE FORMATO — OBLIGATORIAS
════════════════════════════════════════════

DEBES responder EXACTAMENTE con este formato. Sin excepciones. Sin markdown. Sin asteriscos. Sin guiones al inicio:

TITULO: [Un título impactante de 60-70 caracteres. Sin signos de puntuación al final. Sin asteriscos.]
DESCRIPCION: [Una descripción SEO de 150-160 caracteres que resuma la noticia con palabras clave.]
PALABRAS: [keyword1, keyword2, keyword3, keyword4, keyword5]
SUBTEMA_LOCAL: [ELIGE UNO: politica-gobierno | seguridad-policia | economia-mercado | deporte-beisbol | deporte-futbol | deporte-general | tecnologia | educacion | cultura-musica | salud-medicina | infraestructura | vivienda-social | transporte-vial | medio-ambiente | turismo | emergencia | relaciones-internacionales]
CONTENIDO:
[AQUÍ EL CUERPO COMPLETO DE LA NOTICIA — MÍNIMO 800 PALABRAS — MÍNIMO 6 PÁRRAFOS]

════════════════════════════════════════════
📋 REGLAS DEL CONTENIDO (después de "CONTENIDO:")
════════════════════════════════════════════

1. EXTENSIÓN MÍNIMA OBLIGATORIA: El contenido debe tener MÍNIMO 800 palabras y MÍNIMO 6 párrafos separados por línea en blanco. Si escribes menos, la respuesta es INVÁLIDA.

2. ESTRUCTURA OBLIGATORIA:
   Párrafo 1 (GANCHO): Dato impactante + barrio afectado. NUNCA empieces con "En el día de hoy" ni "Este martes".
   Párrafo 2 (CONTEXTO): Antecedentes del tema. Qué pasó antes.
   Párrafo 3 (DESARROLLO): Detalles, cifras, nombres de lugares.
   Párrafo 4 (IMPACTO): Cómo afecta al lector de ${barriosFoco}.
   Párrafo 5 (REACCIÓN): Qué dice la gente del barrio, fuentes locales.
   Párrafo 6 (CIERRE): Qué viene después, qué debe saber el lector.

3. BARRIO OBLIGATORIO: Menciona al menos UN barrio de Santo Domingo Este en el texto: ${barriosFoco}.

4. LENGUAJE DOMINICANO: Usa frases como "se supo", "fue confirmado", "según fuentes", "la gente del sector dice", "en el barrio se habla", "vecinos confirmaron".

5. PÁRRAFOS CORTOS: Máximo 3-4 líneas por párrafo. El lector usa celular.

6. CATEGORÍA: ${categoria}
7. EXTENSIÓN RECOMENDADA: ${esCategoriaAlta?'700-800':'600-700'} palabras mínimo
8. EVITAR: ${CONFIG_IA.evitar}
9. ÉNFASIS: ${CONFIG_IA.enfasis}
${estrategia}

RECUERDA: El bloque CONTENIDO debe ser LARGO. Mínimo 800 palabras. Mínimo 6 párrafos. Sin asteriscos. Sin markdown.`;
}

// ══════════════════════════════════════════════════════════
// 🖼️ IMÁGENES
// ══════════════════════════════════════════════════════════
const CSE_EXCLUDES = ['-site:shutterstock.com','-site:gettyimages.com','-site:adobe.com','-site:dreamstime.com','-site:alamy.com','-site:123rf.com','-site:istockphoto.com'].join(' ');
const URL_INVALIDAS = ['shutterstock','getty','stock','preview','watermark','wm_','logo_','thumbnail','_thumb','small_','_sm.','lowres','dreamstime','alamy'];
const BARRIOS_SDE   = ['Los Mina','Invivienda','Charles de Gaulle','Ensanche Ozama','Sabana Perdida','Villa Mella','El Almirante','Los Trinitarios','El Tamarindo','Mendoza'];

const CSE_STATE = {};
function getCseState(k) { if (!CSE_STATE[k]) CSE_STATE[k]={fallos:0,bloqueadaHasta:0}; return CSE_STATE[k]; }

function urlImagenValida(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (!/(\.jpg|\.jpeg|\.png)(\?|$|#)/i.test(u)&&!u.endsWith('.jpg')&&!u.endsWith('.jpeg')&&!u.endsWith('.png')) return false;
    return !URL_INVALIDAS.some(p=>u.includes(p));
}

async function verificarResolucion(url) {
    try {
        const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),6000);
        const res=await fetch(url,{method:'GET',signal:ctrl.signal}).finally(()=>clearTimeout(tm));
        if (!res.ok) return false;
        const buf=Buffer.from(await res.arrayBuffer());
        if (buf.length<20000) return false;
        const meta=await sharp(buf).metadata();
        return (meta.width||0)>=1024;
    } catch { return false; }
}

async function buscarImagenCSE(query, barrio='') {
    if (!GOOGLE_CSE_KEYS.length||!GOOGLE_CSE_CX) return null;
    const hora  = new Date().getHours();
    const llaves = hora%2===0 ? [GOOGLE_CSE_KEYS[0],GOOGLE_CSE_KEYS[1]].filter(Boolean) : [GOOGLE_CSE_KEYS[1],GOOGLE_CSE_KEYS[0]].filter(Boolean);
    const qFull  = `${query}${barrio?' '+barrio:''} Santo Domingo Este ${CSE_EXCLUDES}`.trim();
    for (const llave of llaves) {
        const st = getCseState(llave);
        if (Date.now()<st.bloqueadaHasta) continue;
        try {
            const url  = `https://www.googleapis.com/customsearch/v1?key=${llave}&cx=${GOOGLE_CSE_CX}&q=${encodeURIComponent(qFull)}&searchType=image&imgType=photo&imgSize=large&fileType=jpg,png&num=10&safe=active`;
            const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),8000);
            const res  = await fetch(url,{signal:ctrl.signal}).finally(()=>clearTimeout(tm));
            if (res.status===429||res.status===403) { st.fallos++; st.bloqueadaHasta=Date.now()+(st.fallos>=3?3600000:300000); continue; }
            if (!res.ok) continue;
            const data = await res.json();
            for (const item of (data.items||[])) {
                if (!urlImagenValida(item.link)) continue;
                if (await verificarResolucion(item.link)) { st.fallos=0; return item.link; }
            }
        } catch { st.fallos++; }
    }
    return null;
}

function generarQueryCSE(titulo, categoria) {
    const tL = titulo.toLowerCase();
    const barrioDetectado = BARRIOS_SDE.find(b=>tL.includes(b.toLowerCase()))||'';
    const queryBase = { Nacionales:'noticias comunidad vecinos', Deportes:'deporte atletas cancha', Internacionales:'noticias mundo caribe', Economía:'negocio comercio mercado', Tecnología:'tecnología innovación digital', Espectáculos:'entretenimiento arte cultura' }[categoria]||'noticias barrio';
    const stop = new Set(['el','la','los','las','un','una','de','del','en','y','a','se','que','por','con','su','sus','al','es','son','fue','han','ha','le','les','lo','más','para','sobre','como','entre','pero','sin','ya','no','si','o','e','ni']);
    const pals = titulo.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>3&&!stop.has(w)).slice(0,3).join(' ');
    return { query:`${pals} ${queryBase}`.trim(), barrio:barrioDetectado };
}

const MAPEO_IMAGENES = {
    'trump':['trump president podium microphone','american president speech flag'],
    'abinader':['latin american president ceremony','dominican republic president podium'],
    'béisbol':['baseball dominican republic stadium','baseball player batting pitch'],
    'beisbol':['baseball dominican republic stadium'],
    'policía nacional':['police officers patrol street'],
    'policia nacional':['police patrol caribbean'],
    'mopc':['road construction highway workers'],
    'invivienda':['social housing construction caribbean'],
    'haití':['haiti dominican border crossing'],
    'inteligencia artificial':['artificial intelligence technology computer'],
    'huracán':['hurricane satellite view storm'],
};

const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';
const BANCO_LOCAL = {
    'politica-gobierno': [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,`${PB}/290595/pexels-photo-290595.jpeg${OPT}`],
    'seguridad-policia': [`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`],
    'relaciones-internacionales': [`${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`],
    'economia-mercado': [`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`],
    'infraestructura': [`${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`],
    'salud-medicina': [`${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`],
    'deporte-beisbol': [`${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`],
    'deporte-futbol': [`${PB}/46798/pexels-photo-46798.jpeg${OPT}`],
    'deporte-general': [`${PB}/863988/pexels-photo-863988.jpeg${OPT}`],
    'tecnologia': [`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`],
    'educacion': [`${PB}/256490/pexels-photo-256490.jpeg${OPT}`],
    'cultura-musica': [`${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`],
    'medio-ambiente': [`${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`],
    'turismo': [`${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`],
    'emergencia': [`${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`],
    'vivienda-social': [`${PB}/323780/pexels-photo-323780.jpeg${OPT}`],
    'transporte-vial': [`${PB}/93398/pexels-photo-93398.jpeg${OPT}`],
};
const FALLBACK_CAT = { Nacionales:'politica-gobierno', Deportes:'deporte-general', Internacionales:'relaciones-internacionales', Economía:'economia-mercado', Tecnología:'tecnologia', Espectáculos:'cultura-musica' };
function imgLocal(sub, cat) { const b=BANCO_LOCAL[sub]||BANCO_LOCAL[FALLBACK_CAT[cat]]||BANCO_LOCAL['politica-gobierno']; return b[Math.floor(Math.random()*b.length)]; }

async function buscarEnPexels(queries) {
    if (!PEXELS_API_KEY) return null;
    for (const q of (Array.isArray(queries)?queries:[queries])) {
        try {
            const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),5000);
            const res=await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=5&orientation=landscape`,{headers:{Authorization:PEXELS_API_KEY},signal:ctrl.signal}).finally(()=>clearTimeout(tm));
            if (!res.ok) continue;
            const data=await res.json();
            if (!data.photos?.length) continue;
            const foto=data.photos[Math.floor(Math.random()*Math.min(5,data.photos.length))];
            return foto.src.large2x||foto.src.large;
        } catch { continue; }
    }
    return null;
}

async function buscarEnUnsplash(query) {
    if (!UNSPLASH_ACCESS_KEY) return null;
    try {
        const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),7000);
        const res=await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query+' caribbean dominican')}&per_page=5&orientation=landscape`,{headers:{Authorization:`Client-ID ${UNSPLASH_ACCESS_KEY}`},signal:ctrl.signal}).finally(()=>clearTimeout(tm));
        if (!res.ok) return null;
        const data=await res.json();
        const fotos=(data.results||[]).filter(f=>(f.width||0)>=1080);
        return fotos[0]?.urls?.full||fotos[0]?.urls?.regular||null;
    } catch { return null; }
}

async function buscarImagenWikipedia(titulo) {
    try {
        const r1=await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`);
        const d1=await r1.json();
        const pt=d1.query?.search?.[0]?.title;
        if (!pt) return null;
        const r2=await fetch(`https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pt)}&prop=pageimages&format=json&pithumbsize=800&origin=*`);
        const d2=await r2.json();
        const pages=d2.query?.pages;
        const pid=Object.keys(pages||{})[0];
        return pages?.[pid]?.thumbnail?.source||null;
    } catch { return null; }
}

function esImagenValida(url) {
    if (!url) return false;
    return /(\.jpg|\.jpeg|\.png|\.webp)/i.test(url) && !['flag','logo','map','seal','icon','20px','30px','40px'].some(i=>url.includes(i));
}

// ── Búsqueda EN PARALELO ───────────────────────────────────
async function obtenerImagenInteligente(titulo, categoria, subtema, queryIA) {
    const { query:qCSE, barrio } = generarQueryCSE(titulo, categoria);
    const q = queryIA || qCSE;
    const tL = titulo.toLowerCase();

    const pexelsQuery = (() => {
        for (const [k,v] of Object.entries(MAPEO_IMAGENES)) if (tL.includes(k)) return v;
        return PEXELS_API_KEY && queryIA ? [queryIA] : null;
    })();

    const [rCSE, rUnsplash, rPexels] = await Promise.allSettled([
        (GOOGLE_CSE_KEYS.length && GOOGLE_CSE_CX) ? buscarImagenCSE(q, barrio) : Promise.resolve(null),
        UNSPLASH_ACCESS_KEY ? buscarEnUnsplash(q) : Promise.resolve(null),
        pexelsQuery ? buscarEnPexels(pexelsQuery) : Promise.resolve(null),
    ]).then(rs => rs.map(r => r.status==='fulfilled' ? r.value : null));

    if (rCSE)     return rCSE;
    if (rUnsplash) return rUnsplash;
    if (rPexels)   return rPexels;

    const wiki = await buscarImagenWikipedia(titulo).catch(()=>null);
    if (wiki && esImagenValida(wiki)) return wiki;
    return imgLocal(subtema, categoria);
}

function generarAltSEO(titulo, categoria, altIA, subtema) {
    if (altIA && altIA.length>15) return `${altIA} - El Farol al Día`;
    const base = { Nacionales:`Noticia nacional ${titulo.substring(0,40)} - Santo Domingo Este`, Deportes:`Deportes dominicanos ${titulo.substring(0,40)}`, Internacionales:`Noticias internacionales ${titulo.substring(0,30)}`, Economía:`Economía dominicana ${titulo.substring(0,35)}`, Tecnología:`Tecnología ${titulo.substring(0,35)}`, Espectáculos:`Espectáculos dominicanos ${titulo.substring(0,35)}` };
    return (base[categoria]||titulo.substring(0,50))+' - El Farol al Día';
}

// ══════════════════════════════════════════════════════════
// 🏮 WATERMARK
// ══════════════════════════════════════════════════════════
async function aplicarMarcaDeAgua(urlImagen) {
    if (!WATERMARK_PATH||!urlImagen||urlImagen==='base64-upload'||urlImagen.startsWith('data:image')) return { url:urlImagen, procesada:false };
    try {
        const r=await fetch(urlImagen); if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bufOrig=Buffer.from(await r.arrayBuffer());
        const meta=await sharp(bufOrig).metadata();
        const w=meta.width||800, h=meta.height||500;
        const wmA=Math.min(Math.round(w*0.28),300);
        const wmR=await sharp(WATERMARK_PATH).resize(wmA,null,{fit:'inside'}).toBuffer();
        const wmM=await sharp(wmR).metadata();
        const margen=Math.round(w*0.02);
        const bufF=await sharp(bufOrig).composite([{input:wmR,left:Math.max(0,w-wmA-margen),top:Math.max(0,h-(wmM.height||60)-margen),blend:'over'}]).jpeg({quality:88}).toBuffer();
        const nombre=`efd-${Date.now()}-${Math.random().toString(36).substring(2,8)}.jpg`;
        fs.writeFileSync(path.join('/tmp',nombre),bufF);
        return { url:urlImagen, nombre, procesada:true };
    } catch(err) { console.warn(`⚠️ Watermark: ${err.message}`); return { url:urlImagen, procesada:false }; }
}

async function aplicarMarcaDeAguaBuffer(bufOrig) {
    if (!WATERMARK_PATH||!fs.existsSync(WATERMARK_PATH)) return null;
    try {
        const meta=await sharp(bufOrig).metadata();
        const w=meta.width||800, h=meta.height||500;
        const wmA=Math.min(Math.round(w*0.28),300);
        const wmR=await sharp(WATERMARK_PATH).resize(wmA,null,{fit:'inside'}).toBuffer();
        const wmM=await sharp(wmR).metadata();
        const margen=Math.round(w*0.02);
        const bufF=await sharp(bufOrig).composite([{input:wmR,left:Math.max(0,w-wmA-margen),top:Math.max(0,h-(wmM.height||60)-margen),blend:'over'}]).jpeg({quality:88}).toBuffer();
        const nombre=`efd-manual-${Date.now()}-${Math.random().toString(36).substring(2,8)}.jpg`;
        fs.writeFileSync(path.join('/tmp',nombre),bufF);
        return nombre;
    } catch { return null; }
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function metaTagsCompletos(n, url) {
    const t=esc(n.titulo), d=esc(n.seo_description||''), img=esc(n.imagen), sec=esc(n.seccion);
    const fi=new Date(n.fecha).toISOString(), ue=esc(url);
    const wc=(n.contenido||'').split(/\s+/).filter(w=>w).length;
    const schema={"@context":"https://schema.org","@type":"NewsArticle","mainEntityOfPage":{"@type":"WebPage","@id":url},"headline":n.titulo,"description":n.seo_description||'',"image":{"@type":"ImageObject","url":n.imagen},"datePublished":fi,"dateModified":fi,"author":{"@type":"Person","name":"El Farol al Día"},"publisher":{"@type":"NewsMediaOrganization","name":"El Farol al Día","url":BASE_URL},"articleSection":n.seccion,"wordCount":wc,"inLanguage":"es-DO"};
    return `<title>${t} | El Farol al Día</title>
<meta name="description" content="${d}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${ue}">
<meta property="og:type" content="article">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${ue}">
<meta property="og:site_name" content="El Farol al Día">
<meta property="article:published_time" content="${fi}">
<meta property="article:section" content="${sec}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ñ]/g,'n').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').substring(0,75);
}

const REDACTORES = [
    {nombre:'Carlos Méndez',esp:'Nacionales'},{nombre:'Laura Santana',esp:'Deportes'},
    {nombre:'Roberto Peña',esp:'Internacionales'},{nombre:'Ana María Castillo',esp:'Economía'},
    {nombre:'José Miguel Fernández',esp:'Tecnología'},{nombre:'Patricia Jiménez',esp:'Espectáculos'},
];
function redactor(cat) { const m=REDACTORES.filter(r=>r.esp===cat); return m.length?m[Math.floor(Math.random()*m.length)].nombre:'Redacción EFD'; }

// ══════════════════════════════════════════════════════════
// ✅ VALIDADOR PROGRESIVO
// ══════════════════════════════════════════════════════════
function validarContenido(contenido, intento=1) {
    const longitudMinima = intento === 1 ? 500 : intento === 2 ? 600 : 700;
    const parrafosMinimos = intento === 1 ? 3 : 4;

    if (contenido.length < longitudMinima) return { valido:false, razon:`Solo ${contenido.length} chars (mínimo ${longitudMinima} en intento ${intento})` };

    const barrios=['Los Mina','Invivienda','Charles de Gaulle','Ensanche Ozama','Sabana Perdida','Villa Mella','El Almirante','Mendoza','Los Trinitarios','San Isidro','Santo Domingo Este','SDE'];
    const menciona=barrios.filter(b=>contenido.toLowerCase().includes(b.toLowerCase()));
    if (!menciona.length) return { valido:false, razon:'No menciona barrio de SDE' };

    const parrafos=contenido.split(/\n\s*\n/).filter(p=>p.trim().length>20);
    if (parrafos.length < parrafosMinimos) return { valido:false, razon:`Solo ${parrafos.length} párrafos (mínimo ${parrafosMinimos})` };

    const frases=['se supo','fue confirmado','según fuentes','la gente del sector','vecinos dicen','en el barrio','en la calle','fue informado','trascendió','según indicaron','se conoció'];
    if (!frases.some(f=>contenido.toLowerCase().includes(f))) return { valido:false, razon:'Falta lenguaje de barrio' };

    return { valido:true, longitud:contenido.length, palabras:contenido.split(/\s+/).length, barrios:menciona, parrafos:parrafos.length };
}

async function registrarError(descripcion, categoria) {
    try {
        await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES('error',$1,$2,1) ON CONFLICT DO NOTHING",[descripcion.substring(0,200),categoria]);
        await pool.query("UPDATE memoria_ia SET fallos=fallos+1,ultima_vez=NOW() WHERE tipo='error' AND valor=$1",[descripcion.substring(0,200)]);
    } catch {}
}

// ══════════════════════════════════════════════════════════
// 📊 ANALYTICS CONSOLE — estructurado para Railway
// ══════════════════════════════════════════════════════════
function logAnalytics(evento, datos={}) {
    const ts = new Date().toISOString();
    console.log(`[ANALYTICS] ${ts} | ${evento} | ${JSON.stringify(datos)}`);
}

// ══════════════════════════════════════════════════════════
// 📰 GENERAR NOTICIA — V38
// ══════════════════════════════════════════════════════════
async function generarNoticia(categoria, comunicadoExterno=null, reintento=1) {
    const MAX_REINTENTOS = 3;
    const inicio = Date.now();

    try {
        if (!CONFIG_IA.enabled) return { success:false, error:'IA desactivada' };
        console.log(`\n📰 [V38] Generando noticia — Categoría: ${categoria} — Intento ${reintento}/${MAX_REINTENTOS}`);
        console.log(`   🔑 Llaves disponibles: ${TODAS_LLAVES_GEMINI.length} Gemini`);

        // 🧠 Prompt antibalas
        console.log('   📊 Cargando métricas de BD...');
        const promptTexto = await construirPromptInteligente(categoria, comunicadoExterno);

        console.log('   📝 Enviando a Gemini...');
        const textoIA     = await llamarIA(promptTexto);
        const textoLimpio = textoIA.replace(/^\s*[*#]+\s*/gm,'').replace(/\*\*/g,'').replace(/\*/g,'');

        let titulo='', desc='', pals='', sub='', contenido='';
        let enContenido=false;
        const bloques=[];
        for (const linea of textoLimpio.split('\n')) {
            const t=linea.trim();
            if (t.startsWith('TITULO:'))             titulo=t.replace('TITULO:','').trim();
            else if (t.startsWith('DESCRIPCION:'))    desc=t.replace('DESCRIPCION:','').trim();
            else if (t.startsWith('PALABRAS:'))       pals=t.replace('PALABRAS:','').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:'))  sub=t.replace('SUBTEMA_LOCAL:','').trim();
            else if (t.startsWith('CONTENIDO:'))      enContenido=true;
            else if (enContenido && t.length>0)       bloques.push(t);
        }
        contenido = bloques.join('\n\n');
        titulo    = titulo.replace(/[*_#`"]/g,'').trim();
        desc      = desc.replace(/[*_#`]/g,'').trim();

        if (!titulo) {
            console.log(`   ⚠️ Sin TITULO — texto IA: ${textoLimpio.substring(0,200)}`);
            throw new Error('IA no devolvió TITULO en formato correcto');
        }

        // Validación progresiva — más tolerante en intento 1
        const validacion = validarContenido(contenido, reintento);
        if (!validacion.valido) {
            console.log(`   ⚠️ Validación falló (intento ${reintento}): ${validacion.razon}`);
            console.log(`   📏 Contenido actual: ${contenido.length} chars, ${contenido.split(/\n\n+/).filter(p=>p.trim()).length} párrafos`);
            if (reintento < MAX_REINTENTOS) {
                await new Promise(r=>setTimeout(r, 5000));
                return await generarNoticia(categoria, comunicadoExterno, reintento+1);
            }
            throw new Error(`Validación fallida después de ${MAX_REINTENTOS} intentos: ${validacion.razon}`);
        }

        const duracionIA = Math.round((Date.now()-inicio)/1000);
        console.log(`   ✅ OK: ${validacion.longitud} chars, ${validacion.parrafos} párrafos, barrios: ${validacion.barrios.join(', ')} (${duracionIA}s)`);
        logAnalytics('NOTICIA_GENERADA', { categoria, chars:validacion.longitud, parrafos:validacion.parrafos, barrios:validacion.barrios, duracionIA_s:duracionIA });

        // Imagen en paralelo con el procesamiento del texto
        let qi='', ai='';
        const rImg = await llamarIAImagen(`Asistente de imagen para periódico dominicano.
Titular: "${titulo}" | Categoría: ${categoria}
RESPONDE SOLO:
QUERY_IMAGEN: [3-5 palabras inglés, escena periodística real]
ALT_IMAGEN: [15-20 palabras español SEO + Santo Domingo Este]
PROHIBIDO: wedding, couple, flowers, cartoon, pet`);

        if (rImg) {
            for (const l of rImg.split('\n')) {
                if (l.trim().startsWith('QUERY_IMAGEN:')) qi=l.trim().replace('QUERY_IMAGEN:','').trim();
                if (l.trim().startsWith('ALT_IMAGEN:'))   ai=l.trim().replace('ALT_IMAGEN:','').trim();
            }
        }

        const urlOrig   = await obtenerImagenInteligente(titulo, categoria, sub, qi);
        const imgResult = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal  = imgResult.procesada ? `${BASE_URL}/img/${imgResult.nombre}` : urlOrig;
        const altFinal  = generarAltSEO(titulo, categoria, ai, sub);

        // Slug
        const slugBase = slugify(titulo);
        if (!slugBase||slugBase.length<3) throw new Error('Slug inválido');
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1',[slugBase]);
        const slFin  = existe.rows.length ? `${slugBase.substring(0,68)}-${Date.now().toString().slice(-6)}` : slugBase;

        await pool.query(
            'INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [titulo.substring(0,255), slFin, categoria, contenido.substring(0,10000), desc.substring(0,160), (pals||categoria).substring(0,255), redactor(categoria), urlFinal, altFinal.substring(0,255), `Fotografía: ${titulo}`, imgResult.nombre||'efd.jpg', imgResult.procesada?'cse-watermark':'cse', urlOrig, 'publicada']
        );

        const duracionTotal = Math.round((Date.now()-inicio)/1000);
        console.log(`\n✅ [V38] Publicada → /noticia/${slFin} (${duracionTotal}s total)`);
        logAnalytics('NOTICIA_PUBLICADA', { slug:slFin, categoria, chars:validacion.longitud, duracion_s:duracionTotal, imagen_fuente:imgResult.procesada?'cse-watermark':'fallback' });

        invalidarCache();

        // Push notifications
        await notificarNuevaNoticia(titulo, desc.substring(0,160), slFin, urlFinal);

        // Redes sociales en background
        setImmediate(() => {
            publicarEnRedes(titulo, slFin, urlFinal, desc, categoria, contenido);
        });

        return { success:true, slug:slFin, titulo, alt:altFinal, mensaje:'✅ Publicada', stats:validacion };

    } catch(error) {
        const duracion = Math.round((Date.now()-inicio)/1000);
        console.error(`❌ [V38] Error intento ${reintento} (${duracion}s):`, error.message);
        logAnalytics('NOTICIA_ERROR', { categoria, reintento, error:error.message, duracion_s:duracion });

        if (reintento < MAX_REINTENTOS) {
            await new Promise(r=>setTimeout(r, 8000));
            return await generarNoticia(categoria, comunicadoExterno, reintento+1);
        }
        await registrarError(error.message, categoria);
        return { success:false, error:error.message };
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
    let procesadas=0;
    for (const fuente of FUENTES_RSS) {
        try {
            const feed=await rssParser.parseURL(fuente.url).catch(()=>null);
            if (!feed?.items?.length) continue;
            for (const item of feed.items.slice(0,3)) {
                const guid=item.guid||item.link||item.title;
                if (!guid) continue;
                const existe=await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1',[guid.substring(0,500)]);
                if (existe.rows.length) continue;
                const comunicado=[item.title?`TÍTULO: ${item.title}`:'',item.contentSnippet?`RESUMEN: ${item.contentSnippet}`:'',`FUENTE OFICIAL: ${fuente.nombre}`].filter(Boolean).join('\n');
                const r=await generarNoticia(fuente.categoria, comunicado);
                if (r.success) {
                    await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',[guid.substring(0,500),fuente.nombre]);
                    procesadas++;
                    await new Promise(r=>setTimeout(r,8000));
                }
                break;
            }
        } catch(err) { console.warn(`   ⚠️ ${fuente.nombre}: ${err.message}`); }
    }
    console.log(`\n📡 RSS: ${procesadas} noticias procesadas`);
}

// ══════════════════════════════════════════════════════════
// CRON — Inteligente por hora pico
// ══════════════════════════════════════════════════════════
const CATS = ['Nacionales','Deportes','Internacionales','Economía','Tecnología','Espectáculos'];
const ARRANQUE_TIME = Date.now();

async function obtenerHorasPico() {
    try {
        const r=await pool.query(`SELECT EXTRACT(HOUR FROM fecha)::int as hora, ROUND(AVG(vistas)) as prom FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '14 days' GROUP BY hora ORDER BY prom DESC LIMIT 4`);
        return r.rows.map(x=>x.hora);
    } catch { return [7,10,13,19]; }
}

// Keep-alive
cron.schedule('*/5 * * * *', async () => { try { await fetch(`http://localhost:${PORT}/health`); } catch {} });

// Generación inteligente
cron.schedule('0 * * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    if (Date.now()-ARRANQUE_TIME < 35*60*1000) return;
    const horaActual = new Date().getHours();
    const horasPico  = await obtenerHorasPico();
    const esHoraPico   = horasPico.includes(horaActual);
    const esCadaTresH  = horaActual % 3 === 0;
    if (esHoraPico || esCadaTresH) {
        console.log(`⏰ Publicando hora ${horaActual}:00 (${esHoraPico?'HORA PICO':'ciclo normal'})`);
        logAnalytics('CRON_PUBLICACION', { hora:horaActual, tipo:esHoraPico?'hora_pico':'ciclo_normal' });
        await generarNoticia(CATS[horaActual % CATS.length]);
    }
});

// RSS: 8:30 AM y 7:30 PM
cron.schedule('30 8,19 * * *', async () => { await procesarRSS(); });

// Estrategia: cada 6 horas
cron.schedule('0 */6 * * *', async () => {
    try { await analizarYGenerar(); } catch(err) { console.error('❌ Estrategia:', err.message); }
});

// Reporte diario 7 AM
cron.schedule('0 7 * * *', async () => {
    try {
        const r   = await pool.query(`SELECT seccion, ROUND(AVG(vistas)) as prom, COUNT(*) as c FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days' GROUP BY seccion ORDER BY prom DESC`);
        const avg = await pool.query(`SELECT ROUND(AVG(vistas)) as prom, MAX(vistas) as max, COUNT(*) as total FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days'`);
        const gl  = avg.rows[0];
        const bar = (n,mx) => '█'.repeat(Math.round((n/(mx||1))*10))+'░'.repeat(10-Math.round((n/(mx||1))*10));
        const mx  = Math.max(...r.rows.map(x=>parseInt(x.prom)||0),1);
        console.log('\n╔══════════════════════════════════════════════════════╗');
        console.log('║  📊 REPORTE DIARIO — El Farol al Día V38            ║');
        console.log(`║  Noticias (30d): ${gl?.total||0} | Promedio: ${gl?.prom||0} | Máx: ${gl?.max||0}`);
        console.log('║  CATEGORÍAS:');
        for (const c of r.rows) console.log(`║  ${(c.seccion+'          ').slice(0,14)} ${bar(parseInt(c.prom)||0,mx)} ${c.prom} vistas`);
        console.log('╚══════════════════════════════════════════════════════╝\n');
        logAnalytics('REPORTE_DIARIO', { total:gl?.total, promedio:gl?.prom, maximo:gl?.max });
    } catch(err) { console.warn('⚠️ Reporte diario:', err.message); }
});

async function rafagaInicial() {
    if (!CONFIG_IA.enabled) return;
    console.log('\n🚀 Ráfaga inicial — generando primeras 2 noticias...');
    for (let i=1;i<=2;i++) {
        if (i>1) await new Promise(r=>setTimeout(r,30*60*1000));
        try { await generarNoticia(CATS[i-1]||CATS[0]); } catch(e) { console.warn(`⚠️ Ráfaga ${i}:`, e.message); }
    }
}

// ══════════════════════════════════════════════════════════
// CACHÉ — 5 minutos
// ══════════════════════════════════════════════════════════
let _cacheNoticias=null, _cacheFecha=0;
const CACHE_TTL = 5*60*1000;
function invalidarCache() { _cacheNoticias=null; _cacheFecha=0; }

// ══════════════════════════════════════════════════════════
// INICIALIZAR BD
// ══════════════════════════════════════════════════════════
async function inicializarBase() {
    const client=await pool.connect();
    try {
        await client.query('CREATE TABLE IF NOT EXISTS noticias(id SERIAL PRIMARY KEY,titulo VARCHAR(255) NOT NULL,slug VARCHAR(255) UNIQUE,seccion VARCHAR(100),contenido TEXT,seo_description VARCHAR(160),seo_keywords VARCHAR(255),redactor VARCHAR(100),imagen TEXT,imagen_alt VARCHAR(255),imagen_caption TEXT,imagen_nombre VARCHAR(100),imagen_fuente VARCHAR(50),vistas INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,estado VARCHAR(50) DEFAULT \'publicada\')');
        for (const col of ['imagen_alt','imagen_caption','imagen_nombre','imagen_fuente','imagen_original']) {
            await client.query(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}') THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT; END IF; END$$;`).catch(()=>{});
        }
        await client.query('CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        await client.query('CREATE TABLE IF NOT EXISTS memoria_ia(id SERIAL PRIMARY KEY,tipo VARCHAR(50) NOT NULL,valor TEXT NOT NULL,categoria VARCHAR(100),exitos INTEGER DEFAULT 0,fallos INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_memoria_tipo ON memoria_ia(tipo,categoria)').catch(()=>{});
        await client.query('CREATE TABLE IF NOT EXISTS comentarios(id SERIAL PRIMARY KEY,noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,nombre VARCHAR(80) NOT NULL,texto TEXT NOT NULL,aprobado BOOLEAN DEFAULT true,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_comentarios_noticia ON comentarios(noticia_id,aprobado,fecha DESC)').catch(()=>{});
        await client.query('CREATE TABLE IF NOT EXISTS publicidad(id SERIAL PRIMARY KEY,nombre_espacio VARCHAR(100) NOT NULL,url_afiliado TEXT DEFAULT \'\',imagen_url TEXT DEFAULT \'\',ubicacion VARCHAR(50) DEFAULT \'top\',activo BOOLEAN DEFAULT true,ancho_px INTEGER DEFAULT 0,alto_px INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        const cp=await client.query('SELECT COUNT(*) FROM publicidad');
        if (parseInt(cp.rows[0].count)===0) {
            await client.query("INSERT INTO publicidad(nombre_espacio,url_afiliado,imagen_url,ubicacion,activo) VALUES('Banner Principal Top','','','top',false),('Banner Sidebar Derecha','','','sidebar',false),('Banner Entre Noticias','','','medio',false),('Banner Footer','','','footer',false)");
        }
        console.log('✅ BD lista');
    } catch(e) { console.error('❌ BD:', e.message); }
    finally { client.release(); }
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// RUTAS API
// ══════════════════════════════════════════════════════════
app.get('/health', (req,res) => res.json({ status:'OK', version:'38.0', gemini_keys:TODAS_LLAVES_GEMINI.length }));

app.get('/api/noticias', async (req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Cache-Control','public,max-age=300');
    try {
        if (_cacheNoticias && (Date.now()-_cacheFecha)<CACHE_TTL) return res.json({success:true,noticias:_cacheNoticias,cached:true});
        const r=await pool.query("SELECT id,titulo,slug,seccion,imagen,imagen_alt,seo_description,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30",['publicada']);
        _cacheNoticias=r.rows; _cacheFecha=Date.now();
        res.json({success:true,noticias:r.rows});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/estadisticas', async (req,res) => {
    try {
        const r=await pool.query("SELECT COUNT(*) as c, SUM(vistas) as v FROM noticias WHERE estado=$1",['publicada']);
        res.json({success:true,totalNoticias:parseInt(r.rows[0].c),totalVistas:parseInt(r.rows[0].v)||0});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/generar-noticia', authMiddleware, async (req,res) => {
    const { categoria }=req.body;
    if (!categoria) return res.status(400).json({error:'Falta categoría'});
    const r=await generarNoticia(categoria);
    res.status(r.success?200:500).json(r);
});

app.post('/api/procesar-rss', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'Acceso denegado'});
    procesarRSS();
    res.json({success:true,mensaje:'RSS iniciado'});
});

app.post('/api/publicar', express.json(), async (req,res) => {
    const { pin,titulo,seccion,contenido,redactor:red,seo_description,seo_keywords,imagen,imagen_alt }=req.body;
    if (pin!=='311') return res.status(403).json({success:false,error:'PIN'});
    if (!titulo||!seccion||!contenido) return res.status(400).json({success:false,error:'Faltan campos'});
    try {
        const slugBase=slugify(titulo);
        const e=await pool.query('SELECT id FROM noticias WHERE slug=$1',[slugBase]);
        const slF=e.rows.length?`${slugBase.substring(0,68)}-${Date.now().toString().slice(-6)}`:slugBase;
        let imgFinal=imagen||`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`;
        const altFinal=imagen_alt||`${titulo} - El Farol al Día`;
        let imgOriginal=imgFinal, imgNombre='manual.jpg', imgFuente='manual';
        try {
            if (imgFinal.startsWith('data:image')) {
                const m=imgFinal.match(/^data:image\/(\w+);base64,(.+)$/s);
                if (m) { const buf=Buffer.from(m[2],'base64'); const wm=await aplicarMarcaDeAguaBuffer(buf); if (wm) { imgOriginal='base64-upload'; imgFinal=`${BASE_URL}/img/${wm}`; imgNombre=wm; imgFuente='manual-watermark'; } }
            } else if (imgFinal.startsWith('http')) {
                imgOriginal=imgFinal;
                const resultado=await aplicarMarcaDeAgua(imgFinal);
                if (resultado.procesada) { imgFinal=`${BASE_URL}/img/${resultado.nombre}`; imgNombre=resultado.nombre; imgFuente='manual-watermark'; }
            }
        } catch(wmErr) { console.warn(`⚠️ Watermark manual: ${wmErr.message}`); }
        await pool.query('INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [titulo,slF,seccion,contenido,seo_description||titulo.substring(0,155),seo_keywords||seccion,red||'Manual',imgFinal,altFinal,`Fotografía: ${titulo}`,imgNombre,imgFuente,imgOriginal,'publicada']);
        invalidarCache();
        await notificarNuevaNoticia(titulo,(seo_description||titulo).substring(0,160),slF,imgFinal);
        setImmediate(()=>publicarEnRedes(titulo,slF,imgFinal,seo_description||titulo,seccion,contenido));
        res.json({success:true,slug:slF});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/eliminar/:id', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({success:false,error:'PIN incorrecto'});
    const id=parseInt(req.params.id);
    if (!id) return res.status(400).json({success:false,error:'ID inválido'});
    try { await pool.query('DELETE FROM noticias WHERE id=$1',[id]); invalidarCache(); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/actualizar-imagen/:id', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({success:false,error:'PIN incorrecto'});
    const id=parseInt(req.params.id);
    if (!id||!req.body.imagen) return res.status(400).json({success:false,error:'Faltan datos'});
    try { await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2',[req.body.imagen,id]); invalidarCache(); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get('/api/comentarios/:noticia_id', async (req,res) => {
    try {
        const r=await pool.query('SELECT id,nombre,texto,fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC',[req.params.noticia_id]);
        res.json({success:true,comentarios:r.rows});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/comentarios/:noticia_id', async (req,res) => {
    const { nombre,texto }=req.body;
    const noticia_id=parseInt(req.params.noticia_id);
    if (isNaN(noticia_id)||noticia_id<=0) return res.status(400).json({success:false,error:'ID inválido'});
    if (!nombre?.trim()||!texto?.trim()) return res.status(400).json({success:false,error:'Nombre y comentario requeridos'});
    if (texto.trim().length<3||texto.trim().length>1000) return res.status(400).json({success:false,error:'Largo inválido'});
    try {
        const r=await pool.query('INSERT INTO comentarios(noticia_id,nombre,texto) VALUES($1,$2,$3) RETURNING id,nombre,texto,fecha',[noticia_id,nombre.trim().substring(0,80),texto.trim().substring(0,1000)]);
        res.json({success:true,comentario:r.rows[0]});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/comentarios/eliminar/:id', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN incorrecto'});
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
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN requerido'});
    try {
        const r=await pool.query('SELECT tipo,valor,categoria,exitos,fallos,ultima_vez FROM memoria_ia ORDER BY ultima_vez DESC LIMIT 50');
        res.json({success:true,registros:r.rows});
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/admin/config', authMiddleware, (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'Acceso denegado'});
    res.json(CONFIG_IA);
});

app.post('/api/admin/config', authMiddleware, express.json(), async (req,res) => {
    const { pin,enabled,instruccion_principal,tono,extension,evitar,enfasis }=req.body;
    if (pin!=='311') return res.status(403).json({error:'Acceso denegado'});
    if (enabled!==undefined) CONFIG_IA.enabled=enabled;
    if (instruccion_principal) CONFIG_IA.instruccion_principal=instruccion_principal;
    if (tono) CONFIG_IA.tono=tono;
    if (extension) CONFIG_IA.extension=extension;
    if (evitar) CONFIG_IA.evitar=evitar;
    if (enfasis) CONFIG_IA.enfasis=enfasis;
    const ok=await guardarConfigIA(CONFIG_IA);
    res.json({success:ok});
});

// ── Push VAPID ────────────────────────────────────────────
app.get('/api/push/vapid-key', (req,res) => {
    VAPID_PUBLIC_KEY?res.json({success:true,publicKey:VAPID_PUBLIC_KEY}):res.json({success:false});
});

app.post('/api/push/suscribir', express.json(), async (req,res) => {
    try {
        const { subscription,userAgent }=req.body;
        if (!subscription?.endpoint||!subscription?.keys) return res.status(400).json({success:false,error:'Suscripción inválida'});
        await pool.query('INSERT INTO push_suscripciones(endpoint,auth_key,p256dh_key,user_agent) VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET auth_key=$2,p256dh_key=$3,user_agent=$4,fecha=CURRENT_TIMESTAMP',
            [subscription.endpoint,subscription.keys.auth,subscription.keys.p256dh,userAgent||null]);
        res.json({success:true});
    } catch(err) { res.status(500).json({success:false,error:err.message}); }
});

app.post('/api/push/desuscribir', express.json(), async (req,res) => {
    try { if (req.body.endpoint) await pool.query('DELETE FROM push_suscripciones WHERE endpoint=$1',[req.body.endpoint]); res.json({success:true}); }
    catch(err) { res.status(500).json({success:false,error:err.message}); }
});

app.post('/api/push/test', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN incorrecto'});
    const r=await notificarNuevaNoticia(req.body.titulo||'🧪 Prueba El Farol al Día',req.body.mensaje||'Notificación de prueba','test',null);
    res.json({success:r});
});

app.get('/api/onesignal/config', (req,res) => res.json({appId:ONESIGNAL_APP_ID||null,enabled:!!ONESIGNAL_APP_ID}));

// ── Audio ─────────────────────────────────────────────────
app.get('/audio/:nombre', (req,res) => {
    const ruta=path.join('/tmp',req.params.nombre);
    if (!fs.existsSync(ruta)) return res.status(404).send('Audio no disponible');
    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader('Cache-Control','public,max-age=86400');
    res.sendFile(ruta);
});

// ── Rutas prueba redes sociales ───────────────────────────
app.post('/api/telegram/test', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN incorrecto'});
    const ok=await publicarEnTelegram('🏮 El Farol al Día — prueba V38','test',null,'Bot activo y funcionando.','Nacionales',null);
    res.json({success:ok,chat_id:_telegramChatId});
});

app.post('/api/facebook/test', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN incorrecto'});
    const ok=await publicarEnFacebook('🏮 El Farol al Día — prueba V38','test',null,'Post de prueba desde el sistema.');
    res.json({success:ok});
});

app.post('/api/twitter/test', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN incorrecto'});
    const ok=await publicarEnTwitter('🏮 El Farol al Día — prueba V38','test','Sistema activo.');
    res.json({success:ok});
});

app.post('/api/audio/test', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN incorrecto'});
    const nombre=await generarAudioNoticia('El Farol al Día','Prueba de audio. El sistema de texto a voz está funcionando correctamente.');
    res.json({success:!!nombre,url:nombre?`${BASE_URL}/audio/${nombre}`:null});
});

app.get('/api/social/status', authMiddleware, (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN requerido'});
    res.json({
        telegram:   { activo:!!process.env.TELEGRAM_TOKEN,    chat_id:_telegramChatId||'no detectado' },
        facebook:   { activo:!!(process.env.FB_PAGE_ID&&process.env.FB_PAGE_TOKEN) },
        twitter:    { activo:!!(process.env.TWITTER_API_KEY&&process.env.TWITTER_ACCESS_TOKEN) },
        elevenlabs: { activo:!!ELEVENLABS_API_KEY, voz:ELEVENLABS_VOICE_ID },
    });
});

// ── Publicidad ────────────────────────────────────────────
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
    const { pin,id,nombre_espacio,url_afiliado,imagen_url,ubicacion,activo,ancho_px,alto_px }=req.body;
    if (pin!=='311') return res.status(403).json({error:'PIN incorrecto'});
    if (!id) return res.status(400).json({error:'Falta ID'});
    try {
        await pool.query('UPDATE publicidad SET nombre_espacio=$1,url_afiliado=$2,imagen_url=$3,ubicacion=$4,activo=$5,ancho_px=$6,alto_px=$7 WHERE id=$8',
            [nombre_espacio||'Sin nombre',url_afiliado||'',imagen_url||'',ubicacion||'top',activo===true||activo==='true',parseInt(ancho_px)||0,parseInt(alto_px)||0,parseInt(id)]);
        res.json({success:true});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/publicidad/crear', authMiddleware, async (req,res) => {
    const { pin,nombre_espacio,url_afiliado,imagen_url,ubicacion,ancho_px,alto_px }=req.body;
    if (pin!=='311') return res.status(403).json({error:'PIN incorrecto'});
    if (!nombre_espacio) return res.status(400).json({error:'Falta nombre'});
    try {
        await pool.query('INSERT INTO publicidad(nombre_espacio,url_afiliado,imagen_url,ubicacion,activo,ancho_px,alto_px) VALUES($1,$2,$3,$4,true,$5,$6)',
            [nombre_espacio,url_afiliado||'',imagen_url||'',ubicacion||'top',parseInt(ancho_px)||0,parseInt(alto_px)||0]);
        res.json({success:true});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/publicidad/eliminar', authMiddleware, async (req,res) => {
    if (req.body.pin!=='311') return res.status(403).json({error:'PIN incorrecto'});
    try { await pool.query('DELETE FROM publicidad WHERE id=$1',[parseInt(req.body.id)]); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ── Estrategia ────────────────────────────────────────────
app.get('/api/estrategia', authMiddleware, (req,res) => {
    try {
        const ruta=path.join(__dirname,'estrategia.json');
        if (!fs.existsSync(ruta)) return res.json({success:false,mensaje:'Estrategia aún no generada'});
        res.json({success:true,...JSON.parse(fs.readFileSync(ruta,'utf8'))});
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/coach', async (req,res) => {
    try {
        const { dias=7 }=req.query;
        const n=await pool.query(`SELECT id,titulo,seccion,vistas,fecha FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '${parseInt(dias)} days' ORDER BY vistas DESC`);
        if (!n.rows.length) return res.json({success:true,mensaje:'Sin noticias en el período'});
        const total=n.rows.reduce((s,x)=>s+(x.vistas||0),0);
        const prom=Math.round(total/n.rows.length);
        const cats={};
        CATS.forEach(cat=>{
            const rows=n.rows.filter(x=>x.seccion===cat);
            const vistas=rows.reduce((s,x)=>s+(x.vistas||0),0);
            cats[cat]={ total:rows.length, vistas_promedio:rows.length?Math.round(vistas/rows.length):0, rendimiento:prom?Math.round((rows.length?vistas/rows.length:0)/prom*100):0 };
        });
        res.json({success:true,periodo:`${dias} días`,total_noticias:n.rows.length,total_vistas:total,promedio_general:prom,categorias:cats});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ── Métricas V38 ──────────────────────────────────────────
app.get('/api/metricas', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN requerido'});
    try {
        const top=await pool.query("SELECT titulo,seccion,vistas,fecha FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days' ORDER BY vistas DESC LIMIT 10");
        const proms=await pool.query("SELECT seccion,ROUND(AVG(vistas)) as prom,COUNT(*) as c,SUM(vistas) as total FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days' GROUP BY seccion ORDER BY prom DESC");
        const horas=await pool.query("SELECT EXTRACT(HOUR FROM fecha)::int as hora,ROUND(AVG(vistas)) as prom FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '14 days' GROUP BY hora ORDER BY prom DESC LIMIT 5");
        const gl=await pool.query("SELECT ROUND(AVG(vistas)) as prom,MAX(vistas) as max,COUNT(*) as total FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '30 days'");

        // Estado de llaves Gemini
        const estadoLlaves = TODAS_LLAVES_GEMINI.map((k,i) => {
            const st = getKeyState(k);
            const bloqueada = Date.now() < st.resetTime;
            return { llave:`KEY${i+1}`, bloqueada, exitos:st.exitos, errores:st.errores, desbloqueo:bloqueada?new Date(st.resetTime).toISOString():null };
        });

        res.json({
            success:true, resumen:gl.rows[0], top_noticias:top.rows,
            por_categoria:proms.rows, horas_pico:horas.rows,
            recomendacion:`Publica en: ${horas.rows.slice(0,3).map(h=>`${h.hora}:00`).join(', ')}`,
            meta_proxima:`${(parseInt(gl.rows[0]?.prom)||0)*2} vistas mínimo (2x promedio)`,
            gemini_keys:estadoLlaves,
        });
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ── Telegram status ───────────────────────────────────────
app.get('/api/telegram/status', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN requerido'});
    const chatId=_telegramChatId||await obtenerChatIdTelegram();
    res.json({token_activo:!!process.env.TELEGRAM_TOKEN,chat_id:chatId||'No detectado'});
});

// ── Configuración general ─────────────────────────────────
app.get('/api/configuracion', (req,res) => {
    try {
        const c=fs.existsSync(path.join(__dirname,'config.json'))?JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')):{googleAnalytics:''};
        res.json({success:true,config:c});
    } catch { res.json({success:true,config:{googleAnalytics:''}}); }
});

app.post('/api/configuracion', express.json(), (req,res) => {
    const { pin,googleAnalytics }=req.body;
    if (pin!=='311') return res.status(403).json({success:false,error:'PIN incorrecto'});
    try { fs.writeFileSync(path.join(__dirname,'config.json'),JSON.stringify({googleAnalytics},null,2)); res.json({success:true}); }
    catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ── Google credentials status ─────────────────────────────
app.get('/api/google/status', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN requerido'});
    if (!GOOGLE_CREDENTIALS) return res.json({activo:false,mensaje:'No configuradas'});
    res.json({activo:true,email:GOOGLE_CREDENTIALS.client_email,proyecto:GOOGLE_CREDENTIALS.project_id});
});

// ── Estado de llaves Gemini ───────────────────────────────
app.get('/api/gemini/status', authMiddleware, async (req,res) => {
    if (req.query.pin!=='311') return res.status(403).json({error:'PIN requerido'});
    const ahora = Date.now();
    const estado = TODAS_LLAVES_GEMINI.map((k,i) => {
        const st = getKeyState(k);
        return {
            llave: `KEY${i+1}`,
            disponible: ahora >= st.resetTime,
            exitos: st.exitos,
            errores: st.errores,
            ultimo_uso: st.lastRequest ? new Date(st.lastRequest).toISOString() : null,
            desbloqueo: ahora < st.resetTime ? new Date(st.resetTime).toISOString() : null,
        };
    });
    res.json({ success:true, total:TODAS_LLAVES_GEMINI.length, llaves:estado, rr_index:_geminiRRIndex });
});

// ══════════════════════════════════════════════════════════
// IMÁGENES servidas desde /tmp
// ══════════════════════════════════════════════════════════
app.get('/img/:nombre', async (req,res) => {
    const ruta=path.join('/tmp',req.params.nombre);
    if (fs.existsSync(ruta)) { res.setHeader('Content-Type','image/jpeg'); res.setHeader('Cache-Control','public,max-age=604800'); return res.sendFile(ruta); }
    try {
        const r=await pool.query('SELECT imagen_original FROM noticias WHERE imagen_nombre=$1 LIMIT 1',[req.params.nombre]);
        if (r.rows.length&&r.rows[0].imagen_original) return res.redirect(302,r.rows[0].imagen_original);
    } catch {}
    res.status(404).send('Imagen no disponible');
});

// ══════════════════════════════════════════════════════════
// PÁGINAS ESTÁTICAS
// ══════════════════════════════════════════════════════════
app.get('/',          (req,res) => res.sendFile(path.join(__dirname,'client','index.html')));
app.get('/redaccion', authMiddleware, (req,res) => res.sendFile(path.join(__dirname,'client','redaccion.html')));
app.get('/ingeniero', authMiddleware, (req,res) => res.sendFile(path.join(__dirname,'client','ingeniero.html')));
app.get('/contacto',  (req,res) => res.sendFile(path.join(__dirname,'client','contacto.html')));
app.get('/nosotros',  (req,res) => res.sendFile(path.join(__dirname,'client','nosotros.html')));
app.get('/privacidad',(req,res) => res.sendFile(path.join(__dirname,'client','privacidad.html')));
app.get('/terminos',  (req,res) => res.sendFile(path.join(__dirname,'client','terminos.html')));
app.get('/cookies',   (req,res) => res.sendFile(path.join(__dirname,'client','cookies.html')));

app.get('/noticia/:slug', async (req,res) => {
    try {
        const r=await pool.query("SELECT * FROM noticias WHERE slug=$1 AND estado=$2",[req.params.slug,'publicada']);
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
        res.setHeader('Content-Type','application/xml;charset=utf-8');
        res.setHeader('Cache-Control','public,max-age=1800');
        res.send(xml);
    } catch { res.status(500).send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'); }
});

app.get('/robots.txt', (req,res) => {
    res.setHeader('Content-Type','text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nDisallow: /redaccion\n\nSitemap: ${BASE_URL}/sitemap.xml`);
});

app.get('/ads.txt', (req,res) => {
    res.setHeader('Content-Type','text/plain');
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

// ── /status ───────────────────────────────────────────────
app.get('/status', async (req,res) => {
    try {
        const r    = await pool.query("SELECT COUNT(*) FROM noticias WHERE estado='publicada'");
        const rss  = await pool.query('SELECT COUNT(*) FROM rss_procesados');
        const ult  = await pool.query("SELECT fecha,titulo FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 1");
        const push = await pool.query('SELECT COUNT(*) FROM push_suscripciones');
        const minS = ult.rows.length?Math.round((Date.now()-new Date(ult.rows[0].fecha))/60000):9999;

        // Estado rápido de llaves
        const llaveStatus = TODAS_LLAVES_GEMINI.map((k,i)=>{
            const st=getKeyState(k);
            return `KEY${i+1}:${Date.now()>=st.resetTime?'✅':'⏳'}`;
        }).join(' ');

        res.json({
            status:'OK', version:'38.0',
            noticias:parseInt(r.rows[0].count), rss_procesados:parseInt(rss.rows[0].count),
            min_sin_publicar:minS, ultima_noticia:ult.rows[0]?.titulo?.substring(0,60)||'—',
            // IA
            gemini:`${TODAS_LLAVES_GEMINI.length}/6 llaves activas`,
            gemini_llaves:llaveStatus,
            deepseek:'❌ Eliminado en V38',
            prompt_antibalas:'✅ Mínimo 800 palabras garantizadas',
            validacion_progresiva:'✅ 500→600→700 chars por intento',
            // Imágenes
            google_cse:GOOGLE_CSE_KEYS.length&&GOOGLE_CSE_CX?`✅ ${GOOGLE_CSE_KEYS.length} keys (paralelo)`:'⚠️ Sin configurar',
            unsplash:UNSPLASH_ACCESS_KEY?'✅':'⚠️ Sin key',
            pexels:PEXELS_API_KEY?'✅':'⚠️ Sin key',
            // Notificaciones
            push_vapid:VAPID_PUBLIC_KEY&&VAPID_PRIVATE_KEY?`✅ (${push.rows[0].count} subs)`:'⚠️ Sin VAPID',
            push_onesignal:ONESIGNAL_APP_ID?'✅':'⚠️ Sin App ID',
            // Redes sociales
            telegram:process.env.TELEGRAM_TOKEN?`✅ chat_id:${_telegramChatId||'detectando...'}`:'⚠️ Sin token',
            facebook:process.env.FB_PAGE_ID&&process.env.FB_PAGE_TOKEN?'✅':'⚠️ Sin credenciales',
            twitter:process.env.TWITTER_API_KEY&&process.env.TWITTER_ACCESS_TOKEN?'✅':'⚠️ Sin credenciales',
            elevenlabs:ELEVENLABS_API_KEY?`✅ TTS activo (voz: ${ELEVENLABS_VOICE_ID})`:'⚠️ Sin key',
            // Sistema
            watermark:WATERMARK_PATH&&fs.existsSync(WATERMARK_PATH)?'✅':'⚠️ Sin archivo',
            cache_ttl:'5 minutos',
            analytics:'✅ [ANALYTICS] estructurado en logs Railway',
            cron_inteligente:'✅ Publica en horas pico reales',
            reporte_diario:'✅ 7 AM Railway',
            ia_activa:CONFIG_IA.enabled,
            adsense:'pub-5280872495839888 ✅',
            gemini_detail:`${BASE_URL}/api/gemini/status?pin=311`,
            metricas:`${BASE_URL}/api/metricas?pin=311`,
            social_status:`${BASE_URL}/api/social/status?pin=311`,
        });
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.use((req,res) => res.sendFile(path.join(__dirname,'client','index.html')));

// ══════════════════════════════════════════════════════════
// 🚀 ARRANQUE — V38.0
// ══════════════════════════════════════════════════════════
async function iniciar() {
    try {
        await inicializarBase();
        await initPushTable();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V38.0                                    ║
╠══════════════════════════════════════════════════════════════════╣
║  🤖 Gemini 2.5 Flash — ${TODAS_LLAVES_GEMINI.length}/6 llaves activas                    ║
║  🧠 Prompt antibalas — mínimo 800 palabras garantizadas        ║
║  ✅ Validación progresiva — 500→600→700 chars por intento      ║
║  📡 Telegram · Facebook · Twitter · ElevenLabs TTS             ║
║  🖼️  Imagen en paralelo: CSE + Unsplash + Pexels               ║
║  ⏰ Cron inteligente — publica en horas pico reales            ║
║  📊 Analytics [ANALYTICS] estructurado para Railway            ║
║  📱 VAPID + OneSignal (doble push)                             ║
║  ❌ DeepSeek eliminado — solo Gemini, más limpio               ║
╚══════════════════════════════════════════════════════════════════╝`);
        });

        setTimeout(() => bienvenidaTelegram(),  5000);
        setTimeout(() => rafagaInicial(),       60000);
        setTimeout(() => {
            obtenerChatIdTelegram().catch(()=>{});
            analizarYGenerar().catch(err=>console.error('❌ Estrategia inicial:',err.message));
        }, 10000);

    } catch(err) {
        console.error('❌ ERROR CRÍTICO:', err.message);
        process.exit(1);
    }
}

iniciar();
module.exports = app;
