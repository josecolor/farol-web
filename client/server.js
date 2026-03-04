const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const app = express();

// --- 1. CONFIGURACIÓN DE LÍMITES (Para fotos pesadas y videos) ---
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- 2. CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS ---
// Esto asegura que Railway encuentre tu carpeta "public" donde está el panel
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors());

// --- 3. CONEXIÓN A LA BASE DE DATOS ---
mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost/farol_db')
  .then(() => console.log('Búnker conectado a la base de datos ✅'))
  .catch(err => console.error('Error de conexión:', err));

// --- 4. ESQUEMA DE NOTICIAS ---
const noticiaSchema = new mongoose.Schema({
  titulo: String,
  contenido: String,
  ubicacion: String,
  redactor: String,
  foto: String, 
  fecha: { type: Date, default: Date.now }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);

// --- 5. RUTAS DE NAVEGACIÓN (Para que no de error "Cannot GET") ---
app.get('/redaccion', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'redaccion.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- 6. RUTA PARA PUBLICAR (Con PIN 311) ---
app.post('/noticias', async (req, res) => {
  const { pin, titulo, contenido, ubicacion, redactor, foto } = req.body;

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

app.get('/api/noticias', async (req, res) => {
  try {
    const noticias = await Noticia.find().sort({ fecha: -1 });
    res.json(noticias);
  } catch (error) {
    res.status(500).send("Error al obtener noticias");
  }
});

// --- 7. INICIAR SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Farol Al Día encendido en puerto ${PORT} 🏮🔥`);
});
