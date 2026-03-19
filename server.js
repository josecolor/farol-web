/**
 * 🏮 EL FAROL AL DÍA — SERVER V35.0 (SUPABASE INTEGRATION)
 * 
 * ✨ NUEVAS CARACTERÍSTICAS:
 * • Supabase como "cerebro compartido" (tabla: reglas_mxl)
 * • Antes de generar: LEE TUS REGLAS desde Supabase
 * • Después de publicar: GUARDA MEMORIA en Supabase (tabla: memoria_ia)
 * • 100% RESILIENTE: Si Supabase se cae, funciona con defaults
 * 
 * GEMINI RESPETA TUS INSTRUCCIONES — NO ES SU REEMPLAZO
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

// 🧠 SUPABASE INTEGRATION
const { 
    supabase, 
    leerReglasUsuario, 
    guardarMemoriaPublicacion, 
    registrarErrorPublicacion, 
    actualizarReglasSupabase,
    obtenerEstadisticasMemoria
} = require('./supabase-integration');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ==================== DIRECTORIOS ====================
const IMAGES_DIR = path.join(__dirname, 'images');
const CACHE_DIR = path.join(IMAGES_DIR, 'cache');
const GEMINI_CACHE_PATH = path.join(__dirname, 'gemini-cache.json');

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ==================== BD POSTGRESQL ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(path.join(__dirname, 'client'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
    }
}));

app.use('/images', express.static(path.join(__dirname, 'images'), {
    setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
}));

app.use(cors());

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
        'https://images.pexels.com/photos/3761509/pexels-photo-3761509.jpeg',
        'https://images.pexels.com/photos/546819/pexels-photo-546819.jpeg',
        'https://images.pexels.com/photos/3394650/pexels-photo-3394650.jpeg',
        'https://images.pexels.com/photos/3861969/pexels-photo-3861969.jpeg',
        'https://images.pexels.com/photos/7974/pexels-photo.jpeg',
        'https://images.pexels.com/photos/3183591/pexels-photo-3183591.jpeg'
    ]
};

// ==================== CONFIG IA (MEMORIA LOCAL) ====================
let CONFIG_IA = {
    enabled: true,
    instruccion_principal: 'Eres un periodista profesional dominicano de alto nivel con 20 años de experiencia. Escribe noticias verificadas, equilibradas y con impacto real para República Dominicana.',
    tono: 'profesional',
    extension: 'media',
    enfasis: 'Noticias de Santo Domingo Este, Invivienda, Los Mina e impacto nacional en RD',
    evitar: 'Especulación sin fuentes, titulares sensacionalistas, nombres sin verificación'
};

// ==================== AUTH BÁSICO ====================
function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Sin autenticación' });
    
    const base64 = auth.replace('Basic ', '');
    const [user, pass] = Buffer.from(base64, 'base64').toString('utf8').split(':');
    
    if (user !== 'director' || pass !== '311') {
        return res.status(403).json({ error: 'Credenciales incorrectas' });
    }
    next();
}

// ==================== CREAR TABLAS SI NO EXISTEN ====================
async function crearTablas() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS noticias (
                id SERIAL PRIMARY KEY,
                titulo VARCHAR(255),
                contenido TEXT,
                slug VARCHAR(255) UNIQUE,
                seccion VARCHAR(100),
                imagen VARCHAR(500),
                imagen_alt VARCHAR(255),
                imagen_original BYTEA,
                seo_description VARCHAR(255),
                vistas INT DEFAULT 0,
                fecha TIMESTAMP DEFAULT NOW(),
                publicada BOOLEAN DEFAULT true,
                fuente VARCHAR(255)
            );
            CREATE INDEX IF NOT EXISTS idx_slug ON noticias(slug);
            CREATE INDEX IF NOT EXISTS idx_seccion ON noticias(seccion);
            CREATE INDEX IF NOT EXISTS idx_fecha ON noticias(fecha DESC);
        `);
        console.log('✅ Tabla noticias lista');
    } catch (e) {
        console.error('❌ Error creando tabla:', e.message);
    }
}

crearTablas();

// ==================== GEMINI API ====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

async function llamarGemini(prompt, retryCount = 0) {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: 4000,
                    temperature: 0.7,
                    topP: 0.95
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            if (response.status === 429 && retryCount < 3) {
                const delay = Math.pow(2, retryCount) * 5000;
                console.log(`⏳ Rate limit — esperando ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                return llamarGemini(prompt, retryCount + 1);
            }
            throw new Error(`HTTP ${response.status}: ${error.error?.message || 'Error desconocido'}`);
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (error) {
        console.error('❌ Gemini error:', error.message);
        throw error;
    }
}

// ==================== GENERAR NOTICIA (CON SUPABASE) ====================
async function generarNoticia(categoria, comunicadoExterno = null) {
    try {
        if (!CONFIG_IA.enabled) {
            return { success: false, error: 'IA desactivada' };
        }

        // 🧠 LEER REGLAS DEL USUARIO DESDE SUPABASE
        const reglasUsuario = await leerReglasUsuario('director');
        
        // Fusionar reglas Supabase con config en memoria
        const configFusionada = {
            ...CONFIG_IA,
            ...reglasUsuario
        };

        console.log('📖 Usando reglas:', {
            tono: configFusionada.tono,
            extension: configFusionada.extension,
            enfoque: configFusionada.enfoque_geografico
        });

        const prompt = `${configFusionada.instruccion_principal}

ROL: Eres el editor jefe de El Farol al Día con 20 años de experiencia en periodismo dominicano.

CATEGORÍA: ${categoria}
ENFOQUE: ${configFusionada.enfoque_geografico === 'rd' ? '🇩🇴 REPÚBLICA DOMINICANA — Priorizar Santo Domingo Este, Los Mina, Invivienda, Ensanche Ozama' : configFusionada.enfoque_geografico}
TONO: ${configFusionada.tono}
EXTENSIÓN: ${configFusionada.extension} (300-500 palabras)
ÉNFASIS ESPECIAL: ${configFusionada.enfasis}
A EVITAR: ${configFusionada.evitar}

INSTRUCCIONES FINALES:
1. Estructura tipo pirámide invertida (noticia más importante primero)
2. Incluye siempre: qué, quién, cuándo, dónde, por qué, cómo
3. Verifica datos antes de escribir
4. Usa "Último Minuto" si aplica
5. Sé equilibrado y profesional
6. Añade contexto relevante para lectores dominicanos

DEVUELVE JSON VÁLIDO:
{
  "titulo": "Título en mayúsculas tipo periódico",
  "contenido": "Párrafos separados con <br>",
  "seo_description": "Meta descripción (155 chars max)"
}`;

        const respuestaGemini = await llamarGemini(prompt);
        
        // Parsear JSON
        const match = respuestaGemini.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Formato JSON inválido de Gemini');

        const noticia = JSON.parse(match[0]);
        const slug = noticia.titulo
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 100);

        // Seleccionar imagen
        const imagenes = BANCO_ILUSTRATIVO[categoria] || BANCO_ILUSTRATIVO['Nacionales'];
        const imagen = imagenes[Math.floor(Math.random() * imagenes.length)];
        const altText = `${noticia.titulo} - El Farol al Día`;

        // Guardar en BD
        const resultado = await pool.query(
            `INSERT INTO noticias (titulo, contenido, slug, seccion, imagen, imagen_alt, seo_description, publicada)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true)
             ON CONFLICT (slug) DO NOTHING
             RETURNING id, slug, titulo`,
            [noticia.titulo, noticia.contenido, slug, categoria, imagen, altText, noticia.seo_description]
        );

        if (resultado.rows.length === 0) {
            console.warn('⚠️ Noticia duplicada, no insertada');
            return { success: false, error: 'Noticia duplicada' };
        }

        const slFin = resultado.rows[0].slug;
        console.log('✅ Noticia generada:', slFin);

        // 📚 GUARDAR EN MEMORIA SUPABASE (sin bloquear)
        Promise.resolve().then(async () => {
            await guardarMemoriaPublicacion({
                titulo: noticia.titulo,
                contenido: noticia.contenido,
                slug: slFin,
                seccion: categoria
            });
        });

        return {
            success: true,
            slug: slFin,
            titulo: noticia.titulo,
            alt: altText,
            mensaje: '✅ Publicada en web + Supabase memoria'
        };

    } catch (error) {
        console.error('❌ Error generando noticia:', error.message);
        
        // 📚 REGISTRAR ERROR EN SUPABASE
        await registrarErrorPublicacion(categoria, '', error.message);
        
        return { success: false, error: error.message };
    }
}

// ==================== RUTAS API ====================

// GET / → index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// GET /noticia/:slug
app.get('/noticia/:slug', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
        if (rows.length === 0) {
            return res.status(404).sendFile(path.join(__dirname, 'client', 'index.html'));
        }

        const n = rows[0];
        const html = `
<!DOCTYPE html>
<html lang="es-DO">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${n.titulo} - El Farol al Día</title>
  <meta name="description" content="${n.seo_description}">
  <meta property="og:title" content="${n.titulo}">
  <meta property="og:description" content="${n.seo_description}">
  <meta property="og:image" content="${n.imagen}">
  <meta property="og:url" content="${BASE_URL}/noticia/${n.slug}">
  <meta property="og:type" content="article">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": "${n.titulo}",
    "description": "${n.seo_description}",
    "image": "${n.imagen}",
    "datePublished": "${n.fecha}",
    "author": {
      "@type": "Organization",
      "name": "El Farol al Día"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Lora', Georgia, serif; background: #070707; color: #EDE8DF; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    header { text-align: center; margin: 30px 0; }
    .logo { font-size: 28px; font-weight: bold; color: #FF5500; margin-bottom: 10px; }
    .fecha { color: #777; font-size: 14px; }
    .titulo { font-size: 36px; margin: 20px 0; line-height: 1.2; }
    .meta { color: #B8B0A4; margin: 15px 0; }
    .categoria { display: inline-block; background: rgba(255,85,0,.2); color: #FF5500; padding: 5px 12px; border-radius: 20px; font-size: 12px; }
    .imagen { width: 100%; max-height: 400px; object-fit: cover; border-radius: 12px; margin: 30px 0; }
    .contenido { line-height: 1.8; font-size: 16px; margin: 30px 0; }
    .contenido p { margin-bottom: 15px; }
    a.volver { color: #FF5500; text-decoration: none; margin-top: 30px; display: inline-block; border-bottom: 1px solid transparent; }
    a.volver:hover { border-bottom-color: #FF5500; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">🏮 EL FAROL AL DÍA</div>
      <div class="fecha">${new Date(n.fecha).toLocaleDateString('es-DO')}</div>
    </header>
    
    <h1 class="titulo">${n.titulo}</h1>
    
    <div class="meta">
      <span class="categoria">${n.seccion}</span>
      <span style="margin-left: 15px; color: #777;">👁 ${n.vistas || 0} lecturas</span>
    </div>

    <img src="${n.imagen}" alt="${n.imagen_alt}" class="imagen" onerror="this.src='https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg'">
    
    <div class="contenido">${n.contenido.replace(/\n/g, '<p>')}</div>

    <a href="/" class="volver">← Volver a noticias</a>
  </div>
</body>
</html>`;
        res.send(html);
        
        // Incrementar vistas async
        pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE slug = $1', [req.params.slug]).catch(e => null);

    } catch (e) {
        res.status(500).send('Error cargando noticia');
    }
});

// GET /api/noticias
app.get('/api/noticias', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM noticias WHERE publicada = true ORDER BY fecha DESC LIMIT 50'
        );
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json({ success: true, noticias: rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/generar-noticia (con Basic Auth)
app.post('/api/generar-noticia', authMiddleware, express.json(), async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

    const resultado = await generarNoticia(categoria);
    res.json(resultado);
});

// 🧠 POST /api/reglas/actualizar (PIN 311)
app.post('/api/reglas/actualizar', authMiddleware, express.json(), async (req, res) => {
    const { 
        pin, 
        instruccion_principal, 
        tono, 
        extension, 
        enfasis, 
        evitar, 
        palabras_clave, 
        enfoque_geografico 
    } = req.body;

    if (pin !== '311') {
        return res.status(403).json({ error: 'PIN incorrecto' });
    }

    // Actualizar en Supabase
    const ok = await actualizarReglasSupabase({
        instruccion_principal,
        tono,
        extension,
        enfasis,
        evitar,
        palabras_clave: typeof palabras_clave === 'string' ? palabras_clave : palabras_clave?.join(','),
        enfoque_geografico
    });

    if (ok) {
        // Actualizar también en memoria para que Gemini use inmediatamente
        CONFIG_IA = {
            ...CONFIG_IA,
            instruccion_principal: instruccion_principal || CONFIG_IA.instruccion_principal,
            tono: tono || CONFIG_IA.tono,
            extension: extension || CONFIG_IA.extension,
            enfasis: enfasis || CONFIG_IA.enfasis,
            evitar: evitar || CONFIG_IA.evitar
        };
        
        return res.json({ 
            success: true, 
            mensaje: '✅ Reglas actualizadas — Gemini las usará en próxima noticia',
            config_actual: CONFIG_IA
        });
    }

    res.status(500).json({ 
        success: false, 
        error: 'Error guardando en Supabase (pero sistema sigue funcionando)' 
    });
});

// 🧠 GET /api/reglas/estadisticas (PIN 311)
app.get('/api/reglas/estadisticas', authMiddleware, async (req, res) => {
    if (req.query.pin !== '311') {
        return res.status(403).json({ error: 'PIN requerido' });
    }
    
    const stats = await obtenerEstadisticasMemoria('director', parseInt(req.query.dias) || 7);
    
    if (!stats) {
        return res.json({ 
            success: false, 
            error: 'Supabase offline — no hay estadísticas disponibles',
            nota: 'El sistema sigue funcionando normalmente'
        });
    }

    res.json({ success: true, ...stats });
});

// GET /api/admin/config (config actual)
app.get('/api/admin/config', authMiddleware, (req, res) => {
    res.json({ success: true, config: CONFIG_IA });
});

// GET /status
app.get('/status', (req, res) => {
    res.json({ 
        status: 'online',
        version: '35.0-SUPABASE',
        timestamp: new Date().toISOString(),
        supabase_connected: !!supabase,
        ia_enabled: CONFIG_IA.enabled
    });
});

// Keep-alive
cron.schedule('*/14 * * * *', async () => {
    console.log('🔄 Keep-alive ping', new Date().toLocaleTimeString());
});

// Auto-generar noticia cada 4 horas
cron.schedule('0 */4 * * *', async () => {
    console.log('📰 Generando noticia automática...');
    const cats = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología'];
    const cat = cats[Math.floor(Math.random() * cats.length)];
    await generarNoticia(cat);
});

// ==================== CATCH-ALL ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — SERVER V35.0        ║
║     SUPABASE INTEGRATION ACTIVE            ║
╚════════════════════════════════════════════╝

📡 Puerto: ${PORT}
🌐 URL: ${BASE_URL}
🤖 Gemini: ${GEMINI_API_KEY ? '✅ Conectado' : '❌ Sin API key'}
🧠 Supabase: ${supabase ? '✅ Conectado' : '⚠️ Offline (funciona sin él)'}
🔒 Auth: director/311

📖 Reglas desde Supabase (tabla: reglas_mxl)
📚 Memoria en Supabase (tabla: memoria_ia)

ENDPOINTS:
  POST /api/generar-noticia (Basic Auth)
  POST /api/reglas/actualizar (PIN 311)
  GET  /api/reglas/estadisticas (PIN 311)
  GET  /api/noticias
  GET  /status

Listo para servir noticias. ¡Que brille El Farol! 🔥
    `);
});

module.exports = app;
