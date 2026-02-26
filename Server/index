// server/index.js
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
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Conexión a Base de Datos (Railway MongoDB)
const mongoURI = process.env.DATABASE_URL || 'mongodb://localhost:27017/farol';
mongoose.connect(mongoURI)
  .then(() => console.log('🔥 Conectado a la base de datos de Farol'))
  .catch(err => console.error('❌ Error DB:', err));

// Esquema de Noticias
const NewsSchema = new mongoose.Schema({
  title: String,
  location: String,
  content: String,
  imageUrl: String,
  date: { type: Date, default: Date.now }
});
const News = mongoose.model('News', NewsSchema);

// RUTAS API
app.get('/api/news', async (req, res) => {
  const news = await News.find().sort({ date: -1 });
  res.json(news);
});

app.post('/api/news', async (req, res) => {
  const newPost = new News(req.body);
  await newPost.save();
  res.json({ message: 'Publicado con éxito' });
});

// Servir el Frontend (Client)
app.use(express.static(path.join(__dirname, '../client')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Farol encendido en puerto ${PORT}`);
});
