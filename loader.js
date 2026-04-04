/**
 * 🏮 EL FAROL AL DÍA — ESTRATEGIA LOADER
 * Lee estrategia.json y devuelve el resumen para el prompt de Gemini.
 * Si el archivo no existe, devuelve string vacío (no rompe nada).
 */

const fs   = require('fs');
const path = require('path');

const RUTA_JSON = path.join(__dirname, 'estrategia.json');

function leerEstrategia() {
    try {
        if (!fs.existsSync(RUTA_JSON)) return '';
        const data = JSON.parse(fs.readFileSync(RUTA_JSON, 'utf8'));

        // Si el archivo tiene más de 7 horas, avisar (pero no fallar)
        const generado = new Date(data.generado);
        const horas    = (Date.now() - generado.getTime()) / 3600000;
        if (horas > 7) {
            console.log(`   📊 Estrategia: datos de hace ${Math.round(horas)}h (se actualizará pronto)`);
        }

        return data.resumen_para_gemini || '';
    } catch(err) {
        console.warn(`   ⚠️ estrategia-loader: ${err.message}`);
        return '';
    }
}

module.exports = { leerEstrategia };
