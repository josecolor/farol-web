/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V2.2 (ANTI-CRASH)
 * Conexión segura a MongoDB + Inyección de meta tags + Rutas API
 * NO se cae aunque MongoDB falle
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// Health check para Railway
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// ==================== VALIDACIÓN DE MONGO_URL ====================
const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL) {
    console.error('\n❌ ERROR CRÍTICO: Variable MONGO_URL no está definida');
    console.error('📌 En Railway: Variables → Agregar MONGO_URL');
    console.error('   Valor: mongodb://mongo:PASSWORD@mongodb.railway.internal:27017\n');
    process.exit(1);
}

console.log('📡 MONGO_URL encontrada. Conectando...');

// ==================== CONEXIÓN A MONGODB (NO BLOQUEANTE) ====================
let mongoConnected = false;

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
                family: 4, // Fuerza IPv4
            });
            
            mongoConnected = true;
            console.log('✅ 🟢 ¡BÚNKER CONECTADO A MONGODB!');
            return true;
            
        } catch (error) {
            console.error(`❌ Intento ${i} falló:`, error.message);
            
            if (i === maxIntentos) {
                console.error('\n⏳ No se pudo conectar después de 5 intentos');
                console.error('⏰ Reintentando en 30 segundos...\n');
                
                // NO hacer process.exit() - permitir que el servidor siga corriendo
                // Reintentar conexión en 30 segundos
                setTimeout(() => {
                    console.log('🔄 Reintentando conexión a MongoDB...');
                    conectarMongoDB();
                }, 30000);
                
                return false;
            }
            
            // Esperar 5 segundos antes del siguiente intento
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Iniciar conexión pero NO esperar (no bloqueante)
conectarMongoDB();

// ==================== ESQUEMAS Y MODELOS ====================

// Modelo de Configuración
const configSchema = new mongoose.Schema({
    googleVerification: { type: String, default: '' },
    nombreSitio: { type: String, default: 'El Farol al Día' },
    tagline: { type: String, default: 'Diario Digital de Noticias en Vivo' },
    colorPrincipal: { type: String, default: '#FF8C00' },
    emailContacto: String,
    ubicacionSitio: String,
    descripcionSitio: String,
    facebook: String,
    instagram: String,
    twitter: String,
    whatsapp: String,
    telegram: String,
    whatsappCanal: String,
    amazonId: String,
    googleAdsense: String,
    stripeId: String,
    linkDonacion: String,
    googleAnalytics: String,
    mostrarVistas: { type: Boolean, default: true },
    metaKeywords: String,
    robotsTxt: String,
    activarOpenGraph: { type: Boolean, default: true },
}, { strict: false });

const Config = mongoose.model('Configuracion', configSchema);

// Modelo de Noticias
const noticiaSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    seccion: { type: String, required: true },
    contenido: { type: String, required: true },
    ubicacion: { type: String, default: 'Santo Domingo' },
    redactor: { type: String, default: 'mxl' },
    redactorFoto: { type: String, default: null },
    imagen: { type: String, default: null },
    vistas: { type: Number, default: 0 },
    fecha: { type: Date, default: Date.now }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);

// ==================== FUNCIÓN PARA INYECTAR META TAGS ====================
async function inyectarMeta(html) {
    try {
        if (!mongoConnected) {
            console.warn('⚠️ MongoDB no conectado, meta tag no inyectado');
            return html.replace('<!-- META_GOOGLE_VERIFICATION -->', '');
        }

        const config = await Config.findOne().lean();
        
        if (config?.googleVerification) {
            const meta = `<meta name="google-site-verification" content="${config.googleVerification}" />`;
            return html.replace('<!-- META_GOOGLE_VERIFICATION -->', meta);
        }
    } catch (e) {
        console.error('⚠️ Error inyectando meta:', e.message);
    }
    
    return html.replace('<!-- META_GOOGLE_VERIFICATION -->', '');
}

// ==================== RUTAS GET - PÁGINAS HTML ====================

app.get('/', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'client', 'index.html');
        let html = fs.readFileSync(filePath, 'utf8');
        html = await inyectarMeta(html);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        console.error('Error en GET /:', e.message);
        res.status(500).send('Error interno');
    }
});

app.get('/noticia/:id', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'client', 'noticia.html');
        let html = fs.readFileSync(filePath, 'utf8');
        html = await inyectarMeta(html);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        console.error('Error en GET /noticia/:id:', e.message);
        res.status(500).send('Error interno');
    }
});

app.get('/redaccion', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
    } catch (e) {
        res.status(500).send('Error interno');
    }
});

app.get('/ajustes', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, 'client', 'ajustes.html'));
    } catch (e) {
        res.status(500).send('Error interno');
    }
});

// ==================== RUTAS API ====================

// GET /api/configuracion
app.get('/api/configuracion', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, error: 'MongoDB no disponible' });
        }

        let config = await Config.findOne();
        if (!config) {
            config = await Config.create({});
        }
        
        res.json({ success: true, config: config.toObject() });
    } catch (error) {
        console.error('Error GET /api/configuracion:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener configuración' });
    }
});

// POST /api/configuracion
app.post('/api/configuracion', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, error: 'MongoDB no disponible' });
        }

        const { pin, ...config } = req.body;
        
        if (pin !== '311') {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }
        
        let configActual = await Config.findOne();
        
        if (configActual) {
            Object.assign(configActual, config);
            await configActual.save();
        } else {
            configActual = await Config.create(config);
        }
        
        console.log('✅ Configuración guardada');
        res.json({ success: true, message: 'Configuración guardada', config: configActual.toObject() });
        
    } catch (error) {
        console.error('Error POST /api/configuracion:', error.message);
        res.status(500).json({ success: false, error: 'Error al guardar configuración' });
    }
});

// GET /api/estadisticas
app.get('/api/estadisticas', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, error: 'MongoDB no disponible' });
        }

        const totalNoticias = await Noticia.countDocuments();
        const totalVistas = await Noticia.aggregate([
            { $group: { _id: null, total: { $sum: '$vistas' } } }
        ]);
        
        res.json({
            success: true,
            totalNoticias,
            totalVistas: totalVistas[0]?.total || 0
        });
    } catch (error) {
        console.error('Error GET /api/estadisticas:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener estadísticas' });
    }
});

// GET /api/noticias
app.get('/api/noticias', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, error: 'MongoDB no disponible' });
        }

        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const skip = parseInt(req.query.skip) || 0;

        const noticias = await Noticia.find()
            .sort({ fecha: -1 })
            .limit(limit)
            .skip(skip)
            .lean();

        const total = await Noticia.countDocuments();

        res.json({ success: true, total, cantidad: noticias.length, noticias });
    } catch (error) {
        console.error('Error GET /api/noticias:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener noticias' });
    }
});

// GET /api/noticias/:id
app.get('/api/noticias/:id', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, error: 'MongoDB no disponible' });
        }

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }

        const noticia = await Noticia.findById(id);

        if (!noticia) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }

        noticia.vistas = (noticia.vistas || 0) + 1;
        await noticia.save();

        res.json({ success: true, noticia });
    } catch (error) {
        console.error('Error GET /api/noticias/:id:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener noticia' });
    }
});

// GET /api/seccion/:nombre
app.get('/api/seccion/:nombre', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, error: 'MongoDB no disponible' });
        }

        const nombre = req.params.nombre;
        const noticias = await Noticia.find({ seccion: nombre })
            .sort({ fecha: -1 })
            .limit(100)
            .lean();

        res.json({ success: true, seccion: nombre, total: noticias.length, noticias });
    } catch (error) {
        console.error('Error GET /api/seccion/:nombre:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener noticias' });
    }
});

// POST /api/publicar
app.post('/api/publicar', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, error: 'MongoDB no disponible' });
        }

        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;

        if (pin !== '311') {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }

        if (!titulo || !seccion || !contenido) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
        }

        const noticia = new Noticia({
            titulo: titulo.trim(),
            seccion,
            contenido: contenido.trim(),
            ubicacion: ubicacion ? ubicacion.trim() : 'Santo Domingo',
            redactor: redactor ? redactor.trim() : 'mxl',
            redactorFoto: redactorFoto || null,
            imagen: imagen || null
        });

        await noticia.save();

        console.log('📰 Nueva noticia:', noticia.titulo);

        res.status(201).json({
            success: true,
            message: 'Publicado 🏮',
            noticia: {
                id: noticia._id,
                titulo: noticia.titulo,
                seccion: noticia.seccion,
                fecha: noticia.fecha
            }
        });

    } catch (error) {
        console.error('Error POST /api/publicar:', error.message);
        res.status(500).json({ success: false, error: 'Error al publicar' });
    }
});

// PUT /api/noticias/:id
app.put('/api/noticias/:id', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, error: 'MongoDB no disponible' });
        }

        const { id } = req.params;
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;

        if (pin !== '311') {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }

        if (!titulo || !seccion || !contenido) {
            return res.status(400).json({ success: false, error: 'Faltan campos' });
        }

        const noticia = await Noticia.findByIdAndUpdate(
            id,
            {
                titulo: titulo.trim(),
                seccion,
                contenido: contenido.trim(),
                ubicacion: ubicacion ? ubicacion.trim() : 'Santo Domingo',
                redactor: redactor ? redactor.trim() : 'mxl',
                redactorFoto: redactorFoto || null,
                imagen: imagen || null,
                fechaActualizacion: new Date()
            },
            { new: true }
        );

        if (!noticia) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }

        console.log('✏️ Noticia actualizada:', noticia.titulo);

        res.json({
            success: true,
            message: 'Noticia actualizada ✏️',
            noticia
        });

    } catch (error) {
        console.error('Error PUT /api/noticias/:id:', error.message);
        res.status(500).json({ success: false, error: 'Error al actualizar' });
    }
});

// DELETE /api/noticias/:id
app.delete('/api/noticias/:id', async (req, res) => {
    try {
        if (!mongoConnected) {
            return res.status(503).json({ success: false, error: 'MongoDB no disponible' });
        }

        const { id } = req.params;
        const { pin } = req.body;

        if (pin !== '311') {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }

        const noticia = await Noticia.findByIdAndDelete(id);

        if (!noticia) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }

        console.log('🗑️ Noticia eliminada:', noticia.titulo);

        res.json({
            success: true,
            message: 'Noticia eliminada 🗑️',
            id: noticia._id
        });

    } catch (error) {
        console.error('Error DELETE /api/noticias/:id:', error.message);
        res.status(500).json({ success: false, error: 'Error al eliminar' });
    }
});

// ==================== RUTA 404 PARA API ====================
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: 'API endpoint no encontrado' });
});

// ==================== FALLBACK PARA CUALQUIER OTRA RUTA ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR ====================

const server = app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - BÚNKER PRO 2.2 🏮          ║
╠════════════════════════════════════════════════════╣
║ ✅ Servidor escuchando en puerto ${PORT}           ║
║ 🏮 Portada: https://elfarolaldia.com              ║
║ 📄 Noticia: https://elfarolaldia.com/noticia/:id  ║
║ ✏️ Redacción: https://elfarolaldia.com/redaccion  ║
║ 🎛️ Ajustes: https://elfarolaldia.com/ajustes     ║
║ 🎬 Videos: ACTIVADOS                              ║
║ 📊 Analítica: ACTIVADA                             ║
║ 📱 Meta Tags: INYECTABLES                          ║
║ 🟢 BÚNKER LISTO PARA OPERAR                        ║
╚════════════════════════════════════════════════════╝
    `);
});

// Cierre graceful
process.on('SIGTERM', () => {
    console.log('⏹️ Cerrando servidor gracefulmente...');
    server.close(() => {
        console.log('🔌 Servidor cerrado');
        if (mongoose.connection.readyState === 1) {
            mongoose.connection.close();
            console.log('📊 MongoDB cerrado');
        }
        process.exit(0);
    });
});

module.exports = app;
