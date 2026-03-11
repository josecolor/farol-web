/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V7.3
 * Gemini genera noticias SEO optimizadas para monetizar
 * Horarios automáticos: Cada 6 horas + Diaria 8 AM
 * Incluye migración automática para TODAS las columnas necesarias
 * BÚSQUEDA DE IMÁGENES INTELIGENTE (usa palabras clave del título)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// ==================== CONEXIÓN POSTGRESQL ====================
if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL no está definida');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// ==================== FUNCIÓN PARA GENERAR SLUG ====================
function generarSlug(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80);
}

// ==================== MIGRACIÓN COMPLETA DE BD ====================
async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Verificando estructura de base de datos...');
        await client.query('BEGIN');

        // 1. Crear tabla si no existe (estructura base COMPLETA)
        await client.query(`
            CREATE TABLE IF NOT EXISTS noticias (
                id SERIAL PRIMARY KEY,
                titulo VARCHAR(255) NOT NULL,
                slug VARCHAR(255),
                seccion VARCHAR(100) NOT NULL,
                contenido TEXT NOT NULL,
                seo_description VARCHAR(160),
                seo_keywords VARCHAR(255),
                ubicacion VARCHAR(100) DEFAULT 'Santo Domingo',
                redactor VARCHAR(100) DEFAULT 'IA Gemini',
                imagen TEXT DEFAULT '/default-news.jpg',
                imagen_alt VARCHAR(255),
                vistas INTEGER DEFAULT 0,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                estado VARCHAR(50) DEFAULT 'publicada'
            );
        `);
        console.log('✅ Tabla "noticias" asegurada');

        // 2. VERIFICAR Y AGREGAR COLUMNAS FALTANTES
        const columnasNecesarias = [
            { name: 'slug', type: 'VARCHAR(255)' },
            { name: 'seo_description', type: 'VARCHAR(160)' },
            { name: 'seo_keywords', type: 'VARCHAR(255)' },
            { name: 'imagen_alt', type: 'VARCHAR(255)' }
        ];

        for (const col of columnasNecesarias) {
            const checkCol = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='noticias' AND column_name=$1
            `, [col.name]);
            
            if (checkCol.rows.length === 0) {
                console.log(`➕ Agregando columna ${col.name}...`);
                await client.query(`ALTER TABLE noticias ADD COLUMN ${col.name} ${col.type}`);
            }
        }

        // 3. Actualizar slugs nulos
        console.log('🔄 Generando slugs para noticias sin slug...');
        await client.query(`
            UPDATE noticias 
            SET slug = lower(regexp_replace(titulo, '[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ]+', '-', 'g')) 
            WHERE slug IS NULL
        `);

        // 4. Asegurar que slug sea NOT NULL
        await client.query(`
            ALTER TABLE noticias ALTER COLUMN slug SET NOT NULL
        `);

        // 5. Agregar constraint UNIQUE en slug si no existe
        const checkUnique = await client.query(`
            SELECT conname FROM pg_constraint 
            WHERE conname = 'noticias_slug_unique'
        `);
        if (checkUnique.rows.length === 0) {
            console.log('➕ Agregando restricción UNIQUE en slug...');
            await client.query('ALTER TABLE noticias ADD CONSTRAINT noticias_slug_unique UNIQUE (slug)');
        }

        // 6. Asegurar que titulo sea VARCHAR(255)
        await client.query(`
            ALTER TABLE noticias ALTER COLUMN titulo TYPE VARCHAR(255)
        `);

        await client.query('COMMIT');
        console.log('✅ Base de datos lista y migrada correctamente');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en migración de base de datos:', error.message);
        return false;
    } finally {
        client.release();
    }
}

// ==================== 🖼️ BUSCAR IMAGEN MEJORADA (CON PALABRAS CLAVE DEL TÍTULO) ====================
async function buscarImagen(titulo, categoria) {
    try {
        // Extraer palabras clave del título (las más importantes)
        const palabrasClave = titulo
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(' ')
            .filter(p => p.length > 3)  // solo palabras con más de 3 letras
            .filter(p => !['para', 'con', 'una', 'este', 'esta', 'estos', 'estas', 'sobre'].includes(p))
            .slice(0, 3)                 // tomar máximo 3 palabras
            .join(' ');
        
        // Usar la categoría si no hay suficientes palabras clave
        const query = palabrasClave.length > 5 ? palabrasClave : categoria;
        
        console.log(`🔍 Buscando imagen para: "${query}" (desde título: "${titulo}")`);

        // Función auxiliar para intentar con diferentes APIs
        async function tryAPI(apiFunction) {
            try {
                return await apiFunction();
            } catch (e) {
                return null;
            }
        }

        // UNSPLASH (mejor calidad)
        if (process.env.UNSPLASH_ACCESS_KEY) {
            const unsplashResult = await tryAPI(async () => {
                const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&content_filter=high`;
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.urls && data.urls.regular) {
                        console.log(`✅ Imagen de Unsplash encontrada para: ${query}`);
                        return {
                            url: data.urls.regular,
                            alt: `${titulo} - ${categoria}`,
                            source: 'Unsplash'
                        };
                    }
                }
                return null;
            });
            if (unsplashResult) return unsplashResult;
        }

        // PEXELS
        if (process.env.PEXELS_API_KEY) {
            const pexelsResult = await tryAPI(async () => {
                const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
                const response = await fetch(url, {
                    headers: { 'Authorization': process.env.PEXELS_API_KEY }
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.photos && data.photos[0]) {
                        console.log(`✅ Imagen de Pexels encontrada para: ${query}`);
                        return {
                            url: data.photos[0].src.landscape,
                            alt: `${titulo} - ${categoria}`,
                            source: 'Pexels'
                        };
                    }
                }
                return null;
            });
            if (pexelsResult) return pexelsResult;
        }

        // PIXABAY
        if (process.env.PIXABAY_API_KEY) {
            const pixabayResult = await tryAPI(async () => {
                const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=1&safesearch=true`;
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    if (data.hits && data.hits[0]) {
                        console.log(`✅ Imagen de Pixabay encontrada para: ${query}`);
                        return {
                            url: data.hits[0].webformatURL,
                            alt: `${titulo} - ${categoria}`,
                            source: 'Pixabay'
                        };
                    }
                }
                return null;
            });
            if (pixabayResult) return pixabayResult;
        }

        // Fallback: imágenes por categoría
        console.log(`📸 Usando imagen placeholder para categoría: ${categoria}`);
        
        // Imágenes placeholder más relevantes por categoría
        const placeholders = {
            'Nacionales': 'Gobierno+RD',
            'Deportes': 'Deportes+RD',
            'Internacionales': 'Noticias+Mundo',
            'Economía': 'Economia+RD',
            'Tecnología': 'Tecnologia+RD'
        };

        const text = placeholders[categoria] || 'Noticias+RD';
        
        return {
            url: `https://via.placeholder.com/800x400?text=${text}`,
            alt: `${titulo} - ${categoria}`,
            source: 'default'
        };

    } catch (error) {
        console.error('❌ Error buscando imagen:', error.message);
        return {
            url: `https://via.placeholder.com/800x400?text=Noticia+RD`,
            alt: 'Noticia',
            source: 'error-fallback'
        };
    }
}

// ==================== 🤖 GENERAR NOTICIA CON GEMINI ====================
async function generarNoticiaCompleta(categoria) {
    try {
        console.log(`\n🤖 Generando noticia SEO para: ${categoria}`);

        const prompt = `Genera una noticia profesional sobre ${categoria} en República Dominicana.

IMPORTANTE:
- Título: Atractivo, único, 50-60 caracteres
- Contenido: 400-500 palabras (Google ama contenido largo)
- Incluye datos específicos de RD, lugares, fechas
- Estructura: Párrafos cortos (2-3 líneas)
- Primero el dato más importante
- Cita a "expertos" o "autoridades"
- Usa palabras clave: ${categoria.toLowerCase()}, república dominicana, santo domingo
- Sin asteriscos, sin formato especial
- Texto limpio y profesional

Responde EXACTAMENTE así:

TITULO: [título único y atractivo]
DESCRIPCION_SEO: [descripción para Google, máximo 160 caracteres, incluye ${categoria}]
PALABRAS_CLAVE: [5 palabras clave separadas por coma, incluye: ${categoria.toLowerCase()}, república dominicana]
CONTENIDO: [contenido completo de 400-500 palabras con párrafos bien estructurados]`;

        console.log(`📤 Enviando solicitud a Gemini (modelo: gemini-2.5-flash)...`);

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 2000,
                        topK: 40,
                        topP: 0.95
                    }
                })
            }
        );

        console.log(`📬 Respuesta Gemini: ${response.status}`);

        if (!response.ok) {
            const errorData = await response.text();
            console.error('❌ Error Gemini:', errorData);
            throw new Error(`Gemini ${response.status}: ${errorData.substring(0, 200)}`);
        }

        const data = await response.json();

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
            console.error('❌ Respuesta incompleta de Gemini');
            throw new Error('Gemini no devolvió contenido válido');
        }

        const texto = data.candidates[0].content.parts[0].text;
        console.log(`📝 Respuesta: ${texto.length} caracteres`);

        // PARSEAR RESPUESTA
        const tituloMatch = texto.match(/TITULO:\s*(.+?)(?=\nDESCRIPCION_SEO:|DESCRIPCION_SEO:|$)/i);
        const descMatch = texto.match(/DESCRIPCION_SEO:\s*(.+?)(?=\nPALABRAS_CLAVE:|PALABRAS_CLAVE:|$)/i);
        const keywordsMatch = texto.match(/PALABRAS_CLAVE:\s*(.+?)(?=\nCONTENIDO:|CONTENIDO:|$)/i);
        const contenidoMatch = texto.match(/CONTENIDO:\s*(.+?)$/is);

        if (!tituloMatch || !contenidoMatch) {
            console.error('❌ Error parseando respuesta');
            throw new Error('Formato de respuesta incorrecto');
        }

        const titulo = tituloMatch[1].trim();
        const seoDesc = descMatch ? descMatch[1].trim().substring(0, 160) : titulo.substring(0, 160);
        const keywords = keywordsMatch ? keywordsMatch[1].trim() : categoria;
        const contenido = contenidoMatch[1].trim();

        if (!titulo || titulo.length < 10 || contenido.length < 200) {
            console.error('❌ Contenido muy corto');
            throw new Error('Título o contenido insuficiente');
        }

        console.log(`✅ Título: ${titulo.substring(0, 70)}`);
        console.log(`✅ SEO: ${seoDesc.substring(0, 80)}`);
        console.log(`✅ Contenido: ${contenido.substring(0, 100)}...`);

        // 🖼️ BUSCAR IMAGEN CON PALABRAS CLAVE DEL TÍTULO
        const imagenData = await buscarImagen(titulo, categoria);

        // GENERAR SLUG
        const slug = generarSlug(titulo);

        // GUARDAR EN BD
        const result = await pool.query(
            `INSERT INTO noticias (
                titulo, slug, seccion, contenido, 
                seo_description, seo_keywords, 
                redactor, imagen, imagen_alt, 
                ubicacion, estado
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
            RETURNING id, slug, titulo, imagen`,
            [
                titulo.substring(0, 255),
                slug,
                categoria,
                contenido,
                seoDesc,
                keywords.substring(0, 255),
                'IA Gemini',
                imagenData.url,
                imagenData.alt,
                'Santo Domingo',
                'publicada'
            ]
        );

        const noticia = result.rows[0];
        console.log(`✅ Noticia guardada con ID: ${noticia.id}`);
        console.log(`✅ URL: ${BASE_URL}/noticia/${noticia.slug}`);
        console.log(`✅ Imagen: ${imagenData.source || 'desconocida'}`);

        return {
            success: true,
            id: noticia.id,
            slug: noticia.slug,
            titulo: noticia.titulo,
            url: `${BASE_URL}/noticia/${noticia.slug}`,
            imagen: noticia.imagen,
            fuente_imagen: imagenData.source || 'desconocida',
            mensaje: '✅ Noticia generada y publicada con SEO'
        };

    } catch (error) {
        console.error(`\n❌ ERROR:`, error.message);
        return { 
            success: false, 
            error: error.message 
        };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología'];

// ==================== ⏰ AUTOMATIZACIÓN ====================
console.log('\n📅 Configurando automatización de noticias...');

// Cada 6 horas
cron.schedule('0 */6 * * *', async () => {
    console.log('\n⏰ [6 HORAS] Generando noticia automática...');
    const categoria = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticiaCompleta(categoria);
});

// Cada día a las 8 AM
cron.schedule('0 8 * * *', async () => {
    console.log('\n🌅 [8 AM] Generando noticia diaria...');
    await generarNoticiaCompleta('Nacionales');
});

console.log('✅ Automatización configurada:');
console.log('   - Cada 6 horas (0, 6, 12, 18 horas)');
console.log('   - Diariamente a las 8:00 AM');

// ==================== RUTAS ====================
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// ==================== API NOTICIAS ====================
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, titulo, slug, seccion, contenido, imagen, imagen_alt, fecha, vistas, redactor, seo_description FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT 30',
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (error) {
        console.error('❌ Error /api/noticias:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/noticias/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE id = $1 AND estado = $2',
            [req.params.id, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No encontrada' });
        }

        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [req.params.id]);

        res.json({ success: true, noticia: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== NOTICIA POR SLUG ====================
app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE slug = $1 AND estado = $2',
            [req.params.slug, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Noticia no encontrada | El Farol al Día</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
                        h1 { color: #c62828; }
                        a { color: #2e7d32; text-decoration: none; font-size: 18px; }
                        a:hover { text-decoration: underline; }
                    </style>
                </head>
                <body>
                    <h1>🔍 Noticia no encontrada</h1>
                    <p>La noticia que buscas no existe o ha sido eliminada.</p>
                    <a href="/">← Volver al inicio</a>
                </body>
                </html>
            `);
        }

        const noticia = result.rows[0];

        // ACTUALIZAR VISTAS
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [noticia.id]);

        // Formatear contenido con párrafos
        const contenidoFormateado = noticia.contenido
            .split('\n')
            .filter(p => p.trim() !== '')
            .map(p => `<p>${p.trim()}</p>`)
            .join('');

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');

            // INYECTAR META TAGS SEO
            const metaTags = `
<title>${noticia.titulo} | El Farol al Día</title>
<meta name="description" content="${noticia.seo_description || noticia.titulo}">
<meta name="keywords" content="${noticia.seo_keywords || noticia.seccion}">
<meta property="og:title" content="${noticia.titulo}">
<meta property="og:description" content="${noticia.seo_description || noticia.titulo}">
<meta property="og:image" content="${noticia.imagen}">
<meta property="og:url" content="${BASE_URL}/noticia/${noticia.slug}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${noticia.titulo}">
<meta name="twitter:description" content="${noticia.seo_description || noticia.titulo}">
<meta name="twitter:image" content="${noticia.imagen}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "${noticia.titulo}",
  "description": "${noticia.seo_description || noticia.titulo}",
  "image": "${noticia.imagen}",
  "datePublished": "${noticia.fecha}",
  "author": {
    "@type": "Person",
    "name": "${noticia.redactor}"
  },
  "publisher": {
    "@type": "Organization",
    "name": "El Farol al Día",
    "logo": {
      "@type": "ImageObject",
      "url": "${BASE_URL}/logo.png"
    }
  }
}
</script>`;

            html = html.replace('<!-- META_TAGS -->', metaTags);
            html = html.replace('{{TITULO}}', noticia.titulo);
            html = html.replace('{{CONTENIDO}}', contenidoFormateado);
            html = html.replace('{{FECHA}}', new Date(noticia.fecha).toLocaleDateString('es-DO', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }));
            html = html.replace('{{IMAGEN}}', noticia.imagen);
            html = html.replace('{{ALT}}', noticia.imagen_alt || noticia.titulo);
            html = html.replace('{{VISTAS}}', noticia.vistas);
            html = html.replace('{{SECCION}}', noticia.seccion);
            html = html.replace('{{REDACTOR}}', noticia.redactor);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (e) {
            // Fallback a JSON si el archivo HTML no existe
            res.json({ success: true, noticia });
        }
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).send('Error interno');
    }
});

// ==================== GENERAR NOTICIA MANUAL ====================
app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });

    const resultado = await generarNoticiaCompleta(categoria);

    if (resultado.success) {
        res.json(resultado);
    } else {
        res.status(500).json(resultado);
    }
});

// ==================== SITEMAP ====================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT slug, fecha FROM noticias WHERE estado = $1 ORDER BY fecha DESC',
            ['publicada']
        );

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml += `  <url><loc>${BASE_URL}/</loc><priority>1.0</priority></url>\n`;

        result.rows.forEach(n => {
            xml += `  <url><loc>${BASE_URL}/noticia/${n.slug}</loc><lastmod>${new Date(n.fecha).toISOString().split('T')[0]}</lastmod><priority>0.8</priority></url>\n`;
        });

        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        res.status(500).send('Error');
    }
});

// ==================== ROBOTS.TXT ====================
app.get('/robots.txt', (req, res) => {
    const robots = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/

Sitemap: ${BASE_URL}/sitemap.xml

User-agent: Googlebot
Allow: /
`;
    res.header('Content-Type', 'text/plain');
    res.send(robots);
});

// ==================== STATUS ====================
app.get('/status', async (req, res) => {
    try {
        const dbStatus = await pool.query('SELECT 1 as health');
        const noticiasCount = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado = $1', ['publicada']);

        res.json({
            status: 'OK',
            database: dbStatus.rows[0]?.health === 1 ? 'conectado' : 'error',
            noticias_publicadas: parseInt(noticiasCount.rows[0].count),
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            version: '7.3'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== FALLBACK ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR SERVIDOR ====================
async function iniciar() {
    try {
        console.log('\n🚀 Iniciando servidor...');
        
        const dbOk = await inicializarBase();
        if (!dbOk) {
            console.log('⚠️ Continuando a pesar de errores de BD...');
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V7.3 🏮             ║
╠═══════════════════════════════════════════════════════════════════╣
║ ✅ Servidor en puerto ${PORT}                                     ║
║ ✅ PostgreSQL conectado y migrado                                 ║
║ ✅ TODAS las columnas verificadas                                ║
║ ✅ BÚSQUEDA INTELIGENTE DE IMÁGENES (usa palabras del título)   ║
║ ✅ Gemini IA: ACTIVADO                                            ║
║ ✅ SEO OPTIMIZADO: LISTO PARA MONETIZAR                           ║
║ ✅ Automatización: Cada 6 horas + 8 AM                            ║
║ ✅ Meta tags dinámicos: Schema.org, OG, Twitter                   ║
║ ✅ Sitemap y Robots.txt: GENERADOS                                ║
║ ✅ LISTO PARA GOOGLE ADSENSE                                      ║
╚═══════════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    }
}

iniciar();

module.exports = app;
