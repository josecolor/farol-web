const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

module.exports = {
    pool,

    async inicializarDB() {
        // Tabla principal de noticias
        await pool.query(
            'CREATE TABLE IF NOT EXISTS noticias (' +
            'id SERIAL PRIMARY KEY,' +
            'titulo VARCHAR(255) NOT NULL,' +
            'slug VARCHAR(255) UNIQUE,' +
            'seccion VARCHAR(100),' +
            'contenido TEXT,' +
            'seo_description VARCHAR(160),' +
            'seo_keywords VARCHAR(255),' +
            'redactor VARCHAR(100),' +
            'imagen TEXT,' +
            'imagen_alt VARCHAR(255),' +
            'imagen_caption TEXT,' +
            'imagen_nombre VARCHAR(100),' +
            'imagen_fuente VARCHAR(50),' +
            'imagen_original TEXT,' +
            'vistas INTEGER DEFAULT 0,' +
            'fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
            "estado VARCHAR(50) DEFAULT 'publicada'" +
            ')'
        );

        // Agregar columnas faltantes si ya existe la tabla
        const columnasFaltantes = [
            'seo_description VARCHAR(160)',
            'seo_keywords VARCHAR(255)',
            'redactor VARCHAR(100)',
            'imagen_alt VARCHAR(255)',
            'imagen_caption TEXT',
            'imagen_nombre VARCHAR(100)',
            'imagen_fuente VARCHAR(50)',
            'imagen_original TEXT',
            "estado VARCHAR(50) DEFAULT 'publicada'"
        ];

        for (const col of columnasFaltantes) {
            const nombre = col.split(' ')[0];
            await pool.query(
                'DO $$BEGIN IF NOT EXISTS(' +
                'SELECT 1 FROM information_schema.columns ' +
                "WHERE table_name='noticias' AND column_name='" + nombre + "'" +
                ') THEN ALTER TABLE noticias ADD COLUMN ' + col + '; END IF; END$$;'
            ).catch(() => {});
        }

        // Tabla RSS procesados
        await pool.query(
            'CREATE TABLE IF NOT EXISTS rss_procesados (' +
            'id SERIAL PRIMARY KEY,' +
            'item_guid VARCHAR(500) UNIQUE,' +
            'fuente VARCHAR(100),' +
            'fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
            ')'
        );

        // Tabla memoria IA
        await pool.query(
            'CREATE TABLE IF NOT EXISTS memoria_ia (' +
            'id SERIAL PRIMARY KEY,' +
            'tipo VARCHAR(50) NOT NULL,' +
            'valor TEXT NOT NULL,' +
            'categoria VARCHAR(100),' +
            'exitos INTEGER DEFAULT 0,' +
            'fallos INTEGER DEFAULT 0,' +
            'fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
            'ultima_vez TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
            ')'
        );
        await pool.query(
            'CREATE INDEX IF NOT EXISTS idx_memoria_tipo ON memoria_ia(tipo, categoria)'
        ).catch(() => {});

        // Tabla comentarios
        await pool.query(
            'CREATE TABLE IF NOT EXISTS comentarios (' +
            'id SERIAL PRIMARY KEY,' +
            'noticia_id INTEGER NOT NULL REFERENCES noticias(id) ON DELETE CASCADE,' +
            'nombre VARCHAR(80) NOT NULL,' +
            'texto TEXT NOT NULL,' +
            'aprobado BOOLEAN DEFAULT true,' +
            'fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
            ')'
        );
        await pool.query(
            'CREATE INDEX IF NOT EXISTS idx_comentarios_noticia ON comentarios(noticia_id, aprobado, fecha DESC)'
        ).catch(() => {});

        // Tabla publicidad
        await pool.query(
            'CREATE TABLE IF NOT EXISTS publicidad (' +
            'id SERIAL PRIMARY KEY,' +
            'nombre_espacio VARCHAR(100) NOT NULL,' +
            "url_afiliado TEXT DEFAULT ''," +
            "imagen_url TEXT DEFAULT ''," +
            "ubicacion VARCHAR(50) DEFAULT 'top'," +
            'activo BOOLEAN DEFAULT true,' +
            'ancho_px INTEGER DEFAULT 0,' +
            'alto_px INTEGER DEFAULT 0,' +
            'fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
            ')'
        );

        // Columnas extra publicidad
        for (const col of ['ancho_px INTEGER DEFAULT 0', 'alto_px INTEGER DEFAULT 0']) {
            const nombre = col.split(' ')[0];
            await pool.query(
                'DO $$BEGIN IF NOT EXISTS(' +
                'SELECT 1 FROM information_schema.columns ' +
                "WHERE table_name='publicidad' AND column_name='" + nombre + "'" +
                ') THEN ALTER TABLE publicidad ADD COLUMN ' + col + '; END IF; END$$;'
            ).catch(() => {});
        }

        // Insertar espacios publicitarios por defecto si está vacío
        const countPub = await pool.query('SELECT COUNT(*) FROM publicidad');
        if (parseInt(countPub.rows[0].count) === 0) {
            await pool.query(
                "INSERT INTO publicidad (nombre_espacio, url_afiliado, imagen_url, ubicacion, activo) VALUES " +
                "('Banner Principal Top', '', '', 'top', false)," +
                "('Banner Sidebar Derecha', '', '', 'sidebar', false)," +
                "('Banner Entre Noticias', '', '', 'medio', false)," +
                "('Banner Footer', '', '', 'footer', false)"
            );
        }

        // Tabla push suscripciones
        await pool.query(
            'CREATE TABLE IF NOT EXISTS push_suscripciones (' +
            'id SERIAL PRIMARY KEY,' +
            'endpoint TEXT UNIQUE NOT NULL,' +
            'auth_key TEXT NOT NULL,' +
            'p256dh_key TEXT NOT NULL,' +
            'user_agent TEXT,' +
            'fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
            'ultima_notificacion TIMESTAMP' +
            ')'
        );

        console.log('✅ BD lista (todas las tablas verificadas)');
    },

    // ── NOTICIAS ──────────────────────────────────────────
    async crearNoticia(n) {
        return pool.query(
            'INSERT INTO noticias ' +
            '(titulo,slug,seccion,contenido,seo_description,seo_keywords,redactor,' +
            'imagen,imagen_alt,imagen_caption,imagen_nombre,imagen_fuente,imagen_original,estado) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [
                n.titulo, n.slug, n.seccion, n.contenido,
                n.seo_description || '', n.seo_keywords || '',
                n.redactor || 'Redacción EFD',
                n.imagen, n.imagen_alt || '',
                n.imagen_caption || '', n.imagen_nombre || '',
                n.imagen_fuente || '', n.imagen_original || '',
                n.estado || 'publicada'
            ]
        );
    },

    async getNoticias(limite = 30) {
        return (await pool.query(
            'SELECT id,titulo,slug,seccion,imagen,imagen_alt,seo_description,fecha,vistas,redactor ' +
            'FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT $2',
            ['publicada', limite]
        )).rows;
    },

    async getNoticiaBySlug(slug) {
        return (await pool.query(
            'SELECT * FROM noticias WHERE slug=$1 AND estado=$2',
            [slug, 'publicada']
        )).rows[0];
    },

    async incrementarVistas(id) {
        await pool.query('UPDATE noticias SET vistas=vistas+1 WHERE id=$1', [id]);
    },

    async existeSlug(slug) {
        return (await pool.query('SELECT 1 FROM noticias WHERE slug=$1', [slug])).rowCount > 0;
    },

    async getTitulosRecientes(limit = 25) {
        return (await pool.query(
            'SELECT titulo, seccion, fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT $2',
            ['publicada', parseInt(limit)]
        )).rows;
    },

    async eliminarNoticia(id) {
        return pool.query('DELETE FROM noticias WHERE id=$1', [id]);
    },

    async actualizarImagen(id, imagen) {
        return pool.query('UPDATE noticias SET imagen=$1 WHERE id=$2', [imagen, id]);
    },

    async getEstadisticas() {
        return (await pool.query(
            "SELECT COUNT(*) as c, SUM(vistas) as v FROM noticias WHERE estado='publicada'"
        )).rows[0];
    },

    // ── RSS ───────────────────────────────────────────────
    async existeRSS(guid) {
        return (await pool.query(
            'SELECT id FROM rss_procesados WHERE item_guid=$1',
            [guid.substring(0, 500)]
        )).rows.length > 0;
    },

    async registrarRSS(guid, fuente) {
        await pool.query(
            'INSERT INTO rss_procesados(item_guid,fuente) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [guid.substring(0, 500), fuente]
        );
    },

    // ── MEMORIA IA ────────────────────────────────────────
    async getConfigIA() {
        const r = await pool.query(
            "SELECT valor FROM memoria_ia WHERE tipo='config_ia' ORDER BY ultima_vez DESC LIMIT 1"
        );
        return r.rows.length ? JSON.parse(r.rows[0].valor) : null;
    },

    async guardarConfigIA(cfg) {
        const valor = JSON.stringify(cfg);
        await pool.query(
            "INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('config_ia',$1,'sistema',1,0) ON CONFLICT DO NOTHING",
            [valor]
        );
        await pool.query(
            "UPDATE memoria_ia SET valor=$1,ultima_vez=NOW() WHERE tipo='config_ia' AND categoria='sistema'",
            [valor]
        );
    },

    async getErroresRecientes(categoria) {
        return (await pool.query(
            "SELECT valor FROM memoria_ia WHERE tipo='error' AND categoria=$1 " +
            "AND ultima_vez > NOW() - INTERVAL '24 hours' ORDER BY fallos DESC LIMIT 5",
            [categoria]
        )).rows;
    },

    async registrarError(descripcion, categoria) {
        await pool.query(
            "INSERT INTO memoria_ia(tipo,valor,categoria,fallos) VALUES('error',$1,$2,1) ON CONFLICT DO NOTHING",
            [descripcion.substring(0, 200), categoria]
        );
        await pool.query(
            "UPDATE memoria_ia SET fallos=fallos+1,ultima_vez=NOW() WHERE tipo='error' AND valor=$1",
            [descripcion.substring(0, 200)]
        );
    },

    async registrarQueryPexels(query, categoria, exito) {
        await pool.query(
            "INSERT INTO memoria_ia(tipo,valor,categoria,exitos,fallos) VALUES('pexels_query',$1,$2,$3,$4) ON CONFLICT DO NOTHING",
            [query, categoria, exito ? 1 : 0, exito ? 0 : 1]
        );
        await pool.query(
            "UPDATE memoria_ia SET exitos=exitos+$1,fallos=fallos+$2,ultima_vez=NOW() WHERE tipo='pexels_query' AND valor=$3 AND categoria=$4",
            [exito ? 1 : 0, exito ? 0 : 1, query, categoria]
        );
    },

    async getMemoria(limite = 50) {
        return (await pool.query(
            'SELECT tipo,valor,categoria,exitos,fallos,ultima_vez FROM memoria_ia ORDER BY ultima_vez DESC LIMIT $1',
            [limite]
        )).rows;
    },

    // ── COMENTARIOS ───────────────────────────────────────
    async getComentarios(noticia_id) {
        return (await pool.query(
            'SELECT id,nombre,texto,fecha FROM comentarios WHERE noticia_id=$1 AND aprobado=true ORDER BY fecha ASC',
            [noticia_id]
        )).rows;
    },

    async crearComentario(noticia_id, nombre, texto) {
        return (await pool.query(
            'INSERT INTO comentarios(noticia_id,nombre,texto) VALUES($1,$2,$3) RETURNING id,nombre,texto,fecha',
            [noticia_id, nombre.trim().substring(0, 80), texto.trim().substring(0, 1000)]
        )).rows[0];
    },

    async eliminarComentario(id) {
        return pool.query('DELETE FROM comentarios WHERE id=$1', [id]);
    },

    async getComentariosAdmin() {
        return (await pool.query(
            'SELECT c.id,c.nombre,c.texto,c.fecha,n.titulo as noticia_titulo,n.slug as noticia_slug ' +
            'FROM comentarios c JOIN noticias n ON n.id=c.noticia_id ORDER BY c.fecha DESC LIMIT 50'
        )).rows;
    },

    // ── PUBLICIDAD ────────────────────────────────────────
    async getPublicidad() {
        return (await pool.query('SELECT * FROM publicidad ORDER BY id ASC')).rows;
    },

    async getPublicidadActiva() {
        return (await pool.query(
            'SELECT id,nombre_espacio,url_afiliado,imagen_url,ubicacion,ancho_px,alto_px ' +
            'FROM publicidad WHERE activo=true ORDER BY id ASC'
        )).rows;
    },

    async actualizarPublicidad(id, datos) {
        return pool.query(
            'UPDATE publicidad SET nombre_espacio=$1,url_afiliado=$2,imagen_url=$3,ubicacion=$4,activo=$5,ancho_px=$6,alto_px=$7 WHERE id=$8',
            [datos.nombre_espacio, datos.url_afiliado, datos.imagen_url, datos.ubicacion,
             datos.activo, datos.ancho_px, datos.alto_px, id]
        );
    },

    async crearPublicidad(datos) {
        return pool.query(
            'INSERT INTO publicidad(nombre_espacio,url_afiliado,imagen_url,ubicacion,activo,ancho_px,alto_px) VALUES($1,$2,$3,$4,true,$5,$6)',
            [datos.nombre_espacio, datos.url_afiliado, datos.imagen_url, datos.ubicacion, datos.ancho_px, datos.alto_px]
        );
    },

    async eliminarPublicidad(id) {
        return pool.query('DELETE FROM publicidad WHERE id=$1', [id]);
    },

    // ── PUSH ──────────────────────────────────────────────
    async getSuscriptoresPush() {
        return (await pool.query(
            'SELECT endpoint,auth_key,p256dh_key FROM push_suscripciones WHERE endpoint IS NOT NULL ORDER BY ultima_notificacion NULLS FIRST'
        )).rows;
    },

    async suscribirPush(endpoint, auth_key, p256dh_key, user_agent) {
        return pool.query(
            'INSERT INTO push_suscripciones(endpoint,auth_key,p256dh_key,user_agent) VALUES($1,$2,$3,$4) ' +
            'ON CONFLICT(endpoint) DO UPDATE SET auth_key=$2,p256dh_key=$3,user_agent=$4,fecha=CURRENT_TIMESTAMP',
            [endpoint, auth_key, p256dh_key, user_agent || null]
        );
    },

    async desuscribirPush(endpoint) {
        return pool.query('DELETE FROM push_suscripciones WHERE endpoint=$1', [endpoint]);
    },

    async actualizarUltimaPush(endpoint) {
        return pool.query(
            'UPDATE push_suscripciones SET ultima_notificacion=NOW() WHERE endpoint=$1',
            [endpoint]
        );
    },

    async contarSuscriptoresPush() {
        return parseInt((await pool.query('SELECT COUNT(*) FROM push_suscripciones')).rows[0].count);
    },

    // ── COACH / ANALÍTICA ─────────────────────────────────
    async getNoticiasCoach(dias = 7) {
        return (await pool.query(
            'SELECT id,titulo,seccion,vistas,fecha FROM noticias ' +
            "WHERE estado='publicada' AND fecha>NOW()-INTERVAL '" + parseInt(dias) + " days' ORDER BY vistas DESC"
        )).rows;
    },

    // ── SITEMAP ───────────────────────────────────────────
    async getSlugsParaSitemap() {
        return (await pool.query(
            "SELECT slug,fecha FROM noticias WHERE estado='publicada' AND slug IS NOT NULL ORDER BY fecha DESC LIMIT 1000"
        )).rows;
    }
};
