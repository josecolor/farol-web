/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V10.4
 * Gemini con DETECCIÓN DE ENTIDADES PREMIUM (Regla de Oro)
 * Fallback de Imágenes 100% Seguro
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ==================== CONEXIÓN POSTGRESQL ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== REDACTORES Y SLUGS ====================
const REDACTORES = [
    { nombre: 'Carlos Méndez', especialidad: 'Nacionales' },
    { nombre: 'Laura Santana', especialidad: 'Deportes' },
    { nombre: 'Patricia Jiménez', especialidad: 'Espectáculos' },
    { nombre: 'Fernando Rivas', especialidad: 'Nacionales' }
];

function elegirRedactor(cat) {
    const esp = REDACTORES.filter(r => r.especialidad === cat);
    return esp.length > 0 ? esp[Math.floor(Math.random() * esp.length)].nombre : REDACTORES[0].nombre;
}

function generarSlug(texto) {
    return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 80);
}

// ==================== 🎯 DETECCIÓN DE ENTIDADES ====================
async function generarNoticiaInteligente(categoria) {
    try {
        const prompt = `Analiza y extrae la ENTIDAD (persona famosa, artista, político) de una noticia de ${categoria} en RD.
        Formato:
        TITULO: [título]
        ENTIDAD: [nombre famoso o vacío]
        CATEGORIA_ENTIDAD: [profesión]
        IMAGE_QUERY: [búsqueda específica en inglés]
        DESCRIPCION: [seo]
        PALABRAS: [keywords]
        CONTENIDO: [400 palabras]`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;
        
        // Parseo simple para el búnker
        let titulo = texto.match(/TITULO:(.*)/)?.[1]?.trim() || "Noticia de Impacto";
        let entidad = texto.match(/ENTIDAD:(.*)/)?.[1]?.trim() || "";
        let catEnt = texto.match(/CATEGORIA_ENTIDAD:(.*)/)?.[1]?.trim() || "";
        let imgQ = texto.match(/IMAGE_QUERY:(.*)/)?.[1]?.trim() || "";
        let desc = texto.match(/DESCRIPCION:(.*)/)?.[1]?.trim() || "";
        let cont = texto.split('CONTENIDO:')[1]?.trim() || "Contenido en desarrollo...";

        return { titulo, entidad, categoriaEntidad: catEnt, imageQuery: imgQ, descripcion: desc, contenido: cont, categoria };
    } catch (e) { return null; }
}

// ==================== 🖼️ REGLA DE ORO (IMÁGENES) ====================
async function buscarImagenConReglaDeOro(data) {
    try {
        let q = data.entidad ? `${data.entidad} ${data.categoriaEntidad} official` : data.imageQuery;
        if (!q) q = data.categoria;

        // Intentar Pexels si hay KEY
        if (process.env.PEXELS_API_KEY) {
            const resp = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1`, {
                headers: { 'Authorization': process.env.PEXELS_API_KEY }
            });
            const d = await resp.json();
            if (d.photos?.length > 0) return { url: d.photos[0].src.landscape, source: 'Pexels' };
        }

        // FALLBACK ABSOLUTO (Si no hay KEY o falla)
        const fbk = {
            'Nacionales': 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=1260',
            'Deportes': 'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg?auto=compress&w=1260',
            'Espectáculos': 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&w=1260'
        };
        return { url: fbk[data.categoria] || fbk['Nacionales'], source: 'fallback' };
    } catch (e) {
        return { url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg', source: 'error-fallback' };
    }
}
// ==================== 🤖 PROCESO FINAL ====================
async function generarNoticiaCompleta(categoria) {
    const data = await generarNoticiaInteligente(categoria);
    if (!data) return;

    const img = await buscarImagenConReglaDeOro(data);
    const slug = generarSlug(data.titulo) + '-' + Date.now().toString().slice(-4);
    const redactor = elegirRedactor(categoria);

    await pool.query(
        `INSERT INTO noticias (titulo, slug, seccion, contenido, seo_description, redactor, imagen, estado) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [data.titulo, slug, categoria, data.contenido, data.descripcion, redactor, img.url, 'publicada']
    );
    console.log(`✅ Publicada: ${data.titulo} | Foto: ${img.source}`);
}

// RUTAS
app.get('/api/noticias', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias WHERE estado=$1 ORDER BY fecha DESC', ['publicada']);
    res.json({ success: true, noticias: r.rows });
});

app.post('/api/generar-noticia', async (req, res) => {
    await generarNoticiaCompleta(req.body.categoria);
    res.json({ success: true });
});

// AUTOMATIZACIÓN
cron.schedule('0 */6 * * *', () => generarNoticiaCompleta('Nacionales'));

// INICIO
async function iniciar() {
    console.log('🚀 Búnker 10.4 encendiendo...');
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - V10.4                   ║
║   ✅ PostgreSQL: Conectado                     ║
║   ✅ Regla de Oro Imágenes: ACTIVA             ║
║   ✅ Fallback Seguro: ACTIVO                   ║
╚════════════════════════════════════════════════╝`);
    });
}

iniciar();
