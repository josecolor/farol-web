/**
 * 🏮 FAROL AL DÍA - Servidor Express
 * Bunker de noticias - República Dominicana
 * 
 * VERSIÓN CON:
 * ✅ Validación robusta de PIN
 * ✅ Validación de campos obligatorios
 * ✅ Manejo de errores en todas las rutas
 * ✅ Middleware de error global
 * ✅ Paginación en noticias
 * ✅ Logging detallado
 * ✅ Responses en JSON consistente
 * ✅ Cierre graceful del servidor
 * ✅ NAVEGACIÓN POR SECCIONES
 * ✅ NOTICIAS INDIVIDUALES
 * ✅ BÚSQUEDA DE NOTICIAS
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// ==================== CONFIGURACIÓN DE MIDDLEWARES ====================

// Aumentar límite de tamaño para fotos desde el celular
app.use(express.json({ limit: '15mb' })); 
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// Servir archivos estáticos desde la carpeta 'client'
app.use(express.static(path.join(__dirname, 'client')));

// Habilitar CORS
app.use(cors());

// ==================== CONEXIÓN A BASE DE DATOS ====================

const mongoURI = process.env.MONGO_URI || 
  "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => {
    console.log('✅ Búnker conectado con éxito');
    console.log('📡 Conectado a:', mongoURI.split('@')[1] || 'Base de datos local');
  })
  .catch(err => {
    console.error('❌ Error de conexión a MongoDB:', err.message);
    process.exit(1);
  });

// ==================== ESQUEMA Y MODELO ====================

const noticiaSchema = new mongoose.Schema({
  titulo: {
    type: String,
    required: [true, 'El título es obligatorio'],
    trim: true,
    maxlength: [200, 'El título no puede exceder 200 caracteres']
  },
  seccion: {
    type: String,
    required: [true, 'La sección es obligatoria'],
    enum: ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'],
    trim: true
  },
  contenido: {
    type: String,
    required: [true, 'El contenido es obligatorio'],
    trim: true,
    maxlength: [5000, 'El contenido no puede exceder 5000 caracteres']
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

const Noticia = mongoose.model('Noticia', noticiaSchema);

// ==================== RUTAS - GET ====================

/**
 * GET / - Servir la página principal
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'), (err) => {
    if (err) {
      console.error('❌ Error al servir index.html:', err);
      res.status(404).json({ error: 'Página principal no encontrada' });
    }
  });
});

/**
 * GET /redaccion - Servir el panel de redacción
 */
app.get('/redaccion', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'redaccion.html'), (err) => {
    if (err) {
      console.error('❌ Error al servir redaccion.html:', err);
      res.status(404).json({ error: 'Panel de redacción no encontrado' });
    }
  });
});

/**
 * GET /noticias - Obtener todas las noticias con paginación
 * Query params: limit, skip
 */
app.get('/noticias', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = parseInt(req.query.skip) || 0;

    if (isNaN(limit) || isNaN(skip) || skip < 0) {
      return res.status(400).json({
        error: 'Parámetros de paginación inválidos',
        detalles: 'limit y skip deben ser números positivos'
      });
    }

    const noticias = await Noticia.find()
      .sort({ fecha: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await Noticia.countDocuments();

    res.json({
      success: true,
      total: total,
      cantidad: noticias.length,
      limit: limit,
      skip: skip,
      noticias: noticias
    });

  } catch (error) {
    console.error('❌ Error al obtener noticias:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al obtener noticias',
      detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== RUTAS DE NAVEGACIÓN ====================

/**
 * GET /seccion/:nombre - Obtener noticias por sección
 */
app.get('/seccion/:nombre', async (req, res) => {
  try {
    const nombre = req.params.nombre;
    const seccionesValidas = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];

    if (!seccionesValidas.includes(nombre)) {
      return res.status(400).json({
        success: false,
        error: 'Sección inválida'
      });
    }

    const noticias = await Noticia.find({ seccion: nombre })
      .sort({ fecha: -1 })
      .limit(100)
      .lean();

    res.json({
      success: true,
      seccion: nombre,
      total: noticias.length,
      noticias: noticias
    });

  } catch (error) {
    console.error('❌ Error en /seccion/:nombre:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al obtener noticias de la sección'
    });
  }
});

/**
 * GET /noticia/:id - Obtener una noticia por ID
 */
app.get('/noticia/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }

    const noticia = await Noticia.findById(id);

    if (!noticia) {
      return res.status(404).json({
        success: false,
        error: 'Noticia no encontrada'
      });
    }

    res.json({
      success: true,
      noticia: noticia
    });

  } catch (error) {
    console.error('❌ Error en /noticia/:id:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al obtener la noticia'
    });
  }
});

/**
 * GET /buscar?q=palabra - Buscar noticias
 */
app.get('/buscar', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Ingresa una palabra de búsqueda'
      });
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
      noticias: noticias
    });

  } catch (error) {
    console.error('❌ Error en /buscar:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al buscar noticias'
    });
  }
});

// ==================== RUTAS - POST ====================

/**
 * POST /publicar - Publicar una nueva noticia
 */
app.post('/publicar', async (req, res) => {
  try {
    const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;

    // Validar PIN
    if (!pin) {
      return res.status(400).json({
        success: false,
        error: 'El PIN es requerido'
      });
    }

    if (pin !== "311") {
      console.warn('⚠️ Intento de acceso con PIN incorrecto:', pin);
      return res.status(403).json({
        success: false,
        error: 'PIN incorrecto'
      });
    }

    // Validar campos obligatorios
    if (!titulo) {
      return res.status(400).json({
        success: false,
        error: 'El título es obligatorio'
      });
    }

    if (!seccion) {
      return res.status(400).json({
        success: false,
        error: 'La sección es obligatoria'
      });
    }

    const seccionesValidas = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];
    if (!seccionesValidas.includes(seccion)) {
      return res.status(400).json({
        success: false,
        error: 'Sección inválida'
      });
    }

    if (!contenido) {
      return res.status(400).json({
        success: false,
        error: 'El contenido es obligatorio'
      });
    }

    // Validar longitudes
    if (titulo.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El título no puede estar vacío'
      });
    }

    if (contenido.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El contenido no puede estar vacío'
      });
    }

    if (titulo.length > 200) {
      return res.status(400).json({
        success: false,
        error: 'El título no puede exceder 200 caracteres'
      });
    }

    if (contenido.length > 5000) {
      return res.status(400).json({
        success: false,
        error: 'El contenido no puede exceder 5000 caracteres'
      });
    }

    // Validar tamaño de imagen
    if (imagen && typeof imagen === 'string') {
      const imagenSizeKB = (imagen.length / 1024).toFixed(2);
      if (imagenSizeKB > 15 * 1024) {
        return res.status(413).json({
          success: false,
          error: `Imagen muy grande: ${imagenSizeKB}KB. Máximo: 15MB`
        });
      }
    }

    // Crear la nueva noticia
    const nuevaNoticia = new Noticia({
      titulo: titulo.trim(),
      seccion: seccion,
      contenido: contenido.trim(),
      ubicacion: ubicacion ? ubicacion.trim() : '',
      redactor: redactor ? redactor.trim() : '',
      imagen: imagen || null
    });

    // Guardar en la base de datos
    const noticiaSaved = await nuevaNoticia.save();

    console.log('📰 Nueva noticia publicada:', {
      id: noticiaSaved._id,
      titulo: noticiaSaved.titulo,
      seccion: noticiaSaved.seccion,
      timestamp: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'Publicado con éxito 🏮',
      noticia: {
        id: noticiaSaved._id,
        titulo: noticiaSaved.titulo,
        seccion: noticiaSaved.seccion,
        fecha: noticiaSaved.fecha
      }
    });

  } catch (error) {
    console.error('❌ Error al publicar noticia:', {
      message: error.message,
      timestamp: new Date().toISOString()
    });

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors)
        .map(err => err.message)
        .join(', ');
      return res.status(400).json({
        success: false,
        error: 'Error de validación',
        detalles: messages
      });
    }

    res.status(500).json({
      success: false,
      error: 'Error al publicar la noticia',
      detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== MIDDLEWARE DE ERROR GLOBAL ====================

/**
 * Middleware para rutas no encontradas
 */
app.use((req, res) => {
  console.warn(`⚠️ Ruta no encontrada: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: 'Ruta no encontrada',
    ruta: req.path,
    metodo: req.method
  });
});

/**
 * Middleware para manejo global de errores
 */
app.use((err, req, res, next) => {
  console.error('❌ Error no capturado:', {
    message: err.message,
    timestamp: new Date().toISOString()
  });

  res.status(err.status || 500).json({
    success: false,
    error: 'Error interno del servidor',
    detalles: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ==================== INICIAR SERVIDOR ====================

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║       🏮 EL FAROL AL DÍA 🏮                ║
║    Bunker de Noticias - República RD      ║
╠════════════════════════════════════════════╣
║ ✅ Servidor iniciado correctamente        ║
║ 🔌 Puerto: ${PORT}                          ║
║ 📡 URL: http://localhost:${PORT}           ║
║ 🔐 Admin: http://localhost:${PORT}/redaccion ║
║ 📰 Noticias: http://localhost:${PORT}/noticias ║
║ 📌 Secciones: http://localhost:${PORT}/seccion/:nombre ║
║ 🔍 Búsqueda: http://localhost:${PORT}/buscar?q=palabra ║
╚════════════════════════════════════════════╝
  `);
});

// ==================== MANEJO DE CIERRE GRACEFUL ====================

process.on('SIGTERM', () => {
  console.log('\n⏹️ Señal SIGTERM recibida. Cerrando servidor gracefully...');
  
  server.close(() => {
    console.log('🔌 Servidor HTTP cerrado');
    
    mongoose.connection.close(false, () => {
      console.log('📊 Conexión a MongoDB cerrada');
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('⚠️ Timeout. Forzando cierre...');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  console.log('\n⏹️ Señal SIGINT recibida (Ctrl+C)');
  process.emit('SIGTERM');
});

process.on('uncaughtException', (err) => {
  console.error('💥 Excepción no capturada:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Promesa rechazada no manejada:', reason);
});

module.exports = app;

