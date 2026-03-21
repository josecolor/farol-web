/**
 * 🏮 EL FAROL AL DÍA — V34.31
 * Base: V34.31
 * Cambios:
 *   1. Watermark: WATERMARK(1).png prioritario exacto
 *   2. Gemini: gemini-2.5-flash, v1beta, AbortController 60s
 *   3. Railway: regenerarWatermarks + RSS secuenciales, anti-overlap
 *   4. Panel: /api/coach, /api/memoria, /api/estadisticas alineadas
 *   5. FIX 429: pausa 2s entre imágenes, batch 20
 *   6. IMÁGENES V2: Pixabay como banco 2, filtro realismo -illustration -render -3d
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
// Google Custom Search — opcional, mejora calidad de fotos
if (!process.env.GOOGLE_CSE_KEY) console.warn('[IMG] GOOGLE_CSE_KEY no configurada — usando Wikimedia para fotos HD');

// ─── GEMINI MULTI-KEY — hasta 5 cuentas rotan automáticamente ────────────────
// Agregar en Railway: GEMINI_API_KEY, GEMINI_API_KEY2, GEMINI_API_KEY3...
// Cada cuenta Google gratuita da ~15 req/min — 5 cuentas = 75 req/min
// Si una da 429 → pasa a la siguiente automáticamente
const GEMINI_KEYS = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY2 || null,
    process.env.GEMINI_API_KEY3 || null,
    process.env.GEMINI_API_KEY4 || null,
    process.env.GEMINI_API_KEY5 || null,
].filter(Boolean);
// ─── ROTACIÓN DE KEYS POR TURNO ──────────────────────────────────────────────
// Cada noticia usa la siguiente key en orden — turno estricto
// Key 1 → descansa → Key 2 → descansa → Key 3 → descansa → Key 1...
// Descando de 60s por key después de cada publicación
let   GEMINI_KEY_INDEX  = 0;
const GEMINI_KEY_RESET  = {}; // { keyIndex: tiempoLibre }
const GEMINI_DESCANSO   = 60000; // 60s de descanso entre usos de la misma key

console.log(`[Gemini] ${GEMINI_KEYS.length} key(s) en rotación por turno`);
GEMINI_KEYS.forEach((k, i) => console.log(`   Key ${i+1}: ...${k.slice(-6)}`));

function getGeminiKey() {
    const ahora = Date.now();

    // Buscar la siguiente key en turno que esté descansada
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        const idx  = (GEMINI_KEY_INDEX + i) % GEMINI_KEYS.length;
        const libre = GEMINI_KEY_RESET[idx] || 0;
        if (ahora >= libre) {
            GEMINI_KEY_INDEX = (idx + 1) % GEMINI_KEYS.length; // apuntar a la siguiente para la próxima
            return { key: GEMINI_KEYS[idx], idx };
        }
    }

    // Todas descansando — esperar la que termine antes
    let menorEspera = Infinity, menorIdx = 0;
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        const espera = (GEMINI_KEY_RESET[i] || 0) - ahora;
        if (espera < menorEspera) { menorEspera = espera; menorIdx = i; }
    }
    console.log(`   [Gemini] Todas en descanso — esperando ${Math.round(menorEspera/1000)}s (Key ${menorIdx+1})`);
    return { key: GEMINI_KEYS[menorIdx], idx: menorIdx, espera: menorEspera };
}

function marcarKeyDescansando(idx) {
    GEMINI_KEY_RESET[idx] = Date.now() + GEMINI_DESCANSO;
    console.log(`   [Gemini] Key ${idx+1} descansando 60s`);
}

// Pexels y Pixabay eliminados — fotos vienen directo del periódico original
// Facebook y Twitter eliminados — generan errores y no aportan tráfico SEO
// El tráfico real viene de Google News y búsquedas orgánicas
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
        return { url: urlImagen, procesada: false };
    }
    // Reintentar hasta 3 veces — algunos servidores bloquean el primer intento
    let response, lastErr;
    for (let intento = 0; intento < 3; intento++) {
        try {
            // Intentar conseguir la versión de mayor resolución disponible
        // Diario Libre y Listín a veces tienen sufijo de tamaño en la URL
        let urlDescarga = urlImagen;
        if (urlImagen.includes('diariolibre.com') || urlImagen.includes('listindiario.com')) {
            // Reemplazar sufijos de thumbnail por versión grande
            urlDescarga = urlImagen
                .replace(/-\d+x\d+(\.\w+)$/, '$1')          // elimina -300x200.jpg
                .replace(/[?&](w|width|size)=\d+/g, '')      // elimina ?w=300
                .replace(/[?&](h|height)=\d+/g, '')          // elimina &h=200
                .replace('thumbnail', 'full')                  // thumbnail → full
                .replace('-thumb', '')                         // -thumb eliminado
                .replace('-small', '')                         // -small eliminado
                .replace('-medium', '-large');                 // medium → large
            if (urlDescarga !== urlImagen) {
                console.log(`   [IMG-URL] Versión grande: ${urlDescarga.substring(0,70)}`);
            }
        }

        const ctrl = new AbortController();
            const tm   = setTimeout(() => ctrl.abort(), 15000);
            response   = await fetch(urlDescarga, {
                headers: { ...BROWSER_HEADERS, 'Cache-Control': 'no-cache' },
                signal: ctrl.signal,
            }).finally(() => clearTimeout(tm));
            // Si falla la versión grande, intentar con la URL original
            if (!response.ok && urlDescarga !== urlImagen) {
                response = await fetch(urlImagen, {
                    headers: BROWSER_HEADERS,
                }).catch(() => null);
            }
            if (response.ok) break;
            lastErr = 'HTTP ' + response.status;
        } catch (e) {
            lastErr = e.message;
            await new Promise(r => setTimeout(r, 1500 * (intento + 1)));
        }
    }
    try {
        if (!response?.ok) throw new Error(lastErr || 'Sin respuesta');
        const bufOrig = Buffer.from(await response.arrayBuffer());

        // Adaptar procesamiento SEGÚN el tamaño real de la foto
        const metaOrig  = await sharp(bufOrig).metadata();
        const anchoOrig = metaOrig.width  || 0;
        const altoOrig  = metaOrig.height || 0;
        console.log(`   [IMG-SIZE] Original: ${anchoOrig}x${altoOrig}px`);

        let bufEscalado;

        if (anchoOrig >= 900) {
            // ✅ Foto GRANDE — solo optimizar, no tocar el tamaño
            // Recortar a proporción 16:9 sin agrandar
            bufEscalado = await sharp(bufOrig)
                .resize(1200, 630, {
                    fit:                'cover',
                    position:           'attention',
                    withoutEnlargement: true,   // NO agrandar si ya es grande
                    kernel:             'lanczos2',
                })
                .modulate({ saturation: 1.08 })
                .sharpen({ sigma: 0.6 })
                .toBuffer();
            console.log(`   [IMG-PROC] Foto grande → optimizada sin agrandar`);

        } else if (anchoOrig >= 500) {
            // ⚠️ Foto MEDIANA — escalar con cuidado hasta máx 900px
            bufEscalado = await sharp(bufOrig)
                .resize(900, null, {
                    fit:                'inside',
                    withoutEnlargement: true,
                    kernel:             'lanczos3',
                })
                .modulate({ saturation: 1.1 })
                .sharpen({ sigma: 0.8 })
                .toBuffer();
            console.log(`   [IMG-PROC] Foto mediana → escalada a 900px máx`);

        } else {
            // ❌ Foto MUY PEQUEÑA — usar tal cual, solo optimizar
            // NO agrandar — pixelaría. Solo mejorar lo que hay.
            bufEscalado = await sharp(bufOrig)
                .modulate({ saturation: 1.1, brightness: 1.02 })
                .sharpen({ sigma: 0.5 })
                .toBuffer();
            console.log(`   [IMG-PROC] Foto pequeña (${anchoOrig}px) → sin redimensionar`);
        }

        const meta = await sharp(bufEscalado).metadata();
        const w    = meta.width  || 800;
        const h    = meta.height || 500;

        // ── WATERMARK RESPONSIVO ──────────────────────────────────────────────
        // Se adapta al tamaño real de la foto — nunca muy grande ni muy pequeño
        let wmPct;
        if      (w >= 1000) wmPct = 0.20; // foto grande  → marca 20% del ancho
        else if (w >= 600)  wmPct = 0.25; // foto mediana → marca 25% del ancho
        else                wmPct = 0.30; // foto pequeña → marca 30% del ancho

        const wmAncho = Math.round(w * wmPct);
        const wmRes   = await sharp(WATERMARK_PATH)
            .resize(wmAncho, null, { fit: 'inside' })
            .toBuffer();
        const wmMeta  = await sharp(wmRes).metadata();
        const wmAlto  = wmMeta.height || 40;

        // Margen proporcional al tamaño
        const margen = Math.max(8, Math.round(w * 0.02));

        // Posición — esquina inferior derecha siempre
        const posLeft = Math.max(0, w - wmAncho - margen);
        const posTop  = Math.max(0, h - wmAlto  - margen);

        console.log(`   [WM-SIZE] Foto ${w}x${h}px → marca ${wmAncho}px (${Math.round(wmPct*100)}%)`);

        const bufFin = await sharp(bufEscalado)
            .composite([{
                input: wmRes,
                left:  posLeft,
                top:   posTop,
                blend: 'over',
            }])
            .jpeg({ quality: 92, progressive: true, mozjpeg: true })
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
        res.setHeader('Content-Type',   'image/jpeg');
        res.setHeader('Cache-Control',  'public,max-age=604800,immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
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
            // Obtener la key disponible (rota automáticamente si hay 429)
            const { key, idx, espera: esperaCooldown } = getGeminiKey();
            if (esperaCooldown > 0) {
                console.log(`   [Gemini] Key ${idx+1} en cooldown, esperando ${Math.round(esperaCooldown/1000)}s`);
                await new Promise(r => setTimeout(r, Math.min(esperaCooldown, 20000)));
            }
            console.log(`   [Gemini] intento ${i + 1}/${reintentos} (key ${idx+1}/${GEMINI_KEYS.length})`);

            // Pausa mínima entre requests de la misma key
            const lag = Date.now() - GS.lastRequest;
            if (lag < 15000) await new Promise(r => setTimeout(r, 15000 - lag));
            GS.lastRequest = Date.now();

            const ctrl = new AbortController();
            tm = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT);

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
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
                const espera = Math.pow(2, i) * 20000; // 20s, 40s, 80s
                // Marcar esta key como limitada y cambiar a la otra
                const { idx: idxActual } = getGeminiKey();
                GEMINI_KEY_RESET[idxActual] = Date.now() + espera;
                GEMINI_KEY_INDEX = (idxActual + 1) % GEMINI_KEYS.length;
                console.warn(`   [Gemini] 429 key ${idxActual+1} → cooldown ${Math.round(espera/1000)}s, cambiando a key ${GEMINI_KEY_INDEX+1}`);
                await new Promise(r => setTimeout(r, 3000)); // pausa corta antes de intentar con otra key
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

            console.log(`   [Gemini] OK (${texto.length} chars) — Key ${idx+1} publicó`);
            marcarKeyDescansando(idx); // key descansa 60s antes del próximo turno
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

// ─── IMAGEN: SOLO DEL PERIÓDICO ORIGINAL → BANCO LOCAL ──────────────────────
// Sin Pexels, sin Pixabay, sin muñecos, sin stock genérico.
// Flujo: foto del RSS/scraping → si no tiene → banco local curado.

// ─── BANCO LOCAL — Fotos de prensa real verificadas ─────────────────────────────
// Fotos reales de personas, edificios, eventos — sin muñecos ni ilustraciones
const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=900&fit=crop&q=75';
const BANCO_LOCAL = {
    'politica-gobierno': [
        // Edificios gubernamentales, discursos, ceremonias reales
        `${PB}/1550337/pexels-photo-1550337.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // bandera RD
        `${PB}/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // reunión ejecutiva
        `${PB}/3183197/pexels-photo-3183197.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // conferencia prensa
        `${PB}/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // sala gobierno
        `${PB}/2182970/pexels-photo-2182970.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // edificio oficial
        `${PB}/1464217/pexels-photo-1464217.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // palacio gobierno
        `${PB}/3183150/pexels-photo-3183150.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // reunión sala
        `${PB}/3184339/pexels-photo-3184339.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // discurso podio
        `${PB}/8849295/pexels-photo-8849295.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // conferencia
        `${PB}/4427611/pexels-photo-4427611.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // firma documento
    ],
    'seguridad-policia': [
        `${PB}/6049159/pexels-photo-6049159.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // patrulla policial
        `${PB}/5699456/pexels-photo-5699456.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // oficiales uniforme
        `${PB}/6289059/pexels-photo-6289059.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // operativo policial
        `${PB}/7512968/pexels-photo-7512968.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // patrulla calle
        `${PB}/4252382/pexels-photo-4252382.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // seguridad urbana
        `${PB}/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // bomberos
        `${PB}/6980997/pexels-photo-6980997.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // emergencia
        `${PB}/5726825/pexels-photo-5726825.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // rescate
    ],
    'relaciones-internacionales': [
        `${PB}/2860705/pexels-photo-2860705.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // diplomacia
        `${PB}/3997992/pexels-photo-3997992.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // reunión internacional
        `${PB}/3183197/pexels-photo-3183197.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // conferencia
        `${PB}/1550337/pexels-photo-1550337.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // bandera
        `${PB}/3407777/pexels-photo-3407777.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // diplomáticos
        `${PB}/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // cumbre
        `${PB}/7948035/pexels-photo-7948035.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // sede ONU
        `${PB}/3184292/pexels-photo-3184292.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // negociación
    ],
    'economia-mercado': [
        `${PB}/4386466/pexels-photo-4386466.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // trading pantallas reales
        `${PB}/6801648/pexels-photo-6801648.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // banco edificio
        `${PB}/210607/pexels-photo-210607.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // bolsa valores
        `${PB}/3943723/pexels-photo-3943723.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // analista económico
        `${PB}/7567443/pexels-photo-7567443.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // mercado financiero
        `${PB}/6120214/pexels-photo-6120214.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // economía
        `${PB}/5849559/pexels-photo-5849559.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // moneda
        `${PB}/3760067/pexels-photo-3760067.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // puerto comercial
        `${PB}/1797428/pexels-photo-1797428.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // construcción comercial
        `${PB}/4386442/pexels-photo-4386442.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // dinero real
    ],
    'infraestructura': [
        `${PB}/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // construcción real
        `${PB}/323780/pexels-photo-323780.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // carretera
        `${PB}/2219024/pexels-photo-2219024.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // obra vial
        `${PB}/1463917/pexels-photo-1463917.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // puente
        `${PB}/2760241/pexels-photo-2760241.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // puerto
        `${PB}/1134166/pexels-photo-1134166.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // aeropuerto
        `${PB}/247763/pexels-photo-247763.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // obras
        `${PB}/159306/pexels-photo-159306.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // autopista
    ],
    'salud-medicina': [
        `${PB}/3786157/pexels-photo-3786157.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // médico real
        `${PB}/4386467/pexels-photo-4386467.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // hospital
        `${PB}/1170979/pexels-photo-1170979.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // cirugía
        `${PB}/5327580/pexels-photo-5327580.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // vacunación
        `${PB}/3993212/pexels-photo-3993212.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // enfermera
        `${PB}/4021775/pexels-photo-4021775.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // laboratorio
        `${PB}/5214958/pexels-photo-5214958.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // emergencia médica
        `${PB}/4226219/pexels-photo-4226219.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // clínica
    ],
    'deporte-beisbol': [
        `${PB}/1661950/pexels-photo-1661950.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // estadio béisbol real
        `${PB}/209977/pexels-photo-209977.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // pelota guante
        `${PB}/248318/pexels-photo-248318.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // bateador
        `${PB}/1884574/pexels-photo-1884574.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // pitcher
        `${PB}/163452/pexels-photo-163452.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // estadio lleno
        `${PB}/1618200/pexels-photo-1618200.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // béisbol acción
        `${PB}/186077/pexels-photo-186077.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // home run
        `${PB}/1752757/pexels-photo-1752757.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // campo béisbol
    ],
    'deporte-futbol': [
        `${PB}/46798/pexels-photo-46798.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,       // partido fútbol real
        `${PB}/3621943/pexels-photo-3621943.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // estadio fútbol
        `${PB}/274422/pexels-photo-274422.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // jugador acción
        `${PB}/1171084/pexels-photo-1171084.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // gol celebración
        `${PB}/3873098/pexels-photo-3873098.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // balón cancha
        `${PB}/114296/pexels-photo-114296.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // portero
        `${PB}/2277981/pexels-photo-2277981.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // dribbling
        `${PB}/1884574/pexels-photo-1884574.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // multitud
    ],
    'deporte-general': [
        `${PB}/863988/pexels-photo-863988.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // atletismo pista
        `${PB}/936094/pexels-photo-936094.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // boxeo real
        `${PB}/2526878/pexels-photo-2526878.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // natación
        `${PB}/3764014/pexels-photo-3764014.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // deportes
        `${PB}/1552252/pexels-photo-1552252.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // pista atletismo
        `${PB}/2294353/pexels-photo-2294353.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // tenis
        `${PB}/4761671/pexels-photo-4761671.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // baloncesto
        `${PB}/3621517/pexels-photo-3621517.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // competencia
    ],
    'tecnologia': [
        `${PB}/3861958/pexels-photo-3861958.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // data center real
        `${PB}/2582937/pexels-photo-2582937.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // programador real
        `${PB}/5632399/pexels-photo-5632399.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // servidores
        `${PB}/3932499/pexels-photo-3932499.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // tecnología
        `${PB}/574071/pexels-photo-574071.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // pantallas
        `${PB}/3861969/pexels-photo-3861969.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // ciberseguridad
        `${PB}/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // desarrollo
        `${PB}/7988086/pexels-photo-7988086.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // red fibra óptica
    ],
    'educacion': [
        `${PB}/256490/pexels-photo-256490.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // aula real
        `${PB}/1205651/pexels-photo-1205651.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // graduación
        `${PB}/4143791/pexels-photo-4143791.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // universidad
        `${PB}/5905559/pexels-photo-5905559.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // estudiantes
        `${PB}/3769021/pexels-photo-3769021.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // clase
        `${PB}/4491461/pexels-photo-4491461.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // biblioteca
        `${PB}/289737/pexels-photo-289737.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // escuela
        `${PB}/8617816/pexels-photo-8617816.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // educación
    ],
    'cultura-musica': [
        `${PB}/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // concierto real
        `${PB}/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // músico escenario
        `${PB}/3651308/pexels-photo-3651308.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // festival
        `${PB}/2521317/pexels-photo-2521317.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // show artístico
        `${PB}/1047442/pexels-photo-1047442.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // música vivo
        `${PB}/995301/pexels-photo-995301.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // escenario
        `${PB}/2191013/pexels-photo-2191013.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // cultura
        `${PB}/1769280/pexels-photo-1769280.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // teatro
    ],
    'medio-ambiente': [
        `${PB}/1108572/pexels-photo-1108572.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // energía solar
        `${PB}/2559941/pexels-photo-2559941.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // reciclaje
        `${PB}/414612/pexels-photo-414612.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // contaminación
        `${PB}/1666012/pexels-photo-1666012.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // reforestación
        `${PB}/1366919/pexels-photo-1366919.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // bosque
        `${PB}/572897/pexels-photo-572897.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // cambio climático
        `${PB}/1021142/pexels-photo-1021142.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // mar limpio
        `${PB}/3225517/pexels-photo-3225517.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // ambiente
    ],
    'turismo': [
        `${PB}/1450353/pexels-photo-1450353.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // playa Punta Cana
        `${PB}/1174732/pexels-photo-1174732.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // resort caribeño
        `${PB}/3601425/pexels-photo-3601425.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // hotel lujo
        `${PB}/2104152/pexels-photo-2104152.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // turismo
        `${PB}/994605/pexels-photo-994605.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // playa tropical
        `${PB}/1268855/pexels-photo-1268855.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // caribe
        `${PB}/3155666/pexels-photo-3155666.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // destino
        `${PB}/1450360/pexels-photo-1450360.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // arena blanca
    ],
    'emergencia': [
        `${PB}/1437862/pexels-photo-1437862.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // bomberos acción
        `${PB}/263402/pexels-photo-263402.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // rescate
        `${PB}/6129049/pexels-photo-6129049.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // ambulancia
        `${PB}/7541956/pexels-photo-7541956.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // emergencia
        `${PB}/3259629/pexels-photo-3259629.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // desastre
        `${PB}/6129113/pexels-photo-6129113.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // primera respuesta
        `${PB}/4386396/pexels-photo-4386396.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // crisis
        `${PB}/5726825/pexels-photo-5726825.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // socorro
    ],
    'vivienda-social': [
        `${PB}/323780/pexels-photo-323780.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // construcción
        `${PB}/1396122/pexels-photo-1396122.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // apartamentos
        `${PB}/2102587/pexels-photo-2102587.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // vivienda
        `${PB}/1370704/pexels-photo-1370704.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // residencial
        `${PB}/259588/pexels-photo-259588.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // casas
        `${PB}/1029599/pexels-photo-1029599.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // urbanización
        `${PB}/280229/pexels-photo-280229.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // edificio
        `${PB}/534151/pexels-photo-534151.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // obra
    ],
    'transporte-vial': [
        `${PB}/93398/pexels-photo-93398.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,       // autopista
        `${PB}/1494277/pexels-photo-1494277.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // metro
        `${PB}/210182/pexels-photo-210182.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // tránsito urbano
        `${PB}/2199293/pexels-photo-2199293.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // carretera
        `${PB}/3806978/pexels-photo-3806978.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // camión carga
        `${PB}/163786/pexels-photo-163786.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,     // vial
        `${PB}/3802510/pexels-photo-3802510.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // terminal
        `${PB}/1004409/pexels-photo-1004409.jpeg?auto=compress&cs=tinysrgb&w=1200&fit=crop`,   // transporte
    ],
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

// ─── GOOGLE IMÁGENES — busca la foto exacta en alta resolución ───────────────
// Si la foto del RSS viene pequeña, busca en Google la misma imagen en HD
// Usa el título de la noticia como query de búsqueda
// GOOGLE_CSE_KEY  = API Key de Google Custom Search
// GOOGLE_CSE_ID   = ID del motor de búsqueda personalizado
// Gratis: 100 búsquedas/día — suficiente para noticias de alta calidad
// Obtener en: console.developers.google.com → Custom Search API
async function buscarEnGoogle(titulo, categoria) {
    const GOOGLE_CSE_KEY = process.env.GOOGLE_CSE_KEY || null;
    const GOOGLE_CSE_ID  = process.env.GOOGLE_CSE_ID  || null;

    // ── Método 1: Google Custom Search API (100/día gratis) ──────────────────
    if (GOOGLE_CSE_KEY && GOOGLE_CSE_ID) {
        try {
            // Query periodístico específico — busca foto de prensa real
            const q    = `${titulo} press photo news`;
            const url  = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_CSE_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(q)}&searchType=image&imgSize=large&imgType=photo&safe=active&num=5&fileType=jpg`;
            const ctrl = new AbortController();
            const tm   = setTimeout(() => ctrl.abort(), 8000);
            const res  = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tm));

            if (res.ok) {
                const data = await res.json();
                const items = data.items || [];
                // Filtrar ilustraciones y logos
                const bloq = ['logo','icon','cartoon','illustration','vector','clipart','render','3d'];
                for (const item of items) {
                    const src = item.link || '';
                    const title = (item.title || '').toLowerCase();
                    if (bloq.some(b => title.includes(b) || src.includes(b))) continue;
                    if (!src.match(/\.(jpg|jpeg|png|webp)/i)) continue;
                    console.log(`   [Google-CSE ✓] ${src.substring(0, 70)}`);
                    return src;
                }
            }
        } catch (_) {}
    }

    // Sin Google CSE → banco local es más confiable que Wikimedia
    // Wikimedia trae fotos irrelevantes (retratos, paisajes, etc.)
    return null;
}

// ─── IMAGEN INTELIGENTE — RSS → Google HD → Banco local ──────────────────────
async function obtenerImagenInteligente(titulo, categoria, subtema, queryIA) {
    // Solo Google CSE si está configurado — sin Wikimedia que trae fotos irrelevantes
    if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID && titulo?.length > 10) {
        const urlGoogle = await buscarEnGoogle(titulo, categoria);
        if (urlGoogle) return urlGoogle;
    }
    // Banco local curado — fotos reales por categoría
    console.log(`   [Imagen] Banco local → "${subtema || categoria}"`);
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
const CACHE_TTL = 300000; // 5 minutos
function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

// ─── MEMORIA IA ───────────────────────────────────────────────────────────────

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
            SET imagen='${PB}/3052454/pexels-photo-3052454.jpeg${OPT}', imagen_fuente='banco-local'
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
- ALT_IMAGEN: 15-20 palabras en español, descriptivas, con RD y contexto.

RESPONDE EXACTAMENTE EN ESTE FORMATO — SIN asteriscos, SIN markdown, SIN texto extra:
TITULO: [55-65 chars]
DESCRIPCION: [150-158 chars]
PALABRAS: [6 keywords separadas por coma]
ALT_IMAGEN: [15-20 palabras español con contexto RD]
SUBTEMA_LOCAL: [uno de: politica-gobierno, seguridad-policia, relaciones-internacionales, economia-mercado, infraestructura, salud-medicina, deporte-beisbol, deporte-futbol, deporte-general, tecnologia, educacion, cultura-musica, medio-ambiente, turismo, emergencia, vivienda-social, transporte-vial]
CONTENIDO:
[450-520 palabras. 5 párrafos. Línea en blanco entre cada uno. Sin subtítulos. Sin bullets.]`;

        console.log(`\n[Gen] ${categoria}${comunicadoExterno ? ' (RSS)' : ' (auto)'}`);
        const texto       = await llamarGemini(prompt);
        const textoLimpio = texto.replace(/^\s*[*#]+\s*/gm, '');

        let titulo = '', desc = '', pals = '', ai = '', sub = '', enC = false;
        const bl = [];

        for (const l of textoLimpio.split('\n')) {
            const t = l.trim();
            if      (t.startsWith('TITULO:'))        titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:'))   desc   = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:'))      pals   = t.replace('PALABRAS:', '').trim();

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
                    // Verificar si la imagen RSS es suficientemente grande
                    const cl = parseInt(chk.headers.get('content-length') || '0');
                    if (cl > 0 && cl < 80000) {
                        // Imagen pequeña (< 80KB) → buscar versión HD
                        console.log(`   [IMG-RSS] Imagen pequeña (${cl} bytes) → buscando HD`);
                        const urlHD = await buscarEnGoogle(titulo, categoria);
                        urlOrig = urlHD || imagenRSSOverride;
                        if (urlHD) console.log(`   [IMG-HD] Google encontró versión HD`);
                    } else {
                        console.log(`   [IMG-RSS] ✓ Imagen válida del RSS`);
                        urlOrig = imagenRSSOverride;
                    }
                } else {
                    console.log(`   [IMG-RSS] Imagen bloqueada (${chk.status}), buscando en Google`);
                    const urlHD = await buscarEnGoogle(titulo, categoria);
                    urlOrig = urlHD || await obtenerImagenInteligente(titulo, categoria, sub, null);
                }
            } catch (_) {
                console.log(`   [IMG-RSS] No accesible, usando búsqueda normal`);
                urlOrig = await obtenerImagenInteligente(titulo, categoria, sub, null);
            }
        } else {
            urlOrig = await obtenerImagenInteligente(titulo, categoria, sub, null);
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

        // Solo Telegram — sin FB ni Twitter que generan errores
        publicarEnTelegram(titulo, slFin, urlFinal, desc, categoria)
            .then(ok => console.log(`   [TG] ${ok ? 'OK' : 'ERR'}`))
            .catch(() => {});

        return { success: true, slug: slFin, titulo, mensaje: 'Publicada en web + redes' };

    } catch (error) {
        console.error('[Gen] ERROR: ' + error.message);
        await registrarError('generacion', error.message, categoria);
        return { success: false, error: error.message };
    }
}

// ─── RSS — 30 FUENTES ─────────────────────────────────────────────────────────
// ─── 3 MEJORES PERIÓDICOS RD — FUENTE PRINCIPAL DE NOTICIAS ─────────────────
// Estrategia: coger la noticia + foto real → Gemini la reescribe élite → watermark
// Listín Diario, Diario Libre y N Digital son los de mayor tráfico y retención en RD
const FUENTES_RSS = [

    // ══════════════════════════════════════════════
    //  🏆 LISTÍN DIARIO — Mayor autoridad en RD
    // ══════════════════════════════════════════════
    { url: 'https://listindiario.com/feed',                              categoria: 'Nacionales',      nombre: 'Listin Diario' },
    { url: 'https://listindiario.com/la-republica/feed',                 categoria: 'Nacionales',      nombre: 'Listin Republica' },
    { url: 'https://listindiario.com/economia-and-negocios/feed',        categoria: 'Economia',        nombre: 'Listin Economia' },
    { url: 'https://listindiario.com/deportes/feed',                     categoria: 'Deportes',        nombre: 'Listin Deportes' },
    { url: 'https://listindiario.com/la-vida/feed',                      categoria: 'Espectaculos',    nombre: 'Listin Vida' },
    { url: 'https://listindiario.com/tecnologia/feed',                   categoria: 'Tecnologia',      nombre: 'Listin Tecnologia' },
    { url: 'https://listindiario.com/el-mundo/feed',                     categoria: 'Internacionales', nombre: 'Listin Mundo' },

    // ══════════════════════════════════════════════
    //  🥈 DIARIO LIBRE — Mayor tráfico digital RD
    // ══════════════════════════════════════════════
    { url: 'https://www.diariolibre.com/feed',                           categoria: 'Nacionales',      nombre: 'Diario Libre' },
    { url: 'https://www.diariolibre.com/economia/feed',                  categoria: 'Economia',        nombre: 'DL Economia' },
    { url: 'https://www.diariolibre.com/deportes/feed',                  categoria: 'Deportes',        nombre: 'DL Deportes' },
    { url: 'https://www.diariolibre.com/tecnologia/feed',                categoria: 'Tecnologia',      nombre: 'DL Tecnologia' },
    { url: 'https://www.diariolibre.com/mundo/feed',                     categoria: 'Internacionales', nombre: 'DL Mundo' },
    { url: 'https://www.diariolibre.com/entretenimiento/feed',           categoria: 'Espectaculos',    nombre: 'DL Entretenimiento' },

    // ══════════════════════════════════════════════
    //  🥉 N DIGITAL — Noticias de alto impacto RD
    // ══════════════════════════════════════════════
    { url: 'https://n.com.do/feed/',                                     categoria: 'Nacionales',      nombre: 'N Digital' },
    { url: 'https://n.com.do/economia/feed/',                            categoria: 'Economia',        nombre: 'N Digital Economia' },
    { url: 'https://n.com.do/deportes/feed/',                            categoria: 'Deportes',        nombre: 'N Digital Deportes' },
    { url: 'https://n.com.do/internacionales/feed/',                     categoria: 'Internacionales', nombre: 'N Digital Mundo' },
    { url: 'https://n.com.do/entretenimiento/feed/',                     categoria: 'Espectaculos',    nombre: 'N Digital Entretenimiento' },

    // ══════════════════════════════════════════════
    //  📡 FUENTES INTERNACIONALES DE RESPALDO
    // ══════════════════════════════════════════════
    { url: 'https://feeds.bbci.co.uk/mundo/rss.xml',                    categoria: 'Internacionales', nombre: 'BBC Mundo' },
    { url: 'https://www.reuters.com/arc/outboundfeeds/rss/category/latam/?outputType=xml', categoria: 'Internacionales', nombre: 'Reuters LatAm' },
    { url: 'https://feeds.bloomberg.com/markets/news.rss',               categoria: 'Economia',        nombre: 'Bloomberg' },
    { url: 'https://www.wired.com/feed/rss',                             categoria: 'Tecnologia',      nombre: 'Wired' },
];

// ─── PROCESADOR RSS — FIX 3 (100% secuencial, anti-SIGTERM) ──────────────────
let rssEnProceso = false;

// ─── SCRAPER DE IMAGEN — adaptado a cada periódico ──────────────────────────
// Cada periódico tiene su estructura HTML — extraemos la foto exacta de la noticia
const PATRON_IMAGEN_PERIODICO = {
    // Diario Libre — usa og:image y resources.diariolibre.com
    'diariolibre.com': (html) => {
        const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (og?.[1]?.startsWith('http')) return og[1];
        // Patrón específico Diario Libre
        const dl = html.match(/resources\.diariolibre\.com\/images\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);
        if (dl) return 'https://' + dl[0].replace(/^https?:\/\//, '');
        return null;
    },
    // Listín Diario — usa og:image y cdn.listindiario.com
    'listindiario.com': (html) => {
        const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (og?.[1]?.startsWith('http')) return og[1];
        const ld = html.match(/cdn\.listindiario\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);
        if (ld) return 'https://' + ld[0].replace(/^https?:\/\//, '');
        return null;
    },
    // N Digital — usa og:image y storage.googleapis o cdn propio
    'n.com.do': (html) => {
        const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (og?.[1]?.startsWith('http')) return og[1];
        const nd = html.match(/https:\/\/[^"'\s]*n\.com\.do[^"'\s]+\.(?:jpg|jpeg|png|webp)/i);
        if (nd) return nd[0];
        return null;
    },
    // Reuters
    'reuters.com': (html) => {
        const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        return og?.[1]?.startsWith('http') ? og[1] : null;
    },
    // BBC
    'bbc.com': (html) => {
        const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        return og?.[1]?.startsWith('http') ? og[1] : null;
    },
};

async function scrapearImagenArticulo(url) {
    if (!url) return null;
    try {
        const ctrl = new AbortController();
        const tm   = setTimeout(() => ctrl.abort(), 8000);
        const res  = await fetch(url, {
            headers: { ...BROWSER_HEADERS, Accept: 'text/html,application/xhtml+xml' },
            signal: ctrl.signal,
        }).finally(() => clearTimeout(tm));
        if (!res.ok) return null;
        const html = await res.text();

        // 1. Usar extractor específico del periódico si existe
        for (const [dominio, extractor] of Object.entries(PATRON_IMAGEN_PERIODICO)) {
            if (url.includes(dominio)) {
                const img = extractor(html);
                if (img) {
                    console.log(`   [Scraper-${dominio.split('.')[0]}] ✓ ${img.substring(0, 70)}`);
                    return img;
                }
                break;
            }
        }

        // 2. Fallback genérico — og:image funciona en casi todos
        const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (og?.[1]?.startsWith('http') && /\.(jpg|jpeg|png|webp)/i.test(og[1])) {
            return og[1];
        }

        // 3. twitter:image
        const tw = html.match(/name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
        if (tw?.[1]?.startsWith('http') && /\.(jpg|jpeg|png|webp)/i.test(tw[1])) {
            return tw[1];
        }

    } catch (_) {}
    return null;
}

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

// ─── DETECTOR DE RELEVANCIA Y TENDENCIAS ─────────────────────────────────────
// Palabras de alto tráfico en RD — si aparecen en el título, la noticia es prioritaria
const PALABRAS_TRENDING = [
    // Política y gobierno RD
    'abinader','leonel','luis','presidente','gobierno','congreso','senado','diputados',
    'jce','elecciones','reforma','ley','decreto','ministerio','procuraduria',
    // Economía impacto directo
    'precio','gasolina','combustible','dolar','inflacion','salario','aumento','baja',
    'luz','agua','apagón','invivienda','vivienda','prestamo','tasa','banco',
    // Seguridad — alto tráfico en RD
    'muerto','matan','asesinato','tiroteo','policia','arresto','detenido','preso',
    'crimen','robo','secuestro','operativo','narcotráfico','drogas',
    // Deportes trending
    'béisbol','beisbol','pelotero','liga','playoff','campeón','gana','pierde',
    'juan soto','vladimir','manny','david ortiz','marlins','yankees','dodgers',
    // Internacional con impacto en RD
    'trump','estados unidos','eeuu','remesas','deportacion','migrante','haiti',
    'venezuela','cuba','aranceles','visa','embargo',
    // Salud y emergencias
    'muertos','heridos','accidente','incendio','huracan','terremoto','alerta',
    'hospital','epidemia','virus','vacuna',
    // Tecnología trending
    'inteligencia artificial','ia','chatgpt','meta','google','apple','elon musk',
];

// Temas que YA publicamos hoy — evitar saturación del mismo tema
const temasPublicadosHoy = new Set();
setInterval(() => temasPublicadosHoy.clear(), 12 * 60 * 60 * 1000); // limpiar cada 12h

function puntuarRelevancia(titulo, contenido = '') {
    if (!titulo) return 0;
    const texto = (titulo + ' ' + contenido).toLowerCase();
    let score = 0;

    // +3 por cada palabra trending encontrada
    for (const palabra of PALABRAS_TRENDING) {
        if (texto.includes(palabra)) score += 3;
    }

    // +5 si tiene cifras concretas (indica noticia con datos reales)
    if (/\d+%|\$\d+|rd\$|millones|miles de|\d+ (personas|muertos|heridos|casos)/.test(texto)) score += 5;

    // +3 si menciona lugares de RD
    if (/santo domingo|santiago|la romana|san pedro|puerto plata|barahona|sde|los mina/.test(texto)) score += 3;

    // -10 si ya cubrimos este tema hoy (anti-repetición)
    const palabrasClave = titulo.toLowerCase().split(' ').filter(w => w.length > 5).slice(0, 3).join('-');
    if (temasPublicadosHoy.has(palabrasClave)) score -= 10;

    return score;
}

async function procesarRSS() {
    if (!CONFIG_IA.enabled) return;
    if (rssEnProceso) { console.log('[RSS] Ya en proceso, ciclo omitido'); return; }

    rssEnProceso = true;
    console.log(`\n[RSS] ⚡ Ciclo iniciado — buscando noticias relevantes...`);
    let procesadas = 0;
    let omitidas   = 0;

    // Recolectar TODOS los items de TODAS las fuentes primero
    // Luego ordenar por relevancia y publicar las mejores
    const candidatos = [];

    for (const fuente of FUENTES_RSS) {
        try {
            const feed = await rssParser.parseURL(fuente.url).catch(() => null);
            if (!feed?.items?.length) continue;

            for (const item of feed.items.slice(0, 5)) {
                const guid = item.guid || item.link || item.title;
                if (!guid) continue;

                // Ya procesada — saltar
                const ya = await pool.query(
                    'SELECT id FROM rss_procesados WHERE item_guid=$1',
                    [guid.substring(0, 500)]
                );
                if (ya.rows.length) continue;

                const score = puntuarRelevancia(item.title, item.contentSnippet);
                candidatos.push({ item, fuente, guid, score });
            }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
    }

    if (!candidatos.length) {
        console.log('[RSS] Sin noticias nuevas en este ciclo');
        rssEnProceso = false;
        return;
    }

    // Ordenar por relevancia — las más importantes primero
    candidatos.sort((a, b) => b.score - a.score);

    console.log(`[RSS] ${candidatos.length} candidatas — Top 3 scores: ${candidatos.slice(0,3).map(c => c.score + ' "' + (c.item.title||'').substring(0,30) + '"').join(' | ')}`);

    // Publicar máximo 5 por ciclo — las más relevantes
    // Si score < 3 = noticia sin valor trending → esperar al próximo ciclo
    const SCORE_MINIMO  = 3;
    const MAX_POR_CICLO = 2; // máx 2 por ciclo — evita 429 de Gemini

    for (const candidato of candidatos.slice(0, MAX_POR_CICLO)) {
        const { item, fuente, guid, score } = candidato;

        if (score < SCORE_MINIMO) {
            console.log(`[RSS] ⏭ Omitida (score ${score}): "${(item.title||'').substring(0,50)}"`);
            omitidas++;

            // Marcar como procesada igual — no volver a evaluar
            await pool.query(
                'INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',
                [guid.substring(0, 500), fuente.nombre + '-omitida']
            );
            continue;
        }

        console.log(`[RSS] ✅ Publicando (score ${score}): "${(item.title||'').substring(0,50)}"`);

        // PLAN C: imagen real del artículo
        let imagenRSS = extraerImagenRSS(item);
        if (!imagenRSS && item.link) {
            imagenRSS = await scrapearImagenArticulo(item.link);
        }
        if (imagenRSS) {
            console.log(`   [IMG ✓] ${imagenRSS.substring(0, 70)}`);
        }

        // Construir comunicado para Gemini
        const com = [
            item.title          ? `TITULO ORIGINAL: ${item.title}`                                      : '',
            item.contentSnippet ? `RESUMEN: ${item.contentSnippet}`                                     : '',
            item.content        ? `CONTENIDO: ${item.content.substring(0, 2000)}`                       : '',
            item['content:encoded'] ? `TEXTO: ${item['content:encoded'].replace(/<[^>]+>/g,'').substring(0,1000)}` : '',
            `FUENTE: ${fuente.nombre}`,
            `SCORE TENDENCIA: ${score} — Esta noticia tiene alto potencial de tráfico en RD.`,
            `INSTRUCCION: Reescribe con voz propia y periodismo élite. SEO máximo. NO copies el original.`,
        ].filter(Boolean).join('\n');

        const res = await generarNoticia(fuente.categoria, com, imagenRSS);

        if (res.success) {
            await pool.query(
                'INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',
                [guid.substring(0, 500), fuente.nombre]
            );
            // Registrar tema para evitar repetición en las próximas 12h
            const palabrasClave = (item.title||'').toLowerCase().split(' ').filter(w=>w.length>5).slice(0,3).join('-');
            temasPublicadosHoy.add(palabrasClave);
            procesadas++;
            await new Promise(r => setTimeout(r, 20000)); // pausa 20s — evita 429 de Gemini
        }
    }

    console.log(`[RSS] Ciclo terminado — Publicadas: ${procesadas} | Omitidas: ${omitidas} | Score mínimo: ${SCORE_MINIMO}`);
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
// Pulso de vida — evita que Railway duerma el servidor
// ─── KEEP-ALIVE cada 14 min (Railway no duerme el proceso) ──────────────────
cron.schedule('*/14 * * * *', async () => {
    try { await fetch(`http://localhost:${PORT}/health`); } catch (_) {}
});

// ─── 3 SLOTS ESCALONADOS — una key por turno, sin chocar ────────────────────
// Slot A → :00 (Key 1)   Slot B → :10 (Key 2)   Slot C → :20 (Key 3)
// Cada slot espera su turno — 30 min de descanso entre publicaciones
// Con 3 keys: ~4-5 noticias/hora = 100+ noticias/día sin errores 429

// SLOT A — minuto :00 de cada hora (usa Key 1 preferentemente)
cron.schedule('0 * * * *', async () => {
    if (rssEnProceso) { console.log('[Slot-A] En proceso, omitido'); return; }
    console.log('[Slot-A] ⚡ Key-1 publicando...');
    procesarRSS();
});

// SLOT B — minuto :10 de cada hora (usa Key 2 preferentemente)
cron.schedule('10 * * * *', async () => {
    if (rssEnProceso) { console.log('[Slot-B] En proceso, omitido'); return; }
    console.log('[Slot-B] ⚡ Key-2 publicando...');
    procesarRSS();
});

// SLOT C — minuto :20 de cada hora (usa Key 3 preferentemente)
cron.schedule('20 * * * *', async () => {
    if (rssEnProceso) { console.log('[Slot-C] En proceso, omitido'); return; }
    console.log('[Slot-C] ⚡ Key-3 publicando...');
    procesarRSS();
});

// SLOT D — minuto :40 — noticia propia de análisis con IA
cron.schedule('40 * * * *', async () => {
    if (!CONFIG_IA.enabled || rssEnProceso) return;
    const cat = CATS[Math.floor(Math.random() * CATS.length)];
    console.log(`[Slot-D] 🏮 Noticia propia: ${cat}`);
    await generarNoticia(cat);
});

// ─── LIMPIEZA AUTOMÁTICA — todos los días a las 3:00 AM ──────────────────────
// Mantiene la BD ligera y el sitio siempre con contenido fresco
// Reglas:
//   - Noticias de más de 7 días → borrar (ya no generan tráfico)
//   - rss_procesados de más de 3 días → borrar (para que pueda reprocesar si es relevante)
//   - Archivos /tmp de imágenes de más de 7 días → borrar (liberar espacio Railway)
cron.schedule('0 3 * * *', async () => {
    try {
        console.log('[Limpieza] 🧹 Iniciando limpieza automática...');

        // 1. Borrar noticias de más de 7 días
        const r1 = await pool.query(`
            DELETE FROM noticias
            WHERE fecha < NOW() - INTERVAL '7 days'
            RETURNING id`);
        console.log(`[Limpieza] Noticias viejas borradas: ${r1.rowCount}`);

        // 2. Borrar registro RSS de más de 3 días
        // (permite reprocesar noticias relevantes si vuelven a aparecer)
        const r2 = await pool.query(`
            DELETE FROM rss_procesados
            WHERE fecha < NOW() - INTERVAL '3 days'`);
        console.log(`[Limpieza] RSS procesados limpios: ${r2.rowCount}`);

        // 3. Borrar imágenes viejas de /tmp
        const archivos = fs.readdirSync('/tmp').filter(f => f.startsWith('efd-') && f.endsWith('.jpg'));
        let imgBorradas = 0;
        const ahora = Date.now();
        for (const archivo of archivos) {
            try {
                const ruta  = path.join('/tmp', archivo);
                const stats = fs.statSync(ruta);
                const dias  = (ahora - stats.mtimeMs) / (1000 * 60 * 60 * 24);
                if (dias > 7) {
                    fs.unlinkSync(ruta);
                    imgBorradas++;
                }
            } catch (_) {}
        }
        console.log(`[Limpieza] Imágenes /tmp borradas: ${imgBorradas}`);

        invalidarCache();
        console.log('[Limpieza] ✅ Limpieza completada — BD y servidor ligeros');
    } catch (e) {
        console.error('[Limpieza] Error: ' + e.message);
    }
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
    res.setHeader('Cache-Control', 'public,max-age=300,stale-while-revalidate=600');
    res.setHeader('Content-Type',  'application/json');
    try {
        if (_cacheNoticias && (Date.now() - _cacheFecha) < CACHE_TTL)
            return res.json({ success: true, noticias: _cacheNoticias, cached: true });
        const r = await pool.query(
            `SELECT id,titulo,slug,seccion,imagen,imagen_alt,fecha,vistas,redactor
             FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30`,
            ['publicada']
        );
        // Optimizar URLs de Pexels para carga rápida en lista
        r.rows = r.rows.map(n => ({
            ...n,
            imagen: false // ya no usamos pexels directo
                ? n.imagen.replace(/\?.*$/, '') + '?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop&q=70'
                : n.imagen
        }));
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

// ─── RESETEAR TODO — empezar de cero ─────────────────────────────────────────
app.post('/api/resetear-todo', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN' });
    try {
        await pool.query('DELETE FROM noticias');
        await pool.query('DELETE FROM rss_procesados');
        await pool.query('DELETE FROM comentarios');
        invalidarCache();
        console.log('[RESET] Base de datos limpiada — empezando de cero');
        res.json({ success: true, mensaje: 'Todo borrado. El servidor publicará noticias nuevas en el próximo ciclo RSS.' });
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
            res.setHeader('Cache-Control', 'public,max-age=1800,stale-while-revalidate=3600');
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
        res.header('Cache-Control', 'public,max-age=7200');
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
            // Facebook eliminado
            // Twitter eliminado
            telegram:       TELEGRAM_TOKEN ? 'Activo' : 'Sin token',
            
            
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
║  Gemini Keys    : ${String(GEMINI_KEYS.length + ' key(s) activa(s)').padEnd(35)}║
║  Imágenes       : Periódico original → Banco local curado   ║
║  Timeout IA     : ${(GEMINI_TIMEOUT / 1000 + 's').padEnd(35)}║
║  Watermark      : ${wm.substring(0, 35).padEnd(35)}║
║  Facebook       : ELIMINADO (usa Google News)                ║
║  Twitter        : ELIMINADO (usa Google News)                ║
║  Telegram       : ${(TELEGRAM_TOKEN ? 'ACTIVO' : 'Sin token').padEnd(35)}║
║  RSS            : 30 fuentes / ejecución secuencial   ║
╚═══════════════════════════════════════════════════════╝`);
    });

    setTimeout(regenerarWatermarksLostidos, 5000);
    setTimeout(bienvenidaTelegram,          8000);
}

iniciar();
module.exports = app;
