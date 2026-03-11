/**
 * 🏮 EL FAROL AL DÍA - V10.5 DEFINITIVA
 * Sistema Blindado contra errores de Redacción
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

// 🎯 GENERADOR DE NOTICIAS BLINDADO
async function generarNoticiaInteligente(categoria) {
    try {
        const prompt = `Genera una noticia de ${categoria} en RD. Responde SOLO con este formato:
        TITULO: [texto]
        ENTIDAD: [nombre]
        DESC: [resumen]
        CONTENIDO: [texto largo]`;

        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const d = await resp.json();
        const texto = d.candidates[0].content.parts[0].text;
        
        return {
            titulo: texto.match(/TITULO:\s*(.*)/i)?.[1]?.trim() || "Noticia de Impacto",
            descripcion: texto.match(/DESC:\s*(.*)/i)?.[1]?.trim() || "Actualidad en RD",
            contenido: texto.split(/CONTENIDO:\s*/i)[1]?.trim() || "Información en desarrollo...",
            categoria
        };
    } catch (e) { return null; }
}

async function buscarImagen(cat) {
    return 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&w=1260';
}
// 🤖 PROCESO DE PUBLICACIÓN
async function publicarNoticia(categoria) {
    const data = await generarNoticiaInteligente(categoria);
    if (!data) return { success: false, error: "IA desconectada" };

    const img = await buscarImagen(categoria);
    const slug = data.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60) + '-' + Date.now().toString().slice(-4);

    try {
        const res = await pool.query(
            `INSERT INTO noticias (titulo, slug, seccion, contenido, seo_description, redactor, imagen, estado) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [data.titulo, slug, categoria, data.contenido, data.descripcion, 'IA Gemini', img, 'publicada']
        );
        return { success: true, noticia: res.rows[0] };
    } catch (e) { return { success: false, error: e.message }; }
}

// 🌍 RUTAS
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

app.get('/api/noticias', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias ORDER BY fecha DESC LIMIT 15');
    res.json({ success: true, noticias: r.rows });
});

app.post('/api/generar-noticia', async (req, res) => {
    const resultado = await publicarNoticia(req.body.categoria);
    res.json(resultado);
});

app.get('/noticia/:slug', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
    if (r.rows.length === 0) return res.status(404).send('No encontrada');
    const n = r.rows[0];
    let h = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
    h = h.replace(/{{TITULO}}/g, n.titulo).replace(/{{IMAGEN}}/g, n.imagen)
         .replace(/{{CONTENIDO}}/g, n.contenido.split('\n').map(p => `<p>${p}</p>`).join(''))
         .replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO'));
    res.send(h);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 BÚNKER V10.5 ONLINE - TODO REPARADO');
});
