const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
// Railway nos obliga a usar el puerto que ellos digan, casi siempre 8080
const PORT = process.env.PORT || 8080; 

// 1. CONEXIÓN SEGURA A LA BASE DE DATOS
mongoose.connect(process.env.MONGODB_URL)
    .then(() => console.log('🔥 Farol conectado con éxito a MongoDB'))
    .catch(err => console.error('❌ Error de conexión:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. EL ARREGLO MAESTRO PARA LOS ARCHIVOS (Soluciona el error ENOENT)
// Buscamos en todas las rutas posibles para que nunca diga "Not Found"
const publicPath = path.join(__dirname, 'public');
const rootPath = __dirname;
const clientPublicPath = path.join(__dirname, 'client', 'public');

app.use(express.static(publicPath));
app.use(express.static(rootPath));
app.use(express.static(clientPublicPath));

// 3. RUTAS INTELIGENTES
app.get('/', (req, res) => {
    // Intenta cargar la portada desde cualquier ubicación
    res.sendFile(path.join(publicPath, 'index.html'), err => {
        if (err) res.sendFile(path.join(rootPath, 'index.html'), err2 => {
            if (err2) res.status(404).send("Error: No se encuentra la portada del periódico.");
        });
    });
});

app.get('/admin', (req, res) => {
    // Esto es lo que fallaba antes. Ahora busca en 3 sitios distintos.
    res.sendFile(path.join(publicPath, 'admin.html'), err => {
        if (err) {
            res.sendFile(path.join(clientPublicPath, 'admin.html'), err2 => {
                if (err2) {
                    res.sendFile(path.join(rootPath, 'admin.html'), err3 => {
                        if (err3) res.status(404).send("Error: El panel de redacción no está en el servidor.");
                    });
                }
            });
        }
    });
});

// 4. PUBLICACIÓN CON SU PIN 311
app.post('/publicar', (req, res) => {
    const { titulo, pin } = req.body;
    if (pin === "311") {
        console.log(`✅ Noticia: ${titulo} - Publicada por Director mxl`);
        res.status(200).send("Noticia en el aire 🔥");
    } else {
        res.status(403).send("PIN de seguridad incorrecto");
    }
});

// 5. ARRANQUE GLOBAL
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏮 El Farol brillando en puerto ${PORT}`);
});
