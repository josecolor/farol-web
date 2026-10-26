const fs = require('fs');
const path = require('path');
const http = require('http');

console.log("🔍 [MXL AUDITORÍA GLOBAL] Analizando todo el proyecto completo...\n");
let fallos = 0;
let archivosRevisados = 0;

// Función recursiva para recorrer TODO el directorio sin excepciones tontas
function escanearDirectorio(dir) {
    const items = fs.readdirSync(dir);
    items.forEach(item => {
        const ruta = path.join(dir, item);
        const stat = fs.statSync(ruta);

        if (stat.isDirectory()) {
            // Ignorar carpetas innecesarias del sistema o dependencias de node
            if (!['node_modules', '.git', 'venv', '.railway'].includes(item)) {
                escanearDirectorio(ruta);
            }
        } else {
            archivosRevisados++;
            // Validar sintaxis estricta en archivos JavaScript
            if (item.endsWith('.js') && item !== 'health-check.js') {
                try {
                    const contenido = fs.readFileSync(ruta, 'utf8');
                    new Function(contenido); // Valida sintaxis pura del motor V8
                } catch (err) {
                    console.error(`❌ [SINTAXIS ROTA] En archivo: ${ruta}`);
                    console.error(`   Detalle: ${err.message}\n`);
                    fallos++;
                }
            }
        }
    });
}

escanearDirectorio('.');
console.log(`📁 Total de archivos escaneados en el proyecto: ${archivosRevisados}`);

// Auditoría en vivo de Ollama Local (Puerto 11434)
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
            console.log(`✅ Ollama responde perfectamente en el puerto 11434.`);
            console.log(`📦 Modelos locales listos: ${modelos.join(', ') || 'Ninguno detectado'}`);
        } catch (e) {
            console.error("⚠️ Ollama respondió pero el JSON no es válido.");
        }
        imprimirResultadoFinal(fallos);
    });
});

req.on('error', (err) => {
    console.error("❌ [ALERTA OLLAMA]: No hay conexión activa con Ollama en el puerto 11434.");
    console.error(`   Detalle: ${err.message}`);
    fallos++;
    imprimirResultadoFinal(fallos);
});

req.end();

function imprimirResultadoFinal(totalFallos) {
    console.log("\n----------------------------------------");
    if (totalFallos === 0) {
        console.log("✨ ¡Auditoría completa superada! Todo el código y Ollama están impecables.");
    } else {
        console.log(`⚠️ Se detectaron ${totalFallos} error(es) exactos que requieren tu intervención.`);
    }
    console.log("----------------------------------------\n");
}
