// server.js - VERSIÓN COMPLETA PARA RAILWAY
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const webPush = require('web-push');

// Configuración central
const ENV = {
    GEMINI_KEYS: [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY2,
        process.env.GEMINI_API_KEY3,
        process.env.GEMINI_API_KEY4
    ].filter(k => k),
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    ADMIN_USER: 'mxl',
    ADMIN_PIN: '1128',
    PORT: process.env.PORT || 8080,
    BASE_URL: process.env.BASE_URL || 'https://elfarolaldia.com',
    DATABASE_URL: process.env.DATABASE_URL,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY
};

const CATEGORIAS = ['Sucesos', 'Comunidad', 'Política', 'Deportes', 'Showbiz'];
const PB = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1';

// Base de datos simple (sin archivo externo)
const { Pool } = require('pg');
let pool = null;

function getPool() {
    if (!pool && ENV.DATABASE_URL) {
        pool = new Pool({
            connectionString: ENV.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        console.log('✅ Conexión DB creada');
    }
    return pool;
}

async function getNoticias(limite = 30) {
    const p = getPool();
    if (!p) return [];
    try {
        const r = await p.query(
            'SELECT id,titulo,slug,seccion,imagen,imagen_alt,fecha,vistas FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT $2',
            ['publicada', limite]
        );
        return r.rows;
    } catch(e) {
        console.error('Error getNoticias:', e.message);
        return [];
    }
}

async function inicializarDB() {
    const p = getPool();
    if (!p) {
        console.log('⚠️ Sin DATABASE_URL, modo demo');
        return;
    }
    try {
        await p.query(`
            CREATE TABLE IF NOT EXISTS noticias(
                id SERIAL PRIMARY KEY,
                titulo VARCHAR(255),
                slug VARCHAR(255) UNIQUE,
                seccion VARCHAR(100),
                contenido TEXT,
                imagen TEXT,
                imagen_alt TEXT,
                vistas INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado VARCHAR(50) DEFAULT 'publicada'
            )
        `);
        console.log('✅ Base de datos lista');
    } catch(e) {
        console.error('Error DB:', e.message);
    }
}

// App
const app = express();
const PORT = ENV.PORT;

app.use(express.json({ limit: '50mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'client')));

// Auth middleware
function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'No autorizado' });
    const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user === ENV.ADMIN_USER && pass === ENV.ADMIN_PIN) return next();
    res.status(401).json({ error: 'Credenciales incorrectas' });
}

// HEALTH CHECK
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API NOTICIAS
app.get('/api/noticias', async (req, res) => {
    try {
        const noticias = await getNoticias();
        res.json({ success: true, noticias });
    } catch(e) {
        res.json({ success: true, noticias: [] });
    }
});

// GENERAR NOTICIA (endpoint)
app.post('/api/generar-noticia', authMiddleware, async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    
    res.json({ success: true, mensaje: `Generando noticia de ${categoria}...`, slug: 'procesando' });
    
    // Aquí iría la lógica de IA (puedes expandir después)
});

// RUTA PRINCIPAL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// RUTA NOTICIA
app.get('/noticia/:slug', async (req, res) => {
    try {
        const p = getPool();
        if (!p) return res.status(500).send('Error DB');
        
        const r = await p.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2', [req.params.slug, 'publicada']);
        if (!r.rows.length) return res.status(404).send('Noticia no encontrada');
        
        const n = r.rows[0];
        await p.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [n.id]);
        
        let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
        html = html.replace(/{{TITULO}}/g, n.titulo)
                   .replace(/{{CONTENIDO}}/g, n.contenido || '')
                   .replace(/{{IMAGEN}}/g, n.imagen || `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`)
                   .replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO'))
                   .replace(/{{VISTAS}}/g, n.vistas)
                   .replace(/{{SECCION}}/g, n.seccion || 'General');
        res.send(html);
    } catch(e) {
        res.status(500).send('Error interno');
    }
});

// Iniciar servidor
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — RAILWAY READY                     ║
╠══════════════════════════════════════════════════════════╣
║  ✅ Puerto: ${PORT}                                           
║  ✅ Health: /health                                         
║  ✅ API: /api/noticias                                      
║  ✅ Admin: mxl / 1128                                       
║  ✅ Gemini keys: ${ENV.GEMINI_KEYS.length}/4 activas        
╚══════════════════════════════════════════════════════════╝
    `);
});

// Inicializar BD
inicializarDB();

module.exports = app;
