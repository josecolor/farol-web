const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const app = express();

// OPTIMIZACIÓN 1: Bajamos el límite a 10MB porque con el compresor que te di, 
// las fotos ahora pesarán menos de 1MB. Esto protege la memoria RAM.
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());

// --- CONEXIÓN ---
const mongoURI = process.env.MONGO_URL || "mongodb://mongo:vSInmYfSIsYfXmRAsmYkUvUqFfIDVvWb@mongodb.railway.internal:27017";

// OPTIMIZACIÓN 2: Configuración de conexión más estable para evitar caídas
mongoose.connect(mongoURI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log('Búnker conectado con éxito ✅'))
  .catch(err => console.error('Error de conexión:', err));

const noticiaSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  contenido: { type: String, required: true },
  ubicacion: String,
  redactor: String,
  foto: String, // Aquí llegará la foto comprimida
  fecha: { type: Date, default: Date.now }
});
const Noticia = mongoose.model('Noticia', noticiaSchema);

app.get('/redaccion', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'redaccion.html'));
});

// Cambiamos la ruta a /publicar para que coincida con tu HTML
app.post('/publicar', async (req, res) => {
  const { pin, titulo, contenido, ubicacion, redactor, imagen } = req.body;
  
  if (pin !== "311") {
    return res.status(403).send("PIN incorrecto");
  }

  try {
    // OPTIMIZACIÓN 3: Solo guardamos si hay datos esenciales
    const nuevaNoticia = new Noticia({ 
      titulo, 
      contenido, 
      ubicacion, 
      redactor, 
      foto: imagen // Usamos 'imagen' que es como viene del HTML
    });
    
    await nuevaNoticia.save();
    console.log("Nueva noticia publicada por: " + redactor);
    res.status(200).send("Publicado con éxito 🏮");
  } catch (error) {
    console.error("Error al guardar noticia:", error);
    res.status(500).send("Error al guardar en el búnker");
  }
});

app.get('/api/noticias', async (req, res) => {
  try {
    // Solo traemos las últimas 20 noticias para no saturar el celular del lector
    const noticias = await Noticia.find().sort({ fecha: -1 }).limit(20);
    res.json(noticias);
  } catch (error) {
    res.status(500).send("Error al obtener noticias");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Puerto ${PORT} encendido 🏮🔥`));
