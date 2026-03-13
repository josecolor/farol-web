/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V26.0
 *
 * NOVEDAD: Búsqueda inteligente de imágenes por contexto real
 * ─────────────────────────────────────────────────────────────
 * Gemini genera la noticia Y produce una query de búsqueda:
 *   "Otani beisbol pitching" → Pexels API → foto coherente
 *   "Camacho fiscal dominicano" → Pexels API → foto coherente
 *   "gasolina combustible RD" → Pexels API → foto coherente
 *
 * FALLBACK en 3 capas:
 *   1. Pexels API con query específica de Gemini
 *   2. Pexels API con query de categoría
 *   3. Banco local por subtema (sin API)
 *
 * VARIABLE DE ENTORNO REQUERIDA: PEXELS_API_KEY
 */

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const cron     = require('node-cron');
const { Pool } = require('pg');

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ==================== VALIDACIÓN ENV ====================
if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL requerido'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || null;

// ==================== BD ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== CONFIG IA ====================
const CONFIG_IA_PATH = path.join(__dirname, 'config-ia.json');

function cargarConfigIA() {
    const def = {
        enabled: true,
        instruccion_principal: 'Eres un periodista profesional dominicano. Escribe noticias verificadas, equilibradas y con énfasis en Santo Domingo Este y República Dominicana.',
        tono: 'profesional',
        extension: 'media',
        enfasis: 'Santo Domingo Este: Invivienda, Los Mina, Ensanche Ozama, Av. España',
        evitar: 'Especulación sin fuentes, titulares sensacionalistas'
    };
    try {
        if (fs.existsSync(CONFIG_IA_PATH)) return { ...def, ...JSON.parse(fs.readFileSync(CONFIG_IA_PATH, 'utf8')) };
    } catch (e) { console.warn('⚠️ Config IA no encontrada, usando defaults'); }
    fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(def, null, 2));
    return def;
}

function guardarConfigIA(config) {
    try { fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(config, null, 2)); return true; }
    catch (e) { return false; }
}

let CONFIG_IA = cargarConfigIA();

// ==================== CONTROL GEMINI ====================
const GEMINI_STATE = { lastRequest: 0, resetTime: 0 };

async function delayAntesDeGemini() {
    const ahora = Date.now();
    if (ahora < GEMINI_STATE.resetTime) {
        const e = GEMINI_STATE.resetTime - ahora;
        console.log(`   ⏳ Rate limit: esperando ${Math.ceil(e / 1000)}s`);
        await new Promise(r => setTimeout(r, Math.min(e, 10000)));
    }
    const desde = Date.now() - GEMINI_STATE.lastRequest;
    if (desde < 3000) await new Promise(r => setTimeout(r, 3000 - desde));
    GEMINI_STATE.lastRequest = Date.now();
}

async function llamarGemini(prompt, reintentos = 3) {
    for (let i = 0; i < reintentos; i++) {
        try {
            console.log(`   🤖 Gemini (intento ${i + 1}/${reintentos})`);
            await delayAntesDeGemini();
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.8, maxOutputTokens: 2500 }
                    })
                }
            );
            if (res.status === 429) {
                const espera = Math.pow(2, i) * 5000;
                console.log(`   ⚠️ 429, esperando ${Math.ceil(espera / 1000)}s...`);
                GEMINI_STATE.resetTime = Date.now() + espera;
                await new Promise(r => setTimeout(r, espera));
                continue;
            }
            if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
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

// ==================== PEXELS API ====================
async function buscarEnPexels(query) {
    if (!PEXELS_API_KEY) return null;
    try {
        console.log(`   🔍 Pexels: "${query}"`);
        const res = await fetch(
            `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`,
            { headers: { Authorization: PEXELS_API_KEY } }
        );
        if (!res.ok) { console.warn(`   ⚠️ Pexels HTTP ${res.status}`); return null; }
        const data = await res.json();
        if (!data.photos || data.photos.length === 0) { console.log(`   ⚠️ Sin resultados Pexels`); return null; }
        const fotos = data.photos.slice(0, 5);
        const foto = fotos[Math.floor(Math.random() * fotos.length)];
        const url = foto.src.large2x || foto.src.large || foto.src.original;
        console.log(`   ✅ Pexels OK`);
        return url;
    } catch (err) {
        console.warn(`   ⚠️ Pexels error: ${err.message}`);
        return null;
    }
}

// ==================== BANCO LOCAL ====================
const PB  = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';

const BANCO_LOCAL = {
    'politica-gobierno':          [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`, `${PB}/290595/pexels-photo-290595.jpeg${OPT}`,   `${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`, `${PB}/3183150/pexels-photo-3183150.jpeg${OPT}`],
    'seguridad-policia':          [`${PB}/6261776/pexels-photo-6261776.jpeg${OPT}`, `${PB}/5699456/pexels-photo-5699456.jpeg${OPT}`, `${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`, `${PB}/6980997/pexels-photo-6980997.jpeg${OPT}`],
    'relaciones-internacionales': [`${PB}/2860705/pexels-photo-2860705.jpeg${OPT}`, `${PB}/358319/pexels-photo-358319.jpeg${OPT}`,   `${PB}/3407617/pexels-photo-3407617.jpeg${OPT}`, `${PB}/3997992/pexels-photo-3997992.jpeg${OPT}`],
    'economia-mercado':           [`${PB}/4386466/pexels-photo-4386466.jpeg${OPT}`, `${PB}/6772070/pexels-photo-6772070.jpeg${OPT}`, `${PB}/3532557/pexels-photo-3532557.jpeg${OPT}`, `${PB}/6801648/pexels-photo-6801648.jpeg${OPT}`],
    'infraestructura':            [`${PB}/1216589/pexels-photo-1216589.jpeg${OPT}`, `${PB}/323780/pexels-photo-323780.jpeg${OPT}`,   `${PB}/2219024/pexels-photo-2219024.jpeg${OPT}`, `${PB}/3183197/pexels-photo-3183197.jpeg${OPT}`],
    'salud-medicina':             [`${PB}/3786157/pexels-photo-3786157.jpeg${OPT}`, `${PB}/40568/pexels-photo-40568.jpeg${OPT}`,     `${PB}/4386467/pexels-photo-4386467.jpeg${OPT}`, `${PB}/1170979/pexels-photo-1170979.jpeg${OPT}`],
    'deporte-beisbol':            [`${PB}/1661950/pexels-photo-1661950.jpeg${OPT}`, `${PB}/209977/pexels-photo-209977.jpeg${OPT}`,   `${PB}/248318/pexels-photo-248318.jpeg${OPT}`,   `${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`],
    'deporte-futbol':             [`${PB}/46798/pexels-photo-46798.jpeg${OPT}`,     `${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`, `${PB}/3873098/pexels-photo-3873098.jpeg${OPT}`, `${PB}/1884574/pexels-photo-1884574.jpeg${OPT}`],
    'deporte-general':            [`${PB}/863988/pexels-photo-863988.jpeg${OPT}`,   `${PB}/936094/pexels-photo-936094.jpeg${OPT}`,   `${PB}/2526878/pexels-photo-2526878.jpeg${OPT}`, `${PB}/3621943/pexels-photo-3621943.jpeg${OPT}`],
    'tecnologia':                 [`${PB}/3861958/pexels-photo-3861958.jpeg${OPT}`, `${PB}/2582937/pexels-photo-2582937.jpeg${OPT}`, `${PB}/5632399/pexels-photo-5632399.jpeg${OPT}`, `${PB}/3932499/pexels-photo-3932499.jpeg${OPT}`],
    'educacion':                  [`${PB}/256490/pexels-photo-256490.jpeg${OPT}`,   `${PB}/289737/pexels-photo-289737.jpeg${OPT}`,   `${PB}/1205651/pexels-photo-1205651.jpeg${OPT}`, `${PB}/4143791/pexels-photo-4143791.jpeg${OPT}`],
    'cultura-musica':             [`${PB}/1190297/pexels-photo-1190297.jpeg${OPT}`, `${PB}/1540406/pexels-photo-1540406.jpeg${OPT}`, `${PB}/3651308/pexels-photo-3651308.jpeg${OPT}`, `${PB}/2521317/pexels-photo-2521317.jpeg${OPT}`],
    'medio-ambiente':             [`${PB}/1108572/pexels-photo-1108572.jpeg${OPT}`, `${PB}/1366919/pexels-photo-1366919.jpeg${OPT}`, `${PB}/2559941/pexels-photo-2559941.jpeg${OPT}`, `${PB}/414612/pexels-photo-414612.jpeg${OPT}`],
    'turismo':                    [`${PB}/1450353/pexels-photo-1450353.jpeg${OPT}`, `${PB}/1174732/pexels-photo-1174732.jpeg${OPT}`, `${PB}/3601425/pexels-photo-3601425.jpeg${OPT}`, `${PB}/2104152/pexels-photo-2104152.jpeg${OPT}`],
    'emergencia':                 [`${PB}/1437862/pexels-photo-1437862.jpeg${OPT}`, `${PB}/263402/pexels-photo-263402.jpeg${OPT}`,   `${PB}/3807517/pexels-photo-3807517.jpeg${OPT}`, `${PB}/3616480/pexels-photo-3616480.jpeg${OPT}`]
};

const FALLBACK_CAT = {
    'Nacionales': 'politica-gobierno', 'Deportes': 'deporte-general',
    'Internacionales': 'relaciones-internacionales', 'Economía': 'economia-mercado',
    'Tecnología': 'tecnologia', 'Espectáculos': 'cultura-musica'
};

function imagenBancoLocal(subtema, categoria) {
    const banco = BANCO_LOCAL[subtema] || BANCO_LOCAL[FALLBACK_CAT[categoria]] || BANCO_LOCAL['politica-gobierno'];
    return banco[Math.floor(Math.random() * banco.length)];
}

async function obtenerImagenInteligente(titulo, categoria, subtema, queryImagen) {
    // Capa 1: Pexels API con query específica de Gemini
    if (queryImagen) {
        const url = await buscarEnPexels(queryImagen);
        if (url) return { url, nombre: 'pexels.jpg', fuente: 'pexels', alt: titulo, caption: `Fotografía: ${titulo}` };
    }
    // Capa 2: Pexels API con query de categoría
    const urlCat = await buscarEnPexels(`${categoria} news`);
    if (urlCat) return { url: urlCat, nombre: 'pexels.jpg', fuente: 'pexels', alt: titulo, caption: `Fotografía: ${titulo}` };
    // Capa 3: Banco local
    console.log(`   📦 Banco local (${subtema || FALLBACK_CAT[categoria]})`);
    return { url: imagenBancoLocal(subtema, categoria), nombre: 'pexels.jpg', fuente: 'pexels-local', alt: titulo, caption: `Fotografía: ${titulo}` };
}

// ==================== UTILIDADES ====================
function generarMetadatos(titulo, categoria, contenido) {
    const descripcion = contenido.split('\n')[0].substring(0, 160).trim();
    const keywords = [categoria.toLowerCase(), 'República Dominicana', 'Santo Domingo Este', 'noticias',
        ...titulo.split(' ').filter(p => p.length > 4).slice(0, 3)].join(', ');
    return { title: `${titulo} | El Farol al Día`, descripcion, keywords };
}

function generarSchemaOrg(noticia, imagen) {
    return {
        "@context": "https://schema.org", "@type": "NewsArticle",
        "headline": noticia.titulo,
        "image": { "@type": "ImageObject", "url": imagen.url, "caption": imagen.caption },
        "datePublished": new Date(noticia.fecha).toISOString(),
        "author": { "@type": "Person", "name": noticia.redactor },
        "publisher": { "@type": "Organization", "name": "El Farol al Día", "logo": { "@type": "ImageObject", "url": `${BASE_URL}/static/favicon.png` } }
    };
}

const REDACTORES = [
    { nombre: 'Carlos Méndez',         especialidad: 'Nacionales' },
    { nombre: 'Laura Santana',         especialidad: 'Deportes' },
    { nombre: 'Roberto Peña',          especialidad: 'Internacionales' },
    { nombre: 'Ana María Castillo',    especialidad: 'Economía' },
    { nombre: 'José Miguel Fernández', especialidad: 'Tecnología' },
    { nombre: 'Patricia Jiménez',      especialidad: 'Espectáculos' }
];

function elegirRedactor(categoria) {
    const m = REDACTORES.filter(r => r.especialidad === categoria);
    return m.length > 0 ? m[Math.floor(Math.random() * m.length)].nombre : 'Redacción EFD';
}

function generarSlug(texto) {
    return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
}

// ==================== BD ====================
async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Inicializando BD...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS noticias (
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
        for (const col of ['imagen_alt', 'imagen_caption', 'imagen_nombre', 'imagen_fuente']) {
            await client.query(`
                DO $$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='noticias' AND column_name='${col}')
                    THEN ALTER TABLE noticias ADD COLUMN ${col} TEXT; END IF;
                END $$;
            `).catch(() => {});
        }
        const fix = await client.query(`
            UPDATE noticias SET imagen='${PB}/3052454/pexels-photo-3052454.jpeg${OPT}', imagen_fuente='pexels'
            WHERE imagen LIKE '%/images/cache/%' OR imagen LIKE '%fallback%' OR imagen IS NULL OR imagen=''
        `);
        if (fix.rowCount > 0) console.log(`🔧 Reparadas ${fix.rowCount} imágenes`);
        console.log('✅ BD lista');
    } catch (e) { console.error('❌ BD:', e.message); }
    finally { client.release(); }
}

// ==================== GENERACIÓN ====================
async function generarNoticia(categoria) {
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };

        const subtemas = Object.keys(BANCO_LOCAL).join(', ');

        const prompt = `${CONFIG_IA.instruccion_principal}

Escribe una noticia periodística profesional sobre "${categoria}" para República Dominicana.
TONO: ${CONFIG_IA.tono} | EXTENSIÓN: 400-500 palabras | EVITAR: ${CONFIG_IA.evitar}
ÉNFASIS LOCAL: ${CONFIG_IA.enfasis}

════════════ INSTRUCCIÓN DE IMAGEN ════════════
Analiza el personaje principal o la situación central de esta noticia.
Genera una QUERY EN INGLÉS (2-4 palabras) para buscar la foto más coherente en Pexels.

Ejemplos de buen criterio:
• Noticia Otani / béisbol → QUERY_IMAGEN: baseball pitcher mound
• Noticia Trump / aranceles → QUERY_IMAGEN: president speech podium
• Noticia policía / arrestos → QUERY_IMAGEN: police officer uniform
• Noticia gasolina / precios → QUERY_IMAGEN: gas station fuel pump
• Noticia hospital / dengue → QUERY_IMAGEN: hospital doctor emergency
• Noticia huracán / inundación → QUERY_IMAGEN: tropical storm flooding
• Noticia béisbol dominicano → QUERY_IMAGEN: dominican baseball players
• Noticia vivienda / Invivienda → QUERY_IMAGEN: construction housing workers
• Noticia economía / dólar → QUERY_IMAGEN: currency exchange finance
• Noticia elecciones → QUERY_IMAGEN: voting election democracy
• Noticia turismo / playa RD → QUERY_IMAGEN: caribbean beach resort
═══════════════════════════════════════════════

Subtemas banco local disponibles (por si Pexels falla): ${subtemas}

RESPONDE EXACTAMENTE ASÍ (sin texto extra antes ni después):

TITULO: [título 50-60 caracteres, sin asteriscos]
DESCRIPCION: [meta descripción SEO 150-160 caracteres]
PALABRAS: [5 palabras clave SEO]
QUERY_IMAGEN: [query en inglés 2-4 palabras para Pexels]
SUBTEMA_LOCAL: [un subtema del banco como respaldo]
CONTENIDO:
[400-500 palabras, párrafos separados por línea en blanco]`;

        console.log(`\n📰 Generando: ${categoria}`);
        const texto = await llamarGemini(prompt);

        let titulo = '', descripcion = '', palabras = '', queryImagen = '', subtema = '', contenido = '';
        const lineas = texto.split('\n');
        let enContenido = false;
        const bloque = [];

        for (const l of lineas) {
            const t = l.trim();
            if      (t.startsWith('TITULO:'))        titulo      = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:'))   descripcion = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:'))      palabras    = t.replace('PALABRAS:', '').trim();
            else if (t.startsWith('QUERY_IMAGEN:'))  queryImagen = t.replace('QUERY_IMAGEN:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) subtema     = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:'))     enContenido = true;
            else if (enContenido && t.length > 0)    bloque.push(t);
        }

        contenido   = bloque.join('\n\n');
        titulo      = titulo.replace(/[*_#`]/g, '').trim();
        descripcion = descripcion.replace(/[*_#`]/g, '').trim();

        if (!titulo || !contenido || contenido.length < 200) throw new Error('Respuesta incompleta');

        console.log(`   📝 Título: ${titulo}`);
        console.log(`   🔍 Query: "${queryImagen}" | Subtema: "${subtema}"`);

        const imagen = await obtenerImagenInteligente(titulo, categoria, subtema, queryImagen);
        console.log(`   🖼️  ${imagen.url.substring(0, 70)}...`);

        const slug    = generarSlug(titulo);
        const existe  = await pool.query('SELECT id FROM noticias WHERE slug=$1', [slug]);
        const slugFin = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;

        await pool.query(
            `INSERT INTO noticias (titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,estado)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [titulo.substring(0,255), slugFin, categoria, contenido.substring(0,10000),
             descripcion.substring(0,160), (palabras||categoria).substring(0,255), elegirRedactor(categoria),
             imagen.url, imagen.alt, imagen.caption, imagen.nombre, imagen.fuente, 'publicada']
        );

        console.log(`\n✅ PUBLICADA: /noticia/${slugFin}`);
        return { success: true, slug: slugFin, titulo, query_imagen: queryImagen, mensaje: '✅ Publicada' };

    } catch (error) {
        console.error('❌ Error:', error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CRON ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

cron.schedule('0 */4 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    console.log('\n⏰ CRON automático...');
    const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticia(cat);
});

// ==================== RUTAS ====================
app.get('/health',     (req, res) => res.json({ status: 'OK', version: '26.0' }));
app.get('/',           (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion',  (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/contacto',   (req, res) => res.sendFile(path.join(__dirname, 'client', 'contacto.html')));
app.get('/nosotros',   (req, res) => res.sendFile(path.join(__dirname, 'client', 'nosotros.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'client', 'privacidad.html')));

app.get('/api/noticias', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id,titulo,slug,seccion,imagen,imagen_alt,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30`,
            ['publicada']
        );
        res.json({ success: true, noticias: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    const r = await generarNoticia(categoria);
    res.status(r.success ? 200 : 500).json(r);
});

app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2', [req.params.slug, 'publicada']);
        if (r.rows.length === 0) return res.status(404).send('Noticia no encontrada');
        const n = r.rows[0];
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [n.id]);
        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            const meta       = generarMetadatos(n.titulo, n.seccion, n.contenido);
            const schema     = generarSchemaOrg(n, { url: n.imagen, caption: n.imagen_caption });
            const urlNoticia = `${BASE_URL}/noticia/${n.slug}`;
            const metaTags = `<title>${meta.title}</title>
<meta name="description" content="${meta.descripcion}">
<meta name="keywords" content="${meta.keywords}">
<meta name="author" content="${n.redactor}">
<meta property="og:title" content="${n.titulo}">
<meta property="og:description" content="${meta.descripcion}">
<meta property="og:image" content="${n.imagen}">
<meta property="og:url" content="${urlNoticia}">
<meta property="og:type" content="article">
<meta property="article:published_time" content="${new Date(n.fecha).toISOString()}">
<meta property="article:section" content="${n.seccion}">
<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
            const contenidoHTML = n.contenido.split('\n').filter(p=>p.trim()).map(p=>`<p>${p.trim()}</p>`).join('');
            html = html
                .replace('<!-- META_TAGS -->', metaTags)
                .replace(/{{TITULO}}/g,    n.titulo)
                .replace(/{{CONTENIDO}}/g, contenidoHTML)
                .replace(/{{FECHA}}/g,     new Date(n.fecha).toLocaleDateString('es-DO', {year:'numeric',month:'long',day:'numeric'}))
                .replace(/{{IMAGEN}}/g,    n.imagen)
                .replace(/{{ALT}}/g,       n.imagen_alt || n.titulo)
                .replace(/{{VISTAS}}/g,    n.vistas)
                .replace(/{{REDACTOR}}/g,  n.redactor)
                .replace(/{{SECCION}}/g,   n.seccion)
                .replace(/{{URL}}/g,       encodeURIComponent(urlNoticia));
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (e) { res.json({ success: true, noticia: n }); }
    } catch (e) { res.status(500).send('Error'); }
});

app.get('/sitemap.xml', async (req, res) => {
    try {
        const r = await pool.query('SELECT slug,fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC', ['publicada']);
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
        r.rows.forEach(n => { xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><priority>0.8</priority></url>\n`; });
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml'); res.send(xml);
    } catch (e) { res.status(500).send('Error'); }
});

app.get('/robots.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nSitemap: ${BASE_URL}/sitemap.xml`);
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) as count, SUM(vistas) as vistas FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ success: true, totalNoticias: parseInt(r.rows[0].count), totalVistas: parseInt(r.rows[0].vistas)||0 });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/configuracion', (req, res) => {
    try {
        const config = fs.existsSync(path.join(__dirname,'config.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')) : { googleAnalytics:'' };
        res.json({ success: true, config });
    } catch (e) { res.json({ success: true, config: { googleAnalytics:'' } }); }
});

app.post('/api/configuracion', express.json(), (req, res) => {
    const { pin, googleAnalytics } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    try { fs.writeFileSync(path.join(__dirname,'config.json'), JSON.stringify({ googleAnalytics }, null, 2)); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/publicar', express.json(), async (req, res) => {
    const { pin, titulo, seccion, contenido, redactor } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    if (!titulo||!seccion||!contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });
    try {
        const slug   = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1', [slug]);
        const slugFin = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        const img = `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`;
        await pool.query(
            `INSERT INTO noticias (titulo,slug,seccion,contenido,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,estado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [titulo, slugFin, seccion, contenido, redactor||'Manual', img, titulo, `Fotografía: ${titulo}`, 'pexels.jpg', 'pexels', 'publicada']
        );
        res.json({ success: true, slug: slugFin });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/config', (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    res.json(CONFIG_IA);
});

app.post('/api/admin/config', express.json(), (req, res) => {
    const { pin, enabled, instruccion_principal, tono, extension, evitar, enfasis } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    if (enabled !== undefined)  CONFIG_IA.enabled = enabled;
    if (instruccion_principal)  CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono)                   CONFIG_IA.tono = tono;
    if (extension)              CONFIG_IA.extension = extension;
    if (evitar)                 CONFIG_IA.evitar = evitar;
    if (enfasis)                CONFIG_IA.enfasis = enfasis;
    res.json({ success: guardarConfigIA(CONFIG_IA) });
});

app.get('/status', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        res.json({
            status: 'OK', version: '26.0',
            noticias: parseInt(r.rows[0].count),
            pexels_api: PEXELS_API_KEY ? '✅ Activa' : '⚠️ Sin key (banco local)',
            ia_activa: CONFIG_IA.enabled,
            sistema: 'Gemini query → Pexels API → banco local'
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// ==================== ARRANQUE ====================
async function iniciar() {
    try {
        await inicializarBase();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║     🏮 EL FAROL AL DÍA - V26.0                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  🧠 Gemini genera QUERY de imagen por contexto real               ║
║  🔍 Pexels API busca la foto más coherente con la noticia         ║
║  📦 Banco local como respaldo si Pexels falla                     ║
║                                                                   ║
║  FLUJO:  Noticia sobre Otani                                      ║
║          → Gemini: "baseball pitcher mound"                       ║
║          → Pexels API → foto de pelotero real                     ║
║                                                                   ║
║  FLUJO:  Noticia sobre policía                                    ║
║          → Gemini: "police officer uniform badge"                 ║
║          → Pexels API → foto coherente                            ║
║                                                                   ║
║  Pexels API: ${PEXELS_API_KEY ? '✅ ACTIVA' : '⚠️  SIN KEY → banco local'}
║  ✅ Auto-reparación de imágenes rotas al iniciar                  ║
║  ✅ SEO: Schema.org + OG + sitemap + robots                       ║
║  ✅ CRON cada 4 horas                                             ║
╚═══════════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Fatal:', error);
        process.exit(1);
    }
}

iniciar();
module.exports = app;
