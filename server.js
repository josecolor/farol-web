      const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// CONEXIÓN A TU BASE DE DATOS
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());
// ESTO ES LO QUE HACE QUE SE VEA EL DISEÑO LINDO
app.use(express.static(path.join(__dirname, 'client')));
app.use(express.static(path.join(__dirname, 'static'))); 
app.use(cors());

// ARREGLO DE COLUMNAS (PARA QUE NO DE ERROR ROJO)
async function inicializarBase() {
    const client = await pool.connect();
    try {
        await client.query(`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS imagen_caption TEXT`);
        console.log('✅ Base de datos sincronizada');
    } catch (e) { console.log('Aviso:', e.message); }
    finally { client.release(); }
}

// RUTA PARA QUE EL INICIO MUESTRE LAS NOTICIAS
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM noticias ORDER BY fecha DESC LIMIT 30');
        res.json({ success: true, noticias: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// RUTA PARA QUE AL DAR CLIC SE ABRA LA NOTICIA LINDA
app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
        if (result.rows.length === 0) return res.status(404).send('Noticia no encontrada');
        
        const n = result.rows[0];
        let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
        
        // Inyectamos los datos en tu plantilla
        html = html.replace(/{{TITULO}}/g, n.titulo)
                   .replace(/{{CONTENIDO}}/g, n.contenido.split('\n').map(p => `<p>${p}</p>`).join(''))
                   .replace(/{{IMAGEN}}/g, n.imagen)
                   .replace(/{{SECCION}}/g, n.seccion)
                   .replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO'));

        res.send(html);
    } catch (e) { res.status(500).send('Error al abrir la noticia'); }
});

// RUTA PARA TU SALA DE REDACCIÓN
app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// MANDAR AL INICIO SI NO ENCUENTRA OTRA COSA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

async function iniciar() {
    await inicializarBase();
    app.listen(PORT, () => console.log(`🏮 Farol encendido en puerto ${PORT}`));
}
iniciar();
