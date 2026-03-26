/**
 * 🏮 EL FAROL AL DÍA — V34.6-RAILWAY-STABLE
 * OPTIMIZACIONES:
 *   1. Inicio sincrónico inmediato
 *   2. Health check prioritario
 *   3. Conexión DB asíncrona sin bloquear
 *   4. Eliminado keep-alive que causaba bucles
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ══════════════════════════════════════════════════════════
// 🔒 BASIC AUTH
// ══════════════════════════════════════════════════════════
function authMiddleware(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
        return res.status(401).send('Acceso restringido');
    }
    try {
        const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
        const [user, pass] = decoded.split(':');
        if (user === 'director' && pass === '311') return next();
    } catch(e) {}
    return res.status(401).send('Credenciales incorrectas.');
}

// ══════════════════════════════════════════════════════════
// 🗄️ BASE DE DATOS - CONFIGURACIÓN MÍNIMA
// ══════════════════════════════════════════════════════════
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 3000,
});

// ══════════════════════════════════════════════════════════
// 🚀 MIDDLEWARE - INICIO INMEDIATO
// ══════════════════════════════════════════════════════════
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(cors());

const IMAGEN_FALLBACK = 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=800';

// ══════════════════════════════════════════════════════════
// 🏥 HEALTH CHECK - PRIORIDAD MÁXIMA (RESPONDE INMEDIATO)
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        version: '34.6',
        timestamp: Date.now()
    });
});

// ══════════════════════════════════════════════════════════
// 📡 RUTAS PRINCIPALES
// ══════════════════════════════════════════════════════════

// Listar noticias
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, titulo, slug, seccion, contenido, imagen, seo_description, vistas, fecha 
            FROM noticias 
            ORDER BY fecha DESC 
            LIMIT 100
        `);
        res.json({ success: true, noticias: result.rows || [] });
    } catch (e) {
        console.error('❌ /api/noticias:', e.message);
        res.json({ success: true, noticias: [] });
    }
});

// Estadísticas
app.get('/api/estadisticas', authMiddleware, async (req, res) => {
    try {
        const total = await pool.query(`SELECT COUNT(*) FROM noticias`);
        const vistas = await pool.query(`SELECT COALESCE(SUM(vistas), 0) FROM noticias`);
        res.json({
            success: true,
            estadisticas: {
                total: parseInt(total.rows[0]?.count || 0),
                vistasTotales: parseInt(vistas.rows[0]?.sum || 0)
            }
        });
    } catch (e) {
        res.json({ success: true, estadisticas: { total: 0, vistasTotales: 0 } });
    }
});

// Publicar manual
app.post('/api/publicar', authMiddleware, async (req, res) => {
    try {
        const { titulo, seccion, contenido, imagen, seo_description } = req.body;
        
        if (!titulo || !seccion || !contenido) {
            return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
        }
        
        const slug = titulo.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .trim().replace(/\s+/g, '-')
            .substring(0, 75) + '-' + Date.now().toString().slice(-6);
        
        const imagenFinal = imagen && imagen.startsWith('http') ? imagen : IMAGEN_FALLBACK;
        
        const result = await pool.query(`
            INSERT INTO noticias (titulo, slug, seccion, contenido, seo_description, imagen, vistas, fecha)
            VALUES ($1, $2, $3, $4, $5, $6, 0, NOW())
            RETURNING id, slug
        `, [titulo, slug, seccion, contenido, seo_description || '', imagenFinal]);
        
        res.json({ success: true, slug: result.rows[0]?.slug });
    } catch (e) {
        console.error('❌ /api/publicar:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Generar con IA (simplificado)
app.post('/api/generar', authMiddleware, async (req, res) => {
    try {
        const { categoria } = req.body;
        if (!categoria) {
            return res.status(400).json({ success: false, error: 'Categoría requerida' });
        }
        
        const titulo = `Actualidad en ${categoria} - ${new Date().toLocaleDateString('es-DO')}`;
        const contenido = `Noticia generada para ${categoria}. Contenido de ejemplo.`;
        const slug = titulo.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-') + '-' + Date.now().toString().slice(-6);
        
        await pool.query(`
            INSERT INTO noticias (titulo, slug, seccion, contenido, imagen, vistas, fecha)
            VALUES ($1, $2, $3, $4, $5, 0, NOW())
        `, [titulo, slug, categoria, contenido, IMAGEN_FALLBACK]);
        
        res.json({ success: true, mensaje: `Generando noticia de ${categoria}...` });
    } catch (e) {
        console.error('❌ /api/generar:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Eliminar noticia
app.delete('/api/eliminar/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(`DELETE FROM noticias WHERE id = $1`, [id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Configuración IA (mock)
app.get('/api/admin/config', authMiddleware, (req, res) => {
    res.json({ enabled: true, instruccion_principal: '', enfasis: '', tono: 'profesional', extension: 'media', evitar: '' });
});

app.post('/api/admin/config', authMiddleware, (req, res) => {
    res.json({ success: true });
});

// Memoria IA (mock)
app.get('/api/memoria', authMiddleware, (req, res) => {
    res.json({ success: true, registros: [] });
});

// Coach (mock)
app.get('/api/coach', authMiddleware, (req, res) => {
    res.json({ success: true, categorias: {} });
});

// Status
app.get('/status', async (req, res) => {
    try {
        const noticias = await pool.query(`SELECT COUNT(*) FROM noticias`);
        res.json({
            version: '34.6',
            noticias: parseInt(noticias.rows[0]?.count || 0)
        });
    } catch (e) {
        res.json({ version: '34.6', error: e.message });
    }
});

// Noticia individual
app.get('/noticia/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const result = await pool.query(`SELECT * FROM noticias WHERE slug = $1`, [slug]);
        if (result.rows.length === 0) {
            return res.status(404).send('Noticia no encontrada');
        }
        pool.query(`UPDATE noticias SET vistas = vistas + 1 WHERE slug = $1`, [slug]).catch(() => {});
        res.sendFile(path.join(__dirname, 'client', 'index.html'));
    } catch (e) {
        res.status(500).send('Error cargando noticia');
    }
});

// Panel redacción
app.get('/redaccion', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// Sitemap
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(`SELECT slug, fecha FROM noticias ORDER BY fecha DESC LIMIT 1000`);
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;
        for (const n of result.rows) {
            xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
        }
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (e) {
        res.status(500).send('Error generando sitemap');
    }
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
    res.send(`User-agent: *\nAllow: /\nDisallow: /redaccion\nSitemap: ${BASE_URL}/sitemap.xml\n`);
});

// Ads.txt
app.get('/ads.txt', (req, res) => {
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

// Fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ══════════════════════════════════════════════════════════
// 🚀 INICIO DEL SERVIDOR - SIN BLOQUEOS
// ══════════════════════════════════════════════════════════
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏮 EL FAROL AL DÍA — V34.6`);
    console.log(`   Puerto: ${PORT}`);
    console.log(`   URL: ${BASE_URL}`);
    console.log(`🏮 ══════════════════════════════════════════\n`);
    
    // Crear tabla noticias si no existe (sin bloquear)
    pool.query(`
        CREATE TABLE IF NOT EXISTS noticias (
            id SERIAL PRIMARY KEY,
            titulo TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            seccion TEXT NOT NULL,
            contenido TEXT NOT NULL,
            seo_description TEXT,
            imagen TEXT,
            vistas INTEGER DEFAULT 0,
            fecha TIMESTAMP DEFAULT NOW()
        )
    `).catch(e => console.error('Error creando tabla:', e.message));
});

// Manejo de señales para Railway
process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM recibido, cerrando...');
    server.close(() => {
        console.log('✅ Cerrado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('⚠️ SIGINT recibido, cerrando...');
    server.close(() => {
        console.log('✅ Cerrado');
        process.exit(0);
    });
});

module.exports = app;
