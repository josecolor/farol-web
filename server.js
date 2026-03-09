/**
 * 🏮 EL FAROL AL DÍA - VERSIÓN POSTGRESQL (NEON)
 * SIN MONGODB - SIN REDIS - SIN BULLMQ - GRATIS
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// ==================== CONEXIÓN A POSTGRESQL ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ==================== MIDDLEWARE ====================
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== RATE LIMITING ====================
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Demasiadas peticiones' }
});
app.use('/api/', apiLimiter);

// ==================== CREAR TABLA ====================
async function inicializarBase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS noticias (
      id SERIAL PRIMARY KEY,
      titulo VARCHAR(255) NOT NULL,
      seccion VARCHAR(100) NOT NULL,
      contenido TEXT NOT NULL,
      ubicacion VARCHAR(100) DEFAULT 'Santo Domingo',
      redactor VARCHAR(100) DEFAULT 'IA Gemini',
      imagen TEXT DEFAULT '/default-news.jpg',
      vistas INTEGER DEFAULT 0,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      estado VARCHAR(50) DEFAULT 'publicada',
      seo_desc TEXT,
      url VARCHAR(255) UNIQUE,
      categoria_slug VARCHAR(100)
    );
  `;
  
  try {
    await pool.query(createTableQuery);
    console.log('✅ Tabla lista');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// ==================== FUNCIÓN SLUG ====================
function generarSlug(texto) {
    return texto
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ==================== RUTAS ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// ==================== API ====================
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT 30',
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== GENERAR NOTICIA (BOTÓN) ====================
app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

    try {
        const prompt = `Genera una noticia sobre ${categoria} en RD. 
        Responde SOLO con JSON: {"titulo": "...", "contenido": "..."}`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            }
        );

        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;
        const jsonMatch = texto.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) throw new Error('JSON no válido');
        
        const noticia = JSON.parse(jsonMatch[0]);
        const slug = generarSlug(noticia.titulo);
        const url = `/noticia/${slug}`;
        
        const result = await pool.query(
            `INSERT INTO noticias (titulo, seccion, contenido, redactor, url, categoria_slug)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [noticia.titulo, categoria, noticia.contenido, 'IA Gemini', url, slug]
        );

        res.json({ success: true, message: '✅ Noticia generada', id: result.rows[0].id });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== INICIAR ====================
async function iniciar() {
    await inicializarBase();
    app.listen(PORT, () => {
        console.log(`✅ Servidor en puerto ${PORT} - SIN MONGODB`);
    });
}

iniciar();
module.exports = app;
