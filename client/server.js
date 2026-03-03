const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();

// 1. CONFIGURACIÓN DE PUERTO (Prioridad Railway)
// Usamos 8080 para que el "tren" llegue a la estación sin problemas
const PORT = process.env.PORT || 8080; 

// 2. CONEXIÓN A LA BASE DE DATOS
// Usa la variable MONGODB_URL que configuramos hoy
const mongoURI = process.env.MONGODB_URL;

mongoose.connect(mongoURI)
    .then(() => console.log('🔥 Farol conectado con éxito a MongoDB'))
    .catch(err => console.error('❌ Error de conexión:', err));

// 3. MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. ARCHIVOS ESTÁTICOS
// Servimos el CSS, imágenes y JS del panel de redacción
app.use(express.static(path.join(__dirname, 'public')));

// 5. RUTAS DEL SISTEMA
// Ruta principal del periódico
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta del Panel de Redacción (Admin)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 6. LÓGICA DE PUBLICACIÓN (PIN 311)
app.post('/publicar', (req, res) => {
    const { titulo, contenido, pin } = req.body;
    
    // Verificación del PIN de seguridad que usted definió
    if (pin === "311") {
        console.log(`✅ Noticia publicada: ${titulo}`);
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
