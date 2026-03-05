const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');

const app = express();

// 1. CONFIGURACIÓN DE PODER (50MB para tus videos y fotos)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'client')));

// 2. CONEXIÓN AL BÚNKER (MongoDB)
const MONGODB_URI = process.env.MONGO_URI || "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

mongoose.connect(MONGODB_URI)
  .then(() => console.log('🟢 BÚNKER CONECTADO A MONGODB'))
  .catch(err => console.error('❌ Error Mongo:', err));

// 3. EL "ALMA" DEL PERIÓDICO (Modelo de Noticia)
const noticiaSchema = new mongoose.Schema({
    titulo: String,
    seccion: String,
    contenido: String,
    ubicacion: String,
    redactor: { type: String, default: 'mxl' },
    redactorFoto: String,
    imagen: String, // Aquí se guarda la foto o video comprimido
    vistas: { type: Number, default: 0 },
    fecha: { type: Date, default: Date.now }
});
const Noticia = mongoose.model('Noticia', noticiaSchema);

// 4. RUTAS DE NAVEGACIÓN (Para que se vea la web)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/noticia/:id', (req, res) => res.sendFile(path.join(__dirname, 'client', 'noticia.html')));

// 5. RUTAS DE LA API (Para que la Redacción funcione)

// OBTENER NOTICIAS (Para la portada)
app.get('/noticias', async (req, res) => {
    const noticias = await Noticia.find().sort({ fecha: -1 }).limit(30);
    res.json({ success: true, noticias });
});

// PUBLICAR NOTICIA (El botón de tu redacción)
app.post('/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, imagen, redactorFoto, ubicacion } = req.body;
        if (pin !== "311") return res.status(403).json({ success: false, error: 'PIN INCORRECTO' });
        
        const nueva = new Noticia({ titulo, seccion, contenido, imagen, redactorFoto, ubicacion });
        await nueva.save();
        res.json({ success: true, message: '¡🏮 Publicado con éxito!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// BUSCAR POR SECCIÓN
app.get('/seccion/:nombre', async (req, res) => {
    const noticias = await Noticia.find({ seccion: req.params.nombre }).sort({ fecha: -1 });
    res.json({ success: true, noticias });
});

// 6. ENCENDER EL FAROL (Puerto Railway)
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════╗
    ║  🏮 EL FAROL AL DÍA        ║
    ║  ✅ SERVIDOR 100% COMPLETO ║
    ╚════════════════════════════╝
    `);
});
