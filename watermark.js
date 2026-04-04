const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { RUTAS } = require('./config-mxl');

async function aplicarMarcaDeAgua(urlImagen) {
    try {
        const response = await fetch(urlImagen);
        const buffer = Buffer.from(await response.arrayBuffer());
        const nombre = `efd-${Date.now()}.jpg`;
        const output = path.join(RUTAS.TMP_DIR, nombre);

        await sharp(buffer)
            .composite([{ input: RUTAS.WATERMARK_PATH, gravity: 'southeast' }])
            .toFile(output);

        return { procesada: true, nombre };
    } catch (e) {
        return { procesada: false };
    }
}

module.exports = { aplicarMarcaDeAgua };
