// server.js - VERSIÓN SIMPLIFICADA PARA RAILWAY
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'client')));

// HEALTH CHECK - CRÍTICO PARA RAILWAY
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/noticias', async (req, res) => {
    try {
        const noticias = await db.getNoticias();
        res.json({ success: true, noticias });
    } catch(e) {
        res.json({ success: true, noticias: [] });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Iniciar servidor
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor corriendo en puerto ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

// Inicializar BD
db.inicializarDB();

module.exports = app;
