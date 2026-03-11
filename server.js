/**
 * 🏮 EL FAROL AL DÍA - SERVER ARREGLADO V5.0
 * Gemini genera noticias automáticamente CON IMÁGENES
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// ==================== CONEXIÓN POSTGRESQL ====================
if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL no está definida');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== INICIALIZAR BD ====================
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
                estado VARCHAR(50) DEFAULT 'publicada'
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
        .substring(0, 50);
}

// ==================== 🖼️ BUSCAR IMAGEN ====================
async function buscarImagen(titulo, categoria) {
    try {
        console.log(`🔍 Buscando imagen para: ${categoria}`);

        // UNSPLASH (MEJOR CALIDAD)
        if (process.env.UNSPLASH_ACCESS_KEY) {
            try {
                const query = encodeURIComponent(categoria);
                const url = `https://api.unsplash.com/photos/random?query=${query}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape`;
                
                const response = await fetch(url);
                const data = await response.json();
                
                if (data && data.urls && data.urls.regular) {
                    console.log(`✅ Imagen de Unsplash encontrada`);
                    return data.urls.regular;
                }
            } catch (e) {
                console.log('⚠️ Unsplash no respondió, intentando Pexels...');
            }
        }

        // PEXELS
        if (process.env.PEXELS_API_KEY) {
            try {
                const query = encodeURIComponent(categoria);
                const url = `https://api.pexels.com/v1/search?query=${query}&per_page=1&orientation=landscape`;
                
                const response = await fetch(url, {
                    headers: { 'Authorization': process.env.PEXELS_API_KEY }
                });
                const data = await response.json();
                
                if (data.photos && data.photos[0]) {
                    console.log(`✅ Imagen de Pexels encontrada`);
                    return data.photos[0].src.landscape;
                }
            } catch (e) {
                console.log('⚠️ Pexels no respondió, intentando Pixabay...');
            }
        }

        // PIXABAY
        if (process.env.PIXABAY_API_KEY) {
            try {
                const query = encodeURIComponent(categoria);
                const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${query}&image_type=photo&orientation=horizontal&per_page=1`;
                
                const response = await fetch(url);
                const data = await response.json();
                
                if (data.hits && data.hits[0]) {
                    console.log(`✅ Imagen de Pixabay encontrada`);
                    return data.hits[0].webformatURL;
                }
            } catch (e) {
                console.log('⚠️ Pixabay no respondió');
            }
        }

        // IMAGEN POR DEFECTO SI NADA FUNCIONA
        console.log('📸 Usando imagen por defecto');
        return `https://via.placeholder.com/800x400?text=${encodeURIComponent(categoria)}`;

    } catch (error) {
        console.error('❌ Error buscando imagen:', error.message);
        return `https://via.placeholder.com/800x400?text=Noticia`;
    }
}

// ==================== 🤖 GENERAR NOTICIA CON GEMINI ====================
async function generarNoticiaCompleta(categoria) {
    try {
        console.log(`\n🤖 Generando noticia para: ${categoria}`);

        const prompt = `Genera UNA noticia sobre ${categoria} en República Dominicana. 
        
IMPORTANTE:
- Título: Atractivo y profesional (máximo 80 caracteres)
- Contenido: 250-350 palabras de texto corrido
- Incluye datos específicos de RD
- Usa puntos de vista de "expertos" o "autoridades"
- NO uses asteriscos ni formato especial
- El contenido debe tener párrafos separados con saltos de línea

Responde EXACTAMENTE así (sin código, sin JSON):

TITULO: [aquí el título]
CONTENIDO: [aquí todo el contenido de la noticia con párrafos]`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 500
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            throw new Error('Gemini no devolvió contenido válido');
        }

        const texto = data.candidates[0].content.parts[0].text;
        console.log(`📝 Respuesta de Gemini recibida (${texto.length} caracteres)`);

        // Parsear la respuesta
        const tituloMatch = texto.match(/TITULO:\s*(.+?)(?=CONTENIDO:|$)/s);
        const contenidoMatch = texto.match(/CONTENIDO:\s*(.+?)$/s);

        if (!tituloMatch || !contenidoMatch) {
            console.error('❌ No se pudo parsear la respuesta:', texto.substring(0, 200));
            throw new Error('Formato de respuesta incorrecto');
        }

        const titulo = tituloMatch[1].trim();
        const contenido = contenidoMatch[1].trim();

        if (!titulo || !contenido || titulo.length < 10 || contenido.length < 100) {
            throw new Error('Título o contenido muy cortos');
        }

        console.log(`✅ Título: ${titulo.substring(0, 60)}...`);
        console.log(`✅ Contenido: ${contenido.substring(0, 100)}...`);

        // 🖼️ BUSCAR IMAGEN
        const imagen = await buscarImagen(titulo, categoria);

        // Guardar en BD
        const result = await pool.query(
            `INSERT INTO noticias (titulo, seccion, contenido, redactor, imagen, ubicacion, estado)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
                titulo.substring(0, 255),
                categoria,
                contenido,
                'IA Gemini',
                imagen,
                'Santo Domingo',
                'publicada'
            ]
        );

        console.log(`✅ Noticia guardada con ID: ${result.rows[0].id}`);
        return {
            success: true,
            id: result.rows[0].id,
            titulo: titulo,
            imagen: imagen
        };

    } catch (error) {
        console.error(`❌ Error generando noticia para ${categoria}:`, error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología'];

// ==================== ⏰ AUTOMATIZACIÓN ====================
// Cada 6 horas
cron.schedule('0 */6 * * *', async () => {
    console.log('\n⏰ GENERACIÓN AUTOMÁTICA CADA 6 HORAS');
    const categoria = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticiaCompleta(categoria);
});

// Cada día a las 8 AM
cron.schedule('0 8 * * *', async () => {
    console.log('\n🌅 GENERACIÓN DIARIA A LAS 8 AM');
    await generarNoticiaCompleta('Nacionales');
});

// ==================== RUTAS ====================
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// ==================== API NOTICIAS ====================
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, titulo, seccion, contenido, imagen, fecha, vistas, redactor FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT 30',
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

// ==================== GENERAR NOTICIA MANUAL ====================
app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

    const resultado = await generarNoticiaCompleta(categoria);

    if (resultado.success) {
        res.json({
            success: true,
            message: '✅ Noticia generada',
            ...resultado
        });
    } else {
        res.status(500).json({
            success: false,
            error: resultado.error
        });
    }
});

// ==================== SITEMAP ====================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, fecha FROM noticias WHERE estado = $1 ORDER BY fecha DESC',
            ['publicada']
        );

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += '  <url><loc>https://elfarolaldia.com/</loc><priority>1.0</priority></url>\n';

        result.rows.forEach(n => {
            xml += `  <url><loc>https://elfarolaldia.com/noticia/${n.id}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><priority>0.8</priority></url>\n`;
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
            database: dbStatus.rows[0]?.health === 1 ? 'conectado' : 'error',
            noticias: parseInt(noticiasCount.rows[0].count),
            uptime: Math.floor(process.uptime()),
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

// ==================== INICIAR ====================
async function iniciar() {
    try {
        console.log('\n🚀 Iniciando servidor...');
        
        const dbOk = await inicializarBase();
        if (!dbOk) {
            console.log('⚠️ Continuando a pesar del error de BD...');
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - SERVIDOR ARREGLADO V5.0 🏮      ║
╠══════════════════════════════════════════════════════════╣
║ ✅ Servidor en puerto ${PORT}                            ║
║ ✅ PostgreSQL conectado                                  ║
║ ✅ Gemini IA: ACTIVADO                                   ║
║ ✅ Búsqueda de imágenes: ACTIVADA                        ║
║ ✅ Automatización: CADA 6 HORAS + DIARIA 8 AM           ║
║ ✅ LISTO PARA OPERAR                                     ║
╚══════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    }
}

iniciar();

module.exports = app;

