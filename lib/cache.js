'use strict';
/**
 * EL FAROL AL DÍA — Capa de caché (Fase 2)
 * Redis con fallback automático a memoria: si Redis cae, el sitio NO cae.
 *
 *  wrap(clave, ttl, fn, {stale})  → cache-aside + stale-while-revalidate + anti-estampida
 *  invalidar('noticias')          → invalida todo un namespace con un INCR (O(1))
 *  paginaCache({...})             → middleware Express para HTML completo
 *  contarVista / vaciarVistas     → contador de vistas en Redis, flush por lotes a Postgres
 *  limitar({...})                 → rate limit por IP
 */
const crypto = require('crypto');

const REDIS_URL = process.env.REDIS_URL || '';
const PREFIX    = process.env.CACHE_PREFIX || 'efd';

let redis = null;
let redisOk = false;
const mem = new Map();               // fallback: clave -> {v, exp}
const memNs = new Map();             // fallback: namespace -> versión
const MEM_MAX = 500;

function iniciar() {
    if (redis || !REDIS_URL) {
        if (!REDIS_URL) console.warn('⚠️ [cache] REDIS_URL ausente — usando memoria local');
        return;
    }
    const Redis = require('ioredis');
    redis = new Redis(REDIS_URL, {
        family: 0,                       // Railway private network (IPv6) + IPv4
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,       // si no hay conexión, falla rápido y usamos memoria
        connectTimeout: 5000,
        retryStrategy: n => Math.min(n * 500, 5000),
    });
    redis.on('ready', () => { redisOk = true;  console.log('✅ [cache] Redis conectado'); });
    redis.on('end',   () => { redisOk = false; });
    redis.on('error', e => { if (redisOk) console.warn('⚠️ [cache] Redis:', e.message); redisOk = false; });
}

// ── Primitivas con fallback ────────────────────────────────
async function _get(k) {
    if (redisOk) { try { return await redis.get(k); } catch {} }
    const e = mem.get(k);
    if (!e) return null;
    if (e.exp < Date.now()) { mem.delete(k); return null; }
    return e.v;
}
async function _set(k, v, ttlSeg) {
    if (redisOk) { try { await redis.set(k, v, 'EX', ttlSeg); return; } catch {} }
    if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value);
    mem.set(k, { v, exp: Date.now() + ttlSeg * 1000 });
}
async function _del(k) {
    if (redisOk) { try { await redis.del(k); } catch {} }
    mem.delete(k);
}
async function _lock(k, ttlSeg) {
    if (redisOk) { try { return (await redis.set(k, '1', 'EX', ttlSeg, 'NX')) === 'OK'; } catch {} }
    const e = mem.get(k);
    if (e && e.exp > Date.now()) return false;
    mem.set(k, { v: '1', exp: Date.now() + ttlSeg * 1000 });
    return true;
}

// ── Namespaces versionados ─────────────────────────────────
async function _ver(ns) {
    if (redisOk) { try { return (await redis.get(`${PREFIX}:ver:${ns}`)) || '0'; } catch {} }
    return String(memNs.get(ns) || 0);
}
async function invalidar(...namespaces) {
    for (const ns of namespaces) {
        if (redisOk) { try { await redis.incr(`${PREFIX}:ver:${ns}`); } catch {} }
        memNs.set(ns, (memNs.get(ns) || 0) + 1);
    }
}
async function _clave(ns, k) { return `${PREFIX}:${ns}:v${await _ver(ns)}:${k}`; }

// ── wrap: cache-aside + SWR + anti-estampida ───────────────
const _enVuelo = new Map();          // dedupe dentro del mismo proceso
async function wrap(ns, k, ttl, fn, { stale = ttl * 4 } = {}) {
    const clave = await _clave(ns, k);
    const raw = await _get(clave);
    if (raw) {
        const { v, exp } = JSON.parse(raw);
        if (Date.now() < exp) return v;                       // fresco
        // vencido pero servible: devolver ya y refrescar en segundo plano
        _refrescar(clave, ttl, stale, fn).catch(() => {});
        return v;
    }
    return _refrescar(clave, ttl, stale, fn, true);
}
async function _refrescar(clave, ttl, stale, fn, bloqueante = false) {
    if (_enVuelo.has(clave)) return _enVuelo.get(clave);
    const p = (async () => {
        const tengoLock = await _lock(`${clave}:lock`, 30);
        if (!tengoLock && bloqueante) {                       // otro proceso ya calcula: esperar un poco
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 250));
                const raw = await _get(clave);
                if (raw) return JSON.parse(raw).v;
            }
        }
        const v = await fn();
        if (v !== undefined) await _set(clave, JSON.stringify({ v, exp: Date.now() + ttl * 1000 }), ttl + stale);
        return v;
    })().finally(() => _enVuelo.delete(clave));
    _enVuelo.set(clave, p);
    return p;
}

// ── Middleware: caché de páginas HTML completas ────────────
function paginaCache({ ns = 'paginas', ttl = 120, stale = 600, key } = {}) {
    return async (req, res, next) => {
        if (req.method !== 'GET' || req.headers.authorization || req.query.nocache) return next();
        const k = key ? key(req) : req.originalUrl;
        const clave = await _clave(ns, crypto.createHash('md5').update(k).digest('hex'));
        const raw = await _get(clave);
        if (raw) {
            const { body, type, status, exp } = JSON.parse(raw);
            res.setHeader('X-Cache', Date.now() < exp ? 'HIT' : 'STALE');
            res.setHeader('Cache-Control', `public,max-age=60,stale-while-revalidate=${stale}`);
            res.status(status).type(type).send(body);
            if (Date.now() >= exp && await _lock(`${clave}:lock`, 20)) {
                _revalidarInterno(req, clave, ttl, stale);
            }
            return;
        }
        // MISS: interceptar la respuesta y guardarla si fue 200
        const enviar = res.send.bind(res);
        res.send = body => {
            if (res.statusCode === 200 && typeof body === 'string') {
                _set(clave, JSON.stringify({ body, status: 200, type: res.get('Content-Type') || 'text/html',
                    exp: Date.now() + ttl * 1000 }), ttl + stale).catch(() => {});
            }
            res.setHeader('X-Cache', 'MISS');
            return enviar(body);
        };
        next();
    };
}
function _revalidarInterno(req, clave, ttl, stale) {
    const http = require('http');
    const r = http.get({ host: '127.0.0.1', port: process.env.PORT || 8080, path: req.originalUrl + (req.originalUrl.includes('?') ? '&' : '?') + 'nocache=1',
        headers: { host: req.headers.host } }, resp => {
        let b = ''; resp.setEncoding('utf8');
        resp.on('data', c => b += c);
        resp.on('end', () => { if (resp.statusCode === 200)
            _set(clave, JSON.stringify({ body: b, status: 200, type: resp.headers['content-type'] || 'text/html',
                exp: Date.now() + ttl * 1000 }), ttl + stale).catch(() => {}); });
    });
    r.on('error', () => {}); r.setTimeout(15000, () => r.destroy());
}

// ── Vistas: contar en Redis, volcar a Postgres por lotes ───
const _vistasMem = new Map();
async function contarVista(id) {                       // id = slug de la noticia
    if (redisOk) { try { await redis.hincrby(`${PREFIX}:vistas`, String(id), 1); return; } catch {} }
    _vistasMem.set(id, (_vistasMem.get(id) || 0) + 1);
}
async function vaciarVistas(pool) {
    const lote = new Map(_vistasMem); _vistasMem.clear();
    if (redisOk) {
        try {
            const tmp = `${PREFIX}:vistas:flush:${Date.now()}`;
            if (await redis.exists(`${PREFIX}:vistas`)) {
                await redis.rename(`${PREFIX}:vistas`, tmp);
                const h = await redis.hgetall(tmp);
                for (const [id, n] of Object.entries(h)) lote.set(id, (lote.get(id) || 0) + Number(n));
                await redis.del(tmp);
            }
        } catch {}
    }
    for (const [id, n] of lote)
        await pool.query('UPDATE noticias SET vistas=vistas+$2 WHERE slug=$1', [id, n]).catch(() => {});
    return lote.size;
}

// ── Rate limit por IP (ventana fija) ───────────────────────
function limitar({ nombre, max = 10, ventana = 60 }) {
    return async (req, res, next) => {
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const k = `${PREFIX}:rl:${nombre}:${ip}:${Math.floor(Date.now() / 1000 / ventana)}`;
        let n = 0;
        if (redisOk) { try { n = await redis.incr(k); if (n === 1) await redis.expire(k, ventana + 1); } catch {} }
        else { const e = mem.get(k); n = (e ? e.v : 0) + 1; mem.set(k, { v: n, exp: Date.now() + ventana * 1000 }); }
        if (n > max) return res.status(429).json({ success: false, error: 'Demasiadas solicitudes. Intenta en un minuto.' });
        next();
    };
}

// ── Utilidades varias (usadas por imágenes/LLM) ────────────
async function setAdd(clave, valor, ttlSeg) {
    const k = `${PREFIX}:set:${clave}`;
    if (redisOk) { try { await redis.sadd(k, valor); await redis.expire(k, ttlSeg); return; } catch {} }
    const e = mem.get(k); const s = e ? e.v : new Set(); s.add(valor); mem.set(k, { v: s, exp: Date.now() + ttlSeg * 1000 });
}
async function setHas(clave, valor) {
    const k = `${PREFIX}:set:${clave}`;
    if (redisOk) { try { return (await redis.sismember(k, valor)) === 1; } catch {} }
    const e = mem.get(k); return !!(e && e.exp > Date.now() && e.v.has(valor));
}

function estado() {
    return { redis: redisOk ? 'conectado' : (REDIS_URL ? 'caido (usando memoria)' : 'no configurado (memoria)'), memoria_entradas: mem.size };
}
async function cerrar() { try { await redis?.quit(); } catch {} }

module.exports = { iniciar, wrap, invalidar, paginaCache, contarVista, vaciarVistas, limitar, setAdd, setHas, estado, cerrar,
    _get, _set, _del };
