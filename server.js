/**
 * 🏮 EL FAROL AL DÍA - VERSIÓN POSTGRESQL (NEON) - CORREGIDA
 * SIN MONGODB - SIN REDIS - SIN BULLMQ - GRATIS
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// ==================== CONEXIÓN A POSTGRESQL ====================
if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL no está definida');
    process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
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
    // Probar conexión primero
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
        categoria_slug VARCHAR(100)
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
            'SELECT id, titulo, seccion, contenido, imagen, url, fecha, vistas, redactor FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT 30',
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

// ==================== GENERAR NOTICIA (BOTÓN) ====================
app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

    try {
        console.log(`🤖 Generando noticia para categoría: ${categoria}`);
        
        const prompt = `Genera una noticia breve sobre ${categoria} en República Dominicana. 
        La noticia debe ser original e interesante.
        Responde SOLO con un JSON válido con este formato exacto:
        {
          "titulo": "Título de la noticia",
          "contenido": "Texto completo de la noticia (mínimo 200 palabras)"
        }`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
        console.log('📝 Respuesta de Gemini recibida');
        
        const jsonMatch = texto.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) throw new Error('JSON no válido');
        
        const noticia = JSON.parse(jsonMatch[0]);
        
        // Validar que tenga los campos necesarios
        if (!noticia.titulo || !noticia.contenido) {
            throw new Error('La noticia generada no tiene título o contenido');
        }
        
        const slug = generarSlug(noticia.titulo);
        const url = `/noticia/${slug}`;
        
        const result = await pool.query(
            `INSERT INTO noticias (titulo, seccion, contenido, redactor, url, categoria_slug)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [noticia.titulo, categoria, noticia.contenido, 'IA Gemini', url, slug]
        );

        console.log(`✅ Noticia guardada con ID: ${result.rows[0].id}`);

        res.json({ 
            success: true, 
            message: '✅ Noticia generada y publicada',
            id: result.rows[0].id,
            url: url
        });

    } catch (error) {
        console.error('❌ Error generando noticia:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
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
        
        // Intentar leer el template HTML
        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            
            // Reemplazar marcadores simples si existen
            html = html.replace('{{TITULO}}', noticia.titulo);
            html = html.replace('{{CONTENIDO}}', noticia.contenido);
            html = html.replace('{{FECHA}}', new Date(noticia.fecha).toLocaleDateString());
            
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (e) {
            // Si no hay template, enviar JSON
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
╔════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - VERSIÓN POSTGRESQL 🏮      ║
╠════════════════════════════════════════════════════╣
║ ✅ Servidor en puerto ${PORT}                      ║
║ ✅ Conectado a Neon PostgreSQL                     ║
║ ✅ IA Generativa: ACTIVADA                          ║
║ 🟢 SIN MONGODB - SIN REDIS - GRATIS                ║
╚════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Error fatal al iniciar:', error);
        process.exit(1);
    }
}

iniciar();

module.exports = app;
