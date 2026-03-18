/**
 * 🏮 EL FAROL AL DÍA — V34.0 FINAL + TELEGRAM BOT + CORS BLOGGER
 * + Basic Auth protege /redaccion y /api/admin (usuario: director / clave: 311)
 * + Wikipedia + Wikimedia Commons para imágenes coherentes
 * + Mapeo forzado de personajes públicos (Trump, Ortiz, Abinader...)
 * + Memoria IA en PostgreSQL (persiste entre reinicios)
 * + Banco local 17 categorías × 10 fotos
 * + Coach de redacción + Comentarios + SEO E-E-A-T
 * + Telegram Bot automático (node-telegram-bot-api)
 * + ARRANQUE OPTIMIZADO — Sin SIGTERM, watermarks en segundo plano
 * + 🚫 AdSense INTACTO — pub-5280872495839888 NO TOCADO
 * + 🌐 CORS CONFIGURADO PARA BLOGGER — permite peticiones desde blogspot.com
 * + ✅ VERSIÓN REVISADA - SIN ERRORES DE CIERRE
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');
const sharp = require('sharp');
const RSSParser = require('rss-parser');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

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
        const pass = passParts.join(':'); // por si la contraseña tiene ':'

        if (user === 'director' && pass === '311') {
            return next();
        }
    } catch (e) { /* credenciales malformadas */ }

    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
    return res.status(401).send('Credenciales incorrectas. Usuario: director / Contraseña: 311');
}

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL requerido'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || null;
const FB_PAGE_ID = process.env.FB_PAGE_ID || null;
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || null;
const TWITTER_API_KEY = process.env.TWITTER_API_KEY || null;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET || null;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN || null;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || null;

// ===== TELEGRAM BOT CONFIG =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8737097121:AAGiOFVpxLbbpH4iE9dlx4lJN8uAMtIPACo';
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || null;
let telegramBot = null;

// Inicializar bot de Telegram SOLO SI el token está disponible
try {
    if (TELEGRAM_TOKEN) {
        telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
        console.log('📱 Telegram Bot inicializado correctamente');
    }
} catch (e) {
    console.error('❌ Error al inicializar Telegram Bot:', e.message);
}

// Busca watermark con cualquier nombre en la carpeta static
const WATERMARK_PATH = (() => {
    const variantes = [
        'watermark.png',
        'WATERMARK(1).png',
        'watermark(1).png',
        'watermark (1).png',
        'WATERMARK.png',
    ];
    for (const nombre of variantes) {
        const ruta = path.join(__dirname, 'static', nombre);
        if (fs.existsSync(ruta)) {
            console.log(`🏮 Watermark encontrado: ${nombre}`);
            return ruta;
        }
    }
    return path.join(__dirname, 'static', 'watermark.png'); // fallback
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

// ===== CONFIGURACIÓN CORS MEJORADA PARA BLOGGER =====
// Configuración de CORS permitiendo múltiples orígenes
const corsOptions = {
    origin: function (origin, callback) {
        // Permitir solicitudes sin origen (como aplicaciones móviles o postman)
        if (!origin) {
            return callback(null, true);
        }
        
        // Lista de patrones permitidos
        const allowedPatterns = [
            /\.blogspot\.com$/,           // Cualquier subdominio de Blogger
            /^https?:\/\/[a-zA-Z0-9-]+\.blogspot\.com/, // Más específico
            /elfarolaldia\.com$/,          // Tu dominio principal
            /localhost/,                   // Para desarrollo local
            /127\.0\.0\.1/                  // Para desarrollo local
        ];
        
        // Verificar si el origen coincide con algún patrón permitido
        const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
        
        if (isAllowed) {
            return callback(null, true);
        }
        
        // En producción, podrías querer bloquear otros orígenes
        // Por ahora, permitimos todo para evitar problemas
        console.log(`⚠️ CORS: Origen permitido (modo permisivo): ${origin}`);
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200
};

// Aplicar CORS a todas las rutas
app.use(cors(corsOptions));

// Middleware adicional para asegurar headers CORS en respuestas
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Manejar preflight requests (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ══════════════════════════════════════════════════════════
// 📱 FUNCIÓN PARA ENVIAR A TELEGRAM
// ══════════════════════════════════════════════════════════
async function enviarTelegram(noticia) {
    if (!telegramBot) {
        console.log('   📱 Telegram: bot no inicializado');
        return false;
    }

    // Intentar obtener Chat ID automáticamente si no lo tenemos
    if (!TELEGRAM_CHAT_ID) {
        TELEGRAM_CHAT_ID = await obtenerChatIdTelegram();
        if (!TELEGRAM_CHAT_ID) {
            console.log('   📱 Telegram: sin Chat ID — escríbele algo al bot para activarlo');
            return false;
        }
    }

    try {
        const { titulo, slug, imagen, seo_description, seccion } = noticia;
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;

        const emoji = {
            'Nacionales': '🏛️',
            'Deportes': '⚽',
            'Internacionales': '🌍',
            'Economía': '💰',
            'Tecnología': '💻',
            'Espectáculos': '🎬'
        }[seccion] || '📰';

        const mensaje = `${emoji} *${titulo}*\n\n${seo_description || ''}\n\n🔗 [Leer noticia completa](${urlNoticia})\n\n🏮 *El Farol al Día* · Último Minuto RD`;

        // Intentar enviar con imagen primero
        try {
            await telegramBot.sendPhoto(TELEGRAM_CHAT_ID, imagen, {
                caption: mensaje,
                parse_mode: 'Markdown'
            });
            console.log(`   📱 Telegram ✅ (con imagen)`);
            return true;
        } catch (e) {
            // Fallback a solo texto
            await telegramBot.sendMessage(TELEGRAM_CHAT_ID, mensaje, {
                parse_mode: 'Markdown',
                disable_web_page_preview: false
            });
            console.log(`   📱 Telegram ✅ (texto)`);
            return true;
        }
    } catch (err) {
        console.warn(`   ⚠️ Telegram error: ${err.message}`);

        // Registrar error en memoria_ia
        try {
            await pool.query(
                `INSERT INTO memoria_ia(tipo, valor, categoria, fallos) VALUES('error', $1, $2, 1)`,
                [`Telegram: ${err.message.substring(0, 150)}`, noticia.seccion || 'general']
            );
        } catch (e) { }

        return false;
    }
}

/**
 * Obtiene el Chat ID automáticamente del último mensaje recibido por el bot
 */
async function obtenerChatIdTelegram() {
    if (!telegramBot) return null;
    try {
        const updates = await telegramBot.getUpdates({ limit: 1, timeout: 0 });
        if (updates && updates.length > 0) {
            const chatId = updates[0]?.message?.chat?.id || updates[0]?.channel_post?.chat?.id;
            if (chatId) {
                console.log(`   📱 Telegram Chat ID detectado: ${chatId}`);
                return chatId.toString();
            }
        }
    } catch (e) { /* silencioso */ }
    return null;
}

/**
 * Envía mensaje de bienvenida cuando el bot se activa
 */
async function bienvenidaTelegram() {
    if (!telegramBot || !TELEGRAM_CHAT_ID) return;

    try {
        await telegramBot.sendMessage(
            TELEGRAM_CHAT_ID,
            `🏮 *El Farol al Día — Bot Activo*\n\n✅ El bot está conectado y listo.\nCada vez que se publique una noticia nueva, recibirás:\n📸 Imagen + Título + Descripción + Link\n\n🌐 [elfarolaldia.com](${BASE_URL})\n📍 Santo Domingo Este, RD`,
            { parse_mode: 'Markdown' }
        );
        console.log('📱 Telegram: mensaje de bienvenida enviado ✅');
    } catch (e) { /* silencioso */ }
}

// ══════════════════════════════════════════════════════════
// ▶ WIKIPEDIA API — CONTEXTO INTELIGENTE
// ══════════════════════════════════════════════════════════

const WIKI_TERMINOS_RD = {
    'los mina': 'Los Mina Santo Domingo',
    'invivienda': 'Instituto Nacional de la Vivienda República Dominicana',
    'ensanche ozama': 'Ensanche Ozama Santo Domingo Este',
    'santo domingo este': 'Santo Domingo Este',
    'sabana perdida': 'Sabana Perdida Santo Domingo',
    'villa mella': 'Villa Mella Santo Domingo',
    'policia nacional': 'Policía Nacional República Dominicana',
    'presidencia': 'Presidencia de la República Dominicana',
    'procuraduria': 'Procuraduría General de la República Dominicana',
    'banco central': 'Banco Central de la República Dominicana',
    'beisbol': 'Béisbol en República Dominicana',
    'turismo': 'Turismo en República Dominicana',
    'economia': 'Economía de República Dominicana',
    'educacion': 'Educación en República Dominicana',
    'salud publica': 'Ministerio de Salud Pública República Dominicana',
    'mopc': 'Ministerio de Obras Públicas República Dominicana',
    'haití': 'Relaciones entre República Dominicana y Haití',
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
                'Nacionales': `${titulo} República Dominicana`,
                'Deportes': `${titulo} deporte dominicano`,
                'Internacionales': `${titulo} América Latina Caribe`,
                'Economía': `${titulo} economía dominicana`,
                'Tecnología': titulo,
                'Espectáculos': `${titulo} cultura dominicana`,
            };
            terminoBusqueda = mapaCategoria[categoria] || `${titulo} República Dominicana`;
        }

        const urlBusqueda = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(terminoBusqueda)}&format=json&srlimit=3&origin=*`;
        const ctrlBusq = new AbortController();
        const tmBusq = setTimeout(() => ctrlBusq.abort(), 6000);
        const resBusqueda = await fetch(urlBusqueda, { signal: ctrlBusq.signal }).finally(() => clearTimeout(tmBusq));
        if (!resBusqueda.ok) return '';

        const dataBusqueda = await resBusqueda.json();
        const resultados = dataBusqueda?.query?.search;
        if (!resultados?.length) return '';

        const paginaId = resultados[0].pageid;

        const urlExtracto = `https://es.wikipedia.org/w/api.php?action=query&pageids=${paginaId}&prop=extracts&exintro=true&exchars=1500&format=json&origin=*`;
        const ctrlExtr = new AbortController();
        const tmExtr = setTimeout(() => ctrlExtr.abort(), 6000);
        const resExtracto = await fetch(urlExtracto, { signal: ctrlExtr.signal }).finally(() => clearTimeout(tmExtr));
        if (!resExtracto.ok) return '';

        const dataExtracto = await resExtracto.json();
        const pagina = dataExtracto?.query?.pages?.[paginaId];
        if (!pagina?.extract) return '';

        const textoLimpio = pagina.extract
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 1200);

        console.log(`   📚 Wikipedia: "${resultados[0].title}" (${textoLimpio.length} chars)`);
        return `\n📚 CONTEXTO WIKIPEDIA (usar como referencia factual, no copiar):\nArtículo: "${resultados[0].title}"\n${textoLimpio}\n`;

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
        const mensaje = `🏮 ${titulo}\n\n${descripcion || ''}\n\nLee la noticia completa 👇\n${urlNoticia}\n\n#ElFarolAlDía #RepúblicaDominicana #NoticiaRD`;

        const form = new URLSearchParams();
        form.append('url', urlImagen);
        form.append('caption', mensaje);
        form.append('access_token', FB_PAGE_TOKEN);

        const res = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, { method: 'POST', body: form });
        const data = await res.json();

        if (data.error) {
            const form2 = new URLSearchParams();
            form2.append('message', mensaje);
            form2.append('link', urlNoticia);
            form2.append('access_token', FB_PAGE_TOKEN);
            const res2 = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, { method: 'POST', body: form2 });
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
        oauth_consumer_key: consumerKey,
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_token: accessToken,
        oauth_version: '1.0'
    };
    const allParams = { ...params, ...oauthParams };
    const sortedParams = Object.keys(allParams).sort()
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`).join('&');
    const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    oauthParams.oauth_signature = signature;
    return 'OAuth ' + Object.keys(oauthParams).sort()
        .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
        .join(', ');
}

async function publicarEnTwitter(titulo, slug, descripcion) {
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const textoBase = `🏮 ${titulo}\n\n${urlNoticia}\n\n#ElFarolAlDía #RD`;
        const tweet = textoBase.length > 280 ? textoBase.substring(0, 277) + '...' : textoBase;
        const tweetUrl = 'https://api.twitter.com/2/tweets';
        const authHeader = generarOAuthHeader('POST', tweetUrl, {}, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET);
        const res = await fetch(tweetUrl, {
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
// MARCA DE AGUA
// ══════════════════════════════════════════════════════════
async function aplicarMarcaDeAgua(urlImagen) {
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bufOrig = Buffer.from(await response.arrayBuffer());
        if (!fs.existsSync(WATERMARK_PATH)) { console.warn('   ⚠️ Watermark no encontrado'); return { url: urlImagen, procesada: false }; }
        const meta = await sharp(bufOrig).metadata();
        const w = meta.width || 800;
        const h = meta.height || 500;
        const wmAncho = Math.min(Math.round(w * 0.28), 300);
        const wmResized = await sharp(WATERMARK_PATH).resize(wmAncho, null, { fit: 'inside' }).toBuffer();
        const wmMeta = await sharp(wmResized).metadata();
        const wmAlto = wmMeta.height || 60;
        const margen = Math.round(w * 0.02);
        const bufFinal = await sharp(bufOrig)
            .composite([{ input: wmResized, left: Math.max(0, w - wmAncho - margen), top: Math.max(0, h - wmAlto - margen), blend: 'over' }])
            .jpeg({ quality: 88 }).toBuffer();
        const nombre = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
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
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public,max-age=604800');
        return res.sendFile(ruta);
    }
    // /tmp fue limpiado — buscar URL original en BD y redirigir
    try {
        const nombre = req.params.nombre;
        const r = await pool.query(
            `SELECT imagen_original FROM noticias WHERE imagen_nombre=$1 LIMIT 1`,
            [nombre]
        );
        if (r.rows.length && r.rows[0].imagen_original) {
            return res.redirect(302, r.rows[0].imagen_original);
        }
    } catch (e) { /* silencioso */ }
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
    } catch (e) {
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
    } catch (e) {
        console.error('❌ guardarConfigIA:', e.message);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// GEMINI — con Wikipedia integrado
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
                            temperature: 0.8,
                            maxOutputTokens: 4000,
                            stopSequences: []
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
            const data = await res.json();
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
// ▶ MAPEO FORZADO DE IMÁGENES — PERSONAJES Y TEMAS ESPECÍFICOS
// ══════════════════════════════════════════════════════════

const MAPEO_IMAGENES = {
    'donald trump': ['trump president podium microphone', 'trump white house press conference', 'american president speech flag'],
    'trump': ['trump president podium microphone', 'american president official speech', 'white house press briefing'],
    'joe biden': ['biden president official ceremony', 'american president white house', 'us president podium speech'],
    'biden': ['us president official ceremony', 'american president speech podium', 'white house official event'],
    'kamala harris': ['us vice president official portrait', 'american politician speech podium', 'government official press conference'],
    'obama': ['barack obama official portrait', 'former us president speech', 'american president podium crowd'],
    'putin': ['russian president official ceremony', 'kremlin government official', 'russia president press conference'],
    'elon musk': ['tech entrepreneur conference stage', 'silicon valley ceo keynote speech', 'technology executive presentation'],
    'casa blanca': ['white house washington dc', 'white house lawn official', 'washington dc government building'],
    'white house': ['white house washington dc exterior', 'us capitol government building', 'washington dc landmark'],
    'congreso eeuu': ['us congress capitol building', 'senate chamber government session', 'american congress session'],
    'onu': ['united nations general assembly', 'un building new york diplomacy', 'international diplomacy conference'],
    'abinader': ['latin american president ceremony', 'caribbean government official speech', 'dominican republic president podium'],
    'luis abinader': ['latin american president ceremony', 'caribbean government official speech', 'dominican republic government event'],
    'leonel': ['latin american politician speech', 'caribbean political leader podium', 'dominican republic political event'],
    'leonel fernández': ['latin american president speech podium', 'caribbean political leader official', 'dominican political ceremony'],
    'danilo medina': ['latin american president ceremony', 'dominican government official event', 'caribbean politician speech'],
    'hipólito': ['latin american president government', 'caribbean official ceremony', 'dominican republic political leader'],
    'palacio nacional': ['government palace latin america', 'caribbean presidential palace', 'dominican republic government building'],
    'congreso nacional': ['latin american parliament building', 'caribbean congress session hall', 'government assembly chamber'],
    'david ortiz': ['baseball player batting stadium', 'mlb baseball hitter home run', 'baseball legend championship series'],
    'big papi': ['baseball player batting mlb', 'baseball legend career highlights', 'mlb all star game baseball'],
    'pedro martinez': ['baseball pitcher throwing mound', 'mlb pitcher strikeout stadium', 'baseball pitcher windup delivery'],
    'vladimir guerrero': ['baseball outfielder batting mlb', 'dominican baseball player stadium', 'mlb latin player batting'],
    'juan soto': ['baseball outfielder batting stance', 'mlb young star baseball game', 'baseball player stadium crowd'],
    'béisbol': ['baseball dominican republic stadium', 'baseball game crowd fans', 'baseball player batting pitch'],
    'beisbol': ['baseball dominican republic stadium', 'baseball game crowd fans', 'baseball player batting pitch'],
    'messi': ['soccer player dribbling ball', 'football player celebrating goal', 'professional soccer match action'],
    'ronaldo': ['soccer player jumping heading', 'football professional player goal', 'soccer match celebration'],
    'inapa': ['water treatment plant infrastructure', 'water pipe installation workers', 'clean water supply system caribbean'],
    'acueducto': ['water infrastructure construction', 'pipeline water system workers', 'water treatment facility caribbean'],
    'policía nacional': ['police officers patrol street', 'law enforcement officers uniform', 'police car lights patrol'],
    'mopc': ['road construction highway workers', 'infrastructure bridge construction', 'road paving machinery workers'],
    'remesas': ['money transfer wire payment', 'financial transaction bank office', 'currency exchange money'],
    'dólar': ['us dollar bills currency', 'currency exchange money market', 'dollar bills financial'],
    'inflación': ['supermarket prices grocery store', 'consumer prices market shopping', 'economic inflation grocery'],
    'turismo': ['tourist beach resort caribbean', 'punta cana beach hotel pool', 'dominican republic resort tourism'],
    'haití': ['haiti dominican border crossing', 'haiti poverty urban scene', 'dominican haiti border fence'],
    'migración': ['migrants crossing border fence', 'immigration customs border patrol', 'refugee migrants group walking'],
    'covid': ['hospital doctors protective gear', 'medical workers ppe hospital', 'healthcare workers pandemic'],
    'dengue': ['mosquito prevention public health', 'health workers fumigation caribbean', 'mosquito control public health'],
    'inteligencia artificial': ['artificial intelligence technology computer', 'ai machine learning digital', 'technology innovation digital future'],
    'huracán': ['hurricane satellite view storm', 'tropical storm weather satellite', 'hurricane damage aftermath caribbean'],
    'Nacionales': ['dominican republic government building', 'santo domingo city street life', 'caribbean capital urban scene'],
    'Deportes': ['dominican athlete sports competition', 'caribbean sports stadium crowd', 'latin american sports event'],
    'Internacionales': ['international diplomacy meeting flags', 'world leaders conference summit', 'global news event press'],
    'Economía': ['latin america business professionals', 'caribbean financial district building', 'economic meeting executives'],
    'Tecnología': ['technology innovation digital latin', 'caribbean tech startup office', 'computer programming developer'],
    'Espectáculos': ['latin music concert stage performance', 'dominican entertainment show lights', 'caribbean festival dancing crowd'],
};

const QUERIES_PROHIBIDAS = [
    'wedding', 'bride', 'groom', 'bridal', 'couple', 'romance', 'romantic',
    'fashion', 'model', 'flowers', 'bouquet', 'love', 'kiss', 'marriage',
    'engagement', 'birthday', 'celebration cake', 'gift', 'pet', 'dog', 'cat',
    'animal', 'abstract art', 'illustration', 'cartoon', '3d render'
];

// ══════════════════════════════════════════════════════════
// ▶ WIKIPEDIA IMÁGENES
// ══════════════════════════════════════════════════════════

async function buscarImagenWikipedia(titulo) {
    try {
        const urlBusq = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
        let res = await fetch(urlBusq, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
        let data = await res.json();
        let pageTitle = data.query?.search?.[0]?.title;
        let lang = 'es';

        if (!pageTitle) {
            const urlEn = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
            res = await fetch(urlEn, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
            data = await res.json();
            pageTitle = data.query?.search?.[0]?.title;
            lang = 'en';
        }
        if (!pageTitle) return null;

        const urlImg = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=800&origin=*`;
        const resImg = await fetch(urlImg, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
        const dataImg = await resImg.json();
        const pages = dataImg.query?.pages;
        const pid = Object.keys(pages || {})[0];
        const thumb = pages?.[pid]?.thumbnail?.source;
        if (thumb) { console.log(`   ✅ Wikipedia imagen: ${pageTitle}`); return thumb; }
        return null;
    } catch (e) { return null; }
}

// ══════════════════════════════════════════════════════════
// ▶ WIKIMEDIA COMMONS
// ══════════════════════════════════════════════════════════

async function buscarImagenWikimediaCommons(titulo) {
    try {
        const urlBusq = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
        let res = await fetch(urlBusq, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
        let data = await res.json();
        let pageTitle = data.query?.search?.[0]?.title;
        if (!pageTitle) {
            const urlEn = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
            res = await fetch(urlEn, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
            data = await res.json();
            pageTitle = data.query?.search?.[0]?.title;
        }
        if (!pageTitle) return null;

        const urlCommons = `https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=${encodeURIComponent(pageTitle)}&gimlimit=5&prop=imageinfo&iiprop=url|mime&format=json&origin=*`;
        const resC = await fetch(urlCommons, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
        const dataC = await resC.json();

        for (const pid in (dataC.query?.pages || {})) {
            const p = dataC.query.pages[pid];
            if (p.imageinfo?.[0]?.mime?.startsWith('image/')) {
                console.log(`   ✅ Wikimedia Commons: ${p.title}`);
                return p.imageinfo[0].url;
            }
        }
        return null;
    } catch (e) { return null; }
}

// ══════════════════════════════════════════════════════════
// ▶ VALIDADOR DE IMAGEN
// ══════════════════════════════════════════════════════════

function esImagenValida(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (!/(\.jpg|\.jpeg|\.png|\.webp)/i.test(u)) return false;
    const invalidos = [
        '.svg', 'flag', 'logo', 'map', 'coat_of_arms', 'seal', 'emblem',
        'icon', 'badge', 'crest', 'shield', 'blason', 'wikimedia-button',
        'powered_by', 'commons-logo', 'wikidata', 'location_map',
        'signature', 'symbol', 'insignia', 'stamp', 'medal',
        '_bw', '-bw', 'black_white', 'blackwhite', 'grayscale',
        'circa_19', '_189', '_190', '_191', '_192', '_193', '_194',
        '20px', '30px', '40px', '50px', '60px', '70px', '80px',
    ];
    if (invalidos.some(i => u.includes(i))) return false;
    if (u.includes('commons.wikimedia.org')) {
        const patronesViejos = [
            'portrait_of', 'painting_of', 'sketch_of', 'drawing_of',
            'lithograph', 'engraving', 'illustration_of', 'woodcut',
            'daguerreotype', 'photograph_circa', 'undated_photo'
        ];
        if (patronesViejos.some(p => u.includes(p))) return false;
    }
    return true;
}

async function obtenerImagenInteligente(titulo, categoria, subtemaLocal, queryIA) {
    const tituloLower = titulo.toLowerCase();

    for (const [clave, queries] of Object.entries(MAPEO_IMAGENES)) {
        if (typeof queries === 'object' && Array.isArray(queries) && tituloLower.includes(clave)) {
            console.log(`   🎯 Mapeo forzado: "${clave}" → Pexels`);
            const urlPexels = await buscarEnPexels(queries);
            if (urlPexels) return urlPexels;
            const urlWiki = await buscarImagenWikipedia(clave);
            if (urlWiki && esImagenValida(urlWiki)) return urlWiki;
            break;
        }
    }

    if (queryIA) {
        const urlQueryIA = await buscarEnPexels([queryIA]);
        if (urlQueryIA) { console.log(`   ✅ Pexels (Gemini query)`); return urlQueryIA; }
    }

    const queries = detectarQueriesPexels(titulo, categoria, null);
    const urlPexels = await buscarEnPexels(queries);
    if (urlPexels) { console.log(`   ✅ Pexels (queries detectadas)`); return urlPexels; }

    const urlWiki = await buscarImagenWikipedia(titulo);
    if (urlWiki && esImagenValida(urlWiki)) { console.log(`   ✅ Wikipedia (validada)`); return urlWiki; }

    const urlCommons = await buscarImagenWikimediaCommons(titulo);
    if (urlCommons && esImagenValida(urlCommons)) { console.log(`   ✅ Wikimedia (validada)`); return urlCommons; }

    console.log(`   📸 Banco local (${subtemaLocal || categoria})`);
    return imgLocal(subtemaLocal, categoria);
}

// ══════════════════════════════════════════════════════════
// ▶ BIBLIOTECA DE QUERIES PEXELS
// ══════════════════════════════════════════════════════════
const PEXELS_QUERIES_RD = {
    'los mina': ['santo domingo urban street life', 'caribbean city neighborhood people', 'latin america urban community', 'dominican republic street market', 'caribbean urban daily life'],
    'invivienda': ['social housing construction latin america', 'affordable housing caribbean', 'residential building construction workers', 'housing project urban development', 'latin america apartment building construction'],
    'ensanche ozama': ['santo domingo city architecture', 'caribbean urban district street', 'dominican republic city life', 'latin america urban infrastructure', 'caribbean neighborhood road'],
    'santo domingo este': ['santo domingo dominican republic cityscape', 'caribbean capital city skyline', 'dominican republic urban life', 'santo domingo street photography', 'caribbean city architecture'],
    'villa mella': ['dominican republic suburb community', 'caribbean neighborhood street life', 'latin america residential area', 'dominican city outskirts', 'caribbean people community'],
    'presidente': ['president speech podium government', 'latin america president official event', 'government leader press conference', 'political leader official ceremony', 'president signing document desk'],
    'gobierno': ['government building official meeting', 'latin america congress parliament', 'official government press conference', 'politicians meeting boardroom', 'government officials ceremony'],
    'congreso': ['congress parliament building', 'legislators vote assembly hall', 'parliament session politicians', 'latin america congress building', 'government assembly debate'],
    'policia': ['police patrol latin america street', 'law enforcement officer uniform', 'police investigation crime scene', 'caribbean police officers patrol', 'police arrest handcuffs law enforcement'],
    'crimen': ['police crime investigation scene', 'law enforcement detective investigation', 'police tape crime scene urban', 'criminal investigation police work', 'security forces operation urban'],
    'economia': ['business finance professionals meeting', 'stock market trading finance', 'bank building financial district', 'business executives boardroom discussion', 'economic growth financial chart data'],
    'banco': ['bank building financial institution', 'bank teller customer service', 'modern bank interior lobby', 'financial institution banking', 'bank facade exterior architecture'],
    'remesas': ['money transfer wire payment', 'international money transfer service', 'financial services payment technology', 'currency exchange money transfer', 'bank wire transfer international'],
    'turismo': ['punta cana beach resort luxury', 'caribbean beach turquoise water tourism', 'dominican republic resort hotel pool', 'tourists beach vacation caribbean', 'tropical beach resort tourism travel'],
    'salud': ['hospital doctors medical staff', 'doctor patient consultation clinic', 'medical team healthcare professionals', 'hospital ward nurses doctors', 'healthcare medical professionals'],
    'hospital': ['hospital building exterior entrance', 'hospital interior hallway medical staff', 'emergency room hospital doctors', 'hospital patients medical care', 'healthcare facility medical workers'],
    'educacion': ['students classroom learning school', 'teacher students lesson classroom', 'university students campus education', 'school children learning books', 'education classroom latin america'],
    'infraestructura': ['road construction workers equipment', 'highway infrastructure construction project', 'bridge construction engineering workers', 'urban infrastructure development workers', 'road repair construction equipment'],
    'carretera': ['road highway construction workers', 'new highway infrastructure latin america', 'road paving construction crew', 'highway project construction equipment', 'road infrastructure development latin america'],
    'construccion': ['construction workers building site', 'construction project architecture workers', 'building construction crane workers', 'construction site safety workers', 'urban development construction project'],
    'vivienda': ['housing construction workers project', 'residential homes construction site', 'affordable housing project community', 'housing development construction workers', 'new homes construction residential'],
    'agua': ['water treatment plant infrastructure', 'water supply pipeline installation', 'water infrastructure workers construction', 'drinking water facility treatment', 'water system installation workers'],
    'beisbol': ['baseball game stadium fans crowd', 'baseball pitcher throwing stadium', 'baseball player batting home run', 'baseball team dugout players', 'dominican republic baseball stadium'],
    'futbol': ['soccer football match stadium crowd', 'football players game action', 'soccer team training practice field', 'football game crowd stadium', 'soccer players game action sports'],
    'tecnologia': ['technology innovation digital business', 'tech startup team working computers', 'software developer coding computer', 'digital technology innovation lab', 'technology professionals working office'],
    'musica': ['music concert performance stage lights', 'musicians performing concert crowd', 'music band performance stage', 'concert live music crowd fans', 'singer performing microphone stage'],
    'medio ambiente': ['nature environment conservation forest', 'environmental protection activists', 'deforestation environmental issue forest', 'clean energy solar panels environment', 'environmental conservation activists nature'],
    'haiti': ['haiti dominican republic border crossing', 'haitian dominican diplomacy officials', 'border security latin america', 'diplomatic meeting caribbean officials', 'humanitarian aid border caribbean'],
    'Nacionales': ['dominican republic government news', 'santo domingo city official event', 'dominican republic flag ceremony', 'caribbean government officials press', 'latin america news event crowd'],
    'Deportes': ['dominican republic athlete sports', 'caribbean sports competition athlete', 'sports game stadium crowd latin america', 'athlete competition professional sports', 'sports training professional athlete'],
    'Internacionales': ['international news world leaders', 'global summit conference diplomacy', 'world news event international', 'latin america international relations', 'caribbean diplomacy international meeting'],
    'Economía': ['latin america business finance economy', 'caribbean economic development', 'business professionals meeting economy', 'financial district bank economy', 'economy market trade latin america'],
    'Tecnología': ['technology innovation digital latin america', 'tech professionals working computers', 'digital innovation startup team', 'technology conference professionals', 'digital transformation business tech'],
    'Espectáculos': ['latin entertainment music show concert', 'caribbean cultural performance arts', 'entertainment show stage lights', 'celebrity artist performance concert', 'latin music culture entertainment'],
};

async function buscarEnPexels(queries) {
    if (!PEXELS_API_KEY) return null;

    const BLOQUEADOS = ['wedding', 'bride', 'groom', 'bridal', 'couple', 'romance', 'romantic',
        'fashion', 'model', 'party', 'celebration', 'flowers', 'love', 'kiss', 'marriage'];

    const listaQueries = (Array.isArray(queries) ? queries : [queries])
        .filter(q => {
            const ql = q.toLowerCase();
            return !BLOQUEADOS.some(b => ql.includes(b));
        });

    if (!listaQueries.length) {
        console.log('   📸 Todas las queries bloqueadas → banco local');
        return null;
    }

    for (const query of listaQueries) {
        try {
            const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`;
            const ctrl = new AbortController();
            const tm = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(url, {
                headers: { Authorization: PEXELS_API_KEY },
                signal: ctrl.signal
            }).finally(() => clearTimeout(tm));
            if (!res.ok) continue;
            const data = await res.json();
            if (!data.photos?.length) continue;

            const foto = data.photos.slice(0, 5)[Math.floor(Math.random() * Math.min(5, data.photos.length))];
            console.log(`   📸 Pexels: "${query}" → ${foto.id}`);
            registrarQueryPexels(query, 'general', true);
            return foto.src.large2x || foto.src.large || foto.src.original;
        } catch { continue; }
    }
    return null;
}

function detectarQueriesPexels(titulo, categoria, queryIA) {
    const tituloLower = titulo.toLowerCase();
    const queries = [];

    if (queryIA) queries.push(queryIA);

    const catsSaltar = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];
    for (const [clave, qs] of Object.entries(PEXELS_QUERIES_RD)) {
        if (catsSaltar.includes(clave)) continue;
        if (tituloLower.includes(clave.toLowerCase())) {
            queries.push(...qs);
        }
    }

    if (PEXELS_QUERIES_RD[categoria]) {
        queries.push(...PEXELS_QUERIES_RD[categoria]);
    }

    queries.push(
        'dominican republic news event',
        'caribbean latin america people',
        'santo domingo dominican republic'
    );

    return [...new Set(queries)].slice(0, 12);
}

// ══════════════════════════════════════════════════════════
// BANCO LOCAL DE IMÁGENES
// ══════════════════════════════════════════════════════════
const PB = 'https://images.pexels.com/photos';
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
    'seguridad-policia': [
        `${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`,
        `${PB}/5699456/pexels-photo-5699456.jpeg${OPT}`,
        `${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,
        `${PB}/6980997/pexels-photo-6980997.jpeg${OPT}`,
        `${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,
        `${PB}/7491987/pexels-photo-7491987.jpeg${OPT}`,
        `${PB}/8761572/pexels-photo-8761572.jpeg${OPT}`,
        `${PB}/5699859/pexels-photo-5699859.jpeg${OPT}`,
        `${PB}/6289059/pexels-photo-6289059.jpeg${OPT}`,
        `${PB}/6044266/pexels-photo-6044266.jpeg${OPT}`,
    ],
    'relaciones-internacionales': [
        `${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`,
        `${PB}/358319/pexels-photo-358319.jpeg${OPT}`,
        `${PB}/3407617/pexels-photo-3407617.jpeg${OPT}`,
        `${PB}/3997992/pexels-photo-3997992.jpeg${OPT}`,
        `${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`,
        `${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,
        `${PB}/3184339/pexels-photo-3184339.jpeg${OPT}`,
        `${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`,
        `${PB}/7948035/pexels-photo-7948035.jpeg${OPT}`,
        `${PB}/3184292/pexels-photo-3184292.jpeg${OPT}`,
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
    'infraestructura': [
        `${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`,
        `${PB}/323780/pexels-photo-323780.jpeg${OPT}`,
        `${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`,
        `${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`,
        `${PB}/159306/pexels-photo-159306.jpeg${OPT}`,
        `${PB}/1463917/pexels-photo-1463917.jpeg${OPT}`,
        `${PB}/2760241/pexels-photo-2760241.jpeg${OPT}`,
        `${PB}/247763/pexels-photo-247763.jpeg${OPT}`,
        `${PB}/1134166/pexels-photo-1134166.jpeg${OPT}`,
        `${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`,
    ],
    'salud-medicina': [
        `${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`,
        `${PB}/40568/pexels-photo-40568.jpeg${OPT}`,
        `${PB}/4386467/pexels-photo-4386467.jpeg${OPT}`,
        `${PB}/1170979/pexels-photo-1170979.jpeg${OPT}`,
        `${PB}/5327580/pexels-photo-5327580.jpeg${OPT}`,
        `${PB}/3993212/pexels-photo-3993212.jpeg${OPT}`,
        `${PB}/4021775/pexels-photo-4021775.jpeg${OPT}`,
        `${PB}/3985163/pexels-photo-3985163.jpeg${OPT}`,
        `${PB}/5214958/pexels-photo-5214958.jpeg${OPT}`,
        `${PB}/4226219/pexels-photo-4226219.jpeg${OPT}`,
    ],
    'deporte-beisbol': [
        `${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`,
        `${PB}/209977/pexels-photo-209977.jpeg${OPT}`,
        `${PB}/248318/pexels-photo-248318.jpeg${OPT}`,
        `${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`,
        `${PB}/163452/pexels-photo-163452.jpeg${OPT}`,
        `${PB}/1618200/pexels-photo-1618200.jpeg${OPT}`,
        `${PB}/2277981/pexels-photo-2277981.jpeg${OPT}`,
        `${PB}/3041176/pexels-photo-3041176.jpeg${OPT}`,
        `${PB}/186077/pexels-photo-186077.jpeg${OPT}`,
        `${PB}/1752757/pexels-photo-1752757.jpeg${OPT}`,
    ],
    'deporte-general': [
        `${PB}/863988/pexels-photo-863988.jpeg${OPT}`,
        `${PB}/936094/pexels-photo-936094.jpeg${OPT}`,
        `${PB}/2526878/pexels-photo-2526878.jpeg${OPT}`,
        `${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`,
        `${PB}/1552252/pexels-photo-1552252.jpeg${OPT}`,
        `${PB}/3764014/pexels-photo-3764014.jpeg${OPT}`,
        `${PB}/2294353/pexels-photo-2294353.jpeg${OPT}`,
        `${PB}/1752757/pexels-photo-1752757.jpeg${OPT}`,
        `${PB}/4761671/pexels-photo-4761671.jpeg${OPT}`,
        `${PB}/3621517/pexels-photo-3621517.jpeg${OPT}`,
    ],
    'tecnologia': [
        `${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`,
        `${PB}/2582937/pexels-photo-2582937.jpeg${OPT}`,
        `${PB}/5632399/pexels-photo-5632399.jpeg${OPT}`,
        `${PB}/3932499/pexels-photo-3932499.jpeg${OPT}`,
        `${PB}/1181244/pexels-photo-1181244.jpeg${OPT}`,
        `${PB}/574071/pexels-photo-574071.jpeg${OPT}`,
        `${PB}/3861969/pexels-photo-3861969.jpeg${OPT}`,
        `${PB}/4050315/pexels-photo-4050315.jpeg${OPT}`,
        `${PB}/5926382/pexels-photo-5926382.jpeg${OPT}`,
        `${PB}/7988086/pexels-photo-7988086.jpeg${OPT}`,
    ],
    'educacion': [
        `${PB}/256490/pexels-photo-256490.jpeg${OPT}`,
        `${PB}/289737/pexels-photo-289737.jpeg${OPT}`,
        `${PB}/1205651/pexels-photo-1205651.jpeg${OPT}`,
        `${PB}/4143791/pexels-photo-4143791.jpeg${OPT}`,
        `${PB}/301926/pexels-photo-301926.jpeg${OPT}`,
        `${PB}/5905559/pexels-photo-5905559.jpeg${OPT}`,
        `${PB}/3769021/pexels-photo-3769021.jpeg${OPT}`,
        `${PB}/4491461/pexels-photo-4491461.jpeg${OPT}`,
        `${PB}/4145197/pexels-photo-4145197.jpeg${OPT}`,
        `${PB}/8617816/pexels-photo-8617816.jpeg${OPT}`,
    ],
    'cultura-musica': [
        `${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`,
        `${PB}/1540406/pexels-photo-1540406.jpeg${OPT}`,
        `${PB}/3651308/pexels-photo-3651308.jpeg${OPT}`,
        `${PB}/2521317/pexels-photo-2521317.jpeg${OPT}`,
        `${PB}/1047442/pexels-photo-1047442.jpeg${OPT}`,
        `${PB}/167636/pexels-photo-167636.jpeg${OPT}`,
        `${PB}/995301/pexels-photo-995301.jpeg${OPT}`,
        `${PB}/2191013/pexels-photo-2191013.jpeg${OPT}`,
        `${PB}/1105666/pexels-photo-1105666.jpeg${OPT}`,
        `${PB}/1769280/pexels-photo-1769280.jpeg${OPT}`,
    ],
    'medio-ambiente': [
        `${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`,
        `${PB}/1366919/pexels-photo-1366919.jpeg${OPT}`,
        `${PB}/2559941/pexels-photo-2559941.jpeg${OPT}`,
        `${PB}/414612/pexels-photo-414612.jpeg${OPT}`,
        `${PB}/247599/pexels-photo-247599.jpeg${OPT}`,
        `${PB}/1666012/pexels-photo-1666012.jpeg${OPT}`,
        `${PB}/572897/pexels-photo-572897.jpeg${OPT}`,
        `${PB}/1021142/pexels-photo-1021142.jpeg${OPT}`,
        `${PB}/3225517/pexels-photo-3225517.jpeg${OPT}`,
        `${PB}/1423600/pexels-photo-1423600.jpeg${OPT}`,
    ],
    'turismo': [
        `${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`,
        `${PB}/1174732/pexels-photo-1174732.jpeg${OPT}`,
        `${PB}/3601425/pexels-photo-3601425.jpeg${OPT}`,
        `${PB}/2104152/pexels-photo-2104152.jpeg${OPT}`,
        `${PB}/237272/pexels-photo-237272.jpeg${OPT}`,
        `${PB}/1450360/pexels-photo-1450360.jpeg${OPT}`,
        `${PB}/3601453/pexels-photo-3601453.jpeg${OPT}`,
        `${PB}/994605/pexels-photo-994605.jpeg${OPT}`,
        `${PB}/1268855/pexels-photo-1268855.jpeg${OPT}`,
        `${PB}/3155666/pexels-photo-3155666.jpeg${OPT}`,
    ],
    'emergencia': [
        `${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`,
        `${PB}/263402/pexels-photo-263402.jpeg${OPT}`,
        `${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,
        `${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`,
        `${PB}/3259629/pexels-photo-3259629.jpeg${OPT}`,
        `${PB}/4386396/pexels-photo-4386396.jpeg${OPT}`,
        `${PB}/6129049/pexels-photo-6129049.jpeg${OPT}`,
        `${PB}/5726825/pexels-photo-5726825.jpeg${OPT}`,
        `${PB}/7541956/pexels-photo-7541956.jpeg${OPT}`,
        `${PB}/6129113/pexels-photo-6129113.jpeg${OPT}`,
    ],
};

const FALLBACK_CAT = {
    'Nacionales': 'politica-gobierno',
    'Deportes': 'deporte-general',
    'Internacionales': 'relaciones-internacionales',
    'Economía': 'economia-mercado',
    'Tecnología': 'tecnologia',
    'Espectáculos': 'cultura-musica',
    'Salud': 'salud-medicina',
    'Educación': 'educacion',
    'Turismo': 'turismo',
    'Ambiente': 'medio-ambiente',
};

function imgLocal(sub, cat) {
    const banco = BANCO_LOCAL[sub] || BANCO_LOCAL[FALLBACK_CAT[cat]] || BANCO_LOCAL['politica-gobierno'];
    return banco[Math.floor(Math.random() * banco.length)];
}

// ══════════════════════════════════════════════════════════
// ▶ ALT SEO MEJORADO
// ══════════════════════════════════════════════════════════

function generarAltSEO(titulo, categoria, altIA, subtema) {
    if (altIA && altIA.length > 15) {
        const yaTieneRD = altIA.toLowerCase().includes('dominican') ||
            altIA.toLowerCase().includes('república') ||
            altIA.toLowerCase().includes('santo domingo');

        if (yaTieneRD) return `${altIA} - El Farol al Día`;

        const contextoCat = {
            'Nacionales': 'noticias República Dominicana',
            'Deportes': 'deportes dominicanos',
            'Internacionales': 'noticias internacionales impacto RD',
            'Economía': 'economía República Dominicana',
            'Tecnología': 'tecnología innovación RD',
            'Espectáculos': 'cultura entretenimiento dominicano',
        };
        return `${altIA}, ${contextoCat[categoria] || 'República Dominicana'} - El Farol al Día`;
    }

    const base = {
        'Nacionales': `Noticia nacional ${titulo.substring(0, 40)} - Santo Domingo, República Dominicana`,
        'Deportes': `Deportes dominicanos ${titulo.substring(0, 40)} - El Farol al Día RD`,
        'Internacionales': `Noticias internacionales ${titulo.substring(0, 30)} - impacto en República Dominicana`,
        'Economía': `Economía dominicana ${titulo.substring(0, 35)} - finanzas República Dominicana`,
        'Tecnología': `Tecnología ${titulo.substring(0, 35)} - innovación República Dominicana`,
        'Espectáculos': `Espectáculos dominicanos ${titulo.substring(0, 35)} - cultura RD`,
    };

    return (base[categoria] || `${titulo.substring(0, 50)} - noticias República Dominicana El Farol al Día`);
}

// ══════════════════════════════════════════════════════════
// SEO HTML META TAGS
// ══════════════════════════════════════════════════════════
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function metaTagsCompletos(n, url) {
    const t = esc(n.titulo), d = esc(n.seo_description || ''), k = esc(n.seo_keywords || '');
    const img = esc(n.imagen), red = esc(n.redactor), sec = esc(n.seccion);
    const fi = new Date(n.fecha).toISOString(), ue = esc(url);
    const wc = (n.contenido || '').split(/\s+/).filter(w => w).length;

    const keywordsSEO = [
        n.seo_keywords || '',
        'último minuto república dominicana',
        'santo domingo este noticias',
        'noticias el almirante',
        'tendencias dominicanas',
        'el farol al día'
    ].filter(Boolean).join(', ');

    const schema = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "mainEntityOfPage": { "@type": "WebPage", "@id": url },
        "headline": n.titulo,
        "description": n.seo_description || '',
        "keywords": keywordsSEO,
        "image": {
            "@type": "ImageObject",
            "url": n.imagen,
            "caption": n.imagen_caption || n.titulo,
            "width": 1200,
            "height": 630
        },
        "datePublished": fi,
        "dateModified": fi,
        "author": {
            "@type": "Person",
            "name": "José Gregorio Mañan Santana",
            "url": `${BASE_URL}/nosotros`,
            "jobTitle": "Director General",
            "worksFor": { "@type": "Organization", "name": "El Farol al Día" }
        },
        "creator": n.redactor,
        "publisher": {
            "@type": "NewsMediaOrganization",
            "name": "El Farol al Día",
            "url": BASE_URL,
            "sameAs": [
                "https://www.facebook.com/elfarolaldia",
                "https://twitter.com/elfarolaldia"
            ],
            "logo": {
                "@type": "ImageObject",
                "url": `${BASE_URL}/static/favicon.png`,
                "width": 512,
                "height": 512
            },
            "address": {
                "@type": "PostalAddress",
                "addressLocality": "Santo Domingo Este",
                "addressRegion": "Distrito Nacional",
                "addressCountry": "DO"
            }
        },
        "articleSection": n.seccion,
        "wordCount": wc,
        "inLanguage": "es-DO",
        "isAccessibleForFree": true,
        "copyrightHolder": "El Farol al Día",
        "copyrightYear": new Date(n.fecha).getFullYear(),
        "locationCreated": {
            "@type": "Place",
            "name": "Santo Domingo Este, República Dominicana"
        }
    };

    const bread = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Inicio", "item": BASE_URL },
            { "@type": "ListItem", "position": 2, "name": "Último Minuto RD", "item": `${BASE_URL}/` },
            { "@type": "ListItem", "position": 3, "name": n.seccion, "item": `${BASE_URL}/#${(n.seccion || '').toLowerCase()}` },
            { "@type": "ListItem", "position": 4, "name": n.titulo, "item": url }
        ]
    };

    const orgSchema = {
        "@context": "https://schema.org",
        "@type": "NewsMediaOrganization",
        "name": "El Farol al Día",
        "url": BASE_URL,
        "description": "Tu portal de noticias de Último Minuto en Santo Domingo Este y toda la República Dominicana",
        "areaServed": ["República Dominicana", "Santo Domingo Este", "Caribe"],
        "logo": { "@type": "ImageObject", "url": `${BASE_URL}/static/favicon.png` }
    };

    const tituloSEO = (n.titulo.toLowerCase().includes('santo domingo') || n.titulo.toLowerCase().includes('sde'))
        ? `${t} | El Farol al Día`
        : `${t} | Último Minuto RD · El Farol al Día`;

    return `<title>${tituloSEO}</title>
<meta name="description" content="${d}">
<meta name="keywords" content="${esc(keywordsSEO)}">
<meta name="author" content="José Gregorio Mañan Santana · El Farol al Día">
<meta name="news_keywords" content="último minuto, santo domingo este, noticias el almirante, tendencias dominicanas, ${esc(k)}">
<meta name="geo.region" content="DO-01">
<meta name="geo.placename" content="Santo Domingo Este, República Dominicana">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${ue}">
<link rel="alternate" hreflang="es-DO" href="${ue}">
<link rel="alternate" hreflang="es" href="${ue}">
<meta property="og:type" content="article">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(n.imagen_alt || n.titulo)}">
<meta property="og:url" content="${ue}">
<meta property="og:site_name" content="El Farol al Día · Último Minuto RD">
<meta property="og:locale" content="es_DO">
<meta property="article:published_time" content="${fi}">
<meta property="article:modified_time" content="${fi}">
<meta property="article:author" content="José Gregorio Mañan Santana">
<meta property="article:section" content="${sec}">
<meta property="article:tag" content="${esc(keywordsSEO)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta name="twitter:image:alt" content="${esc(n.imagen_alt || n.titulo)}">
<meta name="twitter:site" content="@elfarolaldia">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(bread)}</script>
<script type="application/ld+json">${JSON.stringify(orgSchema)}</script>`;
}

// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════
function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
}

const REDACTORES = [
    { nombre: 'Carlos Méndez', esp: 'Nacionales' },
    { nombre: 'Laura Santana', esp: 'Deportes' },
    { nombre: 'Roberto Peña', esp: 'Internacionales' },
    { nombre: 'Ana María Castillo', esp: 'Economía' },
    { nombre: 'José Miguel Fernández', esp: 'Tecnología' },
    { nombre: 'Patricia Jiménez', esp: 'Espectáculos' }
];

function redactor(cat) {
    const match = REDACTORES.filter(r => r.esp === cat);
    return match.length ? match[Math.floor(Math.random() * match.length)].nombre : 'Redacción EFD';
}

// ══════════════════════════════════════════════════════════
// INICIALIZAR BASE DE DATOS
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
            `).catch(() => { });
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
        `).catch(() => { });

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
        `).catch(() => { });

        const fix = await client.query(`
            UPDATE noticias SET imagen='${PB}/3052454/pexels-photo-3052454.jpeg${OPT}', imagen_fuente='pexels'
            WHERE imagen LIKE '%/images/cache/%' OR imagen LIKE '%fallback%' OR imagen IS NULL OR imagen=''
        `);
        if (fix.rowCount > 0) console.log(`🔧 Imágenes reparadas: ${fix.rowCount}`);
        console.log('✅ BD lista');
    } catch (e) {
        console.error('❌ BD:', e.message);
    } finally {
        client.release();
    }
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// ▶ SISTEMA DE MEMORIA IA
// ══════════════════════════════════════════════════════════

async function registrarQueryPexels(query, categoria, exito) {
    try {
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, exitos, fallos)
            VALUES('pexels_query', $1, $2, $3, $4)
            ON CONFLICT DO NOTHING
        `, [query, categoria, exito ? 1 : 0, exito ? 0 : 1]);

        await pool.query(`
            UPDATE memoria_ia
            SET exitos = exitos + $1,
                fallos = fallos + $2,
                ultima_vez = NOW()
            WHERE tipo = 'pexels_query' AND valor = $3 AND categoria = $4
        `, [exito ? 1 : 0, exito ? 0 : 1, query, categoria]);
    } catch (e) { /* silencioso */ }
}

async function obtenerMejoresQueries(categoria) {
    try {
        const r = await pool.query(`
            SELECT valor, exitos, fallos,
                   (exitos::float / GREATEST(exitos + fallos, 1)) as tasa_exito
            FROM memoria_ia
            WHERE tipo = 'pexels_query'
              AND (categoria = $1 OR categoria = 'general')
              AND exitos > 0
            ORDER BY tasa_exito DESC, exitos DESC
            LIMIT 5
        `, [categoria]);
        return r.rows.map(r => r.valor);
    } catch (e) { return []; }
}

async function registrarError(tipo, descripcion, categoria) {
    try {
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, fallos)
            VALUES('error', $1, $2, 1)
            ON CONFLICT DO NOTHING
        `, [descripcion.substring(0, 200), categoria]);

        await pool.query(`
            UPDATE memoria_ia
            SET fallos = fallos + 1, ultima_vez = NOW()
            WHERE tipo = 'error' AND valor = $1
        `, [descripcion.substring(0, 200)]);
    } catch (e) { /* silencioso */ }
}

async function construirMemoria(categoria) {
    let memoria = '';
    try {
        const recientes = await pool.query(`
            SELECT titulo, fecha FROM noticias
            WHERE estado = 'publicada'
            ORDER BY fecha DESC LIMIT 15
        `);
        if (recientes.rows.length) {
            memoria += `\n⛔ YA PUBLICADAS — NO repetir ni parafrasear:\n`;
            memoria += recientes.rows.map((x, i) => `${i + 1}. ${x.titulo}`).join('\n');
            memoria += '\n';
        }

        const errores = await pool.query(`
            SELECT valor FROM memoria_ia
            WHERE tipo = 'error' AND categoria = $1
              AND ultima_vez > NOW() - INTERVAL '24 hours'
            ORDER BY fallos DESC LIMIT 3
        `, [categoria]);
        if (errores.rows.length) {
            memoria += `\n⚠️ TEMAS CON PROBLEMAS RECIENTES (evitar):\n`;
            memoria += errores.rows.map(e => `- ${e.valor}`).join('\n');
            memoria += '\n';
        }

        const mejores = await obtenerMejoresQueries(categoria);
        if (mejores.length) {
            memoria += `\n💡 QUERIES DE IMAGEN QUE FUNCIONAN BIEN PARA ${categoria.toUpperCase()}:\n`;
            memoria += mejores.map(q => `- "${q}"`).join('\n');
            memoria += '\n';
        }

    } catch (e) { /* silencioso */ }
    return memoria;
}

// ══════════════════════════════════════════════════════════
// ▶ NUEVA FUNCIÓN DE WATERMARKS OPTIMIZADA (en segundo plano)
// ══════════════════════════════════════════════════════════
async function regenerarWatermarksLostidos() {
    try {
        const r = await pool.query(`
            SELECT id, imagen, imagen_nombre, imagen_original
            FROM noticias
            WHERE imagen LIKE '%/img/%'
              AND imagen_original IS NOT NULL
              AND imagen_original != ''
            ORDER BY fecha DESC LIMIT 30
        `); // Reducido de 50 a 30 para ser más rápido

        if (!r.rows.length) {
            console.log('🏮 No hay watermarks para regenerar');
            return;
        }

        let regeneradas = 0;
        // Procesar en lotes de 5 para no saturar
        for (let i = 0; i < r.rows.length; i += 5) {
            const batch = r.rows.slice(i, i + 5);
            await Promise.all(batch.map(async (n) => {
                const nombre = n.imagen_nombre || n.imagen.split('/img/')[1];
                if (!nombre) return;

                const ruta = path.join('/tmp', nombre);
                if (fs.existsSync(ruta)) return; // ya existe, no regenerar

                try {
                    const resultado = await aplicarMarcaDeAgua(n.imagen_original);
                    if (resultado.procesada && resultado.nombre) {
                        await pool.query(
                            `UPDATE noticias SET imagen=$1, imagen_nombre=$2 WHERE id=$3`,
                            [`${BASE_URL}/img/${resultado.nombre}`, resultado.nombre, n.id]
                        );
                        regeneradas++;
                    }
                } catch (e) {
                    // Error silencioso - no detener el lote
                }
            }));

            // Pequeña pausa entre lotes
            await new Promise(r => setTimeout(r, 100));
        }

        if (regeneradas > 0) {
            console.log(`🏮 Watermarks regenerados: ${regeneradas}`);
            invalidarCache();
        }
    } catch (e) {
        console.log(`⚠️ Error en regeneración: ${e.message}`);
    }
}

// ══════════════════════════════════════════════════════════
async function generarNoticia(categoria, comunicadoExterno = null) {
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };

        const memoria = await construirMemoria(categoria);

        const fuenteContenido = comunicadoExterno
            ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado. Reescribe con tu estilo periodístico, no copies textualmente.`
            : `\nEscribe una noticia NUEVA sobre la categoría "${categoria}" para República Dominicana. Que sea un hecho real y relevante del contexto actual.`;

        const temaParaWiki = comunicadoExterno
            ? (comunicadoExterno.split('\n')[0] || '').replace(/^T[IÍ]TULO:\s*/i, '').trim() || categoria
            : categoria;

        const contextoWiki = await buscarContextoWikipedia(temaParaWiki, categoria);

        const prompt = `${CONFIG_IA.instruccion_principal}

ROL: Eres el editor jefe de El Farol al Día con 20 años de experiencia en periodismo dominicano. Escribes exactamente como el Listín Diario o Diario Libre: datos concretos, fuentes verificables, impacto real para el ciudadano dominicano. Periodismo serio, sin exageración ni sensacionalismo.

PENSAMIENTO CRÍTICO ANTES DE ESCRIBIR:
Antes de redactar, respóndete internamente estas preguntas:
1. ¿Quién se ve afectado por esta noticia en República Dominicana?
2. ¿Qué dato concreto (cifra, fecha, nombre de institución) hace esta noticia creíble?
3. ¿Cuál es el ángulo local para Santo Domingo Este / Los Mina / Invivienda si aplica?
4. ¿Qué fuente oficial o institución respalda la información?
5. ¿Qué cambia para el lector dominicano después de leer esto?
Solo procede a escribir cuando tengas respuesta a estas 5 preguntas.

${memoria}
${contextoWiki}
${fuenteContenido}

CATEGORÍA: ${categoria}
TONO: ${CONFIG_IA.tono} — periodismo profesional E-E-A-T (Experiencia, Experticia, Autoridad, Confianza)
EXTENSIÓN: 400-500 palabras en 5 párrafos estructurados
EVITAR: ${CONFIG_IA.evitar}
ÉNFASIS LOCAL: ${CONFIG_IA.enfasis}

ESTRUCTURA OBLIGATORIA (pirámide invertida periodística):
- Párrafo 1 — LEAD (las 5W): QUÉ + QUIÉN + CUÁNDO + DÓNDE + POR QUÉ en máximo 3 líneas. El dato más importante va primero.
- Párrafo 2 — CONTEXTO: Antecedentes con datos concretos (cifras reales, porcentajes, fechas verificables de RD). Sin este párrafo la noticia no tiene credibilidad.
- Párrafo 3 — FUENTES: Citar institución o declaración oficial (Presidencia, ministerio, policía, banco, experto). Usar verbos de atribución: "informó", "confirmó", "según", "declaró".
- Párrafo 4 — IMPACTO CIUDADANO: ¿Qué cambia concretamente para la gente en RD? ¿Precios, servicios, seguridad, empleos?
- Párrafo 5 — CIERRE INFORMATIVO: Próximos pasos, fecha importante próxima, o contexto regional Caribe/LatAm.

REGLAS SEO GOOGLE NEWS 2025 — CRÍTICO PARA INDEXACIÓN:
TÍTULO:
- Entre 10 y 110 caracteres (ideal 60-70 para Google News)
- PALABRAS DE ORO — úsalas cuando aplique al tema:
  * "Último Minuto" — para noticias urgentes, breaking news, hechos recientes
  * "Santo Domingo Este" — cuando la noticia tenga conexión con SDE, Los Mina, Invivienda, Ozama
  * Ejemplos BUENOS con palabras de oro:
    - "Último Minuto: Policía Nacional detiene banda en Santo Domingo Este"
    - "Santo Domingo Este recibe inversión de RD$500M en infraestructura vial"
    - "Último Minuto — Banco Central RD sube tasas de interés al 7.5%"
- Debe incluir: hecho concreto + actor + contexto RD
- PROHIBIDO: fechas en el título, números al inicio, clickbait puro

DESCRIPCIÓN SEO (meta description):
- Exactamente 150-160 caracteres — ni más, ni menos
- OBLIGATORIO incluir al menos UNA de estas frases cuando aplique:
  * "último minuto" — noticias de hoy, hechos recientes
  * "Santo Domingo Este" — noticias locales SDE
  * "noticias República Dominicana" — cobertura nacional
- Responde: QUÉ pasó + QUIÉN lo hizo + DÓNDE en RD + impacto directo
- NO repetir el título palabra por palabra

KEYWORDS (5 palabras clave):
- Siempre incluir "república dominicana" como primera keyword
- Segunda keyword: "último minuto república dominicana" O "santo domingo este noticias"
- Agregar ciudad específica si aplica (santo domingo, santiago, etc.)
- Incluir el tema principal (economía, seguridad, béisbol, etc.)
- Pensar en cómo buscaría esto un dominicano en Google

SEÑALES E-E-A-T EN EL CONTENIDO:
- Mencionar al menos 1 institución oficial dominicana con su nombre completo
- Incluir al menos 1 dato numérico verificable (%, RD$, fecha, cantidad)
- Usar lenguaje de atribución: "según el Ministerio de...", "informó la Policía Nacional"
- Mantener neutralidad — presentar hechos, no opiniones

COHERENCIA IMAGEN — CRÍTICO PARA PEXELS:
La QUERY_IMAGEN describe la escena visual exacta de la noticia.
MAPEO OBLIGATORIO POR TEMA:
  economía/remesas/banco/finanzas  → "latin america business finance professionals"
  seguridad/policía/crimen/narcotráfico → "caribbean police officers law enforcement"
  política/gobierno/ministerio → "dominican republic government building officials"
  béisbol → "dominican republic baseball player stadium bat"
  fútbol/deporte → "caribbean football soccer athlete stadium"
  natación/atletismo → "athlete competition sports arena"
  salud/hospital/medicina → "latin america hospital doctor medical staff"
  tecnología/digital/innovación → "latin america technology digital innovation"
  educación/escuela/universidad → "caribbean students classroom learning"
  turismo/playa/hotel → "dominican republic beach resort tourism"
  construcción/vivienda/MOPC → "latin america construction workers building"
  medio ambiente/clima → "caribbean nature environment conservation"
  haití/frontera/migración → "dominican republic haiti border diplomacy"
  elecciones/votación → "latin america election voting democracy"
  cultura/música/merengue → "dominican republic culture music festival"
PROHIBIDO ABSOLUTAMENTE: wedding, bride, groom, couple, romance, flowers, fashion, cat, dog, pet, party, birthday
SI HAY DUDA: "dominican republic santo domingo urban city"

RESPONDE EXACTAMENTE CON ESTE FORMATO:
TITULO: [60-70 chars, hecho+actor+RD, sin fecha, sin clickbait]
DESCRIPCION: [150-160 chars exactos, qué+quién+dónde+impacto]
PALABRAS: [5 keywords: primera siempre "república dominicana"]
QUERY_IMAGEN: [3-5 palabras inglés, escena periodística, sin bodas ni mascotas]
ALT_IMAGEN: [15-20 palabras español SEO: describe la imagen + tema + RD]
SUBTEMA_LOCAL: [uno de: ${Object.keys(BANCO_LOCAL).join(', ')}]
CONTENIDO:
[400-500 palabras, 5 párrafos, pirámide invertida, párrafos separados por línea en blanco]`;

        console.log(`\n📰 Generando: ${categoria}${comunicadoExterno ? ' (RSS)' : ''}`);
        const texto = await llamarGemini(prompt);

        const textoLimpio = texto.replace(/^\s*[*#]+\s*/gm, '');

        let titulo = '', desc = '', pals = '', qi = '', ai = '', sub = '', contenido = '';
        let enContenido = false;
        const bloques = [];

        for (const linea of textoLimpio.split('\n')) {
            const t = linea.trim();
            if (t.startsWith('TITULO:')) titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:')) desc = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:')) pals = t.replace('PALABRAS:', '').trim();
            else if (t.startsWith('QUERY_IMAGEN:')) qi = t.replace('QUERY_IMAGEN:', '').trim();
            else if (t.startsWith('ALT_IMAGEN:')) ai = t.replace('ALT_IMAGEN:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:')) enContenido = true;
            else if (enContenido && t.length > 0) bloques.push(t);
        }

        contenido = bloques.join('\n\n');
        titulo = titulo.replace(/[*_#`"]/g, '').trim();
        desc = desc.replace(/[*_#`]/g, '').trim();

        if (!titulo)
            throw new Error('Gemini no devolvió TITULO');
        if (!contenido || contenido.length < 300)
            throw new Error(`Contenido insuficiente (${contenido.length} chars) — posible respuesta truncada`);

        console.log(`   📝 ${titulo}`);

        const urlOrig = await obtenerImagenInteligente(titulo, categoria, sub, qi);
        const imgResult = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal = imgResult.procesada ? `${BASE_URL}/img/${imgResult.nombre}` : urlOrig;

        const altFinal = generarAltSEO(titulo, categoria, ai, sub);

        const sl = slugify(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
        const slFin = existe.rows.length ? `${sl}-${Date.now()}` : sl;

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

        if (qi) registrarQueryPexels(qi, categoria, true);

        // ===== NUEVO: Enviar a Telegram automáticamente =====
        const noticiaPublicada = {
            titulo,
            slug: slFin,
            imagen: urlFinal,
            seo_description: desc,
            seccion: categoria
        };

        // No esperar a que termine para no bloquear la respuesta
        if (telegramBot) {
            enviarTelegram(noticiaPublicada).catch(e => {
                console.error('❌ Error enviando a Telegram:', e.message);
            });
        }

        // También enviar a Facebook y Twitter
        Promise.allSettled([
            publicarEnFacebook(titulo, slFin, urlFinal, desc),
            publicarEnTwitter(titulo, slFin, desc)
        ]).then(results => {
            const fb = results[0].value ? '📘✅' : '📘❌';
            const tw = results[1].value ? '🐦✅' : '🐦❌';
            console.log(`   Redes: ${fb} ${tw}`);
        });

        return { success: true, slug: slFin, titulo, alt: altFinal, mensaje: '✅ Publicada en web + Telegram + redes' };

    } catch (error) {
        console.error('❌', error.message);
        await registrarError('generacion', error.message, categoria);
        return { success: false, error: error.message };
    }
}

// ══════════════════════════════════════════════════════════
// RSS PORTALES GOBIERNO RD
// ══════════════════════════════════════════════════════════

const FUENTES_RSS = [
    { url: 'https://presidencia.gob.do/feed', categoria: 'Nacionales', nombre: 'Presidencia RD' },
    { url: 'https://policia.gob.do/feed', categoria: 'Nacionales', nombre: 'Policía Nacional' },
    { url: 'https://www.mopc.gob.do/feed', categoria: 'Nacionales', nombre: 'MOPC' },
    { url: 'https://www.salud.gob.do/feed', categoria: 'Nacionales', nombre: 'Salud Pública' },
    { url: 'https://www.educacion.gob.do/feed', categoria: 'Nacionales', nombre: 'Educación' },
    { url: 'https://www.bancentral.gov.do/feed', categoria: 'Economía', nombre: 'Banco Central' },
    { url: 'https://mepyd.gob.do/feed', categoria: 'Economía', nombre: 'MEPyD' },
    { url: 'https://www.invivienda.gob.do/feed', categoria: 'Nacionales', nombre: 'Invivienda' },
    { url: 'https://mitur.gob.do/feed', categoria: 'Nacionales', nombre: 'Turismo' },
    { url: 'https://pgr.gob.do/feed', categoria: 'Nacionales', nombre: 'Procuraduría' },
    { url: 'https://www.diariolibre.com/feed', categoria: 'Nacionales', nombre: 'Diario Libre' },
    { url: 'https://listindiario.com/feed', categoria: 'Nacionales', nombre: 'Listín Diario' },
    { url: 'https://elnacional.com.do/feed/', categoria: 'Nacionales', nombre: 'El Nacional' },
    { url: 'https://www.eldinero.com.do/feed/', categoria: 'Economía', nombre: 'El Dinero' },
    { url: 'https://www.elcaribe.com.do/feed/', categoria: 'Nacionales', nombre: 'El Caribe' },
    { url: 'https://acento.com.do/feed/', categoria: 'Nacionales', nombre: 'Acento' },
    { url: 'https://www.hoy.com.do/feed/', categoria: 'Nacionales', nombre: 'Hoy' },
    { url: 'https://www.noticiassin.com/feed/', categoria: 'Nacionales', nombre: 'Noticias SIN' },
    { url: 'https://www.cdt.com.do/feed/', categoria: 'Deportes', nombre: 'CDT Deportes' },
    { url: 'https://www.beisbolrd.com/feed/', categoria: 'Deportes', nombre: 'Béisbol RD' },
    { url: 'https://www.reuters.com/arc/outboundfeeds/rss/category/latam/?outputType=xml', categoria: 'Internacionales', nombre: 'Reuters LatAm' },
    { url: 'https://feeds.bbci.co.uk/mundo/rss.xml', categoria: 'Internacionales', nombre: 'BBC Mundo' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', categoria: 'Internacionales', nombre: 'NYT World' },
    { url: 'https://www.elnuevoherald.com/ultimas-noticias/?widgetName=rssfeed&widgetContentId=725095&getXmlFeed=true', categoria: 'Internacionales', nombre: 'El Nuevo Herald' },
    { url: 'https://feeds.feedburner.com/TechCrunch', categoria: 'Tecnología', nombre: 'TechCrunch' },
    { url: 'https://www.wired.com/feed/rss', categoria: 'Tecnología', nombre: 'Wired' },
    { url: 'https://feeds.bloomberg.com/markets/news.rss', categoria: 'Economía', nombre: 'Bloomberg Markets' },
    { url: 'https://www.primerahora.com/entretenimiento/feed/', categoria: 'Espectáculos', nombre: 'Primera Hora Ent.' },
    { url: 'https://www.telemundo.com/shows/rss', categoria: 'Espectáculos', nombre: 'Telemundo' },
    { url: 'https://www.univision.com/rss', categoria: 'Espectáculos', nombre: 'Univision' },
];

async function procesarRSS() {
    if (!CONFIG_IA.enabled) return;
    console.log('\n📡 Procesando RSS portales gobierno...');
    let procesadas = 0;

    for (const fuente of FUENTES_RSS) {
        try {
            const feed = await rssParser.parseURL(fuente.url).catch(() => null);
            if (!feed?.items?.length) continue;

            for (const item of feed.items.slice(0, 3)) {
                const guid = item.guid || item.link || item.title;
                if (!guid) continue;

                const yaExiste = await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1', [guid.substring(0, 500)]);
                if (yaExiste.rows.length) continue;

                const comunicado = [
                    item.title ? `TÍTULO: ${item.title}` : '',
                    item.contentSnippet ? `RESUMEN: ${item.contentSnippet}` : '',
                    item.content ? `CONTENIDO: ${item.content?.substring(0, 2000)}` : '',
                    `FUENTE OFICIAL: ${fuente.nombre}`
                ].filter(Boolean).join('\n');

                const resultado = await generarNoticia(fuente.categoria, comunicado);
                if (resultado.success) {
                    await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING', [guid.substring(0, 500), fuente.nombre]);
                    procesadas++;
                    await new Promise(r => setTimeout(r, 5000));
                }
                break;
            }
        } catch (err) {
            console.warn(`   ⚠️ ${fuente.nombre}: ${err.message}`);
        }
    }
    console.log(`\n📡 RSS: ${procesadas} noticias nuevas`);
}

// ══════════════════════════════════════════════════════════
// CRON
// ══════════════════════════════════════════════════════════
const CATS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

cron.schedule('*/14 * * * *', async () => {
    try {
        await fetch(`http://localhost:${PORT}/health`);
    } catch (e) { /* silencioso */ }
});

cron.schedule('0 */4 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    await generarNoticia(CATS[Math.floor(Math.random() * CATS.length)]);
});

cron.schedule('0 1,7,13,19 * * *', async () => {
    await procesarRSS();
});

// ══════════════════════════════════════════════════════════
// ▶ COACH DE REDACCIÓN
// ══════════════════════════════════════════════════════════

async function analizarRendimiento(dias = 7) {
    try {
        const noticias = await pool.query(`
            SELECT id, titulo, seccion, vistas, fecha
            FROM noticias
            WHERE estado='publicada' AND fecha > NOW() - INTERVAL '${parseInt(dias)} days'
            ORDER BY vistas DESC
        `);
        if (!noticias.rows.length) return { success: true, mensaje: 'No hay noticias', noticias: [] };
        const total = noticias.rows.reduce((s, n) => s + (n.vistas || 0), 0);
        const promedio = Math.round(total / noticias.rows.length);
        const categorias = {};
        ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'].forEach(cat => {
            const rows = noticias.rows.filter(n => n.seccion === cat);
            const vistas = rows.reduce((s, n) => s + (n.vistas || 0), 0);
            const prom = rows.length ? Math.round(vistas / rows.length) : 0;
            categorias[cat] = {
                total: rows.length, vistas_totales: vistas, vistas_promedio: prom,
                rendimiento: promedio ? Math.round((prom / promedio) * 100) : 0,
                mejor: rows[0] ? { titulo: rows[0].titulo, vistas: rows[0].vistas } : null
            };
        });
        const imagenes = await pool.query(`
            SELECT valor, exitos, fallos, categoria,
                   ROUND((exitos::float / GREATEST(exitos + fallos, 1)) * 100) as tasa
            FROM memoria_ia WHERE tipo='pexels_query' AND (exitos + fallos) > 2
            ORDER BY tasa DESC, exitos DESC LIMIT 10
        `);
        const errores = await pool.query(`
            SELECT valor, fallos, categoria FROM memoria_ia
            WHERE tipo='error' AND ultima_vez > NOW() - INTERVAL '7 days'
            ORDER BY fallos DESC LIMIT 5
        `);
        return {
            success: true, periodo: `${dias} días`, total_noticias: noticias.rows.length,
            total_vistas: total, promedio_general: promedio, categorias,
            imagenes: imagenes.rows, errores: errores.rows
        };
    } catch (e) { return { success: false, error: e.message }; }
}

app.get('/api/coach', async (req, res) => {
    const { dias = 7, pin } = req.query;
    const analisis = await analizarRendimiento(parseInt(dias));
    if (!analisis.success) return res.status(500).json(analisis);
    if (pin !== '311') {
        return res.json({
            success: true, periodo: analisis.periodo,
            total_noticias: analisis.total_noticias, total_vistas: analisis.total_vistas,
            categorias: Object.entries(analisis.categorias).map(([n, d]) => ({
                nombre: n, vistas_promedio: d.vistas_promedio, rendimiento: d.rendimiento
            }))
        });
    }
    res.json(analisis);
});

app.get('/cambiar-pais/:pais', (req, res) => {
    const permitidos = ['es-do', 'es-us', 'es-es', 'en-us', 'fr', 'pt'];
    if (!permitidos.includes(req.params.pais)) return res.status(400).send('País no válido');
    res.cookie('pais_seleccionado', req.params.pais, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
    res.redirect(req.get('referer') || '/');
});

app.get('/api/pais-actual', (req, res) => {
    res.json({ pais: req.cookies?.pais_seleccionado || 'es-do' });
});

app.get('/health', (req, res) => res.json({ status: 'OK', version: '34.0' }));

// ===== RUTA DE PRUEBA PARA TELEGRAM (protegida) =====
app.get('/api/admin/test-telegram', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });

    const testNoticia = {
        titulo: '🏮 PRUEBA — Bot de Telegram de El Farol al Día',
        slug: 'test-bot-telegram',
        imagen: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=800',
        seo_description: 'Esta es una noticia de prueba para verificar la conexión del bot de Telegram.',
        seccion: 'Nacionales'
    };

    const resultado = await enviarTelegram(testNoticia);

    res.json({
        success: resultado,
        telegram_token: TELEGRAM_TOKEN ? '✅ Configurado' : '❌ No configurado',
        telegram_chat_id: TELEGRAM_CHAT_ID || '⚠️ No detectado - Escríbele un mensaje al bot primero',
        mensaje: resultado ? '✅ Mensaje enviado' : '❌ Error al enviar'
    });
});

// ══════════════════════════════════════════════════════════
// RUTAS PÚBLICAS Y PROTEGIDAS
// ══════════════════════════════════════════════════════════
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/contacto', (req, res) => res.sendFile(path.join(__dirname, 'client', 'contacto.html')));
app.get('/nosotros', (req, res) => res.sendFile(path.join(__dirname, 'client', 'nosotros.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'client', 'privacidad.html')));
app.get('/terminos', (req, res) => res.sendFile(path.join(__dirname, 'client', 'terminos.html')));
app.get('/cookies', (req, res) => res.sendFile(path.join(__dirname, 'client', 'cookies.html')));

let _cacheNoticias = null;
let _cacheFecha = 0;
const CACHE_TTL = 60 * 1000;

function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

app.get('/api/noticias', async (req, res) => {
    try {
        if (_cacheNoticias && (Date.now() - _cacheFecha) < CACHE_TTL) {
            return res.json({ success: true, noticias: _cacheNoticias, cached: true });
        }
        const r = await pool.query(
            `SELECT id,titulo,slug,seccion,imagen,imagen_alt,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30`,
            ['publicada']
        );
        _cacheNoticias = r.rows;
        _cacheFecha = Date.now();

        // Asegurar headers CORS específicos para esta respuesta
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Cache-Control', 'public,max-age=60');
        res.setHeader('Content-Type', 'application/json');

        res.json({ success: true, noticias: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Manejar OPTIONS para CORS preflight
app.options('/api/noticias', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(200);
});

app.post('/api/actualizar-imagen/:id', authMiddleware, async (req, res) => {
    const { pin, imagen } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id || !imagen) return res.status(400).json({ success: false, error: 'Faltan datos' });
    try {
        await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2', [imagen, id]);
        invalidarCache();
        console.log(`🖼️ Imagen actualizada: ID ${id}`);
        res.json({ success: true });
    } catch (e) {
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
        console.log(`🗑️ Noticia eliminada: ID ${id}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/generar-noticia', authMiddleware, async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    const r = await generarNoticia(categoria);
    res.status(r.success ? 200 : 500).json(r);
});

app.post('/api/procesar-rss', authMiddleware, async (req, res) => {
    const { pin } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    procesarRSS();
    res.json({ success: true, mensaje: 'RSS iniciado' });
});

app.post('/api/comentarios/eliminar/:id', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN incorrecto' });
    try {
        await pool.query('DELETE FROM comentarios WHERE id=$1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/comentarios', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    try {
        const r = await pool.query(`
            SELECT c.id, c.nombre, c.texto, c.fecha,
                   n.titulo as noticia_titulo, n.slug as noticia_slug
            FROM comentarios c
            JOIN noticias n ON n.id = c.noticia_id
            ORDER BY c.fecha DESC LIMIT 50
        `);
        res.json({ success: true, comentarios: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/comentarios/:noticia_id', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT id, nombre, texto, fecha
            FROM comentarios
            WHERE noticia_id=$1 AND aprobado=true
            ORDER BY fecha ASC
        `, [req.params.noticia_id]);
        res.json({ success: true, comentarios: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/comentarios/:noticia_id', async (req, res) => {
    const { nombre, texto } = req.body;
    const noticia_id = parseInt(req.params.noticia_id);
    if (isNaN(noticia_id) || noticia_id <= 0)
        return res.status(400).json({ success: false, error: 'ID de noticia inválido' });
    if (!nombre?.trim() || !texto?.trim())
        return res.status(400).json({ success: false, error: 'Nombre y comentario son requeridos' });
    if (nombre.trim().length > 80)
        return res.status(400).json({ success: false, error: 'Nombre demasiado largo' });
    if (texto.trim().length > 1000)
        return res.status(400).json({ success: false, error: 'Comentario muy largo (máx 1000 chars)' });
    if (texto.trim().length < 3)
        return res.status(400).json({ success: false, error: 'Comentario muy corto' });
    try {
        const r = await pool.query(`
            INSERT INTO comentarios(noticia_id, nombre, texto)
            VALUES($1, $2, $3)
            RETURNING id, nombre, texto, fecha
        `, [noticia_id, nombre.trim().substring(0, 80), texto.trim().substring(0, 1000)]);
        console.log(`💬 Comentario: noticia ${noticia_id} — ${nombre.trim()}`);
        res.json({ success: true, comentario: r.rows[0] });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/memoria', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    try {
        const queries = await pool.query(`
            SELECT tipo, valor, categoria, exitos, fallos,
                   ROUND((exitos::float / GREATEST(exitos + fallos, 1)) * 100) as pct_exito,
                   ultima_vez
            FROM memoria_ia
            ORDER BY ultima_vez DESC LIMIT 50
        `);
        res.json({ success: true, registros: queries.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wikipedia', async (req, res) => {
    const { tema, categoria } = req.query;
    if (!tema) return res.status(400).json({ error: 'Falta ?tema=' });
    const contexto = await buscarContextoWikipedia(tema, categoria || 'Nacionales');
    res.json({ success: true, longitud: contexto.length, contexto });
});

app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2', [req.params.slug, 'publicada']);
        if (!r.rows.length) return res.status(404).send('No encontrada');

        const n = r.rows[0];
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [n.id]);

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            const urlN = `${BASE_URL}/noticia/${n.slug}`;
            const cHTML = n.contenido.split('\n').filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('');
            html = html
                .replace('<!-- META_TAGS -->', metaTagsCompletos(n, urlN))
                .replace(/{{TITULO}}/g, esc(n.titulo))
                .replace(/{{CONTENIDO}}/g, cHTML)
                .replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }))
                .replace(/{{IMAGEN}}/g, n.imagen)
                .replace(/{{ALT}}/g, esc(n.imagen_alt || n.titulo))
                .replace(/{{VISTAS}}/g, n.vistas)
                .replace(/{{REDACTOR}}/g, esc(n.redactor))
                .replace(/{{SECCION}}/g, esc(n.seccion))
                .replace(/{{URL}}/g, encodeURIComponent(urlN));
            res.setHeader('Content-Type', 'text/html;charset=utf-8');
            res.setHeader('Cache-Control', 'public,max-age=300');
            res.send(html);
        } catch (e) {
            res.json({ success: true, noticia: n });
        }
    } catch (e) {
        res.status(500).send('Error');
    }
});

app.get('/sitemap.xml', async (req, res) => {
    try {
        const r = await pool.query('SELECT slug,fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC', ['publicada']);
        const now = Date.now();
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;
        r.rows.forEach(n => {
            const d = (now - new Date(n.fecha).getTime()) / 86400000;
            xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>${d < 1 ? 'hourly' : d < 7 ? 'daily' : 'weekly'}</changefreq><priority>${d < 1 ? '1.0' : d < 7 ? '0.9' : d < 30 ? '0.7' : '0.5'}</priority></url>\n`;
        });
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.header('Cache-Control', 'public,max-age=3600');
        res.send(xml);
    } catch (e) {
        res.status(500).send('Error');
    }
});

app.get('/robots.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nDisallow: /redaccion\n\nUser-agent: Googlebot\nAllow: /\nCrawl-delay: 1\n\nSitemap: ${BASE_URL}/sitemap.xml`);
});

// 🚫 ADSENSE — NO TOCAR (pub-5280872495839888)
app.get('/ads.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) as c, SUM(vistas) as v FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ success: true, totalNoticias: parseInt(r.rows[0].c), totalVistas: parseInt(r.rows[0].v) || 0 });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/configuracion', (req, res) => {
    try {
        const c = fs.existsSync(path.join(__dirname, 'config.json'))
            ? JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
            : { googleAnalytics: '' };
        res.json({ success: true, config: c });
    } catch (e) {
        res.json({ success: true, config: { googleAnalytics: '' } });
    }
});

app.post('/api/configuracion', express.json(), (req, res) => {
    const { pin, googleAnalytics } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    try {
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify({ googleAnalytics }, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/publicar', express.json(), async (req, res) => {
    const { pin, titulo, seccion, contenido, redactor: red } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN' });
    if (!titulo || !seccion || !contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });
    try {
        const sl = slugify(titulo);
        const e = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
        const slF = e.rows.length ? `${sl}-${Date.now()}` : sl;
        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [titulo, slF, seccion, contenido, red || 'Manual',
                `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,
                `${titulo} - noticias República Dominicana El Farol al Día`,
                `Fotografía: ${titulo}`, 'efd.jpg', 'el-farol', 'publicada']
        );
        res.json({ success: true, slug: slF });
    } catch (e) {
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
    if (enabled !== undefined) CONFIG_IA.enabled = enabled;
    if (instruccion_principal) CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono) CONFIG_IA.tono = tono;
    if (extension) CONFIG_IA.extension = extension;
    if (evitar) CONFIG_IA.evitar = evitar;
    if (enfasis) CONFIG_IA.enfasis = enfasis;
    const ok = await guardarConfigIA(CONFIG_IA);
    res.json({ success: ok });
});

app.get('/status', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        const rss = await pool.query('SELECT COUNT(*) FROM rss_procesados');
        res.json({
            status: 'OK', version: '34.0',
            noticias: parseInt(r.rows[0].count),
            rss_procesados: parseInt(rss.rows[0].count),
            facebook: FB_PAGE_ID && FB_PAGE_TOKEN ? '✅ Activo' : '⚠️ Sin credenciales',
            twitter: TWITTER_API_KEY && TWITTER_ACCESS_TOKEN ? '✅ Activo' : '⚠️ Sin credenciales',
            telegram: TELEGRAM_TOKEN ? '✅ Activo' : '⚠️ Sin token',
            pexels_api: PEXELS_API_KEY ? '✅ Activa' : '⚠️ Sin key',
            wikipedia: '✅ Activa (API pública, sin key)',
            marca_de_agua: fs.existsSync(WATERMARK_PATH) ? '✅ Activa' : '⚠️ Falta watermark.png',
            ia_activa: CONFIG_IA.enabled,
            sistema: 'Web + Facebook + Twitter + Telegram + RSS + Wikipedia + Watermark + SEO + CORS Blogger'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// ══════════════════════════════════════════════════════════
// ARRANQUE OPTIMIZADO — NO BLOQUEA, NO SIGTERM
// ══════════════════════════════════════════════════════════
async function iniciar() {
    try {
        // 1. Inicializar BD rápido (esto es necesario y rápido)
        await inicializarBase();

        // 2. Arrancar el servidor INMEDIATAMENTE (Railway ya ve que está online)
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V34.0 + TELEGRAM BOT + CORS BLOGGER       ║
╠══════════════════════════════════════════════════════════════════╣
║  🌐 Servidor ONLINE en puerto ${PORT}                             ║
║  📱 Telegram: ${TELEGRAM_TOKEN ? '✅ Configurado' : '⚠️ Sin token'}                     ║
║  🌐 CORS Blogger: ✅ ACTIVADO (permite blogspot.com)            ║
║  ⏳ Iniciando tareas en segundo plano...                        ║
╚══════════════════════════════════════════════════════════════════╝`);
        });

        // 3. Tareas en segundo plano (NO BLOQUEAN el arranque)
        setTimeout(async () => {
            console.log('⏳ Iniciando tareas post-arranque...');

            // 3.1 Telegram - intentar conectar y enviar bienvenida (sin await)
            if (telegramBot) {
                setTimeout(async () => {
                    try {
                        const chatId = await obtenerChatIdTelegram();
                        if (chatId) {
                            TELEGRAM_CHAT_ID = chatId;
                            await bienvenidaTelegram();
                        }
                    } catch (e) {
                        console.log('📱 Telegram no disponible aún (el bot necesita un mensaje)');
                    }
                }, 2000); // 2 segundos después
            }

            // 3.2 Watermarks - 10 segundos después (ya con Telegram conectado)
            setTimeout(async () => {
                console.log('🏮 Regenerando watermarks en segundo plano...');
                try {
                    await regenerarWatermarksLostidos();
                    console.log('🏮 Watermarks regenerados exitosamente');
                } catch (e) {
                    console.log('⚠️ Error en watermarks (no crítico):', e.message);
                }
            }, 10000); // 10 segundos después del arranque

        }, 3000); // 3 segundos después del arranque

    } catch (error) {
        console.error('❌ Error fatal al iniciar:', error);
        process.exit(1);
    }
}

iniciar();
module.exports = app;
