/**
 * 🎯 ESTRATEGIA LOADER - MXL EDITION V35.3
 * Este archivo carga las tendencias de Santo Domingo Este (SDE)
 * y las inyecta en el prompt de la IA.
 */

const fs = require('fs');
const path = require('path');

/**
 * Carga el archivo estrategia.json y devuelve el resumen para la IA.
 * Nombre de función: leerEstrategia (Para coincidir con el server.js)
 */
function leerEstrategia() {
    const rutaArchivo = path.join(__dirname, 'estrategia.json');

    try {
        // 1. Verificar si el archivo existe
        if (!fs.existsSync(rutaArchivo)) {
            console.log("⚠️ [MXL LOADER]: estrategia.json no encontrado. Usando prompt genérico.");
            return "";
        }

        // 2. Leer y parsear el JSON
        const contenido = fs.readFileSync(rutaArchivo, 'utf8');
        const estrategia = JSON.parse(contenido);

        // 3. Validar frescura de datos (7 horas)
        const fechaGenerado = new Date(estrategia.generado || ahora);
        const ahora = new Date();
        const horasTranscurridas = (ahora - fechaGenerado) / (1000 * 60 * 60);

        if (horasTranscurridas > 7) {
            console.log(`🕒 [MXL LOADER]: Datos con ${horasTranscurridas.toFixed(1)}h de antigüedad.`);
        }

        // 4. Retornar el resumen para Gemini/DeepSeek
        console.log("✅ [MXL LOADER]: Estrategia inyectada correctamente.");
        return estrategia.resumen_para_gemini || "";

    } catch (error) {
        console.error("❌ [MXL LOADER] Error crítico:", error.message);
        return "";
    }
}

// 🔑 Exportado con el nombre exacto que pide tu servidor
module.exports = { leerEstrategia };
