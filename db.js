const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = {
    async inicializarDB() {
        await pool.query(`CREATE TABLE IF NOT EXISTS noticias (
            id SERIAL PRIMARY KEY, titulo TEXT, slug TEXT UNIQUE, seccion TEXT, 
            contenido TEXT, imagen TEXT, vistas INTEGER DEFAULT 0, fecha TIMESTAMP DEFAULT NOW()
        )`);
    },
    async crearNoticia(n) {
        return pool.query(`INSERT INTO noticias (titulo, slug, seccion, contenido, imagen) VALUES ($1,$2,$3,$4,$5)`, 
        [n.titulo, n.slug, n.seccion, n.contenido, n.imagen]);
    },
    async getNoticias() { return (await pool.query(`SELECT * FROM noticias ORDER BY fecha DESC`)).rows; },
    async getNoticiaBySlug(slug) { return (await pool.query(`SELECT * FROM noticias WHERE slug = $1`, [slug])).rows[0]; },
    async incrementarVistas(id) { await pool.query(`UPDATE noticias SET vistas = vistas + 1 WHERE id = $1`, [id]); },
    async existeSlug(slug) { return (await pool.query(`SELECT 1 FROM noticias WHERE slug = $1`, [slug])).rowCount > 0; },
    async getTitulosRecientes(limit) { return (await pool.query(`SELECT titulo, seccion FROM noticias ORDER BY fecha DESC LIMIT $1`, [limit])).rows; }
};
