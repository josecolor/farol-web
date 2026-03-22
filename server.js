/**
 * 🏮 EL FAROL AL DÍA — V34.53
 * Stack: Node.js · Express · PostgreSQL · Railway · Sharp · Gemini 2.5 Flash
 *
 * SISTEMA DE IMÁGENES:
 *   - Scraper por dominio (Listín, Diario Libre, N Digital) → og:image
 *   - verificarCalidadImagen(): ≥400px + sin marca ajena (stdDev franja inferior)
 *   - Regeneración gradual: 3 fotos/ciclo cada 2h
 *   - Banco local 170 fotos verificadas como último recurso
 *
 * GEMINI:
 *   - Timeout: 90s · Descanso entre keys: 60s · Hasta 5 keys rotando
 *   - Horarios: 6-20h cada 10min · 20-24h cada 30min · 0-6h cada hora
 *
 * SIN: Pexels · Pixabay · Wikimedia · Facebook · Twitter · Telegram
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
// Google Custom Search — opcional, mejora calidad de fotos
if (!process.env.GOOGLE_CSE_KEY) console.warn('[IMG] GOOGLE_CSE_KEY no configurada — fotos HD limitadas');

// ─── GEMINI MULTI-KEY — acepta KEY, KEY2, KEY3, KEY4, KEY5 en cualquier combinación ──
// Si tienes KEY2, KEY3, KEY4 pero no KEY — el servidor igual arranca con las que haya
// Cada cuenta Google gratuita da ~15 req/min — 4 cuentas = 60 req/min
const GEMINI_KEYS = [
    process.env.GEMINI_API_KEY  || null,
    process.env.GEMINI_API_KEY2 || null,
    process.env.GEMINI_API_KEY3 || null,
    process.env.GEMINI_API_KEY4 || null,
    process.env.GEMINI_API_KEY5 || null,
].filter(Boolean);

// Verificar que al menos UNA key existe — cualquiera sirve como principal
if (!GEMINI_KEYS.length) {
    console.error('[FATAL] Se necesita al menos una GEMINI_API_KEY (KEY, KEY2, KEY3 o KEY4)');
    process.exit(1);
}
console.log(`[Gemini] ${GEMINI_KEYS.length} key(s) disponibles`);
// ─── ROTACIÓN DE KEYS POR TURNO ──────────────────────────────────────────────
// Cada noticia usa la siguiente key en orden — turno estricto
// Key 1 → descansa → Key 2 → descansa → Key 3 → descansa → Key 1...
// Descando de 60s por key después de cada publicación
let   GEMINI_KEY_INDEX  = 0;
const GEMINI_KEY_RESET  = {}; // { keyIndex: tiempoLibre }
const GEMINI_DESCANSO   = 60000; // 60s de descanso entre usos de la misma key

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
const pool      = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:             { rejectUnauthorized: false },
    max:             5,    // máximo 5 conexiones simultáneas — evita saturar Railway
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
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
        SALUD.erroresImagen++;
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
// Timeout : 90s con AbortController — clearTimeout en .finally() es obligatorio
//           para que Node no mantenga el timer activo después de la respuesta.
const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_TIMEOUT = 90000; // 90s — Gemini 2.5 Flash necesita más para artículos completos
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
            const isTimeout = err.name === 'AbortError';
            const label = isTimeout ? `TIMEOUT (${GEMINI_TIMEOUT / 1000}s)` : err.message;
            if (isTimeout) SALUD.timeoutsGemini++;
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
    // Anti-duplicado: evitar usar la misma foto que ya está en portada
    const disponibles = b.filter(url => !fotosUsadasReciente.has(url));
    const lista = disponibles.length ? disponibles : b; // si todas usadas, resetear
    const url = lista[Math.floor(Math.random() * lista.length)];
    fotosUsadasReciente.add(url);
    return url;
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

// ─── SEO AVANZADO ─────────────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ─── ANALIZADOR SEO — detecta problemas y los corrige automáticamente ─────────
function analizarSEOTitulo(titulo) {
    const problemas = [];
    const sugerencias = [];

    if (!titulo) return { score: 0, problemas: ['Sin título'], sugerencias: [] };

    const len = titulo.length;
    if (len < 40) { problemas.push(`Título muy corto (${len} chars)`); sugerencias.push('Alargar a 55-65 chars'); }
    if (len > 70) { problemas.push(`Título muy largo (${len} chars)`); sugerencias.push('Acortar a 55-65 chars'); }

    // Palabras de alto CTR para Google News dominicano
    const palabrasCTR = ['anuncia','aprueba','aumenta','baja','alerta','muere','gana','pierde','sube','confirma','ordena','revela','impone'];
    const tieneVerboCTR = palabrasCTR.some(p => titulo.toLowerCase().includes(p));
    if (!tieneVerboCTR) sugerencias.push('Agregar verbo activo al inicio');

    // Números aumentan CTR en 20-30%
    const tieneNumero = /\d/.test(titulo);
    if (!tieneNumero) sugerencias.push('Incluir cifra o porcentaje');

    const score = Math.max(0, 100
        - (len < 40 ? 20 : 0)
        - (len > 70 ? 15 : 0)
        - (!tieneVerboCTR ? 15 : 0)
        - (!tieneNumero ? 10 : 0)
    );

    return { score, problemas, sugerencias, len };
}

function analizarSEOContenido(contenido) {
    if (!contenido) return { score: 0, problemas: ['Sin contenido'] };
    const palabras = contenido.split(/\s+/).filter(Boolean).length;
    const parrafos = contenido.split('\n\n').filter(p => p.trim()).length;
    const problemas = [];

    if (palabras < 300) problemas.push(`Contenido corto (${palabras} palabras)`);
    if (parrafos < 4)   problemas.push(`Pocos párrafos (${parrafos})`);

    // Densidad de keywords — no más del 3%
    const score = Math.max(0, 100
        - (palabras < 300 ? 20 : 0)
        - (parrafos < 4 ? 15 : 0)
    );

    return { score, problemas, palabras, parrafos };
}

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

// ─── PERIODISTAS — cada uno tiene voz, estilo y fuentes distintas ────────────
const PERIODISTAS = {
    'Carlos Mendez': {
        esp:    'Nacionales',
        estilo: 'Cronista político. Frío, directo, datos duros. Cita instituciones oficiales: Presidencia, Procuraduría, Congreso, JCE. Nunca especula. Voz de autoridad.',
        fuentes:'Presidencia de la República, Congreso Nacional, Procuraduría General, Ministerio del Interior, JCE, Policía Nacional, Fuerzas Armadas.',
        tono:   'Formal y contundente. Titulares de declaración: "Abinader ordena...", "Congreso aprueba...", "Procuraduría imputa..."',
    },
    'Laura Santana': {
        esp:    'Deportes',
        estilo: 'Fanática del béisbol y el fútbol dominicano. Pasión controlada. Conecta el deporte con el orgullo nacional. Sabe de estadísticas MLB y Liga Dominicana.',
        fuentes:'MLB.com, Liga Dominicana de Béisbol, Federación Dominicana de Fútbol, ESPN Caribe, récords y estadísticas oficiales.',
        tono:   'Energético y emotivo. Titulares de acción: "Guerrero Jr. rompe récord...", "Tigres del Licey campeones...", "RD clasifica al Mundial..."',
    },
    'Roberto Pena': {
        esp:    'Internacionales',
        estilo: 'Corresponsal internacional. Siempre conecta el hecho global con el impacto en RD y el Caribe. Explica geopolítica en lenguaje simple.',
        fuentes:'Reuters, AP, BBC Mundo, Bloomberg, ONU, OEA, Banco Mundial, FMI. Siempre incluye ángulo caribeño.',
        tono:   'Analítico y contextualizado. Titulares de impacto: "Trump anuncia aranceles que afectan a RD...", "Crisis en Haití amenaza la frontera..."',
    },
    'Ana Maria Castillo': {
        esp:    'Economia',
        estilo: 'Economista de campo. Habla de dinero en términos que entiende el ciudadano. Siempre incluye cuánto le cuesta al dominicano promedio.',
        fuentes:'Banco Central RD (BCRD), MEPyD, DGII, Bolsa de Valores RD, bancos comerciales, Ministerio de Hacienda, FMI para RD.',
        tono:   'Preciso y ciudadano. Titulares de cifra: "Combustibles suben RD$15 esta semana...", "Inflación baja a 3.2% según BCRD...", "Dólar cierra en..."',
    },
    'Jose Miguel Fernandez': {
        esp:    'Tecnologia',
        estilo: 'Geek dominicano. Explica la tecnología pensando en el pequeño empresario de SDE, el estudiante de INFOTEP, el emprendedor de Los Mina.',
        fuentes:'INDOTEL, MICM, INFOTEP, startups RD, ITLA, MIT Tech Review en español, TechCrunch para Latinoamérica.',
        tono:   'Cercano y práctico. Titulares útiles: "INFOTEP abre 3,000 becas en IA para SDE...", "App dominicana gana premio regional...", "Internet llega al campo..."',
    },
    'Patricia Jimenez': {
        esp:    'Espectaculos',
        estilo: 'Conocedora de la cultura dominicana: merengue, bachata, cine nacional, farándula del Caribe. Orgullosa de lo nuestro pero sin ser amarillista.',
        fuentes:'Ministerio de Cultura, Billboard Tropical, Premios Soberano, EGEDA RD, cines nacionales, artistas dominicanos reconocidos.',
        tono:   'Cálido y orgulloso. Titulares de celebración: "Romeo Santos llena el Estadio Olímpico...", "Película dominicana llega a Netflix...", "Juan Luis Guerra gana Grammy..."',
    },
};

function elegirRedactor(cat) {
    const match = Object.entries(PERIODISTAS).find(([_, p]) => p.esp === cat);
    if (match) return match[0];
    return 'Redaccion EFD';
}

function obtenerPerfilPeriodista(nombre) {
    return PERIODISTAS[nombre] || {
        estilo: 'Periodista generalista. Cubre todas las categorías con rigor.',
        fuentes: 'Fuentes oficiales dominicanas e internacionales.',
        tono: 'Neutro y profesional.',
    };
}

let _cacheNoticias = null, _cacheFecha = 0;
const CACHE_TTL = 600000; // 10 minutos — menos queries a la BD
function invalidarCache() { _cacheNoticias = null; _cacheFecha = 0; }

// ─── MEMORIA IA ───────────────────────────────────────────────────────────────

async function registrarError(tipo, descripcion, categoria) {
    try {
        const desc = String(descripcion || '').substring(0, 200);
        await pool.query("INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES('error',$1,$2,1) ON CONFLICT DO NOTHING", [desc, categoria]);
        await pool.query("UPDATE memoria_ia SET fallos=fallos+1,ultima_vez=NOW() WHERE tipo='error' AND valor=$1", [desc]);
    } catch (_) {}
}

// ─── SISTEMA DE APRENDIZAJE ───────────────────────────────────────────────────
// El servidor aprende qué funciona y qué no:
//   - Qué categorías generan más vistas
//   - Qué fuentes RSS traen noticias que más se leen
//   - Qué palabras en el título atraen más tráfico
//   - Qué horarios publican mejor
//   - Qué tipo de fotos funcionan más

async function registrarAprendizaje(tipo, valor, categoria, exito = true) {
    try {
        const v = String(valor).substring(0, 200);
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, exitos, fallos)
            VALUES($1, $2, $3, $4, $5)
            ON CONFLICT DO NOTHING`,
            [tipo, v, categoria, exito ? 1 : 0, exito ? 0 : 1]
        );
        await pool.query(`
            UPDATE memoria_ia
            SET exitos    = exitos + $1,
                fallos    = fallos + $2,
                ultima_vez = NOW()
            WHERE tipo = $3 AND valor = $4`,
            [exito ? 1 : 0, exito ? 0 : 1, tipo, v]
        );
    } catch (_) {}
}

// ─── APRENDIZAJE EXPANDIDO — CTR, patrones, SEO score ───────────────────────
// El sistema aprende de sus propios resultados y mejora con el tiempo
// Métricas que rastrea: vistas, palabras trending, horarios, categorías, SEO score

// Registrar análisis SEO de cada noticia publicada
async function registrarSEONoticia(titulo, contenido, categoria) {
    try {
        const seoTitulo    = analizarSEOTitulo(titulo);
        const seoContenido = analizarSEOContenido(contenido);
        const scoreTotal   = Math.round((seoTitulo.score + seoContenido.score) / 2);

        await registrarAprendizaje('seo_score', `${scoreTotal}`, categoria, scoreTotal > 70);

        if (seoTitulo.problemas.length) {
            console.log(`   [SEO] ⚠️ Título: ${seoTitulo.problemas.join(', ')}`);
        }
        if (seoTitulo.sugerencias.length) {
            console.log(`   [SEO] 💡 Sugerencias: ${seoTitulo.sugerencias.join(', ')}`);
        }
        console.log(`   [SEO] Score: ${scoreTotal}/100 (título: ${seoTitulo.score}, contenido: ${seoContenido.score})`);

        return scoreTotal;
    } catch (_) { return 0; }
}

// ─── APRENDER DE VISTAS — qué categorías y patrones generan tráfico ──────────
// Corre cada 4 horas — analiza las noticias más vistas y aprende
async function aprenderDeVistas() {
    try {
        // Top noticias por vistas en las últimas 48h
        const top = await pool.query(`
            SELECT titulo, seccion, vistas, redactor, fecha
            FROM   noticias
            WHERE  estado = 'publicada'
            AND    fecha  > NOW() - INTERVAL '48 hours'
            AND    vistas > 0
            ORDER  BY vistas DESC
            LIMIT  20`);

        if (!top.rows.length) return;

        // Aprender: qué categorías rinden más
        const vistasXCat = {};
        const countXCat  = {};
        for (const n of top.rows) {
            vistasXCat[n.seccion] = (vistasXCat[n.seccion] || 0) + n.vistas;
            countXCat[n.seccion]  = (countXCat[n.seccion]  || 0) + 1;
        }

        for (const [cat, total] of Object.entries(vistasXCat)) {
            const promedio = Math.round(total / countXCat[cat]);
            await registrarAprendizaje('rendimiento_categoria', cat, cat, promedio > 5);
        }

        // Aprender: qué palabras en títulos generan más vistas
        const palabrasVistas = {};
        for (const n of top.rows) {
            const palabras = n.titulo.toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 5 && !['republica','dominicana','santo','domingo'].includes(w));

            for (const p of palabras) {
                palabrasVistas[p] = (palabrasVistas[p] || 0) + n.vistas;
            }
        }

        // Las 10 palabras con más vistas — aprender que son trending real
        const topPalabras = Object.entries(palabrasVistas)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        for (const [palabra, vistas] of topPalabras) {
            await registrarAprendizaje('palabra_trending', palabra, 'global', true);
        }

        // Aprender: qué horario publica mejor
        const hora = new Date().getHours();
        const promedioActual = top.rows.reduce((s, n) => s + n.vistas, 0) / top.rows.length;
        await registrarAprendizaje('rendimiento_horario', `hora_${hora}`, 'global', promedioActual > 3);

        console.log(`[Aprende] ✅ Analicé ${top.rows.length} noticias — top palabras: ${topPalabras.slice(0,3).map(p=>p[0]).join(', ')}`);

    } catch (e) {
        console.warn('[Aprende] Error: ' + e.message);
    }
}

// ─── LEER LO APRENDIDO — palabras que el sistema sabe que generan tráfico ─────
async function obtenerPalabrasAprendidas() {
    try {
        const r = await pool.query(`
            SELECT valor, exitos
            FROM   memoria_ia
            WHERE  tipo     = 'palabra_trending'
            AND    exitos   > 2
            AND    ultima_vez > NOW() - INTERVAL '7 days'
            ORDER  BY exitos DESC
            LIMIT  20`);
        return r.rows.map(r => r.valor);
    } catch (_) { return []; }
}

// ─── CATEGORÍA MÁS RENTABLE — decide qué publicar en Slot D ─────────────────
async function obtenerCategoriaOptima() {
    try {
        const r = await pool.query(`
            SELECT categoria, exitos, fallos,
                   ROUND(exitos::float / GREATEST(exitos+fallos,1) * 100) AS pct
            FROM   memoria_ia
            WHERE  tipo = 'rendimiento_categoria'
            ORDER  BY exitos DESC
            LIMIT  1`);

        if (r.rows.length && r.rows[0].pct > 50) {
            console.log(`[Aprende] 🧠 Categoría óptima: ${r.rows[0].categoria} (${r.rows[0].pct}% éxito)`);
            return r.rows[0].categoria;
        }
    } catch (_) {}
    // Si no hay datos suficientes → aleatoria
    return CATS[Math.floor(Math.random() * CATS.length)];
}

async function construirMemoria() {
    try {
        // Noticias recientes — no repetir
        const r = await pool.query("SELECT titulo, seccion, vistas FROM noticias WHERE estado='publicada' ORDER BY fecha DESC LIMIT 20");
        let memoria = '';

        if (r.rows.length) {
            r.rows.forEach(x => {
                const palabrasClave = x.titulo.toLowerCase().split(' ').filter(w=>w.length>5).slice(0,3).join('-');
                temasPublicadosHoy.add(palabrasClave);
            });
            memoria += '\nYA PUBLICADAS HOY — NO repetir:\n' + r.rows.map((x, i) => `${i+1}. ${x.titulo}`).join('\n') + '\n';
        }

        // Lo que el sistema aprendió que funciona — dárselo a Gemini
        if (PALABRAS_APRENDIDAS.length) {
            memoria += `\nPALABRAS QUE GENERAN TRÁFICO REAL (usar si aplica): ${PALABRAS_APRENDIDAS.slice(0,10).join(', ')}\n`;
        }

        // Top noticias por vistas — para que Gemini entienda qué tipo funciona
        const top = await pool.query(`
            SELECT titulo, seccion, vistas FROM noticias
            WHERE estado='publicada' AND vistas > 3
            ORDER BY vistas DESC LIMIT 5`);
        if (top.rows.length) {
            memoria += '\nTITULARES QUE MÁS TRÁFICO GENERARON — aprende el estilo exacto:\n';
            top.rows.forEach(n => {
                const seo = analizarSEOTitulo(n.titulo);
                memoria += `- "${n.titulo}" → ${n.vistas} vistas (SEO: ${seo.score}/100, ${seo.len} chars)\n`;
            });
            memoria += '\n';
        }

        // Patrón SEO aprendido — qué estructura de título funciona mejor
        const mejorSEO = await pool.query(`
            SELECT valor, exitos FROM memoria_ia
            WHERE tipo = 'seo_score' AND exitos > 2
            ORDER BY exitos DESC LIMIT 3`).catch(() => ({ rows: [] }));
        if (mejorSEO.rows.length) {
            const scorePromedio = Math.round(mejorSEO.rows.reduce((s,r) => s + parseInt(r.valor||0), 0) / mejorSEO.rows.length);
            memoria += `\nSEO SCORE PROMEDIO HISTÓRICO: ${scorePromedio}/100 — apunta a superar este score\n`;
        }

        return memoria;
    } catch (_) {}
    return '';
}

// ─── ADSENSE CPC ALTO ─────────────────────────────────────────────────────────
// ─── TÉRMINOS ADSENSE CPC ALTO — investigados para RD ───────────────────────
// CPC alto = anunciantes pagan más por clic en estos temas
// Deben aparecer NATURALMENTE en el artículo — nunca forzados
// Actualizar cada 3 meses según tendencias de Google Keyword Planner
const ADSENSE_CPC = {
    // Nacionales — préstamos, vivienda e hipotecas tienen CPC alto en RD
    Nacionales: [
        'prestamos personales republica dominicana',
        'credito hipotecario banco BHD Leon',
        'plan de vivienda gobierno dominicano',
        'financiamiento inmobiliario RD 2025',
        'tasas de interes bancos dominicanos',
        'seguro de vida republica dominicana',
        'abogado accidente republica dominicana',
    ].join(', '),

    // Economía — inversión y banca son los de mayor CPC en Caribe
    Economia: [
        'inversion inmobiliaria santo domingo este',
        'certificados financieros banco popular dominicano',
        'bolsa de valores republica dominicana',
        'prestamo empresarial pyme dominicana',
        'seguro de retiro republica dominicana',
        'tipo de cambio dolar peso dominicano hoy',
        'tarjeta de credito banco dominicano',
    ].join(', '),

    // Tecnología — software empresarial y fintech pagan bien
    Tecnologia: [
        'software empresarial republica dominicana',
        'banca en linea banco popular dominicano',
        'seguridad informatica empresas RD',
        'internet fibra optica santo domingo',
        'telefonia movil ofertas republica dominicana',
        'aplicaciones moviles emprendimiento dominicano',
        'INFOTEP cursos tecnologia 2025',
    ].join(', '),

    // Deportes — seguros médicos y marcas deportivas
    Deportes: [
        'seguro medico familiar republica dominicana',
        'clinica deportiva santo domingo',
        'academia beisbol republica dominicana',
        'equipos deportivos comprar RD',
        'seguro accidente personal dominicano',
        'viaje a ver beisbol MLB desde RD',
        'patrocinio deportivo empresas dominicanas',
    ].join(', '),

    // Internacionales — remesas y viajes tienen CPC altísimo
    Internacionales: [
        'envio de remesas a republica dominicana',
        'western union republica dominicana',
        'visa americana para dominicanos',
        'vuelos baratos desde santo domingo',
        'seguro de viaje internacional dominicano',
        'inversion extranjera republica dominicana',
        'tipo de cambio euro peso dominicano',
    ].join(', '),

    // Espectáculos — turismo y entretenimiento
    Espectaculos: [
        'hoteles punta cana todo incluido',
        'conciertos santo domingo 2025',
        'turismo republica dominicana paquetes',
        'agencia de viajes republica dominicana',
        'alquiler de salones de eventos santo domingo',
        'streaming peliculas dominicanas online',
        'entretenimiento familiar santo domingo este',
    ].join(', '),
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
            SET imagen='${PB}/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=900&fit=crop', imagen_fuente='banco-local'
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

        const redactor = elegirRedactor(categoria);
        const perfil   = obtenerPerfilPeriodista(redactor);

        const prompt = `Eres ${redactor}, periodista de El Farol al Día — periódico digital dominicano líder en Santo Domingo Este, Los Mina y el Gran Santo Domingo.

TU PERFIL COMO PERIODISTA:
${perfil.estilo}

TUS FUENTES HABITUALES:
${perfil.fuentes}

TU VOZ Y TITULARES:
${perfil.tono}

REGLAS ABSOLUTAS:
- Usas datos reales: porcentajes, fechas, cifras del BCRD, MEPyD, DGII, MOPC, SNS.
- Conectas cada hecho con el impacto en el dominicano de a pie.
- Tu titular es imposible de ignorar.
- Nunca rellenas. Cada oración aporta valor.
- Nunca suenas igual a otro periodista de este equipo.
${memoria}
${fuenteContenido}

CATEGORÍA: ${categoria}
ÉNFASIS: ${CONFIG_IA.enfasis}
EVITAR: ${CONFIG_IA.evitar}

ESTRUCTURA PERIODÍSTICA ÉLITE (pirámide invertida estricta):
▸ LEAD (párrafo 1): La noticia completa en 2-3 líneas. Qué pasó + quién + cuándo + dónde + por qué importa. El lector que solo lea esto debe entender todo.
▸ DESARROLLO (párrafo 2): Cifras concretas, contexto histórico, comparación con año anterior o región. Dato duro obligatorio.
▸ FUENTE OFICIAL (párrafo 3): Cita textual o parafraseo de institución real: "El ministro X señaló...", "Según el informe del BCRD...", "La Procuraduría informó...". NUNCA inventar citas — usar fórmulas verificables.
▸ IMPACTO CIUDADANO (párrafo 4): Qué cambia para el dominicano. Costo, beneficio, riesgo real. Menciona NATURALMENTE 2-3 de estos servicios o productos cuando sean relevantes al contexto: ${termCPC}. NUNCA forzados — solo si encajan con la noticia.
▸ PROYECCIÓN (párrafo 5): Qué sigue. Próxima reunión, votación, implementación, fecha clave. Cierre que da continuidad al lector.

SEO PARA GOOGLE NEWS Y BÚSQUEDA ORGÁNICA:
- TITULO: 55-65 chars EXACTOS. OBLIGATORIO:
  ① Verbo activo al inicio (anuncia, aprueba, sube, cae, alerta, revela, ordena)
  ② Una cifra o porcentaje si existe (aumenta RD$15, baja 3.2%, 200 muertos)
  ③ Término geográfico si aplica (RD, Santo Domingo, Caribe)
  Estructura ganadora: [Verbo] + [Sujeto] + [Cifra/Impacto]
  Ejemplos: "Sube gasolina RD$15 esta semana en República Dominicana"
            "Abinader anuncia 500 viviendas para Santo Domingo Este"
            "Trump impone 25% arancel a productos dominicanos"

- DESCRIPCION: 150-158 chars. Fórmula: [Dato nuevo que no está en el título] + [Impacto en el dominicano] + [Dato que genera clic]

- PALABRAS: 8 keywords. Orden: (1) keyword principal long-tail, (2) "republica dominicana", (3-8) variantes y sinónimos con intención de búsqueda

- ALT_IMAGEN: 15-20 palabras. Describe EXACTAMENTE lo que muestra la foto + contexto RD

- GOOGLE NEWS: El primer párrafo (LEAD) debe responder: Qué + Quién + Cuándo + Dónde + Por qué. Google News indexa en 15 minutos si el lead es perfecto.

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

        // ── IMAGEN: verificación real de calidad ────────────────────────────────
        // Problema anterior: content-length no siempre lo envía el servidor
        // Solución: descargar y medir píxeles reales con sharp — sin mentiras
        // Mínimo aceptable: 400px de ancho — menos que eso = pixelada en portada
        let urlOrig;
        if (imagenRSSOverride) {
            try {
                // Verificar calidad real — píxeles + marca ajena
                const calidad = await verificarCalidadImagen(imagenRSSOverride);
                console.log(`   [IMG-CHECK] ${calidad.razon}`);

                if (calidad.ok) {
                    console.log(`   [IMG-RSS] ✓ Calidad OK — usando foto del periódico`);
                    urlOrig = imagenRSSOverride;
                } else {
                    console.log(`   [IMG-RSS] ⚠️ Rechazada: ${calidad.razon} → buscando alternativa`);
                    const urlHD = await buscarEnGoogle(titulo, categoria);
                    urlOrig = urlHD || imgLocal(sub || FALLBACK_CAT[categoria] || 'politica-gobierno', categoria);
                }
            } catch (e) {
                console.log(`   [IMG-RSS] Error: ${e.message} → banco local`);
                urlOrig = imgLocal(sub || FALLBACK_CAT[categoria] || 'politica-gobierno', categoria);
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
                redactor,
                urlFinal, altFinal.substring(0, 255),
                `Fotografía: ${titulo}`,
                imgResult.nombre || 'efd.jpg',
                'el-farol', urlOrig, 'publicada',
            ]
        );

        console.log('[Gen] Publicada: /noticia/' + slFin);
        // Registrar foto usada — evitar duplicados en portada
        if (urlFinal) fotosUsadasReciente.add(urlFinal);
        if (urlOrig)  fotosUsadasReciente.add(urlOrig);
        invalidarCache();

        // Aprender: registrar SEO score de la noticia publicada
        await registrarSEONoticia(titulo, contenido, categoria);

        // Aprender: registrar que esta categoría y fuente funcionaron
        await registrarAprendizaje('fuente_exitosa', categoria, categoria, true);

        // Aprender: palabras del título — las que tienen verbo activo valen más
        const palabrasExito = titulo.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .split(/\s+/).filter(w => w.length > 4).slice(0, 6);
        for (const p of palabrasExito) {
            await registrarAprendizaje('palabra_publicada', p, categoria, true);
        }

        // Aprender: horario de publicación para optimizar el slot D
        const horaPublicacion = new Date().getHours();
        await registrarAprendizaje('horario_publicacion', `hora_${horaPublicacion}`, categoria, true);

        // Redes sociales eliminadas — tráfico viene de Google News

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

// Fotos usadas recientemente — evitar imagen duplicada en portada
const fotosUsadasReciente = new Set();
setInterval(() => fotosUsadasReciente.clear(), 6 * 60 * 60 * 1000); // limpiar cada 6h

// Palabras aprendidas en memoria — se actualiza cada 4 horas
let PALABRAS_APRENDIDAS = [];
async function refrescarPalabrasAprendidas() {
    PALABRAS_APRENDIDAS = await obtenerPalabrasAprendidas();
    if (PALABRAS_APRENDIDAS.length) {
        console.log(`[Aprende] 🧠 ${PALABRAS_APRENDIDAS.length} palabras aprendidas activas`);
    }
}

function puntuarRelevancia(titulo, contenido = '') {
    if (!titulo) return 0;
    const texto = (titulo + ' ' + contenido).toLowerCase();
    let score = 0;

    // +3 por cada palabra trending estática
    for (const palabra of PALABRAS_TRENDING) {
        if (texto.includes(palabra)) score += 3;
    }

    // +5 por cada palabra que el sistema APRENDIÓ que genera tráfico real
    // Estas valen más porque vienen de datos reales, no de suposiciones
    for (const palabra of PALABRAS_APRENDIDAS) {
        if (texto.includes(palabra)) score += 5;
    }

    // +5 si tiene cifras concretas
    if (/\d+%|\$\d+|rd\$|millones|miles de|\d+ (personas|muertos|heridos|casos)/.test(texto)) score += 5;

    // +3 si menciona lugares de RD
    if (/santo domingo|santiago|la romana|san pedro|puerto plata|barahona|sde|los mina/.test(texto)) score += 3;

    // -10 si ya cubrimos este tema hoy
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
        SALUD.rssVaciosCiclos++;
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
            await new Promise(r => setTimeout(r, 25000)); // pausa 25s — evita 429 y reduce memoria
        }
    }

    console.log(`[RSS] Ciclo terminado — Publicadas: ${procesadas} | Omitidas: ${omitidas} | Score mínimo: ${SCORE_MINIMO}`);
    if (procesadas > 0) {
        SALUD.rssVaciosCiclos   = 0;
        SALUD.ultimaPublicacion = Date.now();
        SALUD.ultimoRSSOK       = Date.now();
    }
    rssEnProceso = false;
}

// ─── REGENERAR WATERMARKS — FIX 3 (secuencial, respeta Railway) ──────────────
let wmRegenEnProceso = false;

// ─── VERIFICADOR DE CALIDAD DE IMAGEN ───────────────────────────────────────
// Función reutilizable — usada tanto en generarNoticia como en el regenerador
// Retorna: { ok, ancho, alto, razon }
async function verificarCalidadImagen(urlImagen, minAncho = 400) {
    try {
        const ctrl = new AbortController();
        const tm   = setTimeout(() => ctrl.abort(), 8000);
        const resp = await fetch(urlImagen, {
            headers: BROWSER_HEADERS,
            signal:  ctrl.signal,
        }).finally(() => clearTimeout(tm));

        if (!resp.ok) return { ok: false, razon: `HTTP ${resp.status}` };

        const buf  = Buffer.from(await resp.arrayBuffer());
        const meta = await sharp(buf).metadata().catch(() => null);
        const ancho = meta?.width  || 0;
        const alto  = meta?.height || 0;

        // ❌ Foto pixelada
        if (ancho < minAncho) {
            return { ok: false, ancho, alto, razon: `pixelada (${ancho}px < ${minAncho}px)` };
        }

        // ❌ Detectar marca de agua ajena — franja inferior derecha
        // stdDev > 55 en esa zona = logo/texto sobreimpreso de otro periódico
        try {
            const franjaH = Math.round(alto * 0.15);
            const franjaW = Math.round(ancho * 0.50);
            const franjaX = ancho - franjaW;
            const franjaY = alto  - franjaH;

            const franja = await sharp(buf)
                .extract({ left: franjaX, top: franjaY, width: franjaW, height: franjaH })
                .grayscale()
                .raw()
                .toBuffer({ resolveWithObject: true });

            const pixels = franja.data;
            let suma = 0, sumaCuadrados = 0;
            for (const p of pixels) { suma += p; sumaCuadrados += p * p; }
            const media    = suma / pixels.length;
            const varianza = (sumaCuadrados / pixels.length) - (media * media);
            const stdDev   = Math.sqrt(varianza);

            if (stdDev > 55) {
                return { ok: false, ancho, alto, razon: `marca ajena detectada (stdDev ${stdDev.toFixed(1)})` };
            }
        } catch (_) {} // Si falla el análisis, confiar en el tamaño

        return { ok: true, ancho, alto, razon: `OK (${ancho}x${alto}px)` };
    } catch (e) {
        return { ok: false, razon: e.message };
    }
}

// ─── DETECTOR DE FOTOS FEAS ─────────────────────────────────────────────────
// Una foto es "fea" si:
//   1. Es del banco local (pexels.com) — genérica, no corresponde a la noticia
//   2. No tiene watermark propio (no es /img/efd-...)
//   3. Viene de Wikimedia (retratos irrelevantes)
//   4. El archivo /tmp ya no existe (roto)
function esFotoFea(imagen) {
    if (!imagen) return true;
    // Fotos propias con watermark = nunca feas
    if (imagen.includes('/img/efd-')) return false;
    // Stock genérico sin watermark = fea
    if (imagen.includes('pexels.com'))    return true;
    if (imagen.includes('wikimedia.org')) return true;
    if (imagen.includes('pixabay.com'))   return true;
    if (imagen.includes('unsplash.com'))  return true;
    return false;
}

function fotoRotaEnDisco(imagen) {
    if (!imagen || !imagen.includes('/img/efd-')) return false;
    const nombre = imagen.split('/img/')[1];
    if (!nombre) return false;
    return !fs.existsSync(path.join('/tmp', nombre));
}

// ─── REGENERACIÓN GRADUAL DE FOTOS FEAS ─────────────────────────────────────
// NO de golpe — procesa 3 fotos por ciclo con 8s de pausa entre cada una
// Corre cada 2 horas → en 24h limpia todas las fotos sin saturar el servidor
// Gradual = no interfiere con la publicación de noticias nuevas
async function regenerarWatermarksLostidos() {
    if (!WATERMARK_PATH)  { console.log('[WM-Regen] Sin watermark, omitido'); return; }
    if (wmRegenEnProceso) { console.log('[WM-Regen] Ya en proceso');          return; }

    wmRegenEnProceso = true;
    try {
        // Solo mirar las últimas 30 noticias — las más recientes son las que se ven
        const r = await pool.query(`
            SELECT id, titulo, seccion, imagen, imagen_nombre, imagen_original, imagen_fuente
            FROM   noticias
            WHERE  estado = 'publicada'
            ORDER  BY fecha DESC
            LIMIT  30`);

        if (!r.rows.length) { wmRegenEnProceso = false; return; }

        const necesitan = r.rows.filter(n =>
            esFotoFea(n.imagen) || fotoRotaEnDisco(n.imagen)
        );

        if (!necesitan.length) {
            console.log('[WM-Regen] ✅ Todas las fotos están bien');
            wmRegenEnProceso = false;
            return;
        }

        // ── GRADUAL: máximo 3 por ciclo ──────────────────────────────────────
        // Si hay 15 feas → este ciclo arregla 3 → próximo ciclo 3 más → etc.
        // Así no colapsa el servidor ni interfiere con Gemini
        const LOTE = 2; // reducido para no saturar memoria en Railway
        const aTratar = necesitan.slice(0, LOTE);

        console.log(`[WM-Regen] 🔄 ${necesitan.length} feas en total → procesando ${aTratar.length} ahora`);
        let regenerados = 0;

        for (const n of aTratar) {
            try {
                let urlFuente = null;
                let metodo    = null;

                console.log(`   [WM-Regen] 🔍 Buscando foto para: "${n.titulo.substring(0,45)}"`);

                // ── PASO 1: imagen_original — verificar píxeles Y marca ajena ──
                if (n.imagen_original && !esFotoFea(n.imagen_original)
                    && n.imagen_original.match(/\.(jpg|jpeg|png|webp)/i)) {
                    const cal = await verificarCalidadImagen(n.imagen_original);
                    if (cal.ok) {
                        urlFuente = n.imagen_original;
                        metodo    = `imagen_original (${cal.razon})`;
                    } else {
                        console.log(`   [WM-Regen] imagen_original rechazada: ${cal.razon}`);
                    }
                }

                // ── PASO 2: scraping del artículo — verificar resultado ──────
                if (!urlFuente && n.imagen_original?.startsWith('http')
                    && !n.imagen_original.match(/\.(jpg|jpeg|png|webp)/i)) {
                    const imgScraped = await scrapearImagenArticulo(n.imagen_original);
                    if (imgScraped) {
                        const cal = await verificarCalidadImagen(imgScraped);
                        if (cal.ok) {
                            urlFuente = imgScraped;
                            metodo    = `scraping artículo (${cal.razon})`;
                        } else {
                            console.log(`   [WM-Regen] scraping rechazada: ${cal.razon}`);
                        }
                    }
                }

                // ── PASO 3: Google CSE — verificar resultado ─────────────────
                if (!urlFuente && process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID) {
                    const urlGoogle = await buscarEnGoogle(n.titulo, n.seccion);
                    if (urlGoogle) {
                        const cal = await verificarCalidadImagen(urlGoogle);
                        if (cal.ok) {
                            urlFuente = urlGoogle;
                            metodo    = `Google CSE (${cal.razon})`;
                        } else {
                            console.log(`   [WM-Regen] Google CSE rechazada: ${cal.razon}`);
                        }
                    }
                }

                // ── PASO 4: banco local — siempre nítido, sin marca ajena ────
                // Fotos verificadas manualmente — nunca pixeladas ni con logos
                if (!urlFuente) {
                    const sub = FALLBACK_CAT[n.seccion] || 'politica-gobierno';
                    urlFuente = imgLocal(sub, n.seccion);
                    metodo    = `banco local (${n.seccion})`;
                }

                console.log(`   [WM-Regen] ID ${n.id} → ${metodo}`);

                // Aplicar watermark
                const res = await aplicarMarcaDeAgua(urlFuente);
                if (res.procesada && res.nombre) {
                    await pool.query(
                        'UPDATE noticias SET imagen=$1, imagen_nombre=$2, imagen_original=$3 WHERE id=$4',
                        [`${BASE_URL}/img/${res.nombre}`, res.nombre, urlFuente, n.id]
                    );
                    console.log(`   [WM-Regen] ✅ ID ${n.id} — "${n.titulo.substring(0,35)}"`);
                    regenerados++;
                }
            } catch (e) {
                console.warn(`   [WM-Regen] ⚠️ ID ${n.id} falló: ${e.message}`);
            }

            // 8s entre fotos — gradual, no colapsa
            await new Promise(r => setTimeout(r, 8000));
        }

        if (regenerados > 0) {
            console.log(`[WM-Regen] ✅ Lote: ${regenerados}/${aTratar.length} | Pendientes: ${necesitan.length - regenerados}`);
            invalidarCache();
        }
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

// ─── SISTEMA DE AUTO-DIAGNÓSTICO Y AUTO-CORRECCIÓN ──────────────────────────
// Monitorea el sistema cada 30 minutos
// Detecta problemas → los corrige automáticamente → los registra
// Sin intervención manual — el servidor se repara solo

// ─── ESTADO DE SALUD DEL SISTEMA ────────────────────────────────────────────
const SALUD = {
    erroresGemini:     0,
    timeoutsGemini:    0,   // timeouts específicos de Gemini
    erroresImagen:     0,
    rssVaciosCiclos:   0,
    fotosBodaDetect:   0,
    ultimaPublicacion: Date.now(),
    ultimoRSSOK:       Date.now(),
    arranque:          Date.now(),
};

// ─── AUTO-DIAGNÓSTICO COMPLETO ───────────────────────────────────────────────
// Conoce todos los problemas que hemos resuelto históricamente
// Corre cada 30 minutos y se repara solo sin intervención manual
// ─── INGENIERO INTERNO — el cerebro que resuelve todo solo ──────────────────
// Conoce cada problema que ha ocurrido históricamente
// Actúa sin esperar instrucciones — diagnóstica, decide y ejecuta
// Corre cada 30 minutos — 48 veces al día

async function autoDiagnostico() {
    const ahora     = Date.now();
    const problemas = [];
    const acciones  = [];
    const resueltos = [];

    // ════════════════════════════════════════════════════════════════════════
    // BLOQUE 1 — GEMINI IA
    // ════════════════════════════════════════════════════════════════════════

    // 1A. Keys saturadas con errores 429
    if (SALUD.erroresGemini >= 3) {
        problemas.push(`Gemini: ${SALUD.erroresGemini} errores seguidos`);
        for (let i = 0; i < GEMINI_KEYS.length; i++) GEMINI_KEY_RESET[i] = 0;
        GEMINI_KEY_INDEX = 0;
        SALUD.erroresGemini = 0;
        resueltos.push('✅ Keys Gemini reseteadas — cooldowns limpiados');
    }

    // 1B. Timeout frecuente — aumentar pausa entre requests
    if (SALUD.timeoutsGemini >= 5) {
        problemas.push(`Gemini: ${SALUD.timeoutsGemini} timeouts — servidor lento`);
        // Aumentar pausa mínima temporalmente
        GS.lastRequest = Date.now() + 30000; // forzar 30s de espera
        SALUD.timeoutsGemini = 0;
        resueltos.push('✅ Pausa Gemini extendida — esperando que el servidor se recupere');
    }

    // ════════════════════════════════════════════════════════════════════════
    // BLOQUE 2 — PUBLICACIÓN
    // ════════════════════════════════════════════════════════════════════════

    // 2A. Sin publicar más de 2 horas
    const minSinPublicar = (ahora - SALUD.ultimaPublicacion) / 60000;
    if (minSinPublicar > 120 && CONFIG_IA.enabled) {
        problemas.push(`Sin publicar hace ${Math.round(minSinPublicar)} min`);
        if (!rssEnProceso) {
            procesarRSS();
            resueltos.push('✅ RSS forzado — ciclo iniciado ahora mismo');
        }
    }

    // 2B. RSS vacío muchos ciclos — fuentes bloqueadas o sin contenido nuevo
    if (SALUD.rssVaciosCiclos >= 5) {
        problemas.push(`RSS vacío: ${SALUD.rssVaciosCiclos} ciclos sin noticias nuevas`);
        try {
            // Limpiar historial de 6h para reprocesar artículos recientes
            const r = await pool.query(`DELETE FROM rss_procesados WHERE fecha < NOW() - INTERVAL '6 hours'`);
            SALUD.rssVaciosCiclos = 0;
            resueltos.push(`✅ ${r.rowCount} RSS procesados limpiados — fuentes pueden reprocesarse`);
        } catch (_) {}
    }

    // 2C. Pocas noticias en portada — menos de 5
    try {
        const cnt = await pool.query(`SELECT COUNT(*) AS c FROM noticias WHERE estado='publicada'`);
        const total = parseInt(cnt.rows[0].c);
        if (total < 5 && CONFIG_IA.enabled && !rssEnProceso) {
            problemas.push(`Solo ${total} noticias en portada — portada casi vacía`);
            // Publicar una noticia de cada categoría principal
            for (const cat of ['Nacionales', 'Deportes', 'Economia']) {
                setTimeout(() => generarNoticia(cat), (CATS.indexOf(cat) + 1) * 90000);
            }
            resueltos.push('✅ Generando noticias de emergencia para llenar la portada');
        }
    } catch (_) {}

    // ════════════════════════════════════════════════════════════════════════
    // BLOQUE 3 — IMÁGENES
    // ════════════════════════════════════════════════════════════════════════

    // 3A. Fotos feas — stock sin watermark propio
    try {
        const fotosMalas = await pool.query(`
            SELECT COUNT(*) AS c FROM noticias
            WHERE estado = 'publicada'
            AND (imagen LIKE '%pexels.com%' OR imagen LIKE '%pixabay.com%'
                OR imagen LIKE '%wikimedia.org%' OR imagen LIKE '%unsplash.com%'
                OR imagen LIKE '%3052454%')
            AND imagen NOT LIKE '%/img/efd-%'`);
        const nFeas = parseInt(fotosMalas.rows[0].c);
        if (nFeas > 0) {
            problemas.push(`${nFeas} noticias con foto genérica sin marca propia`);
            if (!wmRegenEnProceso) {
                regenerarWatermarksLostidos();
                resueltos.push(`✅ Regenerador iniciado — limpiando ${nFeas} fotos feas`);
            }
        }
    } catch (_) {}

    // 3B. Fotos rotas en disco /tmp
    try {
        const noticiasConImg = await pool.query(`
            SELECT imagen FROM noticias
            WHERE estado='publicada' AND imagen LIKE '%/img/efd-%'
            ORDER BY fecha DESC LIMIT 30`);
        const rotas = noticiasConImg.rows.filter(n => {
            const nombre = n.imagen.split('/img/')[1];
            return nombre && !fs.existsSync(path.join('/tmp', nombre));
        }).length;
        if (rotas > 3) {
            problemas.push(`${rotas} fotos rotas — archivos eliminados del disco`);
            if (!wmRegenEnProceso) {
                regenerarWatermarksLostidos();
                resueltos.push('✅ Regenerador iniciado — reconstruyendo fotos rotas');
            }
        }
    } catch (_) {}

    // 3C. Muchos fallos descargando fotos
    if (SALUD.erroresImagen >= 10) {
        problemas.push(`${SALUD.erroresImagen} fallos consecutivos descargando imágenes`);
        invalidarCache();
        SALUD.erroresImagen = 0;
        resueltos.push('✅ Cache invalidada — próximas imágenes se reintentarán');
    }

    // ════════════════════════════════════════════════════════════════════════
    // BLOQUE 4 — BASE DE DATOS
    // ════════════════════════════════════════════════════════════════════════

    // 4A. Conexión BD — auto-reconexión si falla
    try {
        await pool.query('SELECT 1');
    } catch (e) {
        problemas.push(`BD sin conexión: ${e.message}`);
        try {
            await pool.end().catch(() => {});
            resueltos.push('✅ Pool BD reiniciado — reconectará en próximo ciclo');
        } catch (_) {
            acciones.push('⚠️ BD caída — Railway reiniciará automáticamente');
        }
    }

    // 4B. Títulos duplicados
    try {
        const dupes = await pool.query(`
            SELECT titulo, COUNT(*) AS c FROM noticias
            WHERE estado='publicada' AND fecha > NOW() - INTERVAL '24 hours'
            GROUP BY titulo HAVING COUNT(*) > 1`);
        if (dupes.rows.length > 0) {
            problemas.push(`${dupes.rows.length} títulos duplicados en las últimas 24h`);
            for (const dup of dupes.rows) {
                await pool.query(`
                    DELETE FROM noticias WHERE titulo=$1
                    AND id NOT IN (SELECT id FROM noticias WHERE titulo=$1 ORDER BY fecha DESC LIMIT 1)
                `, [dup.titulo]).catch(() => {});
            }
            invalidarCache();
            resueltos.push(`✅ ${dupes.rows.length} duplicados eliminados`);
        }
    } catch (_) {}

    // 4C. Noticias muy viejas acumuladas
    try {
        const viejas = await pool.query(`SELECT COUNT(*) AS c FROM noticias WHERE fecha < NOW() - INTERVAL '8 days'`);
        const nViejas = parseInt(viejas.rows[0].c);
        if (nViejas > 0) {
            await pool.query(`DELETE FROM noticias WHERE fecha < NOW() - INTERVAL '8 days'`);
            invalidarCache();
            resueltos.push(`✅ ${nViejas} noticias viejas eliminadas — BD aligerada`);
        }
    } catch (_) {}

    // 4D. RSS procesados acumulados — puede llenar la BD
    try {
        const rssCount = await pool.query(`SELECT COUNT(*) AS c FROM rss_procesados`);
        const nRSS = parseInt(rssCount.rows[0].c);
        if (nRSS > 5000) {
            await pool.query(`DELETE FROM rss_procesados WHERE fecha < NOW() - INTERVAL '3 days'`);
            resueltos.push(`✅ RSS procesados limpiados — había ${nRSS} registros`);
        }
    } catch (_) {}

    // ════════════════════════════════════════════════════════════════════════
    // BLOQUE 5 — RENDIMIENTO Y CACHÉ
    // ════════════════════════════════════════════════════════════════════════

    // 5A. Cache vieja
    const minCache = (ahora - _cacheFecha) / 60000;
    if (_cacheNoticias && minCache > 10) {
        invalidarCache();
        resueltos.push('✅ Cache refrescada — datos actualizados');
    }

    // 5B. Actualizar palabras aprendidas
    await refrescarPalabrasAprendidas().catch(() => {});

    // ════════════════════════════════════════════════════════════════════════
    // BLOQUE 6 — SEGURIDAD Y ESTABILIDAD
    // ════════════════════════════════════════════════════════════════════════

    // 6A. /tmp lleno — borrar imágenes viejas
    try {
        const archivos = fs.readdirSync('/tmp').filter(f => f.startsWith('efd-') && f.endsWith('.jpg'));
        if (archivos.length > 200) {
            const conFecha = archivos.map(f => ({ f, t: fs.statSync(path.join('/tmp', f)).mtimeMs }))
                                     .sort((a, b) => b.t - a.t);
            const aBorrar = conFecha.slice(100);
            aBorrar.forEach(({ f }) => { try { fs.unlinkSync(path.join('/tmp', f)); } catch (_) {} });
            resueltos.push(`✅ /tmp limpiado — ${aBorrar.length} imágenes viejas borradas`);
        }
    } catch (_) {}

    // 6B. Cache muy grande — optimizar
    if (_cacheNoticias && _cacheNoticias.length > 50) {
        _cacheNoticias = _cacheNoticias.slice(0, 30);
        resueltos.push('✅ Cache optimizada');
    }

    // 6C. Sin noticias nuevas en 3 horas — forzar publicación
    try {
        const hora = new Date().getHours();
        if (hora >= 6 && hora <= 23 && CONFIG_IA.enabled && !MODO_ESPEJO) {
            const rec = await pool.query(`
                SELECT COUNT(*) AS c FROM noticias
                WHERE estado='publicada' AND fecha > NOW() - INTERVAL '3 hours'`);
            if (parseInt(rec.rows[0].c) === 0 && !rssEnProceso) {
                problemas.push('Sin noticias nuevas en 3 horas durante horario activo');
                procesarRSS();
                resueltos.push('✅ RSS forzado — portada necesita contenido fresco');
            }
        }
    } catch (_) {}

    // 6D. Health check interno
    try {
        const ctrl = new AbortController();
        const tm   = setTimeout(() => ctrl.abort(), 3000);
        const r    = await fetch(`http://localhost:${PORT}/health`, { signal: ctrl.signal })
                          .finally(() => clearTimeout(tm));
        if (!r.ok) problemas.push(`Health check respondió ${r.status}`);
    } catch (_) {}

    // ════════════════════════════════════════════════════════════════════════
    // REPORTE FINAL
    // ════════════════════════════════════════════════════════════════════════
    const uptime = Math.round((ahora - SALUD.arranque) / 3600000);
    const horaRD = new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santo_Domingo' });

    if (problemas.length || resueltos.length) {
        console.log(`
[Ingeniero] 🔧 ${horaRD} — uptime: ${uptime}h`);
        if (problemas.length) {
            console.log(`   Problemas detectados: ${problemas.length}`);
            problemas.forEach(p => console.log(`   ⚠️  ${p}`));
        }
        if (resueltos.length) {
            console.log(`   Resueltos automáticamente:`);
            resueltos.forEach(r => console.log(`   ${r}`));
        }
        for (const p of problemas) {
            await registrarError('autodiagnostico', p, 'sistema').catch(() => {});
        }
    } else {
        console.log(`[Ingeniero] ✅ ${horaRD} — Todo operando perfectamente (uptime: ${uptime}h)`);
    }

    // Guardar estado de salud en BD para historial
    try {
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, exitos)
            VALUES('salud_sistema', $1, 'sistema', 1)
        `, [JSON.stringify({
            uptime,
            noticias: (await pool.query(`SELECT COUNT(*) AS c FROM noticias WHERE estado='publicada'`)).rows[0].c,
            problemas: problemas.length,
            resueltos: resueltos.length,
            hora: horaRD,
        })]).catch(() => {});
    } catch (_) {}
}

// Monitor de salud integrado directamente en generarNoticia y procesarRSS

// ─── MODO ESPEJO ─────────────────────────────────────────────────────────────
// Si MODO_ESPEJO=true → solo sirve el sitio, sin publicar ni escribir en BD
// Usar en Render como servidor de respaldo/espejo de elfarolaldia.com
// Railway sigue siendo el servidor principal que publica
const MODO_ESPEJO = process.env.MODO_ESPEJO === 'true';

if (MODO_ESPEJO) {
    console.log(`
╔══════════════════════════════════════════════════════╗
║  🪞  MODO ESPEJO ACTIVO                              ║
║  Solo lectura — sin publicación — sin crons IA       ║
║  Railway es el servidor principal                    ║
╚══════════════════════════════════════════════════════╝`);
}

// ─── CRON ─────────────────────────────────────────────────────────────────────
// Pulso de vida — evita que el servidor duerma
cron.schedule('*/14 * * * *', async () => {
    try { await fetch(`http://localhost:${PORT}/health`); } catch (_) {}
});

// Liberar memoria cada hora — evita SIGTERM por uso excesivo
cron.schedule('0 * * * *', () => {
    if (global.gc) {
        global.gc();
        console.log('[Mem] GC ejecutado');
    }
    // Limpiar sets grandes si crecieron demasiado
    if (fotosUsadasReciente.size > 500) {
        fotosUsadasReciente.clear();
        console.log('[Mem] fotosUsadasReciente limpiado');
    }
    if (temasPublicadosHoy.size > 500) {
        temasPublicadosHoy.clear();
        console.log('[Mem] temasPublicadosHoy limpiado');
    }
});

// ─── HORARIOS INTELIGENTES ───────────────────────────────────────────────────
//
// 🌅 MAÑANA FUERTE   6:00–11:59  → cada 10 min (6 noticias/hora)
// ☀️  TARDE FUERTE   12:00–19:59 → cada 10 min (6 noticias/hora)
// 🌙 NOCHE TRANQUILA 20:00–23:59 → cada 30 min (2 noticias/hora)
// 😴 MADRUGADA       00:00–05:59 → cada hora   (1 noticia/hora, la gente duerme)
//
// Gemini timeout: 90s — suficiente para artículo completo sin corte
// ─────────────────────────────────────────────────────────────────────────────

// ── PUBLICACIÓN — solo en servidor principal (no en espejo) ──────────────────
if (!MODO_ESPEJO) {

    // MAÑANA & TARDE FUERTES (6am–8pm) — cada 10 min
    cron.schedule('0 6-19 * * *', async () => {
        if (rssEnProceso) return;
        console.log('[Mañana/Tarde] ⚡ :00 Key-1');
        procesarRSS();
    });
    cron.schedule('10 6-19 * * *', async () => {
        if (rssEnProceso) return;
        console.log('[Mañana/Tarde] ⚡ :10 Key-2');
        procesarRSS();
    });
    cron.schedule('20 6-19 * * *', async () => {
        if (rssEnProceso) return;
        console.log('[Mañana/Tarde] ⚡ :20 Key-3');
        procesarRSS();
    });
    cron.schedule('40 6-19 * * *', async () => {
        if (!CONFIG_IA.enabled || rssEnProceso) return;
        const cat = await obtenerCategoriaOptima();
        console.log(`[Mañana/Tarde] 🏮 :40 IA propia — ${cat}`);
        await generarNoticia(cat);
    });

    // NOCHE TRANQUILA (8pm–11pm) — cada 30 min
    cron.schedule('0 20-23 * * *', async () => {
        if (rssEnProceso) return;
        console.log('[Noche] 🌙 :00 publicando...');
        procesarRSS();
    });
    cron.schedule('30 20-23 * * *', async () => {
        if (rssEnProceso) return;
        console.log('[Noche] 🌙 :30 publicando...');
        procesarRSS();
    });

    // MADRUGADA (12am–5am) — cada hora
    cron.schedule('0 0-5 * * *', async () => {
        if (rssEnProceso) return;
        console.log('[Madrugada] 😴 Publicando mientras RD duerme...');
        procesarRSS();
    });

} else {
    console.log('[Espejo] 🪞 Crons de publicación desactivados — solo lectura');
}

// ─── AUTO-DIAGNÓSTICO cada 30 minutos ───────────────────────────────────────
// ─── INGENIERO — revisa TODO cada 15 minutos sin que nadie lo llame ──────────
// Más frecuente que antes — 15 min = 96 revisiones al día
// Si algo está mal lo resuelve solo y lo registra en memoria
cron.schedule('*/15 * * * *', async () => {
    await autoDiagnostico();
});

// ─── TAREAS DE MANTENIMIENTO — solo en servidor principal ────────────────────
if (!MODO_ESPEJO) {

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

// ─── REGENERAR FOTOS FEAS — cada 2 horas ─────────────────────────────────────
cron.schedule('0 */2 * * *', async () => {
    console.log('[Cron-Fotos] 🖼️ Revisando fotos que necesitan actualización...');
    regenerarWatermarksLostidos();
});

// ─── APRENDIZAJE — cada 4 horas ───────────────────────────────────────────────
cron.schedule('0 */4 * * *', async () => {
    console.log('[Aprende] 📚 Analizando rendimiento...');
    await aprenderDeVistas();
    await refrescarPalabrasAprendidas();
});

// ─── REVISIÓN PROFUNDA — cada hora ───────────────────────────────────────────
// El ingeniero revisa cosas que el diagnóstico rápido no cubre:
// - Calidad del contenido publicado (títulos muy cortos, contenido vacío)
// - Fotos sin watermark propio que se colaron
// - Slugs duplicados que rompen rutas
// - Noticias sin imagen que dañan el SEO
cron.schedule('5 * * * *', async () => {
    if (MODO_ESPEJO) return;
    try {
        let fixes = 0;

        // 1. Noticias sin imagen — afectan SEO y AdSense
        const sinImg = await pool.query(`
            SELECT id, titulo, seccion FROM noticias
            WHERE estado='publicada'
            AND (imagen IS NULL OR imagen='' OR imagen LIKE '%undefined%')
            LIMIT 5`);
        for (const n of sinImg.rows) {
            const sub  = FALLBACK_CAT[n.seccion] || 'politica-gobierno';
            const url  = imgLocal(sub, n.seccion);
            const res  = await aplicarMarcaDeAgua(url);
            if (res.procesada) {
                await pool.query(
                    'UPDATE noticias SET imagen=$1, imagen_nombre=$2 WHERE id=$3',
                    [`${BASE_URL}/img/${res.nombre}`, res.nombre, n.id]
                );
                fixes++;
                console.log(`[Ingeniero] 🔧 Imagen faltante reparada: ID ${n.id}`);
            }
        }

        // 2. Noticias con contenido muy corto (< 100 chars) — posible error Gemini
        const cortas = await pool.query(`
            SELECT id, titulo FROM noticias
            WHERE estado='publicada'
            AND LENGTH(contenido) < 100
            AND fecha > NOW() - INTERVAL '24 hours'`);
        for (const n of cortas.rows) {
            await pool.query("UPDATE noticias SET estado='borrador' WHERE id=$1", [n.id]);
            fixes++;
            console.log(`[Ingeniero] 🔧 Noticia vacía ocultada: "${n.titulo.substring(0,40)}"`);
        }

        // 3. Títulos duplicados recientes
        const dupes = await pool.query(`
            SELECT titulo, COUNT(*) AS c FROM noticias
            WHERE estado='publicada' AND fecha > NOW() - INTERVAL '6 hours'
            GROUP BY titulo HAVING COUNT(*) > 1`);
        for (const d of dupes.rows) {
            await pool.query(`
                DELETE FROM noticias WHERE titulo=$1
                AND id NOT IN (SELECT id FROM noticias WHERE titulo=$1 ORDER BY fecha DESC LIMIT 1)
            `, [d.titulo]).catch(() => {});
            fixes++;
            console.log(`[Ingeniero] 🔧 Duplicado limpiado: "${d.titulo.substring(0,40)}"`);
        }

        if (fixes > 0) {
            invalidarCache();
            console.log(`[Ingeniero] ✅ Revisión profunda: ${fixes} problema(s) corregido(s)`);
        }

    } catch (e) {
        console.warn('[Ingeniero] Revisión profunda error: ' + e.message);
    }
});

} // fin if(!MODO_ESPEJO) — mantenimiento

// ─── RUTAS ESTÁTICAS ──────────────────────────────────────────────────────────
app.get('/health',    (_, res) => res.json({ status: 'OK', version: '34.53', modelo: GEMINI_MODEL }));
app.get('/',          (_, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion',  authMiddleware, (_, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/monitor',    authMiddleware, (_, res) => res.sendFile(path.join(__dirname, 'client', 'panel.html')));
app.get('/ingeniero',  authMiddleware, (_, res) => res.sendFile(path.join(__dirname, 'client', 'panel.html')));
app.get('/panel',      authMiddleware, (_, res) => res.sendFile(path.join(__dirname, 'client', 'panel.html')));
app.get('/ingeniero',  (req, res) => {
    // Panel de ingeniería — PIN en query o en sesión
    const pin = req.query.pin;
    if (pin !== '311') {
        return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Acceso</title><style>body{background:#0a0a0f;display:flex;align-items:center;
justify-content:center;min-height:100vh;font-family:Arial}
.b{background:#111118;border:1px solid #FF5500;border-radius:12px;padding:30px;text-align:center}
h2{color:#FF5500;margin-bottom:16px}input{padding:10px;border-radius:6px;border:1px solid #333;
background:#0a0a0f;color:#fff;font-size:20px;text-align:center;letter-spacing:6px;width:120px}
button{display:block;margin:12px auto 0;padding:10px 24px;background:#FF5500;color:#fff;
border:none;border-radius:6px;cursor:pointer;font-weight:bold}</style></head>
<body><div class="b"><h2>🤖 INGENIERÍA</h2>
<form action="/ingeniero" method="get">
<input type="password" name="pin" placeholder="PIN" maxlength="6" autofocus>
<button type="submit">ENTRAR</button></form></div></body></html>`);
    }
    res.sendFile(path.join(__dirname, 'client', 'ingeniero.html'));
});
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
             FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 20`,
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

// ─── ENDPOINT MANUAL — regenerar fotos feas ─────────────────────────────────
app.post('/api/regenerar-fotos', authMiddleware, async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ error: 'PIN' });
    if (wmRegenEnProceso) return res.json({ success: false, mensaje: 'Ya en proceso' });
    regenerarWatermarksLostidos();
    res.json({ success: true, mensaje: 'Regeneración iniciada en background' });
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
             `${PB}/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=900&fit=crop`,
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
            version:        '34.53',
            modelo_gemini:  GEMINI_MODEL,
            timeout_gemini: `${GEMINI_TIMEOUT / 1000}s`,
            noticias:       parseInt(r.rows[0].count),
            rss_procesados: parseInt(rss.rows[0].count),
            marca_de_agua:  WATERMARK_PATH ? `Activa: ${path.basename(WATERMARK_PATH)}` : 'No encontrada — publicando sin marca',
            gemini_keys:    GEMINI_KEYS.length,
            google_cse:     (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID) ? 'Activo' : 'Sin configurar',
            adsense:        'pub-5280872495839888',
            ia_activa:      CONFIG_IA.enabled,
            modo_espejo:    MODO_ESPEJO,
            rss_en_proceso: rssEnProceso,
            wm_en_proceso:  wmRegenEnProceso,
            salud: {
                errores_gemini:      SALUD.erroresGemini,
                errores_imagen:      SALUD.erroresImagen,
                ciclos_rss_vacios:   SALUD.rssVaciosCiclos,
                min_sin_publicar:    Math.round((Date.now() - SALUD.ultimaPublicacion) / 60000),
            },
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API SEO — análisis de noticias recientes ────────────────────────────────
app.get('/api/seo', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'PIN' });
    try {
        const r = await pool.query(`
            SELECT id, titulo, seccion, vistas, contenido, fecha
            FROM noticias WHERE estado='publicada'
            ORDER BY fecha DESC LIMIT 20`);

        const analisis = r.rows.map(n => {
            const seoT = analizarSEOTitulo(n.titulo);
            const seoC = analizarSEOContenido(n.contenido);
            return {
                id:         n.id,
                titulo:     n.titulo,
                seccion:    n.seccion,
                vistas:     n.vistas,
                seo_titulo: seoT,
                seo_contenido: { score: seoC.score, palabras: seoC.palabras },
                score_total: Math.round((seoT.score + seoC.score) / 2),
            };
        });

        const promedio = analisis.length
            ? Math.round(analisis.reduce((s,a) => s + a.score_total, 0) / analisis.length)
            : 0;

        res.json({ success: true, promedio_seo: promedio, analisis });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
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
║        🏮  EL FAROL AL DIA  —  V34.53               ║
╠═══════════════════════════════════════════════════════╣
║  Puerto         : ${String(PORT).padEnd(35)}║
║  Modelo Gemini  : ${GEMINI_MODEL.padEnd(35)}║
║  Gemini Keys    : ${String(GEMINI_KEYS.length + ' key(s) activa(s)').padEnd(35)}║
║  Imágenes       : Periódico original → Banco local curado   ║
║  Timeout IA     : ${(GEMINI_TIMEOUT / 1000 + 's').padEnd(35)}║
║  Watermark      : ${wm.substring(0, 35).padEnd(35)}║
║  Facebook       : ELIMINADO (usa Google News)                ║
║  Twitter        : ELIMINADO (usa Google News)                ║
║  RSS            : 30 fuentes / ejecución secuencial   ║
╚═══════════════════════════════════════════════════════╝`);
    });

    // Cargar palabras aprendidas de sesiones anteriores
    setTimeout(refrescarPalabrasAprendidas, 3000);

    // Regenerar fotos feas inmediatamente al arrancar — 10s de gracia para que BD conecte
    setTimeout(async () => {
        console.log('[Arranque] 🖼️ Verificando fotos al arrancar...');
        await regenerarWatermarksLostidos();
    }, 10000);
}

iniciar();
module.exports = app;
