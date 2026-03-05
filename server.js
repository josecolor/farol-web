/**
 * 🏮 FAROL AL DÍA - SERVIDOR COMPLETO
 * Sistema profesional de noticias con:
 * ✅ Autenticación (registro/login)
 * ✅ Navegación por secciones
 * ✅ Noticias individuales
 * ✅ Búsqueda
 * ✅ Compartir en redes
 * ✅ Usuarios registrados
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();

// ==================== CONFIGURACIÓN ====================

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
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
  })
  .catch(err => {
    console.error('❌ Error MongoDB:', err.message);
    process.exit(1);
  });

// ==================== ESQUEMAS ====================

// SCHEMA NOTICIAS
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
  fecha: {
    type: Date,
    default: Date.now
  }
});

// SCHEMA USUARIOS
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

// MODELS
const Noticia = mongoose.model('Noticia', noticiaSchema);
const Usuario = mongoose.model('Usuario', usuarioSchema);

// ==================== FUNCIONES UTILITARIAS ====================

// Hash de contraseña simple (NO usar en producción)
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Generar token simple
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
    res.status(500).json({ success: false, error: 'Error al obtener noticias' });
  }
});

// Obtener noticia por ID
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

// Buscar noticias
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

// ==================== RUTAS AUTENTICACIÓN ====================

// Registro
app.post('/auth/registro', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    // Validar
    if (!nombre || !email || !password) {
      return res.status(400).json({ success: false, error: 'Faltan datos' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Contraseña muy corta' });
    }

    // Verificar si existe
    const existe = await Usuario.findOne({ email: email.toLowerCase() });
    if (existe) {
      return res.status(400).json({ success: false, error: 'El email ya está registrado' });
    }

    // Crear usuario
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

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Faltan credenciales' });
    }

    // Buscar usuario
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

// ==================== RUTAS POST ====================

// Publicar noticia
app.post('/publicar', async (req, res) => {
  try {
    const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;

    // Validar PIN
    if (pin !== "311") {
      return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }

    // Validar campos
    if (!titulo || !seccion || !contenido) {
      return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
    }

    const seccionesValidas = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];
    if (!seccionesValidas.includes(seccion)) {
      return res.status(400).json({ success: false, error: 'Sección inválida' });
    }

    // Crear noticia
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

// ==================== ERRORES ====================

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ success: false, error: 'Error interno' });
});

// ==================== INICIAR SERVIDOR ====================

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - COMPLETO 🏮    ║
╠════════════════════════════════════════╣
║ ✅ Servidor iniciado en puerto ${PORT}     ║
║ 📡 URL: http://localhost:${PORT}        ║
║ 🔐 Autenticación: ACTIVADA             ║
║ 📰 Secciones: FUNCIONANDO              ║
║ 🔄 Compartir redes: ACTIVADO           ║
╚════════════════════════════════════════╝
  `);
});

// Cierre graceful
process.on('SIGTERM', () => {
  console.log('⏹️ Cerrando servidor...');
  server.close(() => {
    console.log('🔌 Servidor cerrado');
    mongoose.connection.close(false, () => {
      console.log('📊 MongoDB cerrado');
      process.exit(0);
    });
  });
});

module.exports = app;
