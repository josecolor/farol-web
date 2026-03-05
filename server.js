/**
 * 🏮 FAROL AL DÍA - SERVIDOR CON EDICIÓN
 * ✅ Videos funcionales
 * ✅ Editar noticias
 * ✅ Eliminar noticias
 * ✅ Autenticación
 * ✅ Navegación
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();

// ==================== CONFIGURACIÓN ====================

// AUMENTAR LÍMITE A 50MB PARA VIDEOS
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
  })
  .catch(err => {
    console.error('❌ Error MongoDB:', err.message);
    process.exit(1);
  });

// ==================== ESQUEMAS ====================

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
  },
  fechaActualizacion: {
    type: Date,
    default: Date.now
  }
});

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

const Noticia = mongoose.model('Noticia', noticiaSchema);
const Usuario = mongoose.model('Usuario', usuarioSchema);

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

// ==================== RUTAS AUTENTICACIÓN ====================

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

// ==================== RUTAS PUT (ACTUALIZAR) ====================

app.put('/noticia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;

    // Validar PIN
    if (pin !== "311") {
      return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }

    // Validar ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    // Validar campos
    if (!titulo || !seccion || !contenido) {
      return res.status(400).json({ success: false, error: 'Faltan campos' });
    }

    const seccionesValidas = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];
    if (!seccionesValidas.includes(seccion)) {
      return res.status(400).json({ success: false, error: 'Sección inválida' });
    }

    // Actualizar
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
      noticia: {
        id: noticia._id,
        titulo: noticia.titulo,
        seccion: noticia.seccion,
        fecha: noticia.fechaActualizacion
      }
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

    // Validar PIN
    if (pin !== "311") {
      return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }

    // Validar ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    // Eliminar
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
║ ✅ Servidor iniciado en puerto ${PORT}   ║
║ 🎬 VIDEOS: ACTIVADOS (50MB)           ║
║ ✏️ EDITAR: ACTIVADO                    ║
║ 🗑️ ELIMINAR: ACTIVADO                 ║
║ 🔐 Autenticación: ACTIVADA            ║
║ 📰 Navegación: FUNCIONANDO            ║
╚════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  console.log('⏹️ Cerrando servidor...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      process.exit(0);
    });
  });
});

module.exports = app;
