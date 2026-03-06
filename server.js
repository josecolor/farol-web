/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR DEFINITIVO V2.1
 * Conexión segura a MongoDB + Inyección de meta tags + Rutas API unificadas
 * Listo para producción en Railway
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
    console.error('\n❌ ERROR CRÍTICO: Variable MONGO_URL no está definida en Railway.');
    console.error('👉 Ve a la pestaña Variables de tu proyecto y créala con el valor de conexión.');
    process.exit(1);
}

console.log('📡 MONGO_URL encontrada. Conectando...');

// ==================== CONEXIÓN A MONGODB (BLOQUEANTE) ====================
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
                family: 4, // Fuerza IPv4 para evitar ECONNREFUSED
            });
            
            console.log('✅ 🟢 ¡BÚNKER CONECTADO A MONGODB!');
            return true;
            
        } catch (error) {
            console.error(`❌ Intento ${i} falló:`, error.message);
            
            if (i === maxIntentos) {
                console.error('\n🛑 No se pudo conectar después de 5 intentos. Saliendo...');
                process.exit(1);
            }
            
            // Esperar 5 segundos antes del siguiente intento
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// ==================== ESQUEMAS Y MODELOS ====================

// Modelo de Configuración (con campos comunes y flexible)
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
}, { strict: false }); // Permite campos adicionales sin definir

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
        const config = await Config.findOne().lean();
        
        if (config?.googleVerification) {
            const meta = `<meta name="google-site-verification" content="${config.googleVerification}" />`;
            console.log('🔍 Meta tag inyectado');
            return html.replace('<!-- META_GOOGLE_VERIFICATION -->', meta);
        }
    } catch (e) {
        console.error('⚠️ Error inyectando meta (no crítico):', e.message);
    }
    
    // Si no hay verificación o error, simplemente eliminar el marcador
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

// ==================== RUTAS API (unificadas bajo /api) ====================

// GET /api/configuracion - Obtener configuración
app.get('/api/configuracion', async (req, res) => {
    try {
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

// POST /api/configuracion - Guardar configuración (requiere PIN 311)
app.post('/api/configuracion', async (req, res) => {
    try {
        const { pin, ...config } = req.body;
        
        // Validar PIN
        if (pin !== '311') {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }
        
        // Buscar y actualizar o crear
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

// GET /api/estadisticas - Obtener estadísticas básicas
app.get('/api/estadisticas', async (req, res) => {
    try {
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

// GET /api/noticias - Obtener todas las noticias (para portada)
app.get('/api/noticias', async (req, res) => {
    try {
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

// GET /api/noticias/:id - Obtener noticia individual (JSON, incrementa vistas)
app.get('/api/noticias/:id', async (req, res) => {
    try {
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

// GET /api/seccion/:nombre - Obtener noticias por sección
app.get('/api/seccion/:nombre', async (req, res) => {
    try {
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

// POST /api/publicar - Publicar nueva noticia
app.post('/api/publicar', async (req, res) => {
    try {
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

// PUT /api/noticias/:id - Actualizar noticia
app.put('/api/noticias/:id', async (req, res) => {
    try {
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

// DELETE /api/noticias/:id - Eliminar noticia
app.delete('/api/noticias/:id', async (req, res) => {
    try {
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
// Si no es /api, redirigir a la portada (para SPA)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR ====================

async function iniciarServidor() {
    // Conectar a MongoDB (esto es bloqueante, si falla sale del proceso)
    await conectarMongoDB();
    
    // Iniciar servidor SOLO después de conectar
    const server = app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - BÚNKER PRO 2.1 🏮          ║
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
}

// Punto de entrada: inicia todo
iniciarServidor();

module.exports = app;
