const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

// Configuración de JSON para recibir noticias
app.use(express.json());

// 1. SERVIR ARCHIVOS: Al estar dentro de 'client', usamos __dirname directamente
app.use(express.static(__dirname)); 

// 2. CONEXIÓN MAESTRA: Usa la variable de entorno de Railway
const mongoURI = process.env.MONGODB_URL || "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqnAgQhUz@mongodb.railway.internal:27017/farol?authSource=admin";

mongoose.connect(mongoURI)
  .then(() => console.log("🔥 Farol conectado de raíz con éxito"))
  .catch(err => console.error("❌ Error DB:", err));

// 3. MODELO DE DATOS
const News = mongoose.model('News', new mongoose.Schema({
    title: String, 
    location: String, 
    content: String, 
    date: { type: Date, default: Date.now }
}));

// 4. RUTAS DE LA API
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

// 5. RUTAS DE NAVEGACIÓN (Arregladas para la carpeta client)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 6. ENCENDIDO (Puerto 3000 por defecto en Railway)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Periódico vivo en puerto ${PORT}`));
