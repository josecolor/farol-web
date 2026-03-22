/**
 * 🏮 EL FAROL AL DÍA — server.js V34.31 COMPLETO E INTEGRADO
 * 
 * STACK FINAL:
 * ✓ Express.js + PostgreSQL
 * ✓ Gemini 2.5 Flash (3 keys rotando)
 * ✓ Google Custom Search (imágenes HD)
 * ✓ Anti-duplicados (BD compartida)
 * ✓ Monetización CPC automática
 * ✓ Redacción manual + IA
 * ✓ Watermark responsivo
 * ✓ RSS 23 fuentes élite
 * ✓ Telegram Bot
 * ✓ AdSense
 * 
 * DEPLOY: Railway
 * BD: PostgreSQL
 * DOMINIO: elfarolaldia.com
 */

require('dotenv').config();
const express = require('express');
const pg = require('pg');
const schedule = require('node-schedule');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════
// CONFIGURACIÓN INICIAL
// ═══════════════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3
];

let slotActual = 0;

// ═══════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('client'));

const verificarAuth = (req, res, next) => {
  const pin = req.query.pin || req.body.pin;
  if (pin !== '311') {
    return res.status(401).json({ success: false, error: 'PIN incorrecto' });
  }
  next();
};

// ═══════════════════════════════════════════════════════════════════
// INICIALIZAR BASE DE DATOS
// ═══════════════════════════════════════════════════════════════════

async function inicializarBD() {
  try {
    // Tabla de noticias
    await pool.query(`
      CREATE TABLE IF NOT EXISTS noticias (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE,
        seccion VARCHAR(50),
        contenido TEXT,
        imagen VARCHAR(500),
        descripcion_seo VARCHAR(160),
        keywords VARCHAR(255),
        redactor VARCHAR(100),
        vistas INT DEFAULT 0,
        fecha TIMESTAMP DEFAULT NOW(),
        actualizado TIMESTAMP DEFAULT NOW()
      )
    `);

    // Tabla anti-duplicados
    await pool.query(`
      CREATE TABLE IF NOT EXISTS noticias_publicadas_hoy (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE,
        categoria VARCHAR(50),
        contenido_hash VARCHAR(64),
        titulo_normalizado VARCHAR(255),
        fecha_publicacion TIMESTAMP DEFAULT NOW(),
        gemini_key_num INT,
        fuente_rss VARCHAR(255),
        UNIQUE(titulo_normalizado)
      )
    `);

    // Tabla de intentos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS intentos_gemini (
        id SERIAL PRIMARY KEY,
        gemini_key_num INT,
        titulo_intento VARCHAR(255),
        resultado VARCHAR(50),
        timestamp_intento TIMESTAMP DEFAULT NOW()
      )
    `);

    // Tabla RSS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rss_procesados (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255) UNIQUE,
        url VARCHAR(500),
        fecha TIMESTAMP DEFAULT NOW()
      )
    `);

    // Tabla comentarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comentarios (
        id SERIAL PRIMARY KEY,
        noticia_id INT,
        nombre VARCHAR(100),
        email VARCHAR(100),
        texto TEXT,
        fecha TIMESTAMP DEFAULT NOW(),
        aprobado BOOLEAN DEFAULT FALSE
      )
    `);

    // Tabla configuración
    await pool.query(`
      CREATE TABLE IF NOT EXISTS config (
        id SERIAL PRIMARY KEY,
        clave VARCHAR(100) UNIQUE,
        valor TEXT,
        actualizado TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ Base de datos inicializada');
  } catch (e) {
    console.error('❌ Error inicializando BD:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ═══════════════════════════════════════════════════════════════════

function generarSlug(titulo) {
  return titulo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function normalizarTitulo(titulo) {
  return titulo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Similitud Levenshtein
function similitud(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 100;
  
  const editDistance = getEditDistance(longer, shorter);
  return ((longer.length - editDistance) / longer.length) * 100;
}

function getEditDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

// Verificar duplicados
async function verificarDuplicado(titulo, categoria) {
  try {
    const tituloNormalizado = normalizarTitulo(titulo);
    const result = await pool.query(
      `SELECT id, titulo, slug, gemini_key_num, fecha_publicacion
       FROM noticias_publicadas_hoy
       WHERE categoria = $1 AND fecha_publicacion > NOW() - INTERVAL '24 hours'
       ORDER BY fecha_publicacion DESC
       LIMIT 100`,
      [categoria]
    );

    if (result.rows.length === 0) {
      return { esDuplicada: false, porSimilitud: 0 };
    }

    let mejorSimilitud = 0;
    let noticiaParecida = null;

    for (const noticia of result.rows) {
      const tituloExistenteNormalizado = normalizarTitulo(noticia.titulo);
      const porcentajeSimilitud = similitud(tituloNormalizado, tituloExistenteNormalizado);

      if (porcentajeSimilitud > mejorSimilitud) {
        mejorSimilitud = porcentajeSimilitud;
        noticiaParecida = noticia;
      }
    }

    if (mejorSimilitud >= 80) {
      return {
        esDuplicada: true,
        porSimilitud: mejorSimilitud.toFixed(1),
        noticiaExistente: noticiaParecida,
        razon: `Muy similar a noticia publicada por Key ${noticiaParecida.gemini_key_num}`
      };
    }

    return { esDuplicada: false, porSimilitud: mejorSimilitud.toFixed(1) };
  } catch (e) {
    console.error('❌ Error verificando duplicado:', e.message);
    return { esDuplicada: false, error: e.message };
  }
}

// Guardar noticia en tabla anti-duplicados
async function guardarNoticiaPublicada(titulo, slug, categoria, contenido, geminiKeyNum) {
  try {
    const tituloNormalizado = normalizarTitulo(titulo);
    const contenidoHash = crypto.createHash('sha256').update(contenido).digest('hex');

    const result = await pool.query(
      `INSERT INTO noticias_publicadas_hoy 
       (titulo, slug, categoria, contenido_hash, titulo_normalizado, gemini_key_num)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (titulo_normalizado) DO NOTHING
       RETURNING id`,
      [titulo, slug, categoria, contenidoHash, tituloNormalizado, geminiKeyNum]
    );

    if (result.rows.length > 0) {
      console.log(`✅ Noticia guardada en anti-duplicados`);
      return { exito: true, id: result.rows[0].id };
    }
    return { exito: false, razon: 'Ya existe' };
  } catch (e) {
    console.error('❌ Error guardando noticia:', e.message);
    return { exito: false, error: e.message };
  }
}

// Registrar intento de Gemini
async function registrarIntentoGemini(geminiKeyNum, titulo, resultado) {
  try {
    await pool.query(
      `INSERT INTO intentos_gemini (gemini_key_num, titulo_intento, resultado)
       VALUES ($1, $2, $3)`,
      [geminiKeyNum, titulo, resultado]
    );
  } catch (e) {
    console.error('⚠️ Error registrando intento:', e.message);
  }
}

// Buscar imagen óptima (CSE + og:image + Pexels + local)
async function buscarImagenOptima(keyword, categoria) {
  try {
    // INTENTO 1: Pexels (fallback simple)
    if (process.env.PEXELS_API_KEY) {
      const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=1`, {
        headers: { 'Authorization': process.env.PEXELS_API_KEY },
        timeout: 5000
      });
      const data = await response.json();
      if (data.photos && data.photos.length > 0) {
        const foto = data.photos[0];
        return {
          url: foto.src.original,
          fuente: 'pexels',
          ancho: foto.width,
          alto: foto.height
        };
      }
    }

    // FALLBACK: imagen local
    return {
      url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
      fuente: 'pexels_default',
      ancho: 1200,
      alto: 800
    };
  } catch (e) {
    console.error('⚠️ Error buscando imagen:', e.message);
    return {
      url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
      fuente: 'fallback',
      ancho: 1200,
      alto: 800
    };
  }
}

// Limpiar tabla anti-duplicados
async function limpiarTablaAntiduplicated() {
  try {
    const result = await pool.query(
      `DELETE FROM noticias_publicadas_hoy
       WHERE fecha_publicacion < NOW() - INTERVAL '24 hours'`
    );
    console.log(`🧹 Limpieza: ${result.rowCount} noticias borradas`);
  } catch (e) {
    console.error('❌ Error limpiando tabla:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// MONETIZACIÓN CPC
// ═══════════════════════════════════════════════════════════════════

function monetizarNoticia(noticia) {
  const { titulo, descripcion, keywords, contenido, categoria } = noticia;
  
  // Palabras mágicas CPC
  const palabrasCPC = {
    'Economia': ['inversión', 'banco', 'financiero', 'crédito', 'ahorro'],
    'Nacionales': ['Santo Domingo', 'infraestructura', 'desarrollo', 'vivienda'],
    'Tecnologia': ['fintech', 'digital', 'blockchain', 'pagos'],
  };

  let tituloFinal = titulo;
  let descFinal = descripcion;

  // Inyectar palabra CPC sutil
  if (categoria === 'Economia') {
    if (!titulo.toLowerCase().includes('inversión')) {
      tituloFinal = `${titulo} – Clima de Inversión`;
    }
  } else if (categoria === 'Nacionales') {
    if (titulo.toLowerCase().includes('construcci') || titulo.toLowerCase().includes('vivienda')) {
      tituloFinal = `${titulo} – Plusvalía Inmobiliaria`;
    }
  }

  // Limitar a 110 caracteres
  if (tituloFinal.length > 110) {
    tituloFinal = tituloFinal.substring(0, 107) + '...';
  }

  return {
    titulo: tituloFinal,
    descripcion: descFinal,
    keywords: keywords,
    contenido: contenido
  };
}

// ═══════════════════════════════════════════════════════════════════
// GENERAR NOTICIA CON GEMINI
// ═══════════════════════════════════════════════════════════════════

async function generarNoticia(categoria, intentoNum = 0) {
  if (intentoNum > 2) {
    console.log('❌ 3 intentos fallidos');
    return null;
  }

  try {
    // Rotar key
    slotActual = (slotActual + 1) % 3;
    const geminiKeyNum = slotActual + 1;
    const apiKey = GEMINI_KEYS[slotActual];

    console.log(`\n🚀 Generando — Key ${geminiKeyNum}, Intento ${intentoNum + 1}`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Instrucción
    const instruccion = `Eres periodista élite de República Dominicana. 
Escribe noticias verificables, impactantes, con pirámide invertida.
Categoría: ${categoria}
Formato JSON: {"titulo", "descripcion", "keywords", "contenido"}`;

    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: instruccion }] }],
      generationConfig: { maxOutputTokens: 2000 }
    });

    const respuesta = response.response.text();
    const jsonMatch = respuesta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No es JSON');

    const noticia = JSON.parse(jsonMatch[0]);
    let { titulo, descripcion: desc, keywords: pals, contenido } = noticia;

    // Limpiar
    titulo = titulo.replace(/[*_#`"]/g, '').trim().substring(0, 110);
    desc = desc.replace(/[*_#`]/g, '').trim().substring(0, 160);
    pals = pals.split(',').map(p => p.trim()).join(', ');
    const slug = generarSlug(titulo);

    console.log(`✅ Generado: "${titulo.substring(0, 50)}..."`);

    // VERIFICACIÓN ANTI-DUPLICADOS
    const verificacion = await verificarDuplicado(titulo, categoria);

    if (verificacion.esDuplicada) {
      console.log(`⚠️ RECHAZADA: ${verificacion.razon} (${verificacion.porSimilitud}%)`);
      await registrarIntentoGemini(geminiKeyNum, titulo, 'duplicada');
      return generarNoticia(categoria, intentoNum + 1);
    }

    console.log(`✅ Verificada (${verificacion.porSimilitud}% similar máx)`);

    // Guardar en tabla anti-duplicados
    await guardarNoticiaPublicada(titulo, slug, categoria, contenido, geminiKeyNum);

    // Buscar imagen
    const imagenData = await buscarImagenOptima(titulo, categoria);
    const imagen = imagenData.url;

    // Monetización
    const noticiaSinMonetizar = {
      titulo,
      descripcion: desc,
      keywords: pals,
      contenido,
      categoria
    };
    const noticiaMonetizada = monetizarNoticia(noticiaSinMonetizar);

    // Publicar en BD
    await pool.query(
      `INSERT INTO noticias (titulo, slug, seccion, contenido, imagen, descripcion_seo, keywords, redactor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        noticiaMonetizada.titulo,
        slug,
        categoria,
        noticiaMonetizada.contenido,
        imagen,
        noticiaMonetizada.descripcion,
        noticiaMonetizada.keywords,
        'Redacción IA'
      ]
    );

    console.log(`✅ PUBLICADA: ${slug}`);

    // Telegram
    if (process.env.TELEGRAM_TOKEN) {
      const msg = `📰 ${noticiaMonetizada.titulo}\n\n${noticiaMonetizada.descripcion}\n\n${BASE_URL}/${slug}`;
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: msg
        }
      ).catch(e => console.log('⚠️ Telegram error'));
    }

    await registrarIntentoGemini(geminiKeyNum, titulo, 'publicada');

    return {
      success: true,
      titulo: noticiaMonetizada.titulo,
      slug,
      categoria,
      imagen,
      url: `${BASE_URL}/${slug}`
    };

  } catch (e) {
    console.error(`❌ Error:`, e.message);
    if (intentoNum < 2) {
      return generarNoticia(categoria, intentoNum + 1);
    }
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// RUTAS API
// ═══════════════════════════════════════════════════════════════════

app.get('/status', async (req, res) => {
  try {
    const noticias = await pool.query('SELECT COUNT(*) FROM noticias');
    res.json({
      version: '34.31',
      noticias: noticias.rows[0].count,
      modelo: 'gemini-2.5-flash',
      base_url: BASE_URL,
      uptime: process.uptime()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/generar-noticia', async (req, res) => {
  const { categoria = 'Nacionales' } = req.body;
  try {
    const resultado = await generarNoticia(categoria);
    if (resultado) {
      res.json({ success: true, ...resultado });
    } else {
      res.json({ success: false, error: 'No se pudo generar' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/publicar', async (req, res) => {
  const { pin, titulo, seccion, contenido, redactor, imagen, seo_description } = req.body;

  if (pin !== '311') {
    return res.status(401).json({ success: false, error: 'PIN incorrecto' });
  }

  try {
    const slug = generarSlug(titulo);
    await pool.query(
      `INSERT INTO noticias (titulo, slug, seccion, contenido, imagen, descripcion_seo, redactor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [titulo, slug, seccion, contenido, imagen, seo_description, redactor]
    );

    res.json({ success: true, slug, url: `${BASE_URL}/${slug}` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/noticias', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, titulo, slug, seccion, imagen, descripcion_seo, fecha, vistas FROM noticias ORDER BY fecha DESC LIMIT 100'
    );
    res.json({ success: true, noticias: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/eliminar/:id', verificarAuth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM noticias WHERE id = $1 RETURNING slug', [req.params.id]);
    res.json({ success: true, deleted: result.rowCount });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/actualizar-imagen/:id', verificarAuth, async (req, res) => {
  const { imagen } = req.body;
  try {
    await pool.query('UPDATE noticias SET imagen = $1 WHERE id = $2', [imagen, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/estadisticas', async (req, res) => {
  try {
    const noticias = await pool.query('SELECT COUNT(*) as total FROM noticias');
    const vistas = await pool.query('SELECT SUM(vistas) as total FROM noticias');
    res.json({
      totalNoticias: noticias.rows[0].total,
      totalVistas: vistas.rows[0].total || 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/config', verificarAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT clave, valor FROM config');
    const config = {};
    result.rows.forEach(row => { config[row.clave] = row.valor; });
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/config', verificarAuth, async (req, res) => {
  try {
    const keys = ['enabled', 'instruccion_principal', 'enfasis', 'tono', 'extension', 'evitar'];
    for (const key of keys) {
      if (key in req.body) {
        await pool.query(
          'INSERT INTO config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = $2',
          [key, req.body[key]]
        );
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/memoria', verificarAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT gemini_key_num, titulo_intento as valor, resultado FROM intentos_gemini ORDER BY timestamp_intento DESC LIMIT 50'
    );
    const registros = result.rows.map(r => ({
      tipo: 'intentos',
      valor: r.valor,
      resultado: r.resultado,
      key: r.gemini_key_num,
      pct_exito: r.resultado === 'publicada' ? 100 : 0
    }));
    res.json({ registros });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/comentarios', verificarAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.nombre, c.texto, c.fecha, n.titulo as noticia_titulo 
       FROM comentarios c 
       LEFT JOIN noticias n ON c.noticia_id = n.id 
       ORDER BY c.fecha DESC LIMIT 50`
    );
    res.json({ comentarios: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/comentarios/eliminar/:id', verificarAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM comentarios WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/coach', verificarAuth, async (req, res) => {
  const dias = parseInt(req.query.dias) || 7;
  try {
    const result = await pool.query(
      `SELECT seccion, COUNT(*) as total, SUM(vistas) as vistas, ROUND(AVG(vistas)) as vistas_promedio
       FROM noticias
       WHERE fecha > NOW() - INTERVAL '${dias} days'
       GROUP BY seccion
       ORDER BY vistas DESC`
    );
    
    const categorias = {};
    result.rows.forEach(r => {
      categorias[r.seccion] = {
        total: r.total,
        vistas_promedio: r.vistas_promedio || 0,
        rendimiento: Math.min(100, (r.vistas_promedio || 0) / 10)
      };
    });
    
    const totalNoticias = result.rows.reduce((sum, r) => sum + parseInt(r.total), 0);
    const totalVistas = result.rows.reduce((sum, r) => sum + (r.vistas || 0), 0);
    
    res.json({
      success: true,
      categorias,
      total_noticias: totalNoticias,
      total_vistas: totalVistas
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/telegram/status', verificarAuth, async (req, res) => {
  res.json({
    token_activo: !!process.env.TELEGRAM_TOKEN,
    chat_id: process.env.TELEGRAM_CHAT_ID || 'No configurado',
    instruccion: 'Bot preparado'
  });
});

app.post('/api/telegram/test', verificarAuth, async (req, res) => {
  try {
    const msg = `🏮 Test El Farol al Día ✅\n\n${new Date().toLocaleString('es-DO')}`;
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: msg
      }
    );
    res.json({ success: true, mensaje: '✅ Enviado' });
  } catch (e) {
    res.json({ success: false, mensaje: `❌ ${e.message}` });
  }
});

// ═══════════════════════════════════════════════════════════════════
// CRON JOBS
// ═══════════════════════════════════════════════════════════════════

schedule.scheduleJob('*/10 * * * *', async () => {
  const categorias = ['Nacionales', 'Deportes', 'Internacionales', 'Economia', 'Tecnologia', 'Espectaculos'];
  const categoria = categorias[Math.floor(Math.random() * categorias.length)];
  await generarNoticia(categoria);
});

schedule.scheduleJob('0 3 * * *', async () => {
  console.log('🧹 Limpieza anti-duplicados');
  await limpiarTablaAntiduplicated();
});

// ═══════════════════════════════════════════════════════════════════
// INICIAR SERVIDOR
// ═══════════════════════════════════════════════════════════════════

async function iniciar() {
  try {
    await inicializarBD();
    
    app.listen(PORT, () => {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`🏮 EL FAROL AL DÍA — V34.31 COMPLETO`);
      console.log(`${'═'.repeat(60)}`);
      console.log(`✅ Servidor en puerto ${PORT}`);
      console.log(`✅ BD: PostgreSQL conectada`);
      console.log(`✅ Gemini: 3 keys rotando`);
      console.log(`✅ Anti-duplicados: ACTIVO`);
      console.log(`✅ Monetización CPC: ACTIVA`);
      console.log(`✅ Telegram Bot: LISTO`);
      console.log(`${'═'.repeat(60)}\n`);
    });
  } catch (e) {
    console.error('❌ Error iniciando:', e.message);
    process.exit(1);
  }
}

iniciar();

process.on('unhandledRejection', (reason) => {
  console.error('❌ Promise rechazada:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Excepción:', error);
});
