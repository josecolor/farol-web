/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR DEFINITIVO V6.2
 * Con IA generativa (Gemini 2.5 Flash), caché con Redis, cola de trabajos BullMQ,
 * compresión, limpieza optimizada y monitoreo avanzado.
 * LIMPIEZA: noticias de más de 8 DÍAS se eliminan automáticamente.
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Agenda = require('agenda');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const compression = require('compression');
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');

const app = express();
const PORT = process.env.PORT || 8080;

// ==================== CONEXIÓN A REDIS ====================
const redisConnection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
});

// ==================== COLA DE TRABAJOS ====================
const generacionQueue = new Queue('generacion-noticias', { connection: redisConnection });

// Worker que procesa cada trabajo de generación
const worker = new Worker('generacion-noticias', async job => {
    const { categoria, fechaPublicacion } = job.data;
    console.log(`⚙️ Procesando generación de noticia para categoría: ${categoria}`);
    
    const response = await fetch(`${process.env.BASE_URL}/api/generar-noticia-internal`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_SECRET
        },
        body: JSON.stringify({ categoria })
    });
    
    const data = await response.json();
    if (data.success) {
        console.log(`✅ Noticia generada y programada: ${data.id}`);
    } else {
        console.error(`❌ Error generando noticia: ${data.error}`);
    }
}, { connection: redisConnection, concurrency: 2 });

// ==================== TRUST PROXY ====================
app.set('trust proxy', true);

// ==================== COMPRESIÓN ====================
app.use(compression());

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

// ==================== RATE LIMITING ====================
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Demasiadas peticiones, intenta más tarde' }
});
app.use('/api/', apiLimiter);

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => res.status(200).send('OK'));

// ==================== VALIDACIÓN DE VARIABLES ====================
const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
    console.error('\n❌ ERROR: Variable MONGO_URL no definida.');
    process.exit(1);
}
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error('\n❌ ERROR: Variable GEMINI_API_KEY no definida.');
    process.exit(1);
}
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
if (!INTERNAL_SECRET) {
    console.error('\n❌ ERROR: Variable INTERNAL_SECRET no definida.');
    process.exit(1);
}
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO || EMAIL_USER;

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

console.log('📡 Variables de entorno validadas.');

// ==================== CONFIGURACIÓN DE NODEMAILER ====================
let transporter = null;
if (EMAIL_USER && EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        }
    });
    console.log('📧 Notificaciones por correo activadas');
} else {
    console.log('⚠️ Notificaciones por correo no configuradas');
}

async function enviarNotificacion(noticia) {
    if (!transporter) return;
    const mailOptions = {
        from: `"El Farol al Día" <${EMAIL_USER}>`,
        to: EMAIL_TO,
        subject: `📰 Noticia publicada: ${noticia.titulo}`,
        html: `
            <h2>¡Nueva noticia publicada automáticamente!</h2>
            <p><strong>Título:</strong> ${noticia.titulo}</p>
            <p><strong>Sección:</strong> ${noticia.seccion}</p>
            <p><strong>Resumen:</strong> ${noticia.seoDesc || noticia.contenido.substring(0, 200)}...</p>
            <p><strong>URL:</strong> <a href="${BASE_URL}${noticia.url || `/noticia/${noticia._id}`}">Ver noticia</a></p>
            <p><small>Publicado el ${new Date().toLocaleString()}</small></p>
        `
    };
    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Notificación enviada para: ${noticia.titulo}`);
    } catch (error) {
        console.error('❌ Error enviando correo:', error.message);
    }
}

// ==================== FUNCIÓN PARA BUSCAR IMAGEN EN UNSPLASH ====================
async function buscarImagenUnsplash(query) {
    if (!UNSPLASH_ACCESS_KEY) return null;
    try {
        const response = await fetch(
            `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
            { headers: { 'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}` } }
        );
        const data = await response.json();
        if (data.results && data.results.length > 0) {
            return data.results[0].urls.regular;
        }
    } catch (error) {
        console.error('Error buscando imagen en Unsplash:', error.message);
    }
    return null;
}

// ==================== CONEXIÓN MONGODB ====================
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
                console.error('\n🛑 No se pudo conectar. Saliendo...');
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
    imagen: { type: String, default: '/default-news.jpg' },
    vistas: { type: Number, default: 0 },
    fecha: { type: Date, default: Date.now },
    fechaProgramada: { type: Date, default: null },
    estado: { type: String, default: 'publicada', enum: ['programada', 'publicada'] },
    seoTitle: { type: String, default: '' },
    seoDesc: { type: String, default: '' },
    seoKeywords: { type: String, default: '' },
    categoriaSlug: { type: String, default: '' },
    tags: [{ type: String }],
    url: { type: String, unique: true, sparse: true },
    readingTime: { type: Number, default: 3 },
    featured: { type: Boolean, default: false }
}, { timestamps: true });

const configSchema = new mongoose.Schema({
    googleVerification: { type: String, default: '' },
    googleAnalytics: { type: String, default: '' },
}, { strict: false });

const Noticia = mongoose.model('Noticia', noticiaSchema);
const Config = mongoose.model('Configuracion', configSchema);

// ==================== ÍNDICES ====================
Noticia.collection.createIndex({ categoriaSlug: 1, fecha: -1 });
Noticia.collection.createIndex({ estado: 1, fecha: -1 });
Noticia.collection.createIndex({ url: 1 }, { unique: true, sparse: true });

// ==================== CACHÉ CON REDIS ====================
const cache = redisConnection;

// ==================== MAPA DE CATEGORÍAS ====================
const categoriaSlugMap = {
    'Nacionales': 'nacional-rd',
    'Política': 'politica-rd',
    'Economía': 'economia',
    'Deportes': 'deportes',
    'Internacionales': 'internacionales',
    'Tecnología': 'tecnologia',
    'Salud': 'salud',
    'Espectáculos': 'entretenimiento'
};

// ==================== FUNCIÓN SLUG ====================
function generarSlug(texto) {
    return texto
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ==================== INYECCIÓN META ====================
async function inyectarMeta(html) {
    try {
        const config = await Config.findOne().lean();
        if (config?.googleVerification) {
            const meta = `<meta name="google-site-verification" content="${config.googleVerification}" />`;
            html = html.replace('<!-- META_GOOGLE_VERIFICATION -->', meta);
        } else {
            html = html.replace('<!-- META_GOOGLE_VERIFICATION -->', '');
        }
    } catch (e) {}
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
    } catch (e) {}
    return html;
}

async function inyectarMetaNoticia(html, noticia) {
    try {
        if (!noticia) return html;
        const seoTitle = noticia.seoTitle || noticia.titulo;
        const seoDesc = noticia.seoDesc || noticia.contenido.substring(0, 160);
        const seoKeywords = noticia.seoKeywords || '';
        const ogImage = noticia.imagen || `${BASE_URL}/default-news.jpg`;
        const ogUrl = `${BASE_URL}${noticia.url || `/noticia/${noticia._id}`}`;

        html = html.replace('<!-- SEO_TITLE -->', seoTitle);
        html = html.replace('<!-- SEO_DESCRIPTION -->', seoDesc);
        html = html.replace('<!-- SEO_KEYWORDS -->', seoKeywords);
        html = html.replace('<!-- OG_TITLE -->', seoTitle);
        html = html.replace('<!-- OG_DESCRIPTION -->', seoDesc);
        html = html.replace('<!-- OG_IMAGE -->', ogImage);
        html = html.replace('<!-- OG_URL -->', ogUrl);
    } catch (e) {}
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
        res.status(500).send('Error interno');
    }
});

app.get('/noticia/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const noticia = await Noticia.findOne({ url: `/noticia/${slug}` });
        if (!noticia) return res.status(404).send('Noticia no encontrada');

        let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
        html = await inyectarMeta(html);
        html = await inyectarAnalytics(html);
        html = await inyectarMetaNoticia(html, noticia);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        res.status(500).send('Error interno');
    }
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// ==================== RUTAS API CON CACHÉ ====================
app.get('/api/noticias', async (req, res) => {
    const cacheKey = 'noticias:portada';
    try {
        const cached = await cache.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        const noticias = await Noticia.find({ estado: 'publicada' })
            .select('titulo seccion contenido resumen imagen url fecha vistas redactor redactorFoto')
            .sort({ fecha: -1 })
            .limit(30)
            .lean();

        const response = { success: true, noticias };
        await cache.set(cacheKey, JSON.stringify(response), 'EX', 300);
        res.json(response);
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
        noticia.vistas += 1;
        await noticia.save();
        res.json({ success: true, noticia });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/categoria/:slug', async (req, res) => {
    const { slug } = req.params;
    const cacheKey = `categoria:${slug}`;
    try {
        const cached = await cache.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        const categoriaMap = Object.fromEntries(
            Object.entries(categoriaSlugMap).map(([k, v]) => [v, k])
        );
        const categoriaReal = categoriaMap[slug];
        if (!categoriaReal) return res.status(404).json({ success: false, error: 'Categoría no encontrada' });

        const noticias = await Noticia.find({ seccion: categoriaReal, estado: 'publicada' })
            .select('titulo seccion contenido resumen imagen url fecha vistas redactor')
            .sort({ fecha: -1 })
            .limit(30)
            .lean();

        const response = { success: true, categoria: slug, noticias };
        await cache.set(cacheKey, JSON.stringify(response), 'EX', 300);
        res.json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen, seoTitle, seoDesc, seoKeywords, fechaProgramada } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        if (!titulo || !seccion || !contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });

        const slug = generarSlug(titulo);
        const categoriaSlug = categoriaSlugMap[seccion] || 'general';
        const url = `/noticia/${slug}`;

        const existe = await Noticia.findOne({ url });
        if (existe) return res.status(400).json({ success: false, error: 'Ya existe una noticia con título similar' });

        let estado = 'publicada';
        if (fechaProgramada) estado = 'programada';

        const noticia = new Noticia({
            titulo: titulo.trim(),
            seccion,
            contenido: contenido.trim(),
            ubicacion: ubicacion?.trim() || 'Santo Domingo',
            redactor: redactor?.trim() || 'mxl',
            redactorFoto: redactorFoto || null,
            imagen: imagen || '/default-news.jpg',
            seoTitle: seoTitle?.trim() || '',
            seoDesc: seoDesc?.trim() || '',
            seoKeywords: seoKeywords?.trim() || '',
            tags: seoKeywords?.split(',').map(k => k.trim()) || [],
            categoriaSlug,
            url,
            fechaProgramada: fechaProgramada ? new Date(fechaProgramada) : null,
            estado,
            fecha: estado === 'publicada' ? new Date() : null,
            readingTime: Math.ceil(contenido.split(' ').length / 200)
        });

        await noticia.save();

        if (estado === 'programada') {
            await agenda.schedule(new Date(fechaProgramada), 'publicar noticia programada', { noticiaId: noticia._id });
            res.status(201).json({ success: true, message: 'Noticia programada con éxito 🗓️', id: noticia._id });
        } else {
            res.status(201).json({ success: true, message: 'Publicado 🏮', id: noticia._id });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/generar-noticia-internal', async (req, res) => {
    if (req.headers['x-internal-key'] !== INTERNAL_SECRET) {
        return res.status(403).json({ error: 'No autorizado' });
    }

    try {
        const { categoria } = req.body;
        if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

        const temas = [
            `últimas noticias sobre ${categoria} en República Dominicana`,
            `evento importante de ${categoria} hoy`,
            `análisis de ${categoria} en Santo Domingo`,
            `novedades de ${categoria} en el país`
        ];
        const tema = temas[Math.floor(Math.random() * temas.length)];

        const prompt = `
Eres un periodista digital especializado en ${categoria}. Genera una noticia en formato JSON con esta estructura exacta:

{
  "titulo": "string (máx. 100 caracteres, llamativo)",
  "contenido": "string (mín. 300 palabras, con datos concretos)",
  "resumen": "string (máx. 160 caracteres, para SEO)",
  "categoria": "${categoria}",
  "keywords": ["array", "de", "palabras", "clave"],
  "imagen_keywords": "string (palabras clave para buscar una imagen relacionada con la noticia)"
}

Tema: ${tema}
Estilo: neutral, objetivo, con lenguaje de República Dominicana.
        `;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            }
        );

        const data = await response.json();

        if (!data.candidates || !data.candidates.length) {
            throw new Error('Gemini no devolvió contenido');
        }

        const texto = data.candidates[0].content.parts[0].text;
        const jsonMatch = texto.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('JSON no válido');

        const noticiaGenerada = JSON.parse(jsonMatch[0]);

        const existe = await Noticia.findOne({
            titulo: noticiaGenerada.titulo,
            fecha: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });
        if (existe) return res.json({ message: 'Noticia duplicada, ignorada' });

        const query = noticiaGenerada.imagen_keywords || noticiaGenerada.titulo;
        const imagenUrl = await buscarImagenUnsplash(query);

        const slug = generarSlug(noticiaGenerada.titulo);
        const url = `/noticia/${slug}`;

        const nuevaNoticia = new Noticia({
            titulo: noticiaGenerada.titulo,
            seccion: categoria,
            contenido: noticiaGenerada.contenido,
            redactor: 'IA Gemini',
            seoDesc: noticiaGenerada.resumen,
            seoKeywords: noticiaGenerada.keywords?.join(', '),
            tags: noticiaGenerada.keywords || [],
            categoriaSlug,
            url,
            imagen: imagenUrl || '/default-news.jpg',
            estado: 'programada',
            fechaProgramada: new Date(Date.now() + 5 * 60000),
            readingTime: Math.ceil(noticiaGenerada.contenido.split(' ').length / 200)
        });

        await nuevaNoticia.save();

        if (agenda) {
            await agenda.schedule(new Date(Date.now() + 5 * 60000), 'publicar noticia programada', { noticiaId: nuevaNoticia._id });
        }

        res.json({
            success: true,
            message: 'Noticia generada y programada',
            id: nuevaNoticia._id,
            url: nuevaNoticia.url
        });

    } catch (error) {
        console.error('❌ Error en generación IA:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/generar-noticia', async (req, res) => {
    if (req.headers['x-internal-key'] !== INTERNAL_SECRET) {
        return res.status(403).json({ error: 'No autorizado' });
    }

    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

    await generacionQueue.add('generar', { 
        categoria, 
        fechaPublicacion: new Date(Date.now() + 5 * 60000) 
    });

    res.json({ success: true, message: 'Trabajo encolado, la noticia se generará en breve' });
});

app.get('/status', async (req, res) => {
    try {
        const redisStatus = await redisConnection.ping() === 'PONG' ? 'ok' : 'error';
        const queueJobs = await generacionQueue.getJobCounts();

        res.json({
            uptime: process.uptime(),
            memoria: process.memoryUsage(),
            cpu: process.cpuUsage(),
            mongodb: mongoose.connection.readyState === 1 ? 'conectado' : 'desconectado',
            redis: redisStatus,
            cola: {
                pendientes: queueJobs.waiting || 0,
                activos: queueJobs.active || 0,
                completados: queueJobs.completed || 0,
                fallidos: queueJobs.failed || 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
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

app.get('/sitemap.xml', async (req, res) => {
    try {
        const noticias = await Noticia.find({ estado: 'publicada' }).sort({ fecha: -1 }).lean();
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `  <url><loc>${BASE_URL}/</loc><priority>1.0</priority></url>\n`;
        noticias.forEach(n => {
            xml += `  <url><loc>${BASE_URL}${n.url || `/noticia/${n._id}`}</loc><lastmod>${n.fecha.toISOString().split('T')[0]}</lastmod><priority>0.8</priority></url>\n`;
        });
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (e) {
        res.status(500).send('Error generando sitemap');
    }
});

app.get('/rss', async (req, res) => {
    try {
        const noticias = await Noticia.find({ estado: 'publicada' }).sort({ fecha: -1 }).limit(30).lean();
        let rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>El Farol al Día</title>
  <link>${BASE_URL}</link>
  <description>Noticias de República Dominicana y el mundo</description>
  <language>es</language>`;
        noticias.forEach(n => {
            rss += `
  <item>
    <title>${n.titulo}</title>
    <link>${BASE_URL}${n.url || `/noticia/${n._id}`}</link>
    <description>${n.seoDesc || n.contenido.substring(0, 160)}</description>
    <pubDate>${n.fecha.toUTCString()}</pubDate>
  </item>`;
        });
        rss += '\n</channel>\n</rss>';
        res.header('Content-Type', 'application/rss+xml');
        res.send(rss);
    } catch (e) {
        res.status(500).send('Error generando RSS');
    }
});

// ==================== FALLBACK ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR Y AGENDA ====================
let agenda;

async function iniciarServidor() {
    await conectarMongoDB();

    agenda = new Agenda({ db: { address: MONGO_URL, collection: 'agendaJobs' } });

    agenda.define('publicar noticia programada', async (job) => {
        const { noticiaId } = job.attrs.data;
        const noticia = await Noticia.findByIdAndUpdate(
            noticiaId,
            { estado: 'publicada', fecha: new Date() },
            { new: true }
        );
        console.log(`✅ Noticia publicada: ${noticiaId}`);

        if (noticia) {
            await enviarNotificacion(noticia);
            await cache.del('noticias:portada');
            if (noticia.categoriaSlug) {
                await cache.del(`categoria:${noticia.categoriaSlug}`);
            }
        }
    });

    agenda.define('generar lote rd', async () => {
        const categorias = ['Nacionales', 'Política', 'Economía', 'Deportes', 'Tecnología', 'Salud'];
        for (const cat of categorias) {
            await generacionQueue.add('generar', { 
                categoria: cat, 
                fechaPublicacion: new Date(Date.now() + 5 * 60000) 
            });
        }
    });

    agenda.define('generar lote latam', async () => {
        const categorias = ['Internacionales', 'Economía', 'Deportes'];
        for (const cat of categorias) {
            await generacionQueue.add('generar', { 
                categoria: cat, 
                fechaPublicacion: new Date(Date.now() + 5 * 60000) 
            });
        }
    });

    agenda.define('generar lote usa', async () => {
        const categorias = ['Internacionales', 'Tecnología', 'Espectáculos'];
        for (const cat of categorias) {
            await generacionQueue.add('generar', { 
                categoria: cat, 
                fechaPublicacion: new Date(Date.now() + 5 * 60000) 
            });
        }
    });

    // ========== LIMPIEZA AUTOMÁTICA CADA 8 DÍAS ==========
    agenda.define('limpiar noticias antiguas', async () => {
        const dias = 8;  // 🔴 CAMBIADO DE 60 A 8 DÍAS
        const fechaLimite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
        let deleted = 0;
        do {
            const result = await Noticia.deleteMany({
                estado: 'publicada',
                fecha: { $lt: fechaLimite }
            }).limit(100);
            deleted = result.deletedCount;
            if (deleted > 0) console.log(`🧹 Eliminadas ${deleted} noticias antiguas (lote)`);
        } while (deleted === 100);
    });

    await agenda.start();
    console.log('📅 Agenda iniciada.');

    await agenda.every('0 5 * * *', 'generar lote rd');
    await agenda.every('0 14 * * *', 'generar lote latam');
    await agenda.every('0 20 * * *', 'generar lote usa');
    await agenda.every('0 3 * * *', 'limpiar noticias antiguas');

    const server = app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - BÚNKER PRO 6.2 🏮          ║
╠════════════════════════════════════════════════════╣
║ ✅ Servidor escuchando en puerto ${PORT}           ║
║ 🏮 Portada: ${BASE_URL}              ║
║ ✏️ Redacción: ${BASE_URL}/redaccion  ║
║ 🔍 SEO y Analytics: ACTIVADOS                      ║
║ 🤖 IA Generativa: ACTIVADA (Gemini 2.5 Flash)      ║
║ 📅 Publicaciones automáticas: ACTIVADAS            ║
║ 🧹 Limpieza automática: ACTIVADA (8 días)          ║
║ 📧 Notificaciones por correo: ACTIVADAS            ║
║ 🖼️ Imágenes automáticas: ACTIVADAS (Unsplash)      ║
║ ⚙️ Cola de trabajos: ACTIVADA (BullMQ + Redis)     ║
║ 🗃️ Caché Redis: ACTIVADO                            ║
║ 🟢 BÚNKER LISTO PARA OPERAR                        ║
╚════════════════════════════════════════════════════╝
        `);
    });

    process.on('SIGTERM', async () => {
        console.log('⏹️ Cerrando servidor...');
        if (agenda) await agenda.stop();
        await worker.close();
        await redisConnection.quit();
        server.close(() => {
            if (mongoose.connection.readyState === 1) mongoose.connection.close();
            process.exit(0);
        });
    });
}

iniciarServidor();

module.exports = app;
