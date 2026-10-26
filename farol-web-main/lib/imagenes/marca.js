'use strict';
/**
 * Marca de agua + normalización (1200x675, sin EXIF/GPS) + tarjeta de marca de respaldo.
 * La marca se VALIDA al primer uso: si static/watermark.png no es una imagen real (en el repo original pesaba 2 bytes),
 * se deriva automáticamente del farolito de static/favicon.png y se avisa en el log.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const W = 1200, H = 675;
const MAX_W = Math.round(W * 0.26), MAX_H = Math.round(H * 0.18);

const carpetas = () => [path.join(process.cwd(), 'static'), path.join(__dirname, '..', '..', 'static')];
const buscar = nombres => { for (const b of carpetas()) for (const n of nombres) { const f = path.join(b, n); if (fs.existsSync(f)) return f; } return null; };

/** Farolito del favicon sobre negro → PNG transparente (alpha a partir del brillo). */
async function derivarDeFavicon() {
    const fav = buscar(['favicon.png', 'img/favicon.png']); if (!fav) return null;
    const m = await sharp(fav).metadata();
    // Recorte centrado en el farol (proporciones del favicon 1024x1536 original; se escala si es otro tamaño)
    const ex = { left: Math.round(m.width * 0.28), top: Math.round(m.height * 0.24), width: Math.round(m.width * 0.43), height: Math.round(m.height * 0.38) };
    const { data, info } = await sharp(fav).extract(ex).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) data[i + 3] = Math.max(0, Math.min(255, (Math.max(data[i], data[i + 1], data[i + 2]) - 14) * 7));
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();
}

let _wm = null;
function cargarMarca() {
    if (_wm) return _wm;
    _wm = (async () => {
        const f = buscar(['watermark.png', 'WATERMARK.png', 'watermark (1).png']);
        if (f) {
            try { const m = await sharp(f).metadata(); if (m.width > 20) return await sharp(f).resize(MAX_W, MAX_H, { fit: 'inside' }).png().toBuffer(); }
            catch { /* archivo corrupto → respaldo */ }
            console.error(`❌ [marca] ${f} NO es una imagen válida (${fs.statSync(f).size} bytes). Sube tu watermark.png real. Usando el farolito del favicon mientras tanto.`);
        }
        try { const b = await derivarDeFavicon(); if (b) return await sharp(b).resize(MAX_W, MAX_H, { fit: 'inside' }).png().toBuffer(); } catch (e) { console.error('❌ [marca] respaldo falló:', e.message); }
        console.error('❌ [marca] SIN marca de agua disponible');
        return null;
    })();
    return _wm;
}

/** Recorta inteligente (zona de interés) a 16:9 y estampa la marca abajo a la derecha. */
async function aplicarMarca(buf) {
    let img = sharp(buf, { limitInputPixels: 80e6 }).rotate()
        .resize(W, H, { fit: 'cover', position: sharp.strategy.attention });
    const wm = await cargarMarca();
    if (wm) {
        const mt = await sharp(wm).metadata(); const mg = Math.round(W * 0.025);
        img = img.composite([{ input: wm, left: W - mt.width - mg, top: H - mt.height - mg, blend: 'over' }]);
    }
    return { buffer: await img.jpeg({ quality: 85, mozjpeg: true }).toBuffer(), marcada: !!wm };   // sin withMetadata → sin EXIF/GPS
}

/** Respaldo 100% propio (cero copyright): fondo de marca + logo centrado. Sin texto (no depende de fuentes del servidor). */
async function tarjetaMarca(categoria = '') {
    const hue = [...categoria].reduce((a, c) => a + c.charCodeAt(0), 0) % 40;
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070707"/>
      <stop offset="1" stop-color="hsl(${15 + hue},100%,14%)"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/><rect x="0" y="${H - 8}" width="${W}" height="8" fill="#FF5500"/></svg>`);
    let img = sharp(svg);
    const wm = await cargarMarca();
    if (wm) { const big = await sharp(wm).resize(Math.round(W * 0.3), Math.round(H * 0.6), { fit: 'inside' }).toBuffer(); img = img.composite([{ input: big, gravity: 'center' }]); }
    return { buffer: await img.jpeg({ quality: 88 }).toBuffer(), marcada: !!wm };
}
module.exports = { aplicarMarca, tarjetaMarca, cargarMarca, derivarDeFavicon };
