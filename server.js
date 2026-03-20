/**
 * 🏮 EL FAROL AL DÍA — V34.0 FINAL
 * + Basic Auth protege /redaccion y /api/admin (usuario: director / clave: 311)
 * + Wikipedia + Wikimedia Commons para imágenes coherentes
 * + Mapeo forzado de personajes públicos (Trump, Ortiz, Abinader...)
 * + Memoria IA en PostgreSQL (persiste entre reinicios)
 * + Banco local 17 categorías × 10 fotos
 * + Coach de redacción + Comentarios + SEO E-E-A-T
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

// ══════════════════════════════════════════════════════════
// 🔒 BASIC AUTH — Protege /redaccion y rutas admin
// Usuario: director | Contraseña: 311
// ══════════════════════════════════════════════════════════
function authMiddleware(req, res, next) {
    const auth = req.headers['authorization'];

    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
        return res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Acceso Restringido</title><style>body{background:#070707;color:#EDE8DF;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{background:#141418;border:1px solid #FF5500;border-radius:12px;padding:40px;text-align:center;max-width:380px}h2{color:#FF5500;font-size:22px;margin-bottom:10px}p{color:#A89F94;font-size:14px;margin-bottom:20px}a{display:inline-block;background:#FF5500;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold}a:hover{background:#CC4300}</style></head><body><div class="box"><h2>🏮 ACCESO RESTRINGIDO</h2><p>El panel de redacción requiere autenticación.<br><br>Usuario: <strong>director</strong><br>Contraseña: <strong>311</strong></p><a href="/redaccion">ENTRAR AL PANEL</a></div></body></html>`);
    }

    try {
        const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
        const [user, ...passParts] = decoded.split(':');
        const pass = passParts.join(':');

        if (user === 'director' && pass === '311') {
            return next();
        }
    } catch(e) { }

    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
    return res.status(401).send('Credenciales incorrectas. Usuario: director / Contraseña: 311');
}

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }

const PEXELS_API_KEY        = process.env.PEXELS_API_KEY        || null;
const FB_PAGE_ID            = process.env.FB_PAGE_ID            || null;
const FB_PAGE_TOKEN         = process.env.FB_PAGE_TOKEN         || null;
const TWITTER_API_KEY       = process.env.TWITTER_API_KEY       || null;
const TWITTER_API_SECRET    = process.env.TWITTER_API_SECRET    || null;
const TWITTER_ACCESS_TOKEN  = process.env.TWITTER_ACCESS_TOKEN  || null;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || null;

const WATERMARK_PATH = (() => {
    const variantes = ['watermark.png', 'WATERMARK(1).png', 'watermark(1).png', 'watermark (1).png', 'WATERMARK.png'];
    for (const nombre of variantes) {
        const ruta = path.join(__dirname, 'static', nombre);
        if (fs.existsSync(ruta)) { console.log(`🏮 Watermark encontrado: ${nombre}`); return ruta; }
    }
    return path.join(__dirname, 'static', 'watermark.png');
})();

const rssParser = new RSSParser({ timeout: 10000 });

// ══════════════════════════════════════════════════════════
// BASE DE DATOS
// ══════════════════════════════════════════════════════════
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'public,max-age=2592000,immutable')
}));
app.use(express.static(path.join(__dirname, 'client'), {
    setHeaders: (res, fp) => {
        if (/\.(jpg|jpeg|png|gif|webp|ico|svg)$/i.test(fp))
            res.setHeader('Cache-Control', 'public,max-age=2592000,immutable');
        else if (/\.(css|js)$/i.test(fp))
            res.setHeader('Cache-Control', 'public,max-age=86400');
    }
}));

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.options('*', cors());

// ══════════════════════════════════════════════════════════
// WIKIPEDIA API
// ══════════════════════════════════════════════════════════

const WIKI_TERMINOS_RD = {
    'los mina':          'Los Mina Santo Domingo',
    'invivienda':        'Instituto Nacional de la Vivienda República Dominicana',
    'ensanche ozama':    'Ensanche Ozama Santo Domingo Este',
    'santo domingo este':'Santo Domingo Este',
    'sabana perdida':    'Sabana Perdida Santo Domingo',
    'villa mella':       'Villa Mella Santo Domingo',
    'policia nacional':  'Policía Nacional República Dominicana',
    'presidencia':       'Presidencia de la República Dominicana',
    'procuraduria':      'Procuraduría General de la República Dominicana',
    'banco central':     'Banco Central de la República Dominicana',
    'beisbol':           'Béisbol en República Dominicana',
    'turismo':           'Turismo en República Dominicana',
    'economia':          'Economía de República Dominicana',
    'educacion':         'Educación en República Dominicana',
    'salud publica':     'Ministerio de Salud Pública República Dominicana',
    'mopc':              'Ministerio de Obras Públicas República Dominicana',
    'haití':             'Relaciones entre República Dominicana y Haití',
};

async function buscarContextoWikipedia(titulo, categoria) {
    try {
        const tituloLower = titulo.toLowerCase();
        let terminoBusqueda = null;

        for (const [clave, termino] of Object.entries(WIKI_TERMINOS_RD)) {
            if (tituloLower.includes(clave)) {
                terminoBusqueda = termino;
                break;
            }
        }

        if (!terminoBusqueda) {
            const mapaCategoria = {
                'Nacionales':       `${titulo} República Dominicana`,
                'Deportes':         `${titulo} deporte dominicano`,
                'Internacionales':  `${titulo} América Latina Caribe`,
                'Economía':         `${titulo} economía dominicana`,
                'Tecnología':       titulo,
                'Espectáculos':     `${titulo} cultura dominicana`,
            };
            terminoBusqueda = mapaCategoria[categoria] || `${titulo} República Dominicana`;
        }

        const urlBusqueda = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(terminoBusqueda)}&format=json&srlimit=3&origin=*`;
        const ctrlBusq    = new AbortController();
        const tmBusq      = setTimeout(() => ctrlBusq.abort(), 6000);
        const resBusqueda = await fetch(urlBusqueda, { signal: ctrlBusq.signal }).finally(() => clearTimeout(tmBusq));
        if (!resBusqueda.ok) return '';

        const dataBusqueda = await resBusqueda.json();
        const resultados   = dataBusqueda?.query?.search;
        if (!resultados?.length) return '';

        const paginaId = resultados[0].pageid;

        const urlExtracto = `https://es.wikipedia.org/w/api.php?action=query&pageids=${paginaId}&prop=extracts&exintro=true&exchars=1500&format=json&origin=*`;
        const ctrlExtr    = new AbortController();
        const tmExtr      = setTimeout(() => ctrlExtr.abort(), 6000);
        const resExtracto = await fetch(urlExtracto, { signal: ctrlExtr.signal }).finally(() => clearTimeout(tmExtr));
        if (!resExtracto.ok) return '';

        const dataExtracto = await resExtracto.json();
        const pagina       = dataExtracto?.query?.pages?.[paginaId];
        if (!pagina?.extract) return '';

        const textoLimpio = pagina.extract
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 1200);

        console.log(`   📚 Wikipedia: "${resultados[0].title}" (${textoLimpio.length} chars)`);
        return `\n📚 CONTEXTO WIKIPEDIA:\nArtículo: "${resultados[0].title}"\n${textoLimpio}\n`;

    } catch (err) {
        console.log(`   📚 Wikipedia: no disponible (${err.message})`);
        return '';
    }
}

// ══════════════════════════════════════════════════════════
// FACEBOOK
// ══════════════════════════════════════════════════════════
async function publicarEnFacebook(titulo, slug, urlImagen, descripcion) {
    if (!FB_PAGE_ID || !FB_PAGE_TOKEN) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const mensaje    = `🏮 ${titulo}\n\n${descripcion || ''}\n\nLee la noticia completa 👇\n${urlNoticia}\n\n#ElFarolAlDía #RepúblicaDominicana #NoticiaRD`;

        const form = new URLSearchParams();
        form.append('url',          urlImagen);
        form.append('caption',      mensaje);
        form.append('access_token', FB_PAGE_TOKEN);

        const res  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, { method: 'POST', body: form });
        const data = await res.json();

        if (data.error) {
            const form2 = new URLSearchParams();
            form2.append('message',      mensaje);
            form2.append('link',         urlNoticia);
            form2.append('access_token', FB_PAGE_TOKEN);
            const res2  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, { method: 'POST', body: form2 });
            const data2 = await res2.json();
            if (data2.error) { console.warn(`   ⚠️ FB: ${data2.error.message}`); return false; }
        }

        console.log(`   📘 Facebook ✅`);
        return true;
    } catch (err) {
        console.warn(`   ⚠️ Facebook: ${err.message}`);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// TWITTER / X  — OAuth 1.0a
// ══════════════════════════════════════════════════════════
function generarOAuthHeader(method, url, params, consumerKey, consumerSecret, accessToken, tokenSecret) {
    const oauthParams = {
        oauth_consumer_key:     consumerKey,
        oauth_nonce:            crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
        oauth_token:            accessToken,
        oauth_version:          '1.0'
    };
    const allParams    = { ...params, ...oauthParams };
    const sortedParams = Object.keys(allParams).sort()
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`).join('&');
    const baseString   = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    const signingKey   = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
    const signature    = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    oauthParams.oauth_signature = signature;
    return 'OAuth ' + Object.keys(oauthParams).sort()
        .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
        .join(', ');
}

async function publicarEnTwitter(titulo, slug, descripcion) {
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const textoBase  = `🏮 ${titulo}\n\n${urlNoticia}\n\n#ElFarolAlDía #RD`;
        const tweet      = textoBase.length > 280 ? textoBase.substring(0, 277) + '...' : textoBase;
        const tweetUrl   = 'https://api.twitter.com/2/tweets';
        const authHeader = generarOAuthHeader('POST', tweetUrl, {}, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET);
        const res        = await fetch(tweetUrl, {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: tweet })
        });
        const data = await res.json();
        if (data.errors || data.error) { console.warn(`   ⚠️ Twitter: ${JSON.stringify(data.errors || data.error)}`); return false; }
        console.log(`   🐦 Twitter ✅ ID: ${data.data?.id}`);
        return true;
    } catch (err) {
        console.warn(`   ⚠️ Twitter: ${err.message}`);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// 🤖 TELEGRAM BOT
// ══════════════════════════════════════════════════════════

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || null;
let   TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || null;

async function publicarEnTelegram(titulo, slug, urlImagen, descripcion, seccion) {
    if (!TELEGRAM_TOKEN) {
        console.log('   📱 Telegram: sin token configurado');
        return false;
    }

    if (!TELEGRAM_CHAT_ID) {
        TELEGRAM_CHAT_ID = await obtenerChatIdTelegram();
        if (!TELEGRAM_CHAT_ID) {
            console.log('   📱 Telegram: sin Chat ID — escríbele algo al bot para activarlo');
            return false;
        }
    }

    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const emoji = {
            'Nacionales':      '🏛️',
            'Deportes':        '⚽',
            'Internacionales': '🌍',
            'Economía':        '💰',
            'Tecnología':      '💻',
            'Espectáculos':    '🎬'
        }[seccion] || '📰';

        const mensaje = `${emoji} *${titulo}*\n\n${descripcion || ''}\n\n🔗 [Leer noticia completa](${urlNoticia})\n\n🏮 *El Farol al Día* · Último Minuto RD`;

        if (urlImagen && urlImagen.startsWith('http')) {
            try {
                const resImg = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id:    TELEGRAM_CHAT_ID,
                        photo:      urlImagen,
                        caption:    mensaje,
                        parse_mode: 'Markdown'
                    })
                });
                const dataImg = await resImg.json();
                if (dataImg.ok) {
                    console.log(`   📱 Telegram ✅ (con imagen)`);
                    return true;
                }
            } catch(e) { }
        }

        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id:                  TELEGRAM_CHAT_ID,
                text:                     mensaje,
                parse_mode:               'Markdown',
                disable_web_page_preview: false
            })
        });
        const data = await res.json();
        if (data.ok) {
            console.log(`   📱 Telegram ✅ (texto)`);
            return true;
        }
        console.warn(`   📱 Telegram ❌: ${data.description}`);
        return false;
    } catch(err) {
        console.warn(`   📱 Telegram error: ${err.message}`);
        return false;
    }
}

async function obtenerChatIdTelegram() {
    if (!TELEGRAM_TOKEN) return null;
    try {
        const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?limit=1&offset=-1`);
        const data = await res.json();
        if (data.ok && data.result?.length) {
            const chatId = data.result[0]?.message?.chat?.id
                        || data.result[0]?.channel_post?.chat?.id;
            if (chatId) {
                console.log(`   📱 Telegram Chat ID detectado: ${chatId}`);
                TELEGRAM_CHAT_ID = chatId.toString();
                return TELEGRAM_CHAT_ID;
            }
        }
    } catch(e) { }
    return null;
}

async function bienvenidaTelegram() {
    if (!TELEGRAM_TOKEN) return;
    await new Promise(r => setTimeout(r, 3000));
    const chatId = await obtenerChatIdTelegram();
    if (!chatId) return;

    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id:    chatId,
                text:       `🏮 *El Farol al Día — Bot Activo*\n\n✅ El bot está conectado y listo.\nCada vez que se publique una noticia nueva, recibirás:\n📸 Imagen + Título + Descripción + Link\n\n🌐 [elfarolaldia.com](https://elfarolaldia.com)\n📍 Santo Domingo Este, RD`,
                parse_mode: 'Markdown'
            })
        });
        console.log('📱 Telegram: mensaje de bienvenida enviado ✅');
    } catch(e) { }
}

// ══════════════════════════════════════════════════════════
// WATERMARK
// ══════════════════════════════════════════════════════════

async function aplicarMarcaDeAgua(urlImagen) {
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bufOrig   = Buffer.from(await response.arrayBuffer());
        if (!fs.existsSync(WATERMARK_PATH)) { console.warn('   ⚠️ Watermark no encontrado'); return { url: urlImagen, procesada: false }; }
        const meta      = await sharp(bufOrig).metadata();
        const w         = meta.width  || 800;
        const h         = meta.height || 500;
        const wmAncho   = Math.min(Math.round(w * 0.28), 300);
        const wmResized = await sharp(WATERMARK_PATH).resize(wmAncho, null, { fit: 'inside' }).toBuffer();
        const wmMeta    = await sharp(wmResized).metadata();
        const wmAlto    = wmMeta.height || 60;
        const margen    = Math.round(w * 0.02);
        const bufFinal  = await sharp(bufOrig)
            .composite([{ input: wmResized, left: Math.max(0, w - wmAncho - margen), top: Math.max(0, h - wmAlto - margen), blend: 'over' }])
            .jpeg({ quality: 88 }).toBuffer();
        const nombre    = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
        fs.writeFileSync(path.join('/tmp', nombre), bufFinal);
        console.log(`   🏮 Watermark: ${nombre}`);
        return { url: urlImagen, nombre, procesada: true };
    } catch (err) {
        console.warn(`   ⚠️ Watermark: ${err.message}`);
        return { url: urlImagen, procesada: false };
    }
}

app.get('/img/:nombre', async (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) {
        res.setHeader('Content-Type',  'image/jpeg');
        res.setHeader('Cache-Control', 'public,max-age=604800');
        return res.sendFile(ruta);
    }
    try {
        const nombre = req.params.nombre;
        const r = await pool.query(
            `SELECT imagen_original FROM noticias WHERE imagen_nombre=$1 LIMIT 1`,
            [nombre]
        );
        if (r.rows.length && r.rows[0].imagen_original) {
            return res.redirect(302, r.rows[0].imagen_original);
        }
    } catch(e) { }
    res.status(404).send('Imagen no disponible');
});

// ══════════════════════════════════════════════════════════
// CONFIG IA
// ══════════════════════════════════════════════════════════

const CONFIG_IA_DEFAULT = {
    enabled: true,
    instruccion_principal: 'Eres un periodista profesional dominicano de alto nivel, con visión nacional e internacional. Escribes noticias verificadas, equilibradas y con impacto real. Cubres República Dominicana completa, el Caribe, Latinoamérica y el mundo. Cuando la noticia tiene conexión con Santo Domingo Este o RD, lo destacas con contexto local.',
    tono: 'profesional',
    extension: 'media',
    enfasis: 'Si la noticia es nacional: prioriza SDE, Los Mina, Invivienda, Ensanche Ozama. Si es internacional: conecta con el impacto en República Dominicana y el Caribe.',
    evitar: 'Limitar el tema solo a Santo Domingo Este. Especulación sin fuentes. Titulares sensacionalistas. Repetir noticias ya publicadas. Copiar texto de Wikipedia.'
};

let CONFIG_IA = { ...CONFIG_IA_DEFAULT };

async function cargarConfigIA() {
    try {
        const r = await pool.query(`SELECT valor FROM memoria_ia WHERE tipo='config_ia' AND valor IS NOT NULL ORDER BY ultima_vez DESC LIMIT 1`);
        if (r.rows.length) {
            const guardada = JSON.parse(r.rows[0].valor);
            CONFIG_IA = { ...CONFIG_IA_DEFAULT, ...guardada };
            console.log('✅ Config IA cargada desde BD');
        } else {
            CONFIG_IA = { ...CONFIG_IA_DEFAULT };
            console.log('✅ Config IA usando valores por defecto');
        }
    } catch(e) {
        CONFIG_IA = { ...CONFIG_IA_DEFAULT };
        console.log('⚠️ Config IA: usando defecto (' + e.message + ')');
    }
    return CONFIG_IA;
}

async function guardarConfigIA(cfg) {
    try {
        const valor = JSON.stringify(cfg);
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, exitos, fallos)
            VALUES('config_ia', $1, 'sistema', 1, 0)
            ON CONFLICT DO NOTHING
        `, [valor]);
        await pool.query(`
            UPDATE memoria_ia SET valor=$1, ultima_vez=NOW()
            WHERE tipo='config_ia' AND categoria='sistema'
        `, [valor]);
        return true;
    } catch(e) {
        console.error('❌ guardarConfigIA:', e.message);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// GEMINI
// ══════════════════════════════════════════════════════════
const GS = { lastRequest: 0, resetTime: 0 };

async function llamarGemini(prompt, reintentos = 3) {
    for (let i = 0; i < reintentos; i++) {
        try {
            console.log(`   🤖 Gemini (intento ${i + 1})`);
            const ahora = Date.now();
            if (ahora < GS.resetTime) await new Promise(r => setTimeout(r, Math.min(GS.resetTime - ahora, 10000)));
            const desde = Date.now() - GS.lastRequest;
            if (desde < 3000) await new Promise(r => setTimeout(r, 3000 - desde));
            GS.lastRequest = Date.now();

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature:     0.8,
                            maxOutputTokens: 4000,
                            stopSequences:   []
                        }
                    })
                }
            );

            if (res.status === 429) {
                GS.resetTime = Date.now() + Math.pow(2, i) * 5000;
                await new Promise(r => setTimeout(r, GS.resetTime - Date.now()));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data  = await res.json();
            const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!texto) throw new Error('Respuesta vacía');
            console.log(`   ✅ Gemini OK`);
            return texto;
        } catch (err) {
            console.error(`   ❌ Intento ${i + 1}: ${err.message}`);
            if (i < reintentos - 1) await new Promise(r => setTimeout(r, Math.pow(2, i) * 3000));
        }
    }
    throw new Error('Gemini no respondió');
}

// ══════════════════════════════════════════════════════════
// MAPEO DE IMÁGENES
// ══════════════════════════════════════════════════════════

const MAPEO_IMAGENES = {
    'Nacionales':       ['dominican republic government building', 'santo domingo city street life', 'caribbean capital urban scene'],
    'Deportes':         ['dominican athlete sports competition', 'caribbean sports stadium crowd', 'latin american sports event'],
};

const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';

const BANCO_LOCAL = {
    'politica-gobierno': [
        `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,
        `${PB}/290595/pexels-photo-290595.jpeg${OPT}`,
        `${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`,
        `${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`,
        `${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,
        `${PB}/2990644/pexels-photo-2990644.jpeg${OPT}`,
        `${PB}/3184418/pexels-photo-3184418.jpeg${OPT}`,
        `${PB}/5668481/pexels-photo-5668481.jpeg${OPT}`,
        `${PB}/3182812/pexels-photo-3182812.jpeg${OPT}`,
        `${PB}/4427611/pexels-photo-4427611.jpeg${OPT}`,
    ],
    'economia-mercado': [
        `${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`,
        `${PB}/6772070/pexels-photo-6772070.jpeg${OPT}`,
        `${PB}/3532557/pexels-photo-3532557.jpeg${OPT}`,
        `${PB}/6801648/pexels-photo-6801648.jpeg${OPT}`,
        `${PB}/210607/pexels-photo-210607.jpeg${OPT}`,
        `${PB}/1602726/pexels-photo-1602726.jpeg${OPT}`,
        `${PB}/3943723/pexels-photo-3943723.jpeg${OPT}`,
        `${PB}/7567443/pexels-photo-7567443.jpeg${OPT}`,
        `${PB}/6120214/pexels-photo-6120214.jpeg${OPT}`,
        `${PB}/5849559/pexels-photo-5849559.jpeg${OPT}`,
    ],
};

function imgLocal(sub, cat) {
    const banco = BANCO_LOCAL[sub] || BANCO_LOCAL['politica-gobierno'] || [];
    return banco[Math.floor(Math.random() * banco.length)];
}

async function obtenerImagen(titulo, categoria, subtemaLocal, queryIA) {
    return imgLocal(subtemaLocal, categoria);
}

function generarAltSEO(titulo, categoria, altIA, subtema) {
    const keywordsCat = {
        'Nacionales':      'noticias República Dominicana',
        'Deportes':        'deportes dominicanos',
        'Internacionales': 'noticias internacionales impacto RD',
        'Economía':        'economía República Dominicana',
        'Tecnología':      'tecnología innovación RD',
        'Espectáculos':    'cultura entretenimiento dominicano',
    };
    if (altIA && altIA.length > 15) return `${altIA} - El Farol al Día`;
    return `${titulo.substring(0, 50)} - ${keywordsCat[categoria] || 'República Dominicana'} - El Farol al Día`;
}

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ══════════════════════════════════════════════════════════
// BASE DE DATOS — INICIALIZAR
// ══════════════════════════════════════════════════════════

async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS noticias(
                id SERIAL PRIMARY KEY,
                titulo VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE,
                seccion VARCHAR(100),
                contenido TEXT,
                seo_description VARCHAR(160),
                seo_keywords VARCHAR(255),
                redactor VARCHAR(100),
                imagen TEXT,
                imagen_alt VARCHAR(255),
                imagen_caption TEXT,
                imagen_nombre VARCHAR(100),
                imagen_fuente VARCHAR(50),
                vistas INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado VARCHAR(50) DEFAULT 'publicada'
            )
        `);

        for (const col of ['imagen_alt', 'imagen_caption', 'imagen_nombre', 'imagen_fuente', 'imagen_original']) {
            await client.query(`
                DO $$ BEGIN
                    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}')
                    THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT;
                    END IF;
                END $$;
            `).catch(() => {});
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS rss_procesados(
                id SERIAL PRIMARY KEY,
                item_guid VARCHAR(500) UNIQUE,
                fuente VARCHAR(100),
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS memoria_ia(
                id SERIAL PRIMARY KEY,
                tipo VARCHAR(50) NOT NULL,
                valor TEXT NOT NULL,
                categoria VARCHAR(100),
                exitos INTEGER DEFAULT 0,
                fallos INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_memoria_tipo
            ON memoria_ia(tipo, categoria)
        `).catch(() => {});

        await client.query(`
            CREATE TABLE IF NOT EXISTS comentarios(
                id SERIAL PRIMARY KEY,
                noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,
                nombre VARCHAR(80) NOT NULL,
                texto TEXT NOT NULL,
                aprobado BOOLEAN DEFAULT true,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_comentarios_noticia
            ON comentarios(noticia_id, aprobado, fecha DESC)
        `).catch(() => {});

        console.log('✅ BD lista');
    } catch (e) {
        console.error('❌ BD:', e.message);
    } finally {
        client.release();
    }

    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════
function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
}

const REDACTORES = [
    { nombre: 'Carlos Méndez',         esp: 'Nacionales' },
    { nombre: 'Laura Santana',         esp: 'Deportes' },
    { nombre: 'Roberto Peña',          esp: 'Internacionales' },
    { nombre: 'Ana María Castillo',    esp: 'Economía' },
    { nombre: 'José Miguel Fernández', esp: 'Tecnología' },
    { nombre: 'Patricia Jiménez',      esp: 'Espectáculos' }
];

function redactor(cat) {
    const match = REDACTORES.filter(r => r.esp === cat);
    return match.length ? match[Math.floor(Math.random() * match.length)].nombre : 'Redacción EFD';
}

// ══════════════════════════════════════════════════════════
// CACHÉ
// ══════════════════════════════════════════════════════════

let _cacheNoticias = null;
let _cacheFecha    = 0;
const CACHE_TTL    = 60 * 1000;

function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

// ══════════════════════════════════════════════════════════
// RUTAS
// ══════════════════════════════════════════════════════════

app.get('/health', (req, res) => res.json({ status: 'OK', version: '34.0' }));

app.get('/api/noticias', async (req, res) => {
    res.setHeader('Cache-Control', 'public,max-age=60');
    res.setHeader('Content-Type', 'application/json');

    try {
        if (_cacheNoticias && (Date.now() - _cacheFecha) < CACHE_TTL) {
            return res.json({ success: true, noticias: _cacheNoticias, cached: true });
        }
        const r = await pool.query(
            `SELECT id,titulo,slug,seccion,imagen,fecha FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 30`
        );
        _cacheNoticias = r.rows;
        _cacheFecha    = Date.now();
        res.json({ success: true, noticias: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/generar-noticia', authMiddleware, async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

    try {
        if (!CONFIG_IA.enabled) return res.json({ success: false, error: 'IA desactivada' });

        const contextoWiki = await buscarContextoWikipedia(categoria, categoria);

        const prompt = `${CONFIG_IA.instruccion_principal}

${contextoWiki}

Escribe una noticia NUEVA sobre la categoría "${categoria}" para República Dominicana.

CATEGORÍA: ${categoria}
TONO: ${CONFIG_IA.tono}
EXTENSIÓN: 400-500 palabras en 5 párrafos
EVITAR: ${CONFIG_IA.evitar}
ÉNFASIS: ${CONFIG_IA.enfasis}

RESPONDE EXACTAMENTE:
TITULO: [60-70 caracteres]
DESCRIPCION: [150-160 caracteres]
PALABRAS: [5 keywords]
QUERY_IMAGEN: [3-5 palabras inglés]
ALT_IMAGEN: [15-20 palabras español]
SUBTEMA_LOCAL: [categoría]
CONTENIDO:
[5 párrafos]`;

        console.log(`\n📰 Generando: ${categoria}`);
        const texto = await llamarGemini(prompt);

        const textoLimpio = texto.replace(/^\s*[*#]+\s*/gm, '');

        let titulo = '', desc = '', pals = '', qi = '', ai = '', sub = '', contenido = '';
        let enContenido = false;
        const bloques = [];

        for (const linea of textoLimpio.split('\n')) {
            const t = linea.trim();
            if      (t.startsWith('TITULO:'))        titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:'))   desc   = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:'))      pals   = t.replace('PALABRAS:', '').trim();
            else if (t.startsWith('QUERY_IMAGEN:'))  qi     = t.replace('QUERY_IMAGEN:', '').trim();
            else if (t.startsWith('ALT_IMAGEN:'))    ai     = t.replace('ALT_IMAGEN:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub    = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:'))     enContenido = true;
            else if (enContenido && t.length > 0)    bloques.push(t);
        }

        contenido = bloques.join('\n\n');
        titulo    = titulo.replace(/[*_#`"]/g, '').trim();
        desc      = desc.replace(/[*_#`]/g, '').trim();

        if (!titulo) throw new Error('Gemini no devolvió TITULO');
        if (!contenido || contenido.length < 300) throw new Error('Contenido insuficiente');

        console.log(`   📝 ${titulo}`);

        const urlOrig = await obtenerImagen(titulo, categoria, sub, qi);
        const imgResult  = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal   = imgResult.procesada ? `${BASE_URL}/img/${imgResult.nombre}` : urlOrig;
        const altFinal   = generarAltSEO(titulo, categoria, ai, sub);

        const sl    = slugify(titulo);
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
                redactor(categoria),
                urlFinal,
                altFinal.substring(0, 255),
                `Fotografía periodística: ${titulo}`,
                imgResult.nombre || 'efd.jpg',
                'el-farol',
                urlOrig,
                'publicada'
            ]
        );

        console.log(`\n✅ /noticia/${slFin}`);
        invalidarCache();

        Promise.allSettled([
            publicarEnFacebook(titulo, slFin, urlFinal, desc),
            publicarEnTwitter(titulo, slFin, desc),
            publicarEnTelegram(titulo, slFin, urlFinal, desc, categoria)
        ]).then(results => {
            const fb = results[0].value ? '📘✅' : '📘❌';
            const tw = results[1].value ? '🐦✅' : '🐦❌';
            const tg = results[2].value ? '📱✅' : '📱❌';
            console.log(`   Redes: ${fb} ${tw} ${tg}`);
        });

        return res.json({ success: true, slug: slFin, titulo, alt: altFinal, mensaje: '✅ Publicada en web + redes' });

    } catch (error) {
        console.error('❌', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/procesar-rss', authMiddleware, async (req, res) => {
    res.json({ success: true, mensaje: 'RSS no implementado' });
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) as c FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ success: true, totalNoticias: parseInt(r.rows[0].c), totalVistas: 0 });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/actualizar-imagen/:id', authMiddleware, async (req, res) => {
    const { pin, imagen } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id || !imagen) return res.status(400).json({ success: false, error: 'Faltan datos' });
    try {
        await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2', [imagen, id]);
        invalidarCache();
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/eliminar/:id', authMiddleware, async (req, res) => {
    const { pin } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });
    try {
        await pool.query('DELETE FROM noticias WHERE id=$1', [id]);
        invalidarCache();
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/config', authMiddleware, (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    res.json(CONFIG_IA);
});

app.post('/api/admin/config', authMiddleware, express.json(), async (req, res) => {
    const { pin, enabled, instruccion_principal, tono, extension, evitar, enfasis } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    if (enabled !== undefined)  CONFIG_IA.enabled = enabled;
    if (instruccion_principal)  CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono)                   CONFIG_IA.tono = tono;
    if (extension)              CONFIG_IA.extension = extension;
    if (evitar)                 CONFIG_IA.evitar = evitar;
    if (enfasis)                CONFIG_IA.enfasis = enfasis;
    const ok = await guardarConfigIA(CONFIG_IA);
    res.json({ success: ok });
});

app.get('/',           (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/status', async (req, res) => {
    try {
        const r   = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        res.json({
            status: 'OK', version: '34.0',
            noticias:       parseInt(r.rows[0].count),
            facebook:       FB_PAGE_ID && FB_PAGE_TOKEN    ? '✅' : '⚠️',
            twitter:        TWITTER_API_KEY && TWITTER_ACCESS_TOKEN ? '✅' : '⚠️',
            pexels_api:     PEXELS_API_KEY ? '✅' : '⚠️',
            ia_activa:      CONFIG_IA.enabled,
            sistema:        'OK'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// ══════════════════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════════════════

async function iniciar() {
    await inicializarBase();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V34.0                                   ║
║  ✅ Basic Auth (director/311)                                 ║
║  ✅ PostgreSQL + Node.js + Express                            ║
║  ✅ Gemini 2.5 Flash · Wikipedia · Watermark                  ║
║  ✅ Facebook · Twitter · Telegram                             ║
╚════════════════════════════════════════════════════════════════╝
        `);
    });
    setTimeout(bienvenidaTelegram, 8000);
}

iniciar();
module.exports = app;
