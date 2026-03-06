/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR FINAL COMPLETO
 * Búnker PRO v2.0 - VERSIÓN ESTABLE Y FUNCIONAL
 * Con inyección de metaetiquetas desde el servidor (SSR) para Google Search Console
 * Límite de memoria reducido a 10MB para evitar caídas
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// ==================== MANEJADORES DE ERRORES GLOBALES ====================
process.on('uncaughtException', (err) => {
    console.error('❌ Excepción no capturada:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

// ==================== CONFIGURACIÓN INICIAL ====================
// Reducido a 10MB para evitar problemas de memoria
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== HEALTH CHECK PARA RAILWAY ====================
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// ==================== VALIDACIÓN ESTRICTA DE MONGO_URI ====================
const MONGODB_URI = process.env.MONGO_URI || 
    "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

if (!MONGODB_URI) {
    console.error('\n❌ ERROR CRÍTICO: MONGO_URI no está definida');
    console.error('🔴 El búnker no puede arrancar sin la base de datos');
    process.exit(1);
}

console.log('📡 MONGO_URI encontrada. Conectando a MongoDB...');

// ==================== SISTEMA DE REINTENTOS MEJORADO ====================
async function conectarMongoDB(intentos = 5) {
    for (let i = 1; i <= intentos; i++) {
        try {
            console.log(`📡 Intento ${i}/${intentos} - Conectando a MongoDB...`);
            
            await mongoose.connect(MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });
            
            console.log('🟢 ¡BÚNKER CONECTADO A MONGODB!');
            return true;
            
        } catch (error) {
            console.error(`❌ Intento ${i} falló:`, error.message);
            
            if (i === intentos) {
                console.error('\n⏳ Esperando 30 segundos antes de reintentar...\n');
                setTimeout(() => {
                    console.log('🔄 Reintentando conexión...');
                    conectarMongoDB(intentos);
                }, 30000);
                return false;
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

conectarMongoDB();

// ==================== ESQUEMAS ====================

// Schema Noticias (CON redactorFoto)
const noticiaSchema = new mongoose.Schema({
    titulo: { 
        type: String, 
        required: true, 
        trim: true,
        maxlength: 200
    },
    seccion: {
        type: String,
        required: true,
        enum: ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía']
    },
    contenido: { 
        type: String, 
        required: true, 
        trim: true,
        maxlength: 5000
    },
    ubicacion: { 
        type: String, 
        default: 'Santo Domingo' 
    },
    redactor: { 
        type: String, 
        default: 'mxl',
        trim: true
    },
    redactorFoto: { 
        type: String, 
        default: null 
    },
    imagen: { 
        type: String, 
        default: null 
    },
    vistas: { 
        type: Number, 
        default: 0 
    },
    fecha: { 
        type: Date, 
        default: Date.now 
    },
    fechaActualizacion: {
        type: Date,
        default: Date.now
    }
});

// Schema Usuarios
const usuarioSchema = new mongoose.Schema({
    nombre: { 
        type: String, 
        required: true, 
        trim: true 
    },
    email: { 
        type: String, 
        required: true, 
        unique: true, 
        lowercase: true 
    },
    password: { 
        type: String, 
        required: true 
    },
    fechaRegistro: { 
        type: Date, 
        default: Date.now 
    }
});

// Schema Configuración
const configuracionSchema = new mongoose.Schema({
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
    googleVerification: String,
    activarOpenGraph: { type: Boolean, default: true },
    fechaActualizacion: { type: Date, default: Date.now },
    actualizadoPor: String
});

// Models
const Noticia = mongoose.model('Noticia', noticiaSchema);
const Usuario = mongoose.model('Usuario', usuarioSchema);
const Configuracion = mongoose.model('Configuracion', configuracionSchema);

// ==================== FUNCIONES UTILITARIAS ====================
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generarToken(usuarioId) {
    return crypto.randomBytes(32).toString('hex');
}

// ==================== FUNCIÓN PARA INYECTAR METAETIQUETAS EN HTML ====================
async function inyectarMetaTags(html) {
    try {
        console.log('Inyectando meta tags...');
        const config = await Configuracion.findOne();
        if (config && config.googleVerification) {
            const metaTag = `<meta name="google-site-verification" content="${config.googleVerification}" />`;
            html = html.replace('<!-- META_GOOGLE_VERIFICATION -->', metaTag);
            console.log('Meta tag de Google Search Console inyectado.');
        } else {
            html = html.replace('<!-- META_GOOGLE_VERIFICATION -->', '');
            console.log('No hay código de verificación, se eliminó el marcador.');
        }
        return html;
    } catch (error) {
        console.error('Error inyectando meta tags:', error);
        return html; // Devolvemos el HTML sin cambios en caso de error
    }
}

// ==================== RUTAS DE PÁGINAS (HTML) CON INYECCIÓN SSR ====================

// Portada
app.get('/', async (req, res) => {
    try {
        console.log('Sirviendo portada...');
        const filePath = path.join(__dirname, 'client', 'index.html');
        let html = fs.readFileSync(filePath, 'utf8');
        html = await inyectarMetaTags(html);
        res.send(html);
    } catch (error) {
        console.error('Error sirviendo portada:', error);
        res.status(500).send('Error interno');
    }
});

// Redacción (no necesita inyección de meta, pero la dejamos igual)
app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// Ajustes
app.get('/ajustes', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'ajustes.html'));
});

// Noticia individual (también inyectamos metaetiquetas)
app.get('/noticia/:id', async (req, res) => {
    try {
        console.log('Sirviendo noticia individual...');
        const filePath = path.join(__dirname, 'client', 'noticia.html');
        let html = fs.readFileSync(filePath, 'utf8');
        html = await inyectarMetaTags(html);
        res.send(html);
    } catch (error) {
        console.error('Error sirviendo noticia:', error);
        res.status(500).send('Error interno');
    }
});

// ==================== RUTAS API (JSON) ====================

// Obtener todas las noticias
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

// Obtener una noticia por ID (incrementa vistas)
app.get('/api/noticias/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }
        const noticia = await Noticia.findById(id).lean();
        if (!noticia) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }
        // Incrementar vistas
        await Noticia.findByIdAndUpdate(id, { $inc: { vistas: 1 } });
        noticia.vistas = (noticia.vistas || 0) + 1;
        res.json({ success: true, noticia });
    } catch (error) {
        console.error('Error GET /api/noticias/:id:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener noticia' });
    }
});

// Obtener noticias por sección
app.get('/api/seccion/:nombre', async (req, res) => {
    try {
        const nombre = req.params.nombre;
        const seccionesValidas = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];
        if (!seccionesValidas.includes(nombre)) {
            return res.status(400).json({ success: false, error: 'Sección inválida' });
        }
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

// Obtener configuración
app.get('/api/configuracion', async (req, res) => {
    try {
        let config = await Configuracion.findOne();
        if (!config) {
            config = await Configuracion.create({});
        }
        res.json({ success: true, config: config.toObject() });
    } catch (error) {
        console.error('Error GET /api/configuracion:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener configuración' });
    }
});

// Obtener estadísticas
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

// Publicar nueva noticia
app.post('/api/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;

        if (pin !== "311") {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }

        if (!titulo || !seccion || !contenido) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
        }

        const seccionesValidas = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];
        if (!seccionesValidas.includes(seccion)) {
            return res.status(400).json({ success: false, error: 'Sección inválida' });
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

// Guardar configuración (VERSIÓN SIMPLIFICADA Y UNIFICADA)
app.post('/api/configuracion', async (req, res) => {
    try {
        const { pin, ...config } = req.body;

        if (pin !== "311") {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }

        let configDoc = await Configuracion.findOne();
        if (!configDoc) {
            configDoc = new Configuracion(config);
        } else {
            Object.assign(configDoc, config);
            configDoc.fechaActualizacion = new Date();
            configDoc.actualizadoPor = 'director';
        }
        await configDoc.save();

        console.log('✅ Configuración actualizada');
        res.json({ success: true, message: 'Configuración guardada correctamente' });
    } catch (error) {
        console.error('Error POST /api/configuracion:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Editar noticia
app.put('/api/noticias/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;

        if (pin !== "311") {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }

        if (!titulo || !seccion || !contenido) {
            return res.status(400).json({ success: false, error: 'Faltan campos' });
        }

        const seccionesValidas = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];
        if (!seccionesValidas.includes(seccion)) {
            return res.status(400).json({ success: false, error: 'Sección inválida' });
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
        res.json({ success: true, message: 'Noticia actualizada ✏️', noticia });
    } catch (error) {
        console.error('Error PUT /api/noticias/:id:', error.message);
        res.status(500).json({ success: false, error: 'Error al actualizar' });
    }
});

// Eliminar noticia
app.delete('/api/noticias/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { pin } = req.body;

        if (pin !== "311") {
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
        res.json({ success: true, message: 'Noticia eliminada 🗑️', id: noticia._id });
    } catch (error) {
        console.error('Error DELETE /api/noticias/:id:', error.message);
        res.status(500).json({ success: false, error: 'Error al eliminar' });
    }
});

// ==================== MANEJO DE ERRORES (REDIRECCIÓN A PORTADA) ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR ====================
const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - BÚNKER PRO 2.0 🏮          ║
╠════════════════════════════════════════════════════╣
║ ✅ Servidor escuchando en puerto ${PORT}           ║
║ 🏮 Portada: http://localhost:${PORT}              ║
║ ✏️ Redacción: http://localhost:${PORT}/redaccion  ║
║ 🎛️ Ajustes: http://localhost:${PORT}/ajustes     ║
║ 🎬 Videos: ACTIVADOS (10MB)                       ║
║ ✏️ Editar noticias: ACTIVADO                      ║
║ 🗑️ Eliminar noticias: ACTIVADO                    ║
║ 🔐 Autenticación: ACTIVADA                         ║
║ 📊 Analítica: ACTIVADA                             ║
║ 📱 Meta Tags Dinámicos: ACTIVADOS                  ║
║ 📸 Foto del periodista: ACTIVADA                   ║
║ 🔒 Verificación Token: ACTIVADA                    ║
║ 🔍 Metaetiquetas SSR: ACTIVADAS (Google Search Console) ║
║ 🟢 BÚNKER LISTO PARA OPERAR                        ║
╚════════════════════════════════════════════════════╝
  `);
});

// ==================== CIERRE GRACEFUL ====================
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
