'use strict';
/**
 * DEPURADOR ESTRICTO — una imagen solo pasa si cumple TODO:
 *  A. Metadatos: licencia permitida, no es de banco comercial, sin palabras de riesgo, tamaño mínimo
 *  B. Descarga segura: https, anti-SSRF (IPs privadas), límite de bytes/tiempo, redirecciones validadas
 *  C. Contenido: es imagen real (magic bytes vía sharp), no animada, no plana/gráfico, no duplicada
 */
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const sharp = require('sharp');
const cache = require('../cache');

const MIN_ANCHO = parseInt(process.env.IMG_MIN_ANCHO || '1000');
const MIN_ALTO  = parseInt(process.env.IMG_MIN_ALTO  || '560');
const MAX_BYTES = 15 * 1024 * 1024;

const DOMINIOS_BLOQUEADOS = ['shutterstock','gettyimages','istockphoto','adobe.com','stock.adobe','dreamstime','alamy','depositphotos',
    '123rf','vectorstock','bigstockphoto','pinterest','facebook','fbcdn','instagram','twimg','tiktok','google.com','gstatic','bing.','tineye'];
const PALABRAS_RIESGO = ['getty','shutterstock','stock photo','watermark','marca de agua','©','all rights reserved','press photo','agencia',
    'nude','naked','nsfw','porn','erotic','gore','corpse','cadaver','cadáver','autopsy','dead body','suicide','genital','explicit','swastika','logo','coat of arms','flag of','diagram','map of','screenshot'];

const RIESGO_RE = new Map(PALABRAS_RIESGO.map(p => [p, new RegExp('(^|[^a-záéíóúñ])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-záéíóúñ])', 'i')]));
function _txt(c) { return `${c.titulo} ${c.descripcion} ${(c.categorias || []).join(' ')} ${c.urlPagina || ''}`.toLowerCase(); }

/** Fase A: solo metadatos (barata, sin descargar). */
function evaluarMetadatos(c) {
    if (!c?.urlDescarga) return { ok: false, motivo: 'sin URL' };
    if (!c.licencia?.permitida) return { ok: false, motivo: c.licencia?.motivo || 'licencia no permitida' };
    let host; try { const u = new URL(c.urlDescarga); if (u.protocol !== 'https:') return { ok: false, motivo: 'no https' }; host = u.hostname.toLowerCase(); }
    catch { return { ok: false, motivo: 'URL inválida' }; }
    if (DOMINIOS_BLOQUEADOS.some(d => host.includes(d))) return { ok: false, motivo: `dominio bloqueado (${host})` };
    const t = _txt(c);
    const r = PALABRAS_RIESGO.find(p => RIESGO_RE.get(p).test(t));
    if (r) return { ok: false, motivo: `palabra de riesgo "${r}"` };
    if (/non-?free|fair use|copyvio|speedy deletion|no permission/i.test(c.categorias?.join(' ') || '')) return { ok: false, motivo: 'categoría de copyright dudoso' };
    if ((c.anchoOriginal || c.ancho || 0) < MIN_ANCHO || (c.altoOriginal || c.alto || 0) < MIN_ALTO) return { ok: false, motivo: 'resolución baja' };
    const ratio = (c.ancho || 1) / (c.alto || 1);
    if (ratio < 0.65 || ratio > 3) return { ok: false, motivo: 'proporción extrema' };
    return { ok: true };
}

// ── Anti-SSRF ──────────────────────────────────────────────
function _ipPrivada(ip) {
    if (net.isIPv6(ip)) return /^(::1|fc|fd|fe80)/i.test(ip) || ip.startsWith('::ffff:127.') || ip.startsWith('::ffff:10.');
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
async function _urlSegura(u) {
    const x = new URL(u);
    if (x.protocol !== 'https:') throw new Error('solo https');
    if (net.isIP(x.hostname)) { if (_ipPrivada(x.hostname)) throw new Error('IP privada'); return; }
    const r = await dns.lookup(x.hostname, { all: true });
    if (!r.length || r.some(a => _ipPrivada(a.address))) throw new Error('host resuelve a red privada');
}

/** Fase B: descarga acotada, con redirecciones validadas una a una. */
async function descargar(url, ua) {
    let actual = url;
    for (let salto = 0; salto < 4; salto++) {
        await _urlSegura(actual);
        const r = await fetch(actual, { redirect: 'manual', headers: { 'User-Agent': ua, Accept: 'image/*' }, signal: AbortSignal.timeout(20000) });
        if ([301, 302, 303, 307, 308].includes(r.status)) { actual = new URL(r.headers.get('location'), actual).toString(); continue; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!/^image\/(jpeg|png|webp)/.test(ct)) throw new Error(`content-type ${ct}`);
        if (Number(r.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('archivo muy grande');
        const partes = []; let total = 0;
        for await (const p of r.body) { total += p.length; if (total > MAX_BYTES) throw new Error('archivo muy grande'); partes.push(p); }
        return Buffer.concat(partes);
    }
    throw new Error('demasiadas redirecciones');
}

/** Descarga acotada de una PÁGINA HTML (extractor web): https, anti-SSRF, redirecciones validadas, máx. 1.5 MB. */
async function descargarPagina(url, ua, { xml = false } = {}) {
    let actual = url;
    for (let salto = 0; salto < 4; salto++) {
        await _urlSegura(actual);
        const r = await fetch(actual, { redirect: 'manual', headers: { 'User-Agent': ua, Accept: xml ? 'application/rss+xml,application/xml,text/xml,*/*' : 'text/html,application/xhtml+xml', 'Accept-Language': 'es-DO,es;q=0.9,en;q=0.6' }, signal: AbortSignal.timeout(12000) });
        if ([301, 302, 303, 307, 308].includes(r.status)) { actual = new URL(r.headers.get('location'), actual).toString(); continue; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!/(html|xml)/.test(ct)) throw new Error(`content-type ${ct}`);
        const MAX = 1.5 * 1024 * 1024; const partes = []; let total = 0;
        for await (const p of r.body) { total += p.length; partes.push(p); if (total > MAX) break; }      // el <head> con og:image está al inicio
        return { html: Buffer.concat(partes).toString('utf8'), urlFinal: actual };
    }
    throw new Error('demasiadas redirecciones');
}

/** Fase C: inspección del contenido real. Devuelve huella perceptual para deduplicar. */
async function inspeccionar(buf, { minAncho = MIN_ANCHO, minAlto = MIN_ALTO } = {}) {
    let meta;
    try { meta = await sharp(buf, { limitInputPixels: 80e6 }).metadata(); } catch { return { ok: false, motivo: 'no es una imagen válida' }; }
    if (!['jpeg', 'png', 'webp'].includes(meta.format)) return { ok: false, motivo: `formato ${meta.format}` };
    if ((meta.pages || 1) > 1) return { ok: false, motivo: 'animada' };
    if ((meta.width || 0) < minAncho || (meta.height || 0) < minAlto) return { ok: false, motivo: `resolución real baja (${meta.width}x${meta.height})` };
    const st = await sharp(buf).stats();
    if (st.entropy < 4.5) return { ok: false, motivo: `imagen plana/gráfico (entropía ${st.entropy.toFixed(1)})` };
    const peq = await sharp(buf).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
    const media = peq.reduce((a, b) => a + b, 0) / peq.length;
    const huella = crypto.createHash('md5').update(Buffer.from(peq.map(v => (v > media ? 1 : 0)))).digest('hex');
    return { ok: true, ancho: meta.width, alto: meta.height, huella, entropia: st.entropy };
}

async function yaUsada(c, huella) {
    if (await cache.setHas('img:usadas', c.id)) return 'ya usada en otra noticia';
    if (huella && await cache.setHas('img:huellas', huella)) return 'duplicada (misma huella visual)';
    return null;
}
async function marcarUsada(c, huella) {
    const d = 21 * 24 * 3600;
    await cache.setAdd('img:usadas', c.id, d); if (huella) await cache.setAdd('img:huellas', huella, d);
}

module.exports = { evaluarMetadatos, descargar, descargarPagina, inspeccionar, yaUsada, marcarUsada, DOMINIOS_BLOQUEADOS, urlSegura: _urlSegura };
