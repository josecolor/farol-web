// Regenera static/watermark.png (farolito transparente) a partir de static/favicon.png.
// Úsalo solo si no tienes tu watermark definitiva:  node scripts/generar-watermark.js
const fs = require('fs'), path = require('path'), sharp = require('sharp');
const { derivarDeFavicon } = require('../lib/imagenes/marca');
(async () => {
    const b = await derivarDeFavicon(); if (!b) throw new Error('No hay static/favicon.png');
    const out = await sharp(b).resize(320, 140, { fit: 'inside' }).png().toBuffer();
    fs.writeFileSync(path.join(__dirname, '..', 'static', 'watermark.png'), out);
    console.log('✅ static/watermark.png generado (' + out.length + ' bytes)');
})();
