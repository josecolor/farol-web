/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V10.4 FINAL
 * Gemini con DETECCIÓN DE ENTIDADES + PARSEO BLINDADO
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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

const REDACTORES = [
    { nombre: 'Carlos Méndez', especialidad: 'Nacionales' },
    { nombre: 'Patricia Jiménez', especialidad: 'Espectáculos' }
];

function generarSlug(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 80);
}

// 🎯 GENERADOR CON EXTRACCIÓN DE DATOS MEJORADA
async function generarNoticiaInteligente(categoria) {
    try {
        const prompt = `Actúa como editor de El Farol al Día. Genera una noticia de ${categoria} en RD. 
        IMPORTANTE: Responde EXACTAMENTE con este formato:
        TITULO: [Escribe el título aquí]
        ENTIDAD: [Nombre de famoso o vacío]
        IMAGEN: [Búsqueda en inglés]
        DESC: [Resumen SEO]
        CONTENIDO: [Cuerpo de la noticia]`;

        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const d = await resp.json();
        const texto = d.candidates[0].content.parts[0].text;
        
        // Extracción segura para evitar el "undefined"
        const titulo = texto.match(/TITULO:\s*(.*)/i)?.[1]?.trim() || "Noticia de Impacto";
        const entidad = texto.match(/ENTIDAD:\s*(.*)/i)?.[1]?.trim() || "";
        const imageQuery = texto.match(/IMAGEN:\s*(.*)/i)?.[1]?.trim() || categoria;
        const descripcion = texto.match(/DESC:\s*(.*)/i)?.[1]?.trim() || titulo;
        const contenido = texto.split(/CONTENIDO:\s*/i)[1]?.trim() || "Contenido en desarrollo...";

        return { titulo, entidad, imageQuery, descripcion, contenido, categoria };
    } catch (e) { return null; }
}

// 🖼️ BUSCADOR CON FALLBACK ABSOLUTO
async function buscarImagen(data) {
    try {
        let q = data.entidad ? `${data.entidad} official` : data.imageQuery;
        if (process.env.PEXELS_API_KEY) {
            const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1`, {
                headers: { 'Authorization': process.env.PEXELS_API_KEY }
            });
            const res = await r.json();
            if (res.photos?.length > 0) return { url: res.photos[0].src.landscape, source: 'Pexels' };
        }
        return { url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg', source: 'fallback' };
    } catch (e) { return { url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg', source: 'error' }; }
}
// 🤖 PROCESO DE PUBLICACIÓN CORREGIDO
async function generarNoticiaCompleta(categoria) {
    const data = await generarNoticiaInteligente(categoria);
    if (!data) return { success: false, mensaje: "Error en IA" };

    const imgData = await buscarImagen(data);
    const slug = generarSlug(data.titulo) + '-' + Date.now().toString().slice(-4);

    const res = await pool.query(
        `INSERT INTO noticias (titulo, slug, seccion, contenido, seo_description, redactor, imagen, estado) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [data.titulo, slug, categoria, data.contenido, data.descripcion, REDACTORES[0].nombre, imgData.url, 'publicada']
    );
    
    return { 
        success: true, 
        titulo: res.rows[0].titulo, 
        slug: res.rows[0].slug,
        fuente_imagen: imgData.source 
    };
}

// 🌍 RUTAS DEL BÚNKER
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

app.get('/api/noticias', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias ORDER BY fecha DESC LIMIT 20');
    res.json({ success: true, noticias: r.rows });
});

app.get('/noticia/:slug', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
    if (r.rows.length === 0) return res.status(404).send('Noticia no encontrada');
    const n = r.rows[0];
    let h = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
    h = h.replace(/{{TITULO}}/g, n.titulo).replace(/{{IMAGEN}}/g, n.imagen)
         .replace(/{{CONTENIDO}}/g, n.contenido.split('\n').map(p => `<p>${p}</p>`).join(''))
         .replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO'));
    res.send(h);
});

app.post('/api/generar-noticia', async (req, res) => {
    const result = await generarNoticiaCompleta(req.body.categoria);
    res.json(result);
});

// 🔥 DESPEGUE
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - V10.4 FINAL    ║
║   ✅ Títulos y Slugs: CORREGIDOS      ║
║   ✅ Redacción: /redaccion OK         ║
╚═══════════════════════════════════════╝`);
});
