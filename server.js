// 🏮 CONFIG MXL - TODAS LAS CONSTANTES CENTRALIZADAS
const path = require('path');
const fs = require('fs');

// ══════════════════════════════════════════════════════════
// 🔑 VARIABLES DE ENTORNO
// ══════════════════════════════════════════════════════════
const ENV = {
    DATABASE_URL: process.env.DATABASE_URL,
    PORT: process.env.PORT || 8080,
    BASE_URL: process.env.BASE_URL || 'https://elfarolaldia.com',
    
    // Gemini - 4 llaves rotativas
    GEMINI_KEYS: [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY2,
        process.env.GEMINI_API_KEY3,
        process.env.GEMINI_API_KEY4
    ].filter(Boolean),
    
    // DeepSeek fallback
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || null,
    
    // Google CSE
    CSE_KEYS: [process.env.GOOGLE_CSE_KEY, process.env.GOOGLE_CSE_KEY_2].filter(Boolean),
    CSE_CX: process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CSE_CX || '',
    
    // APIs imágenes
    PEXELS_API_KEY: process.env.PEXELS_API_KEY || null,
    UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY || null,
    
    // Social Media
    FB_PAGE_ID: process.env.FB_PAGE_ID || null,
    FB_PAGE_TOKEN: process.env.FB_PAGE_TOKEN || null,
    TWITTER_API_KEY: process.env.TWITTER_API_KEY || null,
    TWITTER_API_SECRET: process.env.TWITTER_API_SECRET || null,
    TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN || null,
    TWITTER_ACCESS_SECRET: process.env.TWITTER_ACCESS_SECRET || null,
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || null,
    
    // Web Push
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || null,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || null,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:alertas@elfarolaldia.com',
    
    // Auth
    ADMIN_PIN: '311',
    ADMIN_USER: 'director'
};

// ══════════════════════════════════════════════════════════
// 🏮 CONSTANTES DE SDE (calles, barrios, frases)
// ══════════════════════════════════════════════════════════
const BARRIOS_SDE = [
    'Los Mina', 'Invivienda', 'Charles de Gaulle', 'Ensanche Ozama',
    'Sabana Perdida', 'Villa Mella', 'El Almirante', 'Mendoza',
    'Los Trinitarios', 'San Isidro', 'Carretera Mella', 'Sabana Larga'
];

const CALLES_SDE = [
    'Av. Venezuela', 'Carretera Mella', 'Sabana Larga', 'Av. Las Américas',
    'Av. San Vicente de Paúl', 'Calle Principal Los Mina', 'Entrada de las Palmas'
];

const FRASES_BARRIO = [
    'se armó el avispero', 'la gente está en grito', 'se supo de buena fuente',
    'según los vecinos del sector', 'fue confirmado', 'los residentes dicen',
    'en el barrio se comenta', 'los del sector están alborotados'
];

// ══════════════════════════════════════════════════════════
// 📁 RUTAS FIJAS
// ══════════════════════════════════════════════════════════
const RUTAS = {
    WATERMARK: (() => {
        const variantes = ['watermark.png', 'WATERMARK(1).png', 'watermark(1).png', 'watermark (1).png', 'WATERMARK.png'];
        const bases = [path.join(process.cwd(), 'static'), path.join(__dirname, 'static')];
        for (const base of bases) {
            for (const nombre of variantes) {
                const ruta = path.join(base, nombre);
                if (fs.existsSync(ruta)) return ruta;
            }
        }
        return null;
    })(),
    TMP_DIR: '/tmp'
};

// ══════════════════════════════════════════════════════════
// 🖼️ BANCO LOCAL DE IMÁGENES
// ══════════════════════════════════════════════════════════
const PB = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';

const BANCO_LOCAL = {
    'politica-gobierno': [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`, `${PB}/290595/pexels-photo-290595.jpeg${OPT}`],
    'seguridad-policia': [`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`, `${PB}/5699456/pexels-photo-5699456.jpeg${OPT}`],
    'economia-mercado': [`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`, `${PB}/6772070/pexels-photo-6772070.jpeg${OPT}`],
    'deporte-general': [`${PB}/863988/pexels-photo-863988.jpeg${OPT}`, `${PB}/936094/pexels-photo-936094.jpeg${OPT}`],
    'tecnologia': [`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`, `${PB}/2582937/pexels-photo-2582937.jpeg${OPT}`],
    'cultura-musica': [`${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`, `${PB}/1540406/pexels-photo-1540406.jpeg${OPT}`]
};

const CAT_FALLBACK = {
    'Nacionales': 'politica-gobierno', 'Deportes': 'deporte-general',
    'Internacionales': 'politica-gobierno', 'Economía': 'economia-mercado',
    'Tecnología': 'tecnologia', 'Espectáculos': 'cultura-musica'
};

// ══════════════════════════════════════════════════════════
// 📋 CATEGORÍAS Y RSS
// ══════════════════════════════════════════════════════════
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];
const CATEGORIAS_ALTO_CPM = ['Economía', 'Tecnología', 'Internacionales'];

const FUENTES_RSS = [
    { url: 'https://presidencia.gob.do/feed', categoria: 'Nacionales', nombre: 'Presidencia RD' },
    { url: 'https://policia.gob.do/feed', categoria: 'Nacionales', nombre: 'Policía Nacional' },
    { url: 'https://listindiario.com/feed', categoria: 'Nacionales', nombre: 'Listín Diario' }
];

// ══════════════════════════════════════════════════════════
// 🎯 PROMPT PRINCIPAL (BLINDADO)
// ══════════════════════════════════════════════════════════
function getPromptBase() {
    return `Eres el Redactor Jefe de "El Farol al Día", el periódico de Santo Domingo Este.
Tu misión es escribir noticias reales, impactantes y con "calle".

🎯 REGLAS DE ORO:
1. EXTENSIÓN: Obligatorio 8 a 10 párrafos. Mínimo 800 caracteres.
2. CALLES REALES: Usa lugares de SDE como ${CALLES_SDE.slice(0, 4).join(', ')}.
3. BARRIOS: Menciona al menos uno: ${BARRIOS_SDE.slice(0, 6).join(', ')}.
4. AMBIENTE: Describe calor, ruido de motores, colmados, gente en la acera.
5. FRASES DOMINICANAS: Usa "${FRASES_BARRIO.slice(0, 3).join('", "')}".
6. PÁRRAFOS: Máximo 3 líneas. Optimizado celular.
7. Primera oración = GANCHO DIRECTO. Sin "En el día de hoy".

RESPONDE EXACTAMENTE ASÍ (sin texto extra, sin asteriscos):
TITULO: [impactante, 65 chars max]
DESCRIPCION: [150-160 chars SEO]
PALABRAS: [5 keywords separadas por comas]
SUBTEMA_LOCAL: [categoría del banco de imágenes]
CONTENIDO:
[8-10 párrafos con ambiente de barrio]`;
}

module.exports = {
    ENV, BARRIOS_SDE, CALLES_SDE, FRASES_BARRIO, RUTAS,
    BANCO_LOCAL, CAT_FALLBACK, PB, OPT,
    CATEGORIAS, CATEGORIAS_ALTO_CPM, FUENTES_RSS,
    getPromptBase
};// 🏮 MOTORES IA - GEMINI ROTATIVO + DEEPSEEK FALLBACK
const { ENV } = require('./config-mxl');

// ══════════════════════════════════════════════════════════
// 🔄 ESTADO DE LLAVES
// ══════════════════════════════════════════════════════════
const keyState = {};

function getKeyState(key) {
    if (!keyState[key]) keyState[key] = { lastRequest: 0, resetTime: 0 };
    return keyState[key];
}

// ══════════════════════════════════════════════════════════
// 🤖 GEMINI (rotación de 4 llaves)
// ══════════════════════════════════════════════════════════
async function callGemini(apiKey, prompt, intento) {
    const st = getKeyState(apiKey);
    const ahora = Date.now();
    if (ahora < st.resetTime) await new Promise(r => setTimeout(r, st.resetTime - ahora));
    if (Date.now() - st.lastRequest < 8000) await new Promise(r => setTimeout(r, 8000));
    st.lastRequest = Date.now();

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.85, maxOutputTokens: 3000 }
        }),
        signal: AbortSignal.timeout(45000)
    });

    if (res.status === 429) {
        st.resetTime = Date.now() + Math.min(60000 + Math.pow(2, intento) * 10000, 300000);
        throw new Error('RATE_LIMIT');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) throw new Error('Respuesta vacía');
    return texto;
}

// ══════════════════════════════════════════════════════════
// 🔁 ROTADOR PRINCIPAL
// ══════════════════════════════════════════════════════════
async function llamarGemini(prompt, reintentos = 2) {
    if (!ENV.GEMINI_KEYS.length) throw new Error('Sin llaves Gemini');
    
    for (let i = 0; i < reintentos; i++) {
        for (const llave of ENV.GEMINI_KEYS) {
            try {
                return await callGemini(llave, prompt, i);
            } catch (err) {
                if (err.message === 'RATE_LIMIT') continue;
                console.error(`    ❌ Gemini: ${err.message}`);
            }
        }
        if (i < reintentos - 1) await new Promise(r => setTimeout(r, 15000));
    }
    
    // 🔁 FALLBACK A DEEPSEEK si está configurado
    if (ENV.DEEPSEEK_API_KEY) {
        console.log('    🔁 Fallback a DeepSeek...');
        try {
            const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ENV.DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.85,
                    max_tokens: 3000
                }),
                signal: AbortSignal.timeout(45000)
            });
            const data = await res.json();
            if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
        } catch (err) { console.error('    ❌ DeepSeek falló:', err.message); }
    }
    
    throw new Error('Todas las IA fallaron');
}

// ══════════════════════════════════════════════════════════
// 🖼️ GEMINI PARA IMÁGENES (más permisivo)
// ══════════════════════════════════════════════════════════
async function llamarGeminiImagen(prompt) {
    if (!ENV.GEMINI_KEYS.length) return null;
    for (const llave of ENV.GEMINI_KEYS) {
        try {
            return await callGemini(llave, prompt, 0);
        } catch (err) {
            if (err.message === 'RATE_LIMIT') continue;
            return null;
        }
    }
    return null;
}

module.exports = { llamarGemini, llamarGeminiImagen };// 🏮 WATERMARK - APLICACIÓN DE MARCA DE AGUA
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { RUTAS, ENV } = require('./config-mxl');

async function aplicarMarcaDeAgua(urlImagen) {
    if (!RUTAS.WATERMARK_PATH || !fs.existsSync(RUTAS.WATERMARK_PATH)) {
        return { url: urlImagen, procesada: false };
    }
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(urlImagen, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (!response.ok) return { url: urlImagen, procesada: false };
        
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('image/')) return { url: urlImagen, procesada: false };
        
        const bufOrig = Buffer.from(await response.arrayBuffer());
        if (bufOrig.length < 5000) return { url: urlImagen, procesada: false };
        
        const metadata = await sharp(bufOrig).metadata().catch(() => null);
        if (!metadata || !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format)) {
            return { url: urlImagen, procesada: false };
        }
        
        const w = metadata.width || 800, h = metadata.height || 500;
        const wmAncho = Math.min(Math.round(w * 0.28), 300);
        const wmResized = await sharp(RUTAS.WATERMARK_PATH).resize(wmAncho, null, { fit: 'inside' }).toBuffer();
        const wmMeta = await sharp(wmResized).metadata();
        const wmAlto = wmMeta.height || 60;
        const margen = Math.round(w * 0.02);
        
        const bufFinal = await sharp(bufOrig)
            .composite([{
                input: wmResized,
                left: Math.max(0, w - wmAncho - margen),
                top: Math.max(0, h - wmAlto - margen),
                blend: 'over'
            }])
            .jpeg({ quality: 85 })
            .toBuffer();
        
        const nombre = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
        fs.writeFileSync(path.join(RUTAS.TMP_DIR, nombre), bufFinal);
        
        return { url: urlImagen, nombre, procesada: true };
    } catch (err) {
        return { url: urlImagen, procesada: false };
    }
}

module.exports = { aplicarMarcaDeAgua };// 🏮 BASE DE DATOS - TODAS LAS CONSULTAS
const { Pool } = require('pg');
const { ENV } = require('./config-mxl');

const pool = new Pool({
    connectionString: ENV.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ══════════════════════════════════════════════════════════
// 📰 NOTICIAS
// ══════════════════════════════════════════════════════════
async function getNoticias(limite = 30) {
    const r = await pool.query(
        'SELECT id,titulo,slug,seccion,imagen,imagen_alt,seo_description,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT $2',
        ['publicada', limite]
    );
    return r.rows;
}

async function getNoticiaBySlug(slug) {
    const r = await pool.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2', [slug, 'publicada']);
    return r.rows[0];
}

async function incrementarVistas(id) {
    await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [id]);
}

async function crearNoticia(data) {
    const { titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, imagen, imagen_alt, imagen_caption, imagen_nombre, imagen_fuente, imagen_original } = data;
    const r = await pool.query(
        `INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'publicada') RETURNING id`,
        [titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, imagen, imagen_alt, imagen_caption, imagen_nombre, imagen_fuente, imagen_original]
    );
    return r.rows[0];
}

async function existeSlug(slug) {
    const r = await pool.query('SELECT id FROM noticias WHERE slug=$1', [slug]);
    return r.rows.length > 0;
}

async function eliminarNoticia(id) {
    await pool.query('DELETE FROM noticias WHERE id=$1', [id]);
}

// ══════════════════════════════════════════════════════════
// 🧠 MEMORIA IA
// ══════════════════════════════════════════════════════════
async function getTitulosRecientes(limite = 25) {
    const r = await pool.query(
        'SELECT titulo, seccion FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT $2',
        ['publicada', limite]
    );
    return r.rows;
}

async function getErroresRecientes(categoria) {
    const r = await pool.query(
        `SELECT valor FROM memoria_ia WHERE tipo=$1 AND categoria=$2 
         AND ultima_vez > NOW() - INTERVAL '24 hours' ORDER BY fallos DESC LIMIT 5`,
        ['error', categoria]
    );
    return r.rows;
}

async function registrarError(descripcion, categoria) {
    await pool.query(
        `INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES('error',$1,$2,1) ON CONFLICT DO NOTHING`,
        [descripcion.substring(0, 200), categoria]
    );
}

// ══════════════════════════════════════════════════════════
// 💬 COMENTARIOS
// ══════════════════════════════════════════════════════════
async function getComentarios(noticia_id) {
    const r = await pool.query(
        'SELECT id,nombre,texto,fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC',
        [noticia_id]
    );
    return r.rows;
}

async function crearComentario(noticia_id, nombre, texto) {
    const r = await pool.query(
        'INSERT INTO comentarios(noticia_id,nombre,texto) VALUES($1,$2,$3) RETURNING id,nombre,texto,fecha',
        [noticia_id, nombre.substring(0, 80), texto.substring(0, 1000)]
    );
    return r.rows[0];
}

// ══════════════════════════════════════════════════════════
// 📢 PUBLICIDAD
// ══════════════════════════════════════════════════════════
async function getPublicidadActiva() {
    const r = await pool.query(
        'SELECT id,nombre_espacio,url_afiliado,imagen_url,ubicacion,ancho_px,alto_px FROM publicidad WHERE activo=true ORDER BY id ASC'
    );
    return r.rows;
}

// ══════════════════════════════════════════════════════════
// 📱 PUSH SUSCRIPCIONES
// ══════════════════════════════════════════════════════════
async function getSuscriptoresPush() {
    const r = await pool.query(
        'SELECT endpoint, auth_key, p256dh_key FROM push_suscripciones WHERE endpoint IS NOT NULL ORDER BY ultima_notificacion NULLS FIRST'
    );
    return r.rows;
}

async function guardarSuscripcionPush(endpoint, auth, p256dh, userAgent) {
    await pool.query(
        `INSERT INTO push_suscripciones(endpoint,auth_key,p256dh_key,user_agent) 
         VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET auth_key=$2,p256dh_key=$3,user_agent=$4,fecha=CURRENT_TIMESTAMP`,
        [endpoint, auth, p256dh, userAgent || null]
    );
}

async function eliminarSuscripcionPush(endpoint) {
    await pool.query('DELETE FROM push_suscripciones WHERE endpoint=$1', [endpoint]);
}

async function actualizarUltimaNotificacion(endpoint) {
    await pool.query('UPDATE push_suscripciones SET ultima_notificacion=NOW() WHERE endpoint=$1', [endpoint]);
}

// ══════════════════════════════════════════════════════════
// 📊 ESTADÍSTICAS
// ══════════════════════════════════════════════════════════
async function getEstadisticas() {
    const r = await pool.query('SELECT COUNT(*) as c, SUM(vistas) as v FROM noticias WHERE estado=$1', ['publicada']);
    return { totalNoticias: parseInt(r.rows[0].c), totalVistas: parseInt(r.rows[0].v) || 0 };
}

// ══════════════════════════════════════════════════════════
// 🏗️ INICIALIZACIÓN
// ══════════════════════════════════════════════════════════
async function inicializarDB() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS noticias(
            id SERIAL PRIMARY KEY, titulo VARCHAR(255), slug VARCHAR(255) UNIQUE,
            seccion VARCHAR(100), contenido TEXT, seo_description VARCHAR(160),
            seo_keywords VARCHAR(255), redactor VARCHAR(100), imagen TEXT,
            imagen_alt VARCHAR(255), imagen_caption TEXT, imagen_nombre VARCHAR(100),
            imagen_fuente VARCHAR(50), vistas INTEGER DEFAULT 0,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP, estado VARCHAR(50) DEFAULT 'publicada'
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS memoria_ia(
            id SERIAL PRIMARY KEY, tipo VARCHAR(50), valor TEXT,
            categoria VARCHAR(100), exitos INTEGER DEFAULT 0,
            fallos INTEGER DEFAULT 0, ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS comentarios(
            id SERIAL PRIMARY KEY, noticia_id INTEGER REFERENCES noticias(id) ON DELETE CASCADE,
            nombre VARCHAR(80), texto TEXT, aprobado BOOLEAN DEFAULT true,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS publicidad(
            id SERIAL PRIMARY KEY, nombre_espacio VARCHAR(100), url_afiliado TEXT,
            imagen_url TEXT, ubicacion VARCHAR(50), activo BOOLEAN DEFAULT true,
            ancho_px INTEGER DEFAULT 0, alto_px INTEGER DEFAULT 0
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS push_suscripciones(
            id SERIAL PRIMARY KEY, endpoint TEXT UNIQUE, auth_key TEXT,
            p256dh_key TEXT, user_agent TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ultima_notificacion TIMESTAMP
        )`);
        
        console.log('✅ DB lista');
    } finally { client.release(); }
}

module.exports = {
    pool,
    inicializarDB,
    getNoticias,
    getNoticiaBySlug,
    incrementarVistas,
    crearNoticia,
    existeSlug,
    eliminarNoticia,
    getTitulosRecientes,
    getErroresRecientes,
    registrarError,
    getComentarios,
    crearComentario,
    getPublicidadActiva,
    getSuscriptoresPush,
    guardarSuscripcionPush,
    eliminarSuscripcionPush,
    actualizarUltimaNotificacion,
    getEstadisticas
};// 🏮 EL FAROL AL DÍA — SERVIDOR PRINCIPAL (MODULARIZADO)
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const webPush = require('web-push');
const { ENV, getPromptBase, CATEGORIAS, FUENTES_RSS, PB, OPT, BANCO_LOCAL, CAT_FALLBACK } = require('./config-mxl');
const { llamarGemini, llamarGeminiImagen } = require('./motores-ia');
const { aplicarMarcaDeAgua } = require('./watermark');
const db = require('./db');
const { leerEstrategia } = require('./estrategia-loader');
const { analizarYGenerar } = require('./estrategia-analyzer');

const app = express();
const BASE_URL = ENV.BASE_URL;

// ══════════════════════════════════════════════════════════
// 🔒 MIDDLEWARES
// ══════════════════════════════════════════════════════════
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).send('Acceso denegado');
    const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user === ENV.ADMIN_USER && pass === ENV.ADMIN_PIN) return next();
    res.status(401).send('Credenciales incorrectas');
}

// ══════════════════════════════════════════════════════════
// 📱 WEB PUSH
// ══════════════════════════════════════════════════════════
if (ENV.VAPID_PUBLIC_KEY && ENV.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(ENV.VAPID_SUBJECT, ENV.VAPID_PUBLIC_KEY, ENV.VAPID_PRIVATE_KEY);
}

async function enviarPush(titulo, cuerpo, slug, imagen) {
    if (!ENV.VAPID_PUBLIC_KEY) return false;
    const subs = await db.getSuscriptoresPush();
    if (!subs.length) return false;
    
    const payload = JSON.stringify({
        title: titulo.substring(0, 80),
        body: cuerpo.substring(0, 120),
        icon: imagen || `${BASE_URL}/static/favicon.png`,
        data: { url: `${BASE_URL}/noticia/${slug}` }
    });
    
    let ok = 0;
    for (const sub of subs) {
        try {
            await webPush.sendNotification({ endpoint: sub.endpoint, keys: { auth: sub.auth_key, p256dh: sub.p256dh_key } }, payload);
            await db.actualizarUltimaNotificacion(sub.endpoint);
            ok++;
        } catch (err) {
            if (err.statusCode === 410) await db.eliminarSuscripcionPush(sub.endpoint);
        }
    }
    return ok > 0;
}

// ══════════════════════════════════════════════════════════
// 📰 GENERAR NOTICIA (NUCLEO)
// ══════════════════════════════════════════════════════════
function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[ñ]/g, 'n').replace(/[^a-z0-9\s-]/g, '').trim()
        .replace(/\s+/g, '-').substring(0, 75);
}

function validarContenido(contenido) {
    if (!contenido || contenido.length < 700) return { valido: false, razon: 'Contenido insuficiente (mínimo 700 chars)' };
    const barrios = ['Los Mina', 'Invivienda', 'Charles de Gaulle', 'Ensanche Ozama', 'Sabana Perdida', 'Villa Mella'];
    const tieneBarrio = barrios.some(b => contenido.toLowerCase().includes(b.toLowerCase()));
    if (!tieneBarrio) return { valido: false, razon: 'No menciona barrios de SDE' };
    const frases = ['se supo', 'vecinos dicen', 'se armó', 'de buena fuente', 'está en grito'];
    const tieneFrase = frases.some(f => contenido.toLowerCase().includes(f));
    if (!tieneFrase) return { valido: false, razon: 'Falta lenguaje de barrio' };
    return { valido: true };
}

async function generarNoticia(categoria) {
    console.log(`\n📰 Generando ${categoria}...`);
    
    const recientes = await db.getTitulosRecientes(20);
    const memoria = recientes.map(r => `- ${r.titulo} [${r.seccion}]`).join('\n');
    const estrategia = leerEstrategia();
    
    const prompt = `${getPromptBase()}
    
⛔ TEMAS RECIENTES (NO REPETIR):
${memoria}

CATEGORÍA: ${categoria}
${estrategia}

RESPONDE EXACTAMENTE EN EL FORMATO INDICADO:`;

    const respuesta = await llamarGemini(prompt);
    
    let titulo = '', desc = '', palabras = '', subtema = '', contenido = '';
    let enContenido = false;
    for (const linea of respuesta.split('\n')) {
        const t = linea.trim();
        if (t.startsWith('TITULO:')) titulo = t.replace('TITULO:', '').trim();
        else if (t.startsWith('DESCRIPCION:')) desc = t.replace('DESCRIPCION:', '').trim();
        else if (t.startsWith('PALABRAS:')) palabras = t.replace('PALABRAS:', '').trim();
        else if (t.startsWith('SUBTEMA_LOCAL:')) subtema = t.replace('SUBTEMA_LOCAL:', '').trim();
        else if (t.startsWith('CONTENIDO:')) enContenido = true;
        else if (enContenido && t.length) contenido += t + '\n';
    }
    
    const validacion = validarContenido(contenido);
    if (!validacion.valido) throw new Error(validacion.razon);
    
    const slugBase = slugify(titulo);
    let slug = slugBase;
    if (await db.existeSlug(slugBase)) slug = `${slugBase}-${Date.now().toString().slice(-6)}`;
    
    const imgUrl = BANCO_LOCAL[subtema]?.[0] || BANCO_LOCAL[CAT_FALLBACK[categoria]]?.[0] || `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`;
    const imgConMarca = await aplicarMarcaDeAgua(imgUrl);
    const imgFinal = imgConMarca.procesada ? `${BASE_URL}/img/${imgConMarca.nombre}` : imgUrl;
    
    await db.crearNoticia({
        titulo, slug, seccion: categoria, contenido: contenido.substring(0, 10000),
        seo_description: desc.substring(0, 160), seo_keywords: palabras || categoria,
        redactor: 'Redacción EFD', imagen: imgFinal, imagen_alt: titulo,
        imagen_caption: `Fotografía: ${titulo}`, imagen_nombre: imgConMarca.nombre || 'efd.jpg',
        imagen_fuente: imgConMarca.procesada ? 'watermark' : 'pexels', imagen_original: imgUrl
    });
    
    await enviarPush(titulo, desc, slug, imgFinal);
    console.log(`✅ /noticia/${slug}`);
    return { success: true, slug };
}

// ══════════════════════════════════════════════════════════
// 🌐 RUTAS API
// ══════════════════════════════════════════════════════════
app.get('/api/noticias', async (req, res) => {
    res.json({ success: true, noticias: await db.getNoticias() });
});

app.get('/api/estadisticas', async (req, res) => {
    res.json(await db.getEstadisticas());
});

app.post('/api/generar-noticia', authMiddleware, async (req, res) => {
    const r = await generarNoticia(req.body.categoria);
    res.json(r);
});

app.post('/api/publicar', authMiddleware, async (req, res) => {
    const { titulo, seccion, contenido } = req.body;
    if (!titulo || !contenido) return res.status(400).json({ error: 'Faltan campos' });
    const slug = slugify(titulo);
    await db.crearNoticia({ titulo, slug, seccion, contenido, redactor: 'Manual', imagen: `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}` });
    res.json({ success: true, slug });
});

app.post('/api/eliminar/:id', authMiddleware, async (req, res) => {
    await db.eliminarNoticia(req.params.id);
    res.json({ success: true });
});

app.get('/api/comentarios/:noticia_id', async (req, res) => {
    res.json({ success: true, comentarios: await db.getComentarios(req.params.noticia_id) });
});

app.post('/api/comentarios/:noticia_id', async (req, res) => {
    const { nombre, texto } = req.body;
    if (!nombre?.trim() || !texto?.trim()) return res.status(400).json({ error: 'Campos requeridos' });
    const comentario = await db.crearComentario(req.params.noticia_id, nombre, texto);
    res.json({ success: true, comentario });
});

app.get('/api/publicidad/activos', async (req, res) => {
    res.json({ success: true, anuncios: await db.getPublicidadActiva() });
});

app.post('/api/push/suscribir', async (req, res) => {
    const { subscription, userAgent } = req.body;
    await db.guardarSuscripcionPush(subscription.endpoint, subscription.keys.auth, subscription.keys.p256dh, userAgent);
    res.json({ success: true });
});

app.get('/api/push/vapid-key', (req, res) => {
    res.json({ publicKey: ENV.VAPID_PUBLIC_KEY });
});

app.get('/api/estrategia', authMiddleware, (req, res) => {
    const ruta = path.join(__dirname, 'estrategia.json');
    if (fs.existsSync(ruta)) res.json(JSON.parse(fs.readFileSync(ruta)));
    else res.json({ mensaje: 'Aún no generada' });
});

app.get('/status', async (req, res) => {
    res.json({ status: 'OK', version: 'MXL-35.3-MODULAR', noticias: (await db.getNoticias()).length });
});

// ══════════════════════════════════════════════════════════
// 🖼️ IMÁGENES CON WATERMARK
// ══════════════════════════════════════════════════════════
app.get('/img/:nombre', (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.sendFile(ruta);
    } else res.status(404).send('No encontrada');
});

// ══════════════════════════════════════════════════════════
// 📄 PÁGINAS
// ══════════════════════════════════════════════════════════
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/noticia/:slug', async (req, res) => {
    const noticia = await db.getNoticiaBySlug(req.params.slug);
    if (!noticia) return res.status(404).send('Noticia no encontrada');
    await db.incrementarVistas(noticia.id);
    let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
    html = html.replace(/{{TITULO}}/g, noticia.titulo).replace(/{{CONTENIDO}}/g, noticia.contenido.split('\n').map(p => `<p>${p}</p>`).join(''));
    res.send(html);
});

// ══════════════════════════════════════════════════════════
// ⏰ CRON JOBS
// ══════════════════════════════════════════════════════════
cron.schedule('0 */2 * * *', () => {
    const hora = new Date().getHours();
    const cat = CATEGORIAS[Math.floor(hora / 2) % CATEGORIAS.length];
    generarNoticia(cat).catch(console.error);
});

cron.schedule('0 */6 * * *', () => {
    analizarYGenerar().catch(console.error);
});

// ══════════════════════════════════════════════════════════
// 🚀 ARRANQUE
// ══════════════════════════════════════════════════════════
async function start() {
    await db.inicializarDB();
    app.listen(ENV.PORT, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — MXL EDITION (MODULAR)            ║
╠══════════════════════════════════════════════════════════╣
║  ✅ Código reducido a menos de la mitad                 ║
║  ✅ 4 llaves Gemini rotativas + DeepSeek fallback       ║
║  ✅ Prompt blindado: 8-10 párrafos, calles SDE          ║
║  ✅ Estrategia inyectada automáticamente                ║
║  ✅ Editable desde celular                              ║
║  ✅ Listo para Railway                                  ║
╚══════════════════════════════════════════════════════════╝
        `);
    });
    setTimeout(() => generarNoticia(CATEGORIAS[0]).catch(()=>{}), 30000);
}

start();
module.exports = app;
