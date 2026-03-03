const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();

// 1. CONFIGURACIÓN DE PUERTO
const PORT = process.env.PORT || 8080; 

// 2. CONEXIÓN A LA BASE DE DATOS
const mongoURI = process.env.MONGODB_URL;

mongoose.connect(mongoURI)
    .then(() => console.log('🔥 Farol conectado con éxito a MongoDB'))
    .catch(err => console.error('❌ Error de conexión:', err));

// 3. MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. ARCHIVOS ESTÁTICOS (Rastreador Flexible)
// Esto busca los archivos CSS/JS tanto en 'public' como en la raíz
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// 5. RUTAS DEL SISTEMA (Con corrector de rutas para evitar el Error ENOENT)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
        if (err) res.sendFile(path.join(__dirname, 'index.html'));
    });
});

app.get('/admin', (req, res) => {
    // Si falla al buscar en /public/admin.html, intenta en la raíz /admin.html
    res.sendFile(path.join(__dirname, 'public', 'admin.html'), err => {
        if (err) {
            res.sendFile(path.join(__dirname, 'admin.html'), err2 => {
                if (err2) {
                    console.error("❌ Error: No se encontró admin.html en ninguna carpeta.");
                    res.status(404).send("El búnker de redacción no fue encontrado en el servidor.");
                }
            });
        }
    });
});

// 6. LÓGICA DE PUBLICACIÓN (PIN 311)
app.post('/publicar', (req, res) => {
    const { titulo, contenido, pin } = req.body;
    
    if (pin === "311") {
        console.log(`✅ Noticia publicada con éxito: ${titulo}`);
        res.status(200).send("Noticia en el aire 🔥");
    } else {
        console.log("⚠️ Intento de publicación con PIN incorrecto");
        res.status(403).send("PIN de seguridad inválido");
    }
});

// 7. ARRANQUE DEL SERVIDOR
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏮 El Farol está brillando en el puerto ${PORT}`);
});
