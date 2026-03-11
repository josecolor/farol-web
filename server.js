/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR V11.0 FINAL
 * DETECCIÓN DE ENTIDADES + BÚSQUEDA INTELIGENTE DE IMÁGENES
 * Horarios automáticos: Cada 6 horas + Diaria 8 AM
 * SISTEMA COMO EDITOR DE PERIÓDICO PROFESIONAL
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

// ==================== LISTA DE REDACTORES ====================
const REDACTORES = [
    { nombre: 'Carlos Méndez', especialidad: 'Nacionales' },
    { nombre: 'Laura Santana', especialidad: 'Deportes' },
    { nombre: 'Roberto Peña', especialidad: 'Internacionales' },
    { nombre: 'Ana María Castillo', especialidad: 'Economía' },
    { nombre: 'José Miguel Fernández', especialidad: 'Tecnología' },
    { nombre: 'Patricia Jiménez', especialidad: 'Espectáculos' },
    { nombre: 'Fernando Rivas', especialidad: 'Nacionales' },
    { nombre: 'Carmen Lora', especialidad: 'Deportes' },
    { nombre: 'Miguel Ángel Pérez', especialidad: 'Internacionales' }
];

function elegirRedactor(categoria) {
    const especialistas = REDACTORES.filter(r => r.especialidad === categoria);
    if (especialistas.length > 0) {
        return especialistas[Math.floor(Math.random() * especialistas.length)].nombre;
    }
    return REDACTORES[Math.floor(Math.random() * REDACTORES.length)].nombre;
}

// ==================== GENERAR SLUG ====================
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

// ==================== BANCO DE IMÁGENES DE RESPALDO ====================
const BANCO_IMAGENES_RESPALDO = {
    'Nacionales': [
        'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
        'https://images.pexels.com/photos/290595/pexels-photo-290595.jpeg',
        'https://images.pexels.com/photos/1181690/pexels-photo-1181690.jpeg',
    ],
    'Deportes': [
        'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg',
        'https://images.pexels.com/photos/1884574/pexels-photo-1884574.jpeg',
        'https://images.pexels.com/photos/131881/pexels-photo-131881.jpeg',
    ],
    'Internacionales': [
        'https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg',
        'https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg',
    ],
    'Espectáculos': [
        'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg',
        'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg',
    ],
    'Economía': [
        'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg',
        'https://images.pexels.com/photos/6772070/pexels-photo-6772070.jpeg',
    ],
    'Tecnología': [
        'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg',
        'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg',
    ]
};

// ==================== INICIALIZAR BD ====================
async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Inicializando base de datos...');
        await client.query('BEGIN');

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

        const columnas = [
            'slug VARCHAR(255)',
            'seo_description VARCHAR(160)',
            'seo_keywords VARCHAR(255)',
            'imagen_alt VARCHAR(255)'
        ];

        for (const col of columnas) {
            const colName = col.split(' ')[0];
            const check = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_name='noticias' AND column_name=$1`,
                [colName]
            );

            if (check.rows.length === 0) {
                console.log(`➕ Agregando columna ${colName}...`);
                await client.query(`ALTER TABLE noticias ADD COLUMN ${col}`);
            }
        }

        await client.query(`
            UPDATE noticias 
            SET slug = lower(regexp_replace(titulo, '[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ]+', '-', 'g')) 
            WHERE slug IS NULL OR slug = ''
        `);

        await client.query('COMMIT');
        console.log('✅ Base de datos lista');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error BD:', error.message);
        return false;
    } finally {
        client.release();
    }
}

// ==================== BUSCAR IMAGEN CON REINTENTOS ====================
async function buscarImagenInteligente(persona, busquedas, categoria) {
    try {
        console.log(`\n🎬 BÚSQUEDA INTELIGENTE DE IMÁGENES`);
        
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        let imagen = null;

        // PRIORIDAD 1: Si hay persona, buscar primero
        if (persona && persona.length > 2) {
            console.log(`🎯 PRIORIDAD 1: Buscando por PERSONA: ${persona}`);
            
            // UNSPLASH
            if (process.env.UNSPLASH_ACCESS_KEY && !imagen) {
                try {
                    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(persona)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&per_page=3`;
                    const response = await fetch(url);
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.results && data.results.length > 0) {
                            imagen = {
                                url: data.results[0].urls.regular,
                                alt: `${persona} - ${categoria}`,
                                source: 'Unsplash',
                                query: persona
                            };
                            console.log(`✅ Imagen de ${persona} en Unsplash`);
                            return imagen;
                        }
                    }
                } catch (e) {
                    console.log(`⚠️ Unsplash: ${e.message}`);
                }
                await delay(300);
            }

            // PEXELS
            if (process.env.PEXELS_API_KEY && !imagen) {
                try {
                    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(persona)}&per_page=3&orientation=landscape`;
                    const response = await fetch(url, {
                        headers: { 'Authorization': process.env.PEXELS_API_KEY }
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.photos && data.photos.length > 0) {
                            imagen = {
                                url: data.photos[0].src.landscape,
                                alt: `${persona} - ${categoria}`,
                                source: 'Pexels',
                                query: persona
                            };
                            console.log(`✅ Imagen de ${persona} en Pexels`);
                            return imagen;
                        }
                    }
                } catch (e) {
                    console.log(`⚠️ Pexels: ${e.message}`);
                }
                await delay(300);
            }

            // PIXABAY
            if (process.env.PIXABAY_API_KEY && !imagen) {
                try {
                    const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(persona)}&image_type=photo&orientation=horizontal&per_page=3`;
                    const response = await fetch(url);
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.hits && data.hits.length > 0) {
                            imagen = {
                                url: data.hits[0].webformatURL,
                                alt: `${persona} - ${categoria}`,
                                source: 'Pixabay',
                                query: persona
                            };
                            console.log(`✅ Imagen de ${persona} en Pixabay`);
                            return imagen;
                        }
                    }
                } catch (e) {
                    console.log(`⚠️ Pixabay: ${e.message}`);
                }
            }
        }

        // PRIORIDAD 2: Usar las búsquedas genéricas
        if (busquedas && busquedas.length > 0) {
            console.log(`📸 PRIORIDAD 2: Buscando por queries genéricas`);
            
            for (const query of busquedas.slice(0, 2)) {
                // UNSPLASH
                if (process.env.UNSPLASH_ACCESS_KEY && !imagen) {
                    try {
                        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&per_page=1`;
                        const response = await fetch(url);
                        
                        if (response.ok) {
                            const data = await response.json();
                            if (data.results && data.results.length > 0) {
                                imagen = {
                                    url: data.results[0].urls.regular,
                                    alt: query,
                                    source: 'Unsplash',
                                    query: query
                                };
                                console.log(`✅ Imagen genérica en Unsplash`);
                                return imagen;
                            }
                        }
                    } catch (e) {
                        console.log(`⚠️ Unsplash: ${e.message}`);
                    }
                    await delay(300);
                }

                // PEXELS
                if (process.env.PEXELS_API_KEY && !imagen) {
                    try {
                        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
                        const response = await fetch(url, {
                            headers: { 'Authorization': process.env.PEXELS_API_KEY }
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            if (data.photos && data.photos.length > 0) {
                                imagen = {
                                    url: data.photos[0].src.landscape,
                                    alt: query,
                                    source: 'Pexels',
                                    query: query
                                };
                                console.log(`✅ Imagen genérica en Pexels`);
                                return imagen;
                            }
                        }
                    } catch (e) {
                        console.log(`⚠️ Pexels: ${e.message}`);
                    }
                    await delay(300);
                }

                // PIXABAY
                if (process.env.PIXABAY_API_KEY && !imagen) {
                    try {
                        const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=1`;
                        const response = await fetch(url);
                        
                        if (response.ok) {
                            const data = await response.json();
                            if (data.hits && data.hits.length > 0) {
                                imagen = {
                                    url: data.hits[0].webformatURL,
                                    alt: query,
                                    source: 'Pixabay',
                                    query: query
                                };
                                console.log(`✅ Imagen genérica en Pixabay`);
                                return imagen;
                            }
                        }
                    } catch (e) {
                        console.log(`⚠️ Pixabay: ${e.message}`);
                    }
                }
            }
        }

        // PRIORIDAD 3: Banco de respaldo
        if (!imagen) {
            console.log(`📸 PRIORIDAD 3: Usando banco de respaldo`);
            const imagenesRespaldo = BANCO_IMAGENES_RESPALDO[categoria] || BANCO_IMAGENES_RESPALDO['Nacionales'];
            const imagenSeleccionada = imagenesRespaldo[Math.floor(Math.random() * imagenesRespaldo.length)];
            
            imagen = {
                url: imagenSeleccionada,
                alt: `Noticia sobre ${persona || categoria}`,
                source: 'respaldo',
                query: 'respaldo'
            };
        }

        return imagen;

    } catch (error) {
        console.error('❌ Error imagen:', error.message);
        const respaldo = BANCO_IMAGENES_RESPALDO[categoria] || BANCO_IMAGENES_RESPALDO['Nacionales'];
        return {
            url: respaldo[0],
            alt: 'Noticia',
            source: 'emergencia',
            query: 'emergencia'
        };
    }
}

// ==================== GENERAR NOTICIA ====================
async function generarNoticiaCompleta(categoria) {
    try {
        console.log(`\n🤖 Generando noticia para: ${categoria}`);

        const prompt = `Genera una noticia profesional sobre ${categoria} en República Dominicana.

REGLAS IMPORTANTES:
- Título: Atractivo, único, 50-60 caracteres
- Contenido: 400-500 palabras
- Incluye datos específicos de RD
- Si es sobre una persona famosa, artista, DJ, político o celebridad, INCLUYE su nombre
- Sin asteriscos, sin formato especial

Responde EXACTAMENTE así:

TITULO: [título aquí]
PERSONA: [nombre de persona si aplica, sino dejar vacío]
DESCRIPCION: [descripción 160 caracteres máximo]
PALABRAS: [5 palabras clave separadas por coma]
BUSQUEDA: [3 búsquedas en inglés separadas por | ]
CONTENIDO:
[contenido 400-500 palabras]`;

        console.log(`📤 Enviando a Gemini...`);

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 4000
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini ${response.status}`);
        }

        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;

        // PARSEAR RESPUESTA
        let titulo = "";
        let persona = "";
        let descripcion = "";
        let palabras = categoria;
        let busquedas = [];
        let contenido = "";

        const lineas = texto.split('\n');
        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i].trim();
            
            if (linea.startsWith('TITULO:')) {
                titulo = linea.replace('TITULO:', '').trim();
            }
            else if (linea.startsWith('PERSONA:')) {
                persona = linea.replace('PERSONA:', '').trim();
            }
            else if (linea.startsWith('DESCRIPCION:')) {
                descripcion = linea.replace('DESCRIPCION:', '').trim();
            }
            else if (linea.startsWith('PALABRAS:')) {
                palabras = linea.replace('PALABRAS:', '').trim();
            }
            else if (linea.startsWith('BUSQUEDA:')) {
                const busquedasTexto = linea.replace('BUSQUEDA:', '').trim();
                busquedas = busquedasTexto.split('|').map(b => b.trim()).filter(b => b.length > 0);
            }
            else if (linea.startsWith('CONTENIDO:')) {
                contenido = linea.replace('CONTENIDO:', '').trim();
                for (let j = i + 1; j < lineas.length; j++) {
                    contenido += '\n' + lineas[j];
                }
                break;
            }
        }

        // Limpiar
        titulo = titulo.replace(/[*_#`]/g, '').trim().substring(0, 255);
        persona = persona.replace(/[*_#`]/g, '').trim();
        descripcion = descripcion.replace(/[*_#`]/g, '').trim().substring(0, 160);
        palabras = palabras.replace(/[*_#`]/g, '').trim().substring(0, 255);

        if (!titulo || titulo.length < 10) {
            titulo = `Nuevos avances en ${categoria} en RD`;
        }

        if (!contenido || contenido.length < 200) {
            contenido = `Las autoridades dominicanas han anunciado importantes medidas en ${categoria}.`;
        }

        console.log(`✅ Título: ${titulo.substring(0, 60)}`);
        console.log(`✅ Persona: ${persona || 'ninguna'}`);

        // BUSCAR IMAGEN
        const imagenData = await buscarImagenInteligente(persona, busquedas, categoria);
        
        const slug = generarSlug(titulo);
        const redactor = elegirRedactor(categoria);

        // Verificar slug único
        const existe = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existe.rows.length > 0 ? `${slug}-${Date.now()}` : slug;

        // Guardar
        const result = await pool.query(
            `INSERT INTO noticias (
                titulo, slug, seccion, contenido, 
                seo_description, seo_keywords, 
                redactor, imagen, imagen_alt, estado
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
            RETURNING id, slug`,
            [
                titulo,
                slugFinal,
                categoria,
                contenido,
                descripcion,
                palabras,
                redactor,
                imagenData.url,
                imagenData.alt,
                'publicada'
            ]
        );

        const noticia = result.rows[0];
        console.log(`✅ Noticia guardada: ID ${noticia.id}`);
        console.log(`✅ Imagen: ${imagenData.source} (${imagenData.query})`);

        return {
            success: true,
            id: noticia.id,
            slug: noticia.slug,
            titulo: titulo,
            url: `${BASE_URL}/noticia/${noticia.slug}`,
            imagen: imagenData.url,
            redactor: redactor,
            persona: persona || 'ninguna',
            imagen_source: imagenData.source,
            mensaje: '✅ Noticia publicada'
        };

    } catch (error) {
        console.error(`❌ ERROR:`, error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// ==================== AUTOMATIZACIÓN ====================
console.log('\n📅 Configurando automatización...');
cron.schedule('0 */6 * * *', async () => {
    console.log('\n⏰ [6 HORAS] Generando noticia...');
    const cat = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticiaCompleta(cat);
});

cron.schedule('0 8 * * *', async () => {
    console.log('\n🌅 [8 AM] Generando noticia diaria...');
    await generarNoticiaCompleta('Nacionales');
});
console.log('✅ Automatización configurada');

// ==================== RUTAS ====================
app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// ==================== API ====================
app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, titulo, slug, seccion, imagen, fecha, vistas, redactor FROM noticias WHERE estado=$1 ORDER BY fecha DESC LIMIT 30',
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

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

// ==================== NOTICIA POR SLUG ====================
app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE slug = $1 AND estado = $2',
            [req.params.slug, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).send('Noticia no encontrada');
        }

        const n = result.rows[0];
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [n.id]);

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');

            const meta = `
<title>${n.titulo} | El Farol al Día</title>
<meta name="description" content="${n.seo_description || n.titulo}">
<meta name="keywords" content="${n.seo_keywords}">
<meta property="og:title" content="${n.titulo}">
<meta property="og:description" content="${n.seo_description || n.titulo}">
<meta property="og:image" content="${n.imagen}">
<meta property="og:url" content="${BASE_URL}/noticia/${n.slug}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "${n.titulo}",
  "image": "${n.imagen}",
  "datePublished": "${n.fecha}",
  "author": {"@type": "Person", "name": "${n.redactor}"}
}
</script>`;

            html = html.replace('<!-- META_TAGS -->', meta);
            html = html.replace(/{{TITULO}}/g, n.titulo);
            html = html.replace(/{{CONTENIDO}}/g, n.contenido.split('\n').map(p => `<p>${p}</p>`).join(''));
            html = html.replace(/{{FECHA}}/g, new Date(n.fecha).toLocaleDateString('es-DO'));
            html = html.replace(/{{IMAGEN}}/g, n.imagen);
            html = html.replace(/{{ALT}}/g, n.imagen_alt || n.titulo);
            html = html.replace(/{{VISTAS}}/g, n.vistas);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (e) {
            res.json({ success: true, noticia: n });
        }
    } catch (error) {
        res.status(500).send('Error');
    }
});

// ==================== SITEMAP ====================
app.get('/sitemap.xml', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT slug, fecha FROM noticias WHERE estado=$1 ORDER BY fecha DESC',
            ['publicada']
        );

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">\n';
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
    const robots = `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${BASE_URL}/sitemap.xml`;
    res.header('Content-Type', 'text/plain');
    res.send(robots);
});

// ==================== STATUS ====================
app.get('/status', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM noticias WHERE estado=$1', ['publicada']);
        res.json({
            status: 'OK',
            noticias: parseInt(result.rows[0].count),
            uptime: Math.floor(process.uptime()),
            version: '11.0'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== FALLBACK ====================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ==================== INICIAR ====================
async function iniciar() {
    try {
        console.log('\n🚀 Iniciando servidor V11.0...\n');
        await inicializarBase();

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║   🏮 EL FAROL AL DÍA - SERVIDOR V11.0 FINAL 🏮                  ║
║        BÚSQUEDA INTELIGENTE DE IMÁGENES + DETECCIÓN ENTIDADES    ║
╠═══════════════════════════════════════════════════════════════════╣
║ ✅ Servidor en puerto ${PORT}                                     ║
║ ✅ DETECCIÓN DE PERSONAS: ACTIVO                                  ║
║ ✅ BÚSQUEDA POR APIs: Unsplash, Pexels, Pixabay                   ║
║ ✅ BANCO INTELIGENTE: Respaldo por categoría                      ║
║ ✅ REINTENTOS: Con delays para evitar 429                         ║
║ ✅ Automatización: Cada 6 horas + 8 AM                             ║
║ ✅ COMO EDITOR DE PERIÓDICO PROFESIONAL                           ║
║ ✅ LISTO PARA MONETIZAR CON GOOGLE ADSENSE                        ║
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

