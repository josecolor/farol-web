const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// 1. Configuración de Base de Datos Blindada
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// 2. Reparación Automática de Tablas
async function asegurarTablas() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS noticias (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                seccion TEXT,
                contenido TEXT,
                imagen TEXT,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Base de datos lista.');
    } catch (e) { console.log('❌ Error BD:', e.message); }
}

// 3. Motor de Inteligencia Artificial
async function generarConIA(categoria) {
    try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: `Genera una noticia de ${categoria} en RD. Formato: TITULO: [tit] CONTENIDO: [cont]` }] }] })
        });
        const d = await resp.json();
        const texto = d.candidates[0].content.parts[0].text;
        return {
            titulo: texto.match(/TITULO:\s*(.*)/i)?.[1]?.trim() || "Noticia de Impacto",
            contenido: texto.split(/CONTENIDO:\s*/i)[1]?.trim() || "Contenido en desarrollo...",
            categoria
        };
    } catch (e) { return null; }
}

// 4. Rutas del Periódico
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

app.get('/api/noticias', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias ORDER BY fecha DESC LIMIT 10');
    res.json({ success: true, noticias: r.rows });
});

app.post('/api/generar-noticia', async (req, res) => {
    const data = await generarConIA(req.body.categoria);
    if (!data) return res.json({ success: false, error: "IA no responde" });
    
    const slug = data.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50) + '-' + Date.now().toString().slice(-3);
    
    try {
        const resBD = await pool.query(
            'INSERT INTO noticias (titulo, slug, seccion, contenido, imagen) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [data.titulo, slug, data.categoria, data.contenido, 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg']
        );
        res.json({ success: true, noticia: resBD.rows[0] });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// 5. Encendido Maestro
async function start() {
    await asegurarTablas();
    app.listen(PORT, '0.0.0.0', () => {
        console.log('🚀 BÚNKER V10.6 ONLINE');
    });
}
start();
