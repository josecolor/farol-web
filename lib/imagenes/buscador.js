'use strict';
const dbg = (...a) => { if (process.env.LOG_DETALLE === '1') dbg(...a); };   // progreso solo con LOG_DETALLE=1
/**
 * Buscador web de fotografías REALES con licencia verificable.
 * Fuentes (sin API key):
 *   1) Wikimedia Commons  — metadatos de licencia/autor por archivo
 *   2) Openverse          — agregador de CC0/PDM/CC-BY (filtrado por fuentes de confianza)
 * NO se busca en Google Imágenes/Bing: no hay forma fiable de saber la licencia de una imagen "cualquiera".
 */
const { clasificar, strip } = require('./licencias');
const cache = require('../cache');

const UA = process.env.IMG_USER_AGENT || 'ElFarolAlDia/2.0 (https://elfarolaldia.com; contacto@elfarolaldia.com)';
// Openverse: fuentes aceptadas (Flickr y similares quedan fuera por defecto: la licencia la declara el usuario que sube)
const FUENTES_OV = (process.env.OPENVERSE_FUENTES || 'wikimedia,nasa,smithsonian').split(',').map(s => s.trim());
if (process.env.PERMITIR_FLICKR === '1') FUENTES_OV.push('flickr');

async function _json(url, ms = 12000) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

async function buscarCommons(q, limite = 15) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    Object.entries({
        action: 'query', format: 'json', generator: 'search', gsrnamespace: 6, gsrlimit: limite,
        gsrsearch: `${q} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: 1600,
        iiextmetadatafilter: 'LicenseShortName|UsageTerms|Artist|Credit|ImageDescription|Categories|Restrictions|Copyrighted|AttributionRequired',
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    const j = await _json(u.toString());
    return Object.values(j.query?.pages || {}).map(p => {
        const ii = p.imageinfo?.[0]; if (!ii) return null;
        const md = ii.extmetadata || {}; const g = k => md[k]?.value || '';
        const lic = clasificar(g('LicenseShortName') || g('UsageTerms'));
        return {
            id: `commons:${p.pageid}`, proveedor: 'Wikimedia Commons',
            urlDescarga: ii.thumburl || ii.url, urlPagina: ii.descriptionurl,
            titulo: strip(p.title.replace(/^File:/, '').replace(/\.\w+$/, '')),
            descripcion: strip(g('ImageDescription')).slice(0, 400),
            autor: strip(g('Artist')).slice(0, 120) || strip(g('Credit')).slice(0, 120) || 'Autor desconocido',
            categorias: strip(g('Categories')).split('|').slice(0, 15),
            restricciones: strip(g('Restrictions')),
            licencia: lic, licenciaCruda: strip(g('LicenseShortName')),
            ancho: ii.thumbwidth || ii.width, alto: ii.thumbheight || ii.height,
            anchoOriginal: ii.width, altoOriginal: ii.height, mime: ii.mime,
        };
    }).filter(Boolean);
}

async function buscarOpenverse(q, limite = 15) {
    const u = new URL('https://api.openverse.org/v1/images/');
    Object.entries({ q, license: 'cc0,pdm,by', category: 'photograph', size: 'large', page_size: limite,
        extension: 'jpg,png' }).forEach(([k, v]) => u.searchParams.set(k, v));
    const j = await _json(u.toString());
    return (j.results || []).filter(r => FUENTES_OV.includes(String(r.source || '').toLowerCase())).map(r => ({
        id: `openverse:${r.id}`, proveedor: `Openverse/${r.source}`,
        urlDescarga: r.url, urlPagina: r.foreign_landing_url,
        titulo: strip(r.title), descripcion: (r.tags || []).map(t => t.name).join(' ').slice(0, 300),
        autor: strip(r.creator) || 'Autor desconocido', categorias: [],
        licencia: clasificar(r.license === 'pdm' ? 'public domain' : r.license === 'cc0' ? 'cc0' : `cc by ${r.license_version || ''}`, r.license_version),
        licenciaCruda: `${r.license} ${r.license_version || ''}`.trim(),
        ancho: r.width, alto: r.height, anchoOriginal: r.width, altoOriginal: r.height, mime: r.filetype ? `image/${r.filetype}` : '',
    }));
}

/** Busca en ambas fuentes (en paralelo, tolerante a fallos, cacheado 6 h para no golpear las APIs). */
async function buscar(q) {
    return cache.wrap('imgbusq', q.toLowerCase(), 6 * 3600, async () => {
        const r = await Promise.allSettled([buscarCommons(q), buscarOpenverse(q)]);
        r.forEach((x, i) => x.status === 'rejected' && dbg(`   ⚠️ [img] ${i ? 'Openverse' : 'Commons'}: ${x.reason.message}`));
        return r.flatMap(x => x.status === 'fulfilled' ? x.value : []);
    });
}
module.exports = { buscar, buscarCommons, buscarOpenverse };
