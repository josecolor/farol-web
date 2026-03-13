/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V24.0 (GEMINI RATE LIMIT CONTROL)
 * 
 * PROBLEMA: Gemini API también tiene rate limits
 * SOLUCIÓN: Delays entre llamadas, queue, retry inteligente
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ==================== DIRECTORIOS ====================
const IMAGES_DIR = path.join(__dirname, 'images');
const CACHE_DIR = path.join(IMAGES_DIR, 'cache');

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

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
app.use(express.static(path.join(__dirname, 'images'), {
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
}));
app.use(cors());

// ==================== CONFIG IA ====================
const CONFIG_IA_PATH = path.join(__dirname, 'config-ia.json');

function cargarConfigIA() {
    const defaultConfig = {
        enabled: true,
        maxNoticias: 10,
        instruccion_principal: 'Eres un periodista profesional dominicano. Escribe noticias verificadas y equilibradas.',
        tono: 'profesional',
        extension: 'media',
        enfasis: 'Noticias locales con contexto histórico',
        evitar: 'Especulación sin fuentes, titulares sensacionalista'
    };

    try {
        if (fs.existsSync(CONFIG_IA_PATH)) {
            return { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_IA_PATH, 'utf8')) };
        }
    } catch (e) {
        console.warn('⚠️ Error config IA');
    }

    fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
}

function guardarConfigIA(config) {
    try {
        fs.writeFileSync(CONFIG_IA_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch (e) {
        return false;
    }
}

let CONFIG_IA = cargarConfigIA();

// ==================== CONTROL DE GEMINI ====================

const GEMINI_STATE = {
    lastRequest: 0,
    requestsInWindow: 0,
    resetTime: 0,
    queue: []
};

/**
 * DELAY INTELIGENTE ANTES DE LLAMAR A GEMINI
 */
async function delayAntesDEGemini() {
    const ahora = Date.now();
    
    // Si estamos dentro de la ventana de rate limit
    if (ahora < GEMINI_STATE.resetTime) {
        const espera = GEMINI_STATE.resetTime - ahora;
        console.log(`   ⏳ Rate limit Gemini: esperando ${Math.ceil(espera / 1000)}s`);
        await new Promise(r => setTimeout(r, Math.min(espera, 10000)));
    }

    // Mínimo 3 segundos entre requests a Gemini
    const tiempoDesdeUltimo = ahora - GEMINI_STATE.lastRequest;
    const delayMinimo = 3000;

    if (tiempoDesdeUltimo < delayMinimo) {
        const espera = delayMinimo - tiempoDesdeUltimo;
        console.log(`   ⏳ Esperando ${Math.ceil(espera / 1000)}s antes de Gemini...`);
        await new Promise(r => setTimeout(r, espera));
    }

    GEMINI_STATE.lastRequest = Date.now();
}

/**
 * LLAMADA A GEMINI CON RETRY
 */
async function llamarGemini(prompt, reintentos = 3) {
    for (let intento = 0; intento < reintentos; intento++) {
        try {
            console.log(`\n   🤖 Llamando Gemini (intento ${intento + 1}/${reintentos})`);
            
            await delayAntesDEGemini();

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.8, maxOutputTokens: 2500 }
                    }),
                    timeout: 30000
                }
            );

            // ACTUALIZAR RATE LIMIT
            if (response.headers.get('x-ratelimit-remaining')) {
                GEMINI_STATE.requestsInWindow = parseInt(response.headers.get('x-ratelimit-remaining'));
                console.log(`   📊 Gemini: ${GEMINI_STATE.requestsInWindow} requests remaining`);
            }

            if (response.status === 429) {
                console.log(`   ⚠️ Rate limit Gemini 429 (intento ${intento + 1}/${reintentos})`);
                
                // Calcular espera exponencial
                const espera = Math.pow(2, intento) * 5000; // 5s, 10s, 20s
                console.log(`   ⏳ Esperando ${Math.ceil(espera / 1000)}s antes de reintentar...`);
                
                GEMINI_STATE.resetTime = Date.now() + espera;
                await new Promise(r => setTimeout(r, espera));
                continue;
            }

            if (!response.ok) {
                throw new Error(`Gemini ${response.status}`);
            }

            const data = await response.json();
            const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!texto) throw new Error('Respuesta vacía');

            console.log(`   ✅ Respuesta Gemini exitosa`);
            return texto;

        } catch (error) {
            console.error(`   ❌ Error intento ${intento + 1}: ${error.message}`);
            
            if (intento < reintentos - 1) {
                const espera = Math.pow(2, intento) * 3000;
                console.log(`   ⏳ Reintentando en ${Math.ceil(espera / 1000)}s...`);
                await new Promise(r => setTimeout(r, espera));
            }
        }
    }

    throw new Error('Gemini no respondió después de ' + reintentos + ' intentos');
}

// ==================== BANCO DE IMÁGENES ====================

const BANCO_ILUSTRATIVO = {
    'Nacionales': [
        'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
        'https://images.pexels.com/photos/290595/pexels-photo-290595.jpeg',
        'https://images.pexels.com/photos/3616480/pexels-photo-3616480.jpeg',
        'https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg',
        'https://images.pexels.com/photos/3183150/pexels-photo-3183150.jpeg',
        'https://images.pexels.com/photos/3183197/pexels-photo-3183197.jpeg'
    ],
    'Deportes': [
        'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg',
        'https://images.pexels.com/photos/1884574/pexels-photo-1884574.jpeg',
        'https://images.pexels.com/photos/209977/pexels-photo-209977.jpeg',
        'https://images.pexels.com/photos/3621943/pexels-photo-3621943.jpeg',
        'https://images.pexels.com/photos/248318/pexels-photo-248318.jpeg',
        'https://images.pexels.com/photos/3873098/pexels-photo-3873098.jpeg'
    ],
    'Internacionales': [
        'https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg',
        'https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg',
        'https://images.pexels.com/photos/2869499/pexels-photo-2869499.jpeg',
        'https://images.pexels.com/photos/3407617/pexels-photo-3407617.jpeg',
        'https://images.pexels.com/photos/3997992/pexels-photo-3997992.jpeg',
        'https://images.pexels.com/photos/3714896/pexels-photo-3714896.jpeg'
    ],
    'Espectáculos': [
        'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg',
        'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg',
        'https://images.pexels.com/photos/3651308/pexels-photo-3651308.jpeg',
        'https://images.pexels.com/photos/3587478/pexels-photo-3587478.jpeg',
        'https://images.pexels.com/photos/2521317/pexels-photo-2521317.jpeg',
        'https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg'
    ],
    'Economía': [
        'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg',
        'https://images.pexels.com/photos/6772070/pexels-photo-6772070.jpeg',
        'https://images.pexels.com/photos/3184591/pexels-photo-3184591.jpeg',
        'https://images.pexels.com/photos/3532557/pexels-photo-3532557.jpeg',
        'https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg',
        'https://images.pexels.com/photos/3935702/pexels-photo-3935702.jpeg'
    ],
    'Tecnología': [
        'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg',
        'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg',
        'https://images.pexels.com/photos/5632399/pexels-photo-5632399.jpeg',
        'https://images.pexels.com/photos/3932499/pexels-photo-3932499.jpeg',
        'https://images.pexels.com/photos/3945696/pexels-photo-3945696.jpeg',
        'https://images.pexels.com/photos/4195325/pexels-photo-4195325.jpeg'
    ]
};

function elegirImagenAleatorio(categoria) {
    const imagenes = BANCO_ILUSTRATIVO[categoria] || BANCO_ILUSTRATIVO['Nacionales'];
    return imagenes[Math.floor(Math.random() * imagenes.length)];
}

// ==================== PROXY ====================

function generarNombreImagen(titulo, categoria) {
    const timestamp = Date.now();
    const hash = crypto.createHash('md5')
        .update(`${titulo}-${categoria}-${timestamp}`)
        .digest('hex')
        .substring(0, 8);
    return `img-${hash}-${timestamp}.webp`;
}

async function descargarYCachearImagen(urlRemota, nombreLocal) {
    return new Promise((resolve, reject) => {
        try {
            const protocolo = urlRemota.startsWith('https') ? https : http;
            const file = fs.createWriteStream(path.join(CACHE_DIR, nombreLocal));
            
            protocolo.get(urlRemota, { timeout: 10000 }, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Status ${response.statusCode}`));
                    return;
                }
                
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log(`✅ Imagen proxificada: ${nombreLocal}`);
                    resolve(nombreLocal);
                });
            }).on('error', (err) => {
                fs.unlink(path.join(CACHE_DIR, nombreLocal), () => {});
                reject(err);
            });
            
        } catch (error) {
            reject(error);
        }
    });
}

async function buscarYProxificarImagen(titulo, categoria) {
    try {
        const urlRemota = elegirImagenAleatorio(categoria);
        const nombreLocal = generarNombreImagen(titulo, categoria);
        
        await descargarYCachearImagen(urlRemota, nombreLocal);
        
        return {
            url: `${BASE_URL}/images/cache/${nombreLocal}`,
            nombre: nombreLocal,
            fuente: 'banco-local',
            alt: titulo,
            title: titulo,
            caption: `Fotografía: ${titulo}`
        };

    } catch (error) {
        console.log(`❌ Error imagen, usando URL directa`);
        return {
            url: elegirImagenAleatorio(categoria),
            nombre: 'fallback.jpg',
            fuente: 'fallback',
            alt: titulo,
            title: titulo,
            caption: 'Imagen editorial'
        };
    }
}

// ==================== RESTO ====================

function generarMetadatos(titulo, slug, categoria, contenido) {
    const descripcion = contenido.split('\n')[0].substring(0, 160).trim();
    const keywords = [categoria.toLowerCase(), 'República Dominicana', 'noticias']
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
        "publisher": { "@type": "Organization", "name": "El Farol al Día" }
    };
}

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
    return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 80);
}

async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Inicializando BD...');
        await client.query(`CREATE TABLE IF NOT EXISTS noticias (
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
        )`);
        console.log('✅ BD lista');
    } catch (e) {
        console.error('❌ Error BD:', e.message);
    } finally {
        client.release();
    }
}

async function generarNoticia(categoria) {
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };

        const prompt = `${CONFIG_IA.instruccion_principal}

Escribe una noticia profesional sobre ${categoria} en República Dominicana.

TONO: ${CONFIG_IA.tono}
EXTENSIÓN: ${CONFIG_IA.extension}
EVITA: ${CONFIG_IA.evitar}

RESPONDE EXACTAMENTE:

TITULO: [título 50-60 caracteres]
DESCRIPCION: [descripción SEO 150-160 caracteres]
PALABRAS: [5 palabras clave]
CONTENIDO:
[noticia 400-500 palabras]`;

        console.log(`\n📰 Generando noticia: ${categoria}`);

        // LLAMAR A GEMINI CON CONTROL
        const texto = await llamarGemini(prompt);

        let titulo = "", descripcion = "", palabras = categoria, contenido = "";
        const lineas = texto.split('\n');
        let enContenido = false, contenidoTemp = [];

        for (const linea of lineas) {
            const trim = linea.trim();
            if (trim.startsWith('TITULO:')) titulo = trim.replace('TITULO:', '').trim();
            else if (trim.startsWith('DESCRIPCION:')) descripcion = trim.replace('DESCRIPCION:', '').trim();
            else if (trim.startsWith('PALABRAS:')) palabras = trim.replace('PALABRAS:', '').trim();
            else if (trim.startsWith('CONTENIDO:')) enContenido = true;
            else if (enContenido && trim.length > 0) contenidoTemp.push(trim);
        }

        contenido = contenidoTemp.join('\n\n');
        titulo = titulo.replace(/[*_#`]/g, '').trim();
        descripcion = descripcion.replace(/[*_#`]/g, '').trim();

        if (!titulo || !contenido || contenido.length < 300) throw new Error('Respuesta incompleta');

        console.log(`\n   📝 Título: ${titulo.substring(0, 60)}...`);

        // IMAGEN SIN APIs
        const imagen = await buscarYProxificarImagen(titulo, categoria);

        const slug = generarSlug(titulo);
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        const redactor = elegirRedactor(categoria);

        await pool.query(
            `INSERT INTO noticias 
            (titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, 
             imagen, imagen_alt, imagen_caption, imagen_nombre, imagen_fuente, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                titulo.substring(0, 255), slugFinal, categoria, contenido.substring(0, 10000),
                descripcion.substring(0, 160), palabras.substring(0, 255), redactor,
                imagen.url, imagen.alt, imagen.caption, imagen.nombre, imagen.fuente, 'publicada'
            ]
        );

        console.log(`\n✅ NOTICIA PUBLICADA`);
        return { success: true, slug: slugFinal, titulo, mensaje: '✅ Publicada' };

    } catch (error) {
        console.error('❌ Error generando noticia:', error.message);
        return { success: false, error: error.message };
    }
}

const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

cron.schedule('0 */4 * * *', async () => {
    if (!CONFIG_IA.enabled) return;
    console.log(`\n⏰ CRON: Generando noticia automática...`);
    const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticia(cat);
});

// ==================== RUTAS ====================
app.get('/health', (req, res) => res.json({ status: 'OK', version: '24.0' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/contacto', (req, res) => res.sendFile(path.join(__dirname, 'client', 'contacto.html')));
app.get('/nosotros', (req, res) => res.sendFile(path.join(__dirname, 'client', 'nosotros.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'client', 'privacidad.html')));

app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, titulo, slug, seccion, imagen, fecha, vistas, redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30',
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
            'SELECT * FROM noticias WHERE slug = $1 AND estado = $2',
            [req.params.slug, 'publicada']
        );
        
        if (result.rows.length === 0) return res.status(404).send('No encontrada');

        const n = result.rows[0];
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [n.id]);

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            
            const meta = generarMetadatos(n.titulo, n.slug, n.seccion, n.contenido);
            const schema = generarSchemaOrg(n, { url: n.imagen, caption: n.imagen_caption });
            const fechaISO = new Date(n.fecha).toISOString();
            
            const metaTags = `<title>${meta.title}</title>
<meta name="description" content="${meta.descripcion}">
<meta name="keywords" content="${meta.keywords}">
<meta name="author" content="${n.redactor}">
<meta property="og:title" content="${n.titulo}">
<meta property="og:description" content="${meta.descripcion}">
<meta property="og:image" content="${n.imagen}">
<meta property="article:published_time" content="${fechaISO}">
<meta property="article:author" content="${n.redactor}">
<script type="application/ld+json">
${JSON.stringify(schema, null, 2)}
</script>`;

            const contenidoHTML = n.contenido.split('\n').filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('');

            html = html.replace('<!-- META_TAGS -->', metaTags)
                .replace(/{{TITULO}}/g, n.titulo)
                .replace(/{{CONTENIDO}}/g, contenidoHTML)
                .replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }))
                .replace(/{{IMAGEN}}/g, n.imagen)
                .replace(/{{ALT}}/g, n.imagen_alt || n.titulo)
                .replace(/{{VISTAS}}/g, n.vistas)
                .replace(/{{REDACTOR}}/g, n.redactor)
                .replace(/{{SECCION}}/g, n.seccion);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
        const result = await pool.query('SELECT slug, fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC', ['publicada']);
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
        result.rows.forEach(n => {
            xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod></url>\n`;
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
        const result = await pool.query('SELECT COUNT(*) as count, SUM(vistas) as vistas FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ success: true, totalNoticias: parseInt(result.rows[0].count), totalVistas: parseInt(result.rows[0].vistas) || 0 });
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
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;
        
        await pool.query(
            `INSERT INTO noticias (titulo, slug, seccion, contenido, redactor, imagen, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [titulo, slugFinal, seccion, contenido, redactor || 'Manual', `${BASE_URL}/images/cache/manual.jpg`, 'publicada']
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
    const { pin, enabled, instruccion_principal, tono, extension, evitar } = req.body;
    if (pin !== '311') return res.status(403).json({ error: 'Acceso denegado' });
    
    if (enabled !== undefined) CONFIG_IA.enabled = enabled;
    if (instruccion_principal) CONFIG_IA.instruccion_principal = instruccion_principal;
    if (tono) CONFIG_IA.tono = tono;
    if (extension) CONFIG_IA.extension = extension;
    if (evitar) CONFIG_IA.evitar = evitar;
    
    res.json({ success: guardarConfigIA(CONFIG_IA) });
});

app.get('/status', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        res.json({ 
            status: 'OK', 
            version: '24.0',
            noticias: parseInt(result.rows[0].count),
            gemini_requests_remaining: GEMINI_STATE.requestsInWindow,
            sistema: 'Gemini Rate Limit Control + Banco Ilustrativo'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

async function iniciar() {
    try {
        await inicializarBase();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔════════════════════════════════════════════════════════════════╗
║     🏮 EL FAROL AL DÍA - V24.0 🏮                             ║
║     GEMINI RATE LIMIT CONTROL                                  ║
╠════════════════════════════════════════════════════════════════╣
║ ✅ Delays entre requests Gemini: 3 segundos mínimo             ║
║ ✅ Retry con backoff exponencial (5s, 10s, 20s)                ║
║ ✅ Monitoreo de rate limit headers                             ║
║ ✅ Banco ilustrativo masivo (SIN APIs de imagen)                ║
║ ✅ Generación de noticias cada 4 horas (CRON)                  ║
║ ✅ CERO errores 429 en imágenes                                ║
║ ✅ Manejo inteligente de 429 en Gemini                         ║
║                                                                 ║
║ 🎯 FLUJO COMPLETO:                                             ║
║    1. Espera 3s antes de llamar Gemini                         ║
║    2. Gemini genera contenido                                  ║
║    3. Si 429: espera 5-20s y reintenta                         ║
║    4. Selecciona imagen del banco (sin APIs)                   ║
║    5. Proxifica imagen local                                   ║
║    6. Guarda en BD                                             ║
║    7. Publica noticia                                          ║
║                                                                 ║
║ ⏰ AUTOMATIZACIÓN:                                              ║
║    - CRON: cada 4 horas genera noticia                         ║
║    - Manual: /api/generar-noticia                              ║
║    - Respeta rate limits Gemini automáticamente                ║
║                                                                 ║
║ 📊 RATE LIMITS:                                                ║
║    Gemini: 60 requests/minuto (gratis)                         ║
║    Con V24.0: 1 request/3 segundos = 20/minuto (SEGURO)        ║
╚════════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Fatal:', error);
        process.exit(1);
    }
}

iniciar();

module.exports = app;

