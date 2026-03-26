/**
 * 🏮 EL FAROL AL DÍA — V34.9-COMPLETO
 * Incluye TODAS las rutas: noticias, estadísticas, publicar, generar, eliminar,
 * comentarios, configuración, memoria, coach, sitemap, etc.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ══════════════════════════════════════════════════════════
// 🗄️ BASE DE DATOS POSTGRESQL
// ══════════════════════════════════════════════════════════
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('❌ Error en PostgreSQL:', err.message);
});

// Crear tablas
async function inicializarTablas() {
    try {
        // Tabla noticias
        await pool.query(`
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
        `);
        
        // Tabla comentarios
        await pool.query(`
            CREATE TABLE IF NOT EXISTS comentarios (
                id SERIAL PRIMARY KEY,
                noticia_id INTEGER NOT NULL,
                nombre TEXT NOT NULL,
                texto TEXT NOT NULL,
                fecha TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (noticia_id) REFERENCES noticias(id) ON DELETE CASCADE
            )
        `);
        
        // Tabla configuración IA
        await pool.query(`
            CREATE TABLE IF NOT EXISTS config_ia (
                id INTEGER PRIMARY KEY DEFAULT 1,
                enabled BOOLEAN DEFAULT true,
                instruccion_principal TEXT,
                enfasis TEXT,
                tono TEXT DEFAULT 'profesional',
                extension TEXT DEFAULT 'media',
                evitar TEXT
            )
        `);
        
        // Insertar config por defecto
        await pool.query(`
            INSERT INTO config_ia (id, enabled, instruccion_principal, enfasis, tono, extension, evitar)
            VALUES (1, true, 'Periodista profesional dominicano', 'Enfoque en Santo Domingo Este', 'profesional', 'media', 'Opiniones personales')
            ON CONFLICT (id) DO NOTHING
        `);
        
        console.log('✅ Tablas inicializadas correctamente');
    } catch (e) {
        console.error('❌ Error inicializando tablas:', e.message);
    }
}

pool.connect(async (err) => {
    if (err) {
        console.error('❌ Error conectando a PostgreSQL:', err.message);
    } else {
        console.log('✅ PostgreSQL conectado correctamente');
        await inicializarTablas();
    }
});

const IMAGEN_FALLBACK = 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=800';

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
    return res.status(401).send('Credenciales incorrectas');
}

// ══════════════════════════════════════════════════════════
// 🚀 MIDDLEWARE
// ══════════════════════════════════════════════════════════
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'client')));
app.use('/static', express.static(path.join(__dirname, 'static')));

// ══════════════════════════════════════════════════════════
// 🏥 HEALTH CHECK
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', version: '34.9', timestamp: Date.now() });
});

// ══════════════════════════════════════════════════════════
// 📡 RUTAS PRINCIPALES
// ══════════════════════════════════════════════════════════

// 1. Listar noticias
app.get('/api/noticias', async (req, res) => {
    try {
        const { categoria, limit = 100 } = req.query;
        let query = `SELECT id, titulo, slug, seccion, contenido, imagen, seo_description, vistas, fecha 
                     FROM noticias ORDER BY fecha DESC`;
        let params = [];
        
        if (categoria) {
            query = `SELECT id, titulo, slug, seccion, contenido, imagen, seo_description, vistas, fecha 
                     FROM noticias WHERE seccion = $1 ORDER BY fecha DESC`;
            params = [categoria];
        }
        
        query += ` LIMIT $${params.length + 1}`;
        params.push(Math.min(parseInt(limit), 200));
        
        const result = await pool.query(query, params);
        res.json({ success: true, noticias: result.rows || [] });
    } catch (e) {
        console.error('❌ /api/noticias error:', e.message);
        res.json({ success: true, noticias: [] });
    }
});

// 2. Noticia individual
app.get('/api/noticia/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const result = await pool.query(`SELECT * FROM noticias WHERE slug = $1`, [slug]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }
        
        // Incrementar vistas
        await pool.query(`UPDATE noticias SET vistas = vistas + 1 WHERE slug = $1`, [slug]);
        
        res.json({ success: true, noticia: result.rows[0] });
    } catch (e) {
        console.error('❌ /api/noticia/:slug error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. Estadísticas
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

// 4. Publicar manual
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
        console.error('❌ /api/publicar error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. Generar con IA
app.post('/api/generar', authMiddleware, async (req, res) => {
    try {
        const { categoria } = req.body;
        if (!categoria) {
            return res.status(400).json({ success: false, error: 'Categoría requerida' });
        }
        
        const titulo = `Actualidad en ${categoria} - ${new Date().toLocaleDateString('es-DO')}`;
        const contenido = `Noticia generada automáticamente para la categoría ${categoria}. 
        
Contenido de ejemplo mientras se configura la integración con Gemini AI.

Esta noticia fue publicada desde el panel de redacción de El Farol al Día.`;
        
        const slug = titulo.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .trim().replace(/\s+/g, '-')
            .substring(0, 75) + '-' + Date.now().toString().slice(-6);
        
        await pool.query(`
            INSERT INTO noticias (titulo, slug, seccion, contenido, imagen, vistas, fecha)
            VALUES ($1, $2, $3, $4, $5, 0, NOW())
        `, [titulo, slug, categoria, contenido, IMAGEN_FALLBACK]);
        
        res.json({ success: true, mensaje: `Generando noticia de ${categoria}...`, titulo });
    } catch (e) {
        console.error('❌ /api/generar error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 6. Eliminar noticia
app.delete('/api/eliminar/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`DELETE FROM noticias WHERE id = $1 RETURNING id`, [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }
        res.json({ success: true });
    } catch (e) {
        console.error('❌ /api/eliminar error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 7. COMENTARIOS - LISTAR
app.get('/api/comentarios/:noticiaId', async (req, res) => {
    try {
        const { noticiaId } = req.params;
        const result = await pool.query(`
            SELECT id, nombre, texto, fecha 
            FROM comentarios 
            WHERE noticia_id = $1 
            ORDER BY fecha DESC
        `, [noticiaId]);
        res.json({ success: true, comentarios: result.rows || [] });
    } catch (e) {
        console.error('❌ GET /api/comentarios error:', e.message);
        res.json({ success: true, comentarios: [] });
    }
});

// 8. COMENTARIOS - PUBLICAR
app.post('/api/comentarios/:noticiaId', async (req, res) => {
    try {
        const { noticiaId } = req.params;
        const { nombre, texto } = req.body;
        
        if (!nombre || !texto || texto.length < 3) {
            return res.status(400).json({ success: false, error: 'Nombre y comentario requeridos (mínimo 3 caracteres)' });
        }
        
        const nombreLimpio = nombre.substring(0, 80);
        const textoLimpio = texto.substring(0, 1000);
        
        await pool.query(`
            INSERT INTO comentarios (noticia_id, nombre, texto, fecha)
            VALUES ($1, $2, $3, NOW())
        `, [noticiaId, nombreLimpio, textoLimpio]);
        
        res.json({ success: true, mensaje: 'Comentario publicado' });
    } catch (e) {
        console.error('❌ POST /api/comentarios error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 9. COMENTARIOS - ELIMINAR (admin)
app.post('/api/comentarios/eliminar/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(`DELETE FROM comentarios WHERE id = $1`, [id]);
        res.json({ success: true });
    } catch (e) {
        console.error('❌ DELETE /api/comentarios error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 10. Configuración IA
app.get('/api/admin/config', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM config_ia WHERE id = 1`);
        if (result.rows.length === 0) {
            return res.json({ enabled: true, instruccion_principal: '', enfasis: '', tono: 'profesional', extension: 'media', evitar: '' });
        }
        res.json(result.rows[0]);
    } catch (e) {
        res.json({ enabled: true });
    }
});

app.post('/api/admin/config', authMiddleware, async (req, res) => {
    try {
        const { enabled, instruccion_principal, enfasis, tono, extension, evitar } = req.body;
        await pool.query(`
            UPDATE config_ia 
            SET enabled = $1, instruccion_principal = $2, enfasis = $3, tono = $4, extension = $5, evitar = $6
            WHERE id = 1
        `, [enabled, instruccion_principal, enfasis, tono, extension, evitar]);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: true });
    }
});

// 11. Memoria IA
app.get('/api/memoria', authMiddleware, (req, res) => {
    res.json({ success: true, registros: [] });
});

// 12. Coach
app.get('/api/coach', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT seccion, COUNT(*) as total, COALESCE(AVG(vistas), 0) as vistas_promedio
            FROM noticias 
            GROUP BY seccion
            ORDER BY vistas_promedio DESC
        `);
        
        const categorias = {};
        result.rows.forEach(row => {
            categorias[row.seccion] = {
                total: parseInt(row.total),
                vistas_promedio: Math.round(row.vistas_promedio),
                rendimiento: Math.min(100, Math.round((row.vistas_promedio / 100) * 100))
            };
        });
        
        res.json({ 
            success: true, 
            total_noticias: result.rows.reduce((sum, r) => sum + parseInt(r.total), 0),
            categorias 
        });
    } catch (e) {
        res.json({ success: true, categorias: {} });
    }
});

// 13. Status
app.get('/status', async (req, res) => {
    try {
        const noticias = await pool.query(`SELECT COUNT(*) FROM noticias`);
        const comentarios = await pool.query(`SELECT COUNT(*) FROM comentarios`);
        res.json({
            version: '34.9',
            noticias: parseInt(noticias.rows[0]?.count || 0),
            comentarios: parseInt(comentarios.rows[0]?.count || 0),
            database: 'connected',
            uptime: Math.floor(process.uptime())
        });
    } catch (e) {
        res.json({ version: '34.9', database: 'error', error: e.message });
    }
});

// 14. Página de noticia (HTML)
app.get('/noticia/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const result = await pool.query(`SELECT * FROM noticias WHERE slug = $1`, [slug]);
        if (result.rows.length === 0) {
            return res.status(404).sendFile(path.join(__dirname, 'client', '404.html'));
        }
        res.sendFile(path.join(__dirname, 'client', 'index.html'));
    } catch (e) {
        console.error('❌ /noticia/:slug error:', e.message);
        res.status(500).send('Error cargando noticia');
    }
});

// 15. Panel redacción
app.get('/redaccion', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// 16. Sitemap
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT slug, fecha FROM noticias 
            ORDER BY fecha DESC 
            LIMIT 1000
        `);
        
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `<url><loc>${BASE_URL}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;
        
        for (const n of result.rows) {
            xml += `<url><loc>${BASE_URL}/noticia/${n.slug}</loc>`;
            xml += `<lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod>`;
            xml += `<changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
        }
        
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (e) {
        console.error('❌ Sitemap error:', e.message);
        res.status(500).send('Error generando sitemap');
    }
});

// 17. Robots.txt
app.get('/robots.txt', (req, res) => {
    res.send(`User-agent: *\nAllow: /\nDisallow: /redaccion\nSitemap: ${BASE_URL}/sitemap.xml\n`);
});

// 18. Ads.txt
app.get('/ads.txt', (req, res) => {
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

// 19. Páginas estáticas
app.get('/nosotros', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/contacto', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/terminos', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/cookies', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// 20. Fallback SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ══════════════════════════════════════════════════════════
// 🚀 INICIO DEL SERVIDOR
// ══════════════════════════════════════════════════════════
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🏮 ══════════════════════════════════════════
   EL FAROL AL DÍA — V34.9-COMPLETO
   Puerto: ${PORT}
   URL: ${BASE_URL}
   Status: ✅ Servidor funcionando
   Health: ${BASE_URL}/health
🏮 ══════════════════════════════════════════
    `);
});

process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM recibido, cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('⚠️ SIGINT recibido, cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado');
        process.exit(0);
    });
});

module.exports = app;
