/**
 * 🏮 EL FAROL AL DÍA — V36.0 MXL EDITION
 * ─────────────────────────────────────────────────────────────────────────
 * ✅ V36.0 NUEVAS INTEGRACIONES:
 *   1. DeepSeek fallback automático cuando Gemini falla
 *   2. OneSignal + Web Push VAPID (doble sistema de notificaciones)
 *   3. Google Service Account (Credentials) reconocido y listo
 *   4. Todas las variables de Railway conectadas
 *   5. ElevenLabs API key reconocida (lista para TTS futuro)
 * ─────────────────────────────────────────────────────────────────────────
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

// ── Estrategia (loader + analyzer) ───────────────────────────
const { leerEstrategia }   = require('./estrategia-loader');
const { analizarYGenerar } = require('./estrategia-analyzer');
// ─────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════
// 🔑 TODAS LAS VARIABLES DE ENTORNO — RAILWAY COMPLETO
// ══════════════════════════════════════════════════════════
const PORT     = process.env.PORT     || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// Base de datos
if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

// Gemini (texto e imagen)
const LLAVES_TEXTO  = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY2].filter(Boolean);
const LLAVES_IMAGEN = [process.env.GEMINI_API_KEY3, process.env.GEMINI_API_KEY4].filter(Boolean);

// ── DEEPSEEK ─────────────────────────────────────────────
const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY  || null;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

// ── ELEVENLABS (listo para TTS futuro) ───────────────────
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || null;

// ── GOOGLE SERVICE ACCOUNT ───────────────────────────────
// Railway tiene GOOGLE_APPLICATION_CREDENTIALS apuntando al JSON
// O podemos leerlo directo si existe el archivo
let GOOGLE_CREDENTIALS = null;
try {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath && fs.existsSync(credPath)) {
        GOOGLE_CREDENTIALS = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        console.log(`✅ Google Credentials cargadas: ${GOOGLE_CREDENTIALS.client_email}`);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.startsWith('{')) {
        // A veces se pone el JSON directo como variable
        GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        console.log(`✅ Google Credentials (env JSON): ${GOOGLE_CREDENTIALS.client_email}`);
    } else {
        console.warn('⚠️ Google Credentials: no encontradas (opcional)');
    }
} catch(e) {
    console.warn('⚠️ Google Credentials error:', e.message);
}

// Google CSE
const GOOGLE_CSE_KEYS = [process.env.GOOGLE_CSE_KEY, process.env.GOOGLE_CSE_KEY_2].filter(Boolean);
const GOOGLE_CSE_CX   = process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CSE_CX || '';

// Imágenes
const PEXELS_API_KEY   = process.env.PEXELS_API_KEY   || null;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || null;

// Redes sociales
const FB_PAGE_ID            = process.env.FB_PAGE_ID            || null;
const FB_PAGE_TOKEN         = process.env.FB_PAGE_TOKEN         || null;
const TWITTER_API_KEY       = process.env.TWITTER_API_KEY       || null;
const TWITTER_API_SECRET    = process.env.TWITTER_API_SECRET    || null;
const TWITTER_ACCESS_TOKEN  = process.env.TWITTER_ACCESS_TOKEN  || null;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || null;
const TELEGRAM_TOKEN        = process.env.TELEGRAM_TOKEN        || null;
let   TELEGRAM_CHAT_ID      = process.env.TELEGRAM_CHAT_ID      || null;

// ── WEB PUSH VAPID ───────────────────────────────────────
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || 'mailto:alertas@elfarolaldia.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('📱 Web Push VAPID configurado');
} else {
    console.warn('⚠️ Web Push VAPID: keys no configuradas');
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
        const [user, ...passParts] = decoded.split(':');
        const pass = passParts.join(':');
        if (user === 'director' && pass === '311') return next();
    } catch(e) {}
    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
    return res.status(401).send('Credenciales incorrectas. Usuario: director / Contraseña: 311');
}

const app = express();

// ══════════════════════════════════════════════════════════
// 🏮 WATERMARK — BLINDADO
// ══════════════════════════════════════════════════════════
const WATERMARK_PATH = (() => {
    const variantes = ['watermark.png','WATERMARK(1).png','watermark(1).png','watermark (1).png','WATERMARK.png'];
    const bases = [path.join(process.cwd(), 'static'), path.join(__dirname, 'static')];
    for (const base of bases) {
        for (const nombre of variantes) {
            const ruta = path.join(base, nombre);
            if (fs.existsSync(ruta)) { console.log(`🏮 Watermark: ${ruta}`); return ruta; }
        }
    }
    console.warn('⚠️ Watermark no encontrado — fotos sin marca');
    return null;
})();

const rssParser = new RSSParser({ timeout: 10000 });

// ══════════════════════════════════════════════════════════
// BASE DE DATOS
// ══════════════════════════════════════════════════════════
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'public,max-age=2592000,immutable')
}));
app.use(express.static(path.join(__dirname, 'client'), {
    setHeaders: (res, fp) => {
        if (/\.(jpg|jpeg|png|gif|webp|ico|svg)$/i.test(fp)) res.setHeader('Cache-Control', 'public,max-age=2592000,immutable');
        else if (/\.(css|js)$/i.test(fp)) res.setHeader('Cache-Control', 'public,max-age=86400');
    }
}));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','X-Requested-With'] }));
app.options('*', cors());

// ══════════════════════════════════════════════════════════
// 📱 TABLA PUSH SUSCRIPCIONES
// ══════════════════════════════════════════════════════════
async function initPushTable() {
    const client = await pool.connect();
    try {
        await client.query(
            'CREATE TABLE IF NOT EXISTS push_suscripciones (' +
            'id SERIAL PRIMARY KEY,' +
            'endpoint TEXT UNIQUE NOT NULL,' +
            'auth_key TEXT NOT NULL,' +
            'p256dh_key TEXT NOT NULL,' +
            'user_agent TEXT,' +
            'fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
            'ultima_notificacion TIMESTAMP' +
            ')'
        );
        console.log('📱 Tabla push_suscripciones lista');
    } catch(e) { console.warn('⚠️ Push table:', e.message); }
    finally { client.release(); }
}

// ══════════════════════════════════════════════════════════
// 📱 ENVIAR NOTIFICACIÓN PUSH (VAPID)
// ══════════════════════════════════════════════════════════
async function enviarNotificacionPush(titulo, cuerpo, slug, imagenUrl) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
    try {
        const suscriptores = await pool.query(
            'SELECT endpoint, auth_key, p256dh_key FROM push_suscripciones WHERE endpoint IS NOT NULL ORDER BY ultima_notificacion NULLS FIRST'
        );
        if (!suscriptores.rows.length) return false;
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const notificacion = {
            title: titulo.substring(0, 80),
            body: cuerpo.substring(0, 120),
            icon: imagenUrl || `${BASE_URL}/static/favicon.png`,
            badge: `${BASE_URL}/static/badge.png`,
            image: imagenUrl,
            vibrate: [200, 100, 200],
            data: { url: urlNoticia, slug },
            actions: [
                { action: 'open', title: '📰 Leer noticia' },
                { action: 'later', title: '🔔 Ver después' }
            ],
            tag: `noticia-${slug}`,
            renotify: true,
            requireInteraction: false,
            timestamp: Date.now()
        };
        const payload = JSON.stringify(notificacion);
        let enviadas = 0, fallidas = 0;
        for (const sub of suscriptores.rows) {
            try {
                await webPush.sendNotification({ endpoint: sub.endpoint, keys: { auth: sub.auth_key, p256dh: sub.p256dh_key } }, payload);
                enviadas++;
                await pool.query('UPDATE push_suscripciones SET ultima_notificacion = NOW() WHERE endpoint = $1', [sub.endpoint]);
                await new Promise(r => setTimeout(r, 100));
            } catch (err) {
                fallidas++;
                if (err.statusCode === 410) await pool.query('DELETE FROM push_suscripciones WHERE endpoint = $1', [sub.endpoint]);
            }
        }
        console.log(`📱 Push VAPID: ${enviadas} enviadas (${fallidas} fallidas)`);
        return enviadas > 0;
    } catch (err) { console.error('📱 Push error:', err.message); return false; }
}

// ══════════════════════════════════════════════════════════
// 🔔 ONESIGNAL — NOTIFICACIONES ALTERNATIVAS
// ══════════════════════════════════════════════════════════
// OneSignal SDK se carga en el frontend via OneSignalSDKWorker.js
// El server solo necesita el App ID para la API REST si se usa server-side
const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID  || null;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_REST_API_KEY || null;

async function enviarNotificacionOneSignal(titulo, cuerpo, slug) {
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const res = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_API_KEY}`
            },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                included_segments: ['All'],
                headings: { es: titulo.substring(0, 80) },
                contents: { es: cuerpo.substring(0, 120) },
                url: urlNoticia,
                web_url: urlNoticia,
                chrome_web_icon: `${BASE_URL}/static/favicon.png`,
                firefox_icon: `${BASE_URL}/static/favicon.png`,
            })
        });
        const data = await res.json();
        if (data.errors) { console.warn('⚠️ OneSignal error:', data.errors); return false; }
        console.log(`🔔 OneSignal: notificación enviada (${data.recipients || 0} receptores)`);
        return true;
    } catch(err) { console.error('🔔 OneSignal error:', err.message); return false; }
}

// Función unificada: intenta VAPID primero, luego OneSignal
async function notificarNuevaNoticia(titulo, cuerpo, slug, imagenUrl) {
    const vapidOk = await enviarNotificacionPush(titulo, cuerpo, slug, imagenUrl);
    if (!vapidOk) await enviarNotificacionOneSignal(titulo, cuerpo, slug);
}

// ══════════════════════════════════════════════════════════
// 🌐 GOOGLE SERVICE ACCOUNT — JWT AUTH HELPER
// ══════════════════════════════════════════════════════════
// Genera token JWT para Google APIs (Sheets, Analytics, etc.)
async function obtenerGoogleAccessToken(scopes = ['https://www.googleapis.com/auth/spreadsheets']) {
    if (!GOOGLE_CREDENTIALS) return null;
    try {
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({
            iss: GOOGLE_CREDENTIALS.client_email,
            scope: scopes.join(' '),
            aud: GOOGLE_CREDENTIALS.token_uri,
            exp: now + 3600,
            iat: now
        })).toString('base64url');
        const signing = `${header}.${payload}`;
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(signing);
        const signature = sign.sign(GOOGLE_CREDENTIALS.private_key, 'base64url');
        const jwt = `${signing}.${signature}`;
        const res = await fetch(GOOGLE_CREDENTIALS.token_uri, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt
            })
        });
        const data = await res.json();
        if (data.access_token) {
            console.log('✅ Google Access Token obtenido');
            return data.access_token;
        }
        console.warn('⚠️ Google token error:', data.error);
        return null;
    } catch(err) {
        console.error('❌ Google JWT error:', err.message);
        return null;
    }
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
    'beisbol':'Béisbol en República Dominicana','turismo':'Turismo en República Dominicana',
    'economia':'Economía de República Dominicana','educacion':'Educación en República Dominicana',
    'salud publica':'Ministerio de Salud Pública República Dominicana','mopc':'Ministerio de Obras Públicas República Dominicana',
    'haití':'Relaciones entre República Dominicana y Haití',
};

async function buscarContextoWikipedia(titulo, categoria) {
    try {
        const tituloLower = titulo.toLowerCase();
        let terminoBusqueda = null;
        for (const [clave, termino] of Object.entries(WIKI_TERMINOS_RD)) {
            if (tituloLower.includes(clave)) { terminoBusqueda = termino; break; }
        }
        if (!terminoBusqueda) {
            const mapa = { 'Nacionales':`${titulo} República Dominicana`,'Deportes':`${titulo} deporte dominicano`,'Internacionales':`${titulo} América Latina Caribe`,'Economía':`${titulo} economía dominicana`,'Tecnología':titulo,'Espectáculos':`${titulo} cultura dominicana` };
            terminoBusqueda = mapa[categoria] || `${titulo} República Dominicana`;
        }
        const ctrl1 = new AbortController(); const t1 = setTimeout(() => ctrl1.abort(), 6000);
        const resBusq = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(terminoBusqueda)}&format=json&srlimit=3&origin=*`, { signal: ctrl1.signal }).finally(() => clearTimeout(t1));
        if (!resBusq.ok) return '';
        const dataBusq = await resBusq.json();
        const resultados = dataBusq?.query?.search;
        if (!resultados?.length) return '';
        const paginaId = resultados[0].pageid;
        const ctrl2 = new AbortController(); const t2 = setTimeout(() => ctrl2.abort(), 6000);
        const resExtr = await fetch(`https://es.wikipedia.org/w/api.php?action=query&pageids=${paginaId}&prop=extracts&exintro=true&exchars=1500&format=json&origin=*`, { signal: ctrl2.signal }).finally(() => clearTimeout(t2));
        if (!resExtr.ok) return '';
        const dataExtr = await resExtr.json();
        const pagina = dataExtr?.query?.pages?.[paginaId];
        if (!pagina?.extract) return '';
        const textoLimpio = pagina.extract.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,1200);
        return `\n📚 CONTEXTO WIKIPEDIA (referencia factual, no copiar):\nArtículo: "${resultados[0].title}"\n${textoLimpio}\n`;
    } catch(err) { return ''; }
}

// ══════════════════════════════════════════════════════════
// FACEBOOK
// ══════════════════════════════════════════════════════════
async function publicarEnFacebook(titulo, slug, urlImagen, descripcion) {
    if (!FB_PAGE_ID || !FB_PAGE_TOKEN) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const mensaje = `🏮 ${titulo}\n\n${descripcion||''}\n\nLee la noticia completa 👇\n${urlNoticia}\n\n#ElFarolAlDía #RepúblicaDominicana #NoticiaRD`;
        const form = new URLSearchParams();
        form.append('url', urlImagen); form.append('caption', mensaje); form.append('access_token', FB_PAGE_TOKEN);
        const res = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, { method:'POST', body:form });
        const data = await res.json();
        if (data.error) {
            const form2 = new URLSearchParams();
            form2.append('message', mensaje); form2.append('link', urlNoticia); form2.append('access_token', FB_PAGE_TOKEN);
            const res2 = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, { method:'POST', body:form2 });
            const data2 = await res2.json();
            if (data2.error) return false;
        }
        return true;
    } catch(err) { return false; }
}

// ══════════════════════════════════════════════════════════
// TWITTER/X
// ══════════════════════════════════════════════════════════
function generarOAuthHeader(method, url, params, consumerKey, consumerSecret, accessToken, tokenSecret) {
    const oauthParams = { oauth_consumer_key:consumerKey, oauth_nonce:crypto.randomBytes(16).toString('hex'), oauth_signature_method:'HMAC-SHA1', oauth_timestamp:Math.floor(Date.now()/1000).toString(), oauth_token:accessToken, oauth_version:'1.0' };
    const allParams = {...params,...oauthParams};
    const sortedParams = Object.keys(allParams).sort().map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`).join('&');
    const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    oauthParams.oauth_signature = signature;
    return 'OAuth ' + Object.keys(oauthParams).sort().map(k=>`${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`).join(', ');
}

async function publicarEnTwitter(titulo, slug, descripcion) {
    if (!TWITTER_API_KEY||!TWITTER_API_SECRET||!TWITTER_ACCESS_TOKEN||!TWITTER_ACCESS_SECRET) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const textoBase = `🏮 ${titulo}\n\n${urlNoticia}\n\n#ElFarolAlDía #RD`;
        const tweet = textoBase.length>280 ? textoBase.substring(0,277)+'...' : textoBase;
        const tweetUrl = 'https://api.twitter.com/2/tweets';
        const authHeader = generarOAuthHeader('POST',tweetUrl,{},TWITTER_API_KEY,TWITTER_API_SECRET,TWITTER_ACCESS_TOKEN,TWITTER_ACCESS_SECRET);
        const res = await fetch(tweetUrl, { method:'POST', headers:{'Authorization':authHeader,'Content-Type':'application/json'}, body:JSON.stringify({text:tweet}) });
        const data = await res.json();
        if (data.errors||data.error) return false;
        return true;
    } catch(err) { return false; }
}

// ══════════════════════════════════════════════════════════
// TELEGRAM
// ══════════════════════════════════════════════════════════
async function obtenerChatIdTelegram() {
    if (!TELEGRAM_TOKEN) return null;
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?limit=1&offset=-1`);
        const data = await res.json();
        if (data.ok && data.result?.length) {
            const chatId = data.result[0]?.message?.chat?.id || data.result[0]?.channel_post?.chat?.id;
            if (chatId) { TELEGRAM_CHAT_ID = chatId.toString(); return TELEGRAM_CHAT_ID; }
        }
    } catch(e) {}
    return null;
}

async function publicarEnTelegram(titulo, slug, urlImagen, descripcion, seccion) {
    if (!TELEGRAM_TOKEN) return false;
    if (!TELEGRAM_CHAT_ID) { TELEGRAM_CHAT_ID = await obtenerChatIdTelegram(); if (!TELEGRAM_CHAT_ID) return false; }
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const emoji = {'Nacionales':'🏛️','Deportes':'⚽','Internacionales':'🌍','Economía':'💰','Tecnología':'💻','Espectáculos':'🎬'}[seccion]||'📰';
        const mensaje = `${emoji} *${titulo}*\n\n${descripcion||''}\n\n🔗 [Leer noticia completa](${urlNoticia})\n\n🏮 *El Farol al Día* · Último Minuto RD`;
        if (urlImagen && urlImagen.startsWith('http')) {
            try {
                const resImg = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,photo:urlImagen,caption:mensaje,parse_mode:'Markdown'}) });
                const dataImg = await resImg.json();
                if (dataImg.ok) return true;
            } catch(e) {}
        }
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text:mensaje,parse_mode:'Markdown'}) });
        const data = await res.json();
        return data.ok;
    } catch(err) { return false; }
}

async function bienvenidaTelegram() {
    if (!TELEGRAM_TOKEN) return;
    await new Promise(r => setTimeout(r, 3000));
    const chatId = await obtenerChatIdTelegram();
    if (!chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:chatId,text:`🏮 *El Farol al Día — V36.0 MXL*\n\n✅ DeepSeek fallback activo.\n✅ OneSignal + VAPID push activos.\n✅ Google Credentials conectadas.\n✅ Motor anti-repetición activo.\n✅ Validación 600+ chars activa.\n\n🌐 [elfarolaldia.com](https://elfarolaldia.com)`,parse_mode:'Markdown'}) });
    } catch(e) {}
}

// ══════════════════════════════════════════════════════════
// 🏮 WATERMARK
// ══════════════════════════════════════════════════════════
async function aplicarMarcaDeAgua(urlImagen) {
    if (!WATERMARK_PATH) return { url:urlImagen, procesada:false };
    if (!urlImagen || urlImagen === 'base64-upload' || urlImagen.startsWith('data:image')) {
        return { url:urlImagen, procesada:false };
    }
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bufOrig = Buffer.from(await response.arrayBuffer());
        if (!fs.existsSync(WATERMARK_PATH)) return { url:urlImagen, procesada:false };
        const meta = await sharp(bufOrig).metadata();
        const w = meta.width||800, h = meta.height||500;
        const wmAncho = Math.min(Math.round(w*0.28), 300);
        const wmResized = await sharp(WATERMARK_PATH).resize(wmAncho, null, {fit:'inside'}).toBuffer();
        const wmMeta = await sharp(wmResized).metadata();
        const wmAlto = wmMeta.height||60;
        const margen = Math.round(w*0.02);
        const bufFinal = await sharp(bufOrig).composite([{input:wmResized,left:Math.max(0,w-wmAncho-margen),top:Math.max(0,h-wmAlto-margen),blend:'over'}]).jpeg({quality:88}).toBuffer();
        const nombre = `efd-${Date.now()}-${Math.random().toString(36).substring(2,8)}.jpg`;
        fs.writeFileSync(path.join('/tmp', nombre), bufFinal);
        return { url:urlImagen, nombre, procesada:true };
    } catch(err) { console.warn(`⚠️ Watermark falló: ${err.message}`); return { url:urlImagen, procesada:false }; }
}

async function aplicarMarcaDeAguaBuffer(bufOrig) {
    if (!WATERMARK_PATH || !fs.existsSync(WATERMARK_PATH)) return null;
    try {
        const meta = await sharp(bufOrig).metadata();
        const w = meta.width||800, h = meta.height||500;
        const wmAncho = Math.min(Math.round(w*0.28), 300);
        const wmResized = await sharp(WATERMARK_PATH).resize(wmAncho, null, {fit:'inside'}).toBuffer();
        const wmMeta = await sharp(wmResized).metadata();
        const wmAlto = wmMeta.height||60;
        const margen = Math.round(w*0.02);
        const bufFinal = await sharp(bufOrig).composite([{input:wmResized,left:Math.max(0,w-wmAncho-margen),top:Math.max(0,h-wmAlto-margen),blend:'over'}]).jpeg({quality:88}).toBuffer();
        const nombre = `efd-manual-${Date.now()}-${Math.random().toString(36).substring(2,8)}.jpg`;
        fs.writeFileSync(path.join('/tmp', nombre), bufFinal);
        return nombre;
    } catch(err) { return null; }
}

app.get('/img/:nombre', async (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) { res.setHeader('Content-Type','image/jpeg'); res.setHeader('Cache-Control','public,max-age=604800'); return res.sendFile(ruta); }
    try {
        const r = await pool.query('SELECT imagen_original FROM noticias WHERE imagen_nombre=$1 LIMIT 1', [req.params.nombre]);
        if (r.rows.length && r.rows[0].imagen_original) return res.redirect(302, r.rows[0].imagen_original);
    } catch(e) {}
    res.status(404).send('Imagen no disponible');
});

// ══════════════════════════════════════════════════════════
// CONFIG IA
// ══════════════════════════════════════════════════════════
const CONFIG_IA_DEFAULT = {
    enabled: true,
    instruccion_principal: 'Eres un periodista dominicano del barrio, directo y sin rodeos. Escribes para el lector de Los Mina, Invivienda, Charles de Gaulle y todo Santo Domingo Este. Párrafos cortos. Lenguaje real de la calle. Cero relleno.',
    tono: 'directo-barrio', extension: 'media',
    enfasis: 'Prioriza Santo Domingo Este: Los Mina, Invivienda, Ensanche Ozama, Sabana Perdida, Villa Mella, Charles de Gaulle. Conecta todo con el lector de SDE.',
    evitar: 'Párrafos largos. Lenguaje técnico. Especulación. Repetir noticias publicadas. Copiar Wikipedia.'
};
let CONFIG_IA = {...CONFIG_IA_DEFAULT};

async function cargarConfigIA() {
    try {
        const r = await pool.query("SELECT valor FROM memoria_ia WHERE tipo='config_ia' ORDER BY ultima_vez DESC LIMIT 1");
        if (r.rows.length) CONFIG_IA = {...CONFIG_IA_DEFAULT,...JSON.parse(r.rows[0].valor)};
        else CONFIG_IA = {...CONFIG_IA_DEFAULT};
    } catch(e) { CONFIG_IA = {...CONFIG_IA_DEFAULT}; }
    return CONFIG_IA;
}

async function guardarConfigIA(cfg) {
    try {
        const valor = JSON.stringify(cfg);
        await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('config_ia',$1,'sistema',1,0) ON CONFLICT DO NOTHING",[valor]);
        await pool.query("UPDATE memoria_ia SET valor=$1,ultima_vez=NOW() WHERE tipo='config_ia' AND categoria='sistema'",[valor]);
        return true;
    } catch(e) { return false; }
}

// ══════════════════════════════════════════════════════════
// 🤖 GEMINI — MOTOR PRINCIPAL
// ══════════════════════════════════════════════════════════
const GEMINI_STATE = {};
function getKeyState(k) {
    if (!GEMINI_STATE[k]) GEMINI_STATE[k] = { lastRequest:0, resetTime:0 };
    return GEMINI_STATE[k];
}

async function _callGemini(apiKey, prompt, intentoGlobal) {
    const st = getKeyState(apiKey);
    const ahora = Date.now();
    if (ahora < st.resetTime) await new Promise(r => setTimeout(r, st.resetTime - ahora));
    const desde = Date.now() - st.lastRequest;
    if (desde < 8000) await new Promise(r => setTimeout(r, 8000 - desde));
    st.lastRequest = Date.now();
    let res;
    try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.85, maxOutputTokens: 3000 } }),
            signal: AbortSignal.timeout(45000)
        });
    } catch(fetchErr) { throw new Error(`RED: ${fetchErr.message}`); }
    if (res.status === 429) { const espera = Math.min(60000 + Math.pow(2, intentoGlobal) * 10000, 300000); st.resetTime = Date.now() + espera; throw new Error('RATE_LIMIT_429'); }
    if (res.status === 503 || res.status === 502) { await new Promise(r => setTimeout(r, 15000)); throw new Error(`HTTP_${res.status}`); }
    if (!res.ok) { await res.text().catch(()=>''); throw new Error(`HTTP ${res.status}`); }
    const data = await res.json();
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const razon = data.candidates?.[0]?.finishReason;
    if (razon === 'SAFETY' || razon === 'RECITATION') throw new Error(`GEMINI_BLOCKED_${razon}`);
    if (!texto) throw new Error('Respuesta vacía');
    return texto;
}

async function llamarGemini(prompt, reintentos = 2) {
    if (!LLAVES_TEXTO.length) throw new Error('Sin llaves de texto configuradas');
    let intentoGlobal = 0;
    for (let i = 0; i < reintentos; i++) {
        for (const llave of LLAVES_TEXTO) {
            try { return await _callGemini(llave, prompt, intentoGlobal++); }
            catch(err) { if (err.message === 'RATE_LIMIT_429') continue; console.error(`    ❌ Gemini: ${err.message}`); }
        }
        if (i < reintentos - 1) await new Promise(r => setTimeout(r, (i + 1) * 15000));
    }
    throw new Error('Gemini: todas las llaves fallaron');
}

async function llamarGeminiImagen(prompt, reintentos = 1) {
    const llaves = LLAVES_IMAGEN.length ? LLAVES_IMAGEN : LLAVES_TEXTO;
    let intentoGlobal = 0;
    for (let i = 0; i < reintentos; i++) {
        for (const llave of llaves) {
            try { return await _callGemini(llave, prompt, intentoGlobal++); }
            catch(err) { if (err.message === 'RATE_LIMIT_429') return null; }
        }
    }
    return null;
}

// ══════════════════════════════════════════════════════════
// 🤖 DEEPSEEK — FALLBACK AUTOMÁTICO
// ══════════════════════════════════════════════════════════
async function llamarDeepSeek(prompt, reintentos = 2) {
    if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY no configurada');
    for (let i = 0; i < reintentos; i++) {
        try {
            const res = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 3000,
                    temperature: 0.85
                }),
                signal: AbortSignal.timeout(45000)
            });
            if (!res.ok) {
                const txt = await res.text().catch(()=>'');
                throw new Error(`HTTP ${res.status}: ${txt.substring(0,100)}`);
            }
            const data = await res.json();
            const texto = data.choices?.[0]?.message?.content;
            if (!texto) throw new Error('DeepSeek: respuesta vacía');
            console.log('    🤖 DeepSeek respondió OK');
            return texto;
        } catch(err) {
            console.error(`    ❌ DeepSeek intento ${i+1}: ${err.message}`);
            if (i < reintentos - 1) await new Promise(r => setTimeout(r, 5000));
        }
    }
    throw new Error('DeepSeek: todos los intentos fallaron');
}

// ── FUNCIÓN UNIFICADA: Gemini → DeepSeek automático ──────
async function llamarIA(prompt) {
    try {
        return await llamarGemini(prompt);
    } catch(geminiErr) {
        console.warn(`⚠️  Gemini falló (${geminiErr.message}). Activando DeepSeek fallback...`);
        if (!DEEPSEEK_API_KEY) throw new Error(`Gemini falló y DeepSeek no está configurado: ${geminiErr.message}`);
        return await llamarDeepSeek(prompt);
    }
}

// ── Imagen con fallback ───────────────────────────────────
async function llamarIAImagen(prompt) {
    let respuesta = await llamarGeminiImagen(prompt);
    if (!respuesta && DEEPSEEK_API_KEY) {
        try { respuesta = await llamarDeepSeek(prompt, 1); } catch(e) {}
    }
    return respuesta;
}

// ══════════════════════════════════════════════════════════
// 🖼️ GOOGLE CUSTOM SEARCH — MOTOR MXL
// ══════════════════════════════════════════════════════════
const CSE_EXCLUDES = [
    '-site:shutterstock.com','-site:gettyimages.com','-site:adobe.com',
    '-site:dreamstime.com','-site:alamy.com','-site:123rf.com',
    '-site:istockphoto.com','-site:vectorstock.com',
].join(' ');

const URL_PALABRAS_INVALIDAS = ['shutterstock','getty','stock','preview','watermark','wm_','logo_','thumbnail','_thumb','small_','_sm.','lowres','dreamstime','alamy','depositphotos'];
const BARRIOS_SDE = ['Los Mina','Invivienda','Charles de Gaulle','Ensanche Ozama','Sabana Perdida','Villa Mella','El Almirante','Los Trinitarios','El Tamarindo','Mendoza'];

const CSE_STATE = {};
function getCseState(k) {
    if (!CSE_STATE[k]) CSE_STATE[k] = { fallos:0, bloqueadaHasta:0 };
    return CSE_STATE[k];
}

function urlImagenValida(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (!/(\.jpg|\.jpeg|\.png)(\?|$|#)/i.test(u) && !u.endsWith('.jpg') && !u.endsWith('.jpeg') && !u.endsWith('.png')) return false;
    if (URL_PALABRAS_INVALIDAS.some(p => u.includes(p))) return false;
    return true;
}

async function verificarResolucion(url) {
    try {
        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(url, { method:'GET', signal:ctrl.signal }).finally(() => clearTimeout(tm));
        if (!res.ok) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 20000) return false;
        const meta = await sharp(buf).metadata();
        return (meta.width||0) >= 1024;
    } catch { return false; }
}

async function buscarImagenCSE(query, barrio = '') {
    if (!GOOGLE_CSE_KEYS.length || !GOOGLE_CSE_CX) return null;
    const hora = new Date().getHours();
    const llaves = hora % 2 === 0
        ? [GOOGLE_CSE_KEYS[0], GOOGLE_CSE_KEYS[1]].filter(Boolean)
        : [GOOGLE_CSE_KEYS[1], GOOGLE_CSE_KEYS[0]].filter(Boolean);
    const barrioStr = barrio ? ` ${barrio}` : '';
    const qFull = `${query}${barrioStr} Santo Domingo Este ${CSE_EXCLUDES}`.trim();
    for (const llave of llaves) {
        const st = getCseState(llave);
        if (Date.now() < st.bloqueadaHasta) continue;
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${llave}&cx=${GOOGLE_CSE_CX}&q=${encodeURIComponent(qFull)}&searchType=image&imgType=photo&imgSize=large&fileType=jpg,png&num=10&safe=active`;
            const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 8000);
            const res = await fetch(url, { signal:ctrl.signal }).finally(() => clearTimeout(tm));
            if (res.status === 429 || res.status === 403) { st.fallos++; st.bloqueadaHasta = Date.now() + (st.fallos >= 3 ? 3600000 : 300000); continue; }
            if (!res.ok) continue;
            const data = await res.json();
            const items = data.items || [];
            for (const item of items) {
                if (!urlImagenValida(item.link)) continue;
                if (await verificarResolucion(item.link)) { st.fallos = 0; return item.link; }
            }
        } catch(err) { st.fallos++; }
    }
    return null;
}

function generarQueryCSE(titulo, categoria) {
    const tLow = titulo.toLowerCase();
    const barrioDetectado = BARRIOS_SDE.find(b => tLow.includes(b.toLowerCase())) || '';
    const queryBase = { 'Nacionales':'noticias comunidad vecinos','Deportes':'deporte atletas cancha','Internacionales':'noticias mundo caribe','Economía':'negocio comercio mercado','Tecnología':'tecnología innovación digital','Espectáculos':'entretenimiento arte cultura' }[categoria] || 'noticias barrio';
    const stopwords = new Set(['el','la','los','las','un','una','de','del','en','y','a','se','que','por','con','su','sus','al','es','son','fue','han','ha','le','les','lo','más','para','sobre','como','entre','pero','sin','ya','no','si','o','e','ni']);
    const palabrasClave = titulo.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w)).slice(0, 3).join(' ');
    return { query: `${palabrasClave} ${queryBase}`.trim(), barrio: barrioDetectado };
}

// ══════════════════════════════════════════════════════════
// IMÁGENES — PEXELS, UNSPLASH, WIKIPEDIA
// ══════════════════════════════════════════════════════════
const MAPEO_IMAGENES = {
    'donald trump':['trump president podium microphone','american president speech flag'],
    'trump':['trump president podium microphone'],
    'abinader':['latin american president ceremony','dominican republic president podium'],
    'luis abinader':['latin american president ceremony'],
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
const FALLBACK_CAT = { 'Nacionales':'politica-gobierno','Deportes':'deporte-general','Internacionales':'relaciones-internacionales','Economía':'economia-mercado','Tecnología':'tecnologia','Espectáculos':'cultura-musica' };
function imgLocal(sub, cat) {
    const banco = BANCO_LOCAL[sub]||BANCO_LOCAL[FALLBACK_CAT[cat]]||BANCO_LOCAL['politica-gobierno'];
    return banco[Math.floor(Math.random()*banco.length)];
}

function queryEsPeriodistica(query) {
    const basura = ['wedding','bride','groom','romantic','love','kiss','cartoon','3d render','pet','dog','cat','birthday'];
    return !basura.some(p => (query||'').toLowerCase().includes(p));
}

async function buscarEnPexels(queries) {
    if (!PEXELS_API_KEY) return null;
    const lista = (Array.isArray(queries)?queries:[queries]).filter(q => queryEsPeriodistica(q));
    for (const query of lista) {
        try {
            const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),5000);
            const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`, { headers:{Authorization:PEXELS_API_KEY}, signal:ctrl.signal }).finally(()=>clearTimeout(tm));
            if (!res.ok) continue;
            const data = await res.json();
            if (!data.photos?.length) continue;
            const foto = data.photos[Math.floor(Math.random()*Math.min(5,data.photos.length))];
            return foto.src.large2x||foto.src.large;
        } catch { continue; }
    }
    return null;
}

async function buscarEnUnsplash(query) {
    if (!UNSPLASH_ACCESS_KEY || !queryEsPeriodistica(query)) return null;
    try {
        const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),7000);
        const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query+' caribbean dominican')}&per_page=5&orientation=landscape`, { headers:{Authorization:`Client-ID ${UNSPLASH_ACCESS_KEY}`}, signal:ctrl.signal }).finally(()=>clearTimeout(tm));
        if (!res.ok) return null;
        const data = await res.json();
        const fotos = (data.results||[]).filter(f => (f.width||0) >= 1080);
        if (!fotos.length) return null;
        return fotos[0].urls?.full || fotos[0].urls?.regular;
    } catch { return null; }
}

async function buscarImagenWikipedia(titulo) {
    try {
        const res = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`);
        const data = await res.json();
        const pageTitle = data.query?.search?.[0]?.title;
        if (!pageTitle) return null;
        const resImg = await fetch(`https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=800&origin=*`);
        const dataImg = await resImg.json();
        const pages = dataImg.query?.pages;
        const pid = Object.keys(pages||{})[0];
        return pages?.[pid]?.thumbnail?.source || null;
    } catch { return null; }
}

function esImagenValida(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (!/(\.jpg|\.jpeg|\.png|\.webp)/i.test(u)) return false;
    return !['flag','logo','map','seal','icon','20px','30px','40px'].some(i => u.includes(i));
}

async function obtenerImagenInteligente(titulo, categoria, subtema, queryIA) {
    const tituloLower = titulo.toLowerCase();
    if (GOOGLE_CSE_KEYS.length && GOOGLE_CSE_CX) {
        try {
            const { query: qCSE, barrio } = generarQueryCSE(titulo, categoria);
            const urlCSE = await buscarImagenCSE(queryIA || qCSE, barrio);
            if (urlCSE) return urlCSE;
        } catch(e) {}
    }
    if (queryIA) {
        const urlUnsplash = await buscarEnUnsplash(queryIA);
        if (urlUnsplash) return urlUnsplash;
    }
    for (const [clave, queries] of Object.entries(MAPEO_IMAGENES)) {
        if (tituloLower.includes(clave)) {
            const urlPexels = await buscarEnPexels(queries);
            if (urlPexels) return urlPexels;
            break;
        }
    }
    if (queryIA) {
        const urlPexels = await buscarEnPexels([queryIA]);
        if (urlPexels) return urlPexels;
    }
    const urlWiki = await buscarImagenWikipedia(titulo);
    if (urlWiki && esImagenValida(urlWiki)) return urlWiki;
    return imgLocal(subtema, categoria);
}

function generarAltSEO(titulo, categoria, altIA, subtema) {
    if (altIA && altIA.length > 15) return `${altIA} - El Farol al Día`;
    const base = { 'Nacionales':`Noticia nacional ${titulo.substring(0,40)} - Santo Domingo Este`,'Deportes':`Deportes dominicanos ${titulo.substring(0,40)}`,'Internacionales':`Noticias internacionales ${titulo.substring(0,30)}`,'Economía':`Economía dominicana ${titulo.substring(0,35)}`,'Tecnología':`Tecnología ${titulo.substring(0,35)}`,'Espectáculos':`Espectáculos dominicanos ${titulo.substring(0,35)}` };
    return (base[categoria]||`${titulo.substring(0,50)}`)+' - El Farol al Día';
}

const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function metaTagsCompletos(n, url) {
    const t=esc(n.titulo),d=esc(n.seo_description||''),img=esc(n.imagen),sec=esc(n.seccion);
    const fi=new Date(n.fecha).toISOString(),ue=esc(url);
    const wc=(n.contenido||'').split(/\s+/).filter(w=>w).length;
    const schema={"@context":"https://schema.org","@type":"NewsArticle","mainEntityOfPage":{"@type":"WebPage","@id":url},"headline":n.titulo,"description":n.seo_description||'',"image":{"@type":"ImageObject","url":n.imagen},"datePublished":fi,"dateModified":fi,"author":{"@type":"Person","name":"El Farol al Día"},"publisher":{"@type":"NewsMediaOrganization","name":"El Farol al Día","url":BASE_URL},"articleSection":n.seccion,"wordCount":wc,"inLanguage":"es-DO"};
    const tituloSEO=`${t} | El Farol al Día`;
    return `<title>${tituloSEO}</title>
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
    {nombre:'José Miguel Fernández',esp:'Tecnología'},{nombre:'Patricia Jiménez',esp:'Espectáculos'}
];
function redactor(cat) {
    const match = REDACTORES.filter(r => r.esp === cat);
    return match.length ? match[Math.floor(Math.random()*match.length)].nombre : 'Redacción EFD';
}

// ══════════════════════════════════════════════════════════
// INICIALIZAR BD
// ══════════════════════════════════════════════════════════
async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query('CREATE TABLE IF NOT EXISTS noticias(id SERIAL PRIMARY KEY,titulo VARCHAR(255) NOT NULL,slug VARCHAR(255) UNIQUE,seccion VARCHAR(100),contenido TEXT,seo_description VARCHAR(160),seo_keywords VARCHAR(255),redactor VARCHAR(100),imagen TEXT,imagen_alt VARCHAR(255),imagen_caption TEXT,imagen_nombre VARCHAR(100),imagen_fuente VARCHAR(50),vistas INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,estado VARCHAR(50) DEFAULT \'publicada\')');
        for (const col of ['imagen_alt','imagen_caption','imagen_nombre','imagen_fuente','imagen_original']) {
            await client.query(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}') THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT; END IF; END$$;`).catch(()=>{});
        }
        await client.query('CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        await client.query('CREATE TABLE IF NOT EXISTS memoria_ia(id SERIAL PRIMARY KEY,tipo VARCHAR(50) NOT NULL,valor TEXT NOT NULL,categoria VARCHAR(100),exitos INTEGER DEFAULT 0,fallos INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_memoria_tipo ON memoria_ia(tipo, categoria)').catch(()=>{});
        await client.query('CREATE TABLE IF NOT EXISTS comentarios(id SERIAL PRIMARY KEY,noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,nombre VARCHAR(80) NOT NULL,texto TEXT NOT NULL,aprobado BOOLEAN DEFAULT true,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_comentarios_noticia ON comentarios(noticia_id, aprobado, fecha DESC)').catch(()=>{});
        await client.query('CREATE TABLE IF NOT EXISTS publicidad(id SERIAL PRIMARY KEY,nombre_espacio VARCHAR(100) NOT NULL,url_afiliado TEXT DEFAULT \'\',imagen_url TEXT DEFAULT \'\',ubicacion VARCHAR(50) DEFAULT \'top\',activo BOOLEAN DEFAULT true,ancho_px INTEGER DEFAULT 0,alto_px INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        const countPub = await client.query('SELECT COUNT(*) FROM publicidad');
        if (parseInt(countPub.rows[0].count) === 0) {
            await client.query("INSERT INTO publicidad(nombre_espacio,url_afiliado,imagen_url,ubicacion,activo) VALUES('Banner Principal Top','','','top',false),('Banner Sidebar Derecha','','','sidebar',false),('Banner Entre Noticias','','','medio',false),('Banner Footer','','','footer',false)");
        }
        console.log('✅ BD lista');
    } catch(e) { console.error('❌ BD:', e.message); }
    finally { client.release(); }
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// MEMORIA IA
// ══════════════════════════════════════════════════════════
async function construirMemoria(categoria, limiteTitulos = 25) {
    let memoria = '';
    try {
        const recientes = await pool.query(
            'SELECT titulo, seccion, fecha FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT $2',
            ['publicada', parseInt(limiteTitulos)]
        );
        if (recientes.rows && recientes.rows.length > 0) {
            memoria += '\n⛔ TEMAS YA PUBLICADOS RECIENTEMENTE — PROHIBIDO REPETIR:\n';
            memoria += recientes.rows.map((x,i) => `${i+1}. ${x.titulo} [${x.seccion}]`).join('\n');
            memoria += '\n⚠️ NO escribir sobre estos temas. Busca un ÁNGULO DIFERENTE o tema NUEVO.\n';
        }
        const errores = await pool.query(
            "SELECT valor FROM memoria_ia WHERE tipo='error' AND categoria=$1 AND ultima_vez > NOW() - INTERVAL '24 hours' ORDER BY fallos DESC LIMIT 5",
            [categoria]
        );
        if (errores.rows.length) {
            memoria += '\n⚠️ ERRORES RECIENTES A EVITAR:\n';
            memoria += errores.rows.map(e => `- ${e.valor}`).join('\n') + '\n';
        }
    } catch(e) { console.warn('⚠️ construirMemoria:', e.message); }
    return memoria;
}

async function buscarContextoActualSDE(categoria, tema = '') {
    if (!GOOGLE_CSE_KEYS.length || !GOOGLE_CSE_CX) return '';
    const queries = {
        'Nacionales':['noticias Santo Domingo Este hoy','actualidad República Dominicana 2026'],
        'Deportes':['deportes República Dominicana hoy','béisbol dominicano noticias'],
        'Internacionales':['noticias internacionales impacto RD','Caribe noticias hoy'],
        'Economía':['economía República Dominicana 2026','negocios Santo Domingo'],
        'Tecnología':['tecnología República Dominicana','innovación digital RD'],
        'Espectáculos':['farándula dominicana hoy','música urbana RD']
    };
    const queryList = queries[categoria] || queries['Nacionales'];
    const queryFinal = tema ? `${tema} ${queryList[0]}` : queryList[0];
    try {
        const llave = GOOGLE_CSE_KEYS.length > 1 ? (new Date().getHours() % 2 === 0 ? GOOGLE_CSE_KEYS[0] : GOOGLE_CSE_KEYS[1]) : GOOGLE_CSE_KEYS[0];
        const url = `https://www.googleapis.com/customsearch/v1?key=${llave}&cx=${GOOGLE_CSE_CX}&q=${encodeURIComponent(queryFinal)}&num=3`;
        const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),6000);
        const res = await fetch(url, {signal:ctrl.signal}).finally(()=>clearTimeout(tm));
        if (!res.ok) return '';
        const data = await res.json();
        const items = data.items||[];
        if (!items.length) return '';
        let contexto = '\n📰 CONTEXTO ACTUAL DE SANTO DOMINGO ESTE:\n';
        for (const item of items.slice(0,2)) {
            contexto += `- ${item.title}\n  ${(item.snippet||'').substring(0,200)}\n`;
        }
        contexto += '\n⚠️ USA COMO REFERENCIA — NO COPIES TEXTUAL.\n';
        return contexto;
    } catch { return ''; }
}

// ══════════════════════════════════════════════════════════
// ✅ VALIDADOR DE CONTENIDO
// ══════════════════════════════════════════════════════════
function validarContenido(contenido, titulo, categoria) {
    if (contenido.length < 600) return { valido:false, razon:`Solo ${contenido.length} chars (mínimo 600)`, sugerencia:'Agrega más detalles: nombres de calles, testimonios, datos.' };
    const barriosSDE = ['Los Mina','Invivienda','Charles de Gaulle','Ensanche Ozama','Sabana Perdida','Villa Mella','El Almirante','Mendoza','Los Trinitarios','San Isidro'];
    const barriosMencionados = barriosSDE.filter(b => contenido.toLowerCase().includes(b.toLowerCase()));
    if (barriosMencionados.length === 0) return { valido:false, razon:'No menciona barrio de SDE', sugerencia:`Menciona al menos uno: ${barriosSDE.slice(0,5).join(', ')}` };
    const parrafos = contenido.split(/\n\s*\n/).filter(p => p.trim().length > 20);
    if (parrafos.length < 4) return { valido:false, razon:`Solo ${parrafos.length} párrafos (mínimo 4)`, sugerencia:'Divide en más párrafos cortos.' };
    const frasesClave = ['se supo','fue confirmado','según fuentes','la gente del sector','vecinos dicen','en el barrio','en la calle'];
    if (!frasesClave.some(f => contenido.toLowerCase().includes(f))) return { valido:false, razon:'Falta lenguaje de barrio', sugerencia:`Usa: "${frasesClave.join('", "')}"` };
    return { valido:true, longitud:contenido.length, palabras:contenido.split(/\s+/).length, barrios:barriosMencionados, parrafos:parrafos.length };
}

async function registrarError(tipo, descripcion, categoria) {
    try {
        await pool.query('INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES(\'error\',$1,$2,1) ON CONFLICT DO NOTHING',[descripcion.substring(0,200),categoria]);
        await pool.query('UPDATE memoria_ia SET fallos=fallos+1,ultima_vez=NOW() WHERE tipo=\'error\' AND valor=$1',[descripcion.substring(0,200)]);
    } catch(e) {}
}

// ══════════════════════════════════════════════════════════
// 📰 GENERAR NOTICIA — V36.0 (Gemini → DeepSeek automático)
// ══════════════════════════════════════════════════════════
async function generarNoticia(categoria, comunicadoExterno = null, reintento = 1) {
    const MAX_REINTENTOS = 3;
    const CATS_ALTO_CPM = ['Economía','Tecnología','Internacionales'];

    try {
        if (!CONFIG_IA.enabled) return { success:false, error:'IA desactivada' };
        console.log(`\n📰 [V36.0] Generando noticia — Intento ${reintento}/${MAX_REINTENTOS}`);

        const memoria        = await construirMemoria(categoria, 25);
        const contextoActual = await buscarContextoActualSDE(categoria);
        const temaParaWiki   = comunicadoExterno ? (comunicadoExterno.split('\n')[0]||'').replace(/^T[IÍ]TULO:\s*/i,'').trim()||categoria : categoria;
        const contextoWiki   = await buscarContextoWikipedia(temaParaWiki, categoria);
        const estrategia     = leerEstrategia();
        const esCategoriaAlta = CATS_ALTO_CPM.includes(categoria);

        const fuenteContenido = comunicadoExterno
            ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado.`
            : `\nEscribe una noticia NUEVA sobre la categoría "${categoria}" para República Dominicana, con enfoque en Santo Domingo Este. Hecho REAL y RELEVANTE (año 2026).`;

        const promptTexto = `${CONFIG_IA.instruccion_principal}

ROL: Redactor jefe de El Farol al Día. Voz del barrio de SDE.
MARCO TEMPORAL: Hoy es ABRIL 2026.

🎯 REQUISITOS OBLIGATORIOS:
1. MÍNIMO 600 CARACTERES (5-6 párrafos)
2. Menciona al menos UN barrio de SDE: Los Mina, Invivienda, Charles de Gaulle, Ensanche Ozama, Sabana Perdida, Villa Mella, El Almirante.
3. Usa lenguaje dominicano real: "se supo", "fue confirmado", "según fuentes del sector", "la gente del barrio dice".
4. Cada párrafo: máximo 3 líneas. El lector usa celular.
5. Primera oración = gancho directo. NADA de "En el día de hoy..."

${memoria}
${contextoActual}
${contextoWiki}
${fuenteContenido}

CATEGORÍA: ${categoria}
EXTENSIÓN: ${esCategoriaAlta ? '550-650' : '450-550'} palabras, mínimo 5 párrafos
EVITAR: ${CONFIG_IA.evitar}
ÉNFASIS: ${CONFIG_IA.enfasis}

${estrategia}

RESPONDE EXACTAMENTE (sin texto extra):
TITULO: [60-70 chars, impactante, menciona SDE o barrio si aplica]
DESCRIPCION: [150-160 chars, atrapante]
PALABRAS: [5 keywords separadas por comas]
SUBTEMA_LOCAL: [politica-gobierno|seguridad-policia|economia-mercado|deporte-beisbol|deporte-futbol|deporte-general|tecnologia|educacion|cultura-musica|salud-medicina|infraestructura|vivienda-social|transporte-vial|medio-ambiente|turismo|emergencia|relaciones-internacionales]
CONTENIDO:
[párrafos cortos separados por línea en blanco — MÍNIMO 600 CARACTERES]`;

        // 🤖 llamarIA usa Gemini primero, DeepSeek si falla
        console.log('   📝 Enviando a IA (Gemini → DeepSeek si falla)...');
        const textoIA = await llamarIA(promptTexto);
        const textoLimpio = textoIA.replace(/^\s*[*#]+\s*/gm, '');

        let titulo = '', desc = '', pals = '', sub = '', contenido = '';
        let enContenido = false;
        const bloques = [];
        for (const linea of textoLimpio.split('\n')) {
            const t = linea.trim();
            if (t.startsWith('TITULO:'))         titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:')) desc = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:'))    pals = t.replace('PALABRAS:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:'))   enContenido = true;
            else if (enContenido && t.length > 0)  bloques.push(t);
        }
        contenido = bloques.join('\n\n');
        titulo = titulo.replace(/[*_#`"]/g, '').trim();
        desc   = desc.replace(/[*_#`]/g, '').trim();

        if (!titulo) throw new Error('IA no devolvió TITULO');

        const validacion = validarContenido(contenido, titulo, categoria);
        if (!validacion.valido) {
            console.log(`   ⚠️ Validación: ${validacion.razon}`);
            if (reintento < MAX_REINTENTOS) {
                await new Promise(r => setTimeout(r, 3000));
                return await generarNoticia(categoria, comunicadoExterno, reintento + 1);
            }
            throw new Error(`Validación fallida tras ${MAX_REINTENTOS} intentos: ${validacion.razon}`);
        }

        console.log(`   ✅ OK: ${validacion.longitud} chars, barrios: ${validacion.barrios.join(', ')}`);

        let qi = '', ai = '';
        const promptImagen = `Asistente de imagen para periódico dominicano.
Titular: "${titulo}" | Categoría: ${categoria}
RESPONDE SOLO:
QUERY_IMAGEN: [3-5 palabras inglés, escena periodística real]
ALT_IMAGEN: [15-20 palabras español SEO + Santo Domingo Este]
PROHIBIDO: wedding, couple, flowers, cartoon, pet`;
        const respuestaImagen = await llamarIAImagen(promptImagen);
        if (respuestaImagen) {
            for (const linea of respuestaImagen.split('\n')) {
                if (linea.trim().startsWith('QUERY_IMAGEN:')) qi = linea.trim().replace('QUERY_IMAGEN:', '').trim();
                if (linea.trim().startsWith('ALT_IMAGEN:'))   ai = linea.trim().replace('ALT_IMAGEN:', '').trim();
            }
        }

        const urlOrig   = await obtenerImagenInteligente(titulo, categoria, sub, qi);
        const imgResult = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal  = imgResult.procesada ? `${BASE_URL}/img/${imgResult.nombre}` : urlOrig;
        const altFinal  = generarAltSEO(titulo, categoria, ai, sub);

        const slugBase = slugify(titulo);
        if (!slugBase || slugBase.length < 3) throw new Error('Slug inválido');
        let slFin = slugBase;
        const existeSlug = await pool.query('SELECT id FROM noticias WHERE slug=$1', [slugBase]);
        if (existeSlug.rows.length) slFin = `${slugBase.substring(0,68)}-${Date.now().toString().slice(-6)}`;

        await pool.query(
            'INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [titulo.substring(0,255), slFin, categoria, contenido.substring(0,10000), desc.substring(0,160), (pals||categoria).substring(0,255), redactor(categoria), urlFinal, altFinal.substring(0,255), `Fotografía: ${titulo}`, imgResult.nombre||'efd.jpg', imgResult.procesada?'cse-watermark':'cse', urlOrig, 'publicada']
        );

        console.log(`\n✅ /noticia/${slFin}`);
        invalidarCache();

        // Notificaciones: VAPID + OneSignal
        await notificarNuevaNoticia(titulo, desc.substring(0,160), slFin, urlFinal);

        Promise.allSettled([
            publicarEnFacebook(titulo, slFin, urlFinal, desc),
            publicarEnTwitter(titulo, slFin, desc),
            publicarEnTelegram(titulo, slFin, urlFinal, desc, categoria)
        ]);

        return { success:true, slug:slFin, titulo, alt:altFinal, mensaje:'✅ Publicada', stats:validacion };

    } catch(error) {
        console.error(`❌ Error intento ${reintento}:`, error.message);
        if (reintento < MAX_REINTENTOS) {
            await new Promise(r => setTimeout(r, 5000));
            return await generarNoticia(categoria, comunicadoExterno, reintento + 1);
        }
        await registrarError('generacion', error.message, categoria);
        return { success:false, error:error.message };
    }
}

// ══════════════════════════════════════════════════════════
// FUENTES RSS
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
    let procesadas = 0;
    for (const fuente of FUENTES_RSS) {
        try {
            const feed = await rssParser.parseURL(fuente.url).catch(()=>null);
            if (!feed?.items?.length) continue;
            for (const item of feed.items.slice(0,3)) {
                const guid = item.guid||item.link||item.title;
                if (!guid) continue;
                const yaExiste = await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1',[guid.substring(0,500)]);
                if (yaExiste.rows.length) continue;
                const comunicado = [item.title?`TÍTULO: ${item.title}`:'',item.contentSnippet?`RESUMEN: ${item.contentSnippet}`:'',`FUENTE OFICIAL: ${fuente.nombre}`].filter(Boolean).join('\n');
                const resultado = await generarNoticia(fuente.categoria, comunicado);
                if (resultado.success) {
                    await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',[guid.substring(0,500),fuente.nombre]);
                    procesadas++;
                    await new Promise(r => setTimeout(r, 8000));
                }
                break;
            }
        } catch(err) { console.warn(`   ⚠️ ${fuente.nombre}: ${err.message}`); }
    }
    console.log(`\n📡 RSS: ${procesadas} noticias procesadas`);
}

// ══════════════════════════════════════════════════════════
// CRON JOBS
// ══════════════════════════════════════════════════════════
const CATS = ['Nacionales','Deportes','Internacionales','Economía','Tecnología','Espectáculos'];
const ARRANQUE_TIME = Date.now();

cron.schedule('*/5 * * * *', async () => {
    try { await fetch(`http://localhost:${PORT}/health`); } catch(e) {}
});

cron.schedule('0 */2 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    if (Date.now() - ARRANQUE_TIME < 35*60*1000) return;
    const hora = new Date().getHours();
    await generarNoticia(CATS[Math.floor(hora/2) % CATS.length]);
});

cron.schedule('30 8,19 * * *', async () => { await procesarRSS(); });

cron.schedule('0 */6 * * *', async () => {
    console.log('📊 Cron estrategia: actualizando...');
    try { await analizarYGenerar(); } catch(err) { console.error('❌ Estrategia cron:', err.message); }
});

async function rafagaInicial() {
    if (!CONFIG_IA.enabled) return;
    for (let i = 1; i <= 2; i++) {
        if (i > 1) await new Promise(r => setTimeout(r, 30*60*1000));
        try { await generarNoticia(CATS[i-1]||CATS[0]); } catch(e) {}
    }
}

// ══════════════════════════════════════════════════════════
// CACHÉ
// ══════════════════════════════════════════════════════════
let _cacheNoticias = null, _cacheFecha = 0;
const CACHE_TTL = 60*1000;
function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

// ══════════════════════════════════════════════════════════
// RUTAS API
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => res.json({ status:'OK', version:'36.0-mxl+deepseek+onesignal+google-creds' }));

app.get('/api/noticias', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Cache-Control','public,max-age=60');
    try {
        if (_cacheNoticias && (Date.now()-_cacheFecha) < CACHE_TTL) return res.json({success:true,noticias:_cacheNoticias,cached:true});
        const r = await pool.query("SELECT id,titulo,slug,seccion,imagen,imagen_alt,seo_description,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30",['publicada']);
        _cacheNoticias = r.rows; _cacheFecha = Date.now();
        res.json({ success:true, noticias:r.rows });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const r = await pool.query("SELECT COUNT(*) as c, SUM(vistas) as v FROM noticias WHERE estado=$1",['publicada']);
        res.json({ success:true, totalNoticias:parseInt(r.rows[0].c), totalVistas:parseInt(r.rows[0].v)||0 });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/generar-noticia', authMiddleware, async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error:'Falta categoría' });
    const r = await generarNoticia(categoria);
    res.status(r.success?200:500).json(r);
});

app.post('/api/procesar-rss', authMiddleware, async (req, res) => {
    const { pin } = req.body;
    if (pin !== '311') return res.status(403).json({ error:'Acceso denegado' });
    procesarRSS();
    res.json({ success:true, mensaje:'RSS iniciado' });
});

app.post('/api/publicar', express.json(), async (req, res) => {
    const { pin, titulo, seccion, contenido, redactor:red, seo_description, seo_keywords, imagen, imagen_alt } = req.body;
    if (pin !== '311') return res.status(403).json({ success:false, error:'PIN' });
    if (!titulo||!seccion||!contenido) return res.status(400).json({ success:false, error:'Faltan campos' });
    try {
        const slugBase = slugify(titulo);
        const e = await pool.query('SELECT id FROM noticias WHERE slug=$1',[slugBase]);
        const slF = e.rows.length ? `${slugBase.substring(0,68)}-${Date.now().toString().slice(-6)}` : slugBase;
        let imgFinal = imagen || `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`;
        const altFinal = imagen_alt || `${titulo} - El Farol al Día`;
        let imgOriginal = imgFinal, imgNombre = 'manual.jpg', imgFuente = 'manual';
        try {
            if (imgFinal.startsWith('data:image')) {
                const matches = imgFinal.match(/^data:image\/(\w+);base64,(.+)$/s);
                if (matches) {
                    const bufOrig = Buffer.from(matches[2], 'base64');
                    const nombreWM = await aplicarMarcaDeAguaBuffer(bufOrig);
                    if (nombreWM) { imgOriginal='base64-upload'; imgFinal=`${BASE_URL}/img/${nombreWM}`; imgNombre=nombreWM; imgFuente='manual-watermark'; }
                }
            } else if (imgFinal.startsWith('http')) {
                imgOriginal = imgFinal;
                const resultado = await aplicarMarcaDeAgua(imgFinal);
                if (resultado.procesada && resultado.nombre) { imgFinal=`${BASE_URL}/img/${resultado.nombre}`; imgNombre=resultado.nombre; imgFuente='manual-watermark'; }
            }
        } catch(wmErr) { console.warn(`⚠️ Watermark manual: ${wmErr.message}`); }
        await pool.query(
            'INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [titulo,slF,seccion,contenido,seo_description||titulo.substring(0,155),seo_keywords||seccion,red||'Manual',imgFinal,altFinal,`Fotografía: ${titulo}`,imgNombre,imgFuente,imgOriginal,'publicada']
        );
        invalidarCache();
        await notificarNuevaNoticia(titulo, (seo_description||titulo).substring(0,160), slF, imgFinal);
        res.json({ success:true, slug:slF });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/eliminar/:id', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ success:false, error:'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success:false, error:'ID inválido' });
    try { await pool.query('DELETE FROM noticias WHERE id=$1',[id]); invalidarCache(); res.json({ success:true }); }
    catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/actualizar-imagen/:id', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ success:false, error:'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id||!req.body.imagen) return res.status(400).json({ success:false, error:'Faltan datos' });
    try { await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2',[req.body.imagen,id]); invalidarCache(); res.json({ success:true }); }
    catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/comentarios/:noticia_id', async (req, res) => {
    try {
        const r = await pool.query('SELECT id,nombre,texto,fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC',[req.params.noticia_id]);
        res.json({ success:true, comentarios:r.rows });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/comentarios/:noticia_id', async (req, res) => {
    const { nombre, texto } = req.body;
    const noticia_id = parseInt(req.params.noticia_id);
    if (isNaN(noticia_id)||noticia_id<=0) return res.status(400).json({ success:false, error:'ID inválido' });
    if (!nombre?.trim()||!texto?.trim()) return res.status(400).json({ success:false, error:'Nombre y comentario requeridos' });
    if (texto.trim().length < 3 || texto.trim().length > 1000) return res.status(400).json({ success:false, error:'Largo inválido' });
    try {
        const r = await pool.query('INSERT INTO comentarios(noticia_id,nombre,texto) VALUES($1,$2,$3) RETURNING id,nombre,texto,fecha',[noticia_id,nombre.trim().substring(0,80),texto.trim().substring(0,1000)]);
        res.json({ success:true, comentario:r.rows[0] });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/comentarios/eliminar/:id', authMiddleware, async (req, res) => {
    if (req.body.pin!=='311') return res.status(403).json({ error:'PIN incorrecto' });
    try { await pool.query('DELETE FROM comentarios WHERE id=$1',[parseInt(req.params.id)]); res.json({ success:true }); }
    catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/admin/comentarios', authMiddleware, async (req, res) => {
    if (req.query.pin!=='311') return res.status(403).json({ error:'PIN requerido' });
    try {
        const r = await pool.query('SELECT c.id,c.nombre,c.texto,c.fecha,n.titulo as noticia_titulo,n.slug as noticia_slug FROM comentarios c JOIN noticias n ON n.id=c.noticia_id ORDER BY c.fecha DESC LIMIT 50');
        res.json({ success:true, comentarios:r.rows });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/memoria', authMiddleware, async (req, res) => {
    if (req.query.pin!=='311') return res.status(403).json({ error:'PIN requerido' });
    try {
        const r = await pool.query('SELECT tipo,valor,categoria,exitos,fallos,ultima_vez FROM memoria_ia ORDER BY ultima_vez DESC LIMIT 50');
        res.json({ success:true, registros:r.rows });
    } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/admin/config', authMiddleware, (req, res) => {
    if (req.query.pin!=='311') return res.status(403).json({ error:'Acceso denegado' });
    res.json(CONFIG_IA);
});

app.post('/api/admin/config', authMiddleware, express.json(), async (req, res) => {
    const { pin, enabled, instruccion_principal, tono, extension, evitar, enfasis } = req.body;
    if (pin!=='311') return res.status(403).json({ error:'Acceso denegado' });
    if (enabled!==undefined) CONFIG_IA.enabled = enabled;
    if (instruccion_principal) CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono) CONFIG_IA.tono = tono;
    if (extension) CONFIG_IA.extension = extension;
    if (evitar) CONFIG_IA.evitar = evitar;
    if (enfasis) CONFIG_IA.enfasis = enfasis;
    const ok = await guardarConfigIA(CONFIG_IA);
    res.json({ success:ok });
});

app.get('/api/coach', async (req, res) => {
    try {
        const { dias=7 } = req.query;
        const noticias = await pool.query(`SELECT id,titulo,seccion,vistas,fecha FROM noticias WHERE estado='publicada' AND fecha>NOW()-INTERVAL '${parseInt(dias)} days' ORDER BY vistas DESC`);
        if (!noticias.rows.length) return res.json({ success:true, mensaje:'Sin noticias en el período' });
        const total = noticias.rows.reduce((s,n)=>s+(n.vistas||0),0);
        const promedio = Math.round(total/noticias.rows.length);
        const categorias = {};
        CATS.forEach(cat => {
            const rows = noticias.rows.filter(n=>n.seccion===cat);
            const vistas = rows.reduce((s,n)=>s+(n.vistas||0),0);
            const prom = rows.length ? Math.round(vistas/rows.length) : 0;
            categorias[cat] = { total:rows.length, vistas_promedio:prom, rendimiento:promedio?Math.round((prom/promedio)*100):0 };
        });
        res.json({ success:true, periodo:`${dias} días`, total_noticias:noticias.rows.length, total_vistas:total, promedio_general:promedio, categorias });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── PUSH NOTIFICATIONS (VAPID) ────────────────────────────
app.get('/api/push/vapid-key', (req, res) => {
    VAPID_PUBLIC_KEY ? res.json({ success:true, publicKey:VAPID_PUBLIC_KEY }) : res.json({ success:false });
});

app.post('/api/push/suscribir', express.json(), async (req, res) => {
    try {
        const { subscription, userAgent } = req.body;
        if (!subscription?.endpoint || !subscription?.keys) return res.status(400).json({ success:false, error:'Suscripción inválida' });
        await pool.query('INSERT INTO push_suscripciones(endpoint,auth_key,p256dh_key,user_agent) VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET auth_key=$2,p256dh_key=$3,user_agent=$4,fecha=CURRENT_TIMESTAMP',
            [subscription.endpoint, subscription.keys.auth, subscription.keys.p256dh, userAgent||null]);
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

app.post('/api/push/desuscribir', express.json(), async (req, res) => {
    try {
        if (req.body.endpoint) await pool.query('DELETE FROM push_suscripciones WHERE endpoint=$1',[req.body.endpoint]);
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

app.post('/api/push/test', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error:'PIN incorrecto' });
    const resultado = await notificarNuevaNoticia(req.body.titulo||'🧪 Prueba El Farol al Día', req.body.mensaje||'Notificación de prueba', 'test', null);
    res.json({ success:resultado });
});

// ── ONESGINAL CONFIG (frontend la usa) ───────────────────
app.get('/api/onesignal/config', (req, res) => {
    res.json({ appId: ONESIGNAL_APP_ID || null, enabled: !!ONESIGNAL_APP_ID });
});

// ── GOOGLE CREDENTIALS STATUS ────────────────────────────
app.get('/api/google/status', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error:'PIN requerido' });
    if (!GOOGLE_CREDENTIALS) return res.json({ activo:false, mensaje:'No configuradas' });
    try {
        const token = await obtenerGoogleAccessToken(['https://www.googleapis.com/auth/cloud-platform']);
        res.json({ activo:!!token, email:GOOGLE_CREDENTIALS.client_email, proyecto:GOOGLE_CREDENTIALS.project_id });
    } catch(e) { res.json({ activo:false, error:e.message }); }
});

// ── ESTRATEGIA ───────────────────────────────────────────
app.get('/api/estrategia', authMiddleware, (req, res) => {
    try {
        const ruta = path.join(__dirname, 'estrategia.json');
        if (!fs.existsSync(ruta)) return res.json({ success:false, mensaje:'Estrategia aún no generada' });
        const data = JSON.parse(fs.readFileSync(ruta, 'utf8'));
        res.json({ success:true, ...data });
    } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── PUBLICIDAD ───────────────────────────────────────────
app.get('/api/publicidad', authMiddleware, async (req, res) => {
    try { const r = await pool.query('SELECT * FROM publicidad ORDER BY id ASC'); res.json({ success:true, anuncios:r.rows }); }
    catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/publicidad/activos', async (req, res) => {
    try {
        const r = await pool.query("SELECT id,nombre_espacio,url_afiliado,imagen_url,ubicacion,ancho_px,alto_px FROM publicidad WHERE activo=true ORDER BY id ASC");
        res.setHeader('Access-Control-Allow-Origin','*');
        res.setHeader('Cache-Control','public,max-age=300');
        res.json({ success:true, anuncios:r.rows });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/publicidad/actualizar', authMiddleware, async (req, res) => {
    const { pin, id, nombre_espacio, url_afiliado, imagen_url, ubicacion, activo, ancho_px, alto_px } = req.body;
    if (pin !== '311') return res.status(403).json({ error:'PIN incorrecto' });
    if (!id) return res.status(400).json({ error:'Falta ID' });
    try {
        await pool.query('UPDATE publicidad SET nombre_espacio=$1,url_afiliado=$2,imagen_url=$3,ubicacion=$4,activo=$5,ancho_px=$6,alto_px=$7 WHERE id=$8',
            [nombre_espacio||'Sin nombre', url_afiliado||'', imagen_url||'', ubicacion||'top', activo===true||activo==='true', parseInt(ancho_px)||0, parseInt(alto_px)||0, parseInt(id)]);
        res.json({ success:true });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/publicidad/crear', authMiddleware, async (req, res) => {
    const { pin, nombre_espacio, url_afiliado, imagen_url, ubicacion, ancho_px, alto_px } = req.body;
    if (pin !== '311') return res.status(403).json({ error:'PIN incorrecto' });
    if (!nombre_espacio) return res.status(400).json({ error:'Falta nombre' });
    try {
        await pool.query('INSERT INTO publicidad(nombre_espacio,url_afiliado,imagen_url,ubicacion,activo,ancho_px,alto_px) VALUES($1,$2,$3,$4,true,$5,$6)',
            [nombre_espacio, url_afiliado||'', imagen_url||'', ubicacion||'top', parseInt(ancho_px)||0, parseInt(alto_px)||0]);
        res.json({ success:true });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/publicidad/eliminar', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error:'PIN incorrecto' });
    try { await pool.query('DELETE FROM publicidad WHERE id=$1',[parseInt(req.body.id)]); res.json({ success:true }); }
    catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/telegram/status', authMiddleware, async (req, res) => {
    if (req.query.pin!=='311') return res.status(403).json({ error:'PIN requerido' });
    const chatId = TELEGRAM_CHAT_ID || await obtenerChatIdTelegram();
    res.json({ token_activo:!!TELEGRAM_TOKEN, chat_id:chatId||'No detectado' });
});

app.post('/api/telegram/test', authMiddleware, async (req, res) => {
    if (req.body.pin!=='311') return res.status(403).json({ error:'PIN requerido' });
    const ok = await publicarEnTelegram('🏮 El Farol al Día — Prueba V36.0','',`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,'Bot activo!','Nacionales');
    res.json({ success:ok });
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

app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query("SELECT * FROM noticias WHERE slug=$1 AND estado=$2",[req.params.slug,'publicada']);
        if (!r.rows.length) return res.status(404).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>404</title></head><body style="background:#070707;color:#EDE8DF;text-align:center;padding:60px;font-family:sans-serif"><h1 style="color:#FF5500">404</h1><p>Noticia no encontrada</p><a href="/" style="color:#FF5500">← Volver</a></body></html>');
        const n = r.rows[0];
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1',[n.id]);
        try {
            let html = fs.readFileSync(path.join(__dirname,'client','noticia.html'),'utf8');
            const urlN = `${BASE_URL}/noticia/${n.slug}`;
            const cHTML = n.contenido.split('\n').filter(p=>p.trim()).map(p=>`<p>${p.trim()}</p>`).join('');
            html = html.replace('<!-- META_TAGS -->',metaTagsCompletos(n,urlN)).replace(/{{TITULO}}/g,esc(n.titulo)).replace(/{{CONTENIDO}}/g,cHTML).replace(/{{FECHA}}/g,new Date(n.fecha).toLocaleDateString('es-DO',{year:'numeric',month:'long',day:'numeric'})).replace(/{{IMAGEN}}/g,n.imagen).replace(/{{ALT}}/g,esc(n.imagen_alt||n.titulo)).replace(/{{VISTAS}}/g,n.vistas).replace(/{{REDACTOR}}/g,esc(n.redactor)).replace(/{{SECCION}}/g,esc(n.seccion)).replace(/{{URL}}/g,encodeURIComponent(urlN));
            res.setHeader('Content-Type','text/html;charset=utf-8');
            res.setHeader('Cache-Control','public,max-age=300');
            res.send(html);
        } catch(e) { res.json({ success:true, noticia:n }); }
    } catch(e) { res.status(500).send('Error interno'); }
});

app.get('/sitemap.xml', async (req, res) => {
    try {
        const r = await pool.query("SELECT slug,fecha FROM noticias WHERE estado='publicada' AND slug IS NOT NULL ORDER BY fecha DESC LIMIT 1000");
        const now = Date.now();
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;
        for (const n of r.rows) {
            const d = (now-new Date(n.fecha).getTime())/86400000;
            xml += `<url><loc>${BASE_URL}/noticia/${encodeURIComponent(n.slug).replace(/%2F/g,'/')}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>${d<1?'hourly':d<7?'daily':'weekly'}</changefreq><priority>${d<1?'1.0':d<7?'0.9':'0.7'}</priority></url>\n`;
        }
        xml += '</urlset>';
        res.setHeader('Content-Type','application/xml; charset=utf-8');
        res.setHeader('Cache-Control','public,max-age=1800');
        res.send(xml);
    } catch(e) { res.status(500).send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'); }
});

app.get('/robots.txt', (req,res) => {
    res.setHeader('Content-Type','text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nDisallow: /redaccion\n\nSitemap: ${BASE_URL}/sitemap.xml`);
});

app.get('/ads.txt', (req,res) => {
    res.setHeader('Content-Type','text/plain');
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

app.get('/api/configuracion', (req,res) => {
    try {
        const c = fs.existsSync(path.join(__dirname,'config.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')) : {googleAnalytics:''};
        res.json({ success:true, config:c });
    } catch(e) { res.json({ success:true, config:{googleAnalytics:''} }); }
});

app.post('/api/configuracion', express.json(), (req,res) => {
    const { pin, googleAnalytics } = req.body;
    if (pin!=='311') return res.status(403).json({ success:false, error:'PIN incorrecto' });
    try { fs.writeFileSync(path.join(__dirname,'config.json'),JSON.stringify({googleAnalytics},null,2)); res.json({ success:true }); }
    catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/status', async (req, res) => {
    try {
        const r         = await pool.query("SELECT COUNT(*) FROM noticias WHERE estado='publicada'");
        const rss       = await pool.query('SELECT COUNT(*) FROM rss_procesados');
        const ultima    = await pool.query("SELECT fecha,titulo FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 1");
        const minSin    = ultima.rows.length ? Math.round((Date.now()-new Date(ultima.rows[0].fecha))/60000) : 9999;
        const pushSubs  = await pool.query('SELECT COUNT(*) FROM push_suscripciones');
        const estrategiaExiste = fs.existsSync(path.join(__dirname,'estrategia.json'));
        res.json({
            status:'OK', version:'36.0-mxl+deepseek+onesignal+google-creds',
            noticias:parseInt(r.rows[0].count),
            rss_procesados:parseInt(rss.rows[0].count),
            min_sin_publicar:minSin,
            ultima_noticia:ultima.rows[0]?.titulo?.substring(0,60)||'—',
            // IA
            gemini_texto:`${LLAVES_TEXTO.length} keys activas`,
            gemini_imagen:`${LLAVES_IMAGEN.length} keys activas`,
            modelo_gemini:'gemini-2.5-flash',
            deepseek:DEEPSEEK_API_KEY?`✅ Fallback activo (${DEEPSEEK_BASE_URL})`:'⚠️ Sin configurar',
            // Imágenes
            google_cse:GOOGLE_CSE_KEYS.length&&GOOGLE_CSE_CX?`✅ ${GOOGLE_CSE_KEYS.length} keys`:'⚠️ Sin configurar',
            unsplash:UNSPLASH_ACCESS_KEY?'✅ Activo':'⚠️ Sin key',
            pexels:PEXELS_API_KEY?'✅ Activo':'⚠️ Sin key',
            // Notificaciones
            push_vapid:VAPID_PUBLIC_KEY&&VAPID_PRIVATE_KEY?`✅ Activo (${pushSubs.rows[0].count} subs)`:'⚠️ Sin VAPID keys',
            push_onesignal:ONESIGNAL_APP_ID?`✅ App ID configurado`:'⚠️ Sin App ID (agrega ONESIGNAL_APP_ID)',
            // Integraciones
            google_credentials:GOOGLE_CREDENTIALS?`✅ ${GOOGLE_CREDENTIALS.client_email}`:'⚠️ No encontradas',
            elevenlabs:ELEVENLABS_API_KEY?'✅ Key cargada (TTS listo)':'⚠️ Sin key',
            facebook:FB_PAGE_ID&&FB_PAGE_TOKEN?'✅ Activo':'⚠️ Sin credenciales',
            twitter:TWITTER_API_KEY&&TWITTER_ACCESS_TOKEN?'✅ Activo':'⚠️ Sin credenciales',
            telegram:TELEGRAM_TOKEN?'✅ Activo':'⚠️ Sin token',
            watermark:WATERMARK_PATH&&fs.existsSync(WATERMARK_PATH)?'✅ Activa':'⚠️ Sin archivo',
            // Sistema
            estrategia:estrategiaExiste?'✅ Activa (cada 6h)':'⚠️ Aún no generada',
            ia_activa:CONFIG_IA.enabled,
            adsense:'pub-5280872495839888 ✅',
        });
    } catch(e) { res.status(500).json({ error:e.message }); }
});

app.use((req,res) => res.sendFile(path.join(__dirname,'client','index.html')));

// ══════════════════════════════════════════════════════════
// 🚀 ARRANQUE — V36.0 MXL
// ══════════════════════════════════════════════════════════
async function iniciar() {
    try {
        await inicializarBase();
        await initPushTable();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V36.0 MXL EDITION                       ║
╠══════════════════════════════════════════════════════════════════╣
║  🤖 Gemini texto KEY_1+KEY_2 activas                           ║
║  🤖 DeepSeek fallback automático cuando Gemini falla           ║
║  🔔 OneSignal + Web Push VAPID (doble push)                    ║
║  🌐 Google Service Account conectado                           ║
║  🎙️  ElevenLabs API key cargada (TTS disponible)               ║
║  ✅ Anti-repetición: 25 títulos en memoria                     ║
║  ✅ Validación: 600+ chars, barrios SDE, lenguaje RD           ║
║  ✅ Reintentos automáticos (3 intentos)                        ║
║  ✅ Estrategia MXL: analiza BD cada 6h                         ║
╚══════════════════════════════════════════════════════════════════╝`);
        });

        setTimeout(() => bienvenidaTelegram(), 5000);
        setTimeout(() => rafagaInicial(),      60000);
        setTimeout(() => {
            console.log('📊 Primer análisis de estrategia...');
            analizarYGenerar().catch(err => console.error('❌ Estrategia inicial:', err.message));
        }, 10000);

    } catch(err) {
        console.error('❌ ERROR CRÍTICO EN ARRANQUE:', err.message);
        process.exit(1);
    }
}

iniciar();
module.exports = app;
