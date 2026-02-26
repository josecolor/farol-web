const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());

// 1. CONEXIÓN MAESTRA: Usa la llave de Railway para evitar fallos de acceso
const mongoURI = process.env.MONGODB_URL || "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqnAgQhUz@mongodb.railway.internal:27017/farol?authSource=admin";

mongoose.connect(mongoURI)
  .then(() => console.log("🔥 Farol conectado con éxito"))
  .catch(err => console.error("❌ Error DB:", err));

// 2. MODELO DE NOTICIAS
const News = mongoose.model('News', new mongoose.Schema({
    title: String, 
    location: String, 
    content: String, 
    date: { type: Date, default: Date.now }
}));

// 3. CARPETA PÚBLICA: Servir todo desde la nueva ubicación 'client'
app.use(express.static(__dirname));

// 4. RUTAS PARA EL CELULAR
app.get('/api/news', async (req, res) => {
    try {
        const news = await News.find().sort({ date: -1 });
        res.json(news);
    } catch (e) { res.status(500).json([]); }
});

app.post('/api/news', async (req, res) => {
    try {
        const newReport = new News(req.body);
        await newReport.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Periódico vivo en puerto ${PORT}`));
