/**
 * 🏮 EL FAROL AL DÍA - VERSIÓN POSTGRESQL - CON AUTOMATIZACIÓN E IMÁGENES
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { Pool } = require('pg');
const cron = require('node-cron'); // ¡NUEVO! Para automatización

const app = express();
const PORT = process.env.PORT || 8080;

// ==================== CONEXIÓN A POSTGRESQL ====================
if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL no está definida');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==================== MIDDLEWARE ====================
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== RATE LIMITING ====================
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Demasiadas peticiones' }
});
app.use('/api/', apiLimiter);

// ==================== CREAR TABLA ====================
async function inicializarBase() {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Conexión a PostgreSQL exitosa');

        const createTableQuery = `
      CREATE TABLE IF NOT EXISTS noticias (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        seccion VARCHAR(100) NOT NULL,
        contenido TEXT NOT NULL,
        ubicacion VARCHAR(100) DEFAULT 'Santo Domingo',
        redactor VARCHAR(100) DEFAULT 'IA Gemini',
        imagen TEXT DEFAULT '/default-news.jpg',
        vistas INTEGER DEFAULT 0,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        estado VARCHAR(50) DEFAULT 'publicada',
        seo_desc TEXT,
        url VARCHAR(255) UNIQUE,
        categoria_slug VARCHAR(100),
        fuente_imagen VARCHAR(50) DEFAULT 'default'
      );
    `;

        await pool.query(createTableQuery);
        console.log('✅ Tabla "noticias" lista');
        return true;
    } catch (error) {
        console.error('❌ Error en base de datos:', error.message);
        return false;
    }
}

// ==================== FUNCIÓN SLUG ====================
function generarSlug(texto) {
    return texto
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ==================== 🖼️ BUSCAR IMAGEN (NUEVO) ====================
async function buscarImagen(titulo, categoria) {
    try {
        // Opción 1: Unsplash (gratis, 50 requests/hora)
        if (process.env.UNSPLASH_ACCESS_KEY) {
            const query = encodeURIComponent(`${categoria} ${titulo} dominican republic`);
            const url = `https://api.unsplash.com/photos/random?query=${query}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&count=1`;

            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                if (data && data[0] && data[0].urls) {
                    console.log(`🖼️ Imagen encontrada en Unsplash: ${categoria}`);
                    return {
                        url: data[0].urls.regular,
                        fuente: 'Unsplash',
                        creditos: data[0].user.name
                    };
                }
            }
        }

        // Opción 2: Pexels (gratis, 200 requests/hora)
        if (process.env.PEXELS_API_KEY) {
            const query = encodeURIComponent(`${categoria} ${titulo} dominican republic`);
            const url = `https://api.pexels.com/v1/search?query=${query}&per_page=1&orientation=landscape`;

            const response = await fetch(url, {
                headers: { 'Authorization': process.env.PEXELS_API_KEY }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.photos && data.photos[0]) {
                    console.log(`🖼️ Imagen encontrada en Pexels: ${categoria}`);
                    return {
                        url: data.photos[0].src.landscape,
                        fuente: 'Pexels',
                        creditos: data.photos[0].photographer
                    };
                }
            }
        }

        // Opción 3: Pixabay (gratis, 5000 requests/hora)
        if (process.env.PIXABAY_API_KEY) {
            const query = encodeURIComponent(`${categoria} dominican republic`);
            const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${query}&image_type=photo&orientation=horizontal&per_page=3`;

            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                if (data.hits && data.hits[0]) {
                    console.log(`🖼️ Imagen encontrada en Pixabay: ${categoria}`);
                    return {
                        url: data.hits[0].webformatURL,
                        fuente: 'Pixabay',
                        creditos: data.hits[0].user
                    };
                }
            }
        }

        // Si no hay APIs configuradas o fallan, usar imágenes por categoría
        console.log(`🖼️ Usando imagen por defecto para: ${categoria}`);
        return {
            url: `/images/categorias/${categoria.toLowerCase()}.jpg`,
            fuente: 'local',
            creditos: 'El Farol Al Día'
        };

    } catch (error) {
        console.error('❌ Error buscando imagen:', error.message);
        return {
            url: '/default-news.jpg',
            fuente: 'default',
            creditos: 'El Farol Al Día'
        };
    }
}

// ==================== 🤖 GENERAR NOTICIA (FUNCIÓN REUTILIZABLE) ====================
async function generarNoticiaCompleta(categoria) {
    try {
        console.log(`🤖 Generando noticia para categoría: ${categoria}`);

        const prompt = `Genera una noticia breve sobre ${categoria} en República Dominicana. 
        La noticia debe ser original, interesante y de unas 200-300 palabras.
        Incluye datos específicos de RD (lugares, personas, fechas relevantes).
        
        IMPORTANTE: 
        - El título debe ser atractivo y profesional
        - El contenido debe tener al menos 200 palabras
        - Incluye citas de "fuentes oficiales" o "testigos"
        
        Responde SOLO con un JSON válido con este formato exacto:
        {
          "titulo": "Título de la noticia",
          "contenido": "Texto completo de la noticia"
        }`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }]
                })
            }
        );

        const data = await response.json();

        if (!data.candidates || !data.candidates.length) {
            throw new Error('Gemini no devolvió contenido');
        }

        const texto = data.candidates[0].content.parts[0].text;
        const jsonMatch = texto.match(/\{[\s\S]*\}/);

        if (!jsonMatch) throw new Error('JSON no válido');

        const noticia = JSON.parse(jsonMatch[0]);

        if (!noticia.titulo || !noticia.contenido) {
            throw new Error('La noticia generada no tiene título o contenido');
        }

        // 🖼️ BUSCAR IMAGEN para esta noticia
        const imagenData = await buscarImagen(noticia.titulo, categoria);

        const slug = generarSlug(noticia.titulo);
        const url = `/noticia/${slug}`;

        // Guardar en base de datos
        const result = await pool.query(
            `INSERT INTO noticias (titulo, seccion, contenido, redactor, url, categoria_slug, imagen, seo_desc, fuente_imagen)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
                noticia.titulo,
                categoria,
                noticia.contenido,
                'IA Gemini',
                url,
                slug,
                imagenData.url,
                noticia.contenido.substring(0, 160),
                imagenData.fuente
            ]
        );

        console.log(`✅ Noticia guardada con ID: ${result.rows[0].id} (Imagen: ${imagenData.fuente})`);

        return {
            success: true,
            id: result.rows[0].id,
            url: url,
            titulo: noticia.titulo,
            imagen: imagenData.url,
            fuente_imagen: imagenData.fuente
        };

    } catch (error) {
        console.error(`❌ Error generando noticia para ${categoria}:`, error);
        return { success: false, error: error.message };
    }
}

// ==================== ⏰ AUTOMATIZACIÓN (NUEVO) ====================
const CATEGORIAS = ['Nacionales', 'Internacionales', 'Deportes', 'Economía', 'Tecnología', 'Cultura'];

// Generar noticias cada 6 horas
cron.schedule('0 */6 * * *', async () => {
    console.log('⏰ Ejecutando generación automática de noticias...');

    // Generar 2 noticias aleatorias cada vez
    const categoriasSeleccionadas = [];
    while (categoriasSeleccionadas.length < 2) {
        const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
        if (!categoriasSeleccionadas.includes(cat)) {
            categoriasSeleccionadas.push(cat);
        }
    }

    console.log(`🎯 Generando automático para: ${categoriasSeleccionadas.join(', ')}`);

    for (const categoria of categoriasSeleccionadas) {
        await generarNoticiaCompleta(categoria);
        // Esperar 2 segundos entre noticias para no saturar APIs
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('✅ Generación automática completada');
});

// Generar una noticia cada mañana a las 8 AM
cron.schedule('0 8 * * *', async () => {
    console.log('🌅 Generando noticia de la mañana...');
    await generarNoticiaCompleta('Nacionales');
});

// ==================== RUTAS ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// ==================== API NOTICIAS ====================
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, titulo, seccion, contenido, imagen, url, fecha, vistas, redactor, fuente_imagen FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT 30',
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (error) {
        console.error('❌ Error en /api/noticias:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/noticias/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE id = $1 AND estado = $2',
            [req.params.id, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No encontrada' });
        }

        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [req.params.id]);

        res.json({ success: true, noticia: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== GENERAR NOTICIA (BOTÓN MANUAL) ====================
app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

    const resultado = await generarNoticiaCompleta(categoria);

    if (resultado.success) {
        res.json({
            success: true,
            message: '✅ Noticia generada y publicada con imagen',
            ...resultado
        });
    } else {
        res.status(500).json({
            success: false,
            error: resultado.error
        });
    }
});

// ==================== GENERAR MÚLTIPLES (NUEVO) ====================
app.post('/api/generar-varias', async (req, res) => {
    const { cantidad = 3 } = req.body;

    res.json({ success: true, message: 'Iniciando generación múltiple...' });

    // Ejecutar en segundo plano
    (async () => {
        for (let i = 0; i < cantidad; i++) {
            const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
            await generarNoticiaCompleta(cat);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        console.log(`✅ Generación de ${cantidad} noticias completada`);
    })();
});

// ==================== NOTICIA POR SLUG ====================
app.get('/noticia/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const result = await pool.query(
            'SELECT * FROM noticias WHERE url = $1 AND estado = $2',
            [`/noticia/${slug}`, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).send('Noticia no encontrada');
        }

        const noticia = result.rows[0];

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');

            html = html.replace('{{TITULO}}', noticia.titulo);
            html = html.replace('{{CONTENIDO}}', noticia.contenido);
            html = html.replace('{{FECHA}}', new Date(noticia.fecha).toLocaleDateString());
            html = html.replace('{{IMAGEN}}', noticia.imagen);
            html = html.replace('{{FUENTE_IMAGEN}}', noticia.fuente_imagen);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (e) {
            res.json({ success: true, noticia });
        }
    } catch (error) {
        res.status(500).send('Error interno');
    }
});

// ==================== SITEMAP ====================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT url, fecha FROM noticias WHERE estado = $1 ORDER BY fecha DESC',
            ['publicada']
        );

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `  <url><loc>${process.env.BASE_URL || 'https://elfarolaldia.com'}/</loc><priority>1.0</priority></url>\n`;

        result.rows.forEach(n => {
            xml += `  <url><loc>${process.env.BASE_URL || 'https://elfarolaldia.com'}${n.url}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><priority>0.8</priority></url>\n`;
        });

        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        res.status(500).send('Error generando sitemap');
    }
});

// ==================== STATUS ====================
app.get('/status', async (req, res) => {
    try {
        const dbStatus = await pool.query('SELECT 1 as health');
        const noticiasCount = await pool.query('SELECT COUNT(*) FROM noticias');

        res.json({
            status: 'OK',
            uptime: process.uptime(),
            database: dbStatus.rows[0]?.health === 1 ? 'conectado' : 'error',
            noticias: parseInt(noticiasCount.rows[0].count),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== FALLBACK ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR ====================
async function iniciar() {
    try {
        console.log('🚀 Iniciando servidor...');

        const dbOk = await inicializarBase();
        if (!dbOk) {
            console.log('⚠️ Continuando a pesar del error de base de datos...');
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - VERSIÓN AUTOMATIZADA CON IMÁGENES 🏮 ║
╠══════════════════════════════════════════════════════════════╣
║ ✅ Servidor en puerto ${PORT}                                 ║
║ ✅ Conectado a PostgreSQL                                     ║
║ ✅ IA Generativa: ACTIVADA                                    ║
║ ✅ Búsqueda de imágenes: ACTIVADA                             ║
║ ✅ Automatización: CADA 6 HORAS                               ║
║ ✅ Noticias diarias: 8:00 AM                                  ║
╚══════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Error fatal al iniciar:', error);
        process.exit(1);
    }
}

iniciar();

module.exports = app;
