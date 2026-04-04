/**
 * 🏮 EL FAROL AL DÍA — V35.0 MXL EDITION
 * ─────────────────────────────────────────────────────────────────────────
 * ✅ OPTIMIZACIONES MXL:
 *   1. Módulo de investigación previa (25 títulos + detección automática)
 *   2. Búsqueda de contexto real en SDE vía Google CSE
 *   3. Validación de contenido (600+ chars, barrios SDE, lenguaje dominicano)
 *   4. Reintentos automáticos (máx 3) con presión creciente
 *   5. Notificaciones push para celular
 * ─────────────────────────────────────────────────────────────────────────
 */

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const crypto    = require('crypto');
const webPush   = require('web-push');

// ── LÍNEA 1: Estrategia (loader + analyzer) ──────────────────
const { leerEstrategia }   = require('./estrategia-loader');
const { analizarYGenerar } = require('./estrategia-analyzer');
// ─────────────────────────────────────────────────────────────

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

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

// ══════════════════════════════════════════════════════════
// 🔑 LLAVES GEMINI — SEPARADAS POR ROL
// ══════════════════════════════════════════════════════════
const LLAVES_TEXTO  = [process.env.GEMINI_API_KEY,  process.env.GEMINI_API_KEY2].filter(Boolean);
const LLAVES_IMAGEN = [process.env.GEMINI_API_KEY3, process.env.GEMINI_API_KEY4].filter(Boolean);

const GOOGLE_CSE_KEYS = [process.env.GOOGLE_CSE_KEY, process.env.GOOGLE_CSE_KEY_2].filter(Boolean);
const GOOGLE_CSE_CX   = process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CSE_CX || '';

const PEXELS_API_KEY        = process.env.PEXELS_API_KEY        || null;
const FB_PAGE_ID            = process.env.FB_PAGE_ID            || null;
const FB_PAGE_TOKEN         = process.env.FB_PAGE_TOKEN         || null;
const TWITTER_API_KEY       = process.env.TWITTER_API_KEY       || null;
const TWITTER_API_SECRET    = process.env.TWITTER_API_SECRET    || null;
const TWITTER_ACCESS_TOKEN  = process.env.TWITTER_ACCESS_TOKEN  || null;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || null;
const TELEGRAM_TOKEN        = process.env.TELEGRAM_TOKEN        || null;
let   TELEGRAM_CHAT_ID      = process.env.TELEGRAM_CHAT_ID      || null;

// ══════════════════════════════════════════════════════════
// 📱 WEB PUSH VAPID KEYS
// ══════════════════════════════════════════════════════════
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || 'mailto:alertas@elfarolaldia.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('📱 Web Push VAPID configurado');
} else {
    console.warn('⚠️ Web Push: VAPID keys no configuradas (push no disponible)');
}

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
    console.warn('⚠️  Watermark no encontrado — fotos sin marca');
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
        await client.query(`
            CREATE TABLE IF NOT EXISTS push_suscripciones (
                id SERIAL PRIMARY KEY,
                endpoint TEXT UNIQUE NOT NULL,
                auth_key TEXT NOT NULL,
                p256dh_key TEXT NOT NULL,
                user_agent TEXT,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultima_notificacion TIMESTAMP
            )
        `);
        console.log('📱 Tabla push_suscripciones lista');
    } catch(e) { console.warn('⚠️ Push table:', e.message); }
    finally { client.release(); }
}

// ══════════════════════════════════════════════════════════
// 📱 ENVIAR NOTIFICACIÓN PUSH A TODOS LOS SUSCRIPTORES
// ══════════════════════════════════════════════════════════
async function enviarNotificacionPush(titulo, cuerpo, slug, imagenUrl) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        console.log('📱 Push: VAPID keys no configuradas');
        return false;
    }

    try {
        const suscriptores = await pool.query(`
            SELECT endpoint, auth_key, p256dh_key 
            FROM push_suscripciones 
            WHERE endpoint IS NOT NULL
            ORDER BY ultima_notificacion NULLS FIRST
        `);

        if (!suscriptores.rows.length) {
            console.log('📱 Push: 0 suscriptores activos');
            return false;
        }

        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const notificacion = {
            title: titulo.substring(0, 80),
            body: cuerpo.substring(0, 120),
            icon: imagenUrl || `${BASE_URL}/static/favicon.png`,
            badge: `${BASE_URL}/static/badge.png`,
            image: imagenUrl,
            vibrate: [200, 100, 200],
            data: { url: urlNoticia, slug: slug },
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
        let enviadas = 0;
        let fallidas = 0;

        for (const sub of suscriptores.rows) {
            try {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        auth: sub.auth_key,
                        p256dh: sub.p256dh_key
                    }
                };

                await webPush.sendNotification(pushSubscription, payload);
                enviadas++;

                await pool.query(
                    `UPDATE push_suscripciones SET ultima_notificacion = NOW() WHERE endpoint = $1`,
                    [sub.endpoint]
                );

                await new Promise(r => setTimeout(r, 100));
            } catch (err) {
                fallidas++;
                if (err.statusCode === 410) {
                    await pool.query(`DELETE FROM push_suscripciones WHERE endpoint = $1`, [sub.endpoint]);
                    console.log(`📱 Push: endpoint expirado eliminado`);
                }
            }
        }

        console.log(`📱 Push: ${enviadas} notificaciones enviadas (${fallidas} fallidas)`);
        return enviadas > 0;
    } catch (err) {
        console.error('📱 Push error:', err.message);
        return false;
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
            if (data2.error) { return false; }
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
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:chatId,text:`🏮 *El Farol al Día — V35.0 MXL*\n\n✅ Bot activo.\n✅ Notificaciones push activadas.\n✅ Motor anti-repetición activo.\n\n🌐 [elfarolaldia.com](https://elfarolaldia.com)`,parse_mode:'Markdown'}) });
    } catch(e) {}
}

// ══════════════════════════════════════════════════════════
// 🏮 WATERMARK
// ══════════════════════════════════════════════════════════
async function aplicarMarcaDeAgua(urlImagen) {
    if (!WATERMARK_PATH) return { url:urlImagen, procesada:false };
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
        console.log(`    🏮 Watermark: ${nombre}`);
        return { url:urlImagen, nombre, procesada:true };
    } catch(err) { console.warn(`    ⚠️ Watermark falló: ${err.message}`); return { url:urlImagen, procesada:false }; }
}

async function aplicarMarcaDeAguaBuffer(bufOrig) {
    if (!WATERMARK_PATH || !fs.existsSync(WATERMARK_PATH)) return null;
    try {
        const meta = await sharp(bufOrig).metadata();
        const w = meta.width || 800, h = meta.height || 500;
        const wmAncho = Math.min(Math.round(w * 0.28), 300);
        const wmResized = await sharp(WATERMARK_PATH).resize(wmAncho, null, { fit: 'inside' }).toBuffer();
        const wmMeta = await sharp(wmResized).metadata();
        const wmAlto = wmMeta.height || 60;
        const margen = Math.round(w * 0.02);
        const bufFinal = await sharp(bufOrig).composite([{ input: wmResized, left: Math.max(0, w - wmAncho - margen), top: Math.max(0, h - wmAlto - margen), blend: 'over' }]).jpeg({ quality: 88 }).toBuffer();
        const nombre = `efd-manual-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
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
        const r = await pool.query(`SELECT valor FROM memoria_ia WHERE tipo='config_ia' ORDER BY ultima_vez DESC LIMIT 1`);
        if (r.rows.length) { CONFIG_IA = {...CONFIG_IA_DEFAULT,...JSON.parse(r.rows[0].valor)}; }
        else { CONFIG_IA = {...CONFIG_IA_DEFAULT}; }
    } catch(e) { CONFIG_IA = {...CONFIG_IA_DEFAULT}; }
    return CONFIG_IA;
}

async function guardarConfigIA(cfg) {
    try {
        const valor = JSON.stringify(cfg);
        await pool.query(`INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('config_ia',$1,'sistema',1,0) ON CONFLICT DO NOTHING`,[valor]);
        await pool.query(`UPDATE memoria_ia SET valor=$1,ultima_vez=NOW() WHERE tipo='config_ia' AND categoria='sistema'`,[valor]);
        return true;
    } catch(e) { return false; }
}

// ══════════════════════════════════════════════════════════
// GEMINI — ESTADO DE LLAVES
// ══════════════════════════════════════════════════════════
const GEMINI_STATE = {};
function getKeyState(k) {
    if (!GEMINI_STATE[k]) GEMINI_STATE[k] = { lastRequest:0, resetTime:0 };
    return GEMINI_STATE[k];
}

async function _callGemini(apiKey, prompt, intentoGlobal) {
    const st = getKeyState(apiKey);
    const ahora = Date.now();
    if (ahora < st.resetTime) {
        const espera = st.resetTime - ahora;
        await new Promise(r => setTimeout(r, espera));
    }
    const desde = Date.now() - st.lastRequest;
    if (desde < 8000) await new Promise(r => setTimeout(r, 8000 - desde));
    st.lastRequest = Date.now();
    let res;
    try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.85, maxOutputTokens: 3000, stopSequences: [] } }),
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
            catch(err) { if (err.message === 'RATE_LIMIT_429') continue; console.error(`    ❌ Texto ${err.message}`); }
        }
        if (i < reintentos - 1) await new Promise(r => setTimeout(r, (i + 1) * 15000));
    }
    throw new Error('Gemini texto: todas las llaves fallaron');
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
// 🖼️  GOOGLE CUSTOM SEARCH — MOTOR MXL
// ══════════════════════════════════════════════════════════
const CSE_EXCLUDES = [
    '-site:listindiario.com', '-site:diariolibre.com',
    '-site:elnacional.com.do', '-site:hoy.com.do',
    '-site:noticiassin.com',  '-site:telesistema11.com.do',
    '-site:shutterstock.com', '-site:gettyimages.com',
    '-site:adobe.com',        '-site:dreamstime.com',
    '-site:alamy.com',        '-site:123rf.com',
    '-site:istockphoto.com',  '-site:vectorstock.com',
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
    const basura = ['flag','logo','map','coat_of_arms','seal','emblem','icon','badge','crest','shield','_bw','-bw','grayscale','favicon'];
    if (basura.some(b => u.includes(b))) return false;
    return true;
}

async function verificarResolucion(url) {
    try {
        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(url, { method:'GET', signal: ctrl.signal }).finally(() => clearTimeout(tm));
        if (!res.ok) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 20000) return false;
        const meta = await sharp(buf).metadata();
        return (meta.width || 0) >= 1024;
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
            const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tm));
            if (res.status === 429 || res.status === 403) {
                st.fallos++;
                st.bloqueadaHasta = Date.now() + (st.fallos >= 3 ? 3600000 : 300000);
                continue;
            }
            if (!res.ok) continue;
            const data = await res.json();
            const items = data.items || [];
            for (const item of items) {
                const imgUrl = item.link;
                if (!urlImagenValida(imgUrl)) continue;
                const buena = await verificarResolucion(imgUrl);
                if (!buena) continue;
                console.log(`    ✅ CSE imagen OK`);
                st.fallos = 0;
                return imgUrl;
            }
        } catch(err) { console.warn(`    ⚠️ CSE error: ${err.message}`); st.fallos++; }
    }
    return null;
}

function generarQueryCSE(titulo, categoria) {
    const tLow = titulo.toLowerCase();
    const barrioDetectado = BARRIOS_SDE.find(b => tLow.includes(b.toLowerCase())) || '';
    const queryBase = {
        'Nacionales':'noticias comunidad vecinos','Deportes':'deporte atletas cancha',
        'Internacionales':'noticias mundo caribe','Economía':'negocio comercio mercado',
        'Tecnología':'tecnología innovación digital','Espectáculos':'entretenimiento arte cultura',
    }[categoria] || 'noticias barrio';
    const stopwords = new Set(['el','la','los','las','un','una','de','del','en','y','a','se','que','por','con','su','sus','al','es','son','fue','han','ha','le','les','lo','más','para','sobre','como','entre','pero','sin','ya','no','si','o','e','ni','también','cuando','donde','quien','quién','qué','cómo','muy','todo','todos','toda','todas','este','esta','estos','estas','ese','esa']);
    const palabrasClave = titulo.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w)).slice(0, 3).join(' ');
    return { query: `${palabrasClave} ${queryBase}`.trim(), barrio: barrioDetectado };
}

// ══════════════════════════════════════════════════════════
// MAPEO IMÁGENES
// ══════════════════════════════════════════════════════════
const MAPEO_IMAGENES = {
    'donald trump':['trump president podium microphone','american president speech flag'],
    'trump':['trump president podium microphone','american president official speech'],
    'abinader':['latin american president ceremony','dominican republic president podium'],
    'luis abinader':['latin american president ceremony','dominican republic government event'],
    'béisbol':['baseball dominican republic stadium','baseball player batting pitch'],
    'beisbol':['baseball dominican republic stadium','baseball player batting pitch'],
    'messi':['soccer player dribbling ball','professional soccer match action'],
    'policía nacional':['police officers patrol street','law enforcement officers uniform'],
    'policia nacional':['police officers patrol street','police patrol caribbean'],
    'mopc':['road construction highway workers','road paving machinery workers'],
    'invivienda':['social housing construction caribbean','affordable housing development latin'],
    'haití':['haiti dominican border crossing','dominican haiti border fence'],
    'inteligencia artificial':['artificial intelligence technology computer','ai machine learning digital'],
    'huracán':['hurricane satellite view storm','hurricane damage aftermath caribbean'],
};

const CATEGORIAS_ALTO_CPM = ['Economía','Tecnología','Internacionales'];

function queryEsPeriodistica(query, categoria = '') {
    const q = query.toLowerCase();
    const basura = ['wedding','bride','groom','romantic','love','kiss','marriage','cartoon','3d render','pet','dog','cat','birthday cake','balloon','flowers','bouquet'];
    return !basura.some(p => q.includes(p));
}

async function fallbackVisualInteligente(categoria, subtema) {
    if (PEXELS_API_KEY) {
        for (const q of ['santo domingo dominican republic cityscape','dominican republic government building official']) {
            try {
                const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),5000);
                const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=5&orientation=landscape`, { headers:{Authorization:PEXELS_API_KEY}, signal:ctrl.signal }).finally(()=>clearTimeout(tm));
                if (!res.ok) continue;
                const data = await res.json();
                if (data.photos?.length) { const foto = data.photos[Math.floor(Math.random()*Math.min(3,data.photos.length))]; return foto.src.large2x||foto.src.large; }
            } catch { continue; }
        }
    }
    return imgLocal(subtema, categoria);
}

async function buscarImagenWikipedia(titulo) {
    try {
        let res = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`, {headers:{'User-Agent':'ElFarolAlDia/1.0'}});
        let data = await res.json(); let pageTitle = data.query?.search?.[0]?.title; let lang = 'es';
        if (!pageTitle) { res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`, {headers:{'User-Agent':'ElFarolAlDia/1.0'}}); data = await res.json(); pageTitle = data.query?.search?.[0]?.title; lang = 'en'; }
        if (!pageTitle) return null;
        const resImg = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=800&origin=*`, {headers:{'User-Agent':'ElFarolAlDia/1.0'}});
        const dataImg = await resImg.json(); const pages = dataImg.query?.pages; const pid = Object.keys(pages||{})[0]; const thumb = pages?.[pid]?.thumbnail?.source;
        if (thumb) return thumb; return null;
    } catch(e) { return null; }
}

async function buscarImagenWikimediaCommons(titulo) {
    try {
        let res = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`, {headers:{'User-Agent':'ElFarolAlDia/1.0'}});
        let data = await res.json(); let pageTitle = data.query?.search?.[0]?.title;
        if (!pageTitle) { res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`, {headers:{'User-Agent':'ElFarolAlDia/1.0'}}); data = await res.json(); pageTitle = data.query?.search?.[0]?.title; }
        if (!pageTitle) return null;
        const resC = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=${encodeURIComponent(pageTitle)}&gimlimit=5&prop=imageinfo&iiprop=url|mime&format=json&origin=*`, {headers:{'User-Agent':'ElFarolAlDia/1.0'}});
        const dataC = await resC.json();
        for (const pid in (dataC.query?.pages||{})) { const p = dataC.query.pages[pid]; if (p.imageinfo?.[0]?.mime?.startsWith('image/')) return p.imageinfo[0].url; }
        return null;
    } catch(e) { return null; }
}

function esImagenValida(url) {
    if (!url) return false; const u = url.toLowerCase();
    if (!/(\.jpg|\.jpeg|\.png|\.webp)/i.test(u)) return false;
    const invalidos = ['.svg','flag','logo','map','coat_of_arms','seal','emblem','icon','badge','crest','shield','_bw','-bw','black_white','grayscale','20px','30px','40px','50px'];
    if (invalidos.some(i => u.includes(i))) return false;
    return true;
}

// ══════════════════════════════════════════════════════════
// UNSPLASH
// ══════════════════════════════════════════════════════════
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || null;
const UNSPLASH_BLOQUEADOS = ['wedding','bride','groom','romantic','love','kiss','couple','marriage','cartoon','pet','dog','cat','birthday','balloon','flowers','bouquet','fashion','model','selfie'];

async function buscarEnUnsplash(query, categoria) {
    if (!UNSPLASH_ACCESS_KEY) return null;
    const q = (query || '').toLowerCase();
    if (UNSPLASH_BLOQUEADOS.some(b => q.includes(b))) return null;
    if (!queryEsPeriodistica(query, categoria)) return null;
    const queryFinal = encodeURIComponent(`${query} caribbean dominican`);
    try {
        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 7000);
        const res = await fetch(`https://api.unsplash.com/search/photos?query=${queryFinal}&per_page=10&orientation=landscape&content_filter=high`, { headers:{ Authorization:`Client-ID ${UNSPLASH_ACCESS_KEY}` }, signal:ctrl.signal }).finally(() => clearTimeout(tm));
        if (!res.ok) return null;
        const data = await res.json();
        const fotos = (data.results || []).filter(f => {
            if ((f.width || 0) < 1080) return false;
            const desc = (f.description || f.alt_description || '').toLowerCase();
            return !UNSPLASH_BLOQUEADOS.some(b => desc.includes(b));
        });
        if (!fotos.length) return null;
        const foto = fotos.slice(0, 5)[Math.floor(Math.random() * Math.min(5, fotos.length))];
        const url = foto.urls?.full || foto.urls?.regular;
        if (!url) return null;
        console.log(`    📷 Unsplash OK`);
        return url;
    } catch(err) { return null; }
}

// ══════════════════════════════════════════════════════════
// PEXELS (fallback)
// ══════════════════════════════════════════════════════════
const PEXELS_QUERIES_RD = {
    'presidente':['president speech podium government','latin america president official event'],
    'gobierno':['government building official meeting','latin america congress parliament'],
    'policia':['police patrol latin america street','law enforcement officer uniform'],
    'economia':['business finance professionals meeting','stock market trading finance'],
    'salud':['hospital doctors medical staff','doctor patient consultation clinic'],
    'educacion':['students classroom learning school','teacher students lesson classroom'],
    'beisbol':['baseball game stadium fans crowd','baseball pitcher throwing stadium'],
    'béisbol':['baseball game stadium fans crowd','baseball pitcher throwing stadium'],
    'futbol':['soccer football match stadium crowd','football players game action'],
    'tecnologia':['technology innovation digital business','tech startup team working computers'],
    'musica':['music concert performance stage lights','musicians performing concert crowd'],
    'huracan':['hurricane storm damage destruction','tropical storm damage aftermath'],
    'inundacion':['flood flooding water streets','flood disaster emergency response'],
    'haiti':['haiti dominican republic border crossing','humanitarian aid border caribbean'],
    'Nacionales':['dominican republic government news','santo domingo city official event'],
    'Deportes':['dominican republic athlete sports','caribbean sports competition athlete'],
    'Internacionales':['international news world leaders','global summit conference diplomacy'],
    'Economía':['latin america business finance economy','caribbean economic development'],
    'Tecnología':['technology innovation digital latin america','tech professionals working computers'],
    'Espectáculos':['latin entertainment music show concert','caribbean cultural performance arts'],
};

async function buscarEnPexels(queries) {
    if (!PEXELS_API_KEY) return null;
    const BLOQUEADOS = ['wedding','bride','groom','romantic','fashion','flowers','love','kiss','marriage'];
    const listaQueries = (Array.isArray(queries)?queries:[queries]).filter(q => !BLOQUEADOS.some(b => q.toLowerCase().includes(b)));
    if (!listaQueries.length) return null;
    for (const query of listaQueries) {
        try {
            const ctrl = new AbortController(); const tm = setTimeout(()=>ctrl.abort(),5000);
            const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`, { headers:{Authorization:PEXELS_API_KEY}, signal:ctrl.signal }).finally(()=>clearTimeout(tm));
            if (!res.ok) continue; const data = await res.json(); if (!data.photos?.length) continue;
            const foto = data.photos.slice(0,5)[Math.floor(Math.random()*Math.min(5,data.photos.length))];
            registrarQueryPexels(query, 'general', true);
            return foto.src.large2x||foto.src.large||foto.src.original;
        } catch { continue; }
    }
    return null;
}

function detectarQueriesPexels(titulo, categoria, queryIA) {
    const tituloLower = titulo.toLowerCase(); const queries = [];
    if (queryIA) queries.push(queryIA);
    const catsSaltar = ['Nacionales','Deportes','Internacionales','Economía','Tecnología','Espectáculos'];
    for (const [clave, qs] of Object.entries(PEXELS_QUERIES_RD)) {
        if (catsSaltar.includes(clave)) continue;
        if (tituloLower.includes(clave.toLowerCase())) queries.push(...qs);
    }
    if (PEXELS_QUERIES_RD[categoria]) queries.push(...PEXELS_QUERIES_RD[categoria]);
    queries.push('dominican republic news event','caribbean latin america people');
    return [...new Set(queries)].slice(0,12);
}

async function obtenerImagenInteligente(titulo, categoria, subtemaLocal, queryIA) {
    const tituloLower = titulo.toLowerCase();
    if (GOOGLE_CSE_KEYS.length && GOOGLE_CSE_CX) {
        try {
            const { query: qCSE, barrio } = generarQueryCSE(titulo, categoria);
            const urlCSE = await buscarImagenCSE(queryIA || qCSE, barrio);
            if (urlCSE) return urlCSE;
        } catch(e) {}
    }
    if (UNSPLASH_ACCESS_KEY && queryIA) {
        const urlUnsplash = await buscarEnUnsplash(queryIA, categoria);
        if (urlUnsplash) return urlUnsplash;
    }
    if (UNSPLASH_ACCESS_KEY && !queryIA) {
        const { query: qSDE } = generarQueryCSE(titulo, categoria);
        const urlUnsplash = await buscarEnUnsplash(qSDE, categoria);
        if (urlUnsplash) return urlUnsplash;
    }
    for (const [clave, queries] of Object.entries(MAPEO_IMAGENES)) {
        if (Array.isArray(queries) && tituloLower.includes(clave)) {
            const queriesLimpias = queries.filter(q => queryEsPeriodistica(q, categoria));
            const urlPexels = await buscarEnPexels(queriesLimpias);
            if (urlPexels) return urlPexels;
            const urlWiki = await buscarImagenWikipedia(clave);
            if (urlWiki && esImagenValida(urlWiki)) return urlWiki;
            break;
        }
    }
    if (queryIA && queryEsPeriodistica(queryIA, categoria)) {
        const urlQueryIA = await buscarEnPexels([queryIA]);
        if (urlQueryIA) return urlQueryIA;
    }
    const queriesFiltradas = detectarQueriesPexels(titulo, categoria, null).filter(q => queryEsPeriodistica(q, categoria));
    const urlPexels = await buscarEnPexels(queriesFiltradas);
    if (urlPexels) return urlPexels;
    const urlWiki = await buscarImagenWikipedia(titulo);
    if (urlWiki && esImagenValida(urlWiki)) return urlWiki;
    const urlCommons = await buscarImagenWikimediaCommons(titulo);
    if (urlCommons && esImagenValida(urlCommons)) return urlCommons;
    return await fallbackVisualInteligente(categoria, subtemaLocal);
}

// ══════════════════════════════════════════════════════════
// BANCO LOCAL
// ══════════════════════════════════════════════════════════
const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';
const BANCO_LOCAL = {
    'politica-gobierno': [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,`${PB}/290595/pexels-photo-290595.jpeg${OPT}`,`${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`],
    'seguridad-policia': [`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`,`${PB}/5699456/pexels-photo-5699456.jpeg${OPT}`],
    'relaciones-internacionales': [`${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`,`${PB}/358319/pexels-photo-358319.jpeg${OPT}`],
    'economia-mercado': [`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`,`${PB}/6772070/pexels-photo-6772070.jpeg${OPT}`],
    'infraestructura': [`${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`,`${PB}/323780/pexels-photo-323780.jpeg${OPT}`],
    'salud-medicina': [`${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`,`${PB}/40568/pexels-photo-40568.jpeg${OPT}`],
    'deporte-beisbol': [`${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`,`${PB}/209977/pexels-photo-209977.jpeg${OPT}`],
    'deporte-futbol': [`${PB}/46798/pexels-photo-46798.jpeg${OPT}`,`${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`],
    'deporte-general': [`${PB}/863988/pexels-photo-863988.jpeg${OPT}`,`${PB}/936094/pexels-photo-936094.jpeg${OPT}`],
    'tecnologia': [`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`,`${PB}/2582937/pexels-photo-2582937.jpeg${OPT}`],
    'educacion': [`${PB}/256490/pexels-photo-256490.jpeg${OPT}`,`${PB}/289737/pexels-photo-289737.jpeg${OPT}`],
    'cultura-musica': [`${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`,`${PB}/1540406/pexels-photo-1540406.jpeg${OPT}`],
    'medio-ambiente': [`${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`,`${PB}/1366919/pexels-photo-1366919.jpeg${OPT}`],
    'turismo': [`${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`,`${PB}/1174732/pexels-photo-1174732.jpeg${OPT}`],
    'emergencia': [`${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`,`${PB}/263402/pexels-photo-263402.jpeg${OPT}`],
    'vivienda-social': [`${PB}/323780/pexels-photo-323780.jpeg${OPT}`,`${PB}/1396122/pexels-photo-1396122.jpeg${OPT}`],
    'transporte-vial': [`${PB}/93398/pexels-photo-93398.jpeg${OPT}`,`${PB}/1004409/pexels-photo-1004409.jpeg${OPT}`],
};
const FALLBACK_CAT = {
    'Nacionales':'politica-gobierno','Deportes':'deporte-general','Internacionales':'relaciones-internacionales',
    'Economía':'economia-mercado','Tecnología':'tecnologia','Espectáculos':'cultura-musica',
};
function imgLocal(sub, cat) {
    const banco = BANCO_LOCAL[sub]||BANCO_LOCAL[FALLBACK_CAT[cat]]||BANCO_LOCAL['politica-gobierno'];
    return banco[Math.floor(Math.random()*banco.length)];
}

function generarAltSEO(titulo, categoria, altIA, subtema) {
    if (altIA && altIA.length > 15) {
        const yaTieneRD = altIA.toLowerCase().includes('dominican')||altIA.toLowerCase().includes('república')||altIA.toLowerCase().includes('santo domingo');
        if (yaTieneRD) return `${altIA} - El Farol al Día`;
        const ctx = {'Nacionales':'noticias República Dominicana','Deportes':'deportes dominicanos','Internacionales':'noticias internacionales impacto RD','Economía':'economía República Dominicana','Tecnología':'tecnología innovación RD','Espectáculos':'cultura entretenimiento dominicano'};
        return `${altIA}, ${ctx[categoria]||'República Dominicana'} - El Farol al Día`;
    }
    const base = {'Nacionales':`Noticia nacional ${titulo.substring(0,40)} - Santo Domingo Este, República Dominicana`,'Deportes':`Deportes dominicanos ${titulo.substring(0,40)} - El Farol al Día RD`,'Internacionales':`Noticias internacionales ${titulo.substring(0,30)} - impacto en República Dominicana`,'Economía':`Economía dominicana ${titulo.substring(0,35)} - finanzas República Dominicana`,'Tecnología':`Tecnología ${titulo.substring(0,35)} - innovación República Dominicana`,'Espectáculos':`Espectáculos dominicanos ${titulo.substring(0,35)} - cultura RD`};
    return base[categoria]||`${titulo.substring(0,50)} - noticias Santo Domingo Este El Farol al Día`;
}

const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function metaTagsCompletos(n, url) {
    const t=esc(n.titulo),d=esc(n.seo_description||''),k=esc(n.seo_keywords||'');
    const img=esc(n.imagen),sec=esc(n.seccion);
    const fi=new Date(n.fecha).toISOString(),ue=esc(url);
    const wc=(n.contenido||'').split(/\s+/).filter(w=>w).length;
    const keywordsSEO=[n.seo_keywords||'','último minuto república dominicana','santo domingo este noticias','tendencias dominicanas','el farol al día','los mina invivienda sde'].filter(Boolean).join(', ');
    const schema={"@context":"https://schema.org","@type":"NewsArticle","mainEntityOfPage":{"@type":"WebPage","@id":url},"headline":n.titulo,"description":n.seo_description||'',"image":{"@type":"ImageObject","url":n.imagen,"width":1200,"height":630},"datePublished":fi,"dateModified":fi,"author":{"@type":"Person","name":"José Gregorio Mañan Santana","url":`${BASE_URL}/nosotros`,"jobTitle":"Director General","worksFor":{"@type":"Organization","name":"El Farol al Día"}},"publisher":{"@type":"NewsMediaOrganization","name":"El Farol al Día","url":BASE_URL,"logo":{"@type":"ImageObject","url":`${BASE_URL}/static/favicon.png`}},"articleSection":n.seccion,"wordCount":wc,"inLanguage":"es-DO"};
    const bread={"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Inicio","item":BASE_URL},{"@type":"ListItem","position":2,"name":n.seccion,"item":`${BASE_URL}/#${(n.seccion||'').toLowerCase()}`},{"@type":"ListItem","position":3,"name":n.titulo,"item":url}]};
    const tituloSEO=(n.titulo.toLowerCase().includes('santo domingo')||n.titulo.toLowerCase().includes('sde'))?`${t} | El Farol al Día`:`${t} | Último Minuto SDE · El Farol al Día`;
    return `<title>${tituloSEO}</title>
<meta name="description" content="${d}">
<meta name="keywords" content="${esc(keywordsSEO)}">
<meta name="author" content="José Gregorio Mañan Santana · El Farol al Día">
<meta name="geo.region" content="DO-01">
<meta name="geo.placename" content="Santo Domingo Este, República Dominicana">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${ue}">
<link rel="alternate" hreflang="es-DO" href="${ue}">
<meta property="og:type" content="article">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${ue}">
<meta property="og:site_name" content="El Farol al Día · Último Minuto SDE">
<meta property="og:locale" content="es_DO">
<meta property="article:published_time" content="${fi}">
<meta property="article:section" content="${sec}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta name="twitter:site" content="@elfarolaldia">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(bread)}</script>`;
}

function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ñ]/g,'n').replace(/[ü]/g,'u').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').substring(0,75);
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
        await client.query(`CREATE TABLE IF NOT EXISTS noticias(id SERIAL PRIMARY KEY,titulo VARCHAR(255) NOT NULL,slug VARCHAR(255) UNIQUE,seccion VARCHAR(100),contenido TEXT,seo_description VARCHAR(160),seo_keywords VARCHAR(255),redactor VARCHAR(100),imagen TEXT,imagen_alt VARCHAR(255),imagen_caption TEXT,imagen_nombre VARCHAR(100),imagen_fuente VARCHAR(50),vistas INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,estado VARCHAR(50) DEFAULT 'publicada')`);
        for (const col of ['imagen_alt','imagen_caption','imagen_nombre','imagen_fuente','imagen_original']) {
            await client.query(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}') THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT; END IF; END$$;`).catch(()=>{});
        }
        await client.query(`CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE TABLE IF NOT EXISTS memoria_ia(id SERIAL PRIMARY KEY,tipo VARCHAR(50) NOT NULL,valor TEXT NOT NULL,categoria VARCHAR(100),exitos INTEGER DEFAULT 0,fallos INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memoria_tipo ON memoria_ia(tipo, categoria)`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS comentarios(id SERIAL PRIMARY KEY,noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,nombre VARCHAR(80) NOT NULL,texto TEXT NOT NULL,aprobado BOOLEAN DEFAULT true,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_comentarios_noticia ON comentarios(noticia_id, aprobado, fecha DESC)`).catch(()=>{});
        await client.query(`
            CREATE TABLE IF NOT EXISTS publicidad (
                id SERIAL PRIMARY KEY,
                nombre_espacio VARCHAR(100) NOT NULL,
                url_afiliado TEXT DEFAULT '',
                imagen_url TEXT DEFAULT '',
                ubicacion VARCHAR(50) DEFAULT 'top',
                activo BOOLEAN DEFAULT true,
                ancho_px INTEGER DEFAULT 0,
                alto_px INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        for (const col of ['ancho_px INTEGER DEFAULT 0', 'alto_px INTEGER DEFAULT 0']) {
            const nombre = col.split(' ')[0];
            await client.query(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='publicidad' AND column_name='${nombre}') THEN ALTER TABLE publicidad ADD COLUMN ${col}; END IF; END$$;`).catch(()=>{});
        }
        const countPub = await client.query('SELECT COUNT(*) FROM publicidad');
        if (parseInt(countPub.rows[0].count) === 0) {
            await client.query(`INSERT INTO publicidad (nombre_espacio, url_afiliado, imagen_url, ubicacion, activo) VALUES ('Banner Principal Top', '', '', 'top', false),('Banner Sidebar Derecha', '', '', 'sidebar', false),('Banner Entre Noticias', '', '', 'medio', false),('Banner Footer', '', '', 'footer', false)`);
            console.log('📢 Espacios publicitarios creados');
        }
        const fix = await client.query(`UPDATE noticias SET imagen='${PB}/3052454/pexels-photo-3052454.jpeg${OPT}',imagen_fuente='pexels' WHERE imagen LIKE '%fallback%' OR imagen IS NULL OR imagen=''`);
        if (fix.rowCount > 0) console.log(`🔧 Imágenes reparadas: ${fix.rowCount}`);
        console.log('✅ BD lista');
    } catch(e) { console.error('❌ BD:', e.message); }
    finally { client.release(); }
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// MEMORIA IA — VERSIÓN MXL (ANTI-REPETICIÓN)
// ══════════════════════════════════════════════════════════
async function construirMemoria(categoria, limiteTitulos = 25) {
    let memoria = '';
    try {
        // 🔥 OBTENER ÚLTIMOS 25 TÍTULOS PUBLICADOS (para evitar repetición)
        const recientes = await pool.query(`
            SELECT titulo, seccion, fecha 
            FROM noticias 
            WHERE estado = 'publicada' 
            ORDER BY fecha DESC 
            LIMIT $1
        `, [limiteTitulos]);
        
        if (recientes.rows.length) { 
            memoria += `\n⛔ TEMAS YA PUBLICADOS RECIENTEMENTE — PROHIBIDO REPETIR:\n`;
            memoria += recientes.rows.map((x, i) => `${i+1}. ${x.titulo} [${x.seccion}]`).join('\n'); 
            memoria += `\n⚠️ NO escribir sobre estos temas otra vez. Busca un ÁNGULO DIFERENTE o un tema NUEVO.\n`;
        }
        
        // 🔥 EXTRAER PALABRAS CLAVE PROHIBIDAS automáticamente
        const palabrasProhibidas = new Set();
        for (const row of recientes.rows) {
            const tituloLower = row.titulo.toLowerCase();
            if (tituloLower.includes('juegos centroamericanos')) palabrasProhibidas.add('Juegos Centroamericanos');
            if (tituloLower.includes('acueducto')) palabrasProhibidas.add('Acueducto');
            if (tituloLower.includes('centro de los héroes')) palabrasProhibidas.add('Centro de los Héroes');
            if (tituloLower.includes('alcarrizos')) palabrasProhibidas.add('Alcarrizos');
            if (tituloLower.includes('villa mella')) palabrasProhibidas.add('Villa Mella');
            if (tituloLower.includes('los mina')) palabrasProhibidas.add('Los Mina');
            if (tituloLower.includes('invivienda')) palabrasProhibidas.add('Invivienda');
        }
        
        if (palabrasProhibidas.size > 0) {
            memoria += `\n🚫 TEMAS PROHIBIDOS (ya están muy vistos):\n`;
            memoria += Array.from(palabrasProhibidas).map(p => `- ${p}`).join('\n');
            memoria += `\n✅ En su lugar, busca: calles específicas de SDE, personajes locales, problemas de barrio, proyectos nuevos.\n`;
        }
        
        // 🔥 ERRORES RECIENTES para evitar
        const errores = await pool.query(`
            SELECT valor FROM memoria_ia 
            WHERE tipo='error' AND categoria=$1 
            AND ultima_vez > NOW() - INTERVAL '24 hours' 
            ORDER BY fallos DESC LIMIT 5
        `, [categoria]);
        
        if (errores.rows.length) { 
            memoria += `\n⚠️ ERRORES RECIENTES A EVITAR:\n`; 
            memoria += errores.rows.map(e => `- ${e.valor}`).join('\n'); 
            memoria += '\n'; 
        }
        
    } catch(e) { console.warn('⚠️ Error en construirMemoria:', e.message); }
    return memoria;
}

// ══════════════════════════════════════════════════════════
// 🔍 BÚSQUEDA DE CONTEXTO REAL EN SDE (Google CSE)
// ══════════════════════════════════════════════════════════
async function buscarContextoActualSDE(categoria, tema = '') {
    if (!GOOGLE_CSE_KEYS.length || !GOOGLE_CSE_CX) return '';
    
    const queries = {
        'Nacionales': ['noticias Santo Domingo Este hoy', 'actualidad República Dominicana 2026', 'último minuto RD'],
        'Deportes': ['deportes República Dominicana hoy', 'béisbol dominicano noticias', 'deportes SDE'],
        'Internacionales': ['noticias internacionales impacto RD', 'Caribe noticias hoy', 'América Latina actualidad'],
        'Economía': ['economía República Dominicana 2026', 'negocios Santo Domingo', 'inflación RD hoy'],
        'Tecnología': ['tecnología República Dominicana', 'innovación digital RD', 'startups Santo Domingo'],
        'Espectáculos': ['farándula dominicana hoy', 'música urbana RD', 'entretenimiento Santo Domingo']
    };
    
    const queryList = queries[categoria] || queries['Nacionales'];
    const queryFinal = tema ? `${tema} ${queryList[0]}` : queryList[0];
    
    try {
        const llave = GOOGLE_CSE_KEYS[0];
        const url = `https://www.googleapis.com/customsearch/v1?key=${llave}&cx=${GOOGLE_CSE_CX}&q=${encodeURIComponent(queryFinal)}&num=3`;
        
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tm));
        
        if (!res.ok) return '';
        const data = await res.json();
        const items = data.items || [];
        
        if (!items.length) return '';
        
        let contexto = '\n📰 CONTEXTO ACTUAL DE SANTO DOMINGO ESTE (noticias reales hoy):\n';
        for (const item of items.slice(0, 2)) {
            contexto += `- ${item.title}\n  ${item.snippet?.substring(0, 200) || ''}\n  Fuente: ${item.link}\n`;
        }
        contexto += '\n⚠️ USA ESTO COMO REFERENCIA — NO COPIES TEXTUAL. Basa tu noticia en hechos reales de SDE.\n';
        return contexto;
        
    } catch(err) {
        console.warn(`⚠️ Contexto SDE falló: ${err.message}`);
        return '';
    }
}

// ══════════════════════════════════════════════════════════
// ✅ VALIDADOR DE CONTENIDO — MXL EDITION
// ══════════════════════════════════════════════════════════
function validarContenido(contenido, titulo, categoria) {
    const longitud = contenido.length;
    const palabras = contenido.split(/\s+/).length;
    
    // 🔥 VALIDACIÓN DE LONGITUD MÍNIMA (600 caracteres = ~100-120 palabras)
    if (longitud < 600) {
        return { 
            valido: false, 
            razon: `Contenido insuficiente (${longitud} chars, mínimo 600)`,
            sugerencia: 'Agrega más detalles específicos: nombres de calles, testimonios de vecinos, datos de fechas, contexto del barrio.'
        };
    }
    
    // 🔥 VALIDACIÓN DE MENCIONES DE BARRIOS SDE
    const barriosSDE = ['Los Mina', 'Invivienda', 'Charles de Gaulle', 'Ensanche Ozama', 'Sabana Perdida', 'Villa Mella', 'El Almirante', 'Mendoza', 'Los Trinitarios', 'San Isidro'];
    const barriosMencionados = barriosSDE.filter(b => contenido.toLowerCase().includes(b.toLowerCase()));
    
    if (barriosMencionados.length === 0) {
        return { 
            valido: false, 
            razon: 'No menciona ningún barrio de Santo Domingo Este',
            sugerencia: `Menciona al menos uno de estos barrios: ${barriosSDE.slice(0, 5).join(', ')}. La gente de SDE necesita sentirse identificada.`
        };
    }
    
    // 🔥 VALIDACIÓN DE PÁRRAFOS (mínimo 4 párrafos)
    const parrafos = contenido.split(/\n\s*\n/).filter(p => p.trim().length > 20);
    if (parrafos.length < 4) {
        return { 
            valido: false, 
            razon: `Solo ${parrafos.length} párrafos detectados (mínimo 4)`,
            sugerencia: 'Divide el texto en más párrafos cortos. Máximo 3 líneas por párrafo para lectura en celular.'
        };
    }
    
    // 🔥 VALIDACIÓN DE LENGUAJE DOMINICANO
    const frasesClave = ['se supo', 'fue confirmado', 'según fuentes', 'la gente del sector', 'vecinos dicen', 'en el barrio', 'en la calle'];
    const tieneLenguajeBarrio = frasesClave.some(f => contenido.toLowerCase().includes(f));
    
    if (!tieneLenguajeBarrio) {
        return { 
            valido: false, 
            razon: 'Falta lenguaje de barrio dominicano',
            sugerencia: `Usa frases como "${frasesClave.join('", "')}". El lector de SDE habla así.`
        };
    }
    
    return { valido: true, longitud, palabras, barrios: barriosMencionados, parrafos: parrafos.length };
}

async function registrarQueryPexels(query, categoria, exito) {
    try {
        await pool.query(`INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('pexels_query',$1,$2,$3,$4) ON CONFLICT DO NOTHING`,[query,categoria,exito?1:0,exito?0:1]);
        await pool.query(`UPDATE memoria_ia SET exitos=exitos+$1,fallos=fallos+$2,ultima_vez=NOW() WHERE tipo='pexels_query' AND valor=$3 AND categoria=$4`,[exito?1:0,exito?0:1,query,categoria]);
    } catch(e) {}
}

async function registrarError(tipo, descripcion, categoria) {
    try {
        await pool.query(`INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES('error',$1,$2,1) ON CONFLICT DO NOTHING`,[descripcion.substring(0,200),categoria]);
        await pool.query(`UPDATE memoria_ia SET fallos=fallos+1,ultima_vez=NOW() WHERE tipo='error' AND valor=$1`,[descripcion.substring(0,200)]);
    } catch(e) {}
}

async function regenerarWatermarks() {
    try {
        const r = await pool.query(`SELECT id,imagen,imagen_nombre,imagen_original FROM noticias WHERE imagen LIKE '%/img/%' AND imagen_original IS NOT NULL AND imagen_original!='' ORDER BY fecha DESC LIMIT 50`);
        if (!r.rows.length) return;
        let regeneradas = 0;
        for (const n of r.rows) {
            const nombre = n.imagen_nombre||n.imagen.split('/img/')[1];
            if (!nombre) continue;
            const ruta = path.join('/tmp', nombre);
            if (fs.existsSync(ruta)) continue;
            const resultado = await aplicarMarcaDeAgua(n.imagen_original);
            if (resultado.procesada && resultado.nombre) {
                await pool.query(`UPDATE noticias SET imagen=$1,imagen_nombre=$2 WHERE id=$3`,[`${BASE_URL}/img/${resultado.nombre}`,resultado.nombre,n.id]);
                regeneradas++;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        if (regeneradas > 0) { console.log(`🏮 Watermarks regenerados: ${regeneradas}`); invalidarCache(); }
    } catch(e) {}
}

// ══════════════════════════════════════════════════════════
// 📰 GENERAR NOTICIA — V35.0 MXL (CON REINTENTOS Y VALIDACIÓN)
// ══════════════════════════════════════════════════════════
async function generarNoticia(categoria, comunicadoExterno = null, reintento = 1) {
    const MAX_REINTENTOS = 3;
    
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };
        
        // 🔥 MÓDULO 1: INVESTIGACIÓN PREVIA (memoria + contexto real)
        console.log(`\n📰 [MXL V35.0] Generando noticia - Intento ${reintento}/${MAX_REINTENTOS}`);
        
        const memoria = await construirMemoria(categoria, 25);
        const contextoActual = await buscarContextoActualSDE(categoria);
        
        const fuenteContenido = comunicadoExterno
            ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado.`
            : `\nEscribe una noticia NUEVA sobre la categoría "${categoria}" para República Dominicana, con enfoque en Santo Domingo Este. Que sea un hecho REAL y RELEVANTE del contexto actual (año 2026).`;
        
        const temaParaWiki = comunicadoExterno ? (comunicadoExterno.split('\n')[0] || '').replace(/^T[IÍ]TULO:\s*/i, '').trim() || categoria : categoria;
        const contextoWiki = await buscarContextoWikipedia(temaParaWiki, categoria);
        const esCategoriaAlta = CATEGORIAS_ALTO_CPM.includes(categoria);
        
        // ── LÍNEA 2: Leer estrategia antes del prompt ─────────
        const estrategia = leerEstrategia();
        
        // 🔥 PROMPT DINÁMICO CON EXIGENCIAS CLARAS
        const promptTexto = `${CONFIG_IA.instruccion_principal}

ROL: Redactor jefe de El Farol al Día. Voz del barrio de SDE.
MARCO TEMPORAL: Hoy es ABRIL 2026. NADA de fechas pasadas.

🎯 REQUISITOS OBLIGATORIOS (MXL):
1. MÍNIMO 600 CARACTERES (aproximadamente 5-6 párrafos)
2. Menciona SÍ o SÍ al menos UN barrio de SDE: Los Mina, Invivienda, Charles de Gaulle, Ensanche Ozama, Sabana Perdida, Villa Mella, El Almirante.
3. Usa lenguaje dominicano real: "se supo", "fue confirmado", "según fuentes del sector", "la gente del barrio dice".
4. Cada párrafo: máximo 3 líneas. El lector usa celular.
5. Primera oración = gancho directo. NADA de "En el día de hoy..." o "Se informa que..."

${memoria}
${contextoActual}
${contextoWiki}
${fuenteContenido}

CATEGORÍA: ${categoria}
EXTENSIÓN: ${esCategoriaAlta ? '550-650' : '450-550'} palabras, mínimo 5 párrafos
EVITAR: ${CONFIG_IA.evitar} + NO repetir temas de la lista "TEMAS YA PUBLICADOS"
ÉNFASIS: ${CONFIG_IA.enfasis}

${estrategia}

RESPONDE EXACTAMENTE (sin texto extra):
TITULO: [60-70 chars, impactante, clickbait ético, menciona SDE o barrio si aplica]
DESCRIPCION: [150-160 chars, atrapante]
PALABRAS: [5 keywords separadas por comas]
SUBTEMA_LOCAL: [uno de: ${Object.keys(BANCO_LOCAL).join(', ')}]
CONTENIDO:
[párrafos cortos separados por línea en blanco - MÍNIMO 600 CARACTERES TOTAL]`;

        console.log(`   📝 Enviando prompt a Gemini (intento ${reintento})...`);
        const textoGemini = await llamarGemini(promptTexto);
        const textoLimpio = textoGemini.replace(/^\s*[*#]+\s*/gm, '');
        
        let titulo = '', desc = '', pals = '', sub = '', contenido = '';
        let enContenido = false;
        const bloques = [];
        
        for (const linea of textoLimpio.split('\n')) {
            const t = linea.trim();
            if (t.startsWith('TITULO:')) titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:')) desc = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:')) pals = t.replace('PALABRAS:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:')) enContenido = true;
            else if (enContenido && t.length > 0) bloques.push(t);
        }
        
        contenido = bloques.join('\n\n');
        titulo = titulo.replace(/[*_#`"]/g, '').trim();
        desc = desc.replace(/[*_#`]/g, '').trim();
        
        if (!titulo) throw new Error('Gemini no devolvió TITULO');
        
        // 🔥 VALIDACIÓN DE CALIDAD
        const validacion = validarContenido(contenido, titulo, categoria);
        
        if (!validacion.valido) {
            console.log(`   ⚠️ Validación fallida: ${validacion.razon}`);
            console.log(`   💡 Sugerencia: ${validacion.sugerencia}`);
            
            if (reintento < MAX_REINTENTOS) {
                console.log(`   🔄 Reintentando con más presión (intento ${reintento + 1}/${MAX_REINTENTOS})...`);
                await new Promise(r => setTimeout(r, 3000));
                return await generarNoticia(categoria, comunicadoExterno, reintento + 1);
            } else {
                throw new Error(`Validación fallida tras ${MAX_REINTENTOS} intentos: ${validacion.razon}`);
            }
        }
        
        console.log(`   ✅ Validación OK: ${validacion.longitud} caracteres, ${validacion.palabras} palabras, barrios: ${validacion.barrios.join(', ')}`);
        
        // 🔥 IMAGEN
        let qi = '', ai = '';
        const promptImagen = `Eres asistente de imagen para periódico dominicano de barrio.
Titular: "${titulo}" | Categoría: ${categoria}
RESPONDE SOLO:
QUERY_IMAGEN: [3-5 palabras inglés, escena periodística real callejera SDE]
ALT_IMAGEN: [15-20 palabras español SEO + Santo Domingo Este República Dominicana]
PROHIBIDO: wedding, couple, flowers, cartoon, pet, stock photo`;

        const respuestaImagen = await llamarGeminiImagen(promptImagen);
        if (respuestaImagen) {
            for (const linea of respuestaImagen.split('\n')) {
                const t = linea.trim();
                if (t.startsWith('QUERY_IMAGEN:')) qi = t.replace('QUERY_IMAGEN:', '').trim();
                if (t.startsWith('ALT_IMAGEN:')) ai = t.replace('ALT_IMAGEN:', '').trim();
            }
        }

        const urlOrig = await obtenerImagenInteligente(titulo, categoria, sub, qi);
        const imgResult = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal = imgResult.procesada ? `${BASE_URL}/img/${imgResult.nombre}` : urlOrig;
        const altFinal = generarAltSEO(titulo, categoria, ai, sub);

        const slugBase = slugify(titulo);
        if (!slugBase || slugBase.length < 3) throw new Error(`Slug inválido`);
        let slFin = slugBase;
        const existeSlug = await pool.query('SELECT id FROM noticias WHERE slug=$1', [slugBase]);
        if (existeSlug.rows.length) { slFin = `${slugBase.substring(0, 68)}-${Date.now().toString().slice(-6)}`; }

        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [titulo.substring(0, 255), slFin, categoria, contenido.substring(0, 10000), desc.substring(0, 160), (pals || categoria).substring(0, 255), redactor(categoria), urlFinal, altFinal.substring(0, 255), `Fotografía periodística: ${titulo}`, imgResult.nombre || 'efd.jpg', imgResult.procesada ? 'cse-watermark' : 'cse', urlOrig, 'publicada']
        );

        console.log(`\n✅ /noticia/${slFin} [${validacion.longitud} chars, ${validacion.palabras} palabras]`);
        invalidarCache();
        if (qi && queryEsPeriodistica(qi, categoria)) registrarQueryPexels(qi, categoria, true);

        // 🔔 Notificación push
        await enviarNotificacionPush(titulo, desc.substring(0, 160), slFin, urlFinal);

        Promise.allSettled([
            publicarEnFacebook(titulo, slFin, urlFinal, desc),
            publicarEnTwitter(titulo, slFin, desc),
            publicarEnTelegram(titulo, slFin, urlFinal, desc, categoria)
        ]);

        return { success: true, slug: slFin, titulo, alt: altFinal, mensaje: '✅ Publicada', stats: validacion };
        
    } catch (error) {
        console.error(`❌ Error en intento ${reintento}:`, error.message);
        
        if (reintento < MAX_REINTENTOS) {
            console.log(`🔄 Reintentando por error (${reintento + 1}/${MAX_REINTENTOS})...`);
            await new Promise(r => setTimeout(r, 5000));
            return await generarNoticia(categoria, comunicadoExterno, reintento + 1);
        }
        
        await registrarError('generacion', error.message, categoria);
        return { success: false, error: error.message };
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
    {url:'https://mepyd.gob.do/feed',categoria:'Economía',nombre:'MEPyD'},
    {url:'https://www.invivienda.gob.do/feed',categoria:'Nacionales',nombre:'Invivienda'},
    {url:'https://www.diariolibre.com/feed',categoria:'Nacionales',nombre:'Diario Libre'},
    {url:'https://listindiario.com/feed',categoria:'Nacionales',nombre:'Listín Diario'},
    {url:'https://elnacional.com.do/feed/',categoria:'Nacionales',nombre:'El Nacional'},
    {url:'https://www.eldinero.com.do/feed/',categoria:'Economía',nombre:'El Dinero'},
    {url:'https://acento.com.do/feed/',categoria:'Nacionales',nombre:'Acento'},
    {url:'https://www.hoy.com.do/feed/',categoria:'Nacionales',nombre:'Hoy'},
    {url:'https://www.noticiassin.com/feed/',categoria:'Nacionales',nombre:'Noticias SIN'},
    {url:'https://www.cdt.com.do/feed/',categoria:'Deportes',nombre:'CDT Deportes'},
    {url:'https://www.reuters.com/arc/outboundfeeds/rss/category/latam/?outputType=xml',categoria:'Internacionales',nombre:'Reuters LatAm'},
    {url:'https://feeds.bbci.co.uk/mundo/rss.xml',categoria:'Internacionales',nombre:'BBC Mundo'},
    {url:'https://feeds.feedburner.com/TechCrunch',categoria:'Tecnología',nombre:'TechCrunch'},
    {url:'https://feeds.bloomberg.com/markets/news.rss',categoria:'Economía',nombre:'Bloomberg Markets'},
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
        } catch(err) { console.warn(`   ⚠️ ${fuente.nombre}: ${err.message}`); }
    }
    console.log(`\n📡 RSS: ${procesadas} noticias`);
}

// ══════════════════════════════════════════════════════════
// CRON
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
    const cat = CATS[Math.floor(hora/2) % CATS.length];
    await generarNoticia(cat);
});

cron.schedule('30 8,19 * * *', async () => { await procesarRSS(); });

// ── LÍNEA 3: Cron estrategia cada 6 horas ────────────────
cron.schedule('0 */6 * * *', async () => {
    console.log('📊 Cron estrategia: actualizando...');
    try {
        await analizarYGenerar();
    } catch(err) {
        console.error('❌ Error cron estrategia:', err.message);
    }
});
// ─────────────────────────────────────────────────────────

async function rafagaInicial() {
    if (!CONFIG_IA.enabled) return;
    for (let i = 1; i <= 2; i++) {
        if (i > 1) await new Promise(r => setTimeout(r, 30*60*1000));
        try { await generarNoticia(CATS[i-1]||CATS[0]); } catch(e) {}
    }
}

// ══════════════════════════════════════════════════════════
// RUTAS API
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => res.json({ status:'OK', version:'35.0-mxl+push+antirepeticion' }));

let _cacheNoticias = null, _cacheFecha = 0;
const CACHE_TTL = 60*1000;
function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

app.options('/api/noticias', (req,res)=>{ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); res.sendStatus(200); });

app.get('/api/noticias', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Cache-Control','public,max-age=60');
    res.setHeader('Content-Type','application/json');
    try {
        if (_cacheNoticias && (Date.now()-_cacheFecha) < CACHE_TTL) return res.json({success:true,noticias:_cacheNoticias,cached:true});
        const r = await pool.query(`SELECT id,titulo,slug,seccion,imagen,imagen_alt,seo_description,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30`,['publicada']);
        _cacheNoticias = r.rows; _cacheFecha = Date.now();
        res.json({ success:true, noticias:r.rows });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) as c, SUM(vistas) as v FROM noticias WHERE estado=$1',['publicada']);
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
        const altFinal = imagen_alt || `${titulo} - noticias Santo Domingo Este El Farol al Día`;
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
        } catch(wmErr) { console.warn(`   ⚠️ Watermark manual falló: ${wmErr.message}`); }
        await pool.query(`INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [titulo,slF,seccion,contenido,seo_description||titulo.substring(0,155),seo_keywords||seccion,red||'Manual',imgFinal,altFinal,`Fotografía: ${titulo}`,imgNombre,imgFuente,imgOriginal,'publicada']);
        invalidarCache();
        await enviarNotificacionPush(titulo, (seo_description||titulo).substring(0,160), slF, imgFinal);
        res.json({ success:true, slug:slF });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/eliminar/:id', authMiddleware, async (req, res) => {
    const { pin } = req.body;
    if (pin !== '311') return res.status(403).json({ success:false, error:'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success:false, error:'ID inválido' });
    try { await pool.query('DELETE FROM noticias WHERE id=$1',[id]); invalidarCache(); res.json({ success:true }); }
    catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/actualizar-imagen/:id', authMiddleware, async (req, res) => {
    const { pin, imagen } = req.body;
    if (pin !== '311') return res.status(403).json({ success:false, error:'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id||!imagen) return res.status(400).json({ success:false, error:'Faltan datos' });
    try { await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2',[imagen,id]); invalidarCache(); res.json({ success:true }); }
    catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/comentarios/:noticia_id', async (req, res) => {
    try {
        const r = await pool.query(`SELECT id,nombre,texto,fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC`,[req.params.noticia_id]);
        res.json({ success:true, comentarios:r.rows });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/comentarios/:noticia_id', async (req, res) => {
    const { nombre, texto } = req.body;
    const noticia_id = parseInt(req.params.noticia_id);
    if (isNaN(noticia_id)||noticia_id<=0) return res.status(400).json({ success:false, error:'ID inválido' });
    if (!nombre?.trim()||!texto?.trim()) return res.status(400).json({ success:false, error:'Nombre y comentario requeridos' });
    if (texto.trim().length < 3) return res.status(400).json({ success:false, error:'Comentario muy corto' });
    if (texto.trim().length > 1000) return res.status(400).json({ success:false, error:'Comentario muy largo' });
    try {
        const r = await pool.query(`INSERT INTO comentarios(noticia_id,nombre,texto) VALUES($1,$2,$3) RETURNING id,nombre,texto,fecha`,[noticia_id,nombre.trim().substring(0,80),texto.trim().substring(0,1000)]);
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
        const r = await pool.query(`SELECT c.id,c.nombre,c.texto,c.fecha,n.titulo as noticia_titulo,n.slug as noticia_slug FROM comentarios c JOIN noticias n ON n.id=c.noticia_id ORDER BY c.fecha DESC LIMIT 50`);
        res.json({ success:true, comentarios:r.rows });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/memoria', authMiddleware, async (req, res) => {
    if (req.query.pin!=='311') return res.status(403).json({ error:'PIN requerido' });
    try {
        const r = await pool.query(`SELECT tipo,valor,categoria,exitos,fallos,ultima_vez FROM memoria_ia ORDER BY ultima_vez DESC LIMIT 50`);
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

app.get('/api/telegram/status', authMiddleware, async (req, res) => {
    if (req.query.pin!=='311') return res.status(403).json({ error:'PIN requerido' });
    const chatIdActual = TELEGRAM_CHAT_ID||await obtenerChatIdTelegram();
    res.json({ token_activo:!!TELEGRAM_TOKEN, chat_id:chatIdActual||'No detectado' });
});

app.post('/api/telegram/test', authMiddleware, async (req, res) => {
    if (req.body.pin!=='311') return res.status(403).json({ error:'PIN requerido' });
    const ok = await publicarEnTelegram('🏮 El Farol al Día — Prueba','',`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,'Bot activo!','Nacionales');
    res.json({ success:ok, mensaje:ok?'✅ Mensaje enviado':'❌ Error' });
});

// ══════════════════════════════════════════════════════════
// 📱 RUTAS PUSH NOTIFICATIONS
// ══════════════════════════════════════════════════════════
app.get('/api/push/vapid-key', (req, res) => {
    if (VAPID_PUBLIC_KEY) {
        res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
    } else {
        res.json({ success: false, mensaje: 'Push no configurado' });
    }
});

app.post('/api/push/suscribir', express.json(), async (req, res) => {
    try {
        const { subscription, userAgent } = req.body;
        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return res.status(400).json({ success: false, error: 'Suscripción inválida' });
        }
        await pool.query(`
            INSERT INTO push_suscripciones (endpoint, auth_key, p256dh_key, user_agent)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (endpoint) 
            DO UPDATE SET auth_key = $2, p256dh_key = $3, user_agent = $4, fecha = CURRENT_TIMESTAMP
        `, [
            subscription.endpoint,
            subscription.keys.auth,
            subscription.keys.p256dh,
            userAgent || null
        ]);
        res.json({ success: true, mensaje: '✅ Suscripción guardada' });
    } catch (err) {
        console.error('❌ Error al suscribir:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/push/desuscribir', express.json(), async (req, res) => {
    try {
        const { endpoint } = req.body;
        if (endpoint) {
            await pool.query(`DELETE FROM push_suscripciones WHERE endpoint = $1`, [endpoint]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/push/test', authMiddleware, async (req, res) => {
    const { pin, titulo, mensaje } = req.body;
    if (pin !== '311') return res.status(403).json({ error:'PIN incorrecto' });
    const resultado = await enviarNotificacionPush(
        titulo || '🧪 Prueba El Farol al Día',
        mensaje || 'Esta es una notificación de prueba desde el panel',
        'test',
        `${BASE_URL}/static/favicon.png`
    );
    res.json({ success: resultado });
});

// Ruta pública para ver la estrategia actual
app.get('/api/estrategia', authMiddleware, (req, res) => {
    try {
        const ruta = path.join(__dirname, 'estrategia.json');
        if (!fs.existsSync(ruta)) return res.json({ success:false, mensaje:'Estrategia aún no generada' });
        const data = JSON.parse(fs.readFileSync(ruta, 'utf8'));
        res.json({ success:true, ...data });
    } catch(e) { res.status(500).json({ error:e.message }); }
});

// ══════════════════════════════════════════════════════════
// 📢 RUTAS PUBLICIDAD
// ══════════════════════════════════════════════════════════
app.get('/api/publicidad', authMiddleware, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM publicidad ORDER BY id ASC');
        res.json({ success:true, anuncios:r.rows });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
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
        await pool.query(`UPDATE publicidad SET nombre_espacio=$1, url_afiliado=$2, imagen_url=$3, ubicacion=$4, activo=$5, ancho_px=$6, alto_px=$7 WHERE id=$8`,
            [nombre_espacio||'Sin nombre', url_afiliado||'', imagen_url||'', ubicacion||'top', activo===true||activo==='true', parseInt(ancho_px)||0, parseInt(alto_px)||0, parseInt(id)]);
        res.json({ success:true });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/publicidad/crear', authMiddleware, async (req, res) => {
    const { pin, nombre_espacio, url_afiliado, imagen_url, ubicacion, ancho_px, alto_px } = req.body;
    if (pin !== '311') return res.status(403).json({ error:'PIN incorrecto' });
    if (!nombre_espacio) return res.status(400).json({ error:'Falta nombre' });
    try {
        await pool.query(`INSERT INTO publicidad(nombre_espacio, url_afiliado, imagen_url, ubicacion, activo, ancho_px, alto_px) VALUES($1,$2,$3,$4,true,$5,$6)`,
            [nombre_espacio, url_afiliado||'', imagen_url||'', ubicacion||'top', parseInt(ancho_px)||0, parseInt(alto_px)||0]);
        res.json({ success:true });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/publicidad/eliminar', authMiddleware, async (req, res) => {
    const { pin, id } = req.body;
    if (pin !== '311') return res.status(403).json({ error:'PIN incorrecto' });
    try {
        await pool.query('DELETE FROM publicidad WHERE id=$1', [parseInt(id)]);
        res.json({ success:true });
    } catch(e) { res.status(500).json({ success:false, error:e.message }); }
});

// ══════════════════════════════════════════════════════════
// PÁGINAS
// ══════════════════════════════════════════════════════════
app.get('/',          (req,res) => res.sendFile(path.join(__dirname,'client','index.html')));
app.get('/redaccion', authMiddleware, (req,res) => res.sendFile(path.join(__dirname,'client','redaccion.html')));
app.get('/ingeniero', authMiddleware, (req,res) => res.sendFile(path.join(__dirname,'client','ingeniero.html')));
app.get('/contacto',  (req,res) => res.sendFile(path.join(__dirname,'client','contacto.html')));
app.get('/nosotros',  (req,res) => res.sendFile(path.join(__dirname,'client','nosotros.html')));
app.get('/privacidad',(req,res) => res.sendFile(path.join(__dirname,'client','privacidad.html')));
app.get('/terminos',  (req,res) => res.sendFile(path.join(__dirname,'client','terminos.html')));
app.get('/cookies',   (req,res) => res.sendFile(path.join(__dirname,'client','cookies.html')));

app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2',[req.params.slug,'publicada']);
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
        const r = await pool.query(`SELECT slug,fecha FROM noticias WHERE estado='publicada' AND slug IS NOT NULL ORDER BY fecha DESC LIMIT 1000`);
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
        const r = await pool.query(`SELECT COUNT(*) FROM noticias WHERE estado='publicada'`);
        const rss = await pool.query('SELECT COUNT(*) FROM rss_procesados');
        const ultima = await pool.query(`SELECT fecha,titulo FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 1`);
        const minSin = ultima.rows.length ? Math.round((Date.now()-new Date(ultima.rows[0].fecha))/60000) : 9999;
        const cseActivo = GOOGLE_CSE_KEYS.length > 0 && !!GOOGLE_CSE_CX;
        const estrategiaExiste = fs.existsSync(path.join(__dirname, 'estrategia.json'));
        const pushSuscriptores = await pool.query('SELECT COUNT(*) FROM push_suscripciones');
        res.json({
            status:'OK', version:'35.0-mxl+push+antirepeticion',
            noticias:parseInt(r.rows[0].count), rss_procesados:parseInt(rss.rows[0].count),
            min_sin_publicar:minSin, ultima_noticia:ultima.rows[0]?.titulo?.substring(0,60)||'—',
            gemini_texto:`KEY_1+KEY_2 (${LLAVES_TEXTO.length} activas)`,
            gemini_imagen:`KEY_3+KEY_4 (${LLAVES_IMAGEN.length} activas)`,
            modelo_gemini:'gemini-2.5-flash',
            google_cse:cseActivo?`✅ ${GOOGLE_CSE_KEYS.length} keys activas`:'⚠️ Sin configurar',
            unsplash:UNSPLASH_ACCESS_KEY?'✅ Activo':'⚠️ Sin key',
            pexels:PEXELS_API_KEY?'✅ Fallback activo':'⚠️ Sin key',
            estrategia:estrategiaExiste?'✅ Activa — se actualiza cada 6h':'⚠️ Aún no generada (se genera en 10s)',
            facebook:FB_PAGE_ID&&FB_PAGE_TOKEN?'✅ Activo':'⚠️ Sin credenciales',
            twitter:TWITTER_API_KEY&&TWITTER_ACCESS_TOKEN?'✅ Activo':'⚠️ Sin credenciales',
            telegram:TELEGRAM_TOKEN?'✅ Activo':'⚠️ Sin token',
            watermark:WATERMARK_PATH&&fs.existsSync(WATERMARK_PATH)?'✅ Activa':'⚠️ Sin archivo',
            push_notifications:VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY ? `✅ Activo (${pushSuscriptores.rows[0].count} suscriptores)` : '⚠️ VAPID keys no configuradas',
            ia_activa:CONFIG_IA.enabled,
            adsense:'pub-5280872495839888 ✅',
            publicidad:'✅ Sistema gestor activo',
        });
    } catch(e) { res.status(500).json({ error:e.message }); }
});

app.use((req,res) => res.sendFile(path.join(__dirname,'client','index.html')));

// ══════════════════════════════════════════════════════════
// ARRANQUE - VERSIÓN BLINDADA mxl + PUSH + ANTI-REPETICIÓN
// ══════════════════════════════════════════════════════════
async function iniciar() {
    try {
        await inicializarBase();
        await initPushTable();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V35.0 MXL EDITION                        ║
╠══════════════════════════════════════════════════════════════════╣
║  ✅ KEY_1+KEY_2 → Gemini texto                                 ║
║  ✅ KEY_3+KEY_4 → Gemini imagen + Google CSE                   ║
║  ✅ Google Custom Search → imágenes reales SDE                 ║
║  ✅ Estrategia: analiza BD cada 6h, inyecta en Gemini          ║
║  ✅ Estilo SDE: párrafos cortos, lenguaje directo              ║
║  ✅ Notificaciones PUSH: alertas al celular en tiempo real     ║
║  ✅ ANTI-REPETICIÓN: 25 títulos + detección automática         ║
║  ✅ VALIDACIÓN: 600+ chars, barrios SDE, lenguaje dominicano   ║
║  ✅ REINTENTOS AUTOMÁTICOS (3 intentos)                        ║
╚══════════════════════════════════════════════════════════════════╝`);
        });

        setTimeout(() => { 
            if (typeof regenerarWatermarks === 'function') regenerarWatermarks(); 
        }, 5000);

        setTimeout(() => { 
            if (typeof bienvenidaTelegram === 'function') bienvenidaTelegram(); 
        }, 8000);

        setTimeout(() => { 
            if (typeof rafagaInicial === 'function') rafagaInicial(); 
        }, 60000);

        setTimeout(() => {
            console.log('📊 Iniciando primer análisis de estrategia...');
            if (typeof analizarYGenerar === 'function') {
                analizarYGenerar().catch(err => console.error('❌ Error en análisis inicial:', err.message));
            }
        }, 10000);

    } catch (err) {
        console.error('❌ ERROR CRÍTICO EN ARRANQUE:', err.message);
        process.exit(1);
    }
}

iniciar();
module.exports = app;
