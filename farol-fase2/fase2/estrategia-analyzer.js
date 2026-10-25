/**
 * 🏮 EL FAROL AL DÍA — ANALIZADOR DE ESTRATEGIA V38.1
 * Analiza BD y genera estrategia.json para Gemini.
 * MEJORAS: palabras clave exitosas, horas pico, barrios con más engagement.
 */
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RUTA_ESTRATEGIA = path.join(__dirname, 'estrategia.json');

async function analizarYGenerar() {
    console.log('📊 Analizador V38.1: Iniciando escaneo...');
    try {
        // 1. Top categorías por vistas (30 días)
        const resCats = await pool.query(`
            SELECT seccion,
                   COUNT(*) as cantidad,
                   SUM(vistas) as total_vistas,
                   ROUND(AVG(vistas)) as prom_vistas
            FROM noticias
            WHERE fecha > NOW() - INTERVAL '30 days' AND estado = 'publicada'
            GROUP BY seccion
            ORDER BY total_vistas DESC
        `);

        // 2. Noticias top — palabras clave de títulos exitosos
        const resTop = await pool.query(`
            SELECT titulo, vistas, seccion
            FROM noticias
            WHERE fecha > NOW() - INTERVAL '30 days'
              AND estado = 'publicada'
              AND vistas > 0
            ORDER BY vistas DESC
            LIMIT 10
        `);

        // 3. Horas pico reales
        const resHoras = await pool.query(`
            SELECT EXTRACT(HOUR FROM fecha)::int as hora,
                   ROUND(AVG(vistas)) as prom_vistas
            FROM noticias
            WHERE fecha > NOW() - INTERVAL '14 days' AND estado = 'publicada'
            GROUP BY hora
            ORDER BY prom_vistas DESC
            LIMIT 5
        `);

        // 4. Promedio general
        const resGlobal = await pool.query(`
            SELECT ROUND(AVG(vistas)) as prom,
                   MAX(vistas) as maximo,
                   COUNT(*) as total
            FROM noticias
            WHERE fecha > NOW() - INTERVAL '30 days' AND estado = 'publicada'
        `);

        const global   = resGlobal.rows[0] || { prom: 0, maximo: 0, total: 0 };
        const topCats  = resCats.rows;
        const topNots  = resTop.rows;
        const horasPico = resHoras.rows.map(h => `${h.hora}:00h`);

        // ── Construir resumen para Gemini ──────────────────────────
        let resumen = `📊 ESTRATEGIA EL FAROL AL DÍA — ${new Date().toLocaleDateString('es-DO')}:\n\n`;

        // Categorías que funcionan
        if (topCats.length) {
            const mejorCat = topCats[0];
            resumen += `🏆 MEJOR CATEGORÍA: ${mejorCat.seccion} (${mejorCat.prom_vistas} vistas promedio).\n`;
            resumen += `📈 RANKING DE CATEGORÍAS:\n`;
            topCats.forEach((c, i) => {
                const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▫️';
                resumen += `  ${emoji} ${c.seccion}: ${c.prom_vistas} vistas prom (${c.cantidad} noticias)\n`;
            });
            resumen += '\n';
        }

        // Noticias exitosas
        if (topNots.length) {
            resumen += `🔥 NOTICIAS MÁS VISTAS (aprende su fórmula):\n`;
            topNots.slice(0, 5).forEach((n, i) => {
                resumen += `  ${i + 1}. [${n.vistas} vistas] "${n.titulo}"\n`;
            });
            resumen += '\n';
        }

        // Horas pico
        if (horasPico.length) {
            resumen += `⏰ MEJORES HORAS PARA PUBLICAR: ${horasPico.join(', ')}\n`;
        }

        // Meta
        const metaVistas = parseInt(global.prom || 0) * 2;
        resumen += `\n🎯 META: Promedio actual = ${global.prom} vistas. Esta noticia debe superar ${metaVistas} (2x).\n`;

        // Instrucción táctica
        const catTop = topCats[0]?.seccion || 'Nacionales';
        resumen += `\n💡 TÁCTICA: La categoría "${catTop}" rinde mejor. Enfócate en historias humanas de Los Mina, Invivienda y Charles de Gaulle. Lenguaje de barrio, párrafos cortos, datos concretos.`;

        // ── Guardar estrategia.json ────────────────────────────────
        const datosEstrategia = {
            generado: new Date().toISOString(),
            resumen_para_gemini: resumen,
            datos: {
                categorias_top:          topCats.map(c => c.seccion),
                mejores_horas:           horasPico,
                promedio_general_vistas: parseInt(global.prom || 0),
                max_vistas:              parseInt(global.maximo || 0),
                total_noticias_30d:      parseInt(global.total || 0),
            }
        };

        fs.writeFileSync(RUTA_ESTRATEGIA, JSON.stringify(datosEstrategia, null, 2));
        console.log(`✅ Analizador V38.1: estrategia.json actualizado (${resumen.length} chars).`);
        return true;

    } catch (error) {
        console.error('❌ Analizador Error:', error.message);
        // Fallback básico para que el loader no falle
        const fallback = {
            generado: new Date().toISOString(),
            resumen_para_gemini: 'Sin datos suficientes aún. Mantén enfoque en SDE con lenguaje de barrio directo y párrafos cortos.'
        };
        fs.writeFileSync(RUTA_ESTRATEGIA, JSON.stringify(fallback, null, 2));
        return false;
    }
}

module.exports = { analizarYGenerar };
