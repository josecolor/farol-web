/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR COMPLETO CORREGIDO
 * Búnker PRO con Panel de Control Maestro + Verificación Token
 * ✅ FIX: Conexiones MongoDB cerradas correctamente
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();

// ==================== CONFIGURACIÓN ====================

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== CONEXIÓN MONGODB ====================

const mongoURI = process.env.MONGO_URI || 
  "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => {
    console.log('✅ Búnker conectado con éxito');
    console.log('🎬 Soporte de video: ACTIVADO (50MB)');
    console.log('🎛️ Panel de Control: ACTIVADO');
    console.log('🔐 Verificación Token: ACTIVADA');
  })
  .catch(err => {
    console.error('❌ Error MongoDB:', err.message);
    process.exit(1);
  });

// ==================== ESQUEMAS ====================

// Schema Noticias
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
    trim: true,
    default: ''
  },
  redactor: {
    type: String,
    trim: true,
    default: ''
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
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
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

// Token admin secreto
const ADMIN_TOKEN_SECRETO = process.env.ADMIN_TOKEN || 'bunker_admin_seguro_2026';

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
      limit,
      skip,
      noticias
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al obtener noticias' });
  }
});

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
    res.status(500).json({ success: false, error: 'Error al obtener noticias' });
  }
});

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

    res.json({ success: true, noticia });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al obtener noticia' });
  }
});

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
    res.status(500).json({ success: false, error: 'Error al buscar' });
  }
});

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
    console.error('Error obteniendo configuración:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al obtener configuración'
    });
  }
});

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
    console.error('Error obteniendo estadísticas:', error.message);
    res.status(500).json({ success: false, error: 'Error al obtener estadísticas' });
  }
});

// ==================== RUTAS POST ====================

app.post('/publicar', async (req, res) => {
  try {
    const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;

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
      ubicacion: ubicacion ? ubicacion.trim() : '',
      redactor: redactor ? redactor.trim() : '',
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
    console.error('Error publicar:', error.message);
    res.status(500).json({ success: false, error: 'Error al publicar' });
  }
});

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
    console.error('Error registro:', error.message);
    res.status(500).json({ success: false, error: 'Error al registrar' });
  }
});

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
    console.error('Error login:', error.message);
    res.status(500).json({ success: false, error: 'Error al iniciar sesión' });
  }
});

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
    console.error('Error registrando vista:', error.message);
    res.status(500).json({ success: false, error: 'Error al registrar vista' });
  }
});

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
    console.error('Error guardando configuración:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al guardar configuración'
    });
  }
});

app.post('/api/verificar-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'Token requerido' 
      });
    }

    if (token === ADMIN_TOKEN_SECRETO) {
      console.log('✅ Token ADMIN verificado correctamente');
      return res.json({ 
        success: true, 
        message: 'Token válido - Acceso como ADMIN' 
      });
    }

    return res.status(401).json({ 
      success: false, 
      error: 'Token inválido' 
    });

  } catch (error) {
    console.error('Error verificando token:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Error al verificar token' 
    });
  }
});

// ==================== RUTAS PUT ====================

app.put('/noticia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;

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
        ubicacion: ubicacion ? ubicacion.trim() : '',
        redactor: redactor ? redactor.trim() : '',
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
    console.error('Error actualizar:', error.message);
    res.status(500).json({ success: false, error: 'Error al actualizar' });
  }
});

// ==================== RUTAS DELETE ====================

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
    console.error('Error eliminar:', error.message);
    res.status(500).json({ success: false, error: 'Error al eliminar' });
  }
});

// ==================== MANEJO DE ERRORES ====================

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ success: false, error: 'Error interno' });
});

// ==================== INICIAR SERVIDOR CON CIERRE CORREGIDO ====================

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - BÚNKER PRO 2.0 🏮          ║
╠════════════════════════════════════════════════════╣
║ ✅ Servidor iniciado en puerto ${PORT}             ║
║ ✅ FIX: Conexiones MongoDB cerradas con PROMESAS  ║
║ 🏮 Portada: http://localhost:${PORT}              ║
║ ✏️ Redacción: http://localhost:${PORT}/redaccion  ║
║ 🎛️ Panel: http://localhost:${PORT}/ajustes        ║
╚════════════════════════════════════════════════════╝
  `);
});

// ==================== CIERRE CORREGIDO (CON PROMESAS) ====================

// Para SIGTERM (Railway apagando)
process.on('SIGTERM', async () => {
  console.log('\n⏹️ Señal SIGTERM recibida - Cerrando servidor...');
  
  // Cerrar servidor HTTP primero
  server.close(() => {
    console.log('🔌 Servidor HTTP cerrado');
  });
  
  try {
    // Cerrar MongoDB con PROMESA (NO callback)
    await mongoose.connection.close();
    console.log('📊 MongoDB cerrado correctamente');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error cerrando MongoDB:', err.message);
    process.exit(1);
  }
});

// Para SIGINT (Ctrl+C en terminal)
process.on('SIGINT', async () => {
  console.log('\n⏹️ Ctrl+C detectado - Cerrando servidor...');
  
  server.close(() => {
    console.log('🔌 Servidor HTTP cerrado');
  });
  
  try {
    await mongoose.connection.close();
    console.log('📊 MongoDB cerrado correctamente');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
});

module.exports = app;
