const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 311;

// Middleware
app.use(cors());
app.use(express.json());

// LA SOLUCIÓN: Ruta corregida para Railway
// Esto le dice al servidor que busque los archivos en la carpeta 'client'
app.use(express.static(path.join(__dirname, '../../client')));

// Conexión a Base de Datos
const mongoURI = process.env.DATABASE_URL; 
mongoose.connect(mongoURI)
  .then(() => console.log('🔥 Conectado a la base de datos de Farol'))
  .catch(err => console.error('❌ Error DB:', err));

// Rutas API (Ejemplo)
app.get('/api/news', async (req, res) => {
  res.json({ message: "API funcionando" });
});

// RUTA PRINCIPAL: Sirve el index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Farol encendido en puerto ${PORT}`);
});
