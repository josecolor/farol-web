/**
 * 🏮 EL FAROL AL DÍA — ESTRATEGIA ANALYZER
 * Analiza la BD y genera estrategia.json con los patrones ganadores.
 * Corre automáticamente cada 6 horas desde server.js.
 * NO toca ninguna lógica del servidor.
 */

const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RUTA_JSON = path.join(__dirname, 'estrategia.json');

async function analizarYGenerar() {
    console.log('📊 Estrategia: analizando BD...');
    try {
        // ── 1. Categorías con más vistas ──────────────────────
        const catVistas = await pool.query(`
            SELECT seccion, COUNT(*) as total, COALESCE(SUM(vistas),0) as vistas,
                   ROUND(AVG(vistas),1) as promedio
            FROM noticias WHERE estado='publicada' AND fecha > NOW() - INTERVAL '14 days'
            GROUP BY seccion ORDER BY promedio DESC
        `);

        // ── 2. Top 10 noticias más vistas (últimos 14 días) ───
        const topNoticias = await pool.query(`
            SELECT titulo, seccion, vistas, fecha
            FROM noticias WHERE estado='publicada' AND fecha > NOW() - INTERVAL '14 days'
            ORDER BY vistas DESC LIMIT 10
        `);

        // ── 3. Barrios que aparecen en títulos exitosos ───────
        const barrios = ['Los Mina','Invivienda','Charles de Gaulle','Ensanche Ozama',
                         'Sabana Perdida','Villa Mella','El Almirante','Los Trinitarios',
                         'El Tamarindo','Mendoza'];

        const barriosExito = {};
        for (const barrio of barrios) {
            const r = await pool.query(`
                SELECT COUNT(*) as total, COALESCE(AVG(vistas),0) as promedio
                FROM noticias
                WHERE estado='publicada'
                  AND LOWER(titulo) LIKE LOWER($1)
                  AND fecha > NOW() - INTERVAL '30 days'
            `, [`%${barrio}%`]);
            if (parseInt(r.rows[0].total) > 0) {
                barriosExito[barrio] = {
                    noticias: parseInt(r.rows[0].total),
                    promedio_vistas: Math.round(parseFloat(r.rows[0].promedio))
                };
            }
        }

        // ── 4. Palabras clave en títulos exitosos (>50 vistas) ─
        const titulosExitosos = await pool.query(`
            SELECT titulo FROM noticias
            WHERE estado='publicada' AND vistas > 50
              AND fecha > NOW() - INTERVAL '30 days'
            ORDER BY vistas DESC LIMIT 20
        `);

        const stopwords = new Set(['el','la','los','las','un','una','de','del','en','y',
            'a','se','que','por','con','su','sus','al','es','son','fue','han','ha',
            'le','les','lo','más','para','sobre','como','entre','pero','sin','ya',
            'no','si','o','e','ni','también','cuando','donde','este','esta','ese',
            'esa','muy','todo','todos','toda','todas','estos','estas']);

        const frecPalabras = {};
        for (const row of titulosExitosos.rows) {
            const palabras = row.titulo
                .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                .toLowerCase().replace(/[^a-z0-9\s]/g,' ')
                .split(/\s+/)
                .filter(w => w.length > 3 && !stopwords.has(w));
            for (const p of palabras) {
                frecPalabras[p] = (frecPalabras[p] || 0) + 1;
            }
        }
        const palabrasClave = Object.entries(frecPalabras)
            .sort((a,b) => b[1]-a[1])
            .slice(0,15)
            .map(([p,f]) => ({ palabra:p, frecuencia:f }));

        // ── 5. Mejor hora de publicación ──────────────────────
        const horasMejores = await pool.query(`
            SELECT EXTRACT(HOUR FROM fecha) as hora,
                   ROUND(AVG(vistas),1) as promedio_vistas,
                   COUNT(*) as total
            FROM noticias WHERE estado='publicada' AND fecha > NOW() - INTERVAL '30 days'
            GROUP BY hora ORDER BY promedio_vistas DESC LIMIT 5
        `);

        // ── 6. Noticias con 0 vistas (temas a evitar) ─────────
        const temasEvitar = await pool.query(`
            SELECT titulo, seccion FROM noticias
            WHERE estado='publicada' AND vistas = 0
              AND fecha > NOW() - INTERVAL '7 days'
            ORDER BY fecha DESC LIMIT 5
        `);

        // ── 7. Construir resumen para Gemini ──────────────────
        const categoriaGanadora = catVistas.rows[0]?.seccion || 'Nacionales';
        const promedioGeneral = catVistas.rows.reduce((s,r) => s + parseFloat(r.promedio), 0) / Math.max(catVistas.rows.length, 1);

        const barrioTop = Object.entries(barriosExito)
            .sort((a,b) => b[1].promedio_vistas - a[1].promedio_vistas)
            .slice(0,3)
            .map(([b]) => b);

        // ── 8. Generar el JSON ────────────────────────────────
        const estrategia = {
            generado: new Date().toISOString(),
            resumen_para_gemini: construirResumenGemini({
                categoriaGanadora,
                catVistas: catVistas.rows,
                topNoticias: topNoticias.rows,
                barrioTop,
                palabrasClave,
                horasMejores: horasMejores.rows,
                temasEvitar: temasEvitar.rows,
                promedioGeneral: Math.round(promedioGeneral)
            }),
            datos: {
                categorias: catVistas.rows,
                top_noticias: topNoticias.rows.slice(0,5),
                barrios_exitosos: barriosExito,
                palabras_clave_exitosas: palabrasClave,
                mejores_horas: horasMejores.rows,
                temas_a_evitar: temasEvitar.rows.slice(0,3),
                promedio_general_vistas: Math.round(promedioGeneral)
            }
        };

        fs.writeFileSync(RUTA_JSON, JSON.stringify(estrategia, null, 2), 'utf8');
        console.log(`✅ Estrategia actualizada: ${RUTA_JSON}`);
        console.log(`   📈 Categoría top: ${categoriaGanadora}`);
        console.log(`   🏘️  Barrios top: ${barrioTop.join(', ') || 'sin datos aún'}`);
        console.log(`   👁️  Promedio vistas: ${Math.round(promedioGeneral)}`);

    } catch(err) {
        console.error('❌ Estrategia analyzer:', err.message);
    }
}

function construirResumenGemini({ categoriaGanadora, catVistas, topNoticias, barrioTop, palabrasClave, horasMejores, temasEvitar, promedioGeneral }) {

    let resumen = `\n🎯 ESTRATEGIA EDITORIAL (basada en datos reales de El Farol al Día):\n\n`;

    // Categorías
    if (catVistas.length) {
        resumen += `📊 RENDIMIENTO POR CATEGORÍA (últimos 14 días):\n`;
        for (const c of catVistas.slice(0,4)) {
            const prom = parseFloat(c.promedio);
            const nivel = prom > promedioGeneral * 1.5 ? '🔥 MUY ALTA' : prom > promedioGeneral ? '✅ BUENA' : '⚠️ BAJA';
            resumen += `  - ${c.seccion}: ${Math.round(prom)} vistas/noticia promedio ${nivel}\n`;
        }
        resumen += `\n`;
    }

    // Categoría ganadora
    resumen += `🏆 CATEGORÍA QUE MÁS FUNCIONA AHORA: ${categoriaGanadora}\n`;
    resumen += `   → Si puedes, orienta el tema hacia ${categoriaGanadora}.\n\n`;

    // Barrios
    if (barrioTop.length) {
        resumen += `🏘️  BARRIOS QUE GENERAN MÁS CLICS EN SDE:\n`;
        for (const b of barrioTop) {
            resumen += `  - ${b}\n`;
        }
        resumen += `   → Menciona estos barrios en el título o primer párrafo si aplica.\n\n`;
    }

    // Palabras clave exitosas
    if (palabrasClave.length) {
        const topPals = palabrasClave.slice(0,8).map(p => p.palabra).join(', ');
        resumen += `🔑 PALABRAS QUE APARECEN EN TÍTULOS EXITOSOS: ${topPals}\n`;
        resumen += `   → Úsalas si son relevantes para la noticia.\n\n`;
    }

    // Top noticias
    if (topNoticias.length) {
        resumen += `📰 TITULARES QUE FUNCIONARON MEJOR RECIENTEMENTE:\n`;
        for (const n of topNoticias.slice(0,3)) {
            resumen += `  - "${n.titulo}" (${n.vistas} vistas)\n`;
        }
        resumen += `   → Toma nota del estilo: directo, específico, con contexto local.\n\n`;
    }

    // Temas a evitar
    if (temasEvitar.length) {
        resumen += `⚠️  TEMAS QUE NO ESTÁN FUNCIONANDO ESTA SEMANA:\n`;
        for (const t of temasEvitar) {
            resumen += `  - "${t.titulo}" (0 vistas)\n`;
        }
        resumen += `   → Evita ángulos similares a estos.\n\n`;
    }

    // Mejores horas
    if (horasMejores.length) {
        const horaTop = horasMejores[0];
        resumen += `⏰ MEJOR HORA DE PUBLICACIÓN: ${horaTop?.hora}h (${horaTop?.promedio_vistas} vistas promedio)\n\n`;
    }

    resumen += `--- FIN ESTRATEGIA ---\n`;
    return resumen;
}

module.exports = { analizarYGenerar };
