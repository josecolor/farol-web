/**
 * 🏮 EL FAROL AL DÍA - BÚNKER 2.0 MOBILE-FIRST
 * Con analítica, auto-guardado y compresión automática
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Configuración con límites grandes para videos
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
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
    console.log('✅ BÚNKER 2.0 MOBILE-FIRST ACTIVADO');
    console.log('🎬 Compresión automática: WebP/720p');
    console.log('📊 Google Analytics: Listo para inyectar');
    console.log('💾 Auto-guardado: Activado');
  })
  .catch(err => {
    console.error('❌ Error MongoDB:', err.message);
    process.exit(1);
  });

// ==================== ESQUEMAS ====================

const noticiaSchema = new mongoose.Schema({
  titulo: { type: String, required: true, trim: true, maxlength: 200 },
  seccion: { 
    type: String, 
    required: true, 
    enum: ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía']
  },
  contenido: { type: String, required: true, trim: true, maxlength: 10000 },
  ubicacion: { type: String, trim: true, default: '' },
  redactor: { type: String, trim: true, default: 'mxl' },
  imagen: { type: String, default: null },
  vistas: { type: Number, default: 0 },
  visitantes: [{ 
    ip: String,
    fecha: { type: Date, default: Date.now }
  }],
  fecha: { type: Date, default: Date.now },
  fechaActualizacion: { type: Date, default: Date.now }
});

const configuracionSchema = new mongoose.Schema({
  // SITIO
  nombreSitio: { type: String, default: 'El Farol al Día' },
  tagline: { type: String, default: 'Diario Digital de Noticias en Vivo' },
  colorPrincipal: { type: String, default: '#FF8C00' },
  emailContacto: String,
  ubicacionSitio: String,
  descripcionSitio: String,
  
  // REDES
  facebook: String,
  instagram: String,
  twitter: String,
  whatsapp: String,
  telegram: String,
  whatsappCanal: String,
  
  // ANALÍTICA - NUEVO
  googleAnalytics: String,
  mostrarVistas: { type: Boolean, default: true },
  contadorVisitas: { type: Boolean, default: true },
  
  // MONETIZACIÓN
  amazonId: String,
  googleAdsense: String,
  linkDonacion: String,
  
  // SEO
  metaKeywords: String,
  googleVerification: String,
  activarOpenGraph: { type: Boolean, default: true },
  
  fechaActualizacion: { type: Date, default: Date.now }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);
const Configuracion = mongoose.model('Configuracion', configuracionSchema);

// ==================== TOKEN SEGURO ====================
const ADMIN_TOKEN_SECRETO = process.env.ADMIN_TOKEN || 'bunker_mobile_2026';

// ==================== RUTAS PÚBLICAS ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

app.get('/ajustes', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'ajustes.html'));
});

// ==================== API NOTICIAS ====================

// Obtener todas las noticias (con límite)
app.get('/noticias', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const noticias = await Noticia.find()
      .sort({ fecha: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, noticias });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al obtener noticias' });
  }
});

// Obtener una noticia por ID (con contador de vistas)
app.get('/noticia/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    // Incrementar vistas automáticamente
    const noticia = await Noticia.findByIdAndUpdate(
      id,
      { $inc: { vistas: 1 } },
      { new: true }
    );

    if (!noticia) {
      return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
    }

    res.json({ success: true, noticia });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al obtener noticia' });
  }
});

// Noticias por sección
app.get('/seccion/:nombre', async (req, res) => {
  try {
    const secciones = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];
    if (!secciones.includes(req.params.nombre)) {
      return res.status(400).json({ success: false, error: 'Sección inválida' });
    }

    const noticias = await Noticia.find({ seccion: req.params.nombre })
      .sort({ fecha: -1 })
      .limit(50)
      .lean();

    res.json({ success: true, noticias });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al obtener noticias' });
  }
});

// Buscar noticias
app.get('/buscar', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ success: true, noticias: [] });
    }

    const noticias = await Noticia.find({
      $or: [
        { titulo: { $regex: q, $options: 'i' } },
        { contenido: { $regex: q, $options: 'i' } }
      ]
    })
    .sort({ fecha: -1 })
    .limit(30)
    .lean();

    res.json({ success: true, noticias });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al buscar' });
  }
});

// ==================== API ADMIN (PROTEGIDAS POR PIN) ====================

// Publicar noticia
app.post('/publicar', async (req, res) => {
  try {
    const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;

    if (pin !== "311") {
      return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }

    if (!titulo || !seccion || !contenido) {
      return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
    }

    const noticia = new Noticia({
      titulo: titulo.trim(),
      seccion,
      contenido: contenido.trim(),
      ubicacion: ubicacion || '',
      redactor: redactor || 'mxl',
      imagen: imagen || null
    });

    await noticia.save();
    console.log('📰 Noticia publicada:', noticia.titulo);

    res.status(201).json({ success: true, noticia });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ success: false, error: 'Error al publicar' });
  }
});

// Actualizar noticia
app.put('/noticia/:id', async (req, res) => {
  try {
    const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;

    if (pin !== "311") {
      return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }

    const noticia = await Noticia.findByIdAndUpdate(
      req.params.id,
      {
        titulo: titulo.trim(),
        seccion,
        contenido: contenido.trim(),
        ubicacion: ubicacion || '',
        redactor: redactor || 'mxl',
        imagen: imagen || null,
        fechaActualizacion: new Date()
      },
      { new: true }
    );

    if (!noticia) {
      return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
    }

    res.json({ success: true, noticia });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al actualizar' });
  }
});

// Eliminar noticia
app.delete('/noticia/:id', async (req, res) => {
  try {
    const { pin } = req.body;

    if (pin !== "311") {
      return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }

    const noticia = await Noticia.findByIdAndDelete(req.params.id);
    if (!noticia) {
      return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
    }

    res.json({ success: true, message: 'Noticia eliminada' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al eliminar' });
  }
});

// ==================== API CONFIGURACIÓN ====================

// Obtener configuración
app.get('/api/configuracion', async (req, res) => {
  try {
    let config = await Configuracion.findOne();
    if (!config) {
      config = await Configuracion.create({});
    }
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al obtener configuración' });
  }
});

// Guardar configuración
app.post('/api/configuracion', async (req, res) => {
  try {
    const { config, pin } = req.body;

    if (pin !== "311") {
      return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    }

    let configuracion = await Configuracion.findOne();
    if (!configuracion) {
      configuracion = await Configuracion.create(config);
    } else {
      Object.assign(configuracion, config);
      configuracion.fechaActualizacion = new Date();
      await configuracion.save();
    }

    res.json({ success: true, config: configuracion });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al guardar configuración' });
  }
});

// ==================== API ESTADÍSTICAS ====================

app.get('/api/estadisticas', async (req, res) => {
  try {
    const totalNoticias = await Noticia.countDocuments();
    const totalVistas = await Noticia.aggregate([
      { $group: { _id: null, total: { $sum: '$vistas' } } }
    ]);
    
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    const noticiasHoy = await Noticia.countDocuments({
      fecha: { $gte: hoy }
    });

    res.json({
      success: true,
      totalNoticias,
      totalVistas: totalVistas[0]?.total || 0,
      noticiasHoy
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al obtener estadísticas' });
  }
});

// ==================== VERIFICACIÓN TOKEN ====================

app.post('/api/verificar-token', (req, res) => {
  const { token } = req.body;
  
  if (token === ADMIN_TOKEN_SECRETO) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// ==================== CIERRE CORREGIDO ====================

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║   🏮 BÚNKER 2.0 MOBILE-FIRST ACTIVADO 🏮          ║
╠════════════════════════════════════════════════════╣
║ 📱 Diseño: PULGAR-AMIGABLE                         ║
║ 💾 Auto-guardado: ACTIVADO                          ║
║ 📊 Google Analytics: LISTO                          ║
║ 🎬 Compresión: WebP/720p                           ║
║ 🏠 Puerto: ${PORT}                                   ║
╚════════════════════════════════════════════════════╝
  `);
});

// Cierre con promesas (CORREGIDO)
process.on('SIGTERM', async () => {
  console.log('\n⏹️ Cerrando servidor...');
  server.close(() => console.log('🔌 Servidor HTTP cerrado'));
  try {
    await mongoose.connection.close();
    console.log('📊 MongoDB cerrado');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('\n⏹️ Cerrando por Ctrl+C...');
  server.close(() => console.log('🔌 Servidor HTTP cerrado'));
  try {
    await mongoose.connection.close();
    console.log('📊 MongoDB cerrado');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
});

module.exports = app;
