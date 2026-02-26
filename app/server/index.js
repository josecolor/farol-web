const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());

// 1. ESTO ARREGLA EL ADMIN: Le dice al servidor que busque los archivos una carpeta más arriba
app.use(express.static(path.join(__dirname, '../../'))); 

const mongoURI = "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqnAgQhUz@mongodb.railway.internal:27017";

mongoose.connect(mongoURI, { dbName: 'farol_db' })
  .then(() => console.log("🔥 Farol conectado"))
  .catch(err => console.error("❌ Error DB:", err));

const News = mongoose.model('News', new mongoose.Schema({
    title: String, location: String, content: String, date: { type: Date, default: Date.now }
}));

// 2. RUTAS CORREGIDAS PARA QUE NO DEN "NOT FOUND"
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

// ESTO ES LO QUE ESTABA FALLANDO Y YA ESTÁ ARREGLADO:
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../../index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../../admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
