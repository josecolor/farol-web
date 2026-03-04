const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const app = express();

// Optimizamos para que el servidor no se sofoque
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());

// ENLACE DIRECTO (Copia esto tal cual, es tu búnker oficial)
const mongoURI = "mongodb://mongo:vSInmYfSIsYfXmRAsmYkUvUqFfIDVvWb@mongodb.railway.internal:27017";

mongoose.connect(mongoURI)
  .then(() => console.log('Búnker conectado con éxito ✅'))
  .catch(err => console.error('Error de conexión:', err));

const noticiaSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  contenido: { type: String, required: true },
  ubicacion: String,
  redactor: String,
  foto: String,
  fecha: { type: Date, default: Date.now }
});
const Noticia = mongoose.model('Noticia', noticiaSchema);

app.get('/redaccion', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'redaccion.html'));
});

app.post('/publicar', async (req, res) => {
  const { pin, titulo, contenido, ubicacion, redactor, imagen } = req.body;
  
  if (pin !== "311") return res.status(403).send("PIN incorrecto");

  try {
    const nuevaNoticia = new Noticia({ 
      titulo, contenido, ubicacion, redactor, foto: imagen 
    });
    await nuevaNoticia.save();
    console.log("🔥 Noticia publicada por: " + redactor);
    res.status(200).send("Publicado con éxito 🏮");
  } catch (error) {
    res.status(500).send("Error al guardar");
  }
});

app.get('/api/noticias', async (req, res) => {
  try {
    const noticias = await Noticia.find().sort({ fecha: -1 }).limit(20);
    res.json(noticias);
  } catch (error) {
    res.status(500).send("Error");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Puerto ${PORT} encendido. El Farol brilla 🏮🔥`));
