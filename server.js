// ══════════════════════════════════════════════════════════
// 🏮 EL FAROL AL DÍA — SERVIDOR PRINCIPAL (MODULARIZADO)
// Versión: MXL-35.3-GOLD-READY (Celular Friendly)
// ══════════════════════════════════════════════════════════
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

// Importaciones de tus 4 pilares MXL
const { ENV, getPromptBase, CATEGORIAS, PB, OPT, BANCO_LOCAL, CAT_FALLBACK, RUTAS } = require('./config-mxl');
const { llamarGemini } = require('./motores-ia');
const { aplicarMarcaDeAgua } = require('./watermark');
const db = require('./db');

const app = express();
const BASE_URL = ENV.BASE_URL;

// ══════════════════════════════════════════════════════════
// 🔒 MIDDLEWARES
// ══════════════════════════════════════════════════════════
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).send('Acceso denegado');
    const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user === ENV.ADMIN_USER && pass === ENV.ADMIN_PIN) return next();
    res.status(401).send('Credenciales incorrectas');
}

// ══════════════════════════════════════════════════════════
// 📰 MOTOR DE GENERACIÓN (MXL CORE)
// ══════════════════════════════════════════════════════════
function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[ñ]/g, 'n').replace(/[^a-z0-9\s-]/g, '').trim()
        .replace(/\s+/g, '-').substring(0, 75);
}

async function generarNoticia(categoria) {
    console.log(`\n📰 Generando noticia para: ${categoria}...`);
    
    try {
        const recientes = await db.getTitulosRecientes(15);
        const memoria = recientes.map(r => `- ${r.titulo}`).join('\n');
        
        const prompt = `${getPromptBase()}
        
TEMAS RECIENTES (NO REPETIR):
${memoria}

CATEGORÍA: ${categoria}

RESPONDE EN ESTE FORMATO:
TITULO: [Título]
DESCRIPCION: [Resumen SEO]
SUBTEMA_LOCAL: [Barrio]
CONTENIDO:
[Mínimo 8 párrafos con sabor de SDE]`;

        const respuesta = await llamarGemini(prompt);
        
        let titulo = '', desc = '', subtema = '', contenido = '';
        let enContenido = false;
        for (const linea of respuesta.split('\n')) {
            const t = linea.trim();
            if (t.startsWith('TITULO:')) titulo = t.replace('TITULO:', '').trim();
            else if (t.startsWith('DESCRIPCION:')) desc = t.replace('DESCRIPCION:', '').trim();
            else if (t.startsWith('SUBTEMA_LOCAL:')) subtema = t.replace('SUBTEMA_LOCAL:', '').trim();
            else if (t.startsWith('CONTENIDO:')) enContenido = true;
            else if (enContenido && t.length) contenido += t + '\n';
        }

        const slug = slugify(titulo);
        const imgUrl = BANCO_LOCAL[subtema]?.[0] || BANCO_LOCAL[CAT_FALLBACK[categoria]]?.[0] || `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`;
        
        const imgConMarca = await aplicarMarcaDeAgua(imgUrl);
        const imgFinal = imgConMarca.procesada ? `${BASE_URL}/img/${imgConMarca.nombre}` : imgUrl;
        
        await db.crearNoticia({
            titulo, slug, seccion: categoria, contenido,
            imagen: imgFinal
        });
        
        console.log(`✅ Publicada: /noticia/${slug}`);
        return { success: true, slug };
    } catch (error) {
        console.error("❌ Error en generación:", error.message);
        return { success: false, error: error.message };
    }
}

// ══════════════════════════════════════════════════════════
// 🌐 RUTAS API Y PÁGINAS
// ══════════════════════════════════════════════════════════
app.get('/api/noticias', async (req, res) => {
    try {
        const noticias = await db.getNoticias();
        res.json(noticias);
    } catch (e) { res.status(500).json([]); }
});

app.get('/api/generar', async (req, res) => {
    const cat = req.query.cat || CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    const r = await generarNoticia(cat);
    res.json(r);
});

app.post('/api/generar', authMiddleware, async (req, res) => {
    const r = await generarNoticia(req.body.categoria || CATEGORIAS[0]);
    res.json(r);
});

app.get('/img/:nombre', (req, res) => {
    const ruta = path.join(RUTAS.TMP_DIR, req.params.nombre);
    if (fs.existsSync(ruta)) res.sendFile(ruta);
    else res.status(404).send('No encontrada');
});

app.get('/status', (req, res) => res.json({ status: 'OK', motor: 'MXL-MODULAR' }));

// ══════════════════════════════════════════════════════════
// ⏰ CRON Y ARRANQUE (BLINDADO)
// ══════════════════════════════════════════════════════════
cron.schedule('0 */2 * * *', () => {
    const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    generarNoticia(cat).catch(console.error);
});

async function start() {
    // 1. Intentamos DB pero no matamos el servidor si falla
    try {
        console.log("🛠️ Inicializando Base de Datos...");
        await db.inicializarDB();
        console.log("✅ DB lista.");
    } catch (dbErr) {
        console.error("⚠️ Error DB (Servidor seguirá vivo):", dbErr.message);
    }

    // 2. Arrancamos el servidor siempre
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — MXL GOLD EDITION (ONLINE)║
╚════════════════════════════════════════════════╝
Puerto: ${PORT} | Modo: Estable
        `);
    });
}

start().catch(err => console.error("🔥 Error Global:", err));
