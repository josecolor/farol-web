/**
 * 🏮 EL FAROL AL DÍA — V34.1
 * CAMBIOS vs V34.0:
 *   1. Rotación 2+2 de llaves Gemini: KEY1+KEY2 → texto | KEY3+KEY4 → imagen/alt
 *   2. Watermark blindado: usa process.cwd(), falla silenciosamente sin matar publicación
 *   3. Todo lo demás idéntico a V34.0
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
// 🔒 BASIC AUTH
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
        if (user === 'director' && pass === '311') return next();
    } catch(e) {}
    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
    return res.status(401).send('Credenciales incorrectas. Usuario: director / Contraseña: 311');
}

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

const PEXELS_API_KEY        = process.env.PEXELS_API_KEY        || null;
const FB_PAGE_ID            = process.env.FB_PAGE_ID            || null;
const FB_PAGE_TOKEN         = process.env.FB_PAGE_TOKEN         || null;
const TWITTER_API_KEY       = process.env.TWITTER_API_KEY       || null;
const TWITTER_API_SECRET    = process.env.TWITTER_API_SECRET    || null;
const TWITTER_ACCESS_TOKEN  = process.env.TWITTER_ACCESS_TOKEN  || null;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || null;

// ══════════════════════════════════════════════════════════
// 🏮 WATERMARK — REPARADO V34.1
// Usa process.cwd() compatible con Railway.
// Si no existe, WATERMARK_PATH = null → aplícarMarcaDeAgua falla silenciosamente.
// ══════════════════════════════════════════════════════════
const WATERMARK_PATH = (() => {
    const variantes = [
        'watermark.png',
        'WATERMARK(1).png',
        'watermark(1).png',
        'watermark (1).png',
        'WATERMARK.png',
    ];
    // Busca primero en process.cwd()/static (compatible Railway)
    // luego en __dirname/static como fallback
    const bases = [
        path.join(process.cwd(), 'static'),
        path.join(__dirname, 'static'),
    ];
    for (const base of bases) {
        for (const nombre of variantes) {
            const ruta = path.join(base, nombre);
            if (fs.existsSync(ruta)) {
                console.log(`🏮 Watermark encontrado: ${ruta}`);
                return ruta;
            }
        }
    }
    console.warn('⚠️  Watermark no encontrado — las fotos se publicarán sin marca de agua');
    return null; // null = sin watermark, no falla
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
// ▶ WIKIPEDIA API
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
            if (tituloLower.includes(clave)) { terminoBusqueda = termino; break; }
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
        const ctrlBusq = new AbortController();
        const tmBusq   = setTimeout(() => ctrlBusq.abort(), 6000);
        const resBusqueda = await fetch(urlBusqueda, { signal: ctrlBusq.signal }).finally(() => clearTimeout(tmBusq));
        if (!resBusqueda.ok) return '';
        const dataBusqueda = await resBusqueda.json();
        const resultados   = dataBusqueda?.query?.search;
        if (!resultados?.length) return '';
        const paginaId = resultados[0].pageid;
        const urlExtracto = `https://es.wikipedia.org/w/api.php?action=query&pageids=${paginaId}&prop=extracts&exintro=true&exchars=1500&format=json&origin=*`;
        const ctrlExtr = new AbortController();
        const tmExtr   = setTimeout(() => ctrlExtr.abort(), 6000);
        const resExtracto = await fetch(urlExtracto, { signal: ctrlExtr.signal }).finally(() => clearTimeout(tmExtr));
        if (!resExtracto.ok) return '';
        const dataExtracto = await resExtracto.json();
        const pagina = dataExtracto?.query?.pages?.[paginaId];
        if (!pagina?.extract) return '';
        const textoLimpio = pagina.extract
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1200);
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
        const mensaje    = `🏮 ${titulo}\n\n${descripcion || ''}\n\nLee la noticia completa 👇\n${urlNoticia}\n\n#ElFarolAlDía #RepúblicaDominicana #NoticiaRD`;
        const form = new URLSearchParams();
        form.append('url', urlImagen); form.append('caption', mensaje); form.append('access_token', FB_PAGE_TOKEN);
        const res  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, { method: 'POST', body: form });
        const data = await res.json();
        if (data.error) {
            const form2 = new URLSearchParams();
            form2.append('message', mensaje); form2.append('link', urlNoticia); form2.append('access_token', FB_PAGE_TOKEN);
            const res2  = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, { method: 'POST', body: form2 });
            const data2 = await res2.json();
            if (data2.error) { console.warn(`   ⚠️ FB: ${data2.error.message}`); return false; }
        }
        console.log(`   📘 Facebook ✅`);
        return true;
    } catch (err) { console.warn(`   ⚠️ Facebook: ${err.message}`); return false; }
}

// ══════════════════════════════════════════════════════════
// TWITTER / X
// ══════════════════════════════════════════════════════════
function generarOAuthHeader(method, url, params, consumerKey, consumerSecret, accessToken, tokenSecret) {
    const oauthParams = {
        oauth_consumer_key: consumerKey, oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_token: accessToken, oauth_version: '1.0'
    };
    const allParams    = { ...params, ...oauthParams };
    const sortedParams = Object.keys(allParams).sort()
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`).join('&');
    const baseString   = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    const signingKey   = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
    const signature    = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    oauthParams.oauth_signature = signature;
    return 'OAuth ' + Object.keys(oauthParams).sort()
        .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`).join(', ');
}

async function publicarEnTwitter(titulo, slug, descripcion) {
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) return false;
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const textoBase  = `🏮 ${titulo}\n\n${urlNoticia}\n\n#ElFarolAlDía #RD`;
        const tweet      = textoBase.length > 280 ? textoBase.substring(0, 277) + '...' : textoBase;
        const tweetUrl   = 'https://api.twitter.com/2/tweets';
        const authHeader = generarOAuthHeader('POST', tweetUrl, {}, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET);
        const res  = await fetch(tweetUrl, { method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: tweet }) });
        const data = await res.json();
        if (data.errors || data.error) { console.warn(`   ⚠️ Twitter: ${JSON.stringify(data.errors || data.error)}`); return false; }
        console.log(`   🐦 Twitter ✅ ID: ${data.data?.id}`);
        return true;
    } catch (err) { console.warn(`   ⚠️ Twitter: ${err.message}`); return false; }
}

// ══════════════════════════════════════════════════════════
// 🤖 TELEGRAM BOT
// ══════════════════════════════════════════════════════════
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || null;
let   TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || null;

async function publicarEnTelegram(titulo, slug, urlImagen, descripcion, seccion) {
    if (!TELEGRAM_TOKEN) { console.log('   📱 Telegram: sin token configurado'); return false; }
    if (!TELEGRAM_CHAT_ID) {
        TELEGRAM_CHAT_ID = await obtenerChatIdTelegram();
        if (!TELEGRAM_CHAT_ID) { console.log('   📱 Telegram: sin Chat ID'); return false; }
    }
    try {
        const urlNoticia = `${BASE_URL}/noticia/${slug}`;
        const emoji = { 'Nacionales':'🏛️','Deportes':'⚽','Internacionales':'🌍','Economía':'💰','Tecnología':'💻','Espectáculos':'🎬' }[seccion] || '📰';
        const mensaje = `${emoji} *${titulo}*\n\n${descripcion || ''}\n\n🔗 [Leer noticia completa](${urlNoticia})\n\n🏮 *El Farol al Día* · Último Minuto RD`;
        if (urlImagen && urlImagen.startsWith('http')) {
            try {
                const resImg = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: urlImagen, caption: mensaje, parse_mode: 'Markdown' })
                });
                const dataImg = await resImg.json();
                if (dataImg.ok) { console.log(`   📱 Telegram ✅ (con imagen)`); return true; }
            } catch(e) {}
        }
        const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensaje, parse_mode: 'Markdown', disable_web_page_preview: false })
        });
        const data = await res.json();
        if (data.ok) { console.log(`   📱 Telegram ✅ (texto)`); return true; }
        console.warn(`   📱 Telegram ❌: ${data.description}`);
        return false;
    } catch(err) { console.warn(`   📱 Telegram error: ${err.message}`); return false; }
}

async function obtenerChatIdTelegram() {
    if (!TELEGRAM_TOKEN) return null;
    try {
        const res  = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?limit=1&offset=-1`);
        const data = await res.json();
        if (data.ok && data.result?.length) {
            const chatId = data.result[0]?.message?.chat?.id || data.result[0]?.channel_post?.chat?.id;
            if (chatId) { console.log(`   📱 Telegram Chat ID detectado: ${chatId}`); TELEGRAM_CHAT_ID = chatId.toString(); return TELEGRAM_CHAT_ID; }
        }
    } catch(e) {}
    return null;
}

async function bienvenidaTelegram() {
    if (!TELEGRAM_TOKEN) return;
    await new Promise(r => setTimeout(r, 3000));
    const chatId = await obtenerChatIdTelegram();
    if (!chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: `🏮 *El Farol al Día — Bot Activo*\n\n✅ El bot está conectado y listo.\nCada vez que se publique una noticia nueva, recibirás:\n📸 Imagen + Título + Descripción + Link\n\n🌐 [elfarolaldia.com](https://elfarolaldia.com)\n📍 Santo Domingo Este, RD`, parse_mode: 'Markdown' })
        });
        console.log('📱 Telegram: mensaje de bienvenida enviado ✅');
    } catch(e) {}
}

// ══════════════════════════════════════════════════════════
// 🏮 MARCA DE AGUA — BLINDADA V34.1
// Si WATERMARK_PATH es null o el archivo desaparece en Railway,
// retorna la imagen original sin watermark y sin lanzar error.
// ══════════════════════════════════════════════════════════
async function aplicarMarcaDeAgua(urlImagen) {
    // Sin watermark configurado → imagen original, sin error
    if (!WATERMARK_PATH) {
        console.log('   ℹ️  Sin watermark — publicando imagen original');
        return { url: urlImagen, procesada: false };
    }
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bufOrig = Buffer.from(await response.arrayBuffer());

        // Verificación en tiempo real (por si Railway limpió /tmp pero el path global era correcto)
        if (!fs.existsSync(WATERMARK_PATH)) {
            console.warn('   ⚠️ Watermark desapareció en tiempo de ejecución — imagen sin marca');
            return { url: urlImagen, procesada: false };
        }

        const meta    = await sharp(bufOrig).metadata();
        const w       = meta.width  || 800;
        const h       = meta.height || 500;
        const wmAncho = Math.min(Math.round(w * 0.28), 300);
        const wmResized = await sharp(WATERMARK_PATH).resize(wmAncho, null, { fit: 'inside' }).toBuffer();
        const wmMeta  = await sharp(wmResized).metadata();
        const wmAlto  = wmMeta.height || 60;
        const margen  = Math.round(w * 0.02);
        const bufFinal = await sharp(bufOrig)
            .composite([{ input: wmResized, left: Math.max(0, w - wmAncho - margen), top: Math.max(0, h - wmAlto - margen), blend: 'over' }])
            .jpeg({ quality: 88 }).toBuffer();
        const nombre  = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
        fs.writeFileSync(path.join('/tmp', nombre), bufFinal);
        console.log(`   🏮 Watermark aplicado: ${nombre}`);
        return { url: urlImagen, nombre, procesada: true };
    } catch (err) {
        // Cualquier error → imagen original, publicación NO se interrumpe
        console.warn(`   ⚠️ Watermark falló (${err.message}) — publicando sin marca`);
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
        const r = await pool.query(`SELECT imagen_original FROM noticias WHERE imagen_nombre=$1 LIMIT 1`, [req.params.nombre]);
        if (r.rows.length && r.rows[0].imagen_original) return res.redirect(302, r.rows[0].imagen_original);
    } catch(e) {}
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
        if (r.rows.length) { CONFIG_IA = { ...CONFIG_IA_DEFAULT, ...JSON.parse(r.rows[0].valor) }; console.log('✅ Config IA cargada desde BD'); }
        else { CONFIG_IA = { ...CONFIG_IA_DEFAULT }; console.log('✅ Config IA usando valores por defecto'); }
    } catch(e) { CONFIG_IA = { ...CONFIG_IA_DEFAULT }; console.log('⚠️ Config IA: usando defecto (' + e.message + ')'); }
    return CONFIG_IA;
}

async function guardarConfigIA(cfg) {
    try {
        const valor = JSON.stringify(cfg);
        await pool.query(`INSERT INTO memoria_ia(tipo, valor, categoria, exitos, fallos) VALUES('config_ia', $1, 'sistema', 1, 0) ON CONFLICT DO NOTHING`, [valor]);
        await pool.query(`UPDATE memoria_ia SET valor=$1, ultima_vez=NOW() WHERE tipo='config_ia' AND categoria='sistema'`, [valor]);
        return true;
    } catch(e) { console.error('❌ guardarConfigIA:', e.message); return false; }
}

// ══════════════════════════════════════════════════════════
// 🔑 GEMINI — ROTACIÓN 2+2 (NUEVO EN V34.1)
//
//  LLAVES DE ESCRITURA (texto periodístico):
//    Slot 0 → GEMINI_API_KEY
//    Slot 1 → GEMINI_KEY_2
//
//  LLAVES DE IMAGEN (query Pexels + alt SEO):
//    Slot 0 → GEMINI_KEY_3
//    Slot 1 → GEMINI_KEY_4
//
//  Si una llave da 429 se salta a la siguiente del mismo grupo.
//  Los contadores son independientes para cada grupo.
// ══════════════════════════════════════════════════════════

// ── Estado de throttle por llave ────────────────────────
const GEMINI_STATE = {};   // { [keyIndex]: { lastRequest, resetTime } }

function getKeyState(keyIndex) {
    if (!GEMINI_STATE[keyIndex]) GEMINI_STATE[keyIndex] = { lastRequest: 0, resetTime: 0 };
    return GEMINI_STATE[keyIndex];
}

/**
 * Llama a la API de Gemini con una llave específica.
 * Respeta el rate-limit individual de esa llave.
 */
async function _callGemini(apiKey, prompt, intentoGlobal) {
    const st   = getKeyState(apiKey);
    const ahora = Date.now();
    if (ahora < st.resetTime) await new Promise(r => setTimeout(r, Math.min(st.resetTime - ahora, 10000)));
    const desde = Date.now() - st.lastRequest;
    if (desde < 3000) await new Promise(r => setTimeout(r, 3000 - desde));
    st.lastRequest = Date.now();

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.8, maxOutputTokens: 4000, stopSequences: [] }
            })
        }
    );

    if (res.status === 429) {
        st.resetTime = Date.now() + Math.pow(2, intentoGlobal) * 5000;
        throw new Error('RATE_LIMIT_429');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data  = await res.json();
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) throw new Error('Respuesta vacía');
    return texto;
}

/**
 * llamarGemini — usa KEY1 y KEY2 (escritura periodística).
 * Rota entre las dos si alguna da 429.
 */
async function llamarGemini(prompt, reintentos = 3) {
    const llaves = [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_KEY_2,
    ].filter(Boolean);

    let intentoGlobal = 0;
    for (let i = 0; i < reintentos; i++) {
        for (const llave of llaves) {
            try {
                console.log(`   🤖 Gemini-texto (KEY${llaves.indexOf(llave)+1}, intento ${i+1})`);
                const texto = await _callGemini(llave, prompt, intentoGlobal++);
                console.log('   ✅ Gemini-texto OK');
                return texto;
            } catch (err) {
                if (err.message === 'RATE_LIMIT_429') {
                    console.warn(`   ⚡ KEY${llaves.indexOf(llave)+1} en 429 → rotando...`);
                    continue; // probar siguiente llave del grupo
                }
                console.error(`   ❌ KEY${llaves.indexOf(llave)+1}: ${err.message}`);
            }
        }
        // Todas las llaves del grupo fallaron en este intento
        if (i < reintentos - 1) await new Promise(r => setTimeout(r, Math.pow(2, i) * 3000));
    }
    throw new Error('Gemini-texto: todas las llaves fallaron');
}

/**
 * llamarGeminiImagen — usa KEY3 y KEY4 (apoyo visual: query Pexels + alt SEO).
 * Misma lógica de rotación, grupo independiente.
 * Si ambas claves fallan, retorna null (no interrumpe la publicación).
 */
async function llamarGeminiImagen(prompt, reintentos = 2) {
    const llaves = [
        process.env.GEMINI_KEY_3,
        process.env.GEMINI_KEY_4,
    ].filter(Boolean);

    // Si no hay llaves de imagen configuradas, retornar null silenciosamente
    if (!llaves.length) {
        console.log('   🖼️  Sin KEY3/KEY4 — se usará query de imagen por defecto');
        return null;
    }

    let intentoGlobal = 0;
    for (let i = 0; i < reintentos; i++) {
        for (const llave of llaves) {
            try {
                console.log(`   🖼️  Gemini-imagen (KEY${llaves.indexOf(llave)+3}, intento ${i+1})`);
                const texto = await _callGemini(llave, prompt, intentoGlobal++);
                console.log('   ✅ Gemini-imagen OK');
                return texto;
            } catch (err) {
                if (err.message === 'RATE_LIMIT_429') {
                    console.warn(`   ⚡ KEY${llaves.indexOf(llave)+3} imagen en 429 → rotando...`);
                    continue;
                }
                console.error(`   ❌ KEY${llaves.indexOf(llave)+3} imagen: ${err.message}`);
            }
        }
        if (i < reintentos - 1) await new Promise(r => setTimeout(r, Math.pow(2, i) * 2000));
    }
    console.warn('   ⚠️ Gemini-imagen: todas las llaves fallaron — usando fallback');
    return null; // No interrumpe la publicación
}

// ══════════════════════════════════════════════════════════
// ▶ MAPEO FORZADO DE IMÁGENES
// ══════════════════════════════════════════════════════════
const MAPEO_IMAGENES = {
    'donald trump':     ['trump president podium microphone', 'trump white house press conference', 'american president speech flag'],
    'trump':            ['trump president podium microphone', 'american president official speech', 'white house press briefing'],
    'joe biden':        ['biden president official ceremony', 'american president white house', 'us president podium speech'],
    'biden':            ['us president official ceremony', 'american president speech podium', 'white house official event'],
    'kamala harris':    ['us vice president official portrait', 'american politician speech podium', 'government official press conference'],
    'obama':            ['barack obama official portrait', 'former us president speech', 'american president podium crowd'],
    'putin':            ['russian president official ceremony', 'kremlin government official', 'russia president press conference'],
    'elon musk':        ['tech entrepreneur conference stage', 'silicon valley ceo keynote speech', 'technology executive presentation'],
    'casa blanca':      ['white house washington dc', 'white house lawn official', 'washington dc government building'],
    'white house':      ['white house washington dc exterior', 'us capitol government building', 'washington dc landmark'],
    'congreso eeuu':    ['us congress capitol building', 'senate chamber government session', 'american congress session'],
    'onu':              ['united nations general assembly', 'un building new york diplomacy', 'international diplomacy conference'],
    'abinader':         ['latin american president ceremony', 'caribbean government official speech', 'dominican republic president podium'],
    'luis abinader':    ['latin american president ceremony', 'caribbean government official speech', 'dominican republic government event'],
    'leonel':           ['latin american politician speech', 'caribbean political leader podium', 'dominican republic political event'],
    'leonel fernández': ['latin american president speech podium', 'caribbean political leader official', 'dominican political ceremony'],
    'danilo medina':    ['latin american president ceremony', 'dominican government official event', 'caribbean politician speech'],
    'hipólito':         ['latin american president government', 'caribbean official ceremony', 'dominican republic political leader'],
    'palacio nacional': ['government palace latin america', 'caribbean presidential palace', 'dominican republic government building'],
    'congreso nacional':['latin american parliament building', 'caribbean congress session hall', 'government assembly chamber'],
    'david ortiz':      ['baseball player batting stadium', 'mlb baseball hitter home run', 'baseball legend championship series'],
    'big papi':         ['baseball player batting mlb', 'baseball legend career highlights', 'mlb all star game baseball'],
    'pedro martinez':   ['baseball pitcher throwing mound', 'mlb pitcher strikeout stadium', 'baseball pitcher windup delivery'],
    'vladimir guerrero':['baseball outfielder batting mlb', 'dominican baseball player stadium', 'mlb latin player batting'],
    'vladimir guerrero jr': ['first baseman batting mlb', 'baseball power hitter stadium', 'mlb slugger home run swing'],
    'juan soto':        ['baseball outfielder batting stance', 'mlb young star baseball game', 'baseball player stadium crowd'],
    'robinson canó':    ['baseball second baseman fielding', 'mlb infielder play action', 'baseball player game action'],
    'robinson cano':    ['baseball second baseman fielding', 'mlb infielder play action', 'baseball player game action'],
    'albert pujols':    ['baseball first baseman batting', 'mlb career hits record baseball', 'baseball hall fame hitter'],
    'fernando tatis':   ['baseball shortstop fielding mlb', 'young baseball player action', 'mlb shortstop batting swing'],
    'tatis':            ['baseball shortstop fielding mlb', 'young baseball star action', 'mlb player batting crowd'],
    'béisbol':          ['baseball dominican republic stadium', 'baseball game crowd fans', 'baseball player batting pitch'],
    'beisbol':          ['baseball dominican republic stadium', 'baseball game crowd fans', 'baseball player batting pitch'],
    'liga dominicana':  ['baseball stadium fans crowd', 'dominican baseball winter league', 'baseball game night stadium lights'],
    'estadio quisqueya':['baseball stadium night game', 'baseball field crowd lights', 'caribbean baseball stadium'],
    'mlb':              ['major league baseball stadium', 'mlb baseball game action', 'professional baseball player batting'],
    'messi':            ['soccer player dribbling ball', 'football player celebrating goal', 'professional soccer match action'],
    'lionel messi':     ['soccer player ball control', 'football match professional player', 'soccer world cup action'],
    'ronaldo':          ['soccer player jumping heading', 'football professional player goal', 'soccer match celebration'],
    'cristiano ronaldo':['soccer player celebrating goal', 'professional football match action', 'soccer star stadium crowd'],
    'mbappé':           ['soccer player sprint dribble', 'professional football match speed', 'soccer young star action'],
    'neymar':           ['soccer player skill dribbling', 'brazil football player action', 'professional soccer match play'],
    'copa mundial':     ['soccer world cup trophy', 'football world cup stadium', 'world cup celebration fans'],
    'nfl':              ['american football game action', 'nfl quarterback passing stadium', 'football players game field'],
    'nba':              ['basketball game action arena', 'nba player dunk basket', 'professional basketball match crowd'],
    'inapa':            ['water treatment plant infrastructure', 'water pipe installation workers', 'clean water supply system caribbean'],
    'acueducto':        ['water infrastructure construction', 'pipeline water system workers', 'water treatment facility caribbean'],
    'policía nacional': ['police officers patrol street', 'law enforcement officers uniform', 'police car lights patrol'],
    'policia nacional': ['police officers patrol street', 'law enforcement officers uniform', 'police patrol caribbean'],
    'mopc':             ['road construction highway workers', 'infrastructure bridge construction', 'road paving machinery workers'],
    'ministerio':       ['government ministry building official', 'government officials meeting conference', 'latin america government office'],
    'presidencia':      ['government official press conference', 'presidential palace latin america', 'government ceremony latin american'],
    'procuraduria':     ['justice court law building', 'prosecutor official ceremony', 'legal system government officials'],
    'banco central':    ['bank building financial district', 'central bank official building', 'financial institution economics'],
    'mepyd':            ['economic development meeting officials', 'government economic planning', 'latin america economic conference'],
    'invivienda':       ['social housing construction caribbean', 'residential building construction workers', 'affordable housing development latin'],
    'remesas':          ['money transfer wire payment', 'financial transaction bank office', 'currency exchange money'],
    'dólar':            ['us dollar bills currency', 'currency exchange money market', 'dollar bills financial'],
    'inflación':        ['supermarket prices grocery store', 'consumer prices market shopping', 'economic inflation grocery'],
    'turismo':          ['tourist beach resort caribbean', 'punta cana beach hotel pool', 'dominican republic resort tourism'],
    'punta cana':       ['punta cana beach resort pool', 'caribbean beach resort palm trees', 'luxury hotel beach caribbean'],
    'zona franca':      ['industrial park factory workers', 'manufacturing workers production line', 'free trade zone factory'],
    'haití':            ['haiti dominican border crossing', 'haiti poverty urban scene', 'dominican haiti border fence'],
    'migración':        ['migrants crossing border fence', 'immigration customs border patrol', 'refugee migrants group walking'],
    'cuba':             ['cuba havana street cars', 'cuban street life scene', 'havana cuba architecture'],
    'venezuela':        ['venezuela caracas city scene', 'latin america crisis protest', 'venezuela economy crisis'],
    'china':            ['china beijing skyline city', 'chinese business meeting trade', 'china economy business district'],
    'rusia':            ['russia moscow skyline', 'russia kremlin government', 'moscow city russia'],
    'ucrania':          ['ukraine war conflict zone', 'ukraine soldiers military', 'ukraine city damage conflict'],
    'israel':           ['israel conflict middle east', 'jerusalem city landmark', 'middle east conflict news'],
    'palestina':        ['gaza conflict humanitarian', 'middle east conflict civilians', 'humanitarian crisis aid workers'],
    'nato':             ['nato military alliance meeting', 'military alliance soldiers', 'nato headquarters building'],
    'covid':            ['hospital doctors protective gear', 'medical workers ppe hospital', 'healthcare workers pandemic'],
    'dengue':           ['mosquito prevention public health', 'health workers fumigation caribbean', 'mosquito control public health'],
    'hospital':         ['hospital emergency room doctors', 'medical staff hospital corridor', 'healthcare facility doctors nurses'],
    'vacuna':           ['vaccination clinic health worker', 'nurse giving injection patient', 'health campaign vaccination caribbean'],
    'inteligencia artificial': ['artificial intelligence technology computer', 'ai machine learning digital', 'technology innovation digital future'],
    'ia':               ['artificial intelligence digital technology', 'computer brain machine learning', 'ai technology innovation'],
    'criptomoneda':     ['cryptocurrency bitcoin digital money', 'blockchain technology digital finance', 'crypto trading screen charts'],
    'bitcoin':          ['bitcoin cryptocurrency digital', 'crypto market trading charts', 'digital currency bitcoin symbol'],
    'starlink':         ['satellite internet technology space', 'internet satellite dish technology', 'space technology satellite orbit'],
    'huracán':          ['hurricane satellite view storm', 'tropical storm weather satellite', 'hurricane damage aftermath caribbean'],
    'terremoto':        ['earthquake damage buildings rubble', 'natural disaster rescue workers', 'earthquake destruction aftermath'],
    'inundación':       ['flood water streets cars', 'flooding disaster rescue boats', 'heavy rain flood streets caribbean'],
    'cambio climático': ['climate change drought cracked earth', 'environmental pollution factory smoke', 'climate activists protest sign'],
    'Nacionales':       ['dominican republic government building', 'santo domingo city street life', 'caribbean capital urban scene'],
    'Deportes':         ['dominican athlete sports competition', 'caribbean sports stadium crowd', 'latin american sports event'],
    'Internacionales':  ['international diplomacy meeting flags', 'world leaders conference summit', 'global news event press'],
    'Economía':         ['latin america business professionals', 'caribbean financial district building', 'economic meeting executives'],
    'Tecnología':       ['technology innovation digital latin', 'caribbean tech startup office', 'computer programming developer'],
    'Espectáculos':     ['latin music concert stage performance', 'dominican entertainment show lights', 'caribbean festival dancing crowd'],
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
        let pageTitle = data.query?.search?.[0]?.title; let lang = 'es';
        if (!pageTitle) {
            const urlEn = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
            res = await fetch(urlEn, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
            data = await res.json(); pageTitle = data.query?.search?.[0]?.title; lang = 'en';
        }
        if (!pageTitle) return null;
        const urlImg = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=800&origin=*`;
        const resImg = await fetch(urlImg, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
        const dataImg = await resImg.json();
        const pages = dataImg.query?.pages;
        const pid   = Object.keys(pages || {})[0];
        const thumb = pages?.[pid]?.thumbnail?.source;
        if (thumb) { console.log(`   ✅ Wikipedia imagen: ${pageTitle}`); return thumb; }
        return null;
    } catch(e) { return null; }
}

async function buscarImagenWikimediaCommons(titulo) {
    try {
        const urlBusq = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
        let res = await fetch(urlBusq, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
        let data = await res.json();
        let pageTitle = data.query?.search?.[0]?.title;
        if (!pageTitle) {
            const urlEn = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo)}&format=json&srlimit=1&origin=*`;
            res = await fetch(urlEn, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } }); data = await res.json(); pageTitle = data.query?.search?.[0]?.title;
        }
        if (!pageTitle) return null;
        const urlCommons = `https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=${encodeURIComponent(pageTitle)}&gimlimit=5&prop=imageinfo&iiprop=url|mime&format=json&origin=*`;
        const resC = await fetch(urlCommons, { headers: { 'User-Agent': 'ElFarolAlDia/1.0' } });
        const dataC = await resC.json();
        for (const pid in (dataC.query?.pages || {})) {
            const p = dataC.query.pages[pid];
            if (p.imageinfo?.[0]?.mime?.startsWith('image/')) { console.log(`   ✅ Wikimedia Commons: ${p.title}`); return p.imageinfo[0].url; }
        }
        return null;
    } catch(e) { return null; }
}

function esImagenValida(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (!/(\.jpg|\.jpeg|\.png|\.webp)/i.test(u)) return false;
    const invalidos = ['.svg','flag','logo','map','coat_of_arms','seal','emblem','icon','badge','crest','shield','blason','wikimedia-button','powered_by','commons-logo','wikidata','location_map','signature','symbol','insignia','stamp','medal','_bw','-bw','black_white','blackwhite','grayscale','circa_19','_189','_190','_191','_192','_193','_194','20px','30px','40px','50px','60px','70px','80px'];
    if (invalidos.some(i => u.includes(i))) return false;
    if (u.includes('commons.wikimedia.org')) {
        const patronesViejos = ['portrait_of','painting_of','sketch_of','drawing_of','lithograph','engraving','illustration_of','woodcut','daguerreotype','photograph_circa','undated_photo'];
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
    if (queryIA) { const urlQueryIA = await buscarEnPexels([queryIA]); if (urlQueryIA) { console.log(`   ✅ Pexels (Gemini query)`); return urlQueryIA; } }
    const queries   = detectarQueriesPexels(titulo, categoria, null);
    const urlPexels = await buscarEnPexels(queries);
    if (urlPexels) { console.log(`   ✅ Pexels (queries detectadas)`); return urlPexels; }
    const urlWiki = await buscarImagenWikipedia(titulo);
    if (urlWiki && esImagenValida(urlWiki)) { console.log(`   ✅ Wikipedia (validada)`); return urlWiki; }
    const urlCommons = await buscarImagenWikimediaCommons(titulo);
    if (urlCommons && esImagenValida(urlCommons)) { console.log(`   ✅ Wikimedia (validada)`); return urlCommons; }
    console.log(`   📸 Banco local (${subtemaLocal || categoria})`);
    return imgLocal(subtemaLocal, categoria);
}

const PEXELS_QUERIES_RD = {
    'los mina':           ['santo domingo urban street life', 'caribbean city neighborhood people', 'latin america urban community', 'dominican republic street market', 'caribbean urban daily life'],
    'invivienda':         ['social housing construction latin america', 'affordable housing caribbean', 'residential building construction workers', 'housing project urban development', 'latin america apartment building construction'],
    'ensanche ozama':     ['santo domingo city architecture', 'caribbean urban district street', 'dominican republic city life', 'latin america urban infrastructure', 'caribbean neighborhood road'],
    'santo domingo este': ['santo domingo dominican republic cityscape', 'caribbean capital city skyline', 'dominican republic urban life', 'santo domingo street photography', 'caribbean city architecture'],
    'villa mella':        ['dominican republic suburb community', 'caribbean neighborhood street life', 'latin america residential area', 'dominican city outskirts', 'caribbean people community'],
    'sabana perdida':     ['dominican republic community neighborhood', 'caribbean urban street', 'latin america city district', 'dominican republic daily life', 'caribbean working class neighborhood'],
    'presidente':         ['president speech podium government', 'latin america president official event', 'government leader press conference', 'political leader official ceremony', 'president signing document desk'],
    'gobierno':           ['government building official meeting', 'latin america congress parliament', 'official government press conference', 'politicians meeting boardroom', 'government officials ceremony'],
    'congreso':           ['congress parliament building', 'legislators vote assembly hall', 'parliament session politicians', 'latin america congress building', 'government assembly debate'],
    'senado':             ['senate chamber politicians', 'legislators assembly hall vote', 'government senate session', 'parliament chamber officials', 'politicians congressional session'],
    'elecciones':         ['election voting booth ballot', 'people voting democracy caribbean', 'election campaign rally crowd', 'voting booth democracy latin america', 'election results announcement'],
    'inauguracion':       ['inauguration ceremony official ribbon cutting', 'official opening ceremony government', 'latin america inauguration public event', 'government ribbon cutting ceremony', 'official ceremony crowd applause'],
    'policia':            ['police patrol latin america street', 'law enforcement officer uniform', 'police investigation crime scene', 'caribbean police officers patrol', 'police arrest handcuffs law enforcement'],
    'crimen':             ['police crime investigation scene', 'law enforcement detective investigation', 'police tape crime scene urban', 'criminal investigation police work', 'security forces operation urban'],
    'narcotráfico':       ['drug enforcement police operation', 'anti-narcotics law enforcement operation', 'police seizure drugs operation', 'security forces drug interdiction', 'police anti-drug operation press conference'],
    'militar':            ['military soldiers uniform parade', 'armed forces military ceremony', 'soldiers military base training', 'latin america military defense', 'military officers uniform ceremony'],
    'procuraduria':       ['attorney general office courthouse', 'prosecutor press conference podium', 'justice courthouse building', 'legal system courtroom lawyers', 'justice department officials meeting'],
    'prision':            ['prison correctional facility security', 'jail bars cell incarceration', 'correctional facility guards', 'justice system incarceration', 'prison facility exterior security'],
    'accidente':          ['traffic accident car crash road', 'emergency response accident scene', 'ambulance emergency response', 'accident highway first responders', 'car crash police accident investigation'],
    'incendio':           ['fire emergency firefighters blaze', 'firefighters fighting building fire', 'fire truck emergency response fire', 'fire flames building emergency', 'firefighters rescue operation'],
    'economia':           ['business finance professionals meeting', 'stock market trading finance', 'bank building financial district', 'business executives boardroom discussion', 'economic growth financial chart data'],
    'banco':              ['bank building financial institution', 'bank teller customer service', 'modern bank interior lobby', 'financial institution banking', 'bank facade exterior architecture'],
    'remesas':            ['money transfer wire payment', 'international money transfer service', 'financial services payment technology', 'currency exchange money transfer', 'bank wire transfer international'],
    'mercado':            ['market vendors selling products', 'outdoor market trade commerce', 'latin america market people buying', 'caribbean market fresh produce', 'street market vendors commerce'],
    'comercio':           ['business commerce trade professionals', 'retail store shopping commerce', 'business meeting commerce deal', 'trade commerce handshake deal', 'small business owner shop'],
    'inversion':          ['business investment meeting professionals', 'investment finance growth chart', 'businesspeople handshake deal investment', 'financial investment strategy meeting', 'business growth investment success'],
    'inflacion':          ['grocery store prices inflation', 'supermarket shopping prices consumer', 'food prices market inflation', 'consumer prices shopping cart', 'inflation prices market economic'],
    'turismo':            ['punta cana beach resort luxury', 'caribbean beach turquoise water tourism', 'dominican republic resort hotel pool', 'tourists beach vacation caribbean', 'tropical beach resort tourism travel'],
    'salud':              ['hospital doctors medical staff', 'doctor patient consultation clinic', 'medical team healthcare professionals', 'hospital ward nurses doctors', 'healthcare medical professionals'],
    'hospital':           ['hospital building exterior entrance', 'hospital interior hallway medical staff', 'emergency room hospital doctors', 'hospital patients medical care', 'healthcare facility medical workers'],
    'medicina':           ['medical doctors surgery operation', 'doctor examining patient stethoscope', 'medical professionals hospital team', 'surgeon operating room procedure', 'medicine healthcare professionals working'],
    'vacuna':             ['vaccination injection healthcare nurse', 'vaccine shot medical professional', 'vaccination campaign healthcare workers', 'immunization vaccine health clinic', 'vaccine dose syringe medical'],
    'epidemia':           ['public health medical response team', 'epidemiology health workers protective equipment', 'medical team public health response', 'healthcare workers protective masks', 'disease prevention public health'],
    'dengue':             ['mosquito prevention public health campaign', 'fumigation pest control workers', 'public health fumigation urban', 'health workers fumigation community', 'vector control mosquito prevention'],
    'educacion':          ['students classroom learning school', 'teacher students lesson classroom', 'university students campus education', 'school children learning books', 'education classroom latin america'],
    'escuela':            ['school building education children', 'classroom students teacher learning', 'elementary school children study', 'school kids education classroom', 'school building entrance students'],
    'universidad':        ['university campus students college', 'college students campus buildings', 'university lecture hall students', 'higher education students graduation', 'university library students studying'],
    'maestro':            ['teacher classroom instruction students', 'teacher explaining lesson school', 'educator students whiteboard class', 'teacher children learning primary school', 'teaching education class children'],
    'infraestructura':    ['road construction workers equipment', 'highway infrastructure construction project', 'bridge construction engineering workers', 'urban infrastructure development workers', 'road repair construction equipment'],
    'carretera':          ['road highway construction workers', 'new highway infrastructure latin america', 'road paving construction crew', 'highway project construction equipment', 'road infrastructure development latin america'],
    'construccion':       ['construction workers building site', 'construction project architecture workers', 'building construction crane workers', 'construction site safety workers', 'urban development construction project'],
    'mopc':               ['road construction workers equipment caribbean', 'infrastructure government project workers', 'highway construction latin america', 'public works construction project', 'road infrastructure workers construction'],
    'vivienda':           ['housing construction workers project', 'residential homes construction site', 'affordable housing project community', 'housing development construction workers', 'new homes construction residential'],
    'agua':               ['water treatment plant infrastructure', 'water supply pipeline installation', 'water infrastructure workers construction', 'drinking water facility treatment', 'water system installation workers'],
    'electricidad':       ['power lines electricity infrastructure', 'electrical workers power lines installation', 'electricity power plant energy', 'electrical infrastructure workers', 'power grid energy electricity workers'],
    'beisbol':            ['baseball game stadium fans crowd', 'baseball pitcher throwing stadium', 'baseball player batting home run', 'baseball team dugout players', 'dominican republic baseball stadium'],
    'béisbol':            ['baseball game stadium fans crowd', 'baseball pitcher throwing stadium', 'baseball player batting home run', 'baseball team dugout players', 'baseball minor league players practice'],
    'futbol':             ['soccer football match stadium crowd', 'football players game action', 'soccer team training practice field', 'football game crowd stadium', 'soccer players game action sports'],
    'fútbol':             ['soccer football match stadium crowd', 'football players game action', 'soccer team training practice field', 'football game crowd stadium', 'soccer players game action sports'],
    'boxeo':              ['boxing match ring fighters', 'boxer training punching bag gym', 'boxing fight professional arena', 'boxers sparring training gym', 'boxing championship match ring'],
    'atletismo':          ['athlete running track competition', 'track field athletics competition', 'runner athlete race stadium', 'athletics training professional athlete', 'sprinter race competition track'],
    'natacion':           ['swimmer pool competition race', 'swimming championship athlete pool', 'competitive swimmer race lane', 'swimmer training pool laps', 'swimming competition athletes pool'],
    'olimpiadas':         ['olympic games athletes competition', 'olympic stadium athletes ceremony', 'olympic torch ceremony athletes', 'olympic games sports competition', 'athletes olympic competition medal'],
    'tecnologia':         ['technology innovation digital business', 'tech startup team working computers', 'software developer coding computer', 'digital technology innovation lab', 'technology professionals working office'],
    'inteligencia artificial': ['artificial intelligence technology computer', 'AI technology digital innovation', 'machine learning data technology', 'computer science AI research', 'technology AI digital transformation'],
    'internet':           ['internet technology digital connection', 'wifi network digital connectivity', 'online technology internet use', 'digital internet connected devices', 'technology internet connectivity people'],
    'ciberseguridad':     ['cybersecurity technology hacker computer', 'cyber security professional computer', 'digital security technology network', 'cybersecurity expert working computer', 'security technology digital protection'],
    'musica':             ['music concert performance stage lights', 'musicians performing concert crowd', 'music band performance stage', 'concert live music crowd fans', 'singer performing microphone stage'],
    'merengue':           ['latin music dance performance stage', 'caribbean music band performing', 'latin dance music concert crowd', 'tropical music festival performance', 'caribbean culture music dancing'],
    'carnaval':           ['carnival parade colorful costumes crowd', 'festive parade celebration costumes', 'carnival celebration people dancing costumes', 'street parade festival celebration', 'carnival festive celebration crowd'],
    'cine':               ['film cinema movie production', 'movie theater cinema audience', 'film production director actors set', 'cinema audience movie theater', 'film set production camera crew'],
    'arte':               ['art gallery exhibition artist', 'contemporary art museum exhibition', 'artist painting studio creating', 'art exhibition gallery visitors', 'artistic performance culture'],
    'medio ambiente':     ['nature environment conservation forest', 'environmental protection activists', 'deforestation environmental issue forest', 'clean energy solar panels environment', 'environmental conservation activists nature'],
    'clima':              ['climate change storm weather extreme', 'climate environmental weather impact', 'storm hurricane extreme weather', 'climate change environmental protest', 'weather storm flooding climate'],
    'huracan':            ['hurricane storm damage destruction', 'tropical storm damage aftermath', 'hurricane flooding streets damage', 'tropical cyclone storm destruction', 'disaster relief hurricane aftermath'],
    'inundacion':         ['flood flooding water streets', 'flood disaster emergency response', 'flooding streets cars water', 'flood damage homes community', 'flood emergency rescue workers'],
    'haiti':              ['haiti dominican republic border crossing', 'haitian dominican diplomacy officials', 'border security latin america', 'diplomatic meeting caribbean officials', 'humanitarian aid border caribbean'],
    'diplomacia':         ['diplomacy meeting international officials', 'diplomatic summit world leaders', 'international meeting conference table', 'diplomats officials handshake meeting', 'international summit conference officials'],
    'estados unidos':     ['united states government washington dc', 'us capitol building washington', 'american flag government building', 'washington dc government official', 'united states diplomacy official'],
    'migracion':          ['immigration border crossing people', 'migrants border crossing', 'immigration officials border security', 'refugee migrants humanitarian', 'border crossing immigration control'],
    'Nacionales':         ['dominican republic government news', 'santo domingo city official event', 'dominican republic flag ceremony', 'caribbean government officials press', 'latin america news event crowd'],
    'Deportes':           ['dominican republic athlete sports', 'caribbean sports competition athlete', 'sports game stadium crowd latin america', 'athlete competition professional sports', 'sports training professional athlete'],
    'Internacionales':    ['international news world leaders', 'global summit conference diplomacy', 'world news event international', 'latin america international relations', 'caribbean diplomacy international meeting'],
    'Economía':           ['latin america business finance economy', 'caribbean economic development', 'business professionals meeting economy', 'financial district bank economy', 'economy market trade latin america'],
    'Tecnología':         ['technology innovation digital latin america', 'tech professionals working computers', 'digital innovation startup team', 'technology conference professionals', 'digital transformation business tech'],
    'Espectáculos':       ['latin entertainment music show concert', 'caribbean cultural performance arts', 'entertainment show stage lights', 'celebrity artist performance concert', 'latin music culture entertainment'],
};

async function buscarEnPexels(queries) {
    if (!PEXELS_API_KEY) return null;
    const BLOQUEADOS = ['wedding', 'bride', 'groom', 'bridal', 'couple', 'romance', 'romantic', 'fashion', 'model', 'party', 'celebration', 'flowers', 'love', 'kiss', 'marriage'];
    const listaQueries = (Array.isArray(queries) ? queries : [queries]).filter(q => !BLOQUEADOS.some(b => q.toLowerCase().includes(b)));
    if (!listaQueries.length) { console.log('   📸 Todas las queries bloqueadas → banco local'); return null; }
    for (const query of listaQueries) {
        try {
            const url  = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`;
            const ctrl = new AbortController();
            const tm   = setTimeout(() => ctrl.abort(), 5000);
            const res  = await fetch(url, { headers: { Authorization: PEXELS_API_KEY }, signal: ctrl.signal }).finally(() => clearTimeout(tm));
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
    const queries     = [];
    if (queryIA) queries.push(queryIA);
    const catsSaltar  = ['Nacionales','Deportes','Internacionales','Economía','Tecnología','Espectáculos'];
    for (const [clave, qs] of Object.entries(PEXELS_QUERIES_RD)) {
        if (catsSaltar.includes(clave)) continue;
        if (tituloLower.includes(clave.toLowerCase())) queries.push(...qs);
    }
    if (PEXELS_QUERIES_RD[categoria]) queries.push(...PEXELS_QUERIES_RD[categoria]);
    queries.push('dominican republic news event', 'caribbean latin america people', 'santo domingo dominican republic');
    return [...new Set(queries)].slice(0, 12);
}

// ══════════════════════════════════════════════════════════
// BANCO LOCAL DE IMÁGENES
// ══════════════════════════════════════════════════════════
const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';

const BANCO_LOCAL = {
    'politica-gobierno': [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,`${PB}/290595/pexels-photo-290595.jpeg${OPT}`,`${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`,`${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`,`${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,`${PB}/2990644/pexels-photo-2990644.jpeg${OPT}`,`${PB}/3184418/pexels-photo-3184418.jpeg${OPT}`,`${PB}/5668481/pexels-photo-5668481.jpeg${OPT}`,`${PB}/3182812/pexels-photo-3182812.jpeg${OPT}`,`${PB}/4427611/pexels-photo-4427611.jpeg${OPT}`],
    'seguridad-policia': [`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`,`${PB}/5699456/pexels-photo-5699456.jpeg${OPT}`,`${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,`${PB}/6980997/pexels-photo-6980997.jpeg${OPT}`,`${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,`${PB}/7491987/pexels-photo-7491987.jpeg${OPT}`,`${PB}/8761572/pexels-photo-8761572.jpeg${OPT}`,`${PB}/5699859/pexels-photo-5699859.jpeg${OPT}`,`${PB}/6289059/pexels-photo-6289059.jpeg${OPT}`,`${PB}/6044266/pexels-photo-6044266.jpeg${OPT}`],
    'relaciones-internacionales': [`${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`,`${PB}/358319/pexels-photo-358319.jpeg${OPT}`,`${PB}/3407617/pexels-photo-3407617.jpeg${OPT}`,`${PB}/3997992/pexels-photo-3997992.jpeg${OPT}`,`${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`,`${PB}/1550337/pexels-photo-1550337.jpeg${OPT}`,`${PB}/3184339/pexels-photo-3184339.jpeg${OPT}`,`${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`,`${PB}/7948035/pexels-photo-7948035.jpeg${OPT}`,`${PB}/3184292/pexels-photo-3184292.jpeg${OPT}`],
    'economia-mercado': [`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`,`${PB}/6772070/pexels-photo-6772070.jpeg${OPT}`,`${PB}/3532557/pexels-photo-3532557.jpeg${OPT}`,`${PB}/6801648/pexels-photo-6801648.jpeg${OPT}`,`${PB}/210607/pexels-photo-210607.jpeg${OPT}`,`${PB}/1602726/pexels-photo-1602726.jpeg${OPT}`,`${PB}/3943723/pexels-photo-3943723.jpeg${OPT}`,`${PB}/7567443/pexels-photo-7567443.jpeg${OPT}`,`${PB}/6120214/pexels-photo-6120214.jpeg${OPT}`,`${PB}/5849559/pexels-photo-5849559.jpeg${OPT}`],
    'infraestructura': [`${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`,`${PB}/323780/pexels-photo-323780.jpeg${OPT}`,`${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`,`${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`,`${PB}/159306/pexels-photo-159306.jpeg${OPT}`,`${PB}/1463917/pexels-photo-1463917.jpeg${OPT}`,`${PB}/2760241/pexels-photo-2760241.jpeg${OPT}`,`${PB}/247763/pexels-photo-247763.jpeg${OPT}`,`${PB}/1134166/pexels-photo-1134166.jpeg${OPT}`,`${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`],
    'salud-medicina': [`${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`,`${PB}/40568/pexels-photo-40568.jpeg${OPT}`,`${PB}/4386467/pexels-photo-4386467.jpeg${OPT}`,`${PB}/1170979/pexels-photo-1170979.jpeg${OPT}`,`${PB}/5327580/pexels-photo-5327580.jpeg${OPT}`,`${PB}/3993212/pexels-photo-3993212.jpeg${OPT}`,`${PB}/4021775/pexels-photo-4021775.jpeg${OPT}`,`${PB}/3985163/pexels-photo-3985163.jpeg${OPT}`,`${PB}/5214958/pexels-photo-5214958.jpeg${OPT}`,`${PB}/4226219/pexels-photo-4226219.jpeg${OPT}`],
    'deporte-beisbol': [`${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`,`${PB}/209977/pexels-photo-209977.jpeg${OPT}`,`${PB}/248318/pexels-photo-248318.jpeg${OPT}`,`${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`,`${PB}/163452/pexels-photo-163452.jpeg${OPT}`,`${PB}/1618200/pexels-photo-1618200.jpeg${OPT}`,`${PB}/2277981/pexels-photo-2277981.jpeg${OPT}`,`${PB}/3041176/pexels-photo-3041176.jpeg${OPT}`,`${PB}/186077/pexels-photo-186077.jpeg${OPT}`,`${PB}/1752757/pexels-photo-1752757.jpeg${OPT}`],
    'deporte-futbol': [`${PB}/46798/pexels-photo-46798.jpeg${OPT}`,`${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`,`${PB}/3873098/pexels-photo-3873098.jpeg${OPT}`,`${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`,`${PB}/274422/pexels-photo-274422.jpeg${OPT}`,`${PB}/1171084/pexels-photo-1171084.jpeg${OPT}`,`${PB}/1618200/pexels-photo-1618200.jpeg${OPT}`,`${PB}/2277981/pexels-photo-2277981.jpeg${OPT}`,`${PB}/3041176/pexels-photo-3041176.jpeg${OPT}`,`${PB}/114296/pexels-photo-114296.jpeg${OPT}`],
    'deporte-general': [`${PB}/863988/pexels-photo-863988.jpeg${OPT}`,`${PB}/936094/pexels-photo-936094.jpeg${OPT}`,`${PB}/2526878/pexels-photo-2526878.jpeg${OPT}`,`${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`,`${PB}/1552252/pexels-photo-1552252.jpeg${OPT}`,`${PB}/3764014/pexels-photo-3764014.jpeg${OPT}`,`${PB}/2294353/pexels-photo-2294353.jpeg${OPT}`,`${PB}/1752757/pexels-photo-1752757.jpeg${OPT}`,`${PB}/4761671/pexels-photo-4761671.jpeg${OPT}`,`${PB}/3621517/pexels-photo-3621517.jpeg${OPT}`],
    'tecnologia': [`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`,`${PB}/2582937/pexels-photo-2582937.jpeg${OPT}`,`${PB}/5632399/pexels-photo-5632399.jpeg${OPT}`,`${PB}/3932499/pexels-photo-3932499.jpeg${OPT}`,`${PB}/1181244/pexels-photo-1181244.jpeg${OPT}`,`${PB}/574071/pexels-photo-574071.jpeg${OPT}`,`${PB}/3861969/pexels-photo-3861969.jpeg${OPT}`,`${PB}/4050315/pexels-photo-4050315.jpeg${OPT}`,`${PB}/5926382/pexels-photo-5926382.jpeg${OPT}`,`${PB}/7988086/pexels-photo-7988086.jpeg${OPT}`],
    'educacion': [`${PB}/256490/pexels-photo-256490.jpeg${OPT}`,`${PB}/289737/pexels-photo-289737.jpeg${OPT}`,`${PB}/1205651/pexels-photo-1205651.jpeg${OPT}`,`${PB}/4143791/pexels-photo-4143791.jpeg${OPT}`,`${PB}/301926/pexels-photo-301926.jpeg${OPT}`,`${PB}/5905559/pexels-photo-5905559.jpeg${OPT}`,`${PB}/3769021/pexels-photo-3769021.jpeg${OPT}`,`${PB}/4491461/pexels-photo-4491461.jpeg${OPT}`,`${PB}/4145197/pexels-photo-4145197.jpeg${OPT}`,`${PB}/8617816/pexels-photo-8617816.jpeg${OPT}`],
    'cultura-musica': [`${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`,`${PB}/1540406/pexels-photo-1540406.jpeg${OPT}`,`${PB}/3651308/pexels-photo-3651308.jpeg${OPT}`,`${PB}/2521317/pexels-photo-2521317.jpeg${OPT}`,`${PB}/1047442/pexels-photo-1047442.jpeg${OPT}`,`${PB}/167636/pexels-photo-167636.jpeg${OPT}`,`${PB}/995301/pexels-photo-995301.jpeg${OPT}`,`${PB}/2191013/pexels-photo-2191013.jpeg${OPT}`,`${PB}/1105666/pexels-photo-1105666.jpeg${OPT}`,`${PB}/1769280/pexels-photo-1769280.jpeg${OPT}`],
    'medio-ambiente': [`${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`,`${PB}/1366919/pexels-photo-1366919.jpeg${OPT}`,`${PB}/2559941/pexels-photo-2559941.jpeg${OPT}`,`${PB}/414612/pexels-photo-414612.jpeg${OPT}`,`${PB}/247599/pexels-photo-247599.jpeg${OPT}`,`${PB}/1666012/pexels-photo-1666012.jpeg${OPT}`,`${PB}/572897/pexels-photo-572897.jpeg${OPT}`,`${PB}/1021142/pexels-photo-1021142.jpeg${OPT}`,`${PB}/3225517/pexels-photo-3225517.jpeg${OPT}`,`${PB}/1423600/pexels-photo-1423600.jpeg${OPT}`],
    'turismo': [`${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`,`${PB}/1174732/pexels-photo-1174732.jpeg${OPT}`,`${PB}/3601425/pexels-photo-3601425.jpeg${OPT}`,`${PB}/2104152/pexels-photo-2104152.jpeg${OPT}`,`${PB}/237272/pexels-photo-237272.jpeg${OPT}`,`${PB}/1450360/pexels-photo-1450360.jpeg${OPT}`,`${PB}/3601453/pexels-photo-3601453.jpeg${OPT}`,`${PB}/994605/pexels-photo-994605.jpeg${OPT}`,`${PB}/1268855/pexels-photo-1268855.jpeg${OPT}`,`${PB}/3155666/pexels-photo-3155666.jpeg${OPT}`],
    'emergencia': [`${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`,`${PB}/263402/pexels-photo-263402.jpeg${OPT}`,`${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`,`${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`,`${PB}/3259629/pexels-photo-3259629.jpeg${OPT}`,`${PB}/4386396/pexels-photo-4386396.jpeg${OPT}`,`${PB}/6129049/pexels-photo-6129049.jpeg${OPT}`,`${PB}/5726825/pexels-photo-5726825.jpeg${OPT}`,`${PB}/7541956/pexels-photo-7541956.jpeg${OPT}`,`${PB}/6129113/pexels-photo-6129113.jpeg${OPT}`],
    'vivienda-social': [`${PB}/323780/pexels-photo-323780.jpeg${OPT}`,`${PB}/1396122/pexels-photo-1396122.jpeg${OPT}`,`${PB}/2102587/pexels-photo-2102587.jpeg${OPT}`,`${PB}/1370704/pexels-photo-1370704.jpeg${OPT}`,`${PB}/259588/pexels-photo-259588.jpeg${OPT}`,`${PB}/1029599/pexels-photo-1029599.jpeg${OPT}`,`${PB}/280229/pexels-photo-280229.jpeg${OPT}`,`${PB}/534151/pexels-photo-534151.jpeg${OPT}`,`${PB}/1080721/pexels-photo-1080721.jpeg${OPT}`,`${PB}/2724749/pexels-photo-2724749.jpeg${OPT}`],
    'transporte-vial': [`${PB}/93398/pexels-photo-93398.jpeg${OPT}`,`${PB}/1004409/pexels-photo-1004409.jpeg${OPT}`,`${PB}/1494277/pexels-photo-1494277.jpeg${OPT}`,`${PB}/210182/pexels-photo-210182.jpeg${OPT}`,`${PB}/2199293/pexels-photo-2199293.jpeg${OPT}`,`${PB}/3806978/pexels-photo-3806978.jpeg${OPT}`,`${PB}/1838640/pexels-photo-1838640.jpeg${OPT}`,`${PB}/1004409/pexels-photo-1004409.jpeg${OPT}`,`${PB}/3802510/pexels-photo-3802510.jpeg${OPT}`,`${PB}/163786/pexels-photo-163786.jpeg${OPT}`],
};

const FALLBACK_CAT = {
    'Nacionales':'politica-gobierno','Deportes':'deporte-general','Internacionales':'relaciones-internacionales',
    'Economía':'economia-mercado','Tecnología':'tecnologia','Espectáculos':'cultura-musica',
    'Salud':'salud-medicina','Educación':'educacion','Turismo':'turismo','Ambiente':'medio-ambiente',
};

function imgLocal(sub, cat) {
    const banco = BANCO_LOCAL[sub] || BANCO_LOCAL[FALLBACK_CAT[cat]] || BANCO_LOCAL['politica-gobierno'];
    return banco[Math.floor(Math.random() * banco.length)];
}

async function obtenerImagen(titulo, categoria, subtemaLocal, queryIA) {
    const queries   = detectarQueriesPexels(titulo, categoria, queryIA);
    const urlPexels = await buscarEnPexels(queries);
    if (urlPexels) return urlPexels;
    console.log(`   📸 Pexels sin resultado → banco local (${subtemaLocal || 'general'})`);
    return imgLocal(subtemaLocal, categoria);
}

// ══════════════════════════════════════════════════════════
// ALT SEO
// ══════════════════════════════════════════════════════════
function generarAltSEO(titulo, categoria, altIA, subtema) {
    if (altIA && altIA.length > 15) {
        const yaTieneRD = altIA.toLowerCase().includes('dominican') || altIA.toLowerCase().includes('república') || altIA.toLowerCase().includes('santo domingo');
        if (yaTieneRD) return `${altIA} - El Farol al Día`;
        const contextoCat = { 'Nacionales':'noticias República Dominicana','Deportes':'deportes dominicanos','Internacionales':'noticias internacionales impacto RD','Economía':'economía República Dominicana','Tecnología':'tecnología innovación RD','Espectáculos':'cultura entretenimiento dominicano' };
        return `${altIA}, ${contextoCat[categoria] || 'República Dominicana'} - El Farol al Día`;
    }
    const base = {
        'Nacionales':`Noticia nacional ${titulo.substring(0,40)} - Santo Domingo, República Dominicana`,
        'Deportes':`Deportes dominicanos ${titulo.substring(0,40)} - El Farol al Día RD`,
        'Internacionales':`Noticias internacionales ${titulo.substring(0,30)} - impacto en República Dominicana`,
        'Economía':`Economía dominicana ${titulo.substring(0,35)} - finanzas República Dominicana`,
        'Tecnología':`Tecnología ${titulo.substring(0,35)} - innovación República Dominicana`,
        'Espectáculos':`Espectáculos dominicanos ${titulo.substring(0,35)} - cultura RD`,
    };
    return (base[categoria] || `${titulo.substring(0,50)} - noticias República Dominicana El Farol al Día`);
}

// ══════════════════════════════════════════════════════════
// SEO META TAGS
// ══════════════════════════════════════════════════════════
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function metaTagsCompletos(n, url) {
    const t=esc(n.titulo),d=esc(n.seo_description||''),k=esc(n.seo_keywords||'');
    const img=esc(n.imagen),red=esc(n.redactor),sec=esc(n.seccion);
    const fi=new Date(n.fecha).toISOString(),ue=esc(url);
    const wc=(n.contenido||'').split(/\s+/).filter(w=>w).length;
    const keywordsSEO=[n.seo_keywords||'','último minuto república dominicana','santo domingo este noticias','noticias el almirante','tendencias dominicanas','el farol al día'].filter(Boolean).join(', ');
    const schema={"@context":"https://schema.org","@type":"NewsArticle","mainEntityOfPage":{"@type":"WebPage","@id":url},"headline":n.titulo,"description":n.seo_description||'',"keywords":keywordsSEO,"image":{"@type":"ImageObject","url":n.imagen,"caption":n.imagen_caption||n.titulo,"width":1200,"height":630},"datePublished":fi,"dateModified":fi,"author":{"@type":"Person","name":"José Gregorio Mañan Santana","url":`${BASE_URL}/nosotros`,"jobTitle":"Director General","worksFor":{"@type":"Organization","name":"El Farol al Día"}},"creator":n.redactor,"publisher":{"@type":"NewsMediaOrganization","name":"El Farol al Día","url":BASE_URL,"sameAs":["https://www.facebook.com/elfarolaldia","https://twitter.com/elfarolaldia"],"logo":{"@type":"ImageObject","url":`${BASE_URL}/static/favicon.png`,"width":512,"height":512},"address":{"@type":"PostalAddress","addressLocality":"Santo Domingo Este","addressRegion":"Distrito Nacional","addressCountry":"DO"}},"articleSection":n.seccion,"wordCount":wc,"inLanguage":"es-DO","isAccessibleForFree":true,"copyrightHolder":"El Farol al Día","copyrightYear":new Date(n.fecha).getFullYear(),"locationCreated":{"@type":"Place","name":"Santo Domingo Este, República Dominicana"}};
    const bread={"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Inicio","item":BASE_URL},{"@type":"ListItem","position":2,"name":"Último Minuto RD","item":`${BASE_URL}/`},{"@type":"ListItem","position":3,"name":n.seccion,"item":`${BASE_URL}/#${(n.seccion||'').toLowerCase()}`},{"@type":"ListItem","position":4,"name":n.titulo,"item":url}]};
    const orgSchema={"@context":"https://schema.org","@type":"NewsMediaOrganization","name":"El Farol al Día","url":BASE_URL,"description":"Tu portal de noticias de Último Minuto en Santo Domingo Este y toda la República Dominicana","areaServed":["República Dominicana","Santo Domingo Este","Caribe"],"logo":{"@type":"ImageObject","url":`${BASE_URL}/static/favicon.png`}};
    const tituloSEO=(n.titulo.toLowerCase().includes('santo domingo')||n.titulo.toLowerCase().includes('sde'))?`${t} | El Farol al Día`:`${t} | Último Minuto RD · El Farol al Día`;
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
<meta property="og:image:alt" content="${esc(n.imagen_alt||n.titulo)}">
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
<meta name="twitter:image:alt" content="${esc(n.imagen_alt||n.titulo)}">
<meta name="twitter:site" content="@elfarolaldia">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(bread)}</script>
<script type="application/ld+json">${JSON.stringify(orgSchema)}</script>`;
}

// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════
function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').substring(0,80);
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
// INICIALIZAR BASE DE DATOS
// ══════════════════════════════════════════════════════════
async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS noticias(id SERIAL PRIMARY KEY,titulo VARCHAR(255) NOT NULL,slug VARCHAR(255) UNIQUE,seccion VARCHAR(100),contenido TEXT,seo_description VARCHAR(160),seo_keywords VARCHAR(255),redactor VARCHAR(100),imagen TEXT,imagen_alt VARCHAR(255),imagen_caption TEXT,imagen_nombre VARCHAR(100),imagen_fuente VARCHAR(50),vistas INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,estado VARCHAR(50) DEFAULT 'publicada')`);
        for (const col of ['imagen_alt','imagen_caption','imagen_nombre','imagen_fuente','imagen_original']) {
            await client.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}') THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT; END IF; END $$;`).catch(()=>{});
        }
        await client.query(`CREATE TABLE IF NOT EXISTS rss_procesados(id SERIAL PRIMARY KEY,item_guid VARCHAR(500) UNIQUE,fuente VARCHAR(100),fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE TABLE IF NOT EXISTS memoria_ia(id SERIAL PRIMARY KEY,tipo VARCHAR(50) NOT NULL,valor TEXT NOT NULL,categoria VARCHAR(100),exitos INTEGER DEFAULT 0,fallos INTEGER DEFAULT 0,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_memoria_tipo ON memoria_ia(tipo, categoria)`).catch(()=>{});
        await client.query(`CREATE TABLE IF NOT EXISTS comentarios(id SERIAL PRIMARY KEY,noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,nombre VARCHAR(80) NOT NULL,texto TEXT NOT NULL,aprobado BOOLEAN DEFAULT true,fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_comentarios_noticia ON comentarios(noticia_id, aprobado, fecha DESC)`).catch(()=>{});
        const fix = await client.query(`UPDATE noticias SET imagen='${PB}/3052454/pexels-photo-3052454.jpeg${OPT}', imagen_fuente='pexels' WHERE imagen LIKE '%/images/cache/%' OR imagen LIKE '%fallback%' OR imagen IS NULL OR imagen=''`);
        if (fix.rowCount > 0) console.log(`🔧 Imágenes reparadas: ${fix.rowCount}`);
        console.log('✅ BD lista');
    } catch (e) { console.error('❌ BD:', e.message); }
    finally { client.release(); }
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// SISTEMA DE MEMORIA IA
// ══════════════════════════════════════════════════════════
async function registrarQueryPexels(query, categoria, exito) {
    try {
        await pool.query(`INSERT INTO memoria_ia(tipo, valor, categoria, exitos, fallos) VALUES('pexels_query', $1, $2, $3, $4) ON CONFLICT DO NOTHING`, [query, categoria, exito?1:0, exito?0:1]);
        await pool.query(`UPDATE memoria_ia SET exitos = exitos + $1, fallos = fallos + $2, ultima_vez = NOW() WHERE tipo = 'pexels_query' AND valor = $3 AND categoria = $4`, [exito?1:0, exito?0:1, query, categoria]);
    } catch(e) {}
}

async function obtenerMejoresQueries(categoria) {
    try {
        const r = await pool.query(`SELECT valor, exitos, fallos, (exitos::float / GREATEST(exitos + fallos, 1)) as tasa_exito FROM memoria_ia WHERE tipo = 'pexels_query' AND (categoria = $1 OR categoria = 'general') AND exitos > 0 ORDER BY tasa_exito DESC, exitos DESC LIMIT 5`, [categoria]);
        return r.rows.map(r => r.valor);
    } catch(e) { return []; }
}

async function registrarError(tipo, descripcion, categoria) {
    try {
        await pool.query(`INSERT INTO memoria_ia(tipo, valor, categoria, fallos) VALUES('error', $1, $2, 1) ON CONFLICT DO NOTHING`, [descripcion.substring(0,200), categoria]);
        await pool.query(`UPDATE memoria_ia SET fallos = fallos + 1, ultima_vez = NOW() WHERE tipo = 'error' AND valor = $1`, [descripcion.substring(0,200)]);
    } catch(e) {}
}

async function construirMemoria(categoria) {
    let memoria = '';
    try {
        const recientes = await pool.query(`SELECT titulo, fecha FROM noticias WHERE estado = 'publicada' ORDER BY fecha DESC LIMIT 15`);
        if (recientes.rows.length) { memoria += `\n⛔ YA PUBLICADAS — NO repetir ni parafrasear:\n`; memoria += recientes.rows.map((x,i) => `${i+1}. ${x.titulo}`).join('\n'); memoria += '\n'; }
        const errores = await pool.query(`SELECT valor FROM memoria_ia WHERE tipo = 'error' AND categoria = $1 AND ultima_vez > NOW() - INTERVAL '24 hours' ORDER BY fallos DESC LIMIT 3`, [categoria]);
        if (errores.rows.length) { memoria += `\n⚠️ TEMAS CON PROBLEMAS RECIENTES (evitar):\n`; memoria += errores.rows.map(e=>`- ${e.valor}`).join('\n'); memoria += '\n'; }
        const mejores = await obtenerMejoresQueries(categoria);
        if (mejores.length) { memoria += `\n💡 QUERIES DE IMAGEN QUE FUNCIONAN BIEN PARA ${categoria.toUpperCase()}:\n`; memoria += mejores.map(q=>`- "${q}"`).join('\n'); memoria += '\n'; }
    } catch(e) {}
    return memoria;
}

async function regenerarWatermarksLostidos() {
    try {
        const r = await pool.query(`SELECT id, imagen, imagen_nombre, imagen_original FROM noticias WHERE imagen LIKE '%/img/%' AND imagen_original IS NOT NULL AND imagen_original != '' ORDER BY fecha DESC LIMIT 50`);
        if (!r.rows.length) return;
        let regeneradas = 0;
        for (const n of r.rows) {
            const nombre = n.imagen_nombre || n.imagen.split('/img/')[1];
            if (!nombre) continue;
            const ruta = path.join('/tmp', nombre);
            if (fs.existsSync(ruta)) continue;
            const resultado = await aplicarMarcaDeAgua(n.imagen_original);
            if (resultado.procesada && resultado.nombre) {
                await pool.query(`UPDATE noticias SET imagen=$1, imagen_nombre=$2 WHERE id=$3`, [`${BASE_URL}/img/${resultado.nombre}`, resultado.nombre, n.id]);
                regeneradas++;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        if (regeneradas > 0) { console.log(`🏮 Watermarks regenerados: ${regeneradas}`); invalidarCache(); }
    } catch(e) { console.log(`⚠️ Regeneración watermarks: ${e.message}`); }
}

// ══════════════════════════════════════════════════════════
// ▶ GENERAR NOTICIA — INTEGRA llamarGeminiImagen (V34.1)
// El prompt de texto usa KEY1/KEY2.
// La query de imagen y el alt SEO usan KEY3/KEY4.
// ══════════════════════════════════════════════════════════
async function generarNoticia(categoria, comunicadoExterno = null) {
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };

        const memoria = await construirMemoria(categoria);
        const fuenteContenido = comunicadoExterno
            ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado. Reescribe con tu estilo periodístico, no copies textualmente.`
            : `\nEscribe una noticia NUEVA sobre la categoría "${categoria}" para República Dominicana. Que sea un hecho real y relevante del contexto actual.`;

        const temaParaWiki = comunicadoExterno
            ? (comunicadoExterno.split('\n')[0] || '').replace(/^T[IÍ]TULO:\s*/i,'').trim() || categoria
            : categoria;

        const contextoWiki = await buscarContextoWikipedia(temaParaWiki, categoria);

        // ── PROMPT PRINCIPAL (KEY1 / KEY2) ───────────────
        const promptTexto = `${CONFIG_IA.instruccion_principal}

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

REGLAS SEO GOOGLE NEWS 2025:
TÍTULO:
- Entre 10 y 110 caracteres (ideal 60-70)
- PALABRAS DE ORO cuando aplique: "Último Minuto", "Santo Domingo Este"
- Debe incluir: hecho concreto + actor + contexto RD
- PROHIBIDO: fechas en el título, números al inicio, clickbait puro

DESCRIPCIÓN SEO: Exactamente 150-160 caracteres

KEYWORDS: 5 palabras clave, primera siempre "república dominicana"

RESPONDE EXACTAMENTE CON ESTE FORMATO:
TITULO: [60-70 chars]
DESCRIPCION: [150-160 chars exactos]
PALABRAS: [5 keywords]
SUBTEMA_LOCAL: [uno de: ${Object.keys(BANCO_LOCAL).join(', ')}]
CONTENIDO:
[400-500 palabras, 5 párrafos, pirámide invertida]`;

        console.log(`\n📰 Generando: ${categoria}${comunicadoExterno ? ' (RSS)' : ''}`);
        const textoGemini = await llamarGemini(promptTexto);

        // Parsear respuesta de texto
        const textoLimpio = textoGemini.replace(/^\s*[*#]+\s*/gm, '');
        let titulo = '', desc = '', pals = '', sub = '', contenido = '';
        let enContenido = false;
        const bloques = [];
        for (const linea of textoLimpio.split('\n')) {
            const t = linea.trim();
            if      (t.startsWith('TITULO:'))        titulo = t.replace('TITULO:','').trim();
            else if (t.startsWith('DESCRIPCION:'))   desc   = t.replace('DESCRIPCION:','').trim();
            else if (t.startsWith('PALABRAS:'))      pals   = t.replace('PALABRAS:','').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) sub    = t.replace('SUBTEMA_LOCAL:','').trim();
            else if (t.startsWith('CONTENIDO:'))     enContenido = true;
            else if (enContenido && t.length > 0)    bloques.push(t);
        }
        contenido = bloques.join('\n\n');
        titulo    = titulo.replace(/[*_#`"]/g,'').trim();
        desc      = desc.replace(/[*_#`]/g,'').trim();

        if (!titulo) throw new Error('Gemini no devolvió TITULO');
        if (!contenido || contenido.length < 300) throw new Error(`Contenido insuficiente (${contenido.length} chars)`);

        console.log(`   📝 ${titulo}`);

        // ── PROMPT DE IMAGEN (KEY3 / KEY4) — independiente ──
        // Si falla, usa fallback automático sin detener la publicación
        let qi = '';
        let ai = '';

        const promptImagen = `Eres asistente de imagen para un periódico dominicano.
Dado este titular de noticia: "${titulo}"
Categoría: ${categoria}

Responde SOLO con este formato exacto (sin texto adicional):
QUERY_IMAGEN: [3-5 palabras en inglés describiendo la escena fotográfica, sin bodas ni mascotas]
ALT_IMAGEN: [15-20 palabras en español SEO: descripción visual + tema + República Dominicana]

MAPEO:
economía/finanzas → "latin america business finance professionals"
seguridad/policía → "caribbean police officers law enforcement"
política/gobierno → "dominican republic government building officials"
béisbol → "dominican republic baseball player stadium"
salud/hospital → "latin america hospital doctor medical staff"
tecnología → "latin america technology digital innovation"
turismo → "dominican republic beach resort tourism"
construcción → "latin america construction workers building"`;

        const respuestaImagen = await llamarGeminiImagen(promptImagen);

        if (respuestaImagen) {
            for (const linea of respuestaImagen.split('\n')) {
                const t = linea.trim();
                if (t.startsWith('QUERY_IMAGEN:')) qi = t.replace('QUERY_IMAGEN:','').trim();
                if (t.startsWith('ALT_IMAGEN:'))   ai = t.replace('ALT_IMAGEN:','').trim();
            }
        }

        // Imagen con lógica inteligente
        const urlOrig    = await obtenerImagenInteligente(titulo, categoria, sub, qi);
        const imgResult  = await aplicarMarcaDeAgua(urlOrig);
        const urlFinal   = imgResult.procesada ? `${BASE_URL}/img/${imgResult.nombre}` : urlOrig;
        const altFinal   = generarAltSEO(titulo, categoria, ai, sub);

        // Guardar en BD
        const sl     = slugify(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
        const slFin  = existe.rows.length ? `${sl}-${Date.now()}` : sl;

        await pool.query(
            `INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [titulo.substring(0,255), slFin, categoria, contenido.substring(0,10000), desc.substring(0,160),
             (pals||categoria).substring(0,255), redactor(categoria), urlFinal,
             altFinal.substring(0,255), `Fotografía periodística: ${titulo}`,
             imgResult.nombre||'efd.jpg', 'el-farol', urlOrig, 'publicada']
        );

        console.log(`\n✅ /noticia/${slFin}`);
        invalidarCache();
        if (qi) registrarQueryPexels(qi, categoria, true);

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

        return { success: true, slug: slFin, titulo, alt: altFinal, mensaje: '✅ Publicada en web + redes' };

    } catch (error) {
        console.error('❌', error.message);
        await registrarError('generacion', error.message, categoria);
        return { success: false, error: error.message };
    }
}

// ══════════════════════════════════════════════════════════
// FUENTES RSS
// ══════════════════════════════════════════════════════════
const FUENTES_RSS = [
    { url: 'https://presidencia.gob.do/feed',           categoria: 'Nacionales',      nombre: 'Presidencia RD' },
    { url: 'https://policia.gob.do/feed',               categoria: 'Nacionales',      nombre: 'Policía Nacional' },
    { url: 'https://www.mopc.gob.do/feed',              categoria: 'Nacionales',      nombre: 'MOPC' },
    { url: 'https://www.salud.gob.do/feed',             categoria: 'Nacionales',      nombre: 'Salud Pública' },
    { url: 'https://www.educacion.gob.do/feed',         categoria: 'Nacionales',      nombre: 'Educación' },
    { url: 'https://www.bancentral.gov.do/feed',        categoria: 'Economía',        nombre: 'Banco Central' },
    { url: 'https://mepyd.gob.do/feed',                 categoria: 'Economía',        nombre: 'MEPyD' },
    { url: 'https://www.invivienda.gob.do/feed',        categoria: 'Nacionales',      nombre: 'Invivienda' },
    { url: 'https://mitur.gob.do/feed',                 categoria: 'Nacionales',      nombre: 'Turismo' },
    { url: 'https://pgr.gob.do/feed',                   categoria: 'Nacionales',      nombre: 'Procuraduría' },
    { url: 'https://www.diariolibre.com/feed',          categoria: 'Nacionales',      nombre: 'Diario Libre' },
    { url: 'https://listindiario.com/feed',             categoria: 'Nacionales',      nombre: 'Listín Diario' },
    { url: 'https://elnacional.com.do/feed/',           categoria: 'Nacionales',      nombre: 'El Nacional' },
    { url: 'https://www.eldinero.com.do/feed/',         categoria: 'Economía',        nombre: 'El Dinero' },
    { url: 'https://www.elcaribe.com.do/feed/',         categoria: 'Nacionales',      nombre: 'El Caribe' },
    { url: 'https://acento.com.do/feed/',               categoria: 'Nacionales',      nombre: 'Acento' },
    { url: 'https://www.hoy.com.do/feed/',              categoria: 'Nacionales',      nombre: 'Hoy' },
    { url: 'https://www.noticiassin.com/feed/',         categoria: 'Nacionales',      nombre: 'Noticias SIN' },
    { url: 'https://www.cdt.com.do/feed/',              categoria: 'Deportes',        nombre: 'CDT Deportes' },
    { url: 'https://www.beisbolrd.com/feed/',           categoria: 'Deportes',        nombre: 'Béisbol RD' },
    { url: 'https://www.reuters.com/arc/outboundfeeds/rss/category/latam/?outputType=xml', categoria: 'Internacionales', nombre: 'Reuters LatAm' },
    { url: 'https://feeds.bbci.co.uk/mundo/rss.xml',   categoria: 'Internacionales', nombre: 'BBC Mundo' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', categoria: 'Internacionales', nombre: 'NYT World' },
    { url: 'https://www.elnuevoherald.com/ultimas-noticias/?widgetName=rssfeed&widgetContentId=725095&getXmlFeed=true', categoria: 'Internacionales', nombre: 'El Nuevo Herald' },
    { url: 'https://feeds.feedburner.com/TechCrunch',  categoria: 'Tecnología',      nombre: 'TechCrunch' },
    { url: 'https://www.wired.com/feed/rss',           categoria: 'Tecnología',      nombre: 'Wired' },
    { url: 'https://feeds.bloomberg.com/markets/news.rss', categoria: 'Economía',   nombre: 'Bloomberg Markets' },
    { url: 'https://www.primerahora.com/entretenimiento/feed/', categoria: 'Espectáculos', nombre: 'Primera Hora Ent.' },
    { url: 'https://www.telemundo.com/shows/rss',      categoria: 'Espectáculos',    nombre: 'Telemundo' },
    { url: 'https://www.univision.com/rss',            categoria: 'Espectáculos',    nombre: 'Univision' },
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
                const yaExiste = await pool.query('SELECT id FROM rss_procesados WHERE item_guid=$1', [guid.substring(0,500)]);
                if (yaExiste.rows.length) continue;
                const comunicado = [item.title?`TÍTULO: ${item.title}`:'', item.contentSnippet?`RESUMEN: ${item.contentSnippet}`:'', item.content?`CONTENIDO: ${item.content?.substring(0,2000)}`:'', `FUENTE OFICIAL: ${fuente.nombre}`].filter(Boolean).join('\n');
                const resultado = await generarNoticia(fuente.categoria, comunicado);
                if (resultado.success) {
                    await pool.query('INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING', [guid.substring(0,500), fuente.nombre]);
                    procesadas++;
                    await new Promise(r => setTimeout(r, 5000));
                }
                break;
            }
        } catch (err) { console.warn(`   ⚠️ ${fuente.nombre}: ${err.message}`); }
    }
    console.log(`\n📡 RSS: ${procesadas} noticias nuevas`);
}

// ══════════════════════════════════════════════════════════
// CRON
// ══════════════════════════════════════════════════════════
const CATS = ['Nacionales','Deportes','Internacionales','Economía','Tecnología','Espectáculos'];
const ARRANQUE_TIME = Date.now();

cron.schedule('*/5 * * * *', async () => {
    try { await fetch(`http://localhost:${PORT}/health`); } catch(e) {}
});

cron.schedule('*/30 * * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    if (Date.now() - ARRANQUE_TIME < 35 * 60 * 1000) return;
    const cat = CATS[Math.floor(Math.random() * CATS.length)];
    console.log(`⏰ Cron 30min → generando: ${cat}`);
    await generarNoticia(cat);
});

cron.schedule('0 7,13,20 * * *', async () => { await procesarRSS(); });

async function rafagaInicial() {
    if (!CONFIG_IA.enabled) { console.log('⚠️ IA desactivada — no se genera ráfaga inicial'); return; }
    console.log('\n🚀 RÁFAGA INICIAL — generando 4 noticias (cada 2 min)...\n');
    for (let i = 1; i <= 4; i++) {
        if (i > 1) await new Promise(r => setTimeout(r, 2 * 60 * 1000));
        try {
            const cat = CATS[Math.floor(Math.random() * CATS.length)];
            console.log(`📰 Ráfaga ${i}/4: ${cat}`);
            await generarNoticia(cat);
        } catch(e) { console.error(`Ráfaga ${i} error:`, e.message); }
    }
    console.log('\n✅ Ráfaga completa — descansando 30 min — luego ritmo normal (cada 30 min)\n');
}

// ══════════════════════════════════════════════════════════
// RUTAS
// ══════════════════════════════════════════════════════════
async function analizarRendimiento(dias = 7) {
    try {
        const noticias = await pool.query(`SELECT id, titulo, seccion, vistas, fecha FROM noticias WHERE estado='publicada' AND fecha > NOW() - INTERVAL '${parseInt(dias)} days' ORDER BY vistas DESC`);
        if (!noticias.rows.length) return { success: true, mensaje: 'No hay noticias', noticias: [] };
        const total    = noticias.rows.reduce((s,n) => s+(n.vistas||0), 0);
        const promedio = Math.round(total / noticias.rows.length);
        const categorias = {};
        ['Nacionales','Deportes','Internacionales','Economía','Tecnología','Espectáculos'].forEach(cat => {
            const rows  = noticias.rows.filter(n => n.seccion === cat);
            const vistas = rows.reduce((s,n) => s+(n.vistas||0), 0);
            const prom  = rows.length ? Math.round(vistas/rows.length) : 0;
            categorias[cat] = { total: rows.length, vistas_totales: vistas, vistas_promedio: prom, rendimiento: promedio ? Math.round((prom/promedio)*100) : 0, mejor: rows[0] ? { titulo: rows[0].titulo, vistas: rows[0].vistas } : null };
        });
        const imagenes = await pool.query(`SELECT valor, exitos, fallos, categoria, ROUND((exitos::float / GREATEST(exitos+fallos,1))*100) as tasa FROM memoria_ia WHERE tipo='pexels_query' AND (exitos+fallos) > 2 ORDER BY tasa DESC, exitos DESC LIMIT 10`);
        const errores  = await pool.query(`SELECT valor, fallos, categoria FROM memoria_ia WHERE tipo='error' AND ultima_vez > NOW() - INTERVAL '7 days' ORDER BY fallos DESC LIMIT 5`);
        return { success: true, periodo: `${dias} días`, total_noticias: noticias.rows.length, total_vistas: total, promedio_general: promedio, categorias, imagenes: imagenes.rows, errores: errores.rows };
    } catch(e) { return { success: false, error: e.message }; }
}

app.get('/api/coach', async (req, res) => {
    const { dias = 7, pin } = req.query;
    const analisis = await analizarRendimiento(parseInt(dias));
    if (!analisis.success) return res.status(500).json(analisis);
    if (pin !== '311') return res.json({ success: true, periodo: analisis.periodo, total_noticias: analisis.total_noticias, total_vistas: analisis.total_vistas, categorias: Object.entries(analisis.categorias).map(([n,d]) => ({ nombre: n, vistas_promedio: d.vistas_promedio, rendimiento: d.rendimiento })) });
    res.json(analisis);
});

app.get('/cambiar-pais/:pais', (req, res) => {
    const permitidos = ['es-do','es-us','es-es','en-us','fr','pt'];
    if (!permitidos.includes(req.params.pais)) return res.status(400).send('País no válido');
    res.cookie('pais_seleccionado', req.params.pais, { maxAge: 30*24*60*60*1000, httpOnly: true });
    res.redirect(req.get('referer') || '/');
});
app.get('/api/pais-actual', (req, res) => res.json({ pais: req.cookies?.pais_seleccionado || 'es-do' }));
app.get('/health', (req, res) => res.json({ status: 'OK', version: '34.1' }));

app.get('/api/telegram/status', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    const chatIdActual = TELEGRAM_CHAT_ID || await obtenerChatIdTelegram();
    res.json({ token_activo: !!TELEGRAM_TOKEN, chat_id: chatIdActual || 'No detectado', instruccion: chatIdActual ? '✅ Bot listo' : '⚠️ Escríbele al bot primero' });
});

app.post('/api/telegram/test', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    const ok = await publicarEnTelegram('🏮 El Farol al Día — Prueba de conexión','',`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`,'El bot está activo. ¡Listo para Último Minuto en Santo Domingo Este y toda RD!','Nacionales');
    res.json({ success: ok, mensaje: ok ? '✅ Mensaje enviado a Telegram' : '❌ Error' });
});

app.get('/',          (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/ingeniero', authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'client', 'ingeniero.html')));
app.get('/contacto',  (req, res) => res.sendFile(path.join(__dirname, 'client', 'contacto.html')));
app.get('/nosotros',  (req, res) => res.sendFile(path.join(__dirname, 'client', 'nosotros.html')));
app.get('/privacidad',(req, res) => res.sendFile(path.join(__dirname, 'client', 'privacidad.html')));
app.get('/terminos',  (req, res) => res.sendFile(path.join(__dirname, 'client', 'terminos.html')));
app.get('/cookies',   (req, res) => res.sendFile(path.join(__dirname, 'client', 'cookies.html')));

let _cacheNoticias = null;
let _cacheFecha    = 0;
const CACHE_TTL    = 60 * 1000;
function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

app.options('/api/noticias', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.sendStatus(200);
});

app.get('/api/noticias', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.setHeader('Cache-Control','public,max-age=60');
    res.setHeader('Content-Type','application/json');
    try {
        if (_cacheNoticias && (Date.now() - _cacheFecha) < CACHE_TTL) return res.json({ success: true, noticias: _cacheNoticias, cached: true });
        const r = await pool.query(`SELECT id,titulo,slug,seccion,imagen,imagen_alt,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30`, ['publicada']);
        _cacheNoticias = r.rows; _cacheFecha = Date.now();
        res.json({ success: true, noticias: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/actualizar-imagen/:id', authMiddleware, async (req, res) => {
    const { pin, imagen } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id || !imagen) return res.status(400).json({ success: false, error: 'Faltan datos' });
    try { await pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2', [imagen, id]); invalidarCache(); res.json({ success: true }); }
    catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/eliminar/:id', authMiddleware, async (req, res) => {
    const { pin } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });
    try { await pool.query('DELETE FROM noticias WHERE id=$1', [id]); invalidarCache(); res.json({ success: true }); }
    catch(e) { res.status(500).json({ success: false, error: e.message }); }
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
    try { await pool.query('DELETE FROM comentarios WHERE id=$1', [parseInt(req.params.id)]); res.json({ success: true }); }
    catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/comentarios', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    try {
        const r = await pool.query(`SELECT c.id, c.nombre, c.texto, c.fecha, n.titulo as noticia_titulo, n.slug as noticia_slug FROM comentarios c JOIN noticias n ON n.id = c.noticia_id ORDER BY c.fecha DESC LIMIT 50`);
        res.json({ success: true, comentarios: r.rows });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/comentarios/:noticia_id', async (req, res) => {
    try {
        const r = await pool.query(`SELECT id, nombre, texto, fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC`, [req.params.noticia_id]);
        res.json({ success: true, comentarios: r.rows });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/comentarios/:noticia_id', async (req, res) => {
    const { nombre, texto } = req.body;
    const noticia_id = parseInt(req.params.noticia_id);
    if (isNaN(noticia_id) || noticia_id <= 0) return res.status(400).json({ success: false, error: 'ID de noticia inválido' });
    if (!nombre?.trim() || !texto?.trim()) return res.status(400).json({ success: false, error: 'Nombre y comentario son requeridos' });
    if (nombre.trim().length > 80) return res.status(400).json({ success: false, error: 'Nombre demasiado largo' });
    if (texto.trim().length > 1000) return res.status(400).json({ success: false, error: 'Comentario muy largo (máx 1000 chars)' });
    if (texto.trim().length < 3) return res.status(400).json({ success: false, error: 'Comentario muy corto' });
    try {
        const r = await pool.query(`INSERT INTO comentarios(noticia_id, nombre, texto) VALUES($1, $2, $3) RETURNING id, nombre, texto, fecha`, [noticia_id, nombre.trim().substring(0,80), texto.trim().substring(0,1000)]);
        res.json({ success: true, comentario: r.rows[0] });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/memoria', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN requerido' });
    try {
        const queries = await pool.query(`SELECT tipo, valor, categoria, exitos, fallos, ROUND((exitos::float / GREATEST(exitos+fallos,1))*100) as pct_exito, ultima_vez FROM memoria_ia ORDER BY ultima_vez DESC LIMIT 50`);
        res.json({ success: true, registros: queries.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
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
            const urlN  = `${BASE_URL}/noticia/${n.slug}`;
            const cHTML = n.contenido.split('\n').filter(p=>p.trim()).map(p=>`<p>${p.trim()}</p>`).join('');
            html = html
                .replace('<!-- META_TAGS -->', metaTagsCompletos(n, urlN))
                .replace(/{{TITULO}}/g,    esc(n.titulo))
                .replace(/{{CONTENIDO}}/g, cHTML)
                .replace(/{{FECHA}}/g,     new Date(n.fecha).toLocaleDateString('es-DO', { year:'numeric', month:'long', day:'numeric' }))
                .replace(/{{IMAGEN}}/g,    n.imagen)
                .replace(/{{ALT}}/g,       esc(n.imagen_alt || n.titulo))
                .replace(/{{VISTAS}}/g,    n.vistas)
                .replace(/{{REDACTOR}}/g,  esc(n.redactor))
                .replace(/{{SECCION}}/g,   esc(n.seccion))
                .replace(/{{URL}}/g,       encodeURIComponent(urlN));
            res.setHeader('Content-Type','text/html;charset=utf-8');
            res.setHeader('Cache-Control','public,max-age=300');
            res.send(html);
        } catch (e) { res.json({ success: true, noticia: n }); }
    } catch (e) { res.status(500).send('Error'); }
});

app.get('/sitemap.xml', async (req, res) => {
    try {
        const r = await pool.query('SELECT slug,fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC', ['publicada']);
        const now = Date.now();
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;
        r.rows.forEach(n => {
            const d = (now - new Date(n.fecha).getTime()) / 86400000;
            xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>${d<1?'hourly':d<7?'daily':'weekly'}</changefreq><priority>${d<1?'1.0':d<7?'0.9':d<30?'0.7':'0.5'}</priority></url>\n`;
        });
        xml += '</urlset>';
        res.header('Content-Type','application/xml');
        res.header('Cache-Control','public,max-age=3600');
        res.send(xml);
    } catch (e) { res.status(500).send('Error'); }
});

app.get('/robots.txt', (req, res) => {
    res.header('Content-Type','text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nDisallow: /redaccion\n\nUser-agent: Googlebot\nAllow: /\nCrawl-delay: 1\n\nSitemap: ${BASE_URL}/sitemap.xml`);
});

app.get('/ads.txt', (req, res) => {
    res.header('Content-Type','text/plain');
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) as c, SUM(vistas) as v FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ success: true, totalNoticias: parseInt(r.rows[0].c), totalVistas: parseInt(r.rows[0].v) || 0 });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/configuracion', (req, res) => {
    try {
        const c = fs.existsSync(path.join(__dirname, 'config.json'))
            ? JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
            : { googleAnalytics: '' };
        res.json({ success: true, config: c });
    } catch (e) { res.json({ success: true, config: { googleAnalytics: '' } }); }
});

app.post('/api/configuracion', express.json(), (req, res) => {
    const { pin, googleAnalytics } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    try { fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify({ googleAnalytics }, null, 2)); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/publicar', express.json(), async (req, res) => {
    const { pin, titulo, seccion, contenido, redactor: red } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN' });
    if (!titulo || !seccion || !contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });
    try {
        const sl  = slugify(titulo);
        const e   = await pool.query('SELECT id FROM noticias WHERE slug=$1', [sl]);
        const slF = e.rows.length ? `${sl}-${Date.now()}` : sl;
        await pool.query(`INSERT INTO noticias(titulo,slug,seccion,contenido,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,estado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [titulo, slF, seccion, contenido, red||'Manual', `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`, `${titulo} - noticias República Dominicana El Farol al Día`, `Fotografía: ${titulo}`, 'efd.jpg', 'el-farol', 'publicada']);
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
    if (enabled !== undefined) CONFIG_IA.enabled = enabled;
    if (instruccion_principal) CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono)      CONFIG_IA.tono = tono;
    if (extension) CONFIG_IA.extension = extension;
    if (evitar)    CONFIG_IA.evitar = evitar;
    if (enfasis)   CONFIG_IA.enfasis = enfasis;
    const ok = await guardarConfigIA(CONFIG_IA);
    res.json({ success: ok });
});

app.get('/status', async (req, res) => {
    try {
        const r      = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        const rss    = await pool.query('SELECT COUNT(*) FROM rss_procesados');
        const ultima = await pool.query(`SELECT fecha, titulo FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 1`);
        const minSinPublicar = ultima.rows.length ? Math.round((Date.now() - new Date(ultima.rows[0].fecha)) / 60000) : 9999;
        const errGemini = await pool.query(`SELECT COUNT(*) FROM memoria_ia WHERE tipo='error' AND ultima_vez > NOW() - INTERVAL '1 hour'`);
        const imgOk     = await pool.query(`SELECT COUNT(*) FROM memoria_ia WHERE tipo='pexels_query' AND exitos > 0 AND ultima_vez > NOW() - INTERVAL '24 hours'`);
        const geminiKeys = [process.env.GEMINI_API_KEY, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3, process.env.GEMINI_KEY_4].filter(Boolean).length;
        res.json({
            status: 'OK', version: '34.1',
            noticias: parseInt(r.rows[0].count),
            rss_procesados: parseInt(rss.rows[0].count),
            min_sin_publicar: minSinPublicar,
            ultima_noticia: ultima.rows[0]?.titulo?.substring(0,60) || '—',
            gemini_keys: geminiKeys,
            gemini_llaves_texto: 'KEY1 (GEMINI_API_KEY) + KEY2 (GEMINI_KEY_2)',
            gemini_llaves_imagen: 'KEY3 (GEMINI_KEY_3) + KEY4 (GEMINI_KEY_4)',
            errores_gemini: parseInt(errGemini.rows[0].count),
            imagenes_ok_hoy: parseInt(imgOk.rows[0].count),
            facebook:    FB_PAGE_ID && FB_PAGE_TOKEN    ? '✅ Activo' : '⚠️ Sin credenciales',
            twitter:     TWITTER_API_KEY && TWITTER_ACCESS_TOKEN ? '✅ Activo' : '⚠️ Sin credenciales',
            telegram:    TELEGRAM_TOKEN ? '✅ Activo' : '⚠️ Sin token',
            pexels_api:  PEXELS_API_KEY ? '✅ Activa' : '⚠️ Sin key',
            wikipedia:   '✅ Activa',
            marca_de_agua: WATERMARK_PATH && fs.existsSync(WATERMARK_PATH) ? '✅ Activa' : '⚠️ Sin watermark — fotos publicándose sin marca',
            ia_activa:   CONFIG_IA.enabled,
            adsense:     'pub-5280872495839888 ✅',
            cron_30min:  '✅ Activo',
            rss_3x_dia:  '✅ 7am · 1pm · 8pm',
            sistema:     'PostgreSQL + Gemini 2+2 + Pexels + Wikipedia + Watermark blindado + AdSense + RSS 30 fuentes'
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// ══════════════════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════════════════
async function iniciar() {
    await inicializarBase();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V34.1                                     ║
╠══════════════════════════════════════════════════════════════════╣
║  ✅ Gemini 2+2: KEY1/KEY2=texto | KEY3/KEY4=imagen              ║
║  ✅ Watermark blindado: falla silenciosamente sin matar proceso  ║
║  🌐 Web · 📘 Facebook · 🐦 Twitter · 📱 Telegram · 📚 Wiki     ║
║                                                                  ║
║  Facebook:    ${FB_PAGE_ID && FB_PAGE_TOKEN            ? '✅ ACTIVO              ' : '⚠️  Sin credenciales    '}║
║  Twitter:     ${TWITTER_API_KEY && TWITTER_ACCESS_TOKEN? '✅ ACTIVO              ' : '⚠️  Sin credenciales    '}║
║  Watermark:   ${WATERMARK_PATH && fs.existsSync(WATERMARK_PATH) ? '✅ ACTIVA              ' : '⚠️  Sin archivo (OK)    '}║
║  Gemini KEY3: ${process.env.GEMINI_KEY_3               ? '✅ Configurada         ' : '⚠️  No configurada      '}║
║  Gemini KEY4: ${process.env.GEMINI_KEY_4               ? '✅ Configurada         ' : '⚠️  No configurada      '}║
╚══════════════════════════════════════════════════════════════════╝`);
    });
    setTimeout(regenerarWatermarksLostidos, 5000);
    setTimeout(bienvenidaTelegram, 8000);
    setTimeout(rafagaInicial, 15000);
}

iniciar();
module.exports = app;
