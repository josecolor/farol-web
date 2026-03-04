const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const app = express();

// --- 1. LÍMITES DE TAMAÑO ---
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors());

// --- 2. CONEXIÓN CORREGIDA (Aquí estaba el fallo) ---
// Forzamos a que use siempre la URL de Railway y no el localhost
const mongoURI = process.env.MONGO_URL;

mongoose.connect(mongoURI)
  .then(() => console.log('Búnker conectado a MongoDB con éxito ✅'))
  .catch(err => console.error('Error de conexión:', err));

// --- 3. ESQUEMA ---
const noticiaSchema = new mongoose.Schema({
  titulo: String, contenido: String, ubicacion: String, redactor: String, foto: String,
  fecha: { type: Date, default: Date.now }
});
const Noticia = mongoose.model('Noticia', noticiaSchema);

// --- 4. RUTAS DE NAVEGACIÓN ---
app.get('/redaccion', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'redaccion.html'));
});

// --- 5. PUBLICAR (PIN 311) ---
app.post('/noticias', async (req, res) => {
  const { pin, titulo, contenido, ubicacion, redactor, foto } = req.body;
  if (pin !== "311") return res.status(403).send("PIN incorrecto");
  try {
    const nuevaNoticia = new Noticia({ titulo, contenido, ubicacion, redactor, foto });
    await nuevaNoticia.save();
    res.status(200).send("Publicado con éxito 🏮");
  } catch (error) {
    res.status(500).send("Error al guardar");
  }
});

app.get('/api/noticias', async (req, res) => {
  const noticias = await Noticia.find().sort({ fecha: -1 });
  res.json(noticias);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Puerto ${PORT} encendido 🏮`));
