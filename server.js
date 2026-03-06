/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR FINAL COMPLETO
 * Versión estable con rutas API y foto del periodista
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();

// ==================== CONFIGURACIÓN ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== CONEXIÓN MONGODB ====================
const MONGODB_URI = process.env.MONGO_URI || 
    "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqmAgQhUz@mongodb.railway.internal:27017";

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('🟢 BÚNKER CONECTADO A MONGODB!'))
.catch(err => console.error('❌ Error MongoDB:', err.message));

// ==================== ESQUEMAS ====================
const noticiaSchema = new mongoose.Schema({
    titulo: { type: String, required: true, trim: true },
    seccion: { type: String, required: true, enum: ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'] },
    contenido: { type: String, required: true, trim: true },
    ubicacion: { type: String, default: 'Santo Domingo' },
    redactor: { type: String, default: 'mxl' },
    redactorFoto: { type: String, default: null },
    imagen: { type: String, default: null },
    vistas: { type: Number, default: 0 },
    fecha: { type: Date, default: Date.now }
});

const usuarioSchema = new mongoose.Schema({
    nombre: String,
    email: { type: String, unique: true },
    password: String,
    fechaRegistro: { type: Date, default: Date.now }
});

const configuracionSchema = new mongoose.Schema({
    nombreSitio: { type: String, default: 'El Farol al Día' },
    tagline: { type: String, default: 'Diario Digital de Noticias en Vivo' },
    colorPrincipal: { type: String, default: '#FF8C00' },
    emailContacto: String,
    ubicacionSitio: String,
    descripcionSitio: String,
    facebook: String,
    instagram: String,
    twitter: String,
    whatsapp: String,
    telegram: String,
    whatsappCanal: String,
    amazonId: String,
    googleAdsense: String,
    stripeId: String,
    linkDonacion: String,
    googleAnalytics: String,
    mostrarVistas: { type: Boolean, default: true },
    metaKeywords: String,
    robotsTxt: String,
    googleVerification: String,
    activarOpenGraph: { type: Boolean, default: true }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);
const Usuario = mongoose.model('Usuario', usuarioSchema);
const Configuracion = mongoose.model('Configuracion', configuracionSchema);

// ==================== RUTAS DE PÁGINAS (HTML) ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/ajustes', (req, res) => res.sendFile(path.join(__dirname, 'client', 'ajustes.html')));
app.get('/noticia/:id', (req, res) => res.sendFile(path.join(__dirname, 'client', 'noticia.html')));

// ==================== RUTAS API ====================
app.get('/api/noticias', async (req, res) => {
    try {
        const noticias = await Noticia.find().sort({ fecha: -1 }).limit(30).lean();
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/noticias/:id', async (req, res) => {
    try {
        const noticia = await Noticia.findById(req.params.id).lean();
        if (!noticia) return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        noticia.vistas++;
        await Noticia.findByIdAndUpdate(req.params.id, { $inc: { vistas: 1 } });
        res.json({ success: true, noticia });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/seccion/:nombre', async (req, res) => {
    try {
        const secciones = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];
        if (!secciones.includes(req.params.nombre)) {
            return res.status(400).json({ success: false, error: 'Sección inválida' });
        }
        const noticias = await Noticia.find({ seccion: req.params.nombre }).sort({ fecha: -1 }).limit(50).lean();
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/configuracion', async (req, res) => {
    try {
        let config = await Configuracion.findOne();
        if (!config) config = await Configuracion.create({});
        res.json({ success: true, config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/estadisticas', async (req, res) => {
    try {
        const totalNoticias = await Noticia.countDocuments();
        const totalVistas = await Noticia.aggregate([{ $group: { _id: null, total: { $sum: '$vistas' } } }]);
        res.json({
            success: true,
            totalNoticias,
            totalVistas: totalVistas[0]?.total || 0
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;
        if (pin !== "311") return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        if (!titulo || !seccion || !contenido) return res.status(400).json({ success: false, error: 'Faltan campos' });
        
        const noticia = new Noticia({
            titulo: titulo.trim(),
            seccion,
            contenido: contenido.trim(),
            ubicacion: ubicacion?.trim() || 'Santo Domingo',
            redactor: redactor?.trim() || 'mxl',
            redactorFoto: redactorFoto || null,
            imagen: imagen || null
        });
        await noticia.save();
        res.status(201).json({ success: true, message: 'Publicado 🏮', id: noticia._id });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/configuracion', async (req, res) => {
    try {
        const { seccion, config, pin } = req.body;
        if (pin !== "311") return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        
        let configuracion = await Configuracion.findOne();
        if (!configuracion) configuracion = new Configuracion();
        Object.assign(configuracion, config);
        await configuracion.save();
        res.json({ success: true, message: 'Configuración guardada' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/noticias/:id', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;
        if (pin !== "311") return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        
        const noticia = await Noticia.findByIdAndUpdate(req.params.id, {
            titulo: titulo.trim(),
            seccion,
            contenido: contenido.trim(),
            ubicacion: ubicacion?.trim() || 'Santo Domingo',
            redactor: redactor?.trim() || 'mxl',
            redactorFoto: redactorFoto || null,
            imagen: imagen || null
        }, { new: true });
        if (!noticia) return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        res.json({ success: true, message: 'Actualizada ✏️' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/noticias/:id', async (req, res) => {
    try {
        const { pin } = req.body;
        if (pin !== "311") return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        
        const noticia = await Noticia.findByIdAndDelete(req.params.id);
        if (!noticia) return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        res.json({ success: true, message: 'Eliminada 🗑️' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== MANEJO DE ERRORES 404 ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR ====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Búnker encendido en puerto ${PORT}`);
});
