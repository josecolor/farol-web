const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());

// 1. Servir archivos desde la raíz principal
app.use(express.static(path.join(__dirname, '../../'))); 

// 2. Conexión Flexible (Prueba MONGO_URL, MONGODB_URI o la URL directa)
const mongoURI = process.env.MONGO_URL || process.env.MONGODB_URI || "mongodb://mongo:vYIDpXInHlXJvOnTjDkGZitZitWqAUnA@mongodb.railway.internal:27017";

mongoose.connect(mongoURI)
  .then(() => console.log("🔥 Farol conectado a MongoDB"))
  .catch(err => console.error("❌ Error de conexión DB:", err));

const News = mongoose.model('News', new mongoose.Schema({
    title: String, location: String, content: String, date: { type: Date, default: Date.now }
}));

// API
app.get('/api/news', async (req, res) => {
    const news = await News.find().sort({ date: -1 });
    res.json(news);
});

app.post('/api/news', async (req, res) => {
    const newReport = new News(req.body);
    await newReport.save();
    res.json({ success: true });
});

// 3. RUTAS DE PÁGINAS (Corregidas para Railway)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../../admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Farol encendido en puerto ${PORT}`));
