// db.js - COMPLETO Y FUNCIONAL
const { Pool } = require('pg');

let pool = null;

function getPool() {
    if (!pool && process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 5,
            idleTimeoutMillis: 30000
        });
        console.log('✅ Pool de conexiones creado');
    }
    return pool;
}

async function inicializarDB() {
    const p = getPool();
    if (!p) {
        console.log('⚠️ No DATABASE_URL, usando modo demo');
        return;
    }
    try {
        await p.query(`CREATE TABLE IF NOT EXISTS noticias(
            id SERIAL PRIMARY KEY,
            titulo VARCHAR(255),
            slug VARCHAR(255) UNIQUE,
            seccion VARCHAR(100),
            contenido TEXT,
            seo_description VARCHAR(160),
            seo_keywords VARCHAR(255),
            redactor VARCHAR(100),
            imagen TEXT,
            imagen_alt VARCHAR(255),
            imagen_caption TEXT,
            imagen_nombre VARCHAR(100),
            imagen_fuente VARCHAR(50),
            vistas INTEGER DEFAULT 0,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            estado VARCHAR(50) DEFAULT 'publicada'
        )`);
        
        await p.query(`CREATE TABLE IF NOT EXISTS memoria_ia(
            id SERIAL PRIMARY KEY,
            tipo VARCHAR(50),
            valor TEXT,
            categoria VARCHAR(100),
            exitos INTEGER DEFAULT 0,
            fallos INTEGER DEFAULT 0,
            ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await p.query(`CREATE TABLE IF NOT EXISTS comentarios(
            id SERIAL PRIMARY KEY,
            noticia_id INTEGER REFERENCES noticias(id) ON DELETE CASCADE,
            nombre VARCHAR(80),
            texto TEXT,
            aprobado BOOLEAN DEFAULT true,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await p.query(`CREATE TABLE IF NOT EXISTS publicidad(
            id SERIAL PRIMARY KEY,
            nombre_espacio VARCHAR(100),
            url_afiliado TEXT,
            imagen_url TEXT,
            ubicacion VARCHAR(50),
            activo BOOLEAN DEFAULT true,
            ancho_px INTEGER DEFAULT 0,
            alto_px INTEGER DEFAULT 0
        )`);
        
        await p.query(`CREATE TABLE IF NOT EXISTS push_suscripciones(
            id SERIAL PRIMARY KEY,
            endpoint TEXT UNIQUE,
            auth_key TEXT,
            p256dh_key TEXT,
            user_agent TEXT,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ultima_notificacion TIMESTAMP
        )`);
        
        console.log('✅ Base de datos inicializada');
    } catch(e) {
        console.error('❌ Error BD:', e.message);
    }
}

async function getNoticias(limite = 30) {
    const p = getPool();
    if (!p) return [];
    const r = await p.query(
        'SELECT id,titulo,slug,seccion,imagen,imagen_alt,seo_description,fecha,vistas,redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT $2',
        ['publicada', limite]
    );
    return r.rows;
}

async function getNoticiaBySlug(slug) {
    const p = getPool();
    if (!p) return null;
    const r = await p.query('SELECT * FROM noticias WHERE slug=$1 AND estado=$2', [slug, 'publicada']);
    return r.rows[0];
}

async function incrementarVistas(id) {
    const p = getPool();
    if (!p) return;
    await p.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [id]);
}

async function crearNoticia(data) {
    const p = getPool();
    if (!p) return null;
    const { titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, imagen, imagen_alt, imagen_caption, imagen_nombre, imagen_fuente, imagen_original } = data;
    const r = await p.query(
        `INSERT INTO noticias(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'publicada') RETURNING id`,
        [titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, imagen, imagen_alt, imagen_caption, imagen_nombre, imagen_fuente, imagen_original]
    );
    return r.rows[0];
}

async function existeSlug(slug) {
    const p = getPool();
    if (!p) return false;
    const r = await p.query('SELECT id FROM noticias WHERE slug=$1', [slug]);
    return r.rows.length > 0;
}

async function eliminarNoticia(id) {
    const p = getPool();
    if (!p) return;
    await p.query('DELETE FROM noticias WHERE id=$1', [id]);
}

async function getTitulosRecientes(limite = 25) {
    const p = getPool();
    if (!p) return [];
    const r = await p.query(
        'SELECT titulo, seccion FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT $2',
        ['publicada', limite]
    );
    return r.rows;
}

async function getErroresRecientes(categoria) {
    const p = getPool();
    if (!p) return [];
    const r = await p.query(
        `SELECT valor FROM memoria_ia WHERE tipo=$1 AND categoria=$2 
         AND ultima_vez > NOW() - INTERVAL '24 hours' ORDER BY fallos DESC LIMIT 5`,
        ['error', categoria]
    );
    return r.rows;
}

async function registrarError(descripcion, categoria) {
    const p = getPool();
    if (!p) return;
    await p.query(
        `INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES('error',$1,$2,1) ON CONFLICT DO NOTHING`,
        [descripcion.substring(0, 200), categoria]
    );
}

async function getComentarios(noticia_id) {
    const p = getPool();
    if (!p) return [];
    const r = await p.query(
        'SELECT id,nombre,texto,fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC',
        [noticia_id]
    );
    return r.rows;
}

async function crearComentario(noticia_id, nombre, texto) {
    const p = getPool();
    if (!p) return null;
    const r = await p.query(
        'INSERT INTO comentarios(noticia_id,nombre,texto) VALUES($1,$2,$3) RETURNING id,nombre,texto,fecha',
        [noticia_id, nombre.substring(0, 80), texto.substring(0, 1000)]
    );
    return r.rows[0];
}

async function getPublicidadActiva() {
    const p = getPool();
    if (!p) return [];
    const r = await p.query(
        'SELECT id,nombre_espacio,url_afiliado,imagen_url,ubicacion,ancho_px,alto_px FROM publicidad WHERE activo=true ORDER BY id ASC'
    );
    return r.rows;
}

async function getSuscriptoresPush() {
    const p = getPool();
    if (!p) return [];
    const r = await p.query(
        'SELECT endpoint, auth_key, p256dh_key FROM push_suscripciones WHERE endpoint IS NOT NULL ORDER BY ultima_notificacion NULLS FIRST'
    );
    return r.rows;
}

async function guardarSuscripcionPush(endpoint, auth, p256dh, userAgent) {
    const p = getPool();
    if (!p) return;
    await p.query(
        `INSERT INTO push_suscripciones(endpoint,auth_key,p256dh_key,user_agent) 
         VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET auth_key=$2,p256dh_key=$3,user_agent=$4,fecha=CURRENT_TIMESTAMP`,
        [endpoint, auth, p256dh, userAgent || null]
    );
}

async function eliminarSuscripcionPush(endpoint) {
    const p = getPool();
    if (!p) return;
    await p.query('DELETE FROM push_suscripciones WHERE endpoint=$1', [endpoint]);
}

async function actualizarUltimaNotificacion(endpoint) {
    const p = getPool();
    if (!p) return;
    await p.query('UPDATE push_suscripciones SET ultima_notificacion=NOW() WHERE endpoint=$1', [endpoint]);
}

async function getEstadisticas() {
    const p = getPool();
    if (!p) return { totalNoticias: 0, totalVistas: 0 };
    const r = await p.query('SELECT COUNT(*) as c, SUM(vistas) as v FROM noticias WHERE estado=$1', ['publicada']);
    return { totalNoticias: parseInt(r.rows[0].c) || 0, totalVistas: parseInt(r.rows[0].v) || 0 };
}

module.exports = {
    pool: getPool,
    inicializarDB,
    getNoticias,
    getNoticiaBySlug,
    incrementarVistas,
    crearNoticia,
    existeSlug,
    eliminarNoticia,
    getTitulosRecientes,
    getErroresRecientes,
    registrarError,
    getComentarios,
    crearComentario,
    getPublicidadActiva,
    getSuscriptoresPush,
    guardarSuscripcionPush,
    eliminarSuscripcionPush,
    actualizarUltimaNotificacion,
    getEstadisticas
};
