/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V18.3 (COLA + REINTENTOS LARGOS)
 * CAMBIOS: Cola generación + 5 reintentos (15s→30s→60s→120s→240s) + Cron 6h + Migración BD
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL requerido'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => { console.log(`⛔ Rate limit IP: ${req.ip}`); res.status(429).json({ error: 'Demasiadas solicitudes.' }); }
});
app.use(limiter);

const limiterGeneracion = rateLimit({
    windowMs: 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => { console.log(`⛔ Spam generación IP: ${req.ip}`); res.status(429).json({ error: 'Demasiadas generaciones.' }); }
});

// ====== COLA DE GENERACIÓN ======
let generandoAhora = false;

async function generarConCola(categoria) {
    if (generandoAhora) {
        console.log(`⏳ Cola: sistema ocupado, esperando 30s para ${categoria}...`);
        await new Promise(r => setTimeout(r, 30000));
        if (generandoAhora) {
            guardarError('cola', `Timeout esperando turno para ${categoria}`);
            return { success: false, error: 'Sistema ocupado, intenta más tarde' };
        }
    }
    generandoAhora = true;
    console.log(`🔒 Cola: iniciando ${categoria}`);
    try {
        return await generarNoticia(categoria);
    } finally {
        generandoAhora = false;
        console.log(`🔓 Cola: sistema libre`);
    }
}

// ====== CONFIG IA ======
const CONFIG_IA_PATH = path.join(__dirname, 'config-ia.json');

function cargarConfigIA() {
    const d = {
        enabled: true, maxNoticias: 10, creditosMensuales: 500,
        instruccion_principal: 'Eres un periodista profesional dominicano. Escribe noticias verificadas, equilibradas y profesionales.',
        tono: 'profesional', extension: 'media',
        enfasis: 'Noticias locales con contexto histórico',
        evitar: 'Especulación sin fuentes, titulares sensacionalistas, desinformación',
        prioridades: { 'Nacionales': 10, 'Deportes': 8, 'Internacionales': 6, 'Economía': 7, 'Tecnología': 6, 'Espectáculos': 5 },
        imagenes: { buscar_personas: true, validar_relevancia: true, usar_fallback_ilustrativo: true, max_intentos_imagen: 3 }
    };
    try {
        if (fs.existsSync(CONFIG_IA_PATH)) return { ...d, ...JSON.parse(fs.readFileSync(CONFIG_IA_PATH, 'utf8')) };
    } catch (e) { console.warn('⚠️ Error config IA'); }
    fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(d, null, 2));
    return d;
}

function guardarConfigIA(config) {
    try { fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(config, null, 2)); return true; }
    catch (e) { console.error('❌ Error guardando config:', e.message); return false; }
}

let CONFIG_IA = cargarConfigIA();

// ====== HISTORIAL ERRORES ======
const HISTORIAL_ERRORES_PATH = path.join(__dirname, 'historial-errores.json');

function cargarHistorial() {
    try { if (fs.existsSync(HISTORIAL_ERRORES_PATH)) return JSON.parse(fs.readFileSync(HISTORIAL_ERRORES_PATH, 'utf8')); }
    catch (e) {}
    return [];
}

function guardarError(tipo, descripcion, detalles = {}) {
    try {
        let h = cargarHistorial();
        h.push({ timestamp: new Date().toISOString(), tipo, descripcion, detalles, resuelto: false });
        if (h.length > 100) h = h.slice(-100);
        fs.writeFileSync(HISTORIAL_ERRORES_PATH, JSON.stringify(h, null, 2));
        console.log(`📝 Error: ${tipo} - ${descripcion}`);
    } catch (e) {}
}

// ====== REDACTORES ======
const REDACTORES = [
    { nombre: 'Carlos Méndez', especialidad: 'Nacionales' },
    { nombre: 'Laura Santana', especialidad: 'Deportes' },
    { nombre: 'Roberto Peña', especialidad: 'Internacionales' },
    { nombre: 'Ana María Castillo', especialidad: 'Economía' },
    { nombre: 'José Miguel Fernández', especialidad: 'Tecnología' },
    { nombre: 'Patricia Jiménez', especialidad: 'Espectáculos' }
];

function elegirRedactor(categoria) {
    const esp = REDACTORES.filter(r => r.especialidad === categoria);
    return esp.length > 0 ? esp[Math.floor(Math.random() * esp.length)].nombre : 'IA Gemini';
}

function generarSlug(texto) {
    return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
}

// ====== BANCO IMÁGENES ======
const BANCO_IMAGENES_ILUSTRATIVAS = {
    'Nacionales': { urls: ['https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg','https://images.pexels.com/photos/290595/pexels-photo-290595.jpeg','https://images.pexels.com/photos/3616480/pexels-photo-3616480.jpeg','https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg'], alt: 'Congreso Nacional - República Dominicana' },
    'Deportes': { urls: ['https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg','https://images.pexels.com/photos/1884574/pexels-photo-1884574.jpeg','https://images.pexels.com/photos/209977/pexels-photo-209977.jpeg','https://images.pexels.com/photos/3621943/pexels-photo-3621943.jpeg'], alt: 'Estadio de fútbol - Deportes' },
    'Internacionales': { urls: ['https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg','https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg','https://images.pexels.com/photos/2869499/pexels-photo-2869499.jpeg','https://images.pexels.com/photos/3407617/pexels-photo-3407617.jpeg'], alt: 'Noticias Internacionales' },
    'Espectáculos': { urls: ['https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg','https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg','https://images.pexels.com/photos/3651308/pexels-photo-3651308.jpeg','https://images.pexels.com/photos/3587478/pexels-photo-3587478.jpeg'], alt: 'Entretenimiento y Espectáculos' },
    'Economía': { urls: ['https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg','https://images.pexels.com/photos/6772070/pexels-photo-6772070.jpeg','https://images.pexels.com/photos/3184591/pexels-photo-3184591.jpeg','https://images.pexels.com/photos/3532557/pexels-photo-3532557.jpeg'], alt: 'Gráficos de Economía' },
    'Tecnología': { urls: ['https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg','https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg','https://images.pexels.com/photos/5632399/pexels-photo-5632399.jpeg','https://images.pexels.com/photos/3932499/pexels-photo-3932499.jpeg'], alt: 'Tecnología e Innovación' }
};

// ====== CACHE IMÁGENES ======
const CACHE_IMAGENES = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function guardarEnCache(k, v) { CACHE_IMAGENES.set(k, { imagen: v, timestamp: Date.now() }); }
function obtenerDeCache(k) {
    if (!CACHE_IMAGENES.has(k)) return null;
    const e = CACHE_IMAGENES.get(k);
    if (Date.now() - e.timestamp > CACHE_TTL) { CACHE_IMAGENES.delete(k); return null; }
    return e.imagen;
}

// ====== GEMINI CON RETRY LARGO ======
async function llamarGeminiConRetry(prompt, maxIntentos = 5) {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const tiempos = [15000, 30000, 60000, 120000, 240000];

    for (let i = 0; i < maxIntentos; i++) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.8, maxOutputTokens: 2500, topP: 0.95 }
                    })
                }
            );

            if (response.status === 429) {
                const espera = tiempos[i] || 240000;
                console.log(`⏳ Gemini 429 — esperando ${espera/1000}s (intento ${i+1}/${maxIntentos})`);
                guardarError('gemini_429', `Rate limit, reintentando en ${espera/1000}s`, { intento: i+1 });
                await delay(espera);
                continue;
            }
            if (!response.ok) throw new Error(`Gemini error ${response.status}`);
            return await response.json();

        } catch (e) {
            if (i === maxIntentos - 1) throw e;
            console.log(`⚠️ Gemini error intento ${i+1}: ${e.message}`);
            await delay(tiempos[i] || 15000);
        }
    }
    throw new Error('Gemini no respondió después de todos los reintentos');
}

// ====== BUSCAR IMAGEN INTELIGENTE ======
async function buscarImagenInteligente(persona, busqueda, categoria) {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const cacheKey = `${persona||''}-${busqueda||''}-${categoria}`.toLowerCase().replace(/\s+/g,'_');
    const cached = obtenerDeCache(cacheKey);
    if (cached) { console.log(`📦 Imagen cache: ${cacheKey}`); return cached; }

    let intento = 0;
    const max = CONFIG_IA.imagenes.max_intentos_imagen;
    console.log(`\n🎬 IMÁGENES — Persona: ${persona||'ninguna'} | Búsqueda: ${busqueda||'ninguna'} | Cat: ${categoria}`);

    if (persona && CONFIG_IA.imagenes.buscar_personas) {
        if (process.env.UNSPLASH_ACCESS_KEY) {
            try {
                intento++;
                const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(persona)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&per_page=1`);
                if (res.ok) { const d = await res.json(); if (d.results?.length > 0) { const r = { url: d.results[0].urls.regular, alt: persona, source: 'Unsplash', tipo: 'persona', validada: true }; guardarEnCache(cacheKey, r); return r; } }
            } catch (e) { guardarError('imagen_unsplash', `Error ${persona}`, { error: e.message }); }
            await delay(300);
        }
        if (process.env.PEXELS_API_KEY) {
            try {
                intento++;
                const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(persona)}&per_page=1`, { headers: { 'Authorization': process.env.PEXELS_API_KEY } });
                if (res.ok) { const d = await res.json(); if (d.photos?.length > 0) { const r = { url: d.photos[0].src.landscape, alt: persona, source: 'Pexels', tipo: 'persona', validada: true }; guardarEnCache(cacheKey, r); return r; } }
            } catch (e) { guardarError('imagen_pexels', `Error ${persona}`, { error: e.message }); }
            await delay(300);
        }
        if (process.env.PIXABAY_API_KEY) {
            try {
                intento++;
                const res = await fetch(`https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(persona)}&per_page=1`);
                if (res.ok) { const d = await res.json(); if (d.hits?.length > 0) { const r = { url: d.hits[0].webformatURL, alt: persona, source: 'Pixabay', tipo: 'persona', validada: true }; guardarEnCache(cacheKey, r); return r; } }
            } catch (e) { guardarError('imagen_pixabay', `Error ${persona}`, { error: e.message }); }
        }
    }

    if (busqueda && intento < max) {
        if (process.env.UNSPLASH_ACCESS_KEY) {
            try {
                intento++;
                const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(busqueda)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&per_page=1`);
                if (res.ok) { const d = await res.json(); if (d.results?.length > 0) { const r = { url: d.results[0].urls.regular, alt: busqueda, source: 'Unsplash', tipo: 'tematica', validada: true }; guardarEnCache(cacheKey, r); return r; } }
            } catch (e) {}
            await delay(300);
        }
        if (process.env.PEXELS_API_KEY) {
            try {
                intento++;
                const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(busqueda)}&per_page=1`, { headers: { 'Authorization': process.env.PEXELS_API_KEY } });
                if (res.ok) { const d = await res.json(); if (d.photos?.length > 0) { const r = { url: d.photos[0].src.landscape, alt: busqueda, source: 'Pexels', tipo: 'tematica', validada: true }; guardarEnCache(cacheKey, r); return r; } }
            } catch (e) {}
        }
    }

    const banco = BANCO_IMAGENES_ILUSTRATIVAS[categoria] || BANCO_IMAGENES_ILUSTRATIVAS['Nacionales'];
    const resultado = { url: banco.urls[Math.floor(Math.random() * banco.urls.length)], alt: banco.alt, source: 'ilustrativa', tipo: 'ilustrativa', validada: true };
    guardarEnCache(cacheKey, resultado);
    return resultado;
}

// ====== INICIALIZAR BD ======
async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Inicializando BD...');
        await client.query(`CREATE TABLE IF NOT EXISTS noticias (
            id SERIAL PRIMARY KEY, titulo VARCHAR(255) NOT NULL, slug VARCHAR(255) UNIQUE,
            seccion VARCHAR(100), contenido TEXT, seo_description VARCHAR(160), seo_keywords VARCHAR(255),
            redactor VARCHAR(100), imagen TEXT, imagen_alt VARCHAR(255), imagen_source VARCHAR(50),
            vistas INTEGER DEFAULT 0, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP, estado VARCHAR(50) DEFAULT 'publicada'
        )`);
        await client.query(`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS imagen_alt VARCHAR(255)`);
        await client.query(`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS imagen_source VARCHAR(50)`);
        console.log('✅ BD lista — migración aplicada');
    } catch (e) { console.error('❌ Error BD:', e.message); } finally { client.release(); }
}

// ====== TÍTULO DUPLICADO ======
async function tituloDuplicado(titulo) {
    try {
        const norm = titulo.toLowerCase().replace(/[^\w\s]/g,'').substring(0,50);
        const result = await pool.query('SELECT titulo FROM noticias WHERE estado=$1', ['publicada']);
        for (const row of result.rows) {
            const ex = row.titulo.toLowerCase().replace(/[^\w\s]/g,'').substring(0,50);
            let c = 0; const pt = norm.split(' '); const pe = ex.split(' ');
            for (const p of pt) { if (p.length > 3 && pe.includes(p)) c++; }
            if (c / Math.max(pt.length, 1) > 0.6) return true;
        }
        return false;
    } catch (e) { return false; }
}

// ====== RELACIONADAS ======
async function obtenerRelacionadas(noticiaId, seccion, keywords, limit = 4) {
    try {
        const palabras = keywords ? keywords.split(',').map(k => k.trim().toLowerCase()) : [];
        let query = 'SELECT id, titulo, slug, seccion, imagen, fecha FROM noticias WHERE id != $1 AND estado = $2';
        const params = [noticiaId, 'publicada'];
        if (seccion) { query += ` AND seccion = $3`; params.push(seccion); }
        if (palabras.length > 0) {
            for (let i = 0; i < Math.min(palabras.length, 2); i++) {
                query += ` AND (titulo ILIKE $${params.length+1} OR contenido ILIKE $${params.length+1})`;
                params.push(`%${palabras[i]}%`);
            }
        }
        query += ` ORDER BY fecha DESC LIMIT $${params.length+1}`;
        params.push(limit);
        return (await pool.query(query, params)).rows;
    } catch (e) { return []; }
}

// ====== GENERAR NOTICIA ======
async function generarNoticia(categoria) {
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada por admin' };

        console.log(`\n🤖 GENERANDO: ${categoria} | ${CONFIG_IA.tono}/${CONFIG_IA.extension}`);

        const prompt = `${CONFIG_IA.instruccion_principal}

Noticia sobre ${categoria} en RD. Tono: ${CONFIG_IA.tono}. 400-500 palabras. Sin asteriscos en títulos.

Responde SOLO en XML:
<noticia>
<titulo>título 50-60 caracteres, sin asteriscos</titulo>
<persona>nombre o vacío</persona>
<descripcion>SEO 150-160 caracteres</descripcion>
<palabras>5-7 keywords separadas por coma</palabras>
<busqueda_imagen>3-5 palabras en inglés</busqueda_imagen>
<contenido>noticia completa en párrafos</contenido>
</noticia>`;

        const data = await llamarGeminiConRetry(prompt);
        const texto = data.candidates[0].content.parts[0].text;

        // Parseo XML con regex
        const extraer = (tag) => {
            const m = texto.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
            return m ? m[1].trim().replace(/[*_#`]/g, '') : '';
        };

        let titulo          = extraer('titulo');
        let persona         = extraer('persona');
        let descripcion     = extraer('descripcion');
        let palabras        = extraer('palabras') || categoria;
        let busqueda_imagen = extraer('busqueda_imagen');
        let contenido       = extraer('contenido');

        if (!titulo || titulo.length < 20 || !contenido || contenido.length < 300) {
            guardarError('validacion', 'Generación inválida');
            throw new Error('Contenido insuficiente de Gemini');
        }

        if (await tituloDuplicado(titulo)) {
            guardarError('duplicado', titulo.substring(0,50));
            return { success: false, error: 'Título similar ya existe' };
        }

        const imagen = await buscarImagenInteligente(persona, busqueda_imagen, categoria);

        titulo      = titulo.substring(0,255);
        descripcion = descripcion.substring(0,160);
        palabras    = palabras.substring(0,255);
        contenido   = contenido.substring(0,10000);

        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        const redactor = elegirRedactor(categoria);

        const result = await pool.query(
            `INSERT INTO noticias (titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_source,estado)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,slug`,
            [titulo, slugFinal, categoria, contenido, descripcion, palabras, redactor, imagen.url, imagen.alt, imagen.source, 'publicada']
        );

        const noticia = result.rows[0];
        console.log(`✅ PUBLICADA: ID ${noticia.id} | ${titulo.substring(0,50)}... | ${imagen.tipo}`);

        return { success: true, id: noticia.id, slug: noticia.slug, titulo, url: `${BASE_URL}/noticia/${noticia.slug}`, imagen: imagen.url, imagen_tipo: imagen.tipo, redactor, persona: persona||'ninguna', mensaje: '✅ Noticia generada' };

    } catch (error) {
        console.error(`❌ ERROR:`, error.message);
        guardarError('generacion', error.message);
        return { success: false, error: error.message };
    }
}

// ====== CATEGORÍAS Y CRON ======
const CATEGORIAS = ['Nacionales','Deportes','Internacionales','Economía','Tecnología','Espectáculos'];

console.log('\n📅 Configurando automatización...');

cron.schedule('0 */6 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    const delay = Math.floor(Math.random() * 10 * 60 * 1000);
    console.log(`\n⏰ Noticia automática en ${Math.round(delay/60000)}min...`);
    await new Promise(r => setTimeout(r, delay));
    await generarConCola(CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)]);
});

cron.schedule('0 8 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    console.log(`\n🌅 Noticia diaria: Nacionales`);
    await generarConCola('Nacionales');
});

console.log('✅ Automatización: cada 6h + cola');

// ====== RUTAS ======
app.get('/health', (req, res) => res.json({ status: 'OK', version: '18.3' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

app.get('/api/noticias', async (req, res) => {
    try {
        const r = await pool.query('SELECT id,titulo,slug,seccion,imagen,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30', ['publicada']);
        res.json({ success: true, noticias: r.rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/generar-noticia', limiterGeneracion, async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    const resultado = await generarConCola(categoria);
    res.status(resultado.success ? 200 : 500).json(resultado);
});

app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2', [req.params.slug, 'publicada']);
        if (result.rows.length === 0) return res.status(404).send('Noticia no encontrada');
        const n = result.rows[0];
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [n.id]);
        const relacionadas = await obtenerRelacionadas(n.id, n.seccion, n.seo_keywords, 4);
        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            const fechaISO = new Date(n.fecha).toISOString();
            const meta = `<title>${n.titulo} | El Farol al Día</title>
<meta name="description" content="${n.seo_description||n.titulo}">
<meta name="keywords" content="${n.seo_keywords||''}">
<meta property="og:title" content="${n.titulo}">
<meta property="og:description" content="${n.seo_description||n.titulo}">
<meta property="og:image" content="${n.imagen}">
<meta property="og:url" content="${BASE_URL}/noticia/${n.slug}">
<meta property="og:type" content="article">
<meta property="article:published_time" content="${fechaISO}">
<meta property="article:author" content="${n.redactor}">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"${n.titulo}","description":"${n.seo_description||n.titulo}","image":"${n.imagen}","datePublished":"${fechaISO}","author":{"@type":"Person","name":"${n.redactor}"},"publisher":{"@type":"Organization","name":"El Farol al Día"}}</script>`;
            let relHTML = '';
            if (relacionadas.length > 0) {
                relHTML = '<h3>Noticias relacionadas</h3><div class="relacionadas">';
                relacionadas.forEach(r => { relHTML += `<div class="relacionada-item"><a href="/noticia/${r.slug}"><img src="${r.imagen}" alt="${r.titulo}" loading="lazy" onerror="this.src='https://via.placeholder.com/200x150?text=Noticia'"><h4>${r.titulo}</h4><span>${new Date(r.fecha).toLocaleDateString('es-DO')}</span></a></div>`; });
                relHTML += '</div>';
            }
            const cHTML = n.contenido.split('\n').filter(p=>p.trim()!=='').map(p=>`<p>${p.trim()}</p>`).join('');
            html = html.replace('<!-- META_TAGS -->', meta);
            html = html.replace(/{{TITULO}}/g, n.titulo);
            html = html.replace(/{{CONTENIDO}}/g, cHTML||'<p>Contenido no disponible</p>');
            html = html.replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO',{year:'numeric',month:'long',day:'numeric'}));
            html = html.replace(/{{IMAGEN}}/g, n.imagen);
            html = html.replace(/{{ALT}}/g, n.imagen_alt||n.titulo);
            html = html.replace(/{{VISTAS}}/g, n.vistas);
            html = html.replace(/{{REDACTOR}}/g, n.redactor);
            html = html.replace(/{{SECCION}}/g, n.seccion);
            html = html.replace('<!-- RELACIONADAS -->', relHTML);
            res.setHeader('Content-Type','text/html; charset=utf-8');
            res.send(html);
        } catch (e) { res.json({ success: true, noticia: n, relacionadas }); }
    } catch (e) { console.error('Error /noticia/:slug', e.message); res.status(500).send('Error interno'); }
});

app.get('/sitemap.xml', async (req, res) => {
    try {
        const r = await pool.query('SELECT slug,fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC', ['publicada']);
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
        r.rows.forEach(n => { xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n`; });
        xml += '</urlset>';
        res.header('Content-Type','application/xml'); res.send(xml);
    } catch (e) { res.status(500).send('Error'); }
});

app.get('/robots.txt', (req, res) => { res.header('Content-Type','text/plain'); res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nSitemap: ${BASE_URL}/sitemap.xml`); });

app.get('/api/estadisticas', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) as count, SUM(vistas) as vistas FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ success: true, totalNoticias: parseInt(r.rows[0].count), totalVistas: parseInt(r.rows[0].vistas)||0 });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/configuracion', async (req, res) => {
    try {
        const cp = path.join(__dirname,'config.json');
        let config = { googleAnalytics: '' };
        if (fs.existsSync(cp)) config = JSON.parse(fs.readFileSync(cp,'utf8'));
        res.json({ success: true, config });
    } catch (e) { res.json({ success: true, config: { googleAnalytics: '' } }); }
});

app.post('/api/configuracion', express.json(), async (req, res) => {
    try {
        const { pin, googleAnalytics } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        fs.writeFileSync(path.join(__dirname,'config.json'), JSON.stringify({ googleAnalytics }, null, 2));
        res.json({ success: true, message: 'Guardado' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/publicar', express.json(), async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, redactor, seoDesc, seoKeywords } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        if (!titulo||!seccion||!contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });
        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        const r = await pool.query(
            `INSERT INTO noticias (titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_source,estado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,slug`,
            [titulo,slugFinal,seccion,contenido,seoDesc||titulo,seoKeywords||seccion,redactor||'Manual','https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',titulo,'manual','publicada']
        );
        res.json({ success: true, id: r.rows[0].id, slug: r.rows[0].slug, url: `${BASE_URL}/noticia/${r.rows[0].slug}` });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/status', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ status: 'OK', version: '18.3', noticias: parseInt(r.rows[0].count), ia_enabled: CONFIG_IA.enabled, generando_ahora: generandoAhora, cache_imagenes: CACHE_IMAGENES.size });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/config', (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    res.json(CONFIG_IA);
});

app.post('/api/admin/config', express.json(), (req, res) => {
    const { pin, instruccion_principal, tono, extension, enfasis, evitar, enabled } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    if (instruccion_principal) CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono)      CONFIG_IA.tono      = tono;
    if (extension) CONFIG_IA.extension = extension;
    if (enfasis)   CONFIG_IA.enfasis   = enfasis;
    if (evitar)    CONFIG_IA.evitar    = evitar;
    if (enabled !== undefined) CONFIG_IA.enabled = enabled;
    guardarConfigIA(CONFIG_IA) ? res.json({ success: true, mensaje: 'Guardado' }) : res.status(500).json({ error: 'Error' });
});

app.get('/api/admin/errores', (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    res.json({ success: true, errores: cargarHistorial() });
});

app.use((req, res) => { res.sendFile(path.join(__dirname, 'client', 'index.html')); });

async function iniciar() {
    try {
        console.log('\n🚀 Iniciando V18.3...\n');
        await inicializarBase();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - V18.3 (COLA + REINTENTOS LARGOS) 🏮        ║
╠══════════════════════════════════════════════════════════════════════╣
║ ✅ Cola: nunca dos Gemini al mismo tiempo                            ║
║ ✅ Reintentos: 15s→30s→60s→120s→240s (5 intentos)                 ║
║ ✅ Cron: cada 6h + delay aleatorio                                  ║
║ ✅ BD migración automática                                           ║
║ ✅ Cache imágenes 24h                                               ║
║ ✅ Frontend 100% intacto                                            ║
╚══════════════════════════════════════════════════════════════════════╝`);
        });
    } catch (error) { console.error('❌ Error fatal:', error); process.exit(1); }
}

iniciar();
module.exports = app;

