const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

// ================= CONEXIÓN MONGODB - CORREGIDA =================
// AHORA SOLO usa la variable de entorno, NO permite localhost
const mongodb = process.env.MONGO_URI;

if (!mongodb) {
    console.error('❌ ERROR CRÍTICO: MONGO_URI no está definida en Railway');
    console.error('👉 Ve a Railway Dashboard → Variables → Agrega MONGO_URI');
    process.exit(1);
}

console.log('📡 Conectando a MongoDB...');

mongoose.connect(mongodb, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('🟢 BÚNKER CONECTADO!');
  console.log('📱 Meta tags en servidor: ACTIVADO');
})
.catch(err => {
  console.error('❌ Error MongoDB:', err.message);
  process.exit(1);
});

// ================= ESQUEMAS =================
const noticiaSchema = new mongoose.Schema({
  titulo: { type: String, required: true, trim: true },
  seccion: {
    type: String,
    required: true,
    enum: ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía']
  },
  contenido: { type: String, required: true, trim: true },
  ubicacion: { type: String, default: '' },
  redactor: { type: String, default: 'mxl' },
  imagen: { type: String, default: null },
  vistas: { type: Number, default: 0 },
  fecha: { type: Date, default: Date.now }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);

// ================= RUTA PARA NOTICIAS =================
app.get('/noticia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).send('Noticia no encontrada');
    }

    const noticia = await Noticia.findById(id);
    
    if (!noticia) {
      return res.status(404).send('Noticia no encontrada');
    }

    noticia.vistas += 1;
    await noticia.save();

    const templatePath = path.join(__dirname, 'client', 'noticia-template.html');
    let html = fs.readFileSync(templatePath, 'utf8');
    
    const titulo = noticia.titulo.replace(/"/g, '&quot;');
    const descripcion = noticia.contenido.substring(0, 160).replace(/"/g, '&quot;').replace(/\n/g, ' ');
    const imagen = noticia.imagen || 'https://elfarolaldia.com/default-share.jpg';
    const url = `https://elfarolaldia.com/noticia/${id}`;
    const fecha = noticia.fecha.toISOString();
    const fechaFormateada = new Date(noticia.fecha).toLocaleDateString('es-DO', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const contenidoHTML = noticia.contenido.replace(/\n/g, '<br>');
    
    const esVideo = noticia.imagen && noticia.imagen.includes('video');
    
    html = html
      .replace(/{{TITULO}}/g, titulo)
      .replace(/{{DESCRIPCION}}/g, descripcion)
      .replace(/{{IMAGEN}}/g, imagen)
      .replace(/{{URL}}/g, url)
      .replace(/{{FECHA_ISO}}/g, fecha)
      .replace(/{{FECHA_FORMATEADA}}/g, fechaFormateada)
      .replace(/{{SECCION}}/g, noticia.seccion)
      .replace(/{{REDACTOR}}/g, noticia.redactor || 'Redacción')
      .replace(/{{CONTENIDO}}/g, contenidoHTML)
      .replace(/{{VISTAS}}/g, noticia.vistas || 0)
      .replace(/{{UBICACION}}/g, noticia.ubicacion || 'Santo Domingo');
    
    if (noticia.imagen) {
      if (esVideo) {
        html = html.replace('{{MULTIMEDIA}}', `<video class="noticia-imagen" src="${noticia.imagen}" controls></video>`);
      } else {
        html = html.replace('{{MULTIMEDIA}}', `<img class="noticia-imagen" src="${noticia.imagen}" alt="${titulo}">`);
      }
    } else {
      html = html.replace('{{MULTIMEDIA}}', '');
    }
    
    res.send(html);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error interno');
  }
});

// ================= RUTAS API =================
app.get('/noticias', async (req, res) => {
  try {
    const noticias = await Noticia.find().sort({ fecha: -1 }).limit(50).lean();
    res.json({ success: true, noticias });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error' });
  }
});

app.get('/seccion/:nombre', async (req, res) => {
  try {
    const noticias = await Noticia.find({ seccion: req.params.nombre }).sort({ fecha: -1 }).limit(50).lean();
    res.json({ success: true, noticias });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error' });
  }
});

app.post('/publicar', async (req, res) => {
  try {
    const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;
    
    if (pin !== "311") {
      return res.status(403).json({ success: false, error: 'PIN incorrecto' });
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
    res.status(201).json({ success: true, noticia });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error' });
  }
});

// ================= ARCHIVOS ESTÁTICOS =================
app.use(express.static(path.join(__dirname, 'client')));

// ================= INICIAR SERVIDOR =================
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`✅ Servidor en puerto ${PORT}`);
});

// Cierre correcto
process.on('SIGTERM', async () => {
  console.log('Cerrando...');
  server.close();
  await mongoose.connection.close();
  process.exit(0);
});

module.exports = app;
