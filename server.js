/**
 * 🏮 FAROL AL DÍA - Servidor Express
 * Bunker de noticias - República Dominicana
 * 
 * VERSIÓN CORREGIDA CON:
 * ✅ Validación robusta de PIN
 * ✅ Validación de campos obligatorios
 * ✅ Manejo de errores en todas las rutas
 * ✅ Middleware de error global
 * ✅ Paginación en noticias
 * ✅ Logging detallado
 * ✅ Responses en JSON consistente
 * ✅ Cierre graceful del servidor
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

// CORRECCIÓN #5: Usar variables de entorno
const mongoURI = process.env.MONGO_URI || 
  "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

// Conectar a MongoDB
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
    process.exit(1); // Detener si no hay conexión
  });

// ==================== ESQUEMA Y MODELO ====================

const noticiaSchema = new mongoose.Schema({
  // CORRECCIÓN #1 y #2: Agregar validaciones al schema
  titulo: {
    type: String,
    required: [true, 'El título es obligatorio'],
    trim: true,
    maxlength: [200, 'El título no puede exceder 200 caracteres']
  },
  seccion: {
    type: String,
    required: [true, 'La sección es obligatoria'],
    enum: ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos'],
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
 * GET / - Servir la página principal (index.html)
 * CORRECCIÓN #3: Agregar manejo de errores en sendFile
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
 * CORRECCIÓN #3: Agregar manejo de errores en sendFile
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
 * CORRECCIÓN #8: Agregar soporte para paginación
 * Query params: limit, skip
 */
app.get('/noticias', async (req, res) => {
  try {
    // CORRECCIÓN #8: Implementar paginación
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Máximo 100
    const skip = parseInt(req.query.skip) || 0;

    // Validar que los parámetros sean números válidos
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
      .lean(); // CORRECCIÓN: Usar lean() para mejor performance

    const total = await Noticia.countDocuments();

    // CORRECCIÓN #6: Respuesta consistente en JSON
    res.json({
      success: true,
      total: total,
      cantidad: noticias.length,
      limit: limit,
      skip: skip,
      noticias: noticias
    });

  } catch (error) {
    // CORRECCIÓN #9: Loguear el error completo
    console.error('❌ Error al obtener noticias:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al obtener noticias',
      detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /noticias/:id - Obtener una noticia por su ID
 * CORRECCIÓN #10: Validar ObjectId antes de consultar
 */
app.get('/noticias/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // CORRECCIÓN #10: Validar que el ID sea un ObjectId válido
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID de noticia inválido'
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
    console.error('❌ Error al obtener noticia por ID:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al obtener noticia',
      detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== RUTAS - POST ====================

/**
 * POST /publicar - Publicar una nueva noticia
 * Requiere: PIN, título, contenido
 * Opcionales: ubicación, redactor, imagen
 */
app.post('/publicar', async (req, res) => {
  try {
    const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;

    // ============ CORRECCIÓN #1: Validar PIN completo ============
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

    // ============ CORRECCIÓN #2: Validar campos obligatorios ============
    if (!titulo) {
      return res.status(400).json({
        success: false,
        error: 'El título es obligatorio'
      });
    }

    // ✨ NUEVA VALIDACIÓN: SECCIÓN OBLIGATORIA
    if (!seccion) {
      return res.status(400).json({
        success: false,
        error: 'La sección es obligatoria'
      });
    }

    // Validar que la sección sea válida
    const seccionesValidas = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos'];
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

    // ============ CORRECCIÓN #7: Validar tamaño de imagen ============
    if (imagen && typeof imagen === 'string') {
      const imagenSizeKB = (imagen.length / 1024).toFixed(2);
      if (imagenSizeKB > 15 * 1024) { // 15MB en KB
        return res.status(413).json({
          success: false,
          error: `Imagen muy grande: ${imagenSizeKB}KB. Máximo: 15MB`
        });
      }
    }

    // Crear la nueva noticia
    const nuevaNoticia = new Noticia({
      titulo: titulo.trim(),
      seccion: seccion,  // ← AGREGAR SECCIÓN
      contenido: contenido.trim(),
      ubicacion: ubicacion ? ubicacion.trim() : '',
      redactor: redactor ? redactor.trim() : '',
      imagen: imagen || null
    });

    // Guardar en la base de datos
    const noticiaSaved = await nuevaNoticia.save();

    // CORRECCIÓN #9: Loguear el éxito
    console.log('📰 Nueva noticia publicada:', {
      id: noticiaSaved._id,
      titulo: noticiaSaved.titulo,
      timestamp: new Date().toISOString()
    });

    // CORRECCIÓN #6: Respuesta consistente en JSON
    res.status(201).json({
      success: true,
      message: 'Publicado con éxito 🏮',
      noticia: {
        id: noticiaSaved._id,
        titulo: noticiaSaved.titulo,
        fecha: noticiaSaved.fecha
      }
    });

  } catch (error) {
    // CORRECCIÓN #9: Loguear el error completo
    console.error('❌ Error al publicar noticia:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Manejar errores de validación de Mongoose
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
 * CORRECCIÓN #4: Middleware para rutas no encontradas
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
 * CORRECCIÓN #4: Middleware para manejo global de errores
 * Nota: Debe ser el último middleware
 */
app.use((err, req, res, next) => {
  console.error('❌ Error no capturado:', {
    message: err.message,
    stack: err.stack,
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
╚════════════════════════════════════════════╝
  `);
});

// ==================== MANEJO DE CIERRE GRACEFUL ====================

/**
 * CORRECCIÓN: Manejar cierre del servidor correctamente
 */
process.on('SIGTERM', () => {
  console.log('\n⏹️ Señal SIGTERM recibida. Cerrando servidor gracefully...');
  
  server.close(() => {
    console.log('🔌 Servidor HTTP cerrado');
    
    mongoose.connection.close(false, () => {
      console.log('📊 Conexión a MongoDB cerrada');
      process.exit(0);
    });
  });

  // Si no cierra en 10 segundos, forzar cierre
  setTimeout(() => {
    console.error('⚠️ Timeout. Forzando cierre...');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  console.log('\n⏹️ Señal SIGINT recibida (Ctrl+C)');
  process.emit('SIGTERM');
});

// Manejar excepciones no capturadas
process.on('uncaughtException', (err) => {
  console.error('💥 Excepción no capturada:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Promesa rechazada no manejada:', {
    reason: reason,
    promise: promise
  });
});

module.exports = app; // Para testing
