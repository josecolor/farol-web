/**
 * 🏮 EL FAROL AL DÍA - V10.6 LIGHT
 * Sistema de emergencia con Auto-reparación de tablas
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// 🛠️ FUNCIÓN PARA ASEGURAR QUE LA TABLA EXISTE
async function crearTablaSiNoExiste() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS noticias (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                seccion TEXT,
                contenido TEXT,
                seo_description TEXT,
                redactor TEXT,
                imagen TEXT,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado TEXT DEFAULT 'publicada'
            );
        `);
        console.log('✅ Base de Datos: Tabla "noticias" lista.');
    } catch (e) { console.error('❌ Error BD:', e.message); }
}

async function generarNoticiaIA(categoria) {
    try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: `Noticia corta de ${categoria} en RD. Formato: TITULO: [tit] CONTENIDO: [cont]` }] }] })
        });
        const d = await resp.json();
        const texto = d.candidates[0].content.parts[0].text;
        return {
            titulo: texto.match(/TITULO:\s*(.*)/i)?.[1]?.trim() || "Noticia Nueva",
            contenido: texto.split(/CONTENIDO:\s*/i)[1]?.trim() || "Contenido...",
            categoria
        };
    } catch (e) { return null; }
}
// 🤖 PUBLICACIÓN RÁPIDA
async function publicar(categoria) {
    const data = await generarNoticiaIA(categoria);
    if (!data) return { success: false, error: "Fallo de IA" };
    const slug = data.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50) + '-' + Date.now().toString().slice(-3);
    try {
        const res = await pool.query(
            `INSERT INTO noticias (titulo, slug, seccion, contenido, imagen) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [data.titulo, slug, categoria, data.contenido, 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg']
        );
        return { success: true, noticia: res.rows[0] };
    } catch (e) { return { success: false, error: e.message }; }
}

app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/api/noticias', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias ORDER BY fecha DESC LIMIT 10');
    res.json({ success: true, noticias: r.rows });
});
app.post('/api/generar-noticia', async (req, res) => {
    const r = await publicar(req.body.categoria);
    res.json(r);
});

// 🔥 ENCENDIDO CON REPARACIÓN
async function start() {
    await crearTablaSiNoExiste();
    app.listen(PORT, '0.0.0.0', () => {
        console.log('🚀 BÚNKER V10.6 ONLINE - MOTOR LIGERO');
    });
}
start();
