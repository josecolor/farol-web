const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../'))); 

// CONEXIÓN INTERNA (La vía más rápida y segura en Railway)
const mongoURI = "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqnAgQhUz@mongodb.railway.internal:27017/test";

mongoose.connect(mongoURI)
  .then(() => console.log("🔥 Farol conectado con éxito"))
  .catch(err => console.error("❌ Error de conexión:", err));

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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../../index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../../admin.html')));

// Usamos el puerto estándar de Railway para evitar bloqueos
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Farol encendido en puerto ${PORT}`));
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../'))); 

// CONEXIÓN INTERNA (La vía más rápida y segura en Railway)
const mongoURI = "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqnAgQhUz@mongodb.railway.internal:27017/test";

mongoose.connect(mongoURI)
  .then(() => console.log("🔥 Farol conectado con éxito"))
  .catch(err => console.error("❌ Error de conexión:", err));

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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../../index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../../admin.html')));

// Usamos el puerto estándar de Railway para evitar bloqueos
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Farol encendido en puerto ${PORT}`));
