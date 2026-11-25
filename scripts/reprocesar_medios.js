#!/usr/bin/env node
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { procesarImagenEditorial } = require('../lib/media_editorial');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 10) : 10;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL no configurada en entorno local. Usa --apply en el servidor con acceso a Postgres.');
    process.exit(0);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const imgDir = process.env.IMG_DIR || path.join(__dirname, '..', 'static', 'img');
  const wmPath = path.join(__dirname, '..', 'static', 'watermark.png');

  try {
    const { rows } = await pool.query(
      `SELECT id, slug, titulo, imagen, imagen_nombre, imagen_fuente
       FROM noticias
       WHERE estado = 'publicada'
         AND imagen_nombre IS NOT NULL
         AND imagen_nombre <> ''
         AND COALESCE(imagen_fuente, '') NOT LIKE '%-editorial%'
       ORDER BY id DESC
       LIMIT $1`,
      [LIMIT]
    );

    console.log(`[reprocesar_medios] Modo: ${DRY_RUN ? 'DRY-RUN (simulacion)' : 'APPLY (real)'} | Candidatas: ${rows.length}`);

    for (const row of rows) {
      const srcPath = path.join(imgDir, row.imagen_nombre);
      if (!fs.existsSync(srcPath)) {
        console.log(` - #${row.id} (${row.slug}): archivo local no encontrado (${row.imagen_nombre}), omitida sin romper nada.`);
        continue;
      }

      if (DRY_RUN) {
        console.log(` - [DRY-RUN] #${row.id} (${row.slug}) -> aplicaria recorte editorial FFmpeg a ${row.imagen_nombre}`);
        continue;
      }

      const parsed = path.parse(row.imagen_nombre);
      const outName = `${parsed.name}-ed${parsed.ext || '.jpg'}`;
      const outPath = path.join(imgDir, outName);

      const res = await procesarImagenEditorial(srcPath, outPath, {
        watermarkPath: fs.existsSync(wmPath) ? wmPath : null,
      });

      if (!res.ok || res.fallback) {
        console.log(` - #${row.id}: fallo recorte editorial (${res.error || 'fallback'}), se conserva original.`);
        continue;
      }

      const nuevaUrl = row.imagen.replace(row.imagen_nombre, outName);
      const nuevaFuente = `${row.imagen_fuente || 'auto'}-editorial`;

      await pool.query(
        `UPDATE noticias SET imagen = $1, imagen_nombre = $2, imagen_fuente = $3 WHERE id = $4`,
        [nuevaUrl, outName, nuevaFuente, row.id]
      );
      console.log(` - #${row.id} (${row.slug}): actualizada OK -> ${outName}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[reprocesar_medios] Error:', e.message);
  process.exit(1);
});
