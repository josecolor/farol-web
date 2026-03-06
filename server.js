/**
 * 🏮 EL FAROL AL DÍA - BÚNKER PRO 2.0 (FINAL CORREGIDO)
 * Servidor optimizado para móviles y despliegue en Railway
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// ==================== CONFIGURACIÓN DE PODER ====================
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// 1. SERVIR ARCHIVOS ESTÁTICOS
// Esto asegura que carguen el CSS y las imágenes
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
    imagen: { type: String, default: null }, 
    vistas: { type: Number, default: 0 },
    fecha: { type: Date, default: Date.now }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);

// ==================== RUTAS DE NAVEGACIÓN (BLINDADAS) ====================

// PORTADA (Si entras a elfarolaldia.com o elfarolaldia.com/ carga esto)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// REDACCIÓN
app.get('/redaccion*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// NOTICIA INDIVIDUAL
app.get('/noticia/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'noticia.html'));
});

// AJUSTES
app.get('/ajustes*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'ajustes.html'));
});

// ==================== RUTAS DE LA API (DATOS) ====================

app.get('/noticias', async (req, res) => {
    try {
        const noticias = await Noticia.find().sort({ fecha: -1 }).limit(30);
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;
        if (pin !== "311") return res.status(403).json({ success: false, error: 'PIN INCORRECTO' });
        
        const nuevaNoticia = new Noticia({ titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen });
        await nuevaNoticia.save();
        res.status(201).json({ success: true, message: '¡Publicado con éxito! 🏮' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== MANEJO DE ERRORES (EL ARREGLO DE LA PORTADA) ====================
// Si alguna ruta falla, lo mandamos a la portada en lugar de mostrar error JSON
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR EL FAROL ====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 El Farol encendido en puerto ${PORT}`);
});
