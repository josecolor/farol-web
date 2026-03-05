const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const app = express();

// Configuración para el celular
app.use(express.json({ limit: '15mb' })); 
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(cors());

// --- ESTO ES LO QUE ARREGLA EL ERROR ---
// Le decimos al servidor que tus archivos están en la carpeta 'client'
app.use(express.static(path.join(__dirname, 'client')));

// Conexión con tu clave maestra WUFwLOY...
const mongoURI = "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

mongoose.connect(mongoURI)
  .then(() => console.log('Búnker conectado con éxito ✅'))
  .catch(err => console.error('Error de conexión:', err));

const noticiaSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  contenido: { type: String, required: true },
  ubicacion: String,
  redactor: String,
  imagen: String, 
  fecha: { type: Date, default: Date.now }
});
const Noticia = mongoose.model('Noticia', noticiaSchema);

// RUTA PARA EL PANEL
app.get('/redaccion', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'redaccion.html')); 
});

// RUTA PARA LA PORTADA
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// APIs para noticias
app.post('/publicar', async (req, res) => {
  const { pin, titulo, contenido, ubicacion, redactor, imagen } = req.body;
  if (pin !== "311") return res.status(403).send("PIN incorrecto");
  try {
    const nuevaNoticia = new Noticia({ titulo, contenido, ubicacion, redactor, imagen });
    await nuevaNoticia.save();
    res.status(200).send("Publicado con éxito 🏮");
  } catch (error) {
    res.status(500).send("Error");
  }
});

app.get('/noticias', async (req, res) => {
  try {
    const noticias = await Noticia.find().sort({ fecha: -1 }).limit(20);
    res.json(noticias);
  } catch (error) {
    res.status(500).send("Error");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Puerto ${PORT} encendido. El Farol brilla 🏮🔥`));
