const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080; 

// 1. CONEXIÓN A BASE DE DATOS
mongoose.connect(process.env.MONGODB_URL)
    .then(() => console.log('🔥 Farol conectado con éxito a MongoDB'))
    .catch(err => console.error('❌ Error de conexión:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. EL RASTREADOR INTELIGENTE (Esto mata el error ENOENT)
// Buscamos en 'public', en 'client/public' y en la raíz al mismo tiempo
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'client', 'public')));
app.use(express.static(__dirname));

// 3. RUTAS CON BUSQUEDA TRIPLE
app.get('/', (req, res) => {
    const paths = [
        path.join(__dirname, 'public', 'index.html'),
        path.join(__dirname, 'client', 'public', 'index.html'),
        path.join(__dirname, 'index.html')
    ];
    res.sendFile(paths[0], err => {
        if (err) res.sendFile(paths[1], err2 => {
            if (err2) res.sendFile(paths[2], err3 => {
                if (err3) res.status(404).send("No se encuentra la portada.");
            });
        });
    });
});

app.get('/admin', (req, res) => {
    // Este bloque asegura que el panel de redacción CARGUE SÍ O SÍ
    const paths = [
        path.join(__dirname, 'public', 'admin.html'),
        path.join(__dirname, 'client', 'public', 'admin.html'),
        path.join(__dirname, 'admin.html')
    ];
    res.sendFile(paths[0], err => {
        if (err) res.sendFile(paths[1], err2 => {
            if (err2) res.sendFile(paths[2], err3 => {
                if (err3) res.status(404).send("Error: El búnker no aparece en el servidor.");
            });
        });
    });
});

// 4. PUBLICACIÓN (PIN 311)
app.post('/publicar', (req, res) => {
    const { titulo, pin } = req.body;
    if (pin === "311") {
        res.status(200).send("Noticia en el aire 🔥");
    } else {
        res.status(403).send("PIN incorrecto");
    }
});

// 5. ARRANQUE GLOBAL
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏮 El Farol brillando en puerto ${PORT}`);
});
