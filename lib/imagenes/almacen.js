'use strict';
/**
 * Almacén persistente de imágenes. /tmp de Railway se borra en cada deploy → las fotos con marca de agua se perdían.
 * Prioridad: MongoDB GridFS (MONGO_URL) → disco (IMG_DIR, p. ej. un Volume montado en /data/img) → /tmp.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let _cli = null, _bucket = null, _col = null;
async function _mongo() {
    if (!process.env.MONGO_URL) return null;
    if (_bucket) return { bucket: _bucket, col: _col };
    try {
        const { MongoClient, GridFSBucket } = require('mongodb');
        _cli = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 6000 });
        await _cli.connect();
        const db = _cli.db(process.env.MONGO_DB || 'elfarol');
        _bucket = new GridFSBucket(db, { bucketName: 'imagenes' });
        _col = db.collection('imagenes_meta');
        await _col.createIndex({ nombre: 1 }, { unique: true }).catch(() => {});
        console.log('✅ [almacen] MongoDB GridFS listo');
        return { bucket: _bucket, col: _col };
    } catch (e) { console.warn('⚠️ [almacen] Mongo no disponible:', e.message); _bucket = null; return null; }
}
const DIR = process.env.IMG_DIR || path.join(os.tmpdir(), 'efd-img');
fs.mkdirSync(DIR, { recursive: true });

const TIPOS = { '.mp4': 'video/mp4', '.json': 'application/json', '.png': 'image/png' };
async function guardar(nombre, buffer, meta = {}, contentType) {
    contentType = contentType || TIPOS[path.extname(nombre).toLowerCase()] || 'image/jpeg';
    const m = await _mongo();
    if (m) {
        await new Promise((ok, ko) => { const s = m.bucket.openUploadStream(nombre, { contentType }); s.on('finish', ok).on('error', ko); s.end(buffer); });
        await m.col.updateOne({ nombre }, { $set: { nombre, ...meta, creada: new Date() } }, { upsert: true }).catch(() => {});
        return 'mongo';
    }
    fs.writeFileSync(path.join(DIR, nombre), buffer);
    return 'disco';
}
async function leer(nombre) {
    if (!/^[\w.-]+$/.test(nombre)) return null;                       // anti path-traversal
    const f = path.join(DIR, nombre);
    if (fs.existsSync(f)) return fs.readFileSync(f);
    const m = await _mongo(); if (!m) return null;
    const partes = []; 
    try { for await (const p of m.bucket.openDownloadStreamByName(nombre)) partes.push(p); } catch { return null; }
    return Buffer.concat(partes);
}
module.exports = { guardar, leer };
