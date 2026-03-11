const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// 🛠️ MANTENIENDO EL PODER: ASEGURAR TABLAS
async function asegurarTablas() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS noticias (
            id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
            seccion TEXT, contenido TEXT, seo_description TEXT,
            redactor TEXT, imagen TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);
        console.log('✅ Búnker: Base de datos blindada.');
    } catch (e) { console.log('❌ Error BD:', e.message); }
}

// 🎯 FUNCIÓN DE REDACCIÓN INTELIGENTE (RD STYLE)
async function redactarNoticiaIA(categoria) {
    try {
        const prompt = `Actúa como editor de El Farol al Día. Genera una noticia de ${categoria} en RD. 
        Formato: TITULO: [tit] ENTIDAD: [famoso] IMAGEN: [query ingles] DESC: [seo] CONTENIDO: [texto]`;
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const d = await resp.json();
        const t = d.candidates[0].content.parts[0].text;
        return {
            titulo: t.match(/TITULO:\s*(.*)/i)?.[1]?.trim() || "Noticia de Impacto",
            entidad: t.match(/ENTIDAD:\s*(.*)/i)?.[1]?.trim() || "",
            imageQuery: t.match(/IMAGEN:\s*(.*)/i)?.[1]?.trim() || categoria,
            descripcion: t.match(/DESC:\s*(.*)/i)?.[1]?.trim() || "Actualidad",
            contenido: t.split(/CONTENIDO:\s*/i)[1]?.trim() || "Desarrollando...",
            categoria
        };
    } catch (e) { return null; }
}

// 🖼️ LA REGLA DE ORO (IMÁGENES INTELIGENTES)
async function buscarImagenPro(data) {
    try {
        let q = data.entidad ? `${data.entidad} official` : data.imageQuery;
        if (process.env.PEXELS_API_KEY) {
            const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1`, {
                headers: { 'Authorization': process.env.PEXELS_API_KEY }
            });
            const d = await r.json();
            if (d.photos?.length > 0) return d.photos[0].src.landscape;
        }
        return 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg';
    } catch (e) { return 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg'; }
}

// 🌍 RUTAS Y PANEL
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/api/noticias', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias ORDER BY fecha DESC LIMIT 15');
    res.json({ success: true, noticias: r.rows });
});

app.post('/api/generar-noticia', async (req, res) => {
    const data = await redactarNoticiaIA(req.body.categoria);
    if (!data) return res.json({ success: false, error: "IA desconectada" });
    const img = await buscarImagenPro(data);
    const slug = data.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 55) + '-' + Date.now().toString().slice(-3);
    try {
        const resBD = await pool.query(
            'INSERT INTO noticias (titulo, slug, seccion, contenido, seo_description, redactor, imagen) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [data.titulo, slug, data.categoria, data.contenido, data.descripcion, 'IA Gemini', img]
        );
        res.json({ success: true, noticia: resBD.rows[0] });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get('/noticia/:slug', async (req, res) => {
    const r = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
    if (r.rows.length === 0) return res.status(404).send('No encontrada');
    const n = r.rows[0];
    let h = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
    h = h.replace(/{{TITULO}}/g, n.titulo).replace(/{{IMAGEN}}/g, n.imagen)
         .replace(/{{CONTENIDO}}/g, n.contenido.split('\n').map(p => `<p>${p}</p>`).join(''))
         .replace(/{{REDACTOR}}/g, n.redactor).replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(h);
});

async function start() {
    await asegurarTablas();
    app.listen(PORT, '0.0.0.0', () => console.log('🚀 BÚNKER FULL V10.6 ONLINE'));
}
start();
