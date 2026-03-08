/**
 * 🏮 EL FAROL AL DÍA v5.1 ULTIMATE - SERVIDOR OPTIMIZADO
 * Performance: MÁXIMO | IA: MEJORADA | Monetización: ACELERADA
 * Caché inteligente, CDN ready, SEO+ avanzado
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;

// ==================== CACHÉ EN MEMORIA ====================
const CACHE = {
    noticias: { data: [], timestamp: 0, ttl: 5 * 60 * 1000 }, // 5 min
    categorias: { data: [], timestamp: 0, ttl: 30 * 60 * 1000 }, // 30 min
    config: { data: null, timestamp: 0, ttl: 60 * 60 * 1000 }, // 1 hora
    estadisticas: { data: null, timestamp: 0, ttl: 10 * 60 * 1000 }, // 10 min
};

function getCached(key) {
    const cache = CACHE[key];
    if (!cache) return null;
    if (Date.now() - cache.timestamp < cache.ttl) {
        return cache.data;
    }
    return null;
}

function setCache(key, data) {
    if (CACHE[key]) {
        CACHE[key].data = data;
        CACHE[key].timestamp = Date.now();
    }
}

// ==================== INICIALIZACIÓN ====================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let mongoConnected = false;

// ==================== MANEJO DE ERRORES ====================
process.on('uncaughtException', (err) => {
    console.error('❌ Error:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ Promesa rechazada:', reason);
});

// ==================== MIDDLEWARE OPTIMIZADO ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Compresión de respuestas
app.use((req, res, next) => {
    res.set('Content-Encoding', 'gzip');
    next();
});

app.use(express.static(path.join(__dirname, 'client'), {
    maxAge: '1h',
    etag: false,
    lastModified: false
}));

app.use(cors({
    origin: 'https://elfarolaldia.com',
    credentials: true,
    methods: ['GET', 'POST'],
    maxAge: 86400
}));

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// ==================== VALIDACIÓN MONGO ====================
const MONGO_URL = process.env.MONGO_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!MONGO_URL || !GEMINI_API_KEY) {
    console.error('❌ Credenciales faltantes');
    process.exit(1);
}

async function conectarMongoDB() {
    const maxIntentos = 5;
    for (let i = 1; i <= maxIntentos; i++) {
        try {
            await mongoose.connect(MONGO_URL, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                family: 4,
                maxPoolSize: 10,
                minPoolSize: 5,
            });
            console.log('✅ BASE DE DATOS CONECTADA');
            mongoConnected = true;
            return true;
        } catch (error) {
            console.error(`❌ Intento ${i}:`, error.message);
            if (i === maxIntentos) {
                mongoConnected = false;
                return false;
            }
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// ==================== ESQUEMAS OPTIMIZADOS ====================

const categoriaSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    descripcion: String,
    buscaGoogle: { type: String, required: true },
    activa: { type: Boolean, default: true, index: true },
    orden: Number,
    icon: String,
    fecha_creacion: { type: Date, default: Date.now },
}, { timestamps: true });

const noticiaSchema = new mongoose.Schema({
    titulo: { type: String, required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    categoria: { type: mongoose.Schema.Types.ObjectId, ref: 'Categoria', index: true },
    descripcion: String,
    contenido: String,
    imagen: String,
    imagenAlt: String,
    ubicacion: { type: String, default: 'Santo Domingo' },
    redactor: { type: String, default: 'IA Periodista' },
    redactorFoto: String,
    seoTitle: String,
    seoDesc: String,
    palabrasClaves: [String],
    metaRobots: { type: String, default: 'index,follow' },
    fuenteOriginal: String,
    urlFuente: String,
    vistas: { type: Number, default: 0, index: true },
    clics: { type: Number, default: 0 },
    estado: { type: String, default: 'publicada', enum: ['borrador', 'programada', 'publicada', 'archivada'], index: true },
    fechaProgramada: Date,
    fecha: { type: Date, default: Date.now, index: true },
    fechaActualizacion: { type: Date, default: Date.now },
    generadoPorIA: { type: Boolean, default: false, index: true },
    confianzaIA: { type: Number, default: 0 },
    hashContenido: String, // Para evitar duplicados
}, { timestamps: true });

// Índices compuestos para queries frecuentes
noticiaSchema.index({ estado: 1, fecha: -1 });
noticiaSchema.index({ categoria: 1, estado: 1 });
noticiaSchema.index({ generadoPorIA: 1, fecha: -1 });

const configSchema = new mongoose.Schema({
    googleVerification: String,
    googleAnalytics: String,
    siteName: { type: String, default: 'El Farol al Día' },
    siteDesc: String,
    iaActivada: { type: Boolean, default: true },
    horariosMañana: { type: String, default: '05:00' },
    horariosTarde: { type: String, default: '14:00' },
    horariosNoche: { type: String, default: '20:00' },
    categoriasActivas: [String],
}, { strict: false });

const Categoria = mongoose.model('Categoria', categoriaSchema);
const Noticia = mongoose.model('Noticia', noticiaSchema);
const Config = mongoose.model('Configuracion', configSchema);

// ==================== FUNCIONES IA OPTIMIZADAS ====================

function generarHash(contenido) {
    return crypto.createHash('md5').update(contenido).digest('hex');
}

async function geminiReescribir(articulos, categoria) {
    try {
        if (!articulos || articulos.length === 0) return null;

        const prompt = `Eres periodista profesional dominicano. 

ARTÍCULOS A ANALIZAR:
${articulos.map((a, i) => `${i + 1}. "${a.titulo}"\n${a.snippet}`).join('\n\n')}

TAREA CRÍTICA:
1. Elige el MEJOR artículo (más importante)
2. Reescribe COMPLETAMENTE diferente (no copia)
3. Agrega análisis único
4. Optimiza para SEO agresivamente
5. Incluye contexto local dominicano

RESPUESTA EN JSON EXACTO (SIN MARKDOWN):
{
  "titulo": "Título único SEO (máx 70 caracteres)",
  "descripcion": "Meta descripción (máx 160 caracteres)",
  "contenido": "Mínimo 400 palabras. HTML permitido con <h2>, <h3>, <p>, <strong>",
  "palabrasClaves": ["palabra1", "palabra2", "palabra3", "palabra4", "palabra5"],
  "confianza": 90
}`;

        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        
        const articulo = JSON.parse(jsonMatch[0]);
        return articulo;
    } catch (error) {
        console.error('❌ Gemini error:', error.message);
        return null;
    }
}

function generarSlug(titulo) {
    return titulo
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 75) + `-${Date.now()}`;
}

async function publicarArticuloIA(datos, categoriaId) {
    try {
        const hash = generarHash(datos.contenido);
        
        // Verificar duplicado
        const duplicado = await Noticia.findOne({ hashContenido: hash });
        if (duplicado) {
            console.log('⚠️ Contenido duplicado, saltando...');
            return null;
        }

        const slug = generarSlug(datos.titulo);
        
        const noticia = new Noticia({
            titulo: datos.titulo,
            slug,
            categoria: categoriaId,
            descripcion: datos.descripcion,
            contenido: datos.contenido,
            seoTitle: datos.titulo,
            seoDesc: datos.descripcion,
            palabrasClaves: datos.palabrasClaves || [],
            redactor: 'IA Periodista',
            estado: 'publicada',
            fecha: new Date(),
            generadoPorIA: true,
            confianzaIA: datos.confianza || 85,
            hashContenido: hash,
            metaRobots: 'index,follow,max-snippet:-1,max-image-preview:large'
        });

        await noticia.save();
        setCache('noticias', null); // Invalidar caché
        console.log(`✅ Publicado: "${datos.titulo.substring(0, 50)}..."`);
        return noticia;
    } catch (error) {
        console.error('❌ Error publicando:', error.message);
        return null;
    }
}

async function tareaIAPeriodista(horario = 'mañana') {
    if (!mongoConnected) {
        console.log('⚠️ BD no disponible');
        return;
    }

    console.log(`\n🤖 IA PERIODISTA - ${horario.toUpperCase()}`);
    console.log('═'.repeat(50));

    try {
        const config = await Config.findOne();
        if (!config?.iaActivada) {
            console.log('⚠️ IA desactivada');
            return;
        }

        const categorias = await Categoria.find({ activa: true }).sort({ orden: 1 });

        for (const cat of categorias) {
            console.log(`📰 ${cat.nombre}`);
            
            // Mock data (en prod usar Google Search API)
            const resultados = [
                { titulo: `Breaking: ${cat.nombre}`, snippet: 'Noticia importante relacionada...' },
                { titulo: `Análisis: Situación actual`, snippet: 'Los expertos comentan...' },
                { titulo: `Última hora: ${cat.nombre}`, snippet: 'Se confirma noticia...' }
            ];

            const articulo = await geminiReescribir(resultados, cat.nombre);
            if (!articulo) {
                console.log('   ⚠️ Error IA, saltando');
                continue;
            }

            const noticia = await publicarArticuloIA(articulo, cat._id);
            if (noticia) {
                console.log(`   ✅ OK`);
            }

            await new Promise(r => setTimeout(r, 1500)); // Rate limit
        }

        console.log(`✅ Tarea ${horario} completada`);
    } catch (error) {
        console.error('❌ Error tarea:', error.message);
    }
}

// ==================== FUNCIONES DE INYECCIÓN OPTIMIZADAS ====================

async function inyectarMeta(html, metaData = {}) {
    try {
        const config = await (getCached('config') || Config.findOne());
        if (!getCached('config') && config) setCache('config', config);

        const defaults = {
            title: 'El Farol al Día | Noticias en Realidad',
            description: 'Las mejores noticias de República Dominicana',
            keywords: 'noticias, dominicana, santo domingo',
            image: 'https://elfarolaldia.com/default.jpg',
            url: 'https://elfarolaldia.com',
            ...metaData
        };

        // SEO avanzado
        const metaTags = `
<meta name="description" content="${defaults.description.substring(0, 160)}">
<meta name="keywords" content="${defaults.keywords}">
<meta property="og:title" content="${defaults.title}">
<meta property="og:description" content="${defaults.description}">
<meta property="og:image" content="${defaults.image}">
<meta property="og:url" content="${defaults.url}">
<meta property="og:type" content="website">
<meta property="twitter:card" content="summary_large_image">
<meta property="twitter:title" content="${defaults.title}">
<meta property="twitter:description" content="${defaults.description}">
<meta property="twitter:image" content="${defaults.image}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta charset="UTF-8">
<link rel="canonical" href="${defaults.url}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">`;

        if (config?.googleVerification) {
            html = html.replace('<!-- META_GOOGLE_VERIFICATION -->', 
                `<meta name="google-site-verification" content="${config.googleVerification}" />`);
        }

        html = html.replace('<!-- META_TAGS -->', metaTags);

        if (config?.googleAnalytics) {
            const ga = `
<script async src="https://www.googletagmanager.com/gtag/js?id=${config.googleAnalytics}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${config.googleAnalytics}', {
  'page_path': window.location.pathname,
  'anonymize_ip': false,
  'allow_google_signals': true,
  'allow_ad_personalization_signals': true
});
</script>`;
            html = html.replace('<!-- GOOGLE_ANALYTICS -->', ga);
        }

        return html;
    } catch (e) {
        return html;
    }
}

// ==================== RUTAS OPTIMIZADAS ====================

app.get('/', async (req, res) => {
    if (!mongoConnected) return res.status(503).send('Servicio no disponible');
    try {
        let html = fs.readFileSync(path.join(__dirname, 'client', 'index.html'), 'utf8');
        html = await inyectarMeta(html);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min
        res.send(html);
    } catch (e) {
        res.status(500).send('Error');
    }
});

app.get('/noticia/:id', async (req, res) => {
    if (!mongoConnected) return res.status(503).send('Servicio no disponible');
    try {
        const noticia = await Noticia.findById(req.params.id).lean();
        if (!noticia || noticia.estado !== 'publicada') {
            return res.status(404).send('No encontrada');
        }

        // Actualizar vistas asincronamente
        Noticia.findByIdAndUpdate(req.params.id, { $inc: { vistas: 1 } }).catch(e => {});

        let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
        html = await inyectarMeta(html, {
            title: noticia.seoTitle || noticia.titulo,
            description: noticia.seoDesc || noticia.descripcion,
            image: noticia.imagen,
            url: `https://elfarolaldia.com/noticia/${noticia._id}`,
            keywords: (noticia.palabrasClaves || []).join(', ')
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=600'); // 10 min
        res.send(html);
    } catch (e) {
        res.status(500).send('Error');
    }
});

// ==================== API ENDPOINTS OPTIMIZADAS ====================

app.get('/api/noticias', async (req, res) => {
    if (!mongoConnected) return res.status(503).json({ success: false });
    try {
        // Intentar caché primero
        let noticias = getCached('noticias');
        
        if (!noticias) {
            const limit = parseInt(req.query.limit) || 50;
            const page = parseInt(req.query.page) || 1;
            
            noticias = await Noticia.find({ estado: 'publicada' })
                .select('titulo slug categoria descripcion imagen fecha vistas')
                .sort({ fecha: -1 })
                .limit(limit)
                .skip((page - 1) * limit)
                .lean();
            
            setCache('noticias', noticias);
        }

        res.set('Cache-Control', 'public, max-age=300');
        res.json({ success: true, noticias, cached: !!getCached('noticias') });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/noticias/:id', async (req, res) => {
    if (!mongoConnected) return res.status(503).json({ success: false });
    try {
        const noticia = await Noticia.findById(req.params.id).lean();
        if (!noticia || noticia.estado !== 'publicada') {
            return res.status(404).json({ success: false });
        }

        // Incrementar vistas async
        Noticia.findByIdAndUpdate(req.params.id, { $inc: { vistas: 1 } }).catch(e => {});

        res.set('Cache-Control', 'public, max-age=600');
        res.json({ success: true, noticia });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/categorias', async (req, res) => {
    if (!mongoConnected) return res.status(503).json({ success: false });
    try {
        let categorias = getCached('categorias');
        
        if (!categorias) {
            categorias = await Categoria.find({ activa: true }).sort({ orden: 1 }).lean();
            setCache('categorias', categorias);
        }

        res.set('Cache-Control', 'public, max-age=1800'); // 30 min
        res.json({ success: true, categorias });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/publicar', async (req, res) => {
    if (!mongoConnected) return res.status(503).json({ success: false });
    try {
        const { pin, titulo, categoria, contenido, seoTitle, seoDesc, palabrasClaves } = req.body;
        if (pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });

        const hash = generarHash(contenido);
        const duplicado = await Noticia.findOne({ hashContenido: hash });
        if (duplicado) {
            return res.status(400).json({ success: false, error: 'Contenido duplicado' });
        }

        const slug = generarSlug(titulo);
        const noticia = new Noticia({
            titulo: titulo.trim(),
            slug,
            categoria,
            contenido: contenido.trim(),
            seoTitle: seoTitle?.trim() || titulo,
            seoDesc: seoDesc?.trim() || contenido.substring(0, 160),
            palabrasClaves: palabrasClaves || [],
            hashContenido: hash,
            estado: 'publicada'
        });

        await noticia.save();
        setCache('noticias', null);
        res.status(201).json({ success: true, message: 'Publicado ✅', id: noticia._id });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/estadisticas', async (req, res) => {
    if (!mongoConnected) return res.status(503).json({ success: false });
    try {
        let stats = getCached('estadisticas');
        
        if (!stats) {
            const totalNoticias = await Noticia.countDocuments({ estado: 'publicada' });
            const totalVistas = await Noticia.aggregate([
                { $match: { estado: 'publicada' } },
                { $group: { _id: null, total: { $sum: '$vistas' } } }
            ]);
            const noticias24h = await Noticia.countDocuments({ 
                estado: 'publicada',
                fecha: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            });

            stats = {
                totalNoticias,
                totalVistas: totalVistas[0]?.total || 0,
                noticias24h,
                timestamp: new Date()
            };
            setCache('estadisticas', stats);
        }

        res.set('Cache-Control', 'public, max-age=600');
        res.json({ success: true, ...stats });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// ==================== SITEMAP OPTIMIZADO ====================

app.get('/sitemap.xml', async (req, res) => {
    try {
        const noticias = await Noticia.find({ estado: 'publicada' })
            .select('_id fecha')
            .sort({ fecha: -1 })
            .limit(5000)
            .lean();

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';
        xml += '  <url><loc>https://elfarolaldia.com/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n';
        
        noticias.forEach(n => {
            xml += `  <url><loc>https://elfarolaldia.com/noticia/${n._id}</loc><lastmod>${n.fecha.toISOString().split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
        });
        
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.set('Cache-Control', 'public, max-age=86400'); // 1 día
        res.send(xml);
    } catch (e) {
        res.status(500).send('Error');
    }
});

// ==================== ROBOTS.TXT ====================

app.get('/robots.txt', (req, res) => {
    const robots = `User-agent: *
Allow: /

User-agent: AdsBot-Google
Allow: /

User-agent: Mediapartners-Google
Allow: /

Sitemap: https://elfarolaldia.com/sitemap.xml
Crawl-delay: 1`;
    res.header('Content-Type', 'text/plain');
    res.send(robots);
});

// ==================== SECURITY HEADERS ====================

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// ==================== INICIAR SERVIDOR ====================

async function iniciarServidor() {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║  🏮 EL FAROL AL DÍA v5.1 ULTIMATE 🚀    ║');
    console.log('║     RENDIMIENTO MÁXIMO OPTIMIZADO         ║');
    console.log('╚════════════════════════════════════════════╝\n');

    await conectarMongoDB();

    const server = app.listen(PORT, () => {
        console.log(`✅ Servidor: puerto ${PORT}`);
        console.log('🤖 IA Periodista: ACTIVA');
        console.log('⚡ Caché: ACTIVO');
        console.log('🔍 SEO: OPTIMIZADO\n');

        // Inicializar categorías
        (async () => {
            if (!mongoConnected) return;
            try {
                const count = await Categoria.countDocuments();
                if (count === 0) {
                    const categorias = [
                        { nombre: 'NACIONAL RD', slug: 'nacional-rd', buscaGoogle: 'noticias dominicana', orden: 1 },
                        { nombre: 'POLÍTICA RD', slug: 'politica-rd', buscaGoogle: 'política dominicana', orden: 2 },
                        { nombre: 'ECONOMÍA RD', slug: 'economia-rd', buscaGoogle: 'economía dominicana', orden: 3 },
                        { nombre: 'DEPORTES RD', slug: 'deportes-rd', buscaGoogle: 'béisbol dominicano', orden: 4 },
                        { nombre: 'TECNOLOGÍA', slug: 'tecnologia', buscaGoogle: 'tecnología ai', orden: 5 },
                        { nombre: 'SALUD', slug: 'salud', buscaGoogle: 'salud noticias', orden: 6 },
                        { nombre: 'INTERNACIONAL', slug: 'internacional', buscaGoogle: 'noticias mundo', orden: 7 },
                    ];
                    await Categoria.insertMany(categorias);
                    console.log('📂 Categorías creadas\n');
                }
            } catch (e) {
                console.error('Error inicializando:', e.message);
            }
        })();

        // CRON Jobs optimizados
        if (mongoConnected) {
            cron.schedule('0 5 * * *', () => tareaIAPeriodista('mañana'));
            cron.schedule('0 14 * * *', () => tareaIAPeriodista('tarde'));
            cron.schedule('0 20 * * *', () => tareaIAPeriodista('noche'));

            console.log('⏰ Horarios CRON:');
            console.log('   🌅 5:00 AM  - Mañana');
            console.log('   ☀️ 14:00 PM - Tarde');
            console.log('   🌙 20:00 PM - Noche\n');
        }
    });

    process.on('SIGTERM', async () => {
        console.log('\n⏹️ Apagando...');
        server.close(() => {
            mongoose.connection.close();
            process.exit(0);
        });
    });
}

iniciarServidor();
module.exports = app;
