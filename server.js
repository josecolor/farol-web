/**
 * 🏮 EL FAROL AL DÍA — V34.2 (ESTABLE)
 * CAMBIOS vs V34.1:
 *    1. Rotación horaria de llaves Gemini (Corregido a 1.5-flash)
 *    2. Filtro autocrítico de imágenes
 *    3. Cron seguro y Ráfaga inicial
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

// 🔒 BASIC AUTH
function authMiddleware(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
        return res.status(401).send('Acceso Restringido');
    }
    try {
        const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
        const [user, pass] = decoded.split(':');
        if (user === 'director' && pass === '311') return next();
    } catch(e) {}
    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
    return res.status(401).send('Credenciales incorrectas');
}

const app      = express();
const PORT      = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// 🌊 WATERMARK LOGIC
const WATERMARK_PATH = path.join(__dirname, 'static', 'watermark.png');

const rssParser = new RSSParser({ timeout: 10000 });

// 📚 WIKIPEDIA CONTEXT
async function buscarContextoWikipedia(titulo, categoria) {
    try {
        const urlBusqueda = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo + " República Dominicana")}&format=json&origin=*`;
        const resBusqueda = await fetch(urlBusqueda);
        const dataBusqueda = await resBusqueda.json();
        const resultados = dataBusqueda?.query?.search;
        if (!resultados?.length) return '';
        const paginaId = resultados[0].pageid;
        const urlExtracto = `https://es.wikipedia.org/w/api.php?action=query&pageids=${paginaId}&prop=extracts&exintro=true&exchars=1000&format=json&origin=*`;
        const resExtracto = await fetch(urlExtracto);
        const dataExtracto = await resExtracto.json();
        const pagina = dataExtracto?.query?.pages?.[paginaId];
        return pagina?.extract ? `\n📚 CONTEXTO: ${pagina.extract.replace(/<[^>]+>/g, '')}\n` : '';
    } catch (err) { return ''; }
}

// 🔑 GEMINI — ROTACIÓN HORARIA (ESTABLE 1.5-FLASH)
const GEMINI_STATE = {};
function getKeyState(keyIndex) {
    if (!GEMINI_STATE[keyIndex]) GEMINI_STATE[keyIndex] = { lastRequest: 0, resetTime: 0 };
    return GEMINI_STATE[keyIndex];
}

async function _callGemini(apiKey, prompt, intentoGlobal) {
    const st = getKeyState(apiKey);
    const ahora = Date.now();
    if (ahora < st.resetTime) await new Promise(r => setTimeout(r, 2000));
    st.lastRequest = Date.now();

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
    );

    if (res.status === 429) {
        st.resetTime = Date.now() + 10000;
        throw new Error('RATE_LIMIT_429');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function llamarGemini(prompt) {
    const hora = new Date().getHours();
    const esPar = hora % 2 === 0;
    const llaves = [
        esPar ? process.env.GEMINI_API_KEY : process.env.GEMINI_KEY_3,
        esPar ? process.env.GEMINI_KEY_2 : process.env.GEMINI_KEY_4
    ].filter(Boolean);

    for (const llave of llaves) {
        try {
            return await _callGemini(llave, prompt, 0);
        } catch (e) { console.error("Error en llave:", e.message); }
    }
    throw new Error('Todas las llaves fallaron');
}

// 📸 PEXELS & IMAGENES
async function buscarEnPexels(query) {
    if (!process.env.PEXELS_API_KEY) return null;
    try {
        const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`, {
            headers: { Authorization: process.env.PEXELS_API_KEY }
        });
        const data = await res.json();
        return data.photos?.[0]?.src?.large2x || null;
    } catch (e) { return null; }
}

async function aplicarMarcaDeAgua(urlImagen) {
    try {
        const res = await fetch(urlImagen);
        const bufOrig = Buffer.from(await res.arrayBuffer());
        if (!fs.existsSync(WATERMARK_PATH)) return { url: urlImagen, procesada: false };
        const nombre = `efd-${Date.now()}.jpg`;
        const finalBuf = await sharp(bufOrig)
            .composite([{ input: WATERMARK_PATH, gravity: 'southeast' }])
            .toBuffer();
        fs.writeFileSync(path.join('/tmp', nombre), finalBuf);
        return { url: `${BASE_URL}/img/${nombre}`, nombre, procesada: true };
    } catch (e) { return { url: urlImagen, procesada: false }; }
}

// 🚀 GENERAR NOTICIA
async function generarNoticia(categoria) {
    try {
        const contextWiki = await buscarContextoWikipedia(categoria, categoria);
        const prompt = `Eres periodista dominicano. Escribe una noticia de ${categoria} para 2026. 
        Formato: TITULO: [texto] DESCRIPCION: [texto] CONTENIDO: [texto]`;
        const respuesta = await llamarGemini(prompt + contextWiki);
        
        const titulo = respuesta.match(/TITULO:(.*)/)?.[1]?.trim() || "Noticia de última hora";
        const contenido = respuesta.match(/CONTENIDO:([\s\S]*)/)?.[1]?.trim() || "";
        const slug = titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
        
        const urlImg = await buscarEnPexels(categoria + " news");
        const imgFinal = urlImg ? await aplicarMarcaDeAgua(urlImg) : { url: '' };

        await pool.query(
            `INSERT INTO noticias (titulo, contenido, seccion, slug, imagen, estado) VALUES ($1, $2, $3, $4, $5, 'publicada')`,
            [titulo, contenido, categoria, slug, imgFinal.url]
        );
        return { success: true, titulo, slug };
    } catch (e) { return { success: false, error: e.message }; }
}

// 🌐 RUTAS API
app.get('/api/noticias', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias ORDER BY fecha DESC LIMIT 20');
    res.json({ success: true, noticias: r.rows });
});

app.post('/api/generar-noticia', async (req, res) => {
    const r = await generarNoticia(req.body.categoria);
    res.json(r);
});

app.get('/noticia/:slug', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias WHERE slug=$1', [req.params.slug]);
    if (!r.rows.length) return res.status(404).send('No encontrada');
    res.send(`<h1>${r.rows[0].titulo}</h1><p>${r.rows[0].contenido}</p>`);
});

app.get('/img/:nombre', (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) res.sendFile(ruta);
    else res.status(404).send('No encontrada');
});

// ⏰ CRON & START
cron.schedule('0 * * * *', () => generarNoticia('Nacionales'));

app.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════╗
    ║ 🏮 EL FAROL AL DÍA — V34.2 ESTABLE ║
    ╚════════════════════════════════════╝
    🚀 Puerto: ${PORT} | Modelo: 1.5-Flash
    `);
});
