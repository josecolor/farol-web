const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
// Puerto 8080 verificado para el tren de Railway
const PORT = process.env.PORT || 8080; 

// 1. ACTIVACIÓN DE MULTIMEDIA Y SEGURIDAD
// Esto arregla los botones de fotos/videos y el cuadro de texto vacío
app.use(cors());
app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval'; img-src * data:; worker-src * blob:;");
    next();
});

// 2. CONEXIÓN A BASE DE DATOS (Verificada en logs)
mongoose.connect(process.env.MONGODB_URL)
    .then(() => console.log('🔥 Farol conectado con éxito a MongoDB'))
    .catch(err => console.error('❌ Error de conexión:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. RASTREADOR DE ARCHIVOS (Evita el error ENOENT / Not Found)
// Busca en todas las carpetas posibles del servidor
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'client', 'public')));
app.use(express.static(__dirname));

// 4. RUTAS CON BUSQUEDA TRIPLE
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
    // Asegura que el búnker de redacción abra sin importar la carpeta
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

// 5. PUBLICACIÓN OFICIAL (PIN 311)
app.post('/publicar', (req, res) => {
    const { titulo, pin } = req.body;
    // Su PIN secreto para seguridad del equipo
    if (pin === "311") {
        console.log(`✅ Noticia: ${titulo} - Lanzada por Director mxl`);
        res.status(200).send("Noticia en el aire 🔥");
    } else {
        console.log("⚠️ Intento de publicación fallido: PIN incorrecto");
        res.status(403).send("PIN incorrecto");
    }
});

// 6. ARRANQUE GLOBAL
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏮 El Farol brillando en puerto ${PORT}`);
});
