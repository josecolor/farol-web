const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());
// Al estar en la raíz, el servidor ve todo lo que lo rodea
app.use(express.static(__dirname)); 

// CONEXIÓN AUTOMÁTICA (Usa la llave maestra de Railway)
const mongoURI = process.env.MONGODB_URL || "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqnAgQhUz@mongodb.railway.internal:27017/farol?authSource=admin";

mongoose.connect(mongoURI)
  .then(() => console.log("🔥 Farol conectado de raíz"))
  .catch(err => console.error("❌ Error DB:", err));

const News = mongoose.model('News', new mongoose.Schema({
    title: String, location: String, content: String, date: { type: Date, default: Date.now }
}));

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

// RUTAS DIRECTAS (Sin ../../ porque ya estamos en la raíz)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Periódico vivo en puerto ${PORT}`));

