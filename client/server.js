const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();
app.use(express.json());

// Conexión Maestra Railway
const mongoURI = process.env.MONGODB_URL || "mongodb://mongo:WUFwLOYlhqGOFXBiYxnUzqPGqnAgQhUz@mongodb.railway.internal:27017/farol?authSource=admin";
mongoose.connect(mongoURI).then(() => console.log("🔥 Farol conectado con éxito"));

// Servir archivos desde la misma carpeta
app.use(express.static(__dirname));

// Rutas de API y Navegación
app.get('/api/news', async (req, res) => { /* ... */ });
app.post('/api/news', async (req, res) => { /* ... */ });
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Periódico vivo en puerto ${PORT}`));
