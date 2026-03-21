/**
 * 🏮 EL FAROL AL DÍA — V34.11
 * Base: V34.11
 * Cambios:
 *   1. Watermark: WATERMARK(1).png prioritario exacto
 *   2. Gemini: gemini-2.5-flash, v1beta, AbortController 60s
 *   3. Railway: regenerarWatermarks + RSS secuenciales, anti-overlap
 *   4. Panel: /api/coach, /api/memoria, /api/estadisticas alineadas
 *   5. FIX 429: pausa 2s entre imágenes, batch 20
 *   6. IMÁGENES V2: Pixabay como banco 2, filtro realismo -illustration -render -3d
 *   7. QUERY_IMAGEN periodístico específico (Gemini genera query real de prensa)
 *   8. Wikipedia: solo contexto texto, eliminada de búsqueda de imágenes
 */

'use strict';

// ─── HEADERS DE NAVEGADOR — para que cualquier servidor acepte nuestras peticiones
const BROWSER_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept':          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'es-DO,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control':   'no-cache',
    'Pragma':          'no-cache',
    'Referer':         'https://www.google.com/',
    'sec-fetch-dest':  'image',
    'sec-fetch-mode':  'no-cors',
    'sec-fetch-site':  'cross-site',
};

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const crypto    = require('crypto');

// ─── BASIC AUTH ───────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Dia - Redaccion"');
        return res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Acceso Restringido</title>
<style>body{background:#070707;color:#EDE8DF;font-family:Arial,sans-serif;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#141418;border:1px solid #FF5500;border-radius:12px;padding:40px;
text-align:center;max-width:380px}h2{color:#FF5500;font-size:22px;margin-bottom:10px}
p{color:#A89F94;font-size:14px;margin-bottom:20px}
a{display:inline-block;background:#FF5500;color:#fff;padding:10px 24px;
border-radius:6px;text-decoration:none;font-weight:bold}</style></head>
<body><div class="box"><h2>ACCESO RESTRINGIDO</h2>
<p>Usuario: <strong>director</strong><br>Contrasena: <strong>311</strong></p>
<a href="/redaccion">ENTRAR</a></div></body></html>`);
    }
    try {
        const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
        const [user, ...pp] = decoded.split(':');
        if (user === 'director' && pp.join(':') === '311') return next();
    } catch (_) {}
    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Dia - Redaccion"');
    return res.status(401).send('Credenciales incorrectas.');
}

// ─── ENTORNO ──────────────────────────────────────────────────────────────────
const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = (process.env.BASE_URL || 'https://elfarolaldia.com').replace(/\/$/, '');

if (!process.env.DATABASE_URL)   { console.error('[FATAL] DATABASE_URL requerido');   process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('[FATAL] GEMINI_API_KEY requerido'); process.exit(1); }

const PEXELS_API_KEY        = process.env.PEXELS_API_KEY        || null;
const PIXABAY_API_KEY       = process.env.PIXABAY_API_KEY       || null;
const FB_PAGE_ID            = process.env.FB_PAGE_ID            || null;
const FB_PAGE_TOKEN         = process.env.FB_PAGE_TOKEN         || null;
const TWITTER_API_KEY       = process.env.TWITTER_API_KEY       || null;
const TWITTER_API_SECRET    = process.env.TWITTER_API_SECRET    || null;
const TWITTER_ACCESS_TOKEN  = process.env.TWITTER_ACCESS_TOKEN  || null;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || null;
const TELEGRAM_TOKEN        = process.env.TELEGRAM_TOKEN        || null;
let   TELEGRAM_CHAT_ID      = process.env.TELEGRAM_CHAT_ID      || null;

// ─── WATERMARK — FIX 1 ───────────────────────────────────────────────────────
// Orden de búsqueda: el nombre exacto del repo va PRIMERO.
// Si ninguno existe → null → publicación continúa sin marca (no rompe nada).
const WATERMARK_CANDIDATES = [
    'WATERMARK(1).png',   // <- nombre exacto en el repositorio actual
    'watermark(1).png',
    'WATERMARK (1).png',
    'watermark (1).png',
    'WATERMARK(2).png',
    'watermark (2).png',
    'WATERMARK.png',
    'watermark.png',
    'watermark-logo.png',
    'logo-watermark.png',
];

const WATERMARK_PATH = (() => {
    for (const name of WATERMARK_CANDIDATES) {
        const full = path.join(__dirname, 'static', name);
        if (fs.existsSync(full)) {
            console.log('[Watermark] Encontrado: static/' + name);
            return full;
        }
    }
    console.warn('[Watermark] No encontrado en /static — se publicará sin marca de agua.');
    return null;
})();

// ─── POOL + PARSERS ───────────────────────────────────────────────────────────
const pool      = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const rssParser = new RSSParser({ timeout: 10000 });

// ─── MIDDLEWARES ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'public,max-age=2592000,immutable'),
}));
app.use(express.static(path.join(__dirname, 'client'), {
    setHeaders: (res, fp) => {
        if (/\.(jpg|jpeg|png|gif|webp|ico|svg)$/i.test(fp))
            res.setHeader('Cache-Control', 'public,max-age=2592000,immutable');
        else if (/\.(css|js)$/i.test(fp))
            res.setHeader('Cache-Control', 'public,max-age=86400');
    },
}));
app.use(cors({
    origin: '*',
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
}));
app.options('*', cors());

// ─── WIKIPEDIA ────────────────────────────────────────────────────────────────
const WIKI_TERMINOS_RD = {
    'los mina':           'Los Mina Santo Domingo',
    'invivienda':         'Instituto Nacional de la Vivienda Republica Dominicana',
    'ensanche ozama':     'Ensanche Ozama Santo Domingo Este',
    'santo domingo este': 'Santo Domingo Este',
    'policia nacional':   'Policia Nacional Republica Dominicana',
    'presidencia':        'Presidencia de la Republica Dominicana',
    'banco central':      'Banco Central de la Republica Dominicana',
    'beisbol':            'Beisbol en Republica Dominicana',
    'turismo':            'Turismo en Republica Dominicana',
    'economia':           'Economia de Republica Dominicana',
    'haiti':              'Relaciones entre Republica Dominicana y Haiti',
};

async function buscarContextoWikipedia(titulo, categoria) {
    try {
        const tl = titulo.toLowerCase();
        let termino = null;
        for (const [k, v] of Object.entries(WIKI_TERMINOS_RD)) {
            if (tl.includes(k)) { termino = v; break; }
        }
        if (!termino) {
            const map = {
                Nacionales:      `${titulo} Republica Dominicana`,
                Deportes:        `${titulo} deporte dominicano`,
                Internacionales: `${titulo} America Latina`,
                Economia:        `${titulo} economia dominicana`,
                Tecnologia:      titulo,
                Espectaculos:    `${titulo} cultura dominicana`,
            };
            termino = map[categoria] || `${titulo} Republica Dominicana`;
        }

        const ctrl1 = new AbortController();
        const t1 = setTimeout(() => ctrl1.abort(), 5000);
        const r1 = await fetch(
            `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(termino)}&format=json&srlimit=1&origin=*`,
            { signal: ctrl1.signal }
        ).finally(() => clearTimeout(t1));
        if (!r1.ok) return '';

        const d1  = await r1.json();
        const pid = d1?.query?.search?.[0]?.pageid;
        if (!pid) return '';

        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 5000);
        const r2 = await fetch(
            `https://es.wikipedia.org/w/api.php?action=query&pageids=${pid}&prop=extracts&exintro=true&exchars=800&format=json&origin=*`,
            { signal: ctrl2.signal }
        ).finally(() => clearTimeout(t2));
        if (!r2.ok) return '';

        const d2  = await r2.json();
        const ext = d2?.query?.pages?.[pid]?.extract;
        if (!ext) return '';

        const txt = ext.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600);
        console.log(`   [Wiki] OK (${txt.length} chars)`);
        return `\nCONTEXTO REFERENCIA (no copiar):\n${txt}\n`;
    } catch (_) { return ''; }
}

// ─── FACEBOOK ─────────────────────────────────────────────────────────────────
async function publicarEnFacebook(titulo, slug, urlImagen, descripcion) {
    if (!FB_PAGE_ID || !FB_PAGE_TOKEN) return false;
    try {
        const urlN = `${BASE_URL}/noticia/${slug}`;
        const msg  = `${titulo}\n\n${descripcion || ''}\n\nLee la noticia completa:\n${urlN}\n\n#ElFarolAlDia #RepublicaDominicana #NoticiaRD`;
        const f = new URLSearchParams();
        f.append('url', urlImagen);
        f.append('caption', msg);
        f.append('access_token', FB_PAGE_TOKEN);
        const res = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, { method: 'POST', body: f });
        const data = await res.json();
        if (data.error) {
            const f2 = new URLSearchParams();
            f2.append('message', msg);
            f2.append('link', urlN);
            f2.append('access_token', FB_PAGE_TOKEN);
            const r2   = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, { method: 'POST', body: f2 });
            const d2   = await r2.json();
            if (d2.error) { console.warn('[FB] ' + d2.error.message); return false; }
        }
        console.log('   [FB] OK');
        return true;
    } catch (err) { console.warn('[FB] ' + err.message); return false; }
}

// ─── TWITTER ──────────────────────────────────────────────────────────────────
function generarOAuthHeader(method, url, params, ck, cs, at, ts) {
    const op = {
        oauth_consumer_key:     ck,
        oauth_nonce:            crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
        oauth_token:            at,
        oauth_version:          '1.0',
    };
    const all = { ...params, ...op };
    const sp  = Object.keys(all).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`).join('&');
    const bs  = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sp)}`;
    const sk  = `${encodeURIComponent(cs)}&${encodeURIComponent(ts)}`;
    op.oauth_signature = crypto.createHmac('sha1', sk).update(bs).digest('base64');
    return 'OAuth ' + Object.keys(op).sort().map(k => `${encodeURIComponent(k)}="${encodeURIComponent(op[k])}"`).join(', ');
}

async function publicarEnTwitter(titulo, slug, descripcion) {
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) return false;
    try {
        const urlN  = `${BASE_URL}/noticia/${slug}`;
        const txt   = `${titulo}\n\n${urlN}\n\n#ElFarolAlDia #RD`;
        const tweet = txt.length > 280 ? txt.substring(0, 277) + '...' : txt;
        const tUrl  = 'https://api.twitter.com/2/tweets';
        const auth  = generarOAuthHeader('POST', tUrl, {}, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET);
        const res   = await fetch(tUrl, {
            method:  'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text: tweet }),
        });
        const data = await res.json();
        if (data.errors || data.error) { console.warn('[TW] ' + JSON.stringify(data.errors || data.error)); return false; }
        console.log('   [TW] OK id=' + data.data?.id);
        return true;
    } catch (err) { console.warn('[TW] ' + err.message); return false; }
}

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────
async function obtenerChatIdTelegram() {
    if (!TELEGRAM_TOKEN) return null;
    try {
        const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?limit=1&offset=-1`);
        const d = await r.json();
        if (d.ok && d.result?.length) {
            const id = d.result[0]?.message?.chat?.id || d.result[0]?.channel_post?.chat?.id;
            if (id) { TELEGRAM_CHAT_ID = id.toString(); return TELEGRAM_CHAT_ID; }
        }
    } catch (_) {}
    return null;
}

async function publicarEnTelegram(titulo, slug, urlImagen, descripcion, seccion) {
    if (!TELEGRAM_TOKEN) return false;
    if (!TELEGRAM_CHAT_ID) TELEGRAM_CHAT_ID = await obtenerChatIdTelegram();
    if (!TELEGRAM_CHAT_ID) return false;
    try {
        const urlN  = `${BASE_URL}/noticia/${slug}`;
        const emoji = { Nacionales: '🇩🇴', Deportes: '⚾', Internacionales: '🌎', Economia: '💰', Tecnologia: '💻', Espectaculos: '🎭' }[seccion] || '📰';
        const msg   = `${emoji} *${titulo}*\n\n${descripcion || ''}\n\n[Leer noticia completa](${urlN})\n\n*El Farol al Dia*`;

        if (urlImagen) {
            const ri = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: urlImagen, caption: msg, parse_mode: 'Markdown' }),
            });
            const di = await ri.json();
            if (di.ok) { console.log('   [TG] OK'); return true; }
        }
        const rt = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' }),
        });
        const dt = await rt.json();
        if (dt.ok) { console.log('   [TG] OK'); return true; }
        return false;
    } catch (err) { console.warn('[TG] ' + err.message); return false; }
}

async function bienvenidaTelegram() {
    if (!TELEGRAM_TOKEN) return;
    await new Promise(r => setTimeout(r, 3000));
    const id = await obtenerChatIdTelegram();
    if (!id) return;
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id:    id,
                text:       `*El Farol al Dia — V34.4 activo*\n\nServidor listo.\n\n[elfarolaldia.com](${BASE_URL})`,
                parse_mode: 'Markdown',
            }),
        });
    } catch (_) {}
}

// ─── WATERMARK (aplicación) ───────────────────────────────────────────────────
async function aplicarMarcaDeAgua(urlImagen) {
    if (!WATERMARK_PATH) {
        // Sin archivo -> no lanzar error, continuar con imagen original
        return { url: urlImagen, procesada: false };
    }
    try {
        const response = await fetch(urlImagen, { headers: BROWSER_HEADERS });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const bufOrig = Buffer.from(await response.arrayBuffer());

        const meta    = await sharp(bufOrig).metadata();
        const w       = meta.width  || 800;
        const h       = meta.height || 500;
        const wmAncho = Math.min(Math.round(w * 0.28), 300);
        const wmRes   = await sharp(WATERMARK_PATH).resize(wmAncho, null, { fit: 'inside' }).toBuffer();
        const wmMeta  = await sharp(wmRes).metadata();
        const wmAlto  = wmMeta.height || 60;
        const margen  = Math.round(w * 0.02);

        const bufFin = await sharp(bufOrig)
            .composite([{
                input: wmRes,
                left:  Math.max(0, w - wmAncho - margen),
                top:   Math.max(0, h - wmAlto  - margen),
                blend: 'over',
            }])
            .jpeg({ quality: 88 })
            .toBuffer();

        const nombre = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
        fs.writeFileSync(path.join('/tmp', nombre), bufFin);
        console.log('   [WM] ' + nombre);
        return { url: urlImagen, nombre, procesada: true };
    } catch (err) {
        console.warn('[WM] Error (continuando sin marca): ' + err.message);
        return { url: urlImagen, procesada: false };
    }
}

app.get('/img/:nombre', (req, res) => {
    const ruta = path.join('/tmp', path.basename(req.params.nombre));
    if (fs.existsSync(ruta)) {
        res.setHeader('Content-Type',  'image/jpeg');
        res.setHeader('Cache-Control', 'public,max-age=604800');
        return res.sendFile(ruta);
    }
    res.status(404).send('No disponible');
});

// ─── CONFIG IA ────────────────────────────────────────────────────────────────
const CONFIG_IA_DEFAULT = {
    enabled:               true,
    instruccion_principal: 'Periodista élite de El Farol al Día. Cobertura RD completa, Caribe y mundo. SEO máximo, pirámide invertida estricta, datos verificables, impacto ciudadano real.',
    tono:                  'profesional-urgente',
    extension:             'completa',
    enfasis:               'Nacional: prioriza SDE, Los Mina, Invivienda, Ensanche Ozama, Gran Santo Domingo. Internacional: conecta siempre con impacto económico en RD y el Caribe.',
    evitar:                'Relleno sin valor. Citas inventadas. Titulares vagos. Repetir noticias ya publicadas. Adjetivos sin datos que los respalden.',
};
let CONFIG_IA = { ...CONFIG_IA_DEFAULT };

async function cargarConfigIA() {
    try {
        const r = await pool.query("SELECT valor FROM memoria_ia WHERE tipo='config_ia' ORDER BY ultima_vez DESC LIMIT 1");
        if (r.rows.length) {
            CONFIG_IA = { ...CONFIG_IA_DEFAULT, ...JSON.parse(r.rows[0].valor) };
            console.log('[IA] Config cargada desde BD');
        } else {
            console.log('[IA] Config por defecto');
        }
    } catch (_) { CONFIG_IA = { ...CONFIG_IA_DEFAULT }; }
}

async function guardarConfigIA(cfg) {
    try {
        const v = JSON.stringify(cfg);
        await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('config_ia',$1,'sistema',1,0) ON CONFLICT DO NOTHING", [v]);
        await pool.query("UPDATE memoria_ia SET valor=$1,ultima_vez=NOW() WHERE tipo='config_ia' AND categoria='sistema'", [v]);
        return true;
    } catch (_) { return false; }
}

// ─── GEMINI — FIX 2 ──────────────────────────────────────────────────────────
// Modelo  : gemini-2.5-flash (estable en v1beta)
// Timeout : 60 s con AbortController — clearTimeout en .finally() es obligatorio
//           para que Node no mantenga el timer activo después de la respuesta.
const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_TIMEOUT = 60000;
const GS = { lastRequest: 0, resetTime: 0 };

async function llamarGemini(prompt, reintentos = 3) {
    for (let i = 0; i < reintentos; i++) {
        let tm;
        try {
            console.log(`   [Gemini] intento ${i + 1}/${reintentos}`);

            // Respetar ventana de rate-limit local
            const ahora = Date.now();
            if (ahora < GS.resetTime) {
                const espera = Math.min(GS.resetTime - ahora, 15000);
                console.log(`   [Gemini] rate-limit local, esperando ${espera} ms`);
                await new Promise(r => setTimeout(r, espera));
            }
            const lag = Date.now() - GS.lastRequest;
            if (lag < 3000) await new Promise(r => setTimeout(r, 3000 - lag));
            GS.lastRequest = Date.now();

            // AbortController con cleanup garantizado en .finally()
            const ctrl = new AbortController();
            tm = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT);

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal:  ctrl.signal,
                    body: JSON.stringify({
                        contents:         [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.8, maxOutputTokens: 4000 },
                    }),
                }
            ).finally(() => clearTimeout(tm));

            if (res.status === 429) {
                const espera = Math.pow(2, i) * 5000;
                GS.resetTime = Date.now() + espera;
                console.warn(`   [Gemini] 429 rate-limit, backoff ${espera} ms`);
                await new Promise(r => setTimeout(r, espera));
                continue;
            }
            if (res.status === 503 || res.status === 502) {
                const espera = Math.pow(2, i) * 4000;
                console.warn(`   [Gemini] ${res.status}, backoff ${espera} ms`);
                await new Promise(r => setTimeout(r, espera));
                continue;
            }
            if (!res.ok) throw new Error('HTTP ' + res.status);

            const data  = await res.json();
            const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!texto) throw new Error('Respuesta vacía de Gemini');

            console.log(`   [Gemini] OK (${texto.length} chars)`);
            return texto;

        } catch (err) {
            if (tm) clearTimeout(tm); // seguridad extra si .finally() no se ejecutó
            const label = err.name === 'AbortError' ? `TIMEOUT (${GEMINI_TIMEOUT / 1000}s)` : err.message;
            console.error(`   [Gemini] ERROR intento ${i + 1}: ${label}`);
            if (i < reintentos - 1) await new Promise(r => setTimeout(r, Math.pow(2, i) * 3000));
        }
    }
    throw new Error(`Gemini no respondió tras ${reintentos} intentos`);
}

// ─── FILTRO REALISMO E-E-A-T ─────────────────────────────────────────────────
// Concatenamos términos de prensa real a cada query para evitar ilustraciones AI
const REALISMO = 'people news editorial press journalism';

function queryRealista(q) {
    return `${q} ${REALISMO}`.trim();
}

// ─── MAPEO PERSONAJES → QUERY ESPECÍFICO ─────────────────────────────────────
// Si Gemini menciona una figura conocida en el título, usamos queries de prensa real
const MAPEO_IMAGENES = {
    'trump':              ['Donald Trump press conference podium', 'Trump White House speech official'],
    'donald trump':       ['Donald Trump press conference podium', 'Trump White House official ceremony'],
    'biden':              ['Joe Biden White House podium press', 'US president official speech podium'],
    'abinader':           ['Luis Abinader presidente dominicano discurso', 'presidente dominicano palacio nacional'],
    'luis abinader':      ['Luis Abinader presidente dominicano discurso', 'Dominican Republic president official ceremony'],
    'leonel':             ['Leonel Fernandez politico dominicano', 'latin american politician speech podium'],
    'danilo':             ['Dominican Republic president speech', 'Caribbean government leader official'],
    'messi':              ['Lionel Messi soccer match stadium', 'Argentina football player game action'],
    'ronaldo':            ['Cristiano Ronaldo football match action', 'professional soccer player stadium crowd'],
    'david ortiz':        ['David Ortiz baseball player Red Sox', 'MLB baseball hitter batting stadium'],
    'pedro martinez':     ['Pedro Martinez baseball pitcher mound', 'MLB pitcher strikeout stadium crowd'],
    'elon musk':          ['Elon Musk press conference speaking', 'Tesla SpaceX CEO official event'],
    'putin':              ['Vladimir Putin Kremlin official ceremony', 'Russia president podium speech'],
    'zelensky':           ['Zelensky Ukraine president war press', 'Ukrainian president official address'],
    'biden':              ['Joe Biden White House press briefing', 'US president official podium speech'],
    'harris':             ['Kamala Harris official press conference', 'US vice president ceremony podium'],
    'netanyahu':          ['Netanyahu Israel prime minister speech', 'Israel prime minister official press'],
    'beisbol':            ['baseball game stadium crowd fans', 'MLB baseball player batting pitch action'],
    'futbol':             ['soccer football match stadium action', 'professional football players game crowd'],
    'policia':            ['police patrol latin america officers', 'law enforcement officer uniform street'],
    'haiti':              ['Haiti Dominican border officials', 'Haitian Dominican Republic diplomacy news'],
    'invivienda':         ['social housing construction Caribbean workers', 'residential building construction workers latin'],
    'turismo':            ['Punta Cana beach resort luxury tourism', 'Dominican Republic Caribbean beach tourist'],
    'banco central':      ['central bank building financial district', 'bank official building finance news'],
    'mopc':               ['road construction highway workers equipment', 'infrastructure bridge construction workers'],
    'wall street':        ['Wall Street New York Stock Exchange floor', 'NYSE traders stock market financial'],
    'fed ':               ['Federal Reserve building Washington DC', 'central bank interest rates decision press'],
    'petróleo':           ['oil barrel petroleum refinery production', 'crude oil energy market news'],
    'petroleo':           ['oil barrel petroleum refinery production', 'crude oil energy market news'],
    'huracán':            ['hurricane satellite image tropical storm', 'hurricane damage aftermath aerial view'],
    'huracan':            ['hurricane satellite image tropical storm', 'hurricane damage caribbean news'],
    'terremoto':          ['earthquake damage buildings rubble news', 'seismic damage rescue workers'],
    'congreso':           ['US Congress Capitol building Washington', 'lawmakers congress session vote'],
    'senado':             ['Dominican Republic Senate session', 'Caribbean parliament session lawmakers'],
    'corte':              ['Supreme Court building judges gavel', 'courthouse justice legal news'],
    'elecciones':         ['election polling station voters ballots', 'vote counting election officials'],
};

// ─── PEXELS ───────────────────────────────────────────────────────────────────
const PEXELS_BLOQ = [
    // Mascotas y animales
    'cat','dog','pet','kitten','puppy','animal','bird','horse','fish',
    // Bodas y romance
    'wedding','bride','groom','couple','romance','valentine','love',
    // Moda y lifestyle
    'fashion','model','beauty','makeup','hair','yoga','meditation','spa',
    // Comida y cocina
    'food','cooking','recipe','coffee','drink','restaurant','cafe','cake',
    // Naturaleza genérica
    'flower','sunset','landscape','nature','forest','mountain','sky',
    // Oficina genérica
    'notebook','pencil','pen','desk','office','laptop','computer abstract',
    // Comercio
    'sale','shopping','gift','toy','black friday','discount','store',
    // Celebraciones
    'birthday','party','celebration','christmas','holiday',
    // Bebés y familia
    'baby','toddler','child playing','family portrait',
    // Viajes genéricos
    'travel','vacation','beach umbrella','tourist',
];

async function buscarEnPexels(queries) {
    if (!PEXELS_API_KEY) return null;
    const lista = (Array.isArray(queries) ? queries : [queries])
        .filter(q => !PEXELS_BLOQ.some(b => q.toLowerCase().includes(b)));
    for (const q of lista) {
        try {
            const qReal = queryRealista(q);
            const ctrl  = new AbortController();
            const tm    = setTimeout(() => ctrl.abort(), 6000);
            const res   = await fetch(
                `https://api.pexels.com/v1/search?query=${encodeURIComponent(qReal)}&per_page=20&orientation=landscape&size=large`,
                { headers: { ...BROWSER_HEADERS, Authorization: PEXELS_API_KEY }, signal: ctrl.signal }
            ).finally(() => clearTimeout(tm));
            if (!res.ok) { console.log(`   [Pexels] HTTP ${res.status} para "${q}"`); continue; }
            const data = await res.json();
            if (!data.photos?.length) continue;
            // Filtrar fotos que parezcan stock genérico por el alt text
            const stockWords = ['cat','dog','pet','flower','food','coffee','laptop','desk','sale','gift','toy','baby','sunset','nature','beach'];
            const filtradas = data.photos.filter(p => {
                const alt = (p.alt || '').toLowerCase();
                return !stockWords.some(w => alt.includes(w)) && p.width >= 1200;
            });
            const pool2 = filtradas.length >= 2 ? filtradas : data.photos.filter(p => p.width >= 1200);
            if (!pool2.length) continue;
            const foto = pool2[Math.floor(Math.random() * Math.min(5, pool2.length))];
            console.log(`   [Pexels ✓] "${q}"`);
            await registrarQueryPexels(q, 'auto', true);
            return foto.src.large2x || foto.src.large || foto.src.original;
        } catch (_) { continue; }
    }
    return null;
}

// ─── PIXABAY (banco 2) ────────────────────────────────────────────────────────
const PIXABAY_BLOQ = ['wedding','bride','romantic','fashion','pet','cartoon','vector','illustration','render','clipart'];

async function buscarEnPixabay(query) {
    if (!PIXABAY_API_KEY) return null;
    if (PIXABAY_BLOQ.some(b => query.toLowerCase().includes(b))) return null;
    try {
        const q    = queryRealista(query);
        const ctrl = new AbortController();
        const tm   = setTimeout(() => ctrl.abort(), 6000);
        const res  = await fetch(
            `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal&safesearch=true&per_page=10&min_width=1200&editors_choice=false&order=popular`,
            { headers: BROWSER_HEADERS, signal: ctrl.signal }
        ).finally(() => clearTimeout(tm));
        if (!res.ok) { console.log(`   [Pixabay] HTTP ${res.status}`); return null; }
        const data = await res.json();
        if (!data.hits?.length) return null;
        const foto = data.hits[Math.floor(Math.random() * Math.min(5, data.hits.length))];
        console.log(`   [Pixabay ✓] "${query}"`);
        return foto.largeImageURL || foto.webformatURL;
    } catch (_) { return null; }
}

// ─── BANCO LOCAL (170 fotos — último respaldo) ────────────────────────────────
const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';
const BANCO_LOCAL = {
    'politica-gobierno':         [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,`${PB}/290595/pexels-photo-290595.jpeg${OPT}`,`${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`,`${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`,`${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,`${PB}/2990644/pexels-photo-2990644.jpeg${OPT}`,`${PB}/3184418/pexels-photo-3184418.jpeg${OPT}`,`${PB}/5668481/pexels-photo-5668481.jpeg${OPT}`,`${PB}/3182812/pexels-photo-3182812.jpeg${OPT}`,`${PB}/4427611/pexels-photo-4427611.jpeg${OPT}`],
    'seguridad-policia':         [`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`,`${PB}/5699456/pexels-photo-5699456.jpeg${OPT}`,`${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,`${PB}/6980997/pexels-photo-6980997.jpeg${OPT}`,`${PB}/7491987/pexels-photo-7491987.jpeg${OPT}`,`${PB}/8761572/pexels-photo-8761572.jpeg${OPT}`,`${PB}/5699859/pexels-photo-5699859.jpeg${OPT}`,`${PB}/6289059/pexels-photo-6289059.jpeg${OPT}`,`${PB}/6044266/pexels-photo-6044266.jpeg${OPT}`,`${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`],
    'relaciones-internacionales':[`${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`,`${PB}/358319/pexels-photo-358319.jpeg${OPT}`,`${PB}/3407617/pexels-photo-3407617.jpeg${OPT}`,`${PB}/3997992/pexels-photo-3997992.jpeg${OPT}`,`${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`,`${PB}/3184339/pexels-photo-3184339.jpeg${OPT}`,`${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`,`${PB}/7948035/pexels-photo-7948035.jpeg${OPT}`,`${PB}/3184292/pexels-photo-3184292.jpeg${OPT}`,`${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`],
    'economia-mercado':          [`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`,`${PB}/6772070/pexels-photo-6772070.jpeg${OPT}`,`${PB}/3532557/pexels-photo-3532557.jpeg${OPT}`,`${PB}/6801648/pexels-photo-6801648.jpeg${OPT}`,`${PB}/210607/pexels-photo-210607.jpeg${OPT}`,`${PB}/1602726/pexels-photo-1602726.jpeg${OPT}`,`${PB}/3943723/pexels-photo-3943723.jpeg${OPT}`,`${PB}/7567443/pexels-photo-7567443.jpeg${OPT}`,`${PB}/6120214/pexels-photo-6120214.jpeg${OPT}`,`${PB}/5849559/pexels-photo-5849559.jpeg${OPT}`],
    'infraestructura':           [`${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`,`${PB}/323780/pexels-photo-323780.jpeg${OPT}`,`${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`,`${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`,`${PB}/159306/pexels-photo-159306.jpeg${OPT}`,`${PB}/1463917/pexels-photo-1463917.jpeg${OPT}`,`${PB}/2760241/pexels-photo-2760241.jpeg${OPT}`,`${PB}/247763/pexels-photo-247763.jpeg${OPT}`,`${PB}/1134166/pexels-photo-1134166.jpeg${OPT}`,`${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`],
    'salud-medicina':            [`${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`,`${PB}/40568/pexels-photo-40568.jpeg${OPT}`,`${PB}/4386467/pexels-photo-4386467.jpeg${OPT}`,`${PB}/1170979/pexels-photo-1170979.jpeg${OPT}`,`${PB}/5327580/pexels-photo-5327580.jpeg${OPT}`,`${PB}/3993212/pexels-photo-3993212.jpeg${OPT}`,`${PB}/4021775/pexels-photo-4021775.jpeg${OPT}`,`${PB}/3985163/pexels-photo-3985163.jpeg${OPT}`,`${PB}/5214958/pexels-photo-5214958.jpeg${OPT}`,`${PB}/4226219/pexels-photo-4226219.jpeg${OPT}`],
    'deporte-beisbol':           [`${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`,`${PB}/209977/pexels-photo-209977.jpeg${OPT}`,`${PB}/248318/pexels-photo-248318.jpeg${OPT}`,`${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`,`${PB}/163452/pexels-photo-163452.jpeg${OPT}`,`${PB}/1618200/pexels-photo-1618200.jpeg${OPT}`,`${PB}/2277981/pexels-photo-2277981.jpeg${OPT}`,`${PB}/3041176/pexels-photo-3041176.jpeg${OPT}`,`${PB}/186077/pexels-photo-186077.jpeg${OPT}`,`${PB}/1752757/pexels-photo-1752757.jpeg${OPT}`],
    'deporte-futbol':            [`${PB}/46798/pexels-photo-46798.jpeg${OPT}`,`${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`,`${PB}/3873098/pexels-photo-3873098.jpeg${OPT}`,`${PB}/274422/pexels-photo-274422.jpeg${OPT}`,`${PB}/1171084/pexels-photo-1171084.jpeg${OPT}`,`${PB}/1618200/pexels-photo-1618200.jpeg${OPT}`,`${PB}/2277981/pexels-photo-2277981.jpeg${OPT}`,`${PB}/3041176/pexels-photo-3041176.jpeg${OPT}`,`${PB}/114296/pexels-photo-114296.jpeg${OPT}`,`${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`],
    'deporte-general':           [`${PB}/863988/pexels-photo-863988.jpeg${OPT}`,`${PB}/936094/pexels-photo-936094.jpeg${OPT}`,`${PB}/2526878/pexels-photo-2526878.jpeg${OPT}`,`${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`,`${PB}/1552252/pexels-photo-1552252.jpeg${OPT}`,`${PB}/3764014/pexels-photo-3764014.jpeg${OPT}`,`${PB}/2294353/pexels-photo-2294353.jpeg${OPT}`,`${PB}/1752757/pexels-photo-1752757.jpeg${OPT}`,`${PB}/4761671/pexels-photo-4761671.jpeg${OPT}`,`${PB}/3621517/pexels-photo-3621517.jpeg${OPT}`],
    'tecnologia':                [`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`,`${PB}/2582937/pexels-photo-2582937.jpeg${OPT}`,`${PB}/5632399/pexels-photo-5632399.jpeg${OPT}`,`${PB}/3932499/pexels-photo-3932499.jpeg${OPT}`,`${PB}/1181244/pexels-photo-1181244.jpeg${OPT}`,`${PB}/574071/pexels-photo-574071.jpeg${OPT}`,`${PB}/3861969/pexels-photo-3861969.jpeg${OPT}`,`${PB}/4050315/pexels-photo-4050315.jpeg${OPT}`,`${PB}/5926382/pexels-photo-5926382.jpeg${OPT}`,`${PB}/7988086/pexels-photo-7988086.jpeg${OPT}`],
    'educacion':                 [`${PB}/256490/pexels-photo-256490.jpeg${OPT}`,`${PB}/289737/pexels-photo-289737.jpeg${OPT}`,`${PB}/1205651/pexels-photo-1205651.jpeg${OPT}`,`${PB}/4143791/pexels-photo-4143791.jpeg${OPT}`,`${PB}/301926/pexels-photo-301926.jpeg${OPT}`,`${PB}/5905559/pexels-photo-5905559.jpeg${OPT}`,`${PB}/3769021/pexels-photo-3769021.jpeg${OPT}`,`${PB}/4491461/pexels-photo-4491461.jpeg${OPT}`,`${PB}/4145197/pexels-photo-4145197.jpeg${OPT}`,`${PB}/8617816/pexels-photo-8617816.jpeg${OPT}`],
    'cultura-musica':            [`${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`,`${PB}/1540406/pexels-photo-1540406.jpeg${OPT}`,`${PB}/3651308/pexels-photo-3651308.jpeg${OPT}`,`${PB}/2521317/pexels-photo-2521317.jpeg${OPT}`,`${PB}/1047442/pexels-photo-1047442.jpeg${OPT}`,`${PB}/167636/pexels-photo-167636.jpeg${OPT}`,`${PB}/995301/pexels-photo-995301.jpeg${OPT}`,`${PB}/2191013/pexels-photo-2191013.jpeg${OPT}`,`${PB}/1105666/pexels-photo-1105666.jpeg${OPT}`,`${PB}/1769280/pexels-photo-1769280.jpeg${OPT}`],
    'medio-ambiente':            [`${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`,`${PB}/1366919/pexels-photo-1366919.jpeg${OPT}`,`${PB}/2559941/pexels-photo-2559941.jpeg${OPT}`,`${PB}/414612/pexels-photo-414612.jpeg${OPT}`,`${PB}/247599/pexels-photo-247599.jpeg${OPT}`,`${PB}/1666012/pexels-photo-1666012.jpeg${OPT}`,`${PB}/572897/pexels-photo-572897.jpeg${OPT}`,`${PB}/1021142/pexels-photo-1021142.jpeg${OPT}`,`${PB}/3225517/pexels-photo-3225517.jpeg${OPT}`,`${PB}/1423600/pexels-photo-1423600.jpeg${OPT}`],
    'turismo':                   [`${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`,`${PB}/1174732/pexels-photo-1174732.jpeg${OPT}`,`${PB}/3601425/pexels-photo-3601425.jpeg${OPT}`,`${PB}/2104152/pexels-photo-2104152.jpeg${OPT}`,`${PB}/237272/pexels-photo-237272.jpeg${OPT}`,`${PB}/1450360/pexels-photo-1450360.jpeg${OPT}`,`${PB}/3601453/pexels-photo-3601453.jpeg${OPT}`,`${PB}/994605/pexels-photo-994605.jpeg${OPT}`,`${PB}/1268855/pexels-photo-1268855.jpeg${OPT}`,`${PB}/3155666/pexels-photo-3155666.jpeg${OPT}`],
    'emergencia':                [`${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`,`${PB}/263402/pexels-photo-263402.jpeg${OPT}`,`${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,`${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`,`${PB}/3259629/pexels-photo-3259629.jpeg${OPT}`,`${PB}/4386396/pexels-photo-4386396.jpeg${OPT}`,`${PB}/6129049/pexels-photo-6129049.jpeg${OPT}`,`${PB}/5726825/pexels-photo-5726825.jpeg${OPT}`,`${PB}/7541956/pexels-photo-7541956.jpeg${OPT}`,`${PB}/6129113/pexels-photo-6129113.jpeg${OPT}`],
    'vivienda-social':           [`${PB}/323780/pexels-photo-323780.jpeg${OPT}`,`${PB}/1396122/pexels-photo-1396122.jpeg${OPT}`,`${PB}/2102587/pexels-photo-2102587.jpeg${OPT}`,`${PB}/1370704/pexels-photo-1370704.jpeg${OPT}`,`${PB}/259588/pexels-photo-259588.jpeg${OPT}`,`${PB}/1029599/pexels-photo-1029599.jpeg${OPT}`,`${PB}/280229/pexels-photo-280229.jpeg${OPT}`,`${PB}/534151/pexels-photo-534151.jpeg${OPT}`,`${PB}/1080721/pexels-photo-1080721.jpeg${OPT}`,`${PB}/2724749/pexels-photo-2724749.jpeg${OPT}`],
    'transporte-vial':           [`${PB}/93398/pexels-photo-93398.jpeg${OPT}`,`${PB}/1004409/pexels-photo-1004409.jpeg${OPT}`,`${PB}/1494277/pexels-photo-1494277.jpeg${OPT}`,`${PB}/210182/pexels-photo-210182.jpeg${OPT}`,`${PB}/2199293/pexels-photo-2199293.jpeg${OPT}`,`${PB}/3806978/pexels-photo-3806978.jpeg${OPT}`,`${PB}/1838640/pexels-photo-1838640.jpeg${OPT}`,`${PB}/3802510/pexels-photo-3802510.jpeg${OPT}`,`${PB}/163786/pexels-photo-163786.jpeg${OPT}`,`${PB}/1004409/pexels-photo-1004409.jpeg${OPT}`],
};

const FALLBACK_CAT = {
    Nacionales:      'politica-gobierno',
    Deportes:        'deporte-general',
    Internacionales: 'relaciones-internacionales',
    Economia:        'economia-mercado',
    Tecnologia:      'tecnologia',
    Espectaculos:    'cultura-musica',
};

function imgLocal(sub, cat) {
    const b = BANCO_LOCAL[sub] || BANCO_LOCAL[FALLBACK_CAT[cat]] || BANCO_LOCAL['politica-gobierno'];
    return b[Math.floor(Math.random() * b.length)];
}

// ─── BÚSQUEDA HÍBRIDA: Pexels → Pixabay → Banco Local ────────────────────────
// Orden: 1) MAPEO exacto por personaje/tema → Pexels
//        2) QUERY_IMAGEN de Gemini → Pexels
//        3) QUERY_IMAGEN de Gemini → Pixabay
//        4) Categoría genérica → Pexels
//        5) Categoría genérica → Pixabay
//        6) Banco local (170 fotos garantizadas)
async function obtenerImagenInteligente(titulo, categoria, subtema, queryIA) {
    const tl = titulo.toLowerCase();

    // 1. Mapeo por personaje/figura conocida → Pexels
    for (const [clave, queries] of Object.entries(MAPEO_IMAGENES)) {
        if (tl.includes(clave)) {
            const u = await buscarEnPexels(queries);
            if (u) return u;
            // Si Pexels falla para figura conocida → Pixabay
            const u2 = await buscarEnPixabay(queries[0]);
            if (u2) return u2;
            break;
        }
    }

    // 2. QUERY_IMAGEN específico de Gemini → Pexels
    if (queryIA) {
        const u = await buscarEnPexels([queryIA]);
        if (u) return u;
        // 3. Mismo query → Pixabay
        const u2 = await buscarEnPixabay(queryIA);
        if (u2) return u2;
    }

    // 4. Query genérico de categoría → solo si es periodístico
    // Si el queryIA falló, NO intentar con query genérico (sale gato/lápiz)
    // Ir directo al banco local que tiene fotos reales curadas
    if (queryIA && queryIA.length > 8) {
        // El queryIA ya falló en Pexels y Pixabay — banco local es más seguro
        console.log(`   [Imagen] queryIA falló, usando banco local para "${subtema || categoria}"`);
        return imgLocal(subtema, categoria);
    }

    // Sin queryIA — intentar con query periodístico de categoría
    const MAP_CAT_QUERY = {
        Nacionales:      'Dominican Republic government official press',
        Economia:        'Dominican Republic economy finance bank official',
        Deportes:        'baseball stadium sport game action',
        Internacionales: 'world news press conference official',
        Tecnologia:      'technology cybersecurity data center server',
        Espectaculos:    'concert stage performance live show',
    };
    const qCat = MAP_CAT_QUERY[categoria] || `${categoria} news press`;
    const u3 = await buscarEnPexels([qCat]);
    if (u3) return u3;
    const u4 = await buscarEnPixabay(qCat);
    if (u4) return u4;

    // Banco local garantizado
    console.log(`   [Imagen] Usando banco local para "${subtema || categoria}"`);
    return imgLocal(subtema, categoria);
}

// ─── SEO ──────────────────────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function metaTagsCompletos(n, url) {
    const t   = esc(n.titulo);
    const d   = esc(n.seo_description || '');
    const k   = esc(n.seo_keywords || '');
    const img = esc(n.imagen);
    const fi  = new Date(n.fecha).toISOString();
    const ue  = esc(url);
    const wc  = (n.contenido || '').split(/\s+/).filter(Boolean).length;
    const kw  = [n.seo_keywords || '', 'ultimo minuto republica dominicana', 'santo domingo este noticias', 'el farol al dia'].filter(Boolean).join(', ');

    const schema = {
        '@context':        'https://schema.org',
        '@type':           'NewsArticle',
        mainEntityOfPage:  { '@type': 'WebPage', '@id': url },
        headline:          n.titulo,
        description:       n.seo_description || '',
        image:             { '@type': 'ImageObject', url: n.imagen, caption: n.imagen_caption || n.titulo, width: 1200, height: 630 },
        datePublished:     fi,
        dateModified:      fi,
        author:            { '@type': 'Person', name: 'Jose Gregorio Manan Santana', url: `${BASE_URL}/nosotros`, jobTitle: 'Director General', worksFor: { '@type': 'Organization', name: 'El Farol al Dia' } },
        publisher:         { '@type': 'NewsMediaOrganization', name: 'El Farol al Dia', url: BASE_URL, logo: { '@type': 'ImageObject', url: `${BASE_URL}/static/favicon.png`, width: 512, height: 512 }, address: { '@type': 'PostalAddress', addressLocality: 'Santo Domingo Este', addressRegion: 'Distrito Nacional', addressCountry: 'DO' } },
        articleSection:    n.seccion,
        wordCount:         wc,
        inLanguage:        'es-DO',
        isAccessibleForFree: true,
        locationCreated:   { '@type': 'Place', name: 'Santo Domingo Este, Republica Dominicana' },
    };
    const bread = {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Inicio',          item: BASE_URL },
            { '@type': 'ListItem', position: 2, name: 'Ultimo Minuto RD',item: `${BASE_URL}/` },
            { '@type': 'ListItem', position: 3, name: n.seccion,         item: `${BASE_URL}/#${(n.seccion || '').toLowerCase()}` },
            { '@type': 'ListItem', position: 4, name: n.titulo,          item: url },
        ],
    };
    const tituloSEO = (n.titulo.toLowerCase().includes('santo domingo') || n.titulo.toLowerCase().includes('sde'))
        ? `${t} | El Farol al Dia`
        : `${t} | Ultimo Minuto RD - El Farol al Dia`;

    return `<title>${tituloSEO}</title>
<meta name="description" content="${d}"><meta name="keywords" content="${esc(kw)}">
<meta name="author" content="Jose Gregorio Manan Santana - El Farol al Dia">
<meta name="news_keywords" content="ultimo minuto, santo domingo este, tendencias dominicanas, ${esc(k)}">
<meta name="geo.region" content="DO-01"><meta name="geo.placename" content="Santo Domingo Este, Republica Dominicana">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${ue}"><link rel="alternate" hreflang="es-DO" href="${ue}"><link rel="alternate" hreflang="es" href="${ue}">
<meta property="og:type" content="article"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${ue}"><meta property="og:site_name" content="El Farol al Dia - Ultimo Minuto RD"><meta property="og:locale" content="es_DO">
<meta property="article:published_time" content="${fi}"><meta property="article:author" content="Jose Gregorio Manan Santana">
<meta property="article:section" content="${esc(n.seccion)}"><meta property="article:tag" content="${esc(kw)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${img}"><meta name="twitter:site" content="@elfarolaldia">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(bread)}</script>`;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
}

const REDS = [
    { nombre: 'Carlos Mendez',         esp: 'Nacionales' },
    { nombre: 'Laura Santana',         esp: 'Deportes' },
    { nombre: 'Roberto Pena',          esp: 'Internacionales' },
    { nombre: 'Ana Maria Castillo',    esp: 'Economia' },
    { nombre: 'Jose Miguel Fernandez', esp: 'Tecnologia' },
    { nombre: 'Patricia Jimenez',      esp: 'Espectaculos' },
];
function elegirRedactor(cat) {
    const m = REDS.filter(r => r.esp === cat);
    return m.length ? m[Math.floor(Math.random() * m.length)].nombre : 'Redaccion EFD';
}

let _cacheNoticias = null, _cacheFecha = 0;
const CACHE_TTL = 60000;
function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

// ─── MEMORIA IA ───────────────────────────────────────────────────────────────
async function registrarQueryPexels(query, categoria, exito) {
    try {
        await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('pexels_query',$1,$2,$3,$4) ON CONFLICT DO NOTHING", [query, categoria, exito ? 1 : 0, exito ? 0 : 1]);
        await pool.query("UPDATE memoria_ia SET exitos=exitos+$1,fallos=fallos+$2,ultima_vez=NOW() WHERE tipo='pexels_query' AND valor=$3 AND categoria=$4", [exito ? 1 : 0, exito ? 0 : 1, query, categoria]);
    } catch (_) {}
}

async function registrarError(tipo, descripcion, categoria) {
    try {
        const desc = String(descripcion || '').substring(0, 200);
        await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES('error',$1,$2,1) ON CONFLICT DO NOTHING", [desc, categoria]);
        await pool.query("UPDATE memoria_ia SET fallos=fallos+1,ultima_vez=NOW() WHERE tipo='error' AND valor=$1", [desc]);
    } catch (_) {}
}

async function construirMemoria() {
    try {
        const r = await pool.query("SELECT titulo FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 12");
        if (r.rows.length)
            return '\nYA PUBLICADAS - NO repetir:\n' + r.rows.map((x, i) => `${i + 1}. ${x.titulo}`).join('\n') + '\n';
    } catch (_) {}
    return '';
}

// ─── ADSENSE CPC ALTO ─────────────────────────────────────────────────────────
const ADSENSE_CPC = {
    Nacionales:      'prestamos personales en republica dominicana, tasas de interes hipotecario, credito de vivienda, financiamiento de proyectos',
    Economia:        'inversion inmobiliaria santo domingo, plusvalia propiedades RD, certificados financieros, tasas bancarias dominicanas, seguros de vida y retiro',
    Tecnologia:      'banca digital dominicana, seguridad informatica empresarial, fintech caribe, software de gestion financiera',
    Deportes:        'seguros medicos para atletas, patrocinios corporativos, inversion en infraestructura deportiva, creditos de consumo',
    Internacionales: 'remesas republica dominicana, tipo de cambio dolar peso, inversion extranjera directa, seguros de viaje internacional',
    Espectaculos:    'emprendimiento cultural, patrocinios comerciales en medios, inversion en entretenimiento, banca digital',
};

// ─── BD INIT ──────────────────────────────────────────────────────────────────
async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS noticias(
                id              SERIAL PRIMARY KEY,
                titulo          VARCHAR(255) NOT NULL,
                slug            VARCHAR(255) UNIQUE,
                seccion         VARCHAR(100),
                contenido       TEXT,
                seo_description VARCHAR(160),
                seo_keywords    VARCHAR(255),
                redactor        VARCHAR(100),
                imagen          TEXT,
                imagen_alt      VARCHAR(255),
                imagen_caption  TEXT,
                imagen_nombre   VARCHAR(100),
                imagen_fuente   VARCHAR(50),
                vistas          INTEGER DEFAULT 0,
                fecha           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado          VARCHAR(50) DEFAULT 'publicada'
            )`);

        for (const col of ['imagen_alt','imagen_caption','imagen_nombre','imagen_fuente','imagen_original']) {
            await client.query(`
                DO $$ BEGIN
                    IF NOT EXISTS(SELECT 1 FROM information_schema.columns
                                  WHERE table_name='noticias' AND column_name='${col}')
                    THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT;
                    END IF;
                END $$;`).catch(() => {});
        }

        await client.query(`CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`
            CREATE TABLE IF NOT EXISTS memoria_ia(
                id         SERIAL PRIMARY KEY,
                tipo       VARCHAR(50)  NOT NULL,
                valor      TEXT         NOT NULL,
                categoria  VARCHAR(100),
                exitos     INTEGER DEFAULT 0,
                fallos     INTEGER DEFAULT 0,
                fecha      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memoria_tipo ON memoria_ia(tipo,categoria)`).catch(() => {});
        await client.query(`
            CREATE TABLE IF NOT EXISTS comentarios(
                id         SERIAL PRIMARY KEY,
                noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,
                nombre     VARCHAR(80)  NOT NULL,
                texto      TEXT         NOT NULL,
                aprobado   BOOLEAN DEFAULT true,
                fecha      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_comentarios_noticia ON comentarios(noticia_id,aprobado,fecha DESC)`).catch(() => {});

        const fix = await client.query(`
            UPDATE noticias
            SET imagen='${PB}/3052454/pexels-photo-3052454.jpeg${OPT}', imagen_fuente='pexels'
            WHERE imagen LIKE '%/images/cache/%' OR imagen LIKE '%fallback%' OR imagen IS NULL OR imagen=''`);
        if (fix.rowCount > 0) console.log('[BD] Imágenes reparadas: ' + fix.rowCount);
        console.log('[BD] Lista');
    } catch (e) {
        console.error('[BD] Error de inicialización: ' + e.message);
    } finally {
        client.release();
    }
    await cargarConfigIA();
}

// ─── GENERACIÓN ───────────────────────────────────────────────────────────────
async function generarNoticia(categoria, comunicadoExterno = null, imagenRSSOverride = null) {
    if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };
    try {
        const memoria      = await construirMemoria();
        const temaWiki     = comunicadoExterno
            ? (comunicadoExterno.split('\n')[0] || '').replace(/^TITULO:\s*/i, '').trim() || categoria
            : categoria;
        const contextoWiki = await buscarContextoWikipedia(temaWiki, categoria);

        const fuenteContenido = comunicadoExterno
            ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta noticia profesional basada en este comunicado. No copies textualmente.`
            : `\nEscribe una noticia NUEVA sobre la categoría "${categoria}" para Republica Dominicana.`;

        const termCPC = ADSENSE_CPC[categoria] || 'prestamos, inversion inmobiliaria, seguros, banca digital';

        const prompt = `Eres el MEJOR periodista digital de la República Dominicana. Superas en SEO, claridad y engagement a Listín Diario, Diario Libre y N Digital juntos. Tu medio es El Farol al Día — voz del pueblo dominicano, especialmente de Santo Domingo Este, Los Mina y el Gran Santo Domingo.

IDENTIDAD EDITORIAL:
- Escribes con autoridad, precisión y urgencia. Cada noticia importa.
- Usas datos reales: porcentajes, fechas, nombres de instituciones, cifras del Banco Central, BCRD, MEPyD, ADP, DGII, MOPC, SNS.
- Conectas cada hecho con su impacto en la vida diaria del dominicano de a pie.
- Tu titular es tan bueno que la gente no puede no hacer clic.
- Nunca rellenas. Cada oración aporta valor.
${memoria}
${fuenteContenido}

CATEGORÍA: ${categoria}
ÉNFASIS: ${CONFIG_IA.enfasis}
EVITAR: ${CONFIG_IA.evitar}

ESTRUCTURA PERIODÍSTICA ÉLITE (pirámide invertida estricta):
▸ LEAD (párrafo 1): La noticia completa en 2-3 líneas. Qué pasó + quién + cuándo + dónde + por qué importa. El lector que solo lea esto debe entender todo.
▸ DESARROLLO (párrafo 2): Cifras concretas, contexto histórico, comparación con año anterior o región. Dato duro obligatorio.
▸ FUENTE OFICIAL (párrafo 3): Cita textual o parafraseo de institución real: "El ministro X señaló...", "Según el informe del BCRD...", "La Procuraduría informó...". NUNCA inventar citas — usar fórmulas verificables.
▸ IMPACTO CIUDADANO (párrafo 4): Qué cambia para el dominicano. Costo, beneficio, riesgo real. Integra NATURALMENTE estos términos de alto valor: ${termCPC}
▸ PROYECCIÓN (párrafo 5): Qué sigue. Próxima reunión, votación, implementación, fecha clave. Cierre que da continuidad al lector.

SEO DE ÉLITE:
- TITULO: 55-65 caracteres exactos. Verbo activo al inicio cuando sea posible. Incluir término de búsqueda principal. Ejemplos de estructura ganadora: "Abinader anuncia...", "Sube el precio de...", "RD aprueba ley que...", "Último Minuto: [hecho]"
- DESCRIPCION: 150-158 chars. Amplía el titular con dato nuevo. Termina con gancho.
- PALABRAS: 6 keywords. Primera SIEMPRE "republica dominicana". Incluir variante long-tail.
- QUERY_IMAGEN: Imagen de prensa real. Nombre propio si aplica ("Donald Trump White House podium"), escena real ("Dominican Republic port customs inspection"), nunca conceptual. Piensa: ¿qué foto publicaría Reuters o AP para esta noticia?
- ALT_IMAGEN: 15-20 palabras en español, descriptivas, con RD y contexto.

RESPONDE EXACTAMENTE EN ESTE FORMATO — SIN asteriscos, SIN markdown, SIN texto extra:
TITULO: [55-65 chars]
DESCRIPCION: [150-158 chars]
PALABRAS: [6 keywords separadas por coma]
QUERY_IMAGEN: [3-6 palabras inglés, foto de prensa real específica]
ALT_IMAGEN: [15-20 palabras español con contexto RD]
SUBTEMA_LOCAL: [uno de: politica-gobierno, seguridad-policia, relaciones-internacionales, economia-mercado, infraestructura, salud-medicina, deporte-beisbol, deporte-futbol, deporte-general, tecnologia, educacion, cultura-musica, medio-ambiente, turismo, emergencia, vivienda-social, transporte-vial]
CONTENIDO:
[450-520 palabras. 5 párrafos. Línea en blanco entre cada uno. Sin subtítulos. Sin bullets.]`;

        console.log(`\n[Gen] ${categoria}${comunicadoExterno ? ' (RSS)' : ' (auto)'}`);
        const texto       = await llamarGemini(prompt);
        const textoLimpio = texto.replace(/^\s*[*#]+\s*/gm, '');

        let titulo = '', desc = '', pals = '', qi = '', ai = '', sub = '', enC = false;
        const bl = [];

        for (const l of textoLimpio.split('\n')) {
            const t = l.trim();
            if      (t.startsWith('TITULO:'))        titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:'))   desc   = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:'))      pals   = t.replace('PALABRAS:', '').trim();
            else if (t.startsWith('QUERY_IMAGEN:'))  qi     = t.replace('QUERY_IMAGEN:', '').trim();
            else if (t.startsWith('ALT_IMAGEN:'))    ai     = t.replace('ALT_IMAGEN:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub    = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:'))     enC    = true;
            else if (enC && t.length > 0)            bl.push(t);
        }

        const contenido = bl.join('\n\n');
        titulo = titulo.replace(/[*_#`"]/g, '').trim();
        desc   = desc.replace(/[*_#`]/g, '').trim();

        if (!titulo)                              throw new Error('Gemini no devolvió TITULO');
        if (!contenido || contenido.length < 250) throw new Error(`Contenido insuficiente (${contenido.length} chars)`);

        console.log('[Gen] Título: ' + titulo);

        // Plan C: si el RSS trajo imagen real, validarla y usarla
        let urlOrig;
        if (imagenRSSOverride) {
            try {
                // Verificar que la imagen sea accesible (algunos medios bloquean hotlinking)
                const ctrl = new AbortController();
                const tm   = setTimeout(() => ctrl.abort(), 5000);
                const chk  = await fetch(imagenRSSOverride, {
                    method: 'HEAD',
                    signal: ctrl.signal,
                    headers: BROWSER_HEADERS,
                }).finally(() => clearTimeout(tm));

                if (chk.ok && chk.headers.get('content-type')?.startsWith('image/')) {
                    console.log(`   [IMG-RSS] ✓ Imagen válida del RSS`);
                    urlOrig = imagenRSSOverride;
                } else {
                    console.log(`   [IMG-RSS] Imagen bloqueada (${chk.status}), usando búsqueda normal`);
                    urlOrig = await obtenerImagenInteligente(titulo, categoria, sub, qi);
                }
            } catch (_) {
                console.log(`   [IMG-RSS] No accesible, usando búsqueda normal`);
                urlOrig = await obtenerImagenInteligente(titulo, categoria, sub, qi);
            }
        } else {
            urlOrig = await obtenerImagenInteligente(titulo, categoria, sub, qi);
        }

        // Aplicar watermark — convierte URL externa en elfarolaldia.com/img/...
        // La foto del Listín o Reuters pasa a ser NUESTRA con nuestra marca
        const imgResult = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal  = imgResult.procesada ? `${BASE_URL}/img/${imgResult.nombre}` : urlOrig;
        if (imgResult.procesada) {
            console.log(`   [IMG] URL propia: ${BASE_URL}/img/${imgResult.nombre}`);
        }

        const altFinal = (ai && ai.length > 15)
            ? (ai.toLowerCase().includes('dominicana') || ai.toLowerCase().includes('republic')
                ? `${ai} - El Farol al Dia`
                : `${ai}, noticias Republica Dominicana - El Farol al Dia`)
            : `${titulo.substring(0, 50)} - noticias Santo Domingo Este Republica Dominicana`;

        const sl     = slugify(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
        const slFin  = existe.rows.length ? `${sl}-${Date.now()}` : sl;

        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
                titulo.substring(0, 255), slFin, categoria,
                contenido.substring(0, 10000),
                desc.substring(0, 160),
                (pals || categoria).substring(0, 255),
                elegirRedactor(categoria),
                urlFinal, altFinal.substring(0, 255),
                `Fotografía: ${titulo}`,
                imgResult.nombre || 'efd.jpg',
                'el-farol', urlOrig, 'publicada',
            ]
        );

        console.log('[Gen] Publicada: /noticia/' + slFin);
        invalidarCache();
        if (qi) registrarQueryPexels(qi, categoria, true);

        // Redes sociales en paralelo — no bloquean el flujo principal
        Promise.allSettled([
            publicarEnFacebook(titulo, slFin, urlFinal, desc),
            publicarEnTwitter(titulo, slFin, desc),
            publicarEnTelegram(titulo, slFin, urlFinal, desc, categoria),
        ]).then(results => {
            const etiquetas = ['FB', 'TW', 'TG'];
            const log = results.map((r, i) => `${etiquetas[i]}:${r.status === 'fulfilled' && r.value ? 'OK' : 'ERR'}`).join(' ');
            console.log('   [Redes] ' + log);
        }).catch(() => {});

        return { success: true, slug: slFin, titulo, mensaje: 'Publicada en web + redes' };

    } catch (error) {
        console.error('[Gen] ERROR: ' + error.message);
        await registrarError('generacion', error.message, categoria);
        return { success: false, error: error.message };
    }
}

// ─── RSS — 30 FUENTES ─────────────────────────────────────────────────────────
const FUENTES_RSS = [
    { url: 'https://presidencia.gob.do/feed',          categoria: 'Nacionales',      nombre: 'Presidencia RD' },
    { url: 'https://policia.gob.do/feed',               categoria: 'Nacionales',      nombre: 'Policia Nacional' },
    { url: 'https://www.mopc.gob.do/feed',              categoria: 'Nacionales',      nombre: 'MOPC' },
    { url: 'https://www.salud.gob.do/feed',             categoria: 'Nacionales',      nombre: 'Salud Publica' },
    { url: 'https://www.educacion.gob.do/feed',         categoria: 'Nacionales',      nombre: 'Educacion' },
    { url: 'https://www.bancentral.gov.do/feed',        categoria: 'Economia',        nombre: 'Banco Central' },
    { url: 'https://mepyd.gob.do/feed',                 categoria: 'Economia',        nombre: 'MEPyD' },
    { url: 'https://www.invivienda.gob.do/feed',        categoria: 'Nacionales',      nombre: 'Invivienda' },
    { url: 'https://mitur.gob.do/feed',                 categoria: 'Nacionales',      nombre: 'Turismo' },
    { url: 'https://pgr.gob.do/feed',                   categoria: 'Nacionales',      nombre: 'Procuraduria' },
    { url: 'https://www.diariolibre.com/feed',          categoria: 'Nacionales',      nombre: 'Diario Libre' },
    { url: 'https://listindiario.com/feed',             categoria: 'Nacionales',      nombre: 'Listin Diario' },
    { url: 'https://elnacional.com.do/feed/',           categoria: 'Nacionales',      nombre: 'El Nacional' },
    { url: 'https://www.eldinero.com.do/feed/',         categoria: 'Economia',        nombre: 'El Dinero' },
    { url: 'https://www.elcaribe.com.do/feed/',         categoria: 'Nacionales',      nombre: 'El Caribe' },
    { url: 'https://acento.com.do/feed/',               categoria: 'Nacionales',      nombre: 'Acento' },
    { url: 'https://www.hoy.com.do/feed/',              categoria: 'Nacionales',      nombre: 'Hoy' },
    { url: 'https://www.noticiassin.com/feed/',         categoria: 'Nacionales',      nombre: 'Noticias SIN' },
    { url: 'https://www.cdt.com.do/feed/',              categoria: 'Deportes',        nombre: 'CDT Deportes' },
    { url: 'https://www.beisbolrd.com/feed/',           categoria: 'Deportes',        nombre: 'Beisbol RD' },
    { url: 'https://feeds.bbci.co.uk/mundo/rss.xml',   categoria: 'Internacionales', nombre: 'BBC Mundo' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', categoria: 'Internacionales', nombre: 'NYT World' },
    { url: 'https://feeds.feedburner.com/TechCrunch',  categoria: 'Tecnologia',      nombre: 'TechCrunch' },
    { url: 'https://www.wired.com/feed/rss',            categoria: 'Tecnologia',      nombre: 'Wired' },
    { url: 'https://feeds.bloomberg.com/markets/news.rss', categoria: 'Economia',    nombre: 'Bloomberg' },
    { url: 'https://www.primerahora.com/entretenimiento/feed/', categoria: 'Espectaculos', nombre: 'Primera Hora' },
    { url: 'https://www.reuters.com/arc/outboundfeeds/rss/category/latam/?outputType=xml', categoria: 'Internacionales', nombre: 'Reuters LatAm' },
    { url: 'https://www.elnuevoherald.com/ultimas-noticias/?widgetName=rssfeed&widgetContentId=725095&getXmlFeed=true', categoria: 'Internacionales', nombre: 'El Nuevo Herald' },
    { url: 'https://www.telemundo.com/shows/rss',       categoria: 'Espectaculos',    nombre: 'Telemundo' },
    { url: 'https://www.univision.com/rss',             categoria: 'Espectaculos',    nombre: 'Univision' },
];

// ─── PROCESADOR RSS — FIX 3 (100% secuencial, anti-SIGTERM) ──────────────────
let rssEnProceso = false;

// ─── EXTRACTOR IMAGEN RSS (Plan C) ───────────────────────────────────────────
// Extrae la imagen real de la noticia original del RSS
// Fuentes: enclosure, media:content, og:image en el HTML, itunes:image
function extraerImagenRSS(item) {
    try {
        // 1. enclosure (formato estándar)
        if (item.enclosure?.url && /\.(jpg|jpeg|png|webp)/i.test(item.enclosure.url))
            return item.enclosure.url;

        // 2. media:content (usado por NYT, Reuters, BBC)
        const media = item['media:content'] || item['media:thumbnail'];
        if (media?.$ ?.url && /\.(jpg|jpeg|png|webp)/i.test(media.$.url))
            return media.$.url;
        if (Array.isArray(media)) {
            for (const m of media) {
                if (m.$?.url && /\.(jpg|jpeg|png|webp)/i.test(m.$.url)) return m.$.url;
            }
        }

        // 3. itunes:image (podcasts y algunos feeds)
        if (item['itunes:image']?.$ ?.href) return item['itunes:image'].$.href;

        // 4. Buscar <img> dentro del content HTML
        const html = item.content || item['content:encoded'] || '';
        if (html) {
            const match = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))[^"']*["']/i);
            if (match?.[1] && match[1].startsWith('http')) return match[1];
        }

        // 5. Buscar URL de imagen en contentSnippet
        const snippet = item.contentSnippet || '';
        const urlMatch = snippet.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/i);
        if (urlMatch) return urlMatch[0];

    } catch (_) {}
    return null;
}

async function procesarRSS() {
    if (!CONFIG_IA.enabled) return;
    if (rssEnProceso) { console.log('[RSS] Ya en proceso, ciclo omitido'); return; }

    rssEnProceso = true;
    console.log(`\n[RSS] Ciclo iniciado (${FUENTES_RSS.length} fuentes)`);
    let procesadas = 0;

    for (const fuente of FUENTES_RSS) {
        try {
            const feed = await rssParser.parseURL(fuente.url).catch(() => null);
            if (!feed?.items?.length) continue;

            for (const item of feed.items.slice(0, 3)) {
                const guid = item.guid || item.link || item.title;
                if (!guid) continue;

                const ya = await pool.query(
                    'SELECT id FROM rss_procesados WHERE item_guid=$1',
                    [guid.substring(0, 500)]
                );
                if (ya.rows.length) continue;

                // Plan C: extraer imagen real del RSS antes de llamar a Gemini
                const imagenRSS = extraerImagenRSS(item);
                if (imagenRSS) console.log(`   [RSS-IMG] Imagen real extraída: ${imagenRSS.substring(0, 60)}...`);

                const com = [
                    item.title          ? `TITULO: ${item.title}`                         : '',
                    item.contentSnippet ? `RESUMEN: ${item.contentSnippet}`               : '',
                    item.content        ? `CONTENIDO: ${item.content.substring(0, 1500)}` : '',
                    `FUENTE: ${fuente.nombre}`,
                ].filter(Boolean).join('\n');

                const res = await generarNoticia(fuente.categoria, com, imagenRSS);

                if (res.success) {
                    await pool.query(
                        'INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',
                        [guid.substring(0, 500), fuente.nombre]
                    );
                    procesadas++;
                    // Pausa de 6 s entre noticias para no saturar Gemini ni Railway
                    await new Promise(r => setTimeout(r, 6000));
                }
                break; // Solo 1 ítem por fuente por ciclo
            }
        } catch (err) {
            console.warn(`[RSS] ${fuente.nombre}: ${err.message}`);
        }
        // Pausa de 1 s entre fuentes
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[RSS] Ciclo terminado: ${procesadas} noticias nuevas`);
    rssEnProceso = false;
}

// ─── REGENERAR WATERMARKS — FIX 3 (secuencial, respeta Railway) ──────────────
let wmRegenEnProceso = false;

async function regenerarWatermarksLostidos() {
    if (!WATERMARK_PATH)  { console.log('[WM-Regen] Sin watermark, omitido'); return; }
    if (wmRegenEnProceso) { console.log('[WM-Regen] Ya en proceso');          return; }

    wmRegenEnProceso = true;
    try {
        const r = await pool.query(`
            SELECT id, imagen, imagen_nombre, imagen_original
            FROM   noticias
            WHERE  imagen LIKE '%/img/%'
              AND  imagen_original IS NOT NULL
              AND  imagen_original != ''
            ORDER  BY fecha DESC
            LIMIT  20`);

        if (!r.rows.length) { wmRegenEnProceso = false; return; }

        let regenerados = 0;
        for (const n of r.rows) {
            const nombre = n.imagen_nombre || n.imagen.split('/img/')[1];
            if (!nombre) continue;
            if (fs.existsSync(path.join('/tmp', nombre))) continue;

            const res = await aplicarMarcaDeAgua(n.imagen_original);
            if (res.procesada && res.nombre) {
                await pool.query(
                    'UPDATE noticias SET imagen=$1, imagen_nombre=$2 WHERE id=$3',
                    [`${BASE_URL}/img/${res.nombre}`, res.nombre, n.id]
                );
                regenerados++;
            }
            // Pausa de 2s entre imágenes — evita HTTP 429 de Pexels
            await new Promise(r => setTimeout(r, 2000));
        }

        if (regenerados > 0) { console.log(`[WM-Regen] Regenerados: ${regenerados}`); invalidarCache(); }
    } catch (e) {
        console.error('[WM-Regen] Error: ' + e.message);
    }
    wmRegenEnProceso = false;
}

// ─── COACH — alineado con redaccion.html — FIX 4 ─────────────────────────────
// GET /api/coach?dias=7
// Retorna: { success, periodo, total_noticias, total_vistas, promedio_general,
//            categorias: { [cat]: { total, vistas_totales, vistas_promedio,
//                                   rendimiento, mejor } },
//            errores }
const CATS = ['Nacionales','Deportes','Internacionales','Economia','Tecnologia','Espectaculos'];

async function analizarRendimiento(dias = 7) {
    try {
        const r = await pool.query(`
            SELECT id, titulo, seccion, vistas, fecha
            FROM   noticias
            WHERE  estado = 'publicada'
              AND  fecha  > NOW() - INTERVAL '${parseInt(dias)} days'
            ORDER  BY vistas DESC`);

        if (!r.rows.length) return { success: true, mensaje: 'Sin noticias en el período', noticias: [] };

        const total = r.rows.reduce((s, n) => s + (n.vistas || 0), 0);
        const prom  = Math.round(total / r.rows.length);

        const categorias = {};
        for (const cat of CATS) {
            const rows   = r.rows.filter(n => n.seccion === cat);
            const vistas = rows.reduce((s, n) => s + (n.vistas || 0), 0);
            const p      = rows.length ? Math.round(vistas / rows.length) : 0;
            categorias[cat] = {
                total:           rows.length,
                vistas_totales:  vistas,
                vistas_promedio: p,
                rendimiento:     prom ? Math.round((p / prom) * 100) : 0,
                mejor:           rows[0] ? { titulo: rows[0].titulo, vistas: rows[0].vistas } : null,
            };
        }

        const errores = await pool.query(`
            SELECT valor, fallos, categoria
            FROM   memoria_ia
            WHERE  tipo       = 'error'
              AND  ultima_vez > NOW() - INTERVAL '7 days'
            ORDER  BY fallos DESC
            LIMIT  5`);

        return {
            success:          true,
            periodo:          `${dias} dias`,
            total_noticias:   r.rows.length,
            total_vistas:     total,
            promedio_general: prom,
            categorias,
            errores:          errores.rows,
        };
    } catch (e) { return { success: false, error: e.message }; }
}

// ─── CRON ─────────────────────────────────────────────────────────────────────
cron.schedule('*/14 * * * *', async () => {
    try { await fetch(`http://localhost:${PORT}/health`); } catch (_) {}
});

cron.schedule('0 */4 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    await generarNoticia(CATS[Math.floor(Math.random() * CATS.length)]);
});

cron.schedule('0 1,7,13,19 * * *', async () => {
    await procesarRSS();
});

// ─── RUTAS ESTÁTICAS ──────────────────────────────────────────────────────────
app.get('/health',    (_, res) => res.json({ status: 'OK', version: '34.4', modelo: GEMINI_MODEL }));
app.get('/',          (_, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', authMiddleware, (_, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/contacto',  (_, res) => res.sendFile(path.join(__dirname, 'client', 'contacto.html')));
app.get('/nosotros',  (_, res) => res.sendFile(path.join(__dirname, 'client', 'nosotros.html')));
app.get('/privacidad',(_, res) => res.sendFile(path.join(__dirname, 'client', 'privacidad.html')));
app.get('/terminos',  (_, res) => res.sendFile(path.join(__dirname, 'client', 'terminos.html')));
app.get('/cookies',   (_, res) => res.sendFile(path.join(__dirname, 'client', 'cookies.html')));

// ─── API PÚBLICA ──────────────────────────────────────────────────────────────
app.options('/api/noticias', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(200);
});

app.get('/api/noticias', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public,max-age=60');
    res.setHeader('Content-Type',  'application/json');
    try {
        if (_cacheNoticias && (Date.now() - _cacheFecha) < CACHE_TTL)
            return res.json({ success: true, noticias: _cacheNoticias, cached: true });
        const r = await pool.query(
            `SELECT id,titulo,slug,seccion,imagen,imagen_alt,fecha,vistas,redactor
             FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30`,
            ['publicada']
        );
        _cacheNoticias = r.rows; _cacheFecha = Date.now();
        res.json({ success: true, noticias: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// FIX 4 — /api/estadisticas — alineado con panel redaccion.html
app.get('/api/estadisticas', async (req, res) => {
    try {
        const r = await pool.query(
            "SELECT COUNT(*) AS c, COALESCE(SUM(vistas),0) AS v FROM noticias WHERE estado=$1",
            ['publicada']
        );
        res.json({
            success:       true,
            totalNoticias: parseInt(r.rows[0].c),
            totalVistas:   parseInt(r.rows[0].v),
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// FIX 4 — /api/coach — alineado con panel redaccion.html
app.get('/api/coach', async (req, res) => {
    const dias = Math.max(1, Math.min(90, parseInt(req.query.dias) || 7));
    const a    = await analizarRendimiento(dias);
    res.status(a.success ? 200 : 500).json(a);
});

// FIX 4 — /api/memoria — alineado con panel redaccion.html (pin en query para GET)
app.get('/api/memoria', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    try {
        const r = await pool.query(`
            SELECT tipo, valor, categoria, exitos, fallos,
                   ROUND((exitos::float / GREATEST(exitos + fallos, 1)) * 100) AS pct_exito,
                   ultima_vez
            FROM   memoria_ia
            ORDER  BY ultima_vez DESC
            LIMIT  50`);
        res.json({ success: true, registros: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/wikipedia', async (req, res) => {
    const { tema, categoria } = req.query;
    if (!tema) return res.status(400).json({ error: 'Falta tema' });
    const ctx = await buscarContextoWikipedia(tema, categoria || 'Nacionales');
    res.json({ success: true, longitud: ctx.length, contexto: ctx });
});

// ─── API ADMIN ────────────────────────────────────────────────────────────────
app.post('/api/generar-noticia', authMiddleware, async (req, res) => {
    const { categoria, tema_cpc } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoria' });
    const r = await generarNoticia(categoria, tema_cpc || null);
    res.status(r.success ? 200 : 500).json(r);
});

app.post('/api/procesar-rss', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN incorrecto' });
    procesarRSS();
    res.json({ success: true, mensaje: 'RSS iniciado en background' });
});

app.post('/api/actualizar-imagen/:id', authMiddleware, async (req, res) => {
    const { pin, imagen } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN' });
    const id = parseInt(req.params.id);
    if (!id || !imagen) return res.status(400).json({ success: false, error: 'Faltan datos' });
    try {
        await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2', [imagen, id]);
        invalidarCache();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/eliminar/:id', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ success: false, error: 'PIN' });
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });
    try {
        await pool.query('DELETE FROM noticias WHERE id=$1', [id]);
        invalidarCache();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/comentarios', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    try {
        const r = await pool.query(`
            SELECT c.id, c.nombre, c.texto, c.fecha,
                   n.titulo AS noticia_titulo, n.slug AS noticia_slug
            FROM   comentarios c
            JOIN   noticias n ON n.id = c.noticia_id
            ORDER  BY c.fecha DESC
            LIMIT  50`);
        res.json({ success: true, comentarios: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/comentarios/eliminar/:id', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN' });
    try {
        await pool.query('DELETE FROM comentarios WHERE id=$1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/comentarios/:noticia_id', async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT id,nombre,texto,fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC',
            [req.params.noticia_id]
        );
        res.json({ success: true, comentarios: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/comentarios/:noticia_id', async (req, res) => {
    const { nombre, texto } = req.body;
    const nid = parseInt(req.params.noticia_id);
    if (isNaN(nid) || nid <= 0)            return res.status(400).json({ success: false, error: 'ID inválido' });
    if (!nombre?.trim() || !texto?.trim())  return res.status(400).json({ success: false, error: 'Faltan datos' });
    if (texto.trim().length > 1000)         return res.status(400).json({ success: false, error: 'Texto muy largo' });
    try {
        const r = await pool.query(
            'INSERT INTO comentarios(noticia_id,nombre,texto) VALUES($1,$2,$3) RETURNING id,nombre,texto,fecha',
            [nid, nombre.trim().substring(0, 80), texto.trim().substring(0, 1000)]
        );
        res.json({ success: true, comentario: r.rows[0] });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/telegram/status', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    const id = TELEGRAM_CHAT_ID || await obtenerChatIdTelegram();
    res.json({
        token_activo: !!TELEGRAM_TOKEN,
        chat_id:      id || 'No detectado',
        instruccion:  id ? 'Bot listo' : 'Escríbele al bot para activarlo',
    });
});

app.post('/api/telegram/test', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    const ok = await publicarEnTelegram(
        'El Farol al Dia - Prueba', '',
        `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,
        'Bot activo y funcionando.', 'Nacionales'
    );
    res.json({ success: ok, mensaje: ok ? 'Enviado a Telegram' : 'Error al enviar' });
});

app.get('/api/configuracion', (req, res) => {
    try {
        const p = path.join(__dirname, 'config.json');
        const c = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { googleAnalytics: '' };
        res.json({ success: true, config: c });
    } catch (_) { res.json({ success: true, config: { googleAnalytics: '' } }); }
});

app.post('/api/configuracion', express.json(), (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ success: false, error: 'PIN' });
    try {
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify({ googleAnalytics: req.body.googleAnalytics || '' }, null, 2));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/publicar', express.json(), async (req, res) => {
    const { pin, titulo, seccion, contenido, redactor: red } = req.body;
    if (pin !== '311')                     return res.status(403).json({ success: false, error: 'PIN' });
    if (!titulo || !seccion || !contenido)  return res.status(400).json({ success: false, error: 'Faltan campos' });
    try {
        const sl  = slugify(titulo);
        const ex  = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
        const slF = ex.rows.length ? `${sl}-${Date.now()}` : sl;
        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,estado)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [titulo, slF, seccion, contenido, red || 'Manual',
             `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,
             `${titulo} - noticias Republica Dominicana El Farol al Dia`,
             `Fotografía: ${titulo}`, 'efd.jpg', 'el-farol', 'publicada']
        );
        res.json({ success: true, slug: slF });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/config', authMiddleware, (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    res.json(CONFIG_IA);
});

app.post('/api/admin/config', authMiddleware, express.json(), async (req, res) => {
    const { pin, enabled, instruccion_principal, tono, extension, evitar, enfasis } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    if (enabled !== undefined)  CONFIG_IA.enabled               = enabled;
    if (instruccion_principal)  CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono)                   CONFIG_IA.tono                  = tono;
    if (extension)              CONFIG_IA.extension             = extension;
    if (evitar)                 CONFIG_IA.evitar                = evitar;
    if (enfasis)                CONFIG_IA.enfasis               = enfasis;
    const ok = await guardarConfigIA(CONFIG_IA);
    res.json({ success: ok });
});

// ─── NOTICIA INDIVIDUAL ───────────────────────────────────────────────────────
app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT * FROM noticias WHERE slug=$1 AND estado=$2',
            [req.params.slug, 'publicada']
        );
        if (!r.rows.length) return res.status(404).send('Noticia no encontrada');
        const n = r.rows[0];
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [n.id]);
        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            const urlN  = `${BASE_URL}/noticia/${n.slug}`;
            const cHTML = n.contenido.split('\n').filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('');
            html = html
                .replace('<!-- META_TAGS -->', metaTagsCompletos(n, urlN))
                .replace(/{{TITULO}}/g,    esc(n.titulo))
                .replace(/{{CONTENIDO}}/g, cHTML)
                .replace(/{{FECHA}}/g,     new Date(n.fecha).toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }))
                .replace(/{{IMAGEN}}/g,    n.imagen)
                .replace(/{{ALT}}/g,       esc(n.imagen_alt || n.titulo))
                .replace(/{{VISTAS}}/g,    n.vistas)
                .replace(/{{REDACTOR}}/g,  esc(n.redactor))
                .replace(/{{SECCION}}/g,   esc(n.seccion))
                .replace(/{{URL}}/g,       encodeURIComponent(urlN));
            res.setHeader('Content-Type',  'text/html;charset=utf-8');
            res.setHeader('Cache-Control', 'public,max-age=300');
            res.send(html);
        } catch (_) { res.json({ success: true, noticia: n }); }
    } catch (e) { res.status(500).send('Error interno'); }
});

// ─── SITEMAP / ROBOTS / ADS ───────────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
    try {
        const r   = await pool.query("SELECT slug,fecha FROM noticias WHERE estado='publicada' ORDER BY fecha DESC");
        const now = Date.now();
        let xml   = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;
        for (const n of r.rows) {
            const d    = (now - new Date(n.fecha).getTime()) / 86400000;
            const freq = d < 1 ? 'hourly' : d < 7 ? 'daily' : 'weekly';
            const pri  = d < 1 ? '1.0'    : d < 7 ? '0.9'   : d < 30 ? '0.7' : '0.5';
            xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>\n`;
        }
        xml += '</urlset>';
        res.header('Content-Type',  'application/xml');
        res.header('Cache-Control', 'public,max-age=3600');
        res.send(xml);
    } catch (e) { res.status(500).send('Error'); }
});

app.get('/robots.txt', (_, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nDisallow: /redaccion\n\nUser-agent: Googlebot\nAllow: /\nCrawl-delay: 1\n\nSitemap: ${BASE_URL}/sitemap.xml`);
});

app.get('/ads.txt', (_, res) => {
    res.header('Content-Type', 'text/plain');
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

app.get('/status', async (req, res) => {
    try {
        const r   = await pool.query("SELECT COUNT(*) FROM noticias WHERE estado='publicada'");
        const rss = await pool.query('SELECT COUNT(*) FROM rss_procesados');
        res.json({
            status:         'OK',
            version:        '34.4',
            modelo_gemini:  GEMINI_MODEL,
            timeout_gemini: `${GEMINI_TIMEOUT / 1000}s`,
            noticias:       parseInt(r.rows[0].count),
            rss_procesados: parseInt(rss.rows[0].count),
            facebook:       FB_PAGE_ID && FB_PAGE_TOKEN ? 'Activo' : 'Sin credenciales',
            twitter:        TWITTER_API_KEY && TWITTER_ACCESS_TOKEN ? 'Activo' : 'Sin credenciales',
            telegram:       TELEGRAM_TOKEN ? 'Activo' : 'Sin token',
            pexels_api:     PEXELS_API_KEY   ? 'Activa' : 'Sin key',
            pixabay_api:    PIXABAY_API_KEY  ? 'Activa' : 'Sin key',
            marca_de_agua:  WATERMARK_PATH ? `Activa: ${path.basename(WATERMARK_PATH)}` : 'No encontrada — publicando sin marca',
            ia_activa:      CONFIG_IA.enabled,
            rss_en_proceso: rssEnProceso,
            wm_en_proceso:  wmRegenEnProceso,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Catch-all SPA
app.use((req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// ─── ARRANQUE ─────────────────────────────────────────────────────────────────
async function iniciar() {
    await inicializarBase();
    app.listen(PORT, '0.0.0.0', () => {
        const wm = WATERMARK_PATH ? path.basename(WATERMARK_PATH) : 'NO ENCONTRADO — sin marca';
        console.log(`
╔═══════════════════════════════════════════════════════╗
║        🏮  EL FAROL AL DIA  —  V34.4                ║
╠═══════════════════════════════════════════════════════╣
║  Puerto         : ${String(PORT).padEnd(35)}║
║  Modelo Gemini  : ${GEMINI_MODEL.padEnd(35)}║
║  Pixabay        : ${(PIXABAY_API_KEY ? 'ACTIVO' : 'Sin key (usar Pexels+Local)').padEnd(35)}║
║  Timeout IA     : ${(GEMINI_TIMEOUT / 1000 + 's').padEnd(35)}║
║  Watermark      : ${wm.substring(0, 35).padEnd(35)}║
║  Facebook       : ${(FB_PAGE_ID && FB_PAGE_TOKEN ? 'ACTIVO' : 'Sin credenciales').padEnd(35)}║
║  Twitter        : ${(TWITTER_API_KEY && TWITTER_ACCESS_TOKEN ? 'ACTIVO' : 'Sin credenciales').padEnd(35)}║
║  Telegram       : ${(TELEGRAM_TOKEN ? 'ACTIVO' : 'Sin token').padEnd(35)}║
║  RSS            : 30 fuentes / ejecución secuencial   ║
╚═══════════════════════════════════════════════════════╝`);
    });

    setTimeout(regenerarWatermarksLostidos, 5000);
    setTimeout(bienvenidaTelegram,          8000);
}

iniciar();
module.exports = app;
