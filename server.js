/**
 * 🏮 EL FAROL AL DÍA - BÚNKER PRO 2.0 (VERSIÓN FINAL CORREGIDA)
 * Servidor optimizado para móviles y despliegue en Railway
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// ==================== CONFIGURACIÓN ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'client')));

// ==================== CONEXIÓN A MONGODB ====================
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

// ==================== RUTAS DE PÁGINAS (HTML) ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

app.get('/ajustes', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'ajustes.html'));
});

// Página individual de noticia
app.get('/noticia/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'noticia.html'));
});

// ==================== RUTAS API (JSON) ====================

// Obtener todas las noticias (para portada)
app.get('/api/noticias', async (req, res) => {
    try {
        const noticias = await Noticia.find().sort({ fecha: -1 }).limit(30).lean();
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener una noticia por ID (para página individual)
app.get('/api/noticias/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }
        const noticia = await Noticia.findById(id).lean();
        if (!noticia) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }
        // Incrementar vistas
        await Noticia.findByIdAndUpdate(id, { $inc: { vistas: 1 } });
        noticia.vistas = (noticia.vistas || 0) + 1;
        res.json({ success: true, noticia });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener noticias por sección
app.get('/api/seccion/:nombre', async (req, res) => {
    try {
        const secciones = ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía'];
        if (!secciones.includes(req.params.nombre)) {
            return res.status(400).json({ success: false, error: 'Sección inválida' });
        }
        const noticias = await Noticia.find({ seccion: req.params.nombre })
            .sort({ fecha: -1 }).limit(50).lean();
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Publicar nueva noticia
app.post('/api/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;
        if (pin !== "311") {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }
        if (!titulo || !seccion || !contenido) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
        }
        const nuevaNoticia = new Noticia({
            titulo: titulo.trim(),
            seccion,
            contenido: contenido.trim(),
            ubicacion: ubicacion?.trim() || 'Santo Domingo',
            redactor: redactor?.trim() || 'mxl',
            redactorFoto: redactorFoto || null,
            imagen: imagen || null
        });
        await nuevaNoticia.save();
        res.status(201).json({ success: true, message: 'Publicado 🏮', id: nuevaNoticia._id });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Editar noticia
app.put('/api/noticias/:id', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, redactorFoto, imagen } = req.body;
        if (pin !== "311") {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }
        const noticia = await Noticia.findByIdAndUpdate(id, {
            titulo: titulo.trim(),
            seccion,
            contenido: contenido.trim(),
            ubicacion: ubicacion?.trim() || 'Santo Domingo',
            redactor: redactor?.trim() || 'mxl',
            redactorFoto: redactorFoto || null,
            imagen: imagen || null,
            fechaActualizacion: new Date()
        }, { new: true });
        if (!noticia) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }
        res.json({ success: true, message: 'Actualizada ✏️' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Eliminar noticia
app.delete('/api/noticias/:id', async (req, res) => {
    try {
        const { pin } = req.body;
        if (pin !== "311") {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID inválido' });
        }
        const noticia = await Noticia.findByIdAndDelete(id);
        if (!noticia) {
            return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
        }
        res.json({ success: true, message: 'Eliminada 🗑️' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== MANEJO DE ERRORES (REDIRECCIÓN A PORTADA) ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR ====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 El Farol encendido en puerto ${PORT}`);
});
