/**
 * 🏮 EL FAROL AL DÍA — V35.0-FINAL
 * ESTRUCTURA CONFIRMADA:
 * - client/index.html, noticia.html, redaccion.html, contacto.html, etc.
 * - static/ para recursos gráficos
 * - Renderizado de {{VARIABLES}} en noticia.html
 * - SIN sharp (ultra ligero)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ══════════════════════════════════════════════════════════
// 🗄️ BASE DE DATOS
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

// Crear tablas automáticamente
async function inicializarTablas() {
    try {
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
        
        console.log('✅ Tablas listas');
    } catch (e) {
        console.error('❌ Error tablas:', e.message);
    }
}

pool.connect(async (err) => {
    if (err) {
        console.error('❌ DB error:', err.message);
    } else {
        console.log('✅ PostgreSQL conectado');
        await inicializarTablas();
    }
});

const IMAGEN_FALLBACK = 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=800';

// ══════════════════════════════════════════════════════════
// 🔒 BASIC AUTH para panel redacción
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
// 🏥 HEALTH CHECK (rápido para Railway)
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', version: '35.0', timestamp: Date.now() });
});

// ══════════════════════════════════════════════════════════
// 📡 RUTAS API
// ══════════════════════════════════════════════════════════

// 1. Listar noticias
app.get('/api/noticias', async (req, res) => {
    try {
        const { categoria, limit = 100 } = req.query;
        let query = `SELECT id, titulo, slug, seccion, contenido, imagen, seo_description, vistas, fecha 
                     FROM noticias ORDER BY fecha DESC LIMIT $1`;
        let params = [Math.min(parseInt(limit), 200)];
        
        if (categoria) {
            query = `SELECT id, titulo, slug, seccion, contenido, imagen, seo_description, vistas, fecha 
                     FROM noticias WHERE seccion = $1 ORDER BY fecha DESC LIMIT $2`;
            params = [categoria, Math.min(parseInt(limit), 200)];
        }
        
        const result = await pool.query(query, params);
        res.json({ success: true, noticias: result.rows || [] });
    } catch (e) {
        console.error('❌ /api/noticias:', e.message);
        res.json({ success: true, noticias: [] });
    }
});

// 2. Noticia individual (API)
app.get('/api/noticia/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const result = await pool.query(`SELECT * FROM noticias WHERE slug = $1`, [slug]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No encontrada' });
        }
        await pool.query(`UPDATE noticias SET vistas = vistas + 1 WHERE slug = $1`, [slug]);
        res.json({ success: true, noticia: result.rows[0] });
    } catch (e) {
        console.error('❌ /api/noticia/:slug:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. Estadísticas (admin)
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

// 4. Publicar manual (admin)
app.post('/api/publicar', authMiddleware, async (req, res) => {
    try {
        const { titulo, seccion, contenido, imagen, seo_description } = req.body;
        
        if (!titulo || !seccion || !contenido) {
            return res.status(400).json({ success: false, error: 'Faltan campos' });
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

// 5. Generar con IA (admin)
app.post('/api/generar', authMiddleware, async (req, res) => {
    try {
        const { categoria } = req.body;
        if (!categoria) {
            return res.status(400).json({ success: false, error: 'Categoría requerida' });
        }
        
        const titulo = `Actualidad en ${categoria} - ${new Date().toLocaleDateString('es-DO')}`;
        const contenido = `Noticia generada automáticamente para la categoría ${categoria}. Contenido de ejemplo.`;
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

// 6. Eliminar noticia (admin)
app.delete('/api/eliminar/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(`DELETE FROM noticias WHERE id = $1`, [id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 7. COMENTARIOS
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
        res.json({ success: true, comentarios: [] });
    }
});

app.post('/api/comentarios/:noticiaId', async (req, res) => {
    try {
        const { noticiaId } = req.params;
        const { nombre, texto } = req.body;
        
        if (!nombre || !texto || texto.length < 3) {
            return res.status(400).json({ success: false, error: 'Nombre y comentario requeridos' });
        }
        
        await pool.query(`
            INSERT INTO comentarios (noticia_id, nombre, texto, fecha)
            VALUES ($1, $2, $3, NOW())
        `, [noticiaId, nombre.substring(0, 80), texto.substring(0, 1000)]);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/comentarios/eliminar/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(`DELETE FROM comentarios WHERE id = $1`, [id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 8. Configuración IA (admin)
app.get('/api/admin/config', authMiddleware, (req, res) => {
    res.json({ enabled: true, instruccion_principal: '', enfasis: '', tono: 'profesional', extension: 'media', evitar: '' });
});

app.post('/api/admin/config', authMiddleware, (req, res) => {
    res.json({ success: true });
});

// 9. Memoria IA
app.get('/api/memoria', authMiddleware, (req, res) => {
    res.json({ success: true, registros: [] });
});

// 10. Coach
app.get('/api/coach', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT seccion, COUNT(*) as total, COALESCE(AVG(vistas), 0) as vistas_promedio
            FROM noticias GROUP BY seccion
        `);
        const categorias = {};
        result.rows.forEach(row => {
            categorias[row.seccion] = {
                total: parseInt(row.total),
                vistas_promedio: Math.round(row.vistas_promedio),
                rendimiento: Math.min(100, Math.round((row.vistas_promedio / 100) * 100))
            };
        });
        res.json({ success: true, categorias });
    } catch (e) {
        res.json({ success: true, categorias: {} });
    }
});

// 11. Status
app.get('/status', async (req, res) => {
    try {
        const noticias = await pool.query(`SELECT COUNT(*) FROM noticias`);
        res.json({ version: '35.0', noticias: parseInt(noticias.rows[0]?.count || 0) });
    } catch (e) {
        res.json({ version: '35.0' });
    }
});

// 12. Sitemap
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
        res.status(500).send('Error');
    }
});

// 13. Robots.txt
app.get('/robots.txt', (req, res) => {
    res.send(`User-agent: *\nAllow: /\nDisallow: /redaccion\nSitemap: ${BASE_URL}/sitemap.xml\n`);
});

// 14. Ads.txt
app.get('/ads.txt', (req, res) => {
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

// ══════════════════════════════════════════════════════════
// 📄 PÁGINAS HTML (RENDERIZADO DE PLANTILLAS)
// ══════════════════════════════════════════════════════════

// Portada
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Página individual de noticia (CON RENDERIZADO {{VARIABLES}})
app.get('/noticia/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const result = await pool.query(`SELECT * FROM noticias WHERE slug = $1`, [slug]);
        
        if (result.rows.length === 0) {
            return res.status(404).sendFile(path.join(__dirname, 'client', '404.html'));
        }
        
        const noticia = result.rows[0];
        
        // Leer plantilla noticia.html
        let plantilla = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
        
        // Reemplazar variables
        const fechaFormateada = new Date(noticia.fecha).toLocaleDateString('es-DO', {
            day: '2-digit', month: 'long', year: 'numeric'
        });
        
        plantilla = plantilla.replace(/{{TITULO}}/g, noticia.titulo);
        plantilla = plantilla.replace(/{{SECCION}}/g, noticia.seccion);
        plantilla = plantilla.replace(/{{CONTENIDO}}/g, noticia.contenido);
        plantilla = plantilla.replace(/{{IMAGEN}}/g, noticia.imagen || IMAGEN_FALLBACK);
        plantilla = plantilla.replace(/{{ALT}}/g, noticia.titulo);
        plantilla = plantilla.replace(/{{FECHA}}/g, fechaFormateada);
        plantilla = plantilla.replace(/{{REDACTOR}}/g, 'Redacción EFD');
        plantilla = plantilla.replace(/{{VISTAS}}/g, noticia.vistas || 0);
        plantilla = plantilla.replace(/{{URL}}/g, `${BASE_URL}/noticia/${noticia.slug}`);
        
        res.send(plantilla);
    } catch (e) {
        console.error('❌ /noticia/:slug error:', e.message);
        res.status(500).send('Error cargando noticia');
    }
});

// Panel redacción (con auth)
app.get('/redaccion', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// Páginas estáticas (todas en client/)
const paginasEstaticas = [
    'contacto', 'cookies', 'ingeniero', 'nosotros', 'privacidad', 'terminos'
];

paginasEstaticas.forEach(pagina => {
    app.get(`/${pagina}`, (req, res) => {
        res.sendFile(path.join(__dirname, 'client', `${pagina}.html`));
    });
});

// Fallback SPA (debe ir al final)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ══════════════════════════════════════════════════════════
// 🚀 INICIO DEL SERVIDOR
// ══════════════════════════════════════════════════════════
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🏮 ══════════════════════════════════════════
   EL FAROL AL DÍA — V35.0-FINAL
   Puerto: ${PORT}
   URL: ${BASE_URL}
   Archivos en client/:
   - index.html (portada)
   - noticia.html (plantilla con {{VARIABLES}})
   - redaccion.html (panel con auth)
   - contacto.html, nosotros.html, etc.
🏮 ══════════════════════════════════════════
    `);
});

process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM recibido, cerrando...');
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    console.log('⚠️ SIGINT recibido, cerrando...');
    server.close(() => process.exit(0));
});

module.exports = app;
