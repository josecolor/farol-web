/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR DEFINITIVO V3.0
 * Con foto de periodista, SEO y Google Analytics integrados
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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
        const noticias = await Noticia.find().sort({ fecha: -1 }).lean();
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/noticias/:id', async (req, res) => {
    try {
        const noticia = await Noticia.findById(req.params.id);
        if (!noticia) return res.status(404).json({ success: false, error: 'No encontrada' });
        noticia.vistas = (noticia.vistas || 0) + 1;
        await noticia.save();
        res.json({ success: true, noticia });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen, seoTitle, seoDesc, seoKeywords } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        if (!titulo || !seccion || !contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });

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
            seoKeywords: seoKeywords?.trim() || ''
        });
        await noticia.save();
        console.log('📰 Nueva noticia:', noticia.titulo);
        res.status(201).json({ success: true, message: 'Publicado 🏮', id: noticia._id });
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
        const totalNoticias = await Noticia.countDocuments();
        const totalVistas = await Noticia.aggregate([{ $group: { _id: null, total: { $sum: '$vistas' } } }]);
        res.json({ success: true, totalNoticias, totalVistas: totalVistas[0]?.total || 0 });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== SITEMAP ====================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const noticias = await Noticia.find().sort({ fecha: -1 }).lean();
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
    await conectarMongoDB();
    const server = app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - BÚNKER PRO 3.0 🏮          ║
╠════════════════════════════════════════════════════╣
║ ✅ Servidor escuchando en puerto ${PORT}           ║
║ 🏮 Portada: https://elfarolaldia.com              ║
║ 📄 Noticia: https://elfarolaldia.com/noticia/:id  ║
║ ✏️ Redacción: https://elfarolaldia.com/redaccion  ║
║ 🔍 SEO y Analytics: ACTIVADOS                      ║
║ 📸 Foto del periodista: ACTIVADA                   ║
║ 🟢 BÚNKER LISTO PARA OPERAR                        ║
╚════════════════════════════════════════════════════╝
        `);
    });
    process.on('SIGTERM', () => {
        console.log('⏹️ Cerrando servidor gracefulmente...');
        server.close(() => {
            if (mongoose.connection.readyState === 1) mongoose.connection.close();
            process.exit(0);
        });
    });
}
iniciarServidor();

module.exports = app;
