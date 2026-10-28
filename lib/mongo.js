'use strict';
/**
 * EL FAROL AL DÍA — Persistencia en MongoDB (memoria de rendimiento del Jefe de Redacción)
 *
 *  Colecciones (base MONGO_DB, por defecto "elfarol"):
 *   · noticias_meta → una evaluación por noticia (upsert por slug): tipo, virality, titulares A/B/social, parser usado,
 *                      modelo, y —cuando se sincroniza— las vistas reales que obtuvo.
 *   · intentos_ia   → historial de cada intento de generación (éxitos y fallos) para medir qué tan bien rinde el modelo.
 *
 *  Reglas: jamás lanza excepciones hacia el flujo de publicación (si Mongo cae, la noticia se publica igual),
 *  reconecta sola con backoff, y no se queda "muda": estado() dice por qué no está conectada.
 */
const URL_MONGO = process.env.MONGO_URL || process.env.MONGODB_URL || process.env.MONGO_PUBLIC_URL || '';
const DB_NOMBRE = process.env.MONGO_DB || 'elfarol';       // misma base que el almacén de imágenes (GridFS)

let _cliente = null, _db = null, _conectando = null, _ultimoError = null, _proximoIntento = 0, _fallosSeguidos = 0;

async function _conectar() {
    if (_db) return _db;
    if (!URL_MONGO) { _ultimoError = 'MONGO_URL no definida'; return null; }
    if (Date.now() < _proximoIntento) return null;
    if (_conectando) return _conectando;
    _conectando = (async () => {
        try {
            const { MongoClient } = require('mongodb');
            const c = new MongoClient(URL_MONGO, { serverSelectionTimeoutMS: 6000, connectTimeoutMS: 6000, maxPoolSize: 5 });
            await c.connect();
            const db = c.db(DB_NOMBRE);
            await Promise.all([
                db.collection('noticias_meta').createIndex({ slug: 1 }, { unique: true }),
                db.collection('noticias_meta').createIndex({ creada_at: -1 }),
                db.collection('noticias_meta').createIndex({ tipo_noticia: 1, virality_score: -1 }),
                db.collection('intentos_ia').createIndex({ ts: -1 }),
            ]);
            _cliente = c; _db = db; _ultimoError = null; _fallosSeguidos = 0;
            c.on('close', () => { _db = null; _cliente = null; });
            console.log(`🍃 [mongo] conectado → ${DB_NOMBRE}.noticias_meta / intentos_ia`);
            return db;
        } catch (e) {
            _ultimoError = e.message; _fallosSeguidos++;
            _proximoIntento = Date.now() + Math.min(30000 * _fallosSeguidos, 10 * 60 * 1000);     // backoff hasta 10 min
            console.warn(`⚠️ [mongo] no disponible (${e.message}) — reintento en ${Math.round((_proximoIntento - Date.now()) / 1000)}s`);
            return null;
        } finally { _conectando = null; }
    })();
    return _conectando;
}

/** Llamar una vez al arrancar: conecta en segundo plano y deja UNA línea clara si falta la variable. */
function iniciar() {
    if (!URL_MONGO) { console.warn('⚠️ [mongo] MONGO_URL no está definida en Railway: las evaluaciones del Jefe de Redacción NO se guardarán.'); return; }
    _conectar().catch(() => {});
}

async function guardarEvaluacion(meta) {
    const db = await _conectar(); if (!db) return false;
    try {
        const { slug, ...resto } = meta;
        await db.collection('noticias_meta').updateOne(
            { slug },
            { $set: { ...resto, actualizada_at: new Date() }, $setOnInsert: { slug, creada_at: new Date(), vistas: 0 } },
            { upsert: true });
        return true;
    } catch (e) { _ultimoError = e.message; console.warn('⚠️ [mongo] guardarEvaluacion:', e.message); return false; }
}

async function registrarIntento(ev) {
    const db = await _conectar(); if (!db) return false;
    try { await db.collection('intentos_ia').insertOne({ ...ev, ts: new Date() }); return true; }
    catch (e) { _ultimoError = e.message; return false; }
}

/** Copia las vistas reales (Postgres) a Mongo para las noticias de los últimos N días → memoria de rendimiento. */
async function sincronizarRendimiento(pool, dias = 21) {
    const db = await _conectar(); if (!db) return { actualizadas: 0, motivo: _ultimoError };
    try {
        const col = db.collection('noticias_meta');
        const docs = await col.find({ creada_at: { $gte: new Date(Date.now() - dias * 86400000) } }, { projection: { slug: 1 } }).toArray();
        if (!docs.length) return { actualizadas: 0 };
        const r = await pool.query('SELECT slug, vistas FROM noticias WHERE slug = ANY($1)', [docs.map(d => d.slug)]);
        if (!r.rows.length) return { actualizadas: 0 };
        await col.bulkWrite(r.rows.map(x => ({ updateOne: { filter: { slug: x.slug }, update: { $set: { vistas: parseInt(x.vistas || 0, 10), rendimiento_sync_at: new Date() } } } })));
        return { actualizadas: r.rows.length };
    } catch (e) { _ultimoError = e.message; console.warn('⚠️ [mongo] sincronizarRendimiento:', e.message); return { actualizadas: 0, motivo: e.message }; }
}

/** Resumen de rendimiento por tipo de noticia (para el panel y para el prompt). */
async function rendimientoPorTipo(dias = 30) {
    const db = await _conectar(); if (!db) return [];
    try {
        return await db.collection('noticias_meta').aggregate([
            { $match: { creada_at: { $gte: new Date(Date.now() - dias * 86400000) } } },
            { $group: { _id: '$tipo_noticia', noticias: { $sum: 1 }, vistas_prom: { $avg: '$vistas' }, virality_prom: { $avg: '$virality_score' } } },
            { $project: { _id: 0, tipo: '$_id', noticias: 1, vistas_prom: { $round: ['$vistas_prom', 1] }, virality_prom: { $round: ['$virality_prom', 1] } } },
        ]).toArray();
    } catch { return []; }
}

/** Texto corto para inyectar en el prompt: lo que mejor ha rendido (memoria). Vacío si aún no hay datos. */
async function memoriaParaPrompt(categoria) {
    const db = await _conectar(); if (!db) return '';
    try {
        const top = await db.collection('noticias_meta')
            .find({ categoria, vistas: { $gt: 0 }, creada_at: { $gte: new Date(Date.now() - 30 * 86400000) } })
            .sort({ vistas: -1 }).limit(3).project({ titulo: 1, vistas: 1, tipo_noticia: 1, virality_score: 1 }).toArray();
        if (!top.length) return '';
        return '\n🧠 MEMORIA DE RENDIMIENTO (titulares que mejor funcionaron en esta sección):\n' +
            top.map((n, i) => `${i + 1}. [${n.tipo_noticia} · viral ${n.virality_score} · ${n.vistas} vistas] "${n.titulo}"`).join('\n') + '\n';
    } catch { return ''; }
}

async function historial({ limite = 50, tipo = null, categoria = null } = {}) {
    const db = await _conectar(); if (!db) return [];
    const f = {}; if (tipo) f.tipo_noticia = tipo; if (categoria) f.categoria = categoria;
    try { return await db.collection('noticias_meta').find(f).sort({ creada_at: -1 }).limit(Math.min(parseInt(limite, 10) || 50, 200)).project({ _id: 0 }).toArray(); }
    catch { return []; }
}

async function estado() {
    const db = await _conectar();
    const base = { configurada: !!URL_MONGO, conectada: !!db, base: DB_NOMBRE, ultimo_error: _ultimoError };
    if (!db) return base;
    try {
        const [meta, intentos] = await Promise.all([db.collection('noticias_meta').estimatedDocumentCount(), db.collection('intentos_ia').estimatedDocumentCount()]);
        return { ...base, noticias_meta: meta, intentos_ia: intentos };
    } catch (e) { return { ...base, ultimo_error: e.message }; }
}

module.exports = { iniciar, guardarEvaluacion, registrarIntento, sincronizarRendimiento, rendimientoPorTipo, memoriaParaPrompt, historial, estado };
