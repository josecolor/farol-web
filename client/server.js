const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const app = express();

// OPTIMIZACIÓN DE MEMORIA PARA RAILWAY
// Aceptamos hasta 10MB, suficiente para la foto comprimida que envía el celular
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());

// --- CONEXIÓN AUTOMÁTICA AL BÚNKER ---
// Usamos process.env.MONGO_URL para que Railway conecte solito sin errores de clave
const mongoURI = process.env.MONGO_URL;

mongoose.connect(mongoURI)
  .then(() => console.log('Búnker conectado con éxito ✅'))
  .catch(err => console.error('Error de conexión al búnker:', err));

// MODELO DE LA NOTICIA
const noticiaSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  contenido: { type: String, required: true },
  ubicacion: String,
  redactor: String,
  foto: String, // Aquí se guarda la imagen optimizada
  fecha: { type: Date, default: Date.now }
});
const Noticia = mongoose.model('Noticia', noticiaSchema);

// RUTAS
app.get('/redaccion', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'redaccion.html'));
});

// Esta ruta recibe los datos del formulario admin
app.post('/publicar', async (req, res) => {
  const { pin, titulo, contenido, ubicacion, redactor, imagen } = req.body;
  
  // Seguridad mxl: Solo el PIN 311 permite publicar
  if (pin !== "311") {
    return res.status(403).send("PIN incorrecto");
  }

  try {
    const nuevaNoticia = new Noticia({ 
      titulo, 
      contenido, 
      ubicacion, 
      redactor, 
      foto: imagen 
    });
    
    await nuevaNoticia.save();
    console.log("🔥 Noticia publicada con éxito por: " + redactor);
    res.status(200).send("Publicado con éxito 🏮");
  } catch (error) {
    console.error("Error al guardar:", error);
    res.status(500).send("Error al guardar en la base de datos");
  }
});

// Ruta para que la portada lea las noticias (limitamos a 20 para ahorrar datos)
app.get('/api/noticias', async (req, res) => {
  try {
    const noticias = await Noticia.find().sort({ fecha: -1 }).limit(20);
    res.json(noticias);
  } catch (error) {
    res.status(500).send("Error al obtener noticias");
  }
});

// PUERTO (Railway usa el que tenga disponible, normalmente 8080)
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Puerto ${PORT} encendido. El Farol brilla 🏮🔥`));
