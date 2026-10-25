/**
 * 🎯 ESTRATEGIA LOADER — V38.1
 * Carga estrategia.json e inyecta el resumen en el prompt de Gemini.
 * FIX: variable 'ahora' declarada antes de usarse.
 */
const fs   = require('fs');
const path = require('path');

function leerEstrategia() {
    const rutaArchivo = path.join(__dirname, 'estrategia.json');
    try {
        if (!fs.existsSync(rutaArchivo)) {
            console.log('⚠️ [LOADER]: estrategia.json no encontrado. Usando prompt genérico.');
            return '';
        }

        const contenido  = fs.readFileSync(rutaArchivo, 'utf8');
        const estrategia = JSON.parse(contenido);

        // ✅ FIX: ahora declarado ANTES de usarlo
        const ahora           = new Date();
        const fechaGenerado   = new Date(estrategia.generado || ahora);
        const horasTranscurridas = (ahora - fechaGenerado) / (1000 * 60 * 60);

        if (horasTranscurridas > 7) {
            console.log(`🕒 [LOADER]: Estrategia con ${horasTranscurridas.toFixed(1)}h de antigüedad — se regenerará pronto.`);
        }

        console.log('✅ [LOADER]: Estrategia inyectada.');
        return estrategia.resumen_para_gemini || '';
    } catch (error) {
        console.error('❌ [LOADER] Error:', error.message);
        return '';
    }
}

module.exports = { leerEstrategia };
