/**
 * 🏮 EL FAROL AL DÍA — V34.0 FINAL + MONETIZACIÓN CPC INTEGRADA
 * Integración de Módulo de Alto Valor (Bancos, Seguros, Inmobiliarias)
 * + Basic Auth (director / 311)
 * + Wikipedia Contextual + Redes Sociales (FB, TW, TG)
 */

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const crypto    = require('crypto');

// ══════════════════════════════════════════════════════════
// 💰 LÓGICA DE MONETIZACIÓN CPC (INYECCIÓN DIRECTA)
// ══════════════════════════════════════════════════════════

const PALABRAS_CPC_TEMAS = {
    'Economía': ['banco central', 'tasa de interés', 'inflación', 'dólar', 'reservas internacionales', 'deuda pública', 'PIB', 'crecimiento económico', 'criptomonedas', 'bolsa', 'dividendos'],
    'Nacionales': ['inversión extranjera', 'zonas francas', 'incentivos fiscales', 'infraestructura vial', 'hipotecas', 'créditos', 'financiamiento', 'préstamos', 'plusvalía'],
    'Internacionales': ['comercio internacional', 'aranceles', 'FMI', 'Banco Mundial', 'mercados emergentes'],
    'Tecnología': ['fintech', 'ciberseguridad financiera', 'blockchain', 'pagos digitales', 'billetera digital'],
    'Deportes': ['patrocinios', 'inversión deportiva', 'apuestas legales', 'seguros de atletas']
};

function monetizarNoticia(noticia) {
    let tituloFinal = noticia.titulo;
    let desc = noticia.descripcion.trim();
    const contentLower = noticia.contenido.toLowerCase();
    const categoria = noticia.seccion;

    // 1. Enriquecer Título
    if (categoria === 'Economía' && !tituloFinal.toLowerCase().includes('último minuto')) {
        tituloFinal = `Último Minuto: ${tituloFinal} — Clima Inversión RD`;
    } else if (categoria === 'Nacionales' && (contentLower.includes('vivienda') || contentLower.includes('construcción'))) {
        tituloFinal = `Santo Domingo Este: ${tituloFinal} — Plusvalía Inmobiliaria`;
    }
    if (tituloFinal.length > 110) tituloFinal = tituloFinal.substring(0, 107) + '...';

    // 2. Enriquecer Descripción (150-160 chars)
    if (desc.length < 140) {
        desc = `Último Minuto en RD: ${desc} Oportunidades de inversión y crecimiento en Santo Domingo Este. Análisis completo aquí.`;
    }
    desc = desc.substring(0, 159).trim() + '.';

    // 3. Inyectar sutilmente en el contenido (Párrafo 4)
    const parrafos = noticia.contenido.split('\n\n');
    if (parrafos.length >= 4) {
        let inyeccion = (categoria === 'Nacionales') ? ' Este desarrollo genera una plusvalía importante para los activos inmobiliarios en la zona.' : ' Expertos señalan que esto fortalece el clima de inversión y la estabilidad financiera en la región.';
        parrafos[3] = parrafos[3] + inyeccion;
    }

    return {
        titulo: tituloFinal,
        descripcion: desc,
        contenido: parrafos.join('\n\n')
    };
}

// ══════════════════════════════════════════════════════════
// 🔒 SEGURIDAD Y CONFIGURACIÓN
// ══════════════════════════════════════════════════════════

function authMiddleware(req, res, next) {
    const auth = req.headers['authorization'];

    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
        return res.status(401).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Acceso Restringido</title>
                <style>
                    body{background:#070707;color:#EDE8DF;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
                    .box{background:#141418;border:1px solid #FF5500;border-radius:12px;padding:40px;text-align:center;max-width:380px}
                    h2{color:#FF5500;font-size:22px;margin-bottom:10px}
                    p{color:#A89F94;font-size:14px;margin-bottom:20px}
                    a{display:inline-block;background:#FF5500;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold}
                    a:hover{background:#CC4300}
                </style>
            </head>
            <body>
                <div class="box">
                    <h2>🏮 ACCESO RESTRINGIDO</h2>
                    <p>El panel de redacción requiere autenticación.<br><br>Usuario: <strong>director</strong><br>Contraseña: <strong>311</strong></p>
                    <a href="/redaccion.html">ENTRAR AL PANEL</a>
                </div>
            </body>
            </html>
        `);
    }

    try {
        const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
        const [user, ...passParts] = decoded.split(':');
        const pass = passParts.join(':');

        if (user === 'director' && pass === '311') {
            return next();
        }
    } catch(e) { /* credenciales malformadas */ }

    res.setHeader('WWW-Authenticate', 'Basic realm="El Farol al Día - Redacción"');
    return res.status(401).send('Credenciales incorrectas. Usuario: director / Contraseña: 311');
}

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

if (!process.env.DATABASE_URL)   { console.error('❌ DATABASE_URL requerido');  process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY requerido'); process.exit(1); }

const PEXELS_API_KEY        = process.env.PEXELS_API_KEY        || null;
const FB_PAGE_ID            = process.env.FB_PAGE_ID            || null;
const FB_PAGE_TOKEN         = process.env.FB_PAGE_TOKEN         || null;
const TWITTER_API_KEY       = process.env.TWITTER_API_KEY       || null;
const TWITTER_API_SECRET    = process.env.TWITTER_API_SECRET    || null;
const TWITTER_ACCESS_TOKEN  = process.env.TWITTER_ACCESS_TOKEN  || null;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET || null;

const WATERMARK_PATH = path.join(__dirname, 'static', 'watermark.png');
const rssParser = new RSSParser({ timeout: 10000 });

// ══════════════════════════════════════════════════════════
// BASE DE DATOS
// ══════════════════════════════════════════════════════════
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: '*' }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'client')));

// ══════════════════════════════════════════════════════════
// CONFIG IA (guardada en memoria y BD)
// ══════════════════════════════════════════════════════════

const CONFIG_IA_DEFAULT = {
    enabled: true,
    instruccion_principal: 'Eres un periodista profesional dominicano de alto nivel, con visión nacional e internacional. Escribes noticias verificadas, equilibradas y con impacto real. Cubres República Dominicana completa, el Caribe, Latinoamérica y el mundo.',
    tono: 'profesional',
    extension: 'media',
    enfasis: 'Si la noticia es nacional: prioriza SDE, Los Mina, Invivienda, Ensanche Ozama. Si es internacional: conecta con el impacto en República Dominicana y el Caribe.',
    evitar: 'Limitar el tema solo a Santo Domingo Este. Especulación sin fuentes. Titulares sensacionalistas.'
};

let CONFIG_IA = { ...CONFIG_IA_DEFAULT };

async function cargarConfigIA() {
    try {
        const r = await pool.query(`SELECT valor FROM memoria_ia WHERE tipo='config_ia' AND valor IS NOT NULL ORDER BY ultima_vez DESC LIMIT 1`);
        if (r.rows.length) {
            const guardada = JSON.parse(r.rows[0].valor);
            CONFIG_IA = { ...CONFIG_IA_DEFAULT, ...guardada };
            console.log('✅ Config IA cargada desde BD');
        } else {
            console.log('✅ Config IA usando valores por defecto');
        }
    } catch(e) {
        console.log('⚠️ Config IA: usando defecto');
    }
    return CONFIG_IA;
}

async function guardarConfigIA(cfg) {
    try {
        const valor = JSON.stringify(cfg);
        await pool.query(`
            INSERT INTO memoria_ia(tipo, valor, categoria, exitos, fallos)
            VALUES('config_ia', $1, 'sistema', 1, 0)
            ON CONFLICT DO NOTHING
        `, [valor]);
        await pool.query(`
            UPDATE memoria_ia SET valor=$1, ultima_vez=NOW()
            WHERE tipo='config_ia' AND categoria='sistema'
        `, [valor]);
        return true;
    } catch(e) {
        console.error('❌ guardarConfigIA:', e.message);
        return false;
    }
}

// ══════════════════════════════════════════════════════════
// GEMINI
// ══════════════════════════════════════════════════════════

async function llamarGemini(prompt, reintentos = 3) {
    for (let i = 0; i < reintentos; i++) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.8, maxOutputTokens: 4000 }
                    })
                }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!texto) throw new Error('Respuesta vacía');
            return texto;
        } catch (err) {
            console.error(`   ❌ Intento ${i + 1}: ${err.message}`);
            if (i < reintentos - 1) await new Promise(r => setTimeout(r, 3000));
        }
    }
    throw new Error('Gemini no respondió');
}

// ══════════════════════════════════════════════════════════
// GENERAR NOTICIA
// ══════════════════════════════════════════════════════════

async function generarNoticia(categoria, comunicadoExterno = null) {
    try {
        if (!CONFIG_IA.enabled) return { success: false, error: 'IA desactivada' };

        const fuenteContenido = comunicadoExterno
            ? `\nCOMUNICADO OFICIAL:\n"""\n${comunicadoExterno}\n"""\nRedacta una noticia profesional basada en este comunicado.`
            : `\nEscribe una noticia NUEVA sobre la categoría "${categoria}" para República Dominicana.`;

        const prompt = `${CONFIG_IA.instruccion_principal}

${fuenteContenido}

CATEGORÍA: ${categoria}
TONO: ${CONFIG_IA.tono}
EXTENSIÓN: 400-500 palabras en 5 párrafos
EVITAR: ${CONFIG_IA.evitar}
ÉNFASIS LOCAL: ${CONFIG_IA.enfasis}

RESPONDE EXACTAMENTE CON ESTE FORMATO:
TITULO: [título atractivo]
DESCRIPCION: [150-160 caracteres exactos]
PALABRAS: [5 keywords separadas por comas]
CONTENIDO:
[noticia completa en 5 párrafos separados por línea en blanco]`;

        const texto = await llamarGemini(prompt);

        let titulo = '', desc = '', pals = '', contenido = '';
        let enContenido = false;
        const bloques = [];

        for (const linea of texto.split('\n')) {
            const t = linea.trim();
            if (t.startsWith('TITULO:')) titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:')) desc = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('PALABRAS:')) pals = t.replace('PALABRAS:', '').trim();
            else if (t.startsWith('CONTENIDO:')) enContenido = true;
            else if (enContenido && t.length > 0) bloques.push(t);
        }

        contenido = bloques.join('\n\n');

        if (!titulo) throw new Error('Gemini no devolvió TITULO');
        if (!contenido || contenido.length < 300) throw new Error('Contenido insuficiente');

        // APLICAR MONETIZACIÓN CPC
        const monetizada = monetizarNoticia({
            titulo: titulo,
            descripcion: desc,
            contenido: contenido,
            seccion: categoria
        });

        const slug = slugify(monetizada.titulo);
        
        // Verificar si ya existe
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length ? `${slug}-${Date.now()}` : slug;

        // Imagen por defecto
        const imagenDefault = 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=800';

        await pool.query(
            `INSERT INTO noticias(titulo, slug, seccion, contenido, seo_description, seo_keywords, estado, imagen, fecha, vistas) 
             VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [monetizada.titulo, slugFinal, categoria, monetizada.contenido, monetizada.descripcion, pals, 'publicada', imagenDefault, new Date().toISOString(), 0]
        );

        console.log(`✅ Noticia Monetizada: ${monetizada.titulo}`);
        return { success: true, titulo: monetizada.titulo, slug: slugFinal };

    } catch (error) {
        console.error('❌ Error Generación:', error.message);
        return { success: false, error: error.message };
    }
}

function slugify(t) {
    return t.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 60);
}

// ══════════════════════════════════════════════════════════
// INICIALIZAR BASE DE DATOS
// ══════════════════════════════════════════════════════════

async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS noticias(
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
                vistas INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado VARCHAR(50) DEFAULT 'publicada'
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS memoria_ia(
                id SERIAL PRIMARY KEY,
                tipo VARCHAR(50) NOT NULL,
                valor TEXT NOT NULL,
                categoria VARCHAR(100),
                exitos INTEGER DEFAULT 0,
                fallos INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Base de datos lista');
    } catch (e) {
        console.error('❌ BD:', e.message);
    } finally {
        client.release();
    }
    await cargarConfigIA();
}

// ══════════════════════════════════════════════════════════
// RUTAS API
// ══════════════════════════════════════════════════════════

// Health check
app.get('/health', (req, res) => res.json({ status: 'OK', version: '34.0' }));

// ads.txt - Google AdSense
app.get('/ads.txt', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

// Obtener noticias (público)
app.get('/api/noticias', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
        const r = await pool.query(
            `SELECT id, titulo, slug, seccion, imagen, imagen_alt, fecha, vistas, redactor 
             FROM noticias WHERE estado = 'publicada' ORDER BY fecha DESC LIMIT 30`
        );
        res.json({ success: true, noticias: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Obtener noticia por slug (público)
app.get('/api/noticias/:slug', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
        if (!r.rows.length) return res.status(404).json({ success: false, error: 'No encontrada' });
        
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [r.rows[0].id]);
        res.json({ success: true, noticia: r.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================
// 📡 API ENDPOINTS PARA PANEL DE REDACCIÓN (requieren PIN)
// ============================================================

// GET /api/admin/config - Obtener configuración
app.get('/api/admin/config', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') {
        return res.status(403).json({ error: 'PIN incorrecto' });
    }
    res.json({
        instruccion_principal: CONFIG_IA.instruccion_principal,
        enfasis: CONFIG_IA.enfasis,
        tono: CONFIG_IA.tono,
        evitar: CONFIG_IA.evitar,
        enabled: CONFIG_IA.enabled,
        ultima_actualizacion: new Date().toISOString()
    });
});

// POST /api/admin/config - Guardar configuración
app.post('/api/admin/config', authMiddleware, async (req, res) => {
    const { pin, instruccion, enfasis, tono, evitar, enabled } = req.body;
    
    if (pin !== '311') {
        return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }
    
    try {
        if (instruccion !== undefined) CONFIG_IA.instruccion_principal = instruccion;
        if (enfasis !== undefined) CONFIG_IA.enfasis = enfasis;
        if (tono !== undefined) CONFIG_IA.tono = tono;
        if (evitar !== undefined) CONFIG_IA.evitar = evitar;
        if (enabled !== undefined) CONFIG_IA.enabled = enabled;
        
        await guardarConfigIA(CONFIG_IA);
        res.json({ success: true, mensaje: 'Configuración guardada' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/generar-noticia - Generar noticia con IA
app.post('/api/generar-noticia', authMiddleware, async (req, res) => {
    const { categoria, pin } = req.body;
    
    if (pin !== '311') {
        return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }
    
    if (!categoria) {
        return res.status(400).json({ success: false, error: 'Falta categoría' });
    }
    
    const result = await generarNoticia(categoria);
    res.json(result);
});

// DELETE /api/eliminar/:id - Eliminar noticia
app.delete('/api/eliminar/:id', authMiddleware, async (req, res) => {
    const { pin } = req.body;
    const { id } = req.params;
    
    if (pin !== '311') {
        return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }
    
    try {
        await pool.query('DELETE FROM noticias WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// PUT /api/actualizar-imagen/:id - Actualizar imagen
app.put('/api/actualizar-imagen/:id', authMiddleware, async (req, res) => {
    const { pin, imagen } = req.body;
    const { id } = req.params;
    
    if (pin !== '311') {
        return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }
    
    if (!imagen || !imagen.startsWith('http')) {
        return res.status(400).json({ success: false, error: 'URL inválida' });
    }
    
    try {
        await pool.query('UPDATE noticias SET imagen = $1 WHERE id = $2', [imagen, id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/memoria - Obtener memoria IA
app.get('/api/memoria', authMiddleware, async (req, res) => {
    const { pin, limit } = req.query;
    
    if (pin !== '311') {
        return res.status(403).json({ error: 'PIN incorrecto' });
    }
    
    try {
        const r = await pool.query(
            'SELECT id, titulo, seccion as categoria, fecha FROM noticias ORDER BY fecha DESC LIMIT $1',
            [limit || 20]
        );
        
        const data = r.rows.map(row => ({
            ...row,
            exitosa: true,
            fecha: row.fecha
        }));
        
        res.json({ success: true, data });
    } catch (e) {
        res.json({ success: true, data: [] });
    }
});

// GET /api/estadisticas - Obtener estadísticas
app.get('/api/estadisticas', authMiddleware, async (req, res) => {
    const { pin } = req.query;
    
    if (pin !== '311') {
        return res.status(403).json({ error: 'PIN incorrecto' });
    }
    
    try {
        const total = await pool.query('SELECT COUNT(*) as total, SUM(vistas) as vistas FROM noticias WHERE estado = $1', ['publicada']);
        res.json({
            totalNoticias: parseInt(total.rows[0].total) || 0,
            totalVistas: parseInt(total.rows[0].vistas) || 0
        });
    } catch (e) {
        res.json({ totalNoticias: 0, totalVistas: 0 });
    }
});

// GET /api/coach - Coach de redacción
app.get('/api/coach', authMiddleware, async (req, res) => {
    const { pin, dias = 7 } = req.query;
    
    if (pin !== '311') {
        return res.status(403).json({ error: 'PIN incorrecto' });
    }
    
    try {
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - parseInt(dias));
        
        const noticias = await pool.query(
            `SELECT id, titulo, seccion, vistas, fecha FROM noticias 
             WHERE estado = 'publicada' AND fecha > $1 
             ORDER BY fecha DESC`,
            [fechaLimite.toISOString()]
        );
        
        if (noticias.rows.length === 0) {
            return res.json({ success: false, mensaje: 'No hay noticias en este período' });
        }
        
        const totalVistas = noticias.rows.reduce((sum, n) => sum + (n.vistas || 0), 0);
        const promedioGeneral = totalVistas / noticias.rows.length;
        
        const categorias = {};
        const categoriasLista = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];
        
        for (const cat of categoriasLista) {
            const catNoticias = noticias.rows.filter(n => n.seccion === cat);
            if (catNoticias.length > 0) {
                const catVistas = catNoticias.reduce((sum, n) => sum + (n.vistas || 0), 0);
                const catPromedio = catVistas / catNoticias.length;
                categorias[cat] = {
                    total: catNoticias.length,
                    vistas_promedio: Math.round(catPromedio),
                    rendimiento: promedioGeneral > 0 ? Math.round((catPromedio / promedioGeneral) * 100) : 0,
                    mejor: catNoticias.sort((a, b) => (b.vistas || 0) - (a.vistas || 0))[0]
                };
            }
        }
        
        res.json({
            success: true,
            total_noticias: noticias.rows.length,
            total_vistas: totalVistas,
            promedio_general: Math.round(promedioGeneral),
            categorias
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /status - Estado del sistema
app.get('/status', async (req, res) => {
    try {
        const r = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado = $1', ['publicada']);
        res.json({
            status: 'OK',
            version: '34.0',
            noticias: parseInt(r.rows[0].count),
            ia_activa: CONFIG_IA.enabled,
            monetizacion: 'CPC V1.0 Activa',
            sistema: 'Web + Facebook + Twitter + Telegram + RSS 30 fuentes + Wikipedia + Watermark + SEO E-E-A-T'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// PÁGINAS HTML
// ============================================================

// Sala de Redacción (protegida con Basic Auth) - Ruta SIN .html
app.get('/redaccion', authMiddleware, (req, res) => {
    const pathRedaccion = path.join(__dirname, 'client', 'redaccion.html');
    if (fs.existsSync(pathRedaccion)) {
        res.sendFile(pathRedaccion);
    } else {
        res.status(404).send('Error: El archivo redaccion.html no existe en la carpeta client');
    }
});

// Sala de Redacción - Ruta CON .html (fallback)
app.get('/redaccion.html', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// Página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Páginas legales
app.get('/privacidad', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'privacidad.html'));
});

app.get('/terminos', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'terminos.html'));
});

app.get('/cookies', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'cookies.html'));
});

app.get('/nosotros', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'nosotros.html'));
});

app.get('/contacto', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'contacto.html'));
});

// Ver noticia individual (fallback para SEO)
app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
        if (!r.rows.length) {
            return res.status(404).send('<h1>Noticia no encontrada</h1><a href="/">Volver al inicio</a>');
        }
        const n = r.rows[0];
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${n.titulo} | El Farol al Día</title>
                <meta name="description" content="${n.seo_description || ''}">
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; background: #0a0a0a; color: #e0e0e0; }
                    h1 { color: #FF5500; }
                    .meta { color: #888; font-size: 0.9em; margin-bottom: 20px; }
                    img { max-width: 100%; height: auto; border-radius: 8px; margin: 20px 0; }
                    a { color: #FF5500; text-decoration: none; }
                </style>
            </head>
            <body>
                <a href="/">← Volver al inicio</a>
                <h1>${n.titulo}</h1>
                <div class="meta">📅 ${new Date(n.fecha).toLocaleDateString('es-DO')} · 👁 ${n.vistas || 0} lecturas · 📍 ${n.seccion}</div>
                ${n.imagen ? `<img src="${n.imagen}" alt="${n.titulo}">` : ''}
                <div>${(n.contenido || '').replace(/\n/g, '<br>')}</div>
                <hr style="margin: 40px 0; border-color: #333;">
                <footer style="text-align: center; color: #666;">
                    <p>© 2026 El Farol al Día - Periódico Digital Dominicano</p>
                </footer>
            </body>
            </html>
        `);
    } catch(e) {
        res.status(500).send('Error al cargar la noticia');
    }
});

// Catch-all: cualquier otra ruta va al index
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ══════════════════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════════════════

async function iniciar() {
    await inicializarBase();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V34.0 + MONETIZACIÓN CPC                  ║
╠══════════════════════════════════════════════════════════════════╣
║  🌐 Servidor corriendo en puerto: ${PORT}                              ║
║  📰 Sala de Redacción: http://localhost:${PORT}/redaccion.html        ║
║  🔒 Usuario: director / Contraseña: 311                         ║
║  💰 Monetización CPC: ACTIVA                                    ║
╚══════════════════════════════════════════════════════════════════╝
        `);
    });
}

iniciar();

module.exports = app;
