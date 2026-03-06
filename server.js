/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR FINAL COMPLETO PRO v2.1
 * Versión Ultra-Estable con Inyección de Metaetiquetas SSR
 * Optimizado para Railway y MongoDB
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// ==================== CONFIGURACIÓN INICIAL ====================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== CONEXIÓN A MONGODB (VERSIÓN ESTABLE) ====================
// Prioriza la variable MONGO_URL que configuramos en el Paso 1
const MONGODB_URI = process.env.MONGO_URL || process.env.MONGO_URI || "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    family: 4,                     // Fuerza IPv4 para evitar errores de red
    maxPoolSize: 10,               // Mantiene pocas conexiones para ahorrar RAM
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => console.log('🟢 ¡BÚNKER CONECTADO A MONGODB!'))
.catch(err => console.error('❌ Error de conexión:', err.message));

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

const configuracionSchema = new mongoose.Schema({
    nombreSitio: { type: String, default: 'El Farol al Día' },
    googleVerification: String,
    googleAnalytics: String,
    fechaActualizacion: { type: Date, default: Date.now }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);
const Configuracion = mongoose.model('Configuracion', configuracionSchema);

// ==================== INYECCIÓN DE METAETIQUETAS (EL TRUCO DE GOOGLE) ====================
async function inyectarMetaTags(html) {
    try {
        const config = await Configuracion.findOne();
        if (config && config.googleVerification) {
            // Limpiamos el código por si el usuario pegó la etiqueta completa
            let code = config.googleVerification;
            if (code.includes('content="')) {
                code = code.split('content="')[1].split('"')[0];
            }
            const metaTag = `<meta name="google-site-verification" content="${code}" />`;
            return html.replace('', metaTag);
        }
        return html.replace('', '');
    } catch (error) {
        return html;
    }
}

// ==================== RUTAS DE PÁGINAS ====================
app.get('/', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'client', 'index.html');
        let html = fs.readFileSync(filePath, 'utf8');
        html = await inyectarMetaTags(html);
        res.send(html);
    } catch (e) { res.status(500).send("Error en el Búnker"); }
});

app.get('/noticia/:id', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'client', 'noticia.html');
        let html = fs.readFileSync(filePath, 'utf8');
        html = await inyectarMetaTags(html);
        res.send(html);
    } catch (e) { res.status(500).send("Error en la Noticia"); }
});

// Rutas directas para el resto
app.get('/ajustes', (req, res) => res.sendFile(path.join(__dirname, 'client', 'ajustes.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

// ==================== API ====================
app.get('/api/configuracion', async (req, res) => {
    let config = await Configuracion.findOne() || await Configuracion.create({});
    res.json({ success: true, config });
});

app.post('/api/configuracion', async (req, res) => {
    if (req.body.pin !== "311") return res.status(403).json({ error: 'PIN incorrecto' });
    const { pin, ...data } = req.body;
    await Configuracion.findOneAndUpdate({}, data, { upsert: true });
    res.json({ success: true });
});

app.get('/api/noticias', async (req, res) => {
    const noticias = await Noticia.find().sort({ fecha: -1 }).limit(20);
    res.json({ success: true, noticias });
});

// ==================== INICIAR ====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🏮 Búnker en puerto ${PORT}`));
