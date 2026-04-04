// ══════════════════════════════════════════════════════════
// 🏮 EL FAROL AL DÍA — SERVIDOR PRINCIPAL (MODULARIZADO)
// Versión: MXL-35.3-GOLD-READY
// ══════════════════════════════════════════════════════════
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const webPush = require('web-push');

// Importaciones de tus módulos MXL
const { ENV, getPromptBase, CATEGORIAS, PB, OPT, BANCO_LOCAL, CAT_FALLBACK } = require('./config-mxl');
const { llamarGemini } = require('./motores-ia');
const { aplicarMarcaDeAgua } = require('./watermark');
const db = require('./db');
const { leerEstrategia } = require('./estrategia-loader');
const { analizarYGenerar } = require('./estrategia-analyzer');

const app = express();
const BASE_URL = ENV.BASE_URL;

// ══════════════════════════════════════════════════════════
// 🔒 MIDDLEWARES Y SEGURIDAD
// ══════════════════════════════════════════════════════════
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).send('Acceso denegado');
    try {
        const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
        const [user, pass] = decoded.split(':');
        if (user === ENV.ADMIN_USER && pass === ENV.ADMIN_PIN) return next();
    } catch (e) { /* Error de decodificación */ }
    res.status(401).send('Credenciales incorrectas');
}

// ══════════════════════════════════════════════════════════
// 📱 CONFIGURACIÓN WEB PUSH (NOTIFICACIONES)
// ══════════════════════════════════════════════════════════
if (ENV.VAPID_PUBLIC_KEY && ENV.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(ENV.VAPID_SUBJECT, ENV.VAPID_PUBLIC_KEY, ENV.VAPID_PRIVATE_KEY);
}

async function enviarPush(titulo, cuerpo, slug, imagen) {
    if (!ENV.VAPID_PUBLIC_KEY) return false;
    const subs = await db.getSuscriptoresPush();
    if (!subs.length) return false;
    
    const payload = JSON.stringify({
        title: titulo.substring(0, 80),
        body: cuerpo.substring(0, 120),
        icon: imagen || `${BASE_URL}/static/favicon.png`,
        data: { url: `${BASE_URL}/noticia/${slug}` }
    });
    
    let ok = 0;
    for (const sub of subs) {
        try {
            await webPush.sendNotification({ 
                endpoint: sub.endpoint, 
                keys: { auth: sub.auth_key, p256dh: sub.p256dh_key } 
            }, payload);
            await db.actualizarUltimaNotificacion(sub.endpoint);
            ok++;
        } catch (err) {
            if (err.statusCode === 410) await db.eliminarSuscripcionPush(sub.endpoint);
        }
    }
    return ok > 0;
}

// ══════════════════════════════════════════════════════════
// 📰 NÚCLEO DE GENERACIÓN (EL MOTOR MXL)
// ══════════════════════════════════════════════════════════
function slugify(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[ñ]/g, 'n').replace(/[^a-z0-9\s-]/g, '').trim()
        .replace(/\s+/g, '-').substring(0, 75);
}

function validarContenido(contenido) {
    if (!contenido || contenido.length < 700) return { valido: false, razon: 'Contenido insuficiente (mínimo 700 chars)' };
    const barrios = ['Los Mina', 'Invivienda', 'Charles de Gaulle', 'Ensanche Ozama', 'Sabana Perdida', 'Villa Mella', 'La Venezuela'];
    const tieneBarrio = barrios.some(b => contenido.toLowerCase().includes(b.toLowerCase()));
    if (!tieneBarrio) return { valido: false, razon: 'No menciona barrios críticos de SDE' };
    const frases = ['se supo', 'vecinos dicen', 'se armó', 'de buena fuente', 'está en grito', 'la policía'];
    const tieneFrase = frases.some(f => contenido.toLowerCase().includes(f));
    if (!tieneFrase) return { valido: false, razon: 'Falta sabor y lenguaje de barrio' };
    return { valido: true };
}

async function generarNoticia(categoria) {
    console.log(`\n📰 Iniciando Motor MXL para: ${categoria}...`);
    
    const recientes = await db.getTitulosRecientes(20);
    const memoria = recientes.map(r => `- ${r.titulo} [${r.seccion}]`).join('\n');
    const estrategia = leerEstrategia();
    
    const prompt = `${getPromptBase()}
    
⛔ TEMAS RECIENTES (PROHIBIDO REPETIR):
${memoria}

CATEGORÍA ACTUAL: ${categoria}
ESTRATEGIA SDE: ${estrategia}

FORMATO DE RESPUESTA (ESTRICTO):
TITULO: [Título impactante]
DESCRIPCION: [Resumen SEO 150 chars]
PALABRAS: [Tags separados por coma]
SUBTEMA_LOCAL: [Barrio o punto clave]
CONTENIDO:
[Mínimo 8 párrafos detallados con lenguaje dominicano]`;

    // Llama al motor con fallback a DeepSeek automático
    const respuesta = await llamarGemini(prompt);
    
    let titulo = '', desc = '', palabras = '', subtema = '', contenido = '';
    let enContenido = false;
    for (const linea of respuesta.split('\n')) {
        const t = linea.trim();
        if (t.startsWith('TITULO:')) titulo = t.replace('TITULO:', '').trim();
        else if (t.startsWith('DESCRIPCION:')) desc = t.replace('DESCRIPCION:', '').trim();
        else if (t.startsWith('PALABRAS:')) palabras = t.replace('PALABRAS:', '').trim();
        else if (t.startsWith('SUBTEMA_LOCAL:')) subtema = t.replace('SUBTEMA_LOCAL:', '').trim();
        else if (t.startsWith('CONTENIDO:')) enContenido = true;
        else if (enContenido && t.length) contenido += t + '\n';
    }
    
    const validacion = validarContenido(contenido);
    if (!validacion.valido) throw new Error(`Calidad insuficiente: ${validacion.razon}`);
    
    const slugBase = slugify(titulo);
    let slug = slugBase;
    if (await db.existeSlug(slugBase)) slug = `${slugBase}-${Date.now().toString().slice(-6)}`;
    
    // Selección de imagen y marca de agua
    const imgUrl = BANCO_LOCAL[subtema]?.[0] || BANCO_LOCAL[CAT_FALLBACK[categoria]]?.[0] || `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`;
    const imgConMarca = await aplicarMarcaDeAgua(imgUrl);
    const imgFinal = imgConMarca.procesada ? `${BASE_URL}/img/${imgConMarca.nombre}` : imgUrl;
    
    await db.crearNoticia({
        titulo, slug, seccion: categoria, contenido: contenido.substring(0, 10000),
        seo_description: desc.substring(0, 160), seo_keywords: palabras || categoria,
        redactor: 'Redacción El Farol', imagen: imgFinal, imagen_alt: titulo,
        imagen_caption: `Sucesos en SDE: ${titulo}`, imagen_nombre: imgConMarca.nombre || 'efd.jpg',
        imagen_fuente: imgConMarca.procesada ? 'watermark' : 'pexels', imagen_original: imgUrl
    });
    
    await enviarPush(titulo, desc, slug, imgFinal);
    console.log(`✅ Noticia publicada: /noticia/${slug}`);
    return { success: true, slug };
}

// ══════════════════════════════════════════════════════════
// 🌐 RUTAS DE LA API (CONTROL TOTAL)
// ══════════════════════════════════════════════════════════
app.get('/api/noticias', async (req, res) => {
    res.json({ success: true, noticias: await db.getNoticias() });
});

app.get('/api/estadisticas', async (req, res) => {
    res.json(await db.getEstadisticas());
});

app.post('/api/generar-noticia', authMiddleware, async (req, res) => {
    try {
        const r = await generarNoticia(req.body.categoria || CATEGORIAS[0]);
        res.json(r);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/publicar-manual', authMiddleware, async (req, res) => {
    const { titulo, seccion, contenido } = req.body;
    if (!titulo || !contenido) return res.status(400).json({ error: 'Faltan campos' });
    const slug = slugify(titulo);
    await db.crearNoticia({ titulo, slug, seccion, contenido, redactor: 'Editor Jefe', imagen: `${PB}/3052454/pexels-photo-3052454.jpeg${OPT}` });
    res.json({ success: true, slug });
});

app.post('/api/eliminar/:id', authMiddleware, async (req, res) => {
    await db.eliminarNoticia(req.params.id);
    res.json({ success: true });
});

app.post('/api/push/suscribir', async (req, res) => {
    const { subscription, userAgent } = req.body;
    await db.guardarSuscripcionPush(subscription.endpoint, subscription.keys.auth, subscription.keys.p256dh, userAgent);
    res.json({ success: true });
});

app.get('/api/push/vapid-key', (req, res) => {
    res.json({ publicKey: ENV.VAPID_PUBLIC_KEY });
});

app.get('/status', async (req, res) => {
    const total = await db.getNoticias();
    res.json({ status: 'ONLINE', motor: 'MXL-35.3', total_noticias: total.length });
});

// ══════════════════════════════════════════════════════════
// 🖼️ SERVIDOR DE IMÁGENES PROCESADAS
// ══════════════════════════════════════════════════════════
app.get('/img/:nombre', (req, res) => {
    const ruta = path.join('/tmp', req.params.nombre);
    if (fs.existsSync(ruta)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.sendFile(ruta);
    } else {
        res.status(404).send('Imagen expirada o no encontrada');
    }
});

// ══════════════════════════════════════════════════════════
// 📄 RUTAS DE PÁGINAS (FRONTEND)
// ══════════════════════════════════════════════════════════
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

app.get('/redaccion', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

app.get('/noticia/:slug', async (req, res) => {
    const noticia = await db.getNoticiaBySlug(req.params.slug);
    if (!noticia) return res.status(404).send('Esta noticia no existe en El Farol.');
    
    await db.incrementarVistas(noticia.id);
    let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
    
    // Inyección de contenido dinámico
    html = html.replace(/{{TITULO}}/g, noticia.titulo)
               .replace(/{{IMAGEN}}/g, noticia.imagen)
               .replace(/{{CONTENIDO}}/g, noticia.contenido.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join(''))
               .replace(/{{DESC}}/g, noticia.seo_description);
    res.send(html);
});

// ══════════════════════════════════════════════════════════
// ⏰ AUTOMATIZACIÓN (CRON JOBS)
// ══════════════════════════════════════════════════════════
// Generar noticia cada 2 horas automáticamente
cron.schedule('0 */2 * * *', () => {
    const hora = new Date().getHours();
    const cat = CATEGORIAS[Math.floor(hora / 2) % CATEGORIAS.length];
    generarNoticia(cat).catch(err => console.error('Error Cron Noticia:', err.message));
});

// Analizar estrategia de SDE cada 6 horas
cron.schedule('0 */6 * * *', () => {
    analizarYGenerar().catch(err => console.error('Error Cron Estrategia:', err.message));
});

// ══════════════════════════════════════════════════════════
// 🚀 ARRANQUE DEL SISTEMA
// ══════════════════════════════════════════════════════════
async function start() {
    try {
        console.log("🛠️ Inicializando base de datos...");
        await db.inicializarDB();
        
        app.listen(ENV.PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════╗
║      🏮 EL FAROL AL DÍA — MXL GOLD EDITION               ║
╠══════════════════════════════════════════════════════════╣
║  ✅ Servidor: ONLINE en puerto ${ENV.PORT}                      ║
║  ✅ Motores: Gemini (4 Keys) + DeepSeek Fallback         ║
║  ✅ SDE Ready: Los Mina, Invivienda, Ozama, Venezuela    ║
║  ✅ Branding: Marca de Agua Sharp Activa                 ║
╚══════════════════════════════════════════════════════════╝
            `);
        });

        // Lanzar primera noticia de prueba a los 30 segundos del arranque
        setTimeout(() => {
            console.log("⚡ Lanzando noticia de apertura...");
            generarNoticia(CATEGORIAS[0]).catch(() => {});
        }, 30000);

    } catch (err) {
        console.error("❌ Error crítico al iniciar:", err);
        process.exit(1);
    }
}

start();

module.exports = app;
