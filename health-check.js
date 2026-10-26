const fs = require('fs');
const path = require('path');

console.log("🔍 [MXL INSPECTOR] Buscando errores de sintaxis y archivos críticos...\n");
let fallos = 0;

// Verificar que server.js exista
if (!fs.existsSync('server.js')) {
    console.error("❌ ERROR: No se encuentra el archivo 'server.js' en la raíz.");
    fallos++;
} else {
    console.log("✅ server.js presente.");
}

// Escanear sintaxis de archivos JS
function revisar(dir) {
    fs.readdirSync(dir).forEach(file => {
        const ruta = path.join(dir, file);
        if (fs.statSync(ruta).isDirectory()) {
            if (!['node_modules', '.git', 'venv'].includes(file)) {
                revisar(ruta);
            }
        } else if (file.endsWith('.js') && file !== 'health-check.js') {
            try {
                new Function(fs.readFileSync(ruta, 'utf8'));
            } catch (err) {
                console.error(`❌ [SINTAXIS ROTA] Archivo: ${ruta}`);
                console.error(`   Detalle: ${err.message}\n`);
                fallos++;
            }
        }
    });
}

revisar('.');

console.log("----------------------------------------");
if (fallos === 0) {
    console.log("✨ ¡Cero errores de sintaxis detectados! Todo en orden.");
} else {
    console.log(`⚠️ Se encontraron ${fallos} error(es) exactos listados arriba.`);
}
console.log("----------------------------------------\n");
