/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR DEFINITIVO V5.1
 * Con IA generativa (Gemini), caché, rate limiting, trabajos automáticos
 * y LIMPIEZA AUTOMÁTICA DE NOTICIAS ANTIGUAS (para no llenar el disco)
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Agenda = require('agenda');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8080;

// ==================== TRUST PROXY (elimina advertencia de Railway) ====================
app.set('trust proxy', true);

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

// ==================== RATE LIMITING (protección) ====================
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 peticiones por IP cada 15 minutos
    message: { error: 'Demasiadas peticiones, intenta más tarde' }
});
app.use('/api/', apiLimiter);

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => res.status(200).send('OK'));

// ==================== VALIDACIÓN DE VARIABLES DE ENTORNO ====================
const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
    console.error('\n❌ ERROR CRÍTICO: Variable MONGO_URL no está definida en Railway.');
    process.exit(1);
}
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error('\n❌ ERROR: Variable GEMINI_API_KEY no está definida.');
    process.exit(1);
}
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
if (!INTERNAL_SECRET) {
    console.error('\n❌ ERROR: Variable INTERNAL_SECRET no está definida.');
    process.exit(1);
}
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';
console.log('📡 Variables de entorno validadas.');

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
    // Campos para programación
    fechaProgramada: { type: Date, default: null },
    estado: { type: String, default: 'publicada', enum: ['programada', 'publicada'] },
    // Campos SEO
    seoTitle: { type: String, default: '' },
    seoDesc: { type: String, default: '' },
    seoKeywords: { type: String, default: '' },
    // Nuevos campos para SEO y URLs amigables
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

// ==================== ÍNDICES PARA RENDIMIENTO ====================
Noticia.collection.createIndex({ categoriaSlug: 1, fecha: -1 });
Noticia.collection.createIndex({ estado: 1, fecha: -1 });
Noticia.collection.createIndex({ url: 1 }, { unique: true, sparse: true });

// ==================== CACHE SIMPLE EN MEMORIA ====================
const cache = {
    noticias: null,
    timestamp: 0,
    duracion: 5 * 60 * 1000 // 5 minutos
};

// ==================== MAPA DE CATEGORÍAS PARA SLUGS ====================
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

// ==================== FUNCIÓN PARA GENERAR SLUG ====================
function generarSlug(texto) {
    return texto
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ==================== FUNCIONES DE INYECCIÓN META ====================
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
        const ogUrl = `${BASE_URL}${noticia.url || `/noticia/${noticia._id}`}`;

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
        console.error('Error en GET /noticia/:slug:', e.message);
        res.status(500).send('Error interno');
    }
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// ==================== RUTAS API ====================

// Últimas noticias (con caché)
app.get('/api/noticias', async (req, res) => {
    try {
        if (cache.noticias && cache.timestamp > Date.now() - cache.duracion) {
            return res.json(cache.noticias);
        }
        const noticias = await Noticia.find({ estado: 'publicada' })
            .sort({ fecha: -1 })
            .limit(30)
            .lean();
        const response = { success: true, noticias };
        cache.noticias = response;
        cache.timestamp = Date.now();
        res.json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Noticia por ID (para compatibilidad con frontend actual)
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

// Noticias por categoría (slug)
app.get('/api/categoria/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const categoriaMap = Object.fromEntries(
            Object.entries(categoriaSlugMap).map(([k, v]) => [v, k])
        );
        const categoriaReal = categoriaMap[slug];
        if (!categoriaReal) {
            return res.status(404).json({ success: false, error: 'Categoría no encontrada' });
        }
        const noticias = await Noticia.find({ seccion: categoriaReal, estado: 'publicada' })
            .sort({ fecha: -1 })
            .limit(30)
            .lean();
        res.json({ success: true, categoria: slug, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Publicar noticia manual (desde redacción)
app.post('/api/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen, seoTitle, seoDesc, seoKeywords, fechaProgramada } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        if (!titulo || !seccion || !contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });

        const slug = generarSlug(titulo);
        const categoriaSlug = categoriaSlugMap[seccion] || 'general';
        const url = `/noticia/${slug}`;

        const existe = await Noticia.findOne({ url });
        if (existe) {
            return res.status(400).json({ success: false, error: 'Ya existe una noticia con título similar' });
        }

        let estado = 'publicada';
        let fecha = new Date();

        if (fechaProgramada) {
            estado = 'programada';
            fecha = null;
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
            if (!agenda) {
                console.error('Agenda no inicializada');
                return res.status(500).json({ success: false, error: 'Error interno' });
            }
            await agenda.schedule(new Date(fechaProgramada), 'publicar noticia programada', { noticiaId: noticia._id });
            console.log(`📅 Noticia programada para: ${new Date(fechaProgramada).toLocaleString()}`);
            res.status(201).json({ success: true, message: 'Noticia programada con éxito 🗓️', id: noticia._id });
        } else {
            console.log('📰 Nueva noticia:', noticia.titulo);
            res.status(201).json({ success: true, message: 'Publicado 🏮', id: noticia._id });
        }
    } catch (error) {
        console.error('Error POST /api/publicar:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint de generación con IA (solo para llamadas internas)
app.post('/api/generar-noticia', async (req, res) => {
    if (req.headers['x-internal-key'] !== INTERNAL_SECRET) {
        return res.status(403).json({ error: 'No autorizado' });
    }

    try {
        const { categoria } = req.body;
        if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

        const categoriaSlug = categoriaSlugMap[categoria] || 'general';

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
  "keywords": ["array", "de", "palabras", "clave"]
}

Tema: ${tema}
Estilo: neutral, objetivo, con lenguaje de República Dominicana.
        `;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
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
        if (existe) {
            return res.json({ message: 'Noticia duplicada, ignorada' });
        }

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
            estado: 'programada',
            fechaProgramada: new Date(Date.now() + 5 * 60000),
            readingTime: Math.ceil(noticiaGenerada.contenido.split(' ').length / 200)
        });

        await nuevaNoticia.save();

        if (agenda) {
            await agenda.schedule(new Date(Date.now() + 5 * 60000), 'publicar noticia programada', { noticiaId: nuevaNoticia._id });
        } else {
            console.error('Agenda no disponible');
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

// Endpoint de estado del servidor
app.get('/status', (req, res) => {
    res.json({
        uptime: process.uptime(),
        memoria: process.memoryUsage(),
        cpu: process.cpuUsage()
    });
});

// Configuración
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

// Estadísticas
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

// Sitemap
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

// RSS
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

    // Inicializar Agenda
    agenda = new Agenda({ db: { address: MONGO_URL, collection: 'agendaJobs' } });

    // --- TRABAJO DE PUBLICACIÓN ---
    agenda.define('publicar noticia programada', async (job) => {
        const { noticiaId } = job.attrs.data;
        await Noticia.findByIdAndUpdate(noticiaId, { estado: 'publicada', fecha: new Date() });
        console.log(`✅ Noticia publicada: ${noticiaId}`);
    });

    // --- TRABAJOS DE GENERACIÓN POR LOTES (IA) ---
    agenda.define('generar lote rd', async () => {
        const categorias = ['Nacionales', 'Política', 'Economía', 'Deportes', 'Tecnología', 'Salud'];
        for (const cat of categorias) {
            try {
                await fetch(`${BASE_URL}/api/generar-noticia`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-internal-key': INTERNAL_SECRET
                    },
                    body: JSON.stringify({ categoria: cat })
                });
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (err) {
                console.error(`Error generando noticia de ${cat}:`, err.message);
            }
        }
    });

    agenda.define('generar lote latam', async () => {
        const categorias = ['Internacionales', 'Economía', 'Deportes'];
        for (const cat of categorias) {
            try {
                await fetch(`${BASE_URL}/api/generar-noticia`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-internal-key': INTERNAL_SECRET
                    },
                    body: JSON.stringify({ categoria: cat })
                });
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (err) {
                console.error(`Error generando noticia de ${cat}:`, err.message);
            }
        }
    });

    agenda.define('generar lote usa', async () => {
        const categorias = ['Internacionales', 'Tecnología', 'Espectáculos'];
        for (const cat of categorias) {
            try {
                await fetch(`${BASE_URL}/api/generar-noticia`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-internal-key': INTERNAL_SECRET
                    },
                    body: JSON.stringify({ categoria: cat })
                });
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (err) {
                console.error(`Error generando noticia de ${cat}:`, err.message);
            }
        }
    });

    // --- NUEVO: TRABAJO DE LIMPIEZA AUTOMÁTICA DE NOTICIAS ANTIGUAS ---
    agenda.define('limpiar noticias antiguas', async () => {
        const dias = 30; // Noticias con más de 30 días
        const fechaLimite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
        const resultado = await Noticia.deleteMany({
            estado: 'publicada',
            fecha: { $lt: fechaLimite }
        });
        console.log(`🧹 Limpieza automática: ${resultado.deletedCount} noticias antiguas eliminadas (más de ${dias} días).`);
    });

    await agenda.start();
    console.log('📅 Agenda iniciada.');

    // Programar horarios de generación
    await agenda.every('0 5 * * *', 'generar lote rd');   // 5 AM
    await agenda.every('0 14 * * *', 'generar lote latam'); // 2 PM
    await agenda.every('0 20 * * *', 'generar lote usa');   // 8 PM

    // Programar limpieza diaria a las 3 AM
    await agenda.every('0 3 * * *', 'limpiar noticias antiguas');

    const server = app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - BÚNKER PRO 5.1 🏮          ║
╠════════════════════════════════════════════════════╣
║ ✅ Servidor escuchando en puerto ${PORT}           ║
║ 🏮 Portada: ${BASE_URL}              ║
║ ✏️ Redacción: ${BASE_URL}/redaccion  ║
║ 🔍 SEO y Analytics: ACTIVADOS                      ║
║ 🤖 IA Generativa: ACTIVADA (Gemini)                ║
║ 📅 Publicaciones automáticas: ACTIVADAS            ║
║ 🧹 Limpieza automática: ACTIVADA (c/ 3 AM)         ║
║ 🟢 BÚNKER LISTO PARA OPERAR                        ║
╚════════════════════════════════════════════════════╝
        `);
    });

    process.on('SIGTERM', async () => {
        console.log('⏹️ Cerrando servidor gracefulmente...');
        if (agenda) await agenda.stop();
        server.close(() => {
            if (mongoose.connection.readyState === 1) mongoose.connection.close();
            process.exit(0);
        });
    });
}

iniciarServidor();

module.exports = app;
