const fs = require('fs');
const path = require('path');
const http = require('http');

console.log("🔍 [MXL INSPECTOR] Iniciando auditoría profunda (Código + Ollama)...\n");
let fallos = 0;

// 1. Verificar archivos críticos
if (!fs.existsSync('server.js')) {
    console.error("❌ ERROR: No se encuentra el archivo 'server.js' en la raíz.");
    fallos++;
} else {
    console.log("✅ server.js presente.");
}

// 2. Escanear sintaxis de archivos JS
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

// 3. Verificar la salud de Ollama local
const req = http.request({
    hostname: '127.0.0.1',
    port: 11434,
    path: '/api/tags',
    method: 'GET',
    timeout: 3000
}, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            const modelos = json.models ? json.models.map(m => m.name) : [];
            console.log(`✅ Ollama responde correctamente.`);
            console.log(`📦 Modelos disponibles localmente: ${modelos.join(', ') || 'Ninguno detectado'}`);
        } catch (e) {
            console.error("⚠️ Ollama respondió, pero el formato no es válido.");
        }
        finalizar(fallos);
    });
});

req.on('error', (err) => {
    console.error("❌ [OLLAMA CAÍDO O INACCESIBLE]: No se pudo conectar al puerto 11434.");
    console.error(`   Detalle: ${err.message}`);
    fallos++;
    finalizar(fallos);
});

req.end();

function finalizar(totalFallos) {
    console.log("\n----------------------------------------");
    if (totalFallos === 0) {
        console.log("✨ ¡Todo en orden! Código impecable y Ollama activo.");
    } else {
        console.log(`⚠️ Se detectaron ${totalFallos} punto(s) de atención críticos.`);
    }
    console.log("----------------------------------------\n");
}
