/**
 * 🏮 EL FAROL AL DÍA — V34.4-WEBP
 * FIXES:
 *   1. Ruta /api/noticias explícita y robusta
 *   2. Self-ping keep-alive para Railway (evita cold start)
 *   3. Timeout de DB con fallback
 *   4. Manejo de errores mejorado en generarNoticia
 *   5. Ruta /noticia/:slug para páginas individuales
 *   6. Proxy /api/imagen con Sharp → WebP 800px/75%
 *   7. generarNoticia guarda URLs a través del proxy
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
    return res.status(401).send('Credenciales incorrectas.');
}

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ══════════════════════════════════════════════════════════
// 🗄️ BASE DE DATOS
// ══════════════════════════════════════════════════════════
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Error conectando a PostgreSQL:', err.message);
    } else {
        console.log('✅ PostgreSQL conectado correctamente');
        release();
    }
});

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || null;

// WATERMARK PATH
const WATERMARK_PATH = (() => {
    const variantes = ['watermark.png', 'WATERMARK.png', 'static/watermark.png'];
    for (const v of variantes) {
        const p = path.join(process.cwd(), v);
        if (fs.existsSync(p)) return p;
    }
    return null;
})();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ══════════════════════════════════════════════════════════
// 🔑 MOTOR GEMINI — ROTACIÓN & RESILIENCIA
// ══════════════════════════════════════════════════════════
const GEMINI_STATE = {};
function getKeyState(key) {
    if (!GEMINI_STATE[key]) GEMINI_STATE[key] = { lastRequest: 0, resetTime: 0 };
    return GEMINI_STATE[key];
}

async function _callGemini(apiKey, prompt, intentoGlobal) {
    const st = getKeyState(apiKey);
    const ahora = Date.now();
    if (ahora < st.resetTime) {
        const espera = st.resetTime - ahora;
        await new Promise(r => setTimeout(r, Math.min(espera, 15000)));
    }
    const desde = Date.now() - st.lastRequest;
    if (desde < 3000) await new Promise(r => setTimeout(r, 3000 - desde));
    st.lastRequest = Date.now();

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 4000 }
        }),
        signal: AbortSignal.timeout(35000)
    });

    if (res.status === 429) {
        const b = Math.min(Math.pow(2, intentoGlobal) * 5000, 60000);
        st.resetTime = Date.now() + b;
        throw new Error('RATE_LIMIT_429');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function llamarGemini(prompt, reintentos = 3) {
    const hora = new Date().getHours();
    const esPar = hora % 2 === 0;
    const grupoA = [process.env.GEMINI_API_KEY, process.env.GEMINI_KEY_2].filter(Boolean);
    const grupoB = [process.env.GEMINI_KEY_3, process.env.GEMINI_KEY_4].filter(Boolean);
    const activo = esPar ? grupoA : grupoB;
    const rescate = esPar ? grupoB : grupoA;

    for (const grupo of [activo, rescate]) {
        if (!grupo.length) continue;
        for (let i = 0; i < reintentos; i++) {
            for (const key of grupo) {
                try { return await _callGemini(key, prompt, i); }
                catch (e) { if (e.message !== 'RATE_LIMIT_429') console.error(e.message); }
            }
        }
    }
    throw new Error('Gemini falló en todos los grupos.');
}

// ══════════════════════════════════════════════════════════
// 🏙️ FILTRO DE IMÁGENES — EDICIÓN ALTO CPM
// ══════════════════════════════════════════════════════════
const PALABRAS_BASURA_REDUCIDO = ['wedding','bride','groom','romantic','love','kiss','marriage','cartoon','3d render','clipart','pet','dog','cat','birthday cake','balloon','flowers','bouquet'];
const PALABRAS_BASURA_COMPLETO = [...PALABRAS_BASURA_REDUCIDO,'sale','black friday','discount','offer','promo','abstract','wallpaper','texture','pattern','illustration','fashion','model'];
const CATEGORIAS_ALTO_CPM = ['Economía','Tecnología','Internacionales'];

// ══════════════════════════════════════════════════════════
// 🛠️ UTILS
// ══════════════════════════════════════════════════════════
function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ñ]/g,'n').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').substring(0, 75);
}

// ══════════════════════════════════════════════════════════
// 🖼️ PROCESAMIENTO DE IMÁGENES CON SHARP
// ══════════════════════════════════════════════════════════
async function buscarEnPexels(queries, categoria = '') {
    if (!PEXELS_API_KEY) return null;
    const lista = CATEGORIAS_ALTO_CPM.includes(categoria)
        ? PALABRAS_BASURA_REDUCIDO
        : PALABRAS_BASURA_COMPLETO;

    for (const q of queries) {
        if (lista.some(p => q.toLowerCase().includes(p))) continue;
        try {
            const res = await fetch(
                `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=5&orientation=landscape`,
                { headers: { Authorization: PEXELS_API_KEY } }
            );
            const data = await res.json();
            if (data.photos?.length) {
                const urlOriginal = data.photos[0].src.large2x;
                // Devolver URL envuelta en el proxy para procesamiento WebP al vuelo
                return `/api/imagen?url=${encodeURIComponent(urlOriginal)}`;
            }
        } catch (e) { continue; }
    }
    return null;
}

const IMAGEN_FALLBACK = 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=800';

// ══════════════════════════════════════════════════════════
// 🔄 PROXY /api/imagen — WebP 800px / 75% al vuelo
// ══════════════════════════════════════════════════════════
app.get('/api/imagen', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL requerida');

    const permitidos = ['pexels.com', 'images.pexels.com', 'upload.wikimedia.org', 'cdn.pixabay.com'];
    const esPermitido = permitidos.some(d => url.includes(d));
    if (!esPermitido) return res.status(403).send('Dominio no permitido');

    try {
        const upstream = await fetch(url, {
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'ElFarolAlDia/1.0' }
        });
        if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
        const buffer = Buffer.from(await upstream.arrayBuffer());

        const webp = await sharp(buffer)
            .resize({ width: 800, withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer();

        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Optimized', 'sharp-webp-800px-75q');
        res.send(webp);
    } catch (e) {
        console.error('❌ /api/imagen error:', e.message);
        res.redirect(url);
    }
});

// ══════════════════════════════════════════════════════════
// ✅ RUTA /api/noticias ROBUSTA
// ══════════════════════════════════════════════════════════
app.get('/api/noticias', async (req, res) => {
    try {
        const { categoria, limit = 50 } = req.query;

        let query = `
            SELECT id, titulo, slug, seccion, contenido,
                   imagen, imagen_alt, seo_description, vistas, fecha
            FROM noticias
            WHERE estado = 'publicada'
              AND slug IS NOT NULL AND slug != ''
              AND titulo IS NOT NULL AND titulo != ''
        `;
        const params = [];

        if (categoria) {
            params.push(categoria);
            query += ` AND seccion = $${params.length}`;
        }

        query += ` ORDER BY fecha DESC LIMIT $${params.length + 1}`;
        params.push(Math.min(parseInt(limit) || 50, 200));

        const result = await pool.query(query, params);

        const noticias = result.rows.map(n => ({
            ...n,
            imagen: n.imagen || `/api/imagen?url=${encodeURIComponent(IMAGEN_FALLBACK)}`,
            vistas: n.vistas || 0,
        }));

        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json({ success: true, total: noticias.length, noticias });

    } catch (e) {
        console.error('❌ /api/noticias error:', e.message);
        res.status(500).json({ success: false, error: 'Error cargando noticias', detalle: e.message });
    }
});

// ══════════════════════════════════════════════════════════
// 📄 RUTA INDIVIDUAL DE NOTICIA
// ══════════════════════════════════════════════════════════
app.get('/noticia/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const r = await pool.query(
            `SELECT * FROM noticias WHERE slug = $1 AND estado = 'publicada' LIMIT 1`,
            [slug]
        );
        if (!r.rows.length) return res.status(404).sendFile(path.join(__dirname, 'client', '404.html'));

        pool.query(`UPDATE noticias SET vistas = COALESCE(vistas,0) + 1 WHERE slug = $1`, [slug]).catch(() => {});

        res.sendFile(path.join(__dirname, 'client', 'index.html'));
    } catch (e) {
        console.error('❌ /noticia/:slug error:', e.message);
        res.status(500).send('Error cargando noticia');
    }
});

// API para obtener datos de una noticia individual
app.get('/api/noticia/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const r = await pool.query(
            `SELECT * FROM noticias WHERE slug = $1 AND estado = 'publicada' LIMIT 1`,
            [slug]
        );
        if (!r.rows.length) return res.status(404).json({ success: false, error: 'Noticia no encontrada' });

        const noticia = {
            ...r.rows[0],
            imagen: r.rows[0].imagen || `/api/imagen?url=${encodeURIComponent(IMAGEN_FALLBACK)}`
        };
        res.json({ success: true, noticia });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ══════════════════════════════════════════════════════════
// 📰 GENERACIÓN DE NOTICIAS
// ══════════════════════════════════════════════════════════
async function generarNoticia(categoria) {
    const esAlta = CATEGORIAS_ALTO_CPM.includes(categoria);
    const prompt = `ROL: Editor Jefe de El Farol al Día, periódico digital dominicano. Escribe una noticia profesional de 2026 para República Dominicana.
CATEGORIA: ${categoria}
${esAlta ? 'REGLA ALTO CPM: Incluye cifras USD/RD$, vocabulario de inversión y datos de 2026. Extensión 550 palabras.' : 'Extensión 450 palabras.'}

FORMATO EXACTO (respeta las etiquetas):
TITULO: [60-70 caracteres, sin comillas]
DESCRIPCION: [150-160 caracteres SEO]
PALABRAS: [5 keywords separadas por coma]
CONTENIDO:
[5 párrafos bien redactados, pirámide invertida, sin markdown]`;

    try {
        const resIA = await llamarGemini(prompt);
        if (!resIA) throw new Error('Gemini no devolvió texto');

        const tituloMatch = resIA.match(/TITULO:\s*(.+)/);
        const descripcionMatch = resIA.match(/DESCRIPCION:\s*(.+)/);
        const contenidoMatch = resIA.split('CONTENIDO:')[1];

        if (!tituloMatch || !contenidoMatch) throw new Error('Formato Gemini inválido');

        const titulo = tituloMatch[1].trim().replace(/^["']|["']$/g, '');
        const descripcion = descripcionMatch?.[1]?.trim() || '';
        const contenido = contenidoMatch.trim();

        const slugBase = slugify(titulo);
        if (!slugBase) throw new Error('Slug vacío');
        const slugFinal = `${slugBase}-${Date.now().toString().slice(-6)}`;

        // Buscar imagen — se guarda como URL del proxy /api/imagen
        const urlImagen = await buscarEnPexels(
            [`${titulo} news`, `${categoria} Dominican Republic 2026`, `${categoria} noticias`],
            categoria
        ) || `/api/imagen?url=${encodeURIComponent(IMAGEN_FALLBACK)}`;

        await pool.query(
            `INSERT INTO noticias(titulo, slug, seccion, contenido, seo_description, imagen, estado, fecha, vistas)
             VALUES($1, $2, $3, $4, $5, $6, 'publicada', NOW(), 0)`,
            [titulo, slugFinal, categoria, contenido, descripcion, urlImagen]
        );

        console.log(`✅ Publicada [${categoria}]: /noticia/${slugFinal}`);
    } catch (e) {
        console.error(`❌ Error generarNoticia [${categoria}]:`, e.message);
    }
}

// ══════════════════════════════════════════════════════════
// 🛰️ SITEMAP DINÁMICO
// ══════════════════════════════════════════════════════════
app.get('/sitemap.xml', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT slug, fecha FROM noticias WHERE estado='publicada' AND slug IS NOT NULL AND slug!='' ORDER BY fecha DESC LIMIT 1000`
        );
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;
        for (const n of r.rows) {
            const slug = encodeURIComponent(n.slug).replace(/%2F/g, '/');
            const d = (Date.now() - new Date(n.fecha).getTime()) / 86400000;
            const freq = d < 1 ? 'hourly' : d < 7 ? 'daily' : 'weekly';
            const prio = d < 1 ? '1.0' : d < 7 ? '0.9' : '0.5';
            xml += `<url><loc>${BASE_URL}/noticia/${slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>${freq}</changefreq><priority>${prio}</priority></url>\n`;
        }
        xml += '</urlset>';
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=1800');
        res.send(xml);
    } catch (e) { res.status(500).send('Error generando sitemap'); }
});

// ══════════════════════════════════════════════════════════
// 📋 PANEL DE REDACCIÓN (protegido)
// ══════════════════════════════════════════════════════════
app.get('/redaccion', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

app.post('/api/generar', authMiddleware, async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.json({ success: false, error: 'Categoría requerida' });
    generarNoticia(categoria).catch(console.error);
    res.json({ success: true, mensaje: `Generando noticia de ${categoria}...` });
});

// ══════════════════════════════════════════════════════════
// 🔧 RUTAS DE UTILIDAD
// ══════════════════════════════════════════════════════════
app.get('/ads.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        version: '34.4-WEBP',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        db: pool.totalCount > 0 ? 'connected' : 'idle',
        sharp: 'enabled',
        webp: '800px/75q'
    });
});

app.get('/robots.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /redaccion\nDisallow: /api/\nSitemap: ${BASE_URL}/sitemap.xml\n`);
});

// Fallback SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ══════════════════════════════════════════════════════════
// ⏰ CRON JOBS
// ══════════════════════════════════════════════════════════
const CATS_CRON = ['Economía','Nacionales','Tecnología','Deportes','Internacionales','Espectáculos'];
let cronIndex = 0;
cron.schedule('0 * * * *', () => {
    const cat = CATS_CRON[cronIndex % CATS_CRON.length];
    cronIndex++;
    console.log(`⏰ CRON: Generando noticia de ${cat}`);
    generarNoticia(cat);
});

// ══════════════════════════════════════════════════════════
// ✅ SELF-PING KEEP-ALIVE (evita Railway cold start)
// ══════════════════════════════════════════════════════════
function iniciarKeepAlive() {
    const INTERVALO = 4 * 60 * 1000;
    setInterval(async () => {
        try {
            const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(10000) });
            if (res.ok) console.log(`🏓 Keep-alive OK [${new Date().toLocaleTimeString('es-DO')}]`);
        } catch (e) {
            console.warn('⚠️ Keep-alive falló:', e.message);
        }
    }, INTERVALO);
    console.log(`🏓 Keep-alive activado (cada 4 min → ${BASE_URL}/health)`);
}

// ══════════════════════════════════════════════════════════
// 🚀 INICIO
// ══════════════════════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏮 ══════════════════════════════════════════`);
    console.log(`   EL FAROL AL DÍA — V34.4-WEBP`);
    console.log(`   Puerto: ${PORT}`);
    console.log(`   URL: ${BASE_URL}`);
    console.log(`   Sharp: WebP 800px / 75% calidad`);
    console.log(`🏮 ══════════════════════════════════════════\n`);

    if (process.env.NODE_ENV !== 'development') {
        iniciarKeepAlive();
    }
});

module.exports = app;
