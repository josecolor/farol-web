/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR DEFINITIVO V4.0
 * Con publicaciones programadas usando Agenda
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Agenda = require('agenda');

const app = express();
const PORT = process.env.PORT || 8080;

// ==================== MANEJO DE ERRORES GLOBAL ====================
process.on('uncaughtException', (err) => {
    console.error('❌ Excepción no capturada:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => res.status(200).send('OK'));

// ==================== VALIDACIÓN DE MONGO_URL ====================
const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
    console.error('\n❌ ERROR CRÍTICO: Variable MONGO_URL no está definida en Railway.');
    process.exit(1);
}
console.log('📡 MONGO_URL encontrada. Conectando...');

// ==================== CONEXIÓN A MONGODB ====================
async function conectarMongoDB() {
    const maxIntentos = 5;
    for (let i = 1; i <= maxIntentos; i++) {
        try {
            console.log(`📡 Intento ${i}/${maxIntentos} - Conectando a MongoDB...`);
            await mongoose.connect(MONGO_URL, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                family: 4,
            });
            console.log('✅ 🟢 ¡BÚNKER CONECTADO A MONGODB!');
            return true;
        } catch (error) {
            console.error(`❌ Intento ${i} falló:`, error.message);
            if (i === maxIntentos) {
                console.error('\n🛑 No se pudo conectar después de 5 intentos. Saliendo...');
                process.exit(1);
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// ==================== INICIALIZAR AGENDA ====================
let agenda;
(async function initAgenda() {
    await conectarMongoDB(); // Aseguramos conexión primero
    agenda = new Agenda({ db: { address: MONGO_URL, collection: 'agendaJobs' } });

    // Definir el trabajo de publicar noticia
    agenda.define('publicar noticia programada', async (job) => {
        const { noticiaId } = job.attrs.data;
        console.log(`📅 Ejecutando publicación programada para noticia: ${noticiaId}`);

        const noticia = await Noticia.findById(noticiaId);
        if (!noticia) {
            console.log(`❌ Noticia ${noticiaId} no encontrada, cancelando trabajo.`);
            await job.remove();
            return;
        }

        if (noticia.estado === 'programada') {
            noticia.estado = 'publicada';
            noticia.fecha = new Date(); // Actualizar fecha a ahora
            await noticia.save();
            console.log(`✅ Noticia "${noticia.titulo}" publicada automáticamente.`);
        } else {
            console.log(`⚠️ Noticia ${noticiaId} ya estaba publicada.`);
            await job.remove();
        }
    });

    await agenda.start();
    console.log('📅 Agenda (planificador) iniciado.');

    // Cada minuto revisamos si hay trabajos pendientes (esto ya lo hace agenda automáticamente)
})();

// ==================== ESQUEMAS ====================
const noticiaSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    seccion: { type: String, required: true },
    contenido: { type: String, required: true },
    ubicacion: { type: String, default: 'Santo Domingo' },
    redactor: { type: String, default: 'mxl' },
    redactorFoto: { type: String, default: null },
    imagen: { type: String, default: null },
    vistas: { type: Number, default: 0 },
    fecha: { type: Date, default: Date.now },
    // Nuevos campos para programación
    fechaProgramada: { type: Date, default: null },
    estado: { type: String, default: 'publicada', enum: ['programada', 'publicada'] },
    // Campos SEO
    seoTitle: { type: String, default: '' },
    seoDesc: { type: String, default: '' },
    seoKeywords: { type: String, default: '' },
});

const configSchema = new mongoose.Schema({
    googleVerification: { type: String, default: '' },
    googleAnalytics: { type: String, default: '' },
}, { strict: false });

const Noticia = mongoose.model('Noticia', noticiaSchema);
const Config = mongoose.model('Configuracion', configSchema);

// ==================== FUNCIONES DE INYECCIÓN ====================
async function inyectarMeta(html) {
    try {
        const config = await Config.findOne().lean();
        if (config?.googleVerification) {
            const meta = `<meta name="google-site-verification" content="${config.googleVerification}" />`;
            html = html.replace('<!-- META_GOOGLE_VERIFICATION -->', meta);
        } else {
            html = html.replace('<!-- META_GOOGLE_VERIFICATION -->', '');
        }
    } catch (e) {
        console.error('⚠️ Error inyectando meta:', e.message);
    }
    return html;
}

async function inyectarAnalytics(html) {
    try {
        const config = await Config.findOne().lean();
        if (config?.googleAnalytics) {
            const script = `
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${config.googleAnalytics}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${config.googleAnalytics}');
</script>`;
            html = html.replace('<!-- GOOGLE_ANALYTICS -->', script);
        } else {
            html = html.replace('<!-- GOOGLE_ANALYTICS -->', '');
        }
    } catch (e) {
        console.error('⚠️ Error inyectando analytics:', e.message);
    }
    return html;
}

async function inyectarMetaNoticia(html, noticia) {
    try {
        if (!noticia) return html;
        const seoTitle = noticia.seoTitle || noticia.titulo;
        const seoDesc = noticia.seoDesc || noticia.contenido.substring(0, 160);
        const seoKeywords = noticia.seoKeywords || '';
        const ogImage = noticia.imagen || 'https://elfarolaldia.com/default.jpg';
        const ogUrl = `https://elfarolaldia.com/noticia/${noticia._id}`;

        html = html.replace('<!-- SEO_TITLE -->', seoTitle);
        html = html.replace('<!-- SEO_DESCRIPTION -->', seoDesc);
        html = html.replace('<!-- SEO_KEYWORDS -->', seoKeywords);
        html = html.replace('<!-- OG_TITLE -->', seoTitle);
        html = html.replace('<!-- OG_DESCRIPTION -->', seoDesc);
        html = html.replace('<!-- OG_IMAGE -->', ogImage);
        html = html.replace('<!-- OG_URL -->', ogUrl);
    } catch (e) {
        console.error('⚠️ Error inyectando meta noticia:', e.message);
    }
    return html;
}

// ==================== RUTAS HTML ====================
app.get('/', async (req, res) => {
    try {
        let html = fs.readFileSync(path.join(__dirname, 'client', 'index.html'), 'utf8');
        html = await inyectarMeta(html);
        html = await inyectarAnalytics(html);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        console.error('Error en GET /:', e.message);
        res.status(500).send('Error interno');
    }
});

app.get('/noticia/:id', async (req, res) => {
    try {
        const noticia = await Noticia.findById(req.params.id);
        if (!noticia) return res.status(404).send('Noticia no encontrada');

        let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
        html = await inyectarMeta(html);
        html = await inyectarAnalytics(html);
        html = await inyectarMetaNoticia(html, noticia);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        console.error('Error en GET /noticia/:id:', e.message);
        res.status(500).send('Error interno');
    }
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// ==================== RUTAS API ====================
app.get('/api/noticias', async (req, res) => {
    try {
        // Solo devolvemos noticias publicadas (no las programadas)
        const noticias = await Noticia.find({ estado: 'publicada' }).sort({ fecha: -1 }).lean();
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/noticias/:id', async (req, res) => {
    try {
        const noticia = await Noticia.findById(req.params.id);
        if (!noticia) return res.status(404).json({ success: false, error: 'No encontrada' });
        if (noticia.estado !== 'publicada') {
            return res.status(404).json({ success: false, error: 'Noticia no disponible' });
        }
        noticia.vistas = (noticia.vistas || 0) + 1;
        await noticia.save();
        res.json({ success: true, noticia });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen, seoTitle, seoDesc, seoKeywords, fechaProgramada } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        if (!titulo || !seccion || !contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });

        let estado = 'publicada';
        let fecha = new Date();

        // Si hay fechaProgramada, la noticia se guarda como programada
        if (fechaProgramada) {
            estado = 'programada';
            fecha = new Date(fechaProgramada); // Guardamos la fecha programada, pero la fecha de publicación será cuando se ejecute
        }

        const noticia = new Noticia({
            titulo: titulo.trim(),
            seccion,
            contenido: contenido.trim(),
            ubicacion: ubicacion?.trim() || 'Santo Domingo',
            redactor: redactor?.trim() || 'mxl',
            redactorFoto: redactorFoto || null,
            imagen: imagen || null,
            seoTitle: seoTitle?.trim() || '',
            seoDesc: seoDesc?.trim() || '',
            seoKeywords: seoKeywords?.trim() || '',
            fechaProgramada: fechaProgramada ? new Date(fechaProgramada) : null,
            estado,
            fecha: estado === 'publicada' ? new Date() : null // Si es programada, la fecha se pondrá cuando se publique
        });

        await noticia.save();

        if (estado === 'programada') {
            // Programar en Agenda
            await agenda.schedule(new Date(fechaProgramada), 'publicar noticia programada', { noticiaId: noticia._id });
            console.log(`📅 Noticia programada para: ${new Date(fechaProgramada).toLocaleString()}`);
            res.status(201).json({ success: true, message: 'Noticia programada con éxito 🗓️', id: noticia._id });
        } else {
            console.log('📰 Nueva noticia publicada:', noticia.titulo);
            res.status(201).json({ success: true, message: 'Publicado 🏮', id: noticia._id });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/configuracion', async (req, res) => {
    try {
        let config = await Config.findOne();
        if (!config) config = await Config.create({});
        res.json({ success: true, config: config.toObject() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/configuracion', async (req, res) => {
    try {
        const { pin, ...config } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        let configDoc = await Config.findOne();
        if (!configDoc) {
            configDoc = new Config(config);
        } else {
            Object.assign(configDoc, config);
        }
        await configDoc.save();
        res.json({ success: true, message: 'Configuración guardada' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const totalNoticias = await Noticia.countDocuments({ estado: 'publicada' });
        const totalVistas = await Noticia.aggregate([
            { $match: { estado: 'publicada' } },
            { $group: { _id: null, total: { $sum: '$vistas' } } }
        ]);
        res.json({ success: true, totalNoticias, totalVistas: totalVistas[0]?.total || 0 });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== SITEMAP ====================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const noticias = await Noticia.find({ estado: 'publicada' }).sort({ fecha: -1 }).lean();
        const urlBase = 'https://elfarolaldia.com';
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `  <url><loc>${urlBase}/</loc><priority>1.0</priority></url>\n`;
        noticias.forEach(n => {
            xml += `  <url><loc>${urlBase}/noticia/${n._id}</loc><lastmod>${n.fecha.toISOString().split('T')[0]}</lastmod><priority>0.8</priority></url>\n`;
        });
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (e) {
        res.status(500).send('Error generando sitemap');
    }
});

// ==================== FALLBACK ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR ====================
async function iniciarServidor() {
    // La conexión ya se hizo en initAgenda, pero esperamos a que agenda esté listo
    const server = app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - BÚNKER PRO 4.0 🏮          ║
╠════════════════════════════════════════════════════╣
║ ✅ Servidor escuchando en puerto ${PORT}           ║
║ 🏮 Portada: https://elfarolaldia.com              ║
║ 📄 Noticia: https://elfarolaldia.com/noticia/:id  ║
║ ✏️ Redacción: https://elfarolaldia.com/redaccion  ║
║ 🔍 SEO y Analytics: ACTIVADOS                      ║
║ 📸 Foto del periodista: ACTIVADA                   ║
║ 📅 Publicaciones programadas: ACTIVADAS            ║
║ 🟢 BÚNKER LISTO PARA OPERAR                        ║
╚════════════════════════════════════════════════════╝
        `);
    });

    process.on('SIGTERM', async () => {
        console.log('⏹️ Cerrando servidor gracefulmente...');
        await agenda.stop();
        server.close(() => {
            if (mongoose.connection.readyState === 1) mongoose.connection.close();
            process.exit(0);
        });
    });
}

iniciarServidor();

module.exports = app;
