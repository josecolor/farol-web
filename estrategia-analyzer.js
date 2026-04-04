/**
 * 🏮 EL FAROL AL DÍA — ANALIZADOR DE ESTRATEGIA
 * Analiza la base de datos y genera el archivo estrategia.json para Gemini.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuración de la base de datos (usa la misma de server.js)
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

const RUTA_ESTRATEGIA = path.join(__dirname, 'estrategia.json');

/**
 * Función principal que analiza tendencias y guarda la estrategia
 */
async function analizarYGenerar() {
    console.log('📊 Analizador: Iniciando escaneo de base de datos...');
    
    try {
        // 1. Obtener las noticias más vistas de los últimos 7 días
        const res = await pool.query(`
            SELECT seccion, COUNT(*) as cantidad, SUM(vistas) as total_vistas 
            FROM noticias 
            WHERE fecha > NOW() - INTERVAL '7 days'
            GROUP BY seccion 
            ORDER BY total_vistas DESC
        `);

        // 2. Construir el resumen para Gemini
        let resumen = "ESTRATEGIA ACTUAL DE REDACCIÓN:\n";
        
        if (res.rows.length > 0) {
            resumen += "Basado en el rendimiento reciente, prioriza estos temas:\n";
            res.rows.forEach(row => {
                const rendimiento = row.total_vistas > 100 ? 'ALTO' : 'NORMAL';
                resumen += `- ${row.seccion}: Rendimiento ${rendimiento} (${row.total_vistas} vistas).\n`;
            });
        } else {
            resumen += "Sin datos suficientes aún. Mantén el enfoque general en Santo Domingo Este.\n";
        }

        resumen += "\nINSTRUCCIÓN: Enfócate en historias humanas de los barrios de SDE. Menos política fría, más calle.";

        // 3. Crear el objeto de datos
        const datosEstrategia = {
            generado: new Date().toISOString(),
            resumen_para_gemini: resumen,
            top_categorias: res.rows.map(r => r.seccion)
        };

        // 4. Guardar el archivo JSON
        fs.writeFileSync(RUTA_ESTRATEGIA, JSON.stringify(datosEstrategia, null, 2));
        console.log('✅ Analizador: estrategia.json actualizado correctamente.');
        
        return true;
    } catch (error) {
        console.error('❌ Analizador Error:', error.message);
        // Crear un archivo básico si falla para que el loader no dé error
        const fallback = { 
            generado: new Date().toISOString(), 
            resumen_para_gemini: "Fallo en análisis. Mantener enfoque en SDE y lenguaje de barrio." 
        };
        fs.writeFileSync(RUTA_ESTRATEGIA, JSON.stringify(fallback, null, 2));
        return false;
    }
}

// 🔑 ESTA ES LA LÍNEA QUE ARREGLA EL ERROR "is not a function"
module.exports = { analizarYGenerar };
