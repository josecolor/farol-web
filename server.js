/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V10.4
 * Gemini con DETECCIÓN DE ENTIDADES PREMIUM (Regla de Oro)
 * Fallback de Imágenes 100% Seguro + Rutas Completas
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

// ==================== REDACTORES Y LÓGICA ====================
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

// ==================== 🎯 GENERACIÓN INTELIGENTE ====================
async function generarNoticiaInteligente(categoria) {
    try {
        const prompt = `Analiza y extrae la ENTIDAD (famoso, artista, político) de una noticia de ${categoria} en RD.
        Formato: TITULO:, ENTIDAD:, CATEGORIA_ENTIDAD:, IMAGE_QUERY:, DESCRIPCION:, CONTENIDO:`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;
        
        return {
            titulo: texto.match(/TITULO:(.*)/)?.[1]?.trim() || "Noticia de Impacto",
            entidad: texto.match(/ENTIDAD:(.*)/)?.[1]?.trim() || "",
            categoriaEntidad: texto.match(/CATEGORIA_ENTIDAD:(.*)/)?.[1]?.trim() || "",
            imageQuery: texto.match(/IMAGE_QUERY:(.*)/)?.[1]?.trim() || "",
            descripcion: texto.match(/DESCRIPCION:(.*)/)?.[1]?.trim() || "",
            contenido: texto.split('CONTENIDO:')[1]?.trim() || "Contenido en desarrollo...",
            categoria
        };
    } catch (e) { return null; }
}

// ==================== 🖼️ REGLA DE ORO (IMÁGENES) ====================
async function buscarImagenConReglaDeOro(data) {
    try {
        let q = data.entidad ? `${data.entidad} ${data.categoriaEntidad} official` : data.imageQuery;
        if (!q) q = data.categoria;

        if (process.env.PEXELS_API_KEY) {
            const resp = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1`, {
                headers: { 'Authorization': process.env.PEXELS_API_KEY }
            });
            const d = await resp.json();
            if (d.photos?.length > 0) return { url: d.photos[0].src.landscape, source: 'Pexels' };
        }

        const fbk = {
            'Nacionales': 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=1260',
            'Deportes': 'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg?auto=compress&w=1260',
            'Espectáculos': 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&w=1260'
        };
        return { url: fbk[data.categoria] || fbk['Nacionales'], source: 'fallback' };
    } catch (e) {
        return { url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg', source: 'error' };
    }
}
// ==================== 🤖 PROCESO Y RUTAS ====================
async function generarNoticiaCompleta(categoria) {
    const data = await generarNoticiaInteligente(categoria);
    if (!data) return;
    const img = await buscarImagenConReglaDeOro(data);
    const slug = generarSlug(data.titulo) + '-' + Date.now().toString().slice(-4);
    await pool.query(
        `INSERT INTO noticias (titulo, slug, seccion, contenido, seo_description, redactor, imagen, estado) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [data.titulo, slug, categoria, data.contenido, data.descripcion, elegirRedactor(categoria), img.url, 'publicada']
    );
}

// --- RUTAS DE NAVEGACIÓN ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

app.get('/api/noticias', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 20', ['publicada']);
    res.json({ success: true, noticias: r.rows });
});

app.get('/noticia/:slug', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
        if (r.rows.length === 0) return res.status(404).send('No encontrada');
        const n = r.rows[0];
        let h = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
        h = h.replace(/{{TITULO}}/g, n.titulo).replace(/{{IMAGEN}}/g, n.imagen)
             .replace(/{{CONTENIDO}}/g, n.contenido.split('\n').map(p => `<p>${p}</p>`).join(''))
             .replace(/{{REDACTOR}}/g, n.redactor).replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO'));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(h);
    } catch (e) { res.status(500).send('Error'); }
});

app.post('/api/generar-noticia', async (req, res) => {
    await generarNoticiaCompleta(req.body.categoria);
    res.json({ success: true });
});

cron.schedule('0 */6 * * *', () => generarNoticiaCompleta('Nacionales'));

async function iniciar() {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - V10.4                   ║
║   ✅ Búnker Online | Rutas: /redaccion OK      ║
╚════════════════════════════════════════════════╝`);
    });
}
iniciar();
