/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR FINAL COMPLETO
 * Versión optimizada para despliegue en Railway
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();

// ==================== CONFIGURACIÓN INICIAL ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Servir archivos estáticos desde la carpeta 'client'
app.use(express.static(path.join(__dirname, 'client')));

// ==================== HEALTH CHECK PARA RAILWAY ====================
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// ==================== CONEXIÓN A MONGODB ====================
const MONGODB_URI = process.env.MONGO_URI || 
    "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('🟢 BÚNKER CONECTADO A MONGODB'))
.catch(err => console.error('❌ Error de conexión:', err));

// ==================== ESQUEMAS ====================
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

const configuracionSchema = new mongoose.Schema({
    nombreSitio: { type: String, default: 'El Farol al Día' },
    tagline: { type: String, default: 'Diario Digital de Noticias en Vivo' },
    colorPrincipal: { type: String, default: '#FF8C00' }
});

const Configuracion = mongoose.model('Configuracion', configuracionSchema);

// ==================== RUTAS DE NAVEGACIÓN (PÁGINAS) ====================

// PORTADA PRINCIPAL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// REDACCIÓN
app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// AJUSTES
app.get('/ajustes', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'ajustes.html'));
});

// ==================== RUTAS DE LA API (DATOS) ====================

// Obtener todas las noticias
app.get('/noticias', async (req, res) => {
    try {
        const noticias = await Noticia.find().sort({ fecha: -1 }).limit(50);
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Publicar noticia (PIN 311)
app.post('/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, imagen } = req.body;
        if (pin !== "311") return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        
        const nuevaNoticia = new Noticia({ titulo, seccion, contenido, imagen });
        await nuevaNoticia.save();
        res.status(201).json({ success: true, message: 'Publicado 🏮' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener configuración
app.get('/api/configuracion', async (req, res) => {
    try {
        let config = await Configuracion.findOne();
        if (!config) config = await Configuracion.create({});
        res.json({ success: true, config });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// ==================== INICIAR SERVIDOR ====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
});
