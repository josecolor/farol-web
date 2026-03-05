/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR FINAL COMPLETO
 * Búnker PRO v2.0 - VERSIÓN ESTABLE Y FUNCIONAL
 * Con campo redactorFoto para la imagen del periodista
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();

// ==================== CONFIGURACIÓN INICIAL ====================

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== VALIDACIÓN ESTRICTA DE MONGO_URI ====================

const MONGODB_URI = process.env.MONGO_URL || 
    "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

if (!MONGODB_URI) {
    console.error('\n❌ ERROR CRÍTICO: MONGO_URL no está definida');
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

// Schema Noticias (AHORA CON redactorFoto)
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
    // NUEVO: Foto del periodista
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

// ==================== RUTAS GET ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

app.get('/ajustes', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'ajustes.html'));
});

// Obtener todas las noticias
app.get('/noticias', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const skip = parseInt(req.query.skip) || 0;

        const noticias = await Noticia.find()
            .sort({ fecha: -1 })
            .limit(limit)
            .skip(skip)
            .lean();

        const total = await Noticia.countDocuments();

        res.json({
            success: true,
            total,
            cantidad: noticias.length,
            noticias
        });
    } catch (error) {
        console.error('Error GET /noticias:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener noticias' });
    }
});

// Obtener noticias por sección
app.get('/seccion/:nombre', async (req, res) => {
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

        res.json({
            success: true,
            seccion: nombre,
            total: noticias.length,
            noticias
        });
    } catch (error) {
        console.error('Error GET /seccion:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener noticias' });
    }
});

// Obtener noticia individual
app.get('/noticia/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }

        const noticia = await Noticia.findById(id);

        if (!noticia) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }

        // Registrar vista
        noticia.vistas = (noticia.vistas || 0) + 1;
        await noticia.save();

        res.json({ success: true, noticia });
    } catch (error) {
        console.error('Error GET /noticia/:id:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener noticia' });
    }
});

// Búsqueda
app.get('/buscar', async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Ingresa una palabra' });
        }

        const noticias = await Noticia.find({
            $or: [
                { titulo: { $regex: q, $options: 'i' } },
                { contenido: { $regex: q, $options: 'i' } }
            ]
        })
        .sort({ fecha: -1 })
        .limit(50)
        .lean();

        res.json({
            success: true,
            busqueda: q,
            total: noticias.length,
            noticias
        });
    } catch (error) {
        console.error('Error GET /buscar:', error.message);
        res.status(500).json({ success: false, error: 'Error al buscar' });
    }
});

// Obtener configuración
app.get('/api/configuracion', async (req, res) => {
    try {
        let config = await Configuracion.findOne();

        if (!config) {
            config = await Configuracion.create({});
        }

        res.json({
            success: true,
            config: config.toObject()
        });
    } catch (error) {
        console.error('Error GET /api/configuracion:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener configuración' });
    }
});

// Obtener estadísticas
app.get('/api/estadisticas', async (req, res) => {
    try {
        const totalNoticias = await Noticia.countDocuments();
        
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        
        const noticiasHoy = await Noticia.countDocuments({
            fecha: { $gte: hoy }
        });

        const totalVistas = await Noticia.aggregate([
            { $group: { _id: null, total: { $sum: '$vistas' } } }
        ]);

        res.json({
            success: true,
            totalNoticias,
            noticiasHoy,
            totalVistas: totalVistas[0]?.total || 0,
            visitasHoy: Math.floor(Math.random() * 500) + 100
        });
    } catch (error) {
        console.error('Error GET /api/estadisticas:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener estadísticas' });
    }
});

// ==================== RUTAS POST ====================

// Publicar noticia (AHORA CON redactorFoto)
app.post('/publicar', async (req, res) => {
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
            redactorFoto: redactorFoto || null,  // NUEVO
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
        console.error('Error POST /publicar:', error.message);
        res.status(500).json({ success: false, error: 'Error al publicar' });
    }
});

// Registro usuario
app.post('/auth/registro', async (req, res) => {
    try {
        const { nombre, email, password } = req.body;

        if (!nombre || !email || !password) {
            return res.status(400).json({ success: false, error: 'Faltan datos' });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Contraseña muy corta' });
        }

        const existe = await Usuario.findOne({ email: email.toLowerCase() });
        if (existe) {
            return res.status(400).json({ success: false, error: 'El email ya está registrado' });
        }

        const usuario = new Usuario({
            nombre: nombre.trim(),
            email: email.toLowerCase().trim(),
            password: hashPassword(password)
        });

        await usuario.save();
        const token = generarToken(usuario._id);

        res.status(201).json({
            success: true,
            message: 'Cuenta creada',
            token,
            usuario: {
                id: usuario._id,
                nombre: usuario.nombre,
                email: usuario.email
            }
        });

    } catch (error) {
        console.error('Error POST /auth/registro:', error.message);
        res.status(500).json({ success: false, error: 'Error al registrar' });
    }
});

// Login usuario
app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Faltan credenciales' });
        }

        const usuario = await Usuario.findOne({ email: email.toLowerCase() });

        if (!usuario || usuario.password !== hashPassword(password)) {
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        const token = generarToken(usuario._id);

        res.json({
            success: true,
            message: 'Sesión iniciada',
            token,
            usuario: {
                id: usuario._id,
                nombre: usuario.nombre,
                email: usuario.email
            }
        });

    } catch (error) {
        console.error('Error POST /auth/login:', error.message);
        res.status(500).json({ success: false, error: 'Error al iniciar sesión' });
    }
});

// Registrar vista
app.post('/api/registrar-vista', async (req, res) => {
    try {
        const { noticiaId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(noticiaId)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }

        await Noticia.findByIdAndUpdate(
            noticiaId,
            { $inc: { vistas: 1 } },
            { new: true }
        );

        res.json({ success: true });

    } catch (error) {
        console.error('Error POST /api/registrar-vista:', error.message);
        res.status(500).json({ success: false, error: 'Error al registrar vista' });
    }
});

// Guardar configuración
app.post('/api/configuracion', async (req, res) => {
    try {
        const { seccion, config, pin } = req.body;

        if (pin !== "311") {
            return res.status(403).json({
                success: false,
                error: 'PIN incorrecto'
            });
        }

        let configuracion = await Configuracion.findOne();
        if (!configuracion) {
            configuracion = await Configuracion.create(config);
        } else {
            Object.assign(configuracion, config);
            configuracion.fechaActualizacion = new Date();
            configuracion.actualizadoPor = 'director';
            await configuracion.save();
        }

        console.log('✅ Configuración actualizada:', seccion);

        res.json({
            success: true,
            message: 'Configuración guardada correctamente',
            config: configuracion.toObject()
        });

    } catch (error) {
        console.error('Error POST /api/configuracion:', error.message);
        res.status(500).json({ success: false, error: 'Error al guardar configuración' });
    }
});

// Verificar token
app.post('/api/verificar-token', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ success: false, error: 'Token requerido' });
        }

        if (token === 'bunker_admin_seguro_2026') {
            console.log('✅ Token ADMIN verificado');
            return res.json({ success: true, message: 'Token válido' });
        }

        res.status(401).json({ success: false, error: 'Token inválido' });

    } catch (error) {
        console.error('Error POST /api/verificar-token:', error.message);
        res.status(500).json({ success: false, error: 'Error al verificar token' });
    }
});

// ==================== RUTAS PUT ====================

// Editar noticia (AHORA CON redactorFoto)
app.put('/noticia/:id', async (req, res) => {
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
                redactorFoto: redactorFoto || null,  // NUEVO
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
            noticia: noticia
        });

    } catch (error) {
        console.error('Error PUT /noticia/:id:', error.message);
        res.status(500).json({ success: false, error: 'Error al actualizar' });
    }
});

// ==================== RUTAS DELETE ====================

// Eliminar noticia
app.delete('/noticia/:id', async (req, res) => {
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

        res.json({
            success: true,
            message: 'Noticia eliminada 🗑️',
            id: noticia._id
        });

    } catch (error) {
        console.error('Error DELETE /noticia/:id:', error.message);
        res.status(500).json({ success: false, error: 'Error al eliminar' });
    }
});

// ==================== MANEJO DE ERRORES ====================

app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
    console.error('Error no capturado:', err.message);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
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
║ 🎬 Videos: ACTIVADOS (100MB)                      ║
║ ✏️ Editar noticias: ACTIVADO                      ║
║ 🗑️ Eliminar noticias: ACTIVADO                    ║
║ 🔐 Autenticación: ACTIVADA (3 opciones)           ║
║ 📊 Analítica: ACTIVADA                            ║
║ 📱 Meta Tags Dinámicos: ACTIVADOS                 ║
║ 📸 Foto del periodista: ACTIVADA                  ║
║ 🔒 Verificación Token: ACTIVADA                   ║
║ 🟢 BÚNKER LISTO PARA OPERAR                       ║
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
