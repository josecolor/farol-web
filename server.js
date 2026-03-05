/**
 * 🏮 EL FAROL AL DÍA - BÚNKER PRO 2.0
 * Servidor optimizado para móviles y despliegue en Railway
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// ==================== CONFIGURACIÓN DE PODER ====================
// Permitimos 50MB para que tus videos y fotos suban sin problemas
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Servir archivos de la carpeta 'client' (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'client')));

// ==================== CONEXIÓN AL BÚNKER (MongoDB) ====================
const MONGODB_URI = process.env.MONGO_URI || 
    "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('🟢 ¡BÚNKER CONECTADO A MONGODB!'))
.catch(err => console.error('❌ Error de conexión:', err));

// ==================== ESQUEMA DE NOTICIAS ====================
const noticiaSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    seccion: { type: String, required: true },
    contenido: { type: String, required: true },
    ubicacion: { type: String, default: 'Santo Domingo' },
    redactor: { type: String, default: 'mxl' },
    redactorFoto: { type: String, default: null },
    imagen: { type: String, default: null }, // Aquí va la foto o video base64
    vistas: { type: Number, default: 0 },
    fecha: { type: Date, default: Date.now }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);

// ==================== RUTAS DE NAVEGACIÓN (PÁGINAS) ====================

// 1. Portada
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// 2. Redacción
app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// 3. Noticia Individual
app.get('/noticia/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'noticia.html'));
});

// 4. Ajustes
app.get('/ajustes', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'ajustes.html'));
});

// ==================== RUTAS DE LA API (DATOS) ====================

// Obtener todas las noticias para la portada
app.get('/noticias', async (req, res) => {
    try {
        const noticias = await Noticia.find().sort({ fecha: -1 }).limit(30);
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Publicar noticia desde la redacción (PIN 311 obligatorio)
app.post('/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;
        
        if (pin !== "311") {
            return res.status(403).json({ success: false, error: 'PIN INCORRECTO' });
        }

        const nuevaNoticia = new Noticia({
            titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen
        });

        await nuevaNoticia.save();
        console.log('📰 Nueva noticia publicada:', titulo);
        res.status(201).json({ success: true, message: '¡Publicado con éxito en El Farol! 🏮' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener una noticia específica por ID
app.get('/api/noticia/:id', async (req, res) => {
    try {
        const noticia = await Noticia.findByIdAndUpdate(
            req.params.id, 
            { $inc: { vistas: 1 } }, 
            { new: true }
        );
        res.json({ success: true, noticia });
    } catch (error) {
        res.status(404).json({ success: false, error: 'Noticia no encontrada' });
    }
});

// ==================== INICIAR EL FAROL ====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║   🏮 EL FAROL AL DÍA - ACTIVO         ║
    ╠════════════════════════════════════════╣
    ║ ✅ Servidor en puerto: ${PORT}           ║
    ║ 🟢 Base de Datos: CONECTADA            ║
    ║ 🔐 Seguridad PIN 311: ACTIVA           ║
    ╚════════════════════════════════════════╝
    `);
});
