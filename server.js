/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V24.1 (RECONSTRUCCIÓN TOTAL)
 * Blindado contra error "imagen_caption" y "Cannot GET /noticia"
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// ==================== BD ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(express.static(path.join(__dirname, 'images')));
app.use(cors());

// ==================== AUTO-REPARACIÓN BD ====================
async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Reparando base de datos...');
        await client.query(`CREATE TABLE IF NOT EXISTS noticias (
            id SERIAL PRIMARY KEY,
            titulo VARCHAR(255) NOT NULL,
            slug VARCHAR(255) UNIQUE,
            seccion VARCHAR(100),
            contenido TEXT,
            redactor VARCHAR(100),
            imagen TEXT,
            vistas INTEGER DEFAULT 0,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            estado VARCHAR(50) DEFAULT 'publicada'
        )`);
        
        // ESTO ARREGLA EL ERROR ROJO
        await client.query(`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS imagen_caption TEXT`);
        await client.query(`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS imagen_nombre VARCHAR(100)`);
        await client.query(`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS imagen_fuente VARCHAR(50)`);
        
        console.log('✅ Base de datos nítida.');
    } catch (e) { console.error(e.message); }
    finally { client.release(); }
}

// ==================== RUTAS ====================

// Para ver la lista de noticias en el inicio
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM noticias ORDER BY fecha DESC LIMIT 30');
        res.json({ success: true, noticias: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ESTO ARREGLA EL ERROR DE "CANNOT GET /NOTICIA"
app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
        if (result.rows.length === 0) return res.status(404).send('Noticia no encontrada');
        
        const n = result.rows[0];
        let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
        
        const contenidoHTML = n.contenido.split('\n').filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('');

        html = html.replace(/{{TITULO}}/g, n.titulo)
                   .replace(/{{CONTENIDO}}/g, contenidoHTML)
                   .replace(/{{IMAGEN}}/g, n.imagen)
                   .replace(/{{SECCION}}/g, n.seccion)
                   .replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO'));

        res.send(html);
    } catch (e) { res.status(500).send('Error al cargar noticia'); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));

// Iniciar
async function iniciar() {
    await inicializarBase();
    app.listen(PORT, () => console.log(`🏮 Farol encendido en puerto ${PORT}`));
}
iniciar();
