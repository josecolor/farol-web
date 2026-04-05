// watermark.js - MARCA DE AGUA
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function aplicarMarcaDeAgua(urlImagen, watermarkPath, tmpDir = '/tmp') {
    if (!watermarkPath || !fs.existsSync(watermarkPath)) {
        return { procesada: false, error: 'No watermark' };
    }
    
    try {
        const response = await fetch(urlImagen);
        if (!response.ok) return { procesada: false };
        
        const buffer = Buffer.from(await response.arrayBuffer());
        const nombre = `efd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
        const output = path.join(tmpDir, nombre);
        
        await sharp(buffer)
            .composite([{ input: watermarkPath, gravity: 'southeast' }])
            .jpeg({ quality: 85 })
            .toFile(output);
        
        return { procesada: true, nombre };
    } catch (e) {
        console.error('Watermark error:', e.message);
        return { procesada: false };
    }
}

module.exports = { aplicarMarcaDeAgua };
