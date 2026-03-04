const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const app = express();

// --- CORRECCIÓN DE ERROR DE TAMAÑO DE FOTO ---
// Aumentamos el límite a 10mb para que soporte fotos de alta resolución
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
// ---------------------------------------------

app.use(cors());
app.use(express.static('public'));

// Conexión a MongoDB (Railway)
mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost/farol_db')
  .then(() => console.log('Búnker conectado a la base de datos'))
  .catch(err => console.error('Error de conexión:', err));

// Esquema de Noticias
const noticiaSchema = new mongoose.Schema({
  titulo: String,
  contenido: String,
  ubicacion: String,
  redactor: String,
  foto: String, // Aquí se guarda la imagen en Base64
  fecha: { type: Date, default: Date.now }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);

// Ruta para recibir noticias desde el panel
app.post('/noticias', async (req, res) => {
  const { pin, titulo, contenido, ubicacion, redactor, foto } = req.body;

  // Verificación de seguridad con su PIN 311
  if (pin !== "311") {
    return res.status(403).send("PIN incorrecto");
  }

  try {
    const nuevaNoticia = new Noticia({ titulo, contenido, ubicacion, redactor, foto });
    await nuevaNoticia.save();
    res.status(200).send("Noticia publicada con éxito en Farol Al Día 🏮");
  } catch (error) {
    res.status(500).send("Error al guardar en el búnker");
  }
});

// Ruta para mostrar las noticias en la web
app.get('/api/noticias', async (req, res) => {
  const noticias = await Noticia.find().sort({ fecha: -1 });
  res.json(noticias);
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Farol Al Día encendido en puerto ${PORT}`);
});
