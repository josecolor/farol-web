/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V25.0
 * 
 * CAMBIOS vs V24.0:
 * 1. Imágenes Pexels directas (sin proxy/caché local) → fin de imágenes negras
 * 2. Gemini devuelve SUBTEMA de imagen → banco inteligente por contexto
 *    Ej: Trump → "politica-gobierno", policía → "seguridad-policia"
 * 3. Banco de imágenes expandido con 15+ subtemas
 * 4. Eliminados: https, http, crypto (ya no se usan)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ==================== BD ====================
if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL requerido');
    process.exit(1);
}

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
    const defaultConfig = {
        enabled: true,
        maxNoticias: 10,
        instruccion_principal: 'Eres un periodista profesional dominicano. Escribe noticias verificadas y equilibradas sobre República Dominicana, con énfasis en Santo Domingo Este.',
        tono: 'profesional',
        extension: 'media',
        enfasis: 'Noticias locales con contexto: Invivienda, Los Mina, Ensanche Ozama, Av. España',
        evitar: 'Especulación sin fuentes, titulares sensacionalistas'
    };
    try {
        if (fs.existsSync(CONFIG_IA_PATH)) {
            return { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_IA_PATH, 'utf8')) };
        }
    } catch (e) {
        console.warn('⚠️ Error config IA, usando defaults');
    }
    fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
}

function guardarConfigIA(config) {
    try {
        fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch (e) { return false; }
}

let CONFIG_IA = cargarConfigIA();

// ==================== CONTROL DE GEMINI ====================
const GEMINI_STATE = {
    lastRequest: 0,
    requestsInWindow: 0,
    resetTime: 0
};

async function delayAntesDeGemini() {
    const ahora = Date.now();
    if (ahora < GEMINI_STATE.resetTime) {
        const espera = GEMINI_STATE.resetTime - ahora;
        console.log(`   ⏳ Rate limit Gemini: esperando ${Math.ceil(espera / 1000)}s`);
        await new Promise(r => setTimeout(r, Math.min(espera, 10000)));
    }
    const tiempoDesdeUltimo = ahora - GEMINI_STATE.lastRequest;
    const delayMinimo = 3000;
    if (tiempoDesdeUltimo < delayMinimo) {
        const espera = delayMinimo - tiempoDesdeUltimo;
        console.log(`   ⏳ Esperando ${Math.ceil(espera / 1000)}s antes de Gemini...`);
        await new Promise(r => setTimeout(r, espera));
    }
    GEMINI_STATE.lastRequest = Date.now();
}

async function llamarGemini(prompt, reintentos = 3) {
    for (let intento = 0; intento < reintentos; intento++) {
        try {
            console.log(`\n   🤖 Llamando Gemini (intento ${intento + 1}/${reintentos})`);
            await delayAntesDeGemini();

            const response = await fetch(
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

            if (response.status === 429) {
                const espera = Math.pow(2, intento) * 5000;
                console.log(`   ⚠️ Rate limit 429, esperando ${Math.ceil(espera / 1000)}s...`);
                GEMINI_STATE.resetTime = Date.now() + espera;
                await new Promise(r => setTimeout(r, espera));
                continue;
            }

            if (!response.ok) throw new Error(`Gemini ${response.status}`);

            const data = await response.json();
            const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!texto) throw new Error('Respuesta vacía');

            console.log(`   ✅ Respuesta Gemini exitosa`);
            return texto;

        } catch (error) {
            console.error(`   ❌ Error intento ${intento + 1}: ${error.message}`);
            if (intento < reintentos - 1) {
                const espera = Math.pow(2, intento) * 3000;
                await new Promise(r => setTimeout(r, espera));
            }
        }
    }
    throw new Error('Gemini no respondió después de ' + reintentos + ' intentos');
}

// ==================== BANCO DE IMÁGENES INTELIGENTE ====================
// Cada subtema tiene 4 imágenes Pexels directas (con parámetros de compresión)
// Gemini elige el subtema según el contenido real de la noticia

const PEXELS = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=800';

const BANCO_INTELIGENTE = {
    // ── POLÍTICA Y GOBIERNO ──────────────────────────────────────────
    'politica-gobierno': [
        `${PEXELS}/3052454/pexels-photo-3052454.jpeg${OPT}`,
        `${PEXELS}/290595/pexels-photo-290595.jpeg${OPT}`,
        `${PEXELS}/3616480/pexels-photo-3616480.jpeg${OPT}`,
        `${PEXELS}/3183150/pexels-photo-3183150.jpeg${OPT}`
    ],
    // ── SEGURIDAD / POLICÍA / CRIMEN ─────────────────────────────────
    'seguridad-policia': [
        `${PEXELS}/6261776/pexels-photo-6261776.jpeg${OPT}`,
        `${PEXELS}/5699456/pexels-photo-5699456.jpeg${OPT}`,
        `${PEXELS}/3807517/pexels-photo-3807517.jpeg${OPT}`,
        `${PEXELS}/6980997/pexels-photo-6980997.jpeg${OPT}`
    ],
    // ── RELACIONES INTERNACIONALES / TRUMP / DIPLOMACIA ──────────────
    'relaciones-internacionales': [
        `${PEXELS}/2860705/pexels-photo-2860705.jpeg${OPT}`,
        `${PEXELS}/358319/pexels-photo-358319.jpeg${OPT}`,
        `${PEXELS}/3407617/pexels-photo-3407617.jpeg${OPT}`,
        `${PEXELS}/3997992/pexels-photo-3997992.jpeg${OPT}`
    ],
    // ── ECONOMÍA / MERCADO / FINANZAS ────────────────────────────────
    'economia-mercado': [
        `${PEXELS}/4386466/pexels-photo-4386466.jpeg${OPT}`,
        `${PEXELS}/6772070/pexels-photo-6772070.jpeg${OPT}`,
        `${PEXELS}/3532557/pexels-photo-3532557.jpeg${OPT}`,
        `${PEXELS}/6801648/pexels-photo-6801648.jpeg${OPT}`
    ],
    // ── CONSTRUCCIÓN / INFRAESTRUCTURA / INVIVIENDA ──────────────────
    'infraestructura': [
        `${PEXELS}/1216589/pexels-photo-1216589.jpeg${OPT}`,
        `${PEXELS}/323780/pexels-photo-323780.jpeg${OPT}`,
        `${PEXELS}/2219024/pexels-photo-2219024.jpeg${OPT}`,
        `${PEXELS}/3183197/pexels-photo-3183197.jpeg${OPT}`
    ],
    // ── SALUD / MEDICINA ─────────────────────────────────────────────
    'salud-medicina': [
        `${PEXELS}/3786157/pexels-photo-3786157.jpeg${OPT}`,
        `${PEXELS}/40568/pexels-photo-40568.jpeg${OPT}`,
        `${PEXELS}/4386467/pexels-photo-4386467.jpeg${OPT}`,
        `${PEXELS}/1170979/pexels-photo-1170979.jpeg${OPT}`
    ],
    // ── DEPORTE: BÉISBOL ─────────────────────────────────────────────
    'deporte-beisbol': [
        `${PEXELS}/1661950/pexels-photo-1661950.jpeg${OPT}`,
        `${PEXELS}/209977/pexels-photo-209977.jpeg${OPT}`,
        `${PEXELS}/248318/pexels-photo-248318.jpeg${OPT}`,
        `${PEXELS}/1884574/pexels-photo-1884574.jpeg${OPT}`
    ],
    // ── DEPORTE: FÚTBOL ──────────────────────────────────────────────
    'deporte-futbol': [
        `${PEXELS}/46798/pexels-photo-46798.jpeg${OPT}`,
        `${PEXELS}/3621943/pexels-photo-3621943.jpeg${OPT}`,
        `${PEXELS}/3873098/pexels-photo-3873098.jpeg${OPT}`,
        `${PEXELS}/1884574/pexels-photo-1884574.jpeg${OPT}`
    ],
    // ── DEPORTE: GENERAL / ATLETISMO ─────────────────────────────────
    'deporte-general': [
        `${PEXELS}/863988/pexels-photo-863988.jpeg${OPT}`,
        `${PEXELS}/936094/pexels-photo-936094.jpeg${OPT}`,
        `${PEXELS}/2526878/pexels-photo-2526878.jpeg${OPT}`,
        `${PEXELS}/3621943/pexels-photo-3621943.jpeg${OPT}`
    ],
    // ── TECNOLOGÍA / INNOVACIÓN ──────────────────────────────────────
    'tecnologia': [
        `${PEXELS}/3861958/pexels-photo-3861958.jpeg${OPT}`,
        `${PEXELS}/2582937/pexels-photo-2582937.jpeg${OPT}`,
        `${PEXELS}/5632399/pexels-photo-5632399.jpeg${OPT}`,
        `${PEXELS}/3932499/pexels-photo-3932499.jpeg${OPT}`
    ],
    // ── EDUCACIÓN / ESCUELAS ─────────────────────────────────────────
    'educacion': [
        `${PEXELS}/256490/pexels-photo-256490.jpeg${OPT}`,
        `${PEXELS}/289737/pexels-photo-289737.jpeg${OPT}`,
        `${PEXELS}/1205651/pexels-photo-1205651.jpeg${OPT}`,
        `${PEXELS}/4143791/pexels-photo-4143791.jpeg${OPT}`
    ],
    // ── CULTURA / MÚSICA / ESPECTÁCULOS ──────────────────────────────
    'cultura-musica': [
        `${PEXELS}/1190297/pexels-photo-1190297.jpeg${OPT}`,
        `${PEXELS}/1540406/pexels-photo-1540406.jpeg${OPT}`,
        `${PEXELS}/3651308/pexels-photo-3651308.jpeg${OPT}`,
        `${PEXELS}/2521317/pexels-photo-2521317.jpeg${OPT}`
    ],
    // ── MEDIO AMBIENTE / CLIMA ───────────────────────────────────────
    'medio-ambiente': [
        `${PEXELS}/1108572/pexels-photo-1108572.jpeg${OPT}`,
        `${PEXELS}/1366919/pexels-photo-1366919.jpeg${OPT}`,
        `${PEXELS}/2559941/pexels-photo-2559941.jpeg${OPT}`,
        `${PEXELS}/414612/pexels-photo-414612.jpeg${OPT}`
    ],
    // ── TURISMO / PLAYAS RD ──────────────────────────────────────────
    'turismo': [
        `${PEXELS}/1450353/pexels-photo-1450353.jpeg${OPT}`,
        `${PEXELS}/1174732/pexels-photo-1174732.jpeg${OPT}`,
        `${PEXELS}/3601425/pexels-photo-3601425.jpeg${OPT}`,
        `${PEXELS}/2104152/pexels-photo-2104152.jpeg${OPT}`
    ],
    // ── ACCIDENTE / EMERGENCIA ───────────────────────────────────────
    'emergencia': [
        `${PEXELS}/1437862/pexels-photo-1437862.jpeg${OPT}`,
        `${PEXELS}/263402/pexels-photo-263402.jpeg${OPT}`,
        `${PEXELS}/3807517/pexels-photo-3807517.jpeg${OPT}`,
        `${PEXELS}/3616480/pexels-photo-3616480.jpeg${OPT}`
    ]
};

// Fallback por categoría principal si Gemini no devuelve subtema válido
const FALLBACK_POR_CATEGORIA = {
    'Nacionales':       'politica-gobierno',
    'Deportes':         'deporte-general',
    'Internacionales':  'relaciones-internacionales',
    'Economía':         'economia-mercado',
    'Tecnología':       'tecnologia',
    'Espectáculos':     'cultura-musica'
};

const SUBTEMAS_VALIDOS = Object.keys(BANCO_INTELIGENTE);

function elegirImagenPorSubtema(subtema, categoria) {
    // Normalizar subtema recibido de Gemini
    const subtemaLimpio = (subtema || '').toLowerCase().trim().replace(/[^a-z-]/g, '');
    
    // Buscar en el banco
    const banco = BANCO_INTELIGENTE[subtemaLimpio] 
               || BANCO_INTELIGENTE[FALLBACK_POR_CATEGORIA[categoria]]
               || BANCO_INTELIGENTE['politica-gobierno'];
    
    return banco[Math.floor(Math.random() * banco.length)];
}

function obtenerImagenDirecta(titulo, categoria, subtema) {
    const url = elegirImagenPorSubtema(subtema, categoria);
    return {
        url,
        nombre: 'pexels.jpg',
        fuente: 'pexels',
        alt: titulo,
        title: titulo,
        caption: `Fotografía ilustrativa: ${titulo}`
    };
}

// ==================== UTILIDADES ====================
function generarMetadatos(titulo, slug, categoria, contenido) {
    const descripcion = contenido.split('\n')[0].substring(0, 160).trim();
    const keywords = [categoria.toLowerCase(), 'República Dominicana', 'Santo Domingo Este', 'noticias']
        .concat(titulo.split(' ').filter(p => p.length > 4).slice(0, 3))
        .join(', ');
    return { title: `${titulo} | El Farol al Día`, descripcion, keywords };
}

function generarSchemaOrg(noticia, imagen) {
    return {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": noticia.titulo,
        "image": { "@type": "ImageObject", "url": imagen.url, "caption": imagen.caption },
        "datePublished": new Date(noticia.fecha).toISOString(),
        "author": { "@type": "Person", "name": noticia.redactor },
        "publisher": { "@type": "Organization", "name": "El Farol al Día", "logo": { "@type": "ImageObject", "url": `${BASE_URL}/static/favicon.png` } }
    };
}

const REDACTORES = [
    { nombre: 'Carlos Méndez',          especialidad: 'Nacionales' },
    { nombre: 'Laura Santana',          especialidad: 'Deportes' },
    { nombre: 'Roberto Peña',           especialidad: 'Internacionales' },
    { nombre: 'Ana María Castillo',     especialidad: 'Economía' },
    { nombre: 'José Miguel Fernández',  especialidad: 'Tecnología' },
    { nombre: 'Patricia Jiménez',       especialidad: 'Espectáculos' }
];

function elegirRedactor(categoria) {
    const esp = REDACTORES.filter(r => r.especialidad === categoria);
    return esp.length > 0 ? esp[Math.floor(Math.random() * esp.length)].nombre : 'Redacción EFD';
}

function generarSlug(texto) {
    return texto.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80);
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

        // Migración segura: asegurar columnas si ya existía la tabla
        const columnas = ['imagen_alt', 'imagen_caption', 'imagen_nombre', 'imagen_fuente'];
        for (const col of columnas) {
            await client.query(`
                DO $$ BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_name='noticias' AND column_name='${col}'
                    ) THEN
                        ALTER TABLE noticias ADD COLUMN ${col} TEXT;
                    END IF;
                END $$;
            `).catch(() => {});
        }

        // Reparar imágenes rotas de versiones anteriores (caché local)
        const fixResult = await client.query(`
            UPDATE noticias 
            SET imagen = '${PEXELS}/3052454/pexels-photo-3052454.jpeg${OPT}',
                imagen_fuente = 'pexels'
            WHERE imagen LIKE '%/images/cache/%' 
               OR imagen LIKE '%fallback%'
               OR imagen IS NULL
               OR imagen = ''
        `);
        if (fixResult.rowCount > 0) {
            console.log(`🔧 Reparadas ${fixResult.rowCount} imágenes rotas`);
        }

        console.log('✅ BD lista');
    } catch (e) {
        console.error('❌ Error BD:', e.message);
    } finally {
        client.release();
    }
}

// ==================== GENERACIÓN DE NOTICIAS ====================
async function generarNoticia(categoria) {
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };

        // Lista de subtemas válidos para que Gemini elija con criterio
        const subtemasStr = SUBTEMAS_VALIDOS.join(', ');

        const prompt = `${CONFIG_IA.instruccion_principal}

Escribe una noticia profesional sobre la categoría "${categoria}" con enfoque en República Dominicana.

TONO: ${CONFIG_IA.tono}
EXTENSIÓN: ${CONFIG_IA.extension} (400-500 palabras en CONTENIDO)
ÉNFASIS GEOGRÁFICO: ${CONFIG_IA.enfasis}
EVITAR: ${CONFIG_IA.evitar}

REGLA DE IMAGEN: Analiza el tema real de la noticia y elige el subtema visual más coherente.
Ejemplos de criterio:
- Si la noticia habla de Trump, EEUU, diplomacia → elige "relaciones-internacionales"  
- Si habla de policía, crimen, arrestos → elige "seguridad-policia"
- Si habla de carreteras, vivienda, obras → elige "infraestructura"
- Si habla de béisbol dominicano → elige "deporte-beisbol"
- Si habla de fútbol → elige "deporte-futbol"
- Si habla de hospital, dengue, salud pública → elige "salud-medicina"
- Si habla de huracán, inundación → elige "medio-ambiente"

Subtemas disponibles: ${subtemasStr}

RESPONDE EXACTAMENTE EN ESTE FORMATO (sin texto extra antes ni después):

TITULO: [título 50-60 caracteres, sin asteriscos]
DESCRIPCION: [descripción SEO 150-160 caracteres]
PALABRAS: [5 palabras clave separadas por comas]
SUBTEMA_IMAGEN: [elige UNO de los subtemas disponibles según el contenido real]
CONTENIDO:
[noticia 400-500 palabras, párrafos separados por línea en blanco]`;

        console.log(`\n📰 Generando noticia: ${categoria}`);
        const texto = await llamarGemini(prompt);

        let titulo = '', descripcion = '', palabras = categoria, subtema = '', contenido = '';
        const lineas = texto.split('\n');
        let enContenido = false;
        const contenidoTemp = [];

        for (const linea of lineas) {
            const trim = linea.trim();
            if (trim.startsWith('TITULO:'))          titulo       = trim.replace('TITULO:', '').trim();
            else if (trim.startsWith('DESCRIPCION:')) descripcion  = trim.replace('DESCRIPCION:', '').trim();
            else if (trim.startsWith('PALABRAS:'))    palabras     = trim.replace('PALABRAS:', '').trim();
            else if (trim.startsWith('SUBTEMA_IMAGEN:')) subtema   = trim.replace('SUBTEMA_IMAGEN:', '').trim();
            else if (trim.startsWith('CONTENIDO:'))   enContenido  = true;
            else if (enContenido && trim.length > 0)  contenidoTemp.push(trim);
        }

        contenido    = contenidoTemp.join('\n\n');
        titulo       = titulo.replace(/[*_#`]/g, '').trim();
        descripcion  = descripcion.replace(/[*_#`]/g, '').trim();

        if (!titulo || !contenido || contenido.length < 200) {
            throw new Error('Respuesta de Gemini incompleta');
        }

        console.log(`   📝 Título: ${titulo}`);
        console.log(`   🖼️  Subtema imagen: ${subtema || '(fallback por categoría)'}`);

        // Imagen inteligente: Pexels directo, sin descarga
        const imagen = obtenerImagenDirecta(titulo, categoria, subtema);

        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        const redactor = elegirRedactor(categoria);

        await pool.query(
            `INSERT INTO noticias 
            (titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor,
             imagen, imagen_alt, imagen_caption, imagen_nombre, imagen_fuente, estado)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
                titulo.substring(0, 255),
                slugFinal,
                categoria,
                contenido.substring(0, 10000),
                descripcion.substring(0, 160),
                palabras.substring(0, 255),
                redactor,
                imagen.url,
                imagen.alt,
                imagen.caption,
                imagen.nombre,
                imagen.fuente,
                'publicada'
            ]
        );

        console.log(`\n✅ NOTICIA PUBLICADA: ${slugFinal}`);
        return { success: true, slug: slugFinal, titulo, subtema_imagen: subtema, mensaje: '✅ Publicada' };

    } catch (error) {
        console.error('❌ Error generando noticia:', error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CRON ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

cron.schedule('0 */4 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    console.log(`\n⏰ CRON: Generando noticia automática...`);
    const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticia(cat);
});

// ==================== RUTAS ====================
app.get('/health', (req, res) => res.json({ status: 'OK', version: '25.0' }));
app.get('/',           (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion',  (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/contacto',   (req, res) => res.sendFile(path.join(__dirname, 'client', 'contacto.html')));
app.get('/nosotros',   (req, res) => res.sendFile(path.join(__dirname, 'client', 'nosotros.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'client', 'privacidad.html')));

app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, titulo, slug, seccion, imagen, imagen_alt, fecha, vistas, redactor 
             FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30`,
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    const resultado = await generarNoticia(categoria);
    res.status(resultado.success ? 200 : 500).json(resultado);
});

app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE slug=$1 AND estado=$2',
            [req.params.slug, 'publicada']
        );
        if (result.rows.length === 0) return res.status(404).send('Noticia no encontrada');

        const n = result.rows[0];
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id=$1', [n.id]);

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            const meta = generarMetadatos(n.titulo, n.slug, n.seccion, n.contenido);
            const schema = generarSchemaOrg(n, { url: n.imagen, caption: n.imagen_caption });
            const fechaISO = new Date(n.fecha).toISOString();
            const urlNoticia = `${BASE_URL}/noticia/${n.slug}`;

            const metaTags = `<title>${meta.title}</title>
<meta name="description" content="${meta.descripcion}">
<meta name="keywords" content="${meta.keywords}">
<meta name="author" content="${n.redactor}">
<meta property="og:title" content="${n.titulo}">
<meta property="og:description" content="${meta.descripcion}">
<meta property="og:image" content="${n.imagen}">
<meta property="og:url" content="${urlNoticia}">
<meta property="article:published_time" content="${fechaISO}">
<meta property="article:author" content="${n.redactor}">
<script type="application/ld+json">
${JSON.stringify(schema, null, 2)}
</script>`;

            const contenidoHTML = n.contenido
                .split('\n')
                .filter(p => p.trim())
                .map(p => `<p>${p.trim()}</p>`)
                .join('');

            html = html
                .replace('<!-- META_TAGS -->', metaTags)
                .replace(/{{TITULO}}/g,    n.titulo)
                .replace(/{{CONTENIDO}}/g, contenidoHTML)
                .replace(/{{FECHA}}/g,     new Date(n.fecha).toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }))
                .replace(/{{IMAGEN}}/g,    n.imagen)
                .replace(/{{ALT}}/g,       n.imagen_alt || n.titulo)
                .replace(/{{VISTAS}}/g,    n.vistas)
                .replace(/{{REDACTOR}}/g,  n.redactor)
                .replace(/{{SECCION}}/g,   n.seccion)
                .replace(/{{URL}}/g,       encodeURIComponent(urlNoticia))
                .replace(/{{URL_ENCODED_TITULO}}/g, encodeURIComponent(n.titulo));

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (e) {
            res.json({ success: true, noticia: n });
        }
    } catch (e) {
        res.status(500).send('Error del servidor');
    }
});

app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT slug, fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC',
            ['publicada']
        );
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
        result.rows.forEach(n => {
            xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><priority>0.8</priority></url>\n`;
        });
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (e) {
        res.status(500).send('Error');
    }
});

app.get('/robots.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nDisallow: /api/admin\nSitemap: ${BASE_URL}/sitemap.xml`);
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT COUNT(*) as count, SUM(vistas) as vistas FROM noticias WHERE estado=$1',
            ['publicada']
        );
        res.json({
            success: true,
            totalNoticias: parseInt(result.rows[0].count),
            totalVistas: parseInt(result.rows[0].vistas) || 0
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/configuracion', (req, res) => {
    try {
        const config = fs.existsSync(path.join(__dirname, 'config.json'))
            ? JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
            : { googleAnalytics: '' };
        res.json({ success: true, config });
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
    const { pin, titulo, seccion, contenido, redactor } = req.body;
    if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    if (!titulo || !seccion || !contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });
    try {
        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug=$1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        const imagenFallback = `${PEXELS}/3052454/pexels-photo-3052454.jpeg${OPT}`;

        await pool.query(
            `INSERT INTO noticias (titulo, slug, seccion, contenido, redactor, imagen, imagen_alt, imagen_caption, imagen_nombre, imagen_fuente, estado)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [titulo, slugFinal, seccion, contenido, redactor || 'Manual',
             imagenFallback, titulo, `Fotografía ilustrativa: ${titulo}`, 'pexels.jpg', 'pexels', 'publicada']
        );
        res.json({ success: true, slug: slugFinal });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/config', (req, res) => {
    if (req.query.pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    res.json(CONFIG_IA);
});

app.post('/api/admin/config', express.json(), (req, res) => {
    const { pin, enabled, instruccion_principal, tono, extension, evitar, enfasis } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    if (enabled !== undefined)          CONFIG_IA.enabled = enabled;
    if (instruccion_principal)          CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono)                           CONFIG_IA.tono = tono;
    if (extension)                      CONFIG_IA.extension = extension;
    if (evitar)                         CONFIG_IA.evitar = evitar;
    if (enfasis)                        CONFIG_IA.enfasis = enfasis;
    res.json({ success: guardarConfigIA(CONFIG_IA) });
});

app.get('/status', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        res.json({
            status: 'OK',
            version: '25.0',
            noticias: parseInt(result.rows[0].count),
            sistema: 'Pexels directo + Gemini imagen inteligente',
            subtemas_disponibles: SUBTEMAS_VALIDOS.length,
            ia_activa: CONFIG_IA.enabled
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// SPA fallback
app.use((req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// ==================== ARRANQUE ====================
async function iniciar() {
    try {
        await inicializarBase();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════╗
║     🏮 EL FAROL AL DÍA - V25.0                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  ✅ Imágenes Pexels DIRECTAS (sin proxy, sin imágenes negras)    ║
║  ✅ Gemini elige SUBTEMA visual coherente con el contenido       ║
║  ✅ 15 subtemas: policía, Trump/diplomacia, béisbol, salud...    ║
║  ✅ Auto-reparación de imágenes rotas al iniciar                 ║
║  ✅ Migración automática de columnas BD                          ║
║  ✅ CRON cada 4 horas                                            ║
║                                                                  ║
║  🖼️  LÓGICA DE IMAGEN:                                           ║
║     Gemini analiza la noticia → elige subtema → imagen coherente ║
║     Trump/EEUU → relaciones-internacionales                      ║
║     Policía/crimen → seguridad-policia                           ║
║     Béisbol → deporte-beisbol | Obras → infraestructura          ║
╚══════════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Fatal:', error);
        process.exit(1);
    }
}

iniciar();
module.exports = app;

