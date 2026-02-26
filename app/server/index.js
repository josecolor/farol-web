const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());

// Servir archivos estáticos desde la raíz del proyecto
app.use(express.static(path.join(__dirname, '../../'))); 

// Conexión a MongoDB (Usa la variable de Railway)
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("🔥 Farol conectado correctamente"))
  .catch(err => console.error("❌ Error de conexión DB:", err));

// Esquema de Noticias
const News = mongoose.model('News', new mongoose.Schema({
    title: String, 
    location: String, 
    content: String, 
    date: { type: Date, default: Date.now }
}));

// API para obtener noticias
app.get('/api/news', async (req, res) => {
    try {
        const news = await News.find().sort({ date: -1 });
        res.json(news);
    } catch (error) {
        res.status(500).json({ error: "Error al cargar noticias" });
    }
});

// API para publicar noticias
app.post('/api/news', async (req, res) => {
    try {
        const newReport = new News(req.body);
        await newReport.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Error al guardar noticia" });
    }
});

// RUTAS PARA LAS PÁGINAS (Corregidas para buscar en la raíz)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../../admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Farol encendido en puerto ${PORT}`));
