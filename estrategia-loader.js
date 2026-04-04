/**
 * 🎯 ESTRATEGIA LOADER - MXL EDITION V35.3
 * Este archivo carga las tendencias de Santo Domingo Este (SDE)
 * y las inyecta en el prompt de la IA.
 */

const fs = require('fs');
const path = require('path');

/**
 * Carga el archivo estrategia.json y devuelve el resumen para la IA.
 * Si el archivo no existe o falla, devuelve un string vacío para no tumbar el server.
 */
function cargarEstrategiaMXL() {
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
        const fechaGenerado = new Date(estrategia.generado);
        const ahora = new Date();
        const horasTranscurridas = (ahora - fechaGenerado) / (1000 * 60 * 60);

        if (horasTranscurridas > 7) {
            console.log(`🕒 [MXL LOADER]: Datos con ${horasTranscurridas.toFixed(1)}h de antigüedad. Se recomienda actualizar.`);
        }

        // 4. Retornar el resumen optimizado para Gemini/DeepSeek
        console.log("✅ [MXL LOADER]: Estrategia cargada con éxito.");
        return estrategia.resumen_para_gemini || "";

    } catch (error) {
        console.error("❌ [MXL LOADER] Error crítico al cargar estrategia:", error.message);
        return "";
    }
}

module.exports = { cargarEstrategiaMXL };
