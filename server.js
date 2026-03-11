/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V8.0
 * Gemini genera noticias con IMAGE_QUERY para imágenes PERFECTAS
 * Horarios automáticos: Cada 6 horas + Diaria 8 AM
 * VERSIÓN DEFINITIVA - CON BÚSQUEDA DE IMÁGENES INTELIGENTE
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

        console.log('🔄 Generando slugs para noticias sin slug...');
        await client.query(`
            UPDATE noticias 
            SET slug = lower(regexp_replace(titulo, '[^a-zA-Z0-9áéíóúÁÉÍÓÚüÜñÑ]+', '-', 'g')) 
            WHERE slug IS NULL
        `);

        await client.query(`ALTER TABLE noticias ALTER COLUMN slug SET NOT NULL`);

        const checkUnique = await client.query(`
            SELECT conname FROM pg_constraint 
            WHERE conname = 'noticias_slug_unique'
        `);
        if (checkUnique.rows.length === 0) {
            console.log('➕ Agregando restricción UNIQUE en slug...');
            await client.query('ALTER TABLE noticias ADD CONSTRAINT noticias_slug_unique UNIQUE (slug)');
        }

        await client.query(`ALTER TABLE noticias ALTER COLUMN titulo TYPE VARCHAR(255)`);

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

// ==================== 🖼️ SISTEMA DE SELECCIÓN DE IMAGEN ====================
function calcularRelevancia(imagen, keywords, categoria) {
    let puntuacion = 0;
    
    const textoCompleto = [
        imagen.titulo || '',
        imagen.descripcion || '',
        imagen.etiquetas || [],
        imagen.categoria || ''
    ].flat().join(' ').toLowerCase();
    
    // Palabras clave principales
    keywords.forEach(kw => {
        if (textoCompleto.includes(kw.toLowerCase())) {
            puntuacion += 5;
        }
    });
    
    // Categoría
    if (textoCompleto.includes(categoria.toLowerCase())) {
        puntuacion += 3;
    }
    
    // Palabras clave específicas de fotografía periodística
    const palabrasPeriodisticas = ['official', 'government', 'president', 'congress', 'meeting', 'conference', 'ceremony', 'announcement'];
    palabrasPeriodisticas.forEach(p => {
        if (textoCompleto.includes(p)) {
            puntuacion += 2;
        }
    });
    
    return puntuacion;
}

// ==================== 🖼️ BUSCAR IMAGEN CON IMAGE_QUERY ====================
async function buscarImagen(imageQueries, categoria) {
    try {
        console.log(`🔍 Buscando imagen con ${imageQueries.length} queries...`);
        
        // Convertir las frases a formato de búsqueda
        const queries = imageQueries.map(q => q.trim().replace(/\s+/g, '+'));
        
        let mejoresImagenes = [];
        
        // ========== 1. UNSPLASH ==========
        if (process.env.UNSPLASH_ACCESS_KEY) {
            console.log('📸 Probando Unsplash...');
            for (const query of queries) {
                try {
                    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&per_page=5`;
                    const response = await fetch(url);
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.results && data.results.length > 0) {
                            const keywords = query.split('+');
                            
                            data.results.forEach(img => {
                                mejoresImagenes.push({
                                    url: img.urls.regular,
                                    alt: img.alt_description || img.description || 'Noticia',
                                    titulo: img.description || '',
                                    etiquetas: img.tags?.map(t => t.title) || [],
                                    puntuacion: calcularRelevancia({
                                        titulo: img.description,
                                        etiquetas: img.tags?.map(t => t.title)
                                    }, keywords, categoria),
                                    fuente: 'Unsplash',
                                    autor: img.user.name
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.log(`⚠️ Error en Unsplash con query "${query}":`, e.message);
                }
            }
        }
        
        // ========== 2. PEXELS ==========
        if (process.env.PEXELS_API_KEY && mejoresImagenes.length < 10) {
            console.log('📸 Probando Pexels...');
            for (const query of queries) {
                try {
                    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
                    const response = await fetch(url, {
                        headers: { 'Authorization': process.env.PEXELS_API_KEY }
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.photos && data.photos.length > 0) {
                            const keywords = query.split('+');
                            
                            data.photos.forEach(img => {
                                mejoresImagenes.push({
                                    url: img.src.landscape,
                                    alt: img.alt || 'Noticia',
                                    titulo: img.alt || '',
                                    etiquetas: [img.photographer],
                                    puntuacion: calcularRelevancia({
                                        titulo: img.alt,
                                        etiquetas: [img.photographer]
                                    }, keywords, categoria),
                                    fuente: 'Pexels',
                                    autor: img.photographer
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.log(`⚠️ Error en Pexels con query "${query}":`, e.message);
                }
            }
        }
        
        // ========== 3. PIXABAY ==========
        if (process.env.PIXABAY_API_KEY && mejoresImagenes.length < 10) {
            console.log('📸 Probando Pixabay...');
            for (const query of queries) {
                try {
                    const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=5&safesearch=true`;
                    const response = await fetch(url);
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.hits && data.hits.length > 0) {
                            const keywords = query.split('+');
                            
                            data.hits.forEach(img => {
                                mejoresImagenes.push({
                                    url: img.webformatURL,
                                    alt: img.tags || 'Noticia',
                                    titulo: img.tags || '',
                                    etiquetas: img.tags?.split(', ') || [],
                                    puntuacion: calcularRelevancia({
                                        titulo: img.tags,
                                        etiquetas: img.tags?.split(', ')
                                    }, keywords, categoria),
                                    fuente: 'Pixabay',
                                    autor: img.user
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.log(`⚠️ Error en Pixabay con query "${query}":`, e.message);
                }
            }
        }
        
        // ========== SELECCIONAR LA MEJOR IMAGEN ==========
        if (mejoresImagenes.length > 0) {
            // Ordenar por puntuación
            mejoresImagenes.sort((a, b) => b.puntuacion - a.puntuacion);
            
            // Tomar la mejor (primeras 3 y elegir una aleatoria entre ellas para variar)
            const topImagenes = mejoresImagenes.slice(0, 3);
            const imagenSeleccionada = topImagenes[Math.floor(Math.random() * topImagenes.length)];
            
            console.log(`✅ Mejor imagen encontrada:`);
            console.log(`   Fuente: ${imagenSeleccionada.fuente}`);
            console.log(`   Autor: ${imagenSeleccionada.autor}`);
            console.log(`   Puntuación: ${imagenSeleccionada.puntuacion}`);
            
            return {
                url: imagenSeleccionada.url,
                alt: imagenSeleccionada.alt,
                source: imagenSeleccionada.fuente,
                autor: imagenSeleccionada.autor
            };
        }
        
        // ========== BANCO DE IMÁGENES DE RESPALDO POR CATEGORÍA ==========
        console.log(`📸 Usando banco de respaldo para: ${categoria}`);
        
        const imagenesRespaldo = {
            'Nacionales': [
                { url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg', alt: 'Palacio Nacional' },
                { url: 'https://images.pexels.com/photos/290595/pexels-photo-290595.jpeg', alt: 'Congreso Nacional' },
                { url: 'https://images.unsplash.com/photo-1548602088-9d12a4f9c10d', alt: 'Gobierno' }
            ],
            'Deportes': [
                { url: 'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg', alt: 'Estadio' },
                { url: 'https://images.pexels.com/photos/1884574/pexels-photo-1884574.jpeg', alt: 'Béisbol' },
                { url: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211', alt: 'Deportes' }
            ],
            'Internacionales': [
                { url: 'https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg', alt: 'Relaciones internacionales' },
                { url: 'https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg', alt: 'Mundo' },
                { url: 'https://images.unsplash.com/photo-1489493585363-d69421e0c3d0', alt: 'Internacional' }
            ],
            'Espectáculos': [
                { url: 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg', alt: 'Concierto' },
                { url: 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg', alt: 'Espectáculo' },
                { url: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4', alt: 'Arte' }
            ],
            'Economía': [
                { url: 'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg', alt: 'Negocios' },
                { url: 'https://images.pexels.com/photos/6772070/pexels-photo-6772070.jpeg', alt: 'Economía' },
                { url: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e', alt: 'Finanzas' }
            ],
            'Tecnología': [
                { url: 'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg', alt: 'Tecnología' },
                { url: 'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg', alt: 'Innovación' },
                { url: 'https://images.unsplash.com/photo-1518770660439-4636190af475', alt: 'Digital' }
            ]
        };

        const imagenes = imagenesRespaldo[categoria] || imagenesRespaldo['Nacionales'];
        const imagenElegida = imagenes[Math.floor(Math.random() * imagenes.length)];
        
        return {
            url: imagenElegida.url,
            alt: imagenElegida.alt,
            source: 'respaldo',
            autor: 'Banco interno'
        };

    } catch (error) {
        console.error('❌ Error buscando imagen:', error.message);
        return {
            url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
            alt: 'Noticia Dominicana',
            source: 'emergencia',
            autor: 'Sistema'
        };
    }
}

// ==================== 🤖 GENERAR NOTICIA CON GEMINI (VERSIÓN IMAGE_QUERY) ====================
async function generarNoticiaCompleta(categoria) {
    try {
        console.log(`\n🤖 Generando noticia SEO para: ${categoria}`);

        const prompt = `Genera una noticia profesional sobre ${categoria} en República Dominicana.

IMPORTANTE:
- Título: Atractivo, único, 50-60 caracteres
- Contenido: 400-500 palabras
- Incluye datos específicos de RD, lugares, fechas
- Estructura: Párrafos cortos (2-3 líneas)
- Cita a "expertos" o "autoridades"
- Usa palabras clave: ${categoria.toLowerCase()}, república dominicana, santo domingo
- Sin asteriscos, sin formato especial

Responde EXACTAMENTE con este formato:

TITULO: [título]
DESCRIPCION_SEO: [descripción, máx 160 caracteres]
PALABRAS_CLAVE: [5 palabras clave separadas por coma]
IMAGE_QUERY: 
[4 frases de búsqueda de imágenes en inglés, una por línea, relacionadas con la noticia]
CONTENIDO: [contenido completo de 400-500 palabras]

Ejemplo de IMAGE_QUERY correcto:
IMAGE_QUERY:
government housing project construction
workers building residential homes
modern apartment construction site
urban housing development dominican republic`;

        console.log(`📤 Enviando solicitud a Gemini...`);

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
                        maxOutputTokens: 3500,
                        topK: 40,
                        topP: 0.95
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini ${response.status}`);
        }

        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;
        console.log(`📝 Respuesta: ${texto.length} caracteres`);

        // ===== PARSEO MEJORADO CON IMAGE_QUERY =====
        let titulo = "";
        const tituloMatch = texto.match(/(?:TITULO|TÍTULO|Título):\s*(.+?)(?=\n(?:DESCRIPCION_SEO|DESCRIPCIÓN|Descripción)|$)/i);
        if (tituloMatch) {
            titulo = tituloMatch[1].trim().replace(/[*_#`]/g, '');
        }

        let seoDesc = "";
        const descMatch = texto.match(/(?:DESCRIPCION_SEO|DESCRIPCIÓN|Descripción(?:_SEO)?):\s*(.+?)(?=\n(?:PALABRAS_CLAVE|Palabras clave|IMAGE_QUERY|CONTENIDO)|$)/i);
        if (descMatch) {
            seoDesc = descMatch[1].trim().substring(0, 160).replace(/[*_#`]/g, '');
        } else {
            seoDesc = titulo.substring(0, 160);
        }

        let keywords = categoria;
        const keywordsMatch = texto.match(/(?:PALABRAS_CLAVE|Palabras clave|Keywords):\s*(.+?)(?=\n(?:IMAGE_QUERY|CONTENIDO|Contenido)|$)/i);
        if (keywordsMatch) {
            keywords = keywordsMatch[1].trim().substring(0, 255).replace(/[*_#`]/g, '');
        }

        // ===== NUEVO: EXTRAER IMAGE_QUERY =====
        let imageQueries = [];
        const imageQueryMatch = texto.match(/IMAGE_QUERY:\s*([\s\S]+?)(?=\nCONTENIDO:|Contenido:|$)/i);
        if (imageQueryMatch) {
            const queriesTexto = imageQueryMatch[1].trim();
            imageQueries = queriesTexto
                .split('\n')
                .map(q => q.trim())
                .filter(q => q.length > 0 && !q.startsWith('CONTENIDO'));
        }

        // Si no hay IMAGE_QUERY, generar queries básicas del título
        if (imageQueries.length === 0) {
            console.log('⚠️ No se encontró IMAGE_QUERY, generando desde título...');
            const palabras = titulo
                .toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(' ')
                .filter(p => p.length > 3)
                .slice(0, 4);
            
            imageQueries = [
                palabras.join(' '),
                `${categoria} dominican republic`,
                `noticias ${categoria}`,
                `${categoria} santo domingo`
            ];
        }

        console.log(`📸 IMAGE_QUERY encontradas:`);
        imageQueries.forEach((q, i) => console.log(`   ${i+1}. ${q}`));

        let contenido = "";
        const contenidoMatch = texto.match(/(?:CONTENIDO|Contenido):\s*([\s\S]+?)$/i);
        if (contenidoMatch) {
            contenido = contenidoMatch[1].trim().replace(/[*_#`]/g, '');
        }

        // Validaciones
        if (!titulo || titulo.length < 10) {
            titulo = `Nuevos avances en ${categoria} transforman la realidad dominicana`;
        }

        if (!contenido || contenido.length < 200) {
            contenido = `Las autoridades dominicanas han anunciado importantes medidas en el ámbito de ${categoria}...`;
        }

        console.log(`✅ Título: ${titulo.substring(0, 70)}`);
        console.log(`✅ Contenido: ${contenido.length} caracteres`);

        // ===== BUSCAR IMAGEN CON LAS QUERIES =====
        const imagenData = await buscarImagen(imageQueries, categoria);
        
        const slug = generarSlug(titulo);
        const redactorAsignado = elegirRedactor(categoria);
        
        console.log(`👤 Redactor asignado: ${redactorAsignado}`);
        console.log(`🖼️ Imagen obtenida de: ${imagenData.source}`);

        // Verificar slug duplicado
        const slugExistente = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        let slugFinal = slug;
        if (slugExistente.rows.length > 0) {
            slugFinal = `${slug}-${Date.now().toString().slice(-4)}`;
        }

        // Guardar en BD
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
                slugFinal,
                categoria,
                contenido,
                seoDesc,
                keywords.substring(0, 255),
                redactorAsignado,
                imagenData.url,
                imagenData.alt,
                'Santo Domingo',
                'publicada'
            ]
        );

        const noticia = result.rows[0];
        console.log(`✅ Noticia guardada con ID: ${noticia.id}`);
        console.log(`✅ URL: ${BASE_URL}/noticia/${noticia.slug}`);

        return {
            success: true,
            id: noticia.id,
            slug: noticia.slug,
            titulo: noticia.titulo,
            url: `${BASE_URL}/noticia/${noticia.slug}`,
            imagen: noticia.imagen,
            redactor: redactorAsignado,
            fuente_imagen: imagenData.source,
            autor_imagen: imagenData.autor,
            mensaje: '✅ Noticia generada con imagen perfecta'
        };

    } catch (error) {
        console.error(`\n❌ ERROR:`, error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// ==================== ⏰ AUTOMATIZACIÓN ====================
console.log('\n📅 Configurando automatización...');
cron.schedule('0 */6 * * *', async () => {
    console.log('\n⏰ Generando noticia automática...');
    const categoria = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticiaCompleta(categoria);
});
cron.schedule('0 8 * * *', async () => {
    console.log('\n🌅 Generando noticia diaria...');
    await generarNoticiaCompleta('Nacionales');
});
console.log('✅ Automatización configurada');

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
    const slugBuscado = req.params.slug;
    console.log(`\n🔍 Buscando noticia con slug: "${slugBuscado}"`);
    
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE slug = $1 AND estado = $2',
            [slugBuscado, 'publicada']
        );

        if (result.rows.length === 0) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Noticia no encontrada</title>
                    <style>
                        body { font-family: Arial; text-align: center; padding: 50px; background: #0b0b0b; color: white; }
                        h1 { color: #c62828; }
                        a { color: #FF8C00; }
                    </style>
                </head>
                <body>
                    <h1>🔍 Noticia no encontrada</h1>
                    <a href="/">← Volver al inicio</a>
                </body>
                </html>
            `);
        }

        const noticia = result.rows[0];
        console.log(`✅ Noticia encontrada: "${noticia.titulo}"`);

        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [noticia.id]);

        const contenidoFormateado = noticia.contenido
            .split('\n')
            .filter(p => p.trim() !== '')
            .map(p => `<p>${p.trim()}</p>`)
            .join('');

        try {
            let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
            const urlCompartir = `${BASE_URL}/noticia/${noticia.slug}`;
            
            const metaTags = `
<title>${noticia.titulo} | El Farol al Día</title>
<meta name="description" content="${noticia.seo_description || noticia.titulo}">
<meta name="keywords" content="${noticia.seo_keywords || noticia.seccion}">
<meta property="og:title" content="${noticia.titulo}">
<meta property="og:description" content="${noticia.seo_description || noticia.titulo}">
<meta property="og:image" content="${noticia.imagen}">
<meta property="og:url" content="${urlCompartir}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "${noticia.titulo}",
  "description": "${noticia.seo_description || noticia.titulo}",
  "image": "${noticia.imagen}",
  "datePublished": "${noticia.fecha}",
  "author": {"@type": "Person", "name": "${noticia.redactor}"},
  "publisher": {
    "@type": "Organization",
    "name": "El Farol al Día",
    "logo": {"@type": "ImageObject", "url": "${BASE_URL}/logo.png"}
  }
}
</script>`;

            html = html.replace('<!-- META_TAGS -->', metaTags);
            html = html.replace(/{{TITULO}}/g, noticia.titulo);
            html = html.replace(/{{CONTENIDO}}/g, contenidoFormateado);
            html = html.replace(/{{FECHA}}/g, new Date(noticia.fecha).toLocaleDateString('es-DO', {
                year: 'numeric', month: 'long', day: 'numeric'
            }));
            html = html.replace(/{{IMAGEN}}/g, noticia.imagen);
            html = html.replace(/{{ALT}}/g, noticia.imagen_alt || noticia.titulo);
            html = html.replace(/{{VISTAS}}/g, noticia.vistas);
            html = html.replace(/{{SECCION}}/g, noticia.seccion);
            html = html.replace(/{{REDACTOR}}/g, noticia.redactor);
            html = html.replace(/{{URL}}/g, urlCompartir);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
            
        } catch (error) {
            console.error('Error leyendo HTML:', error.message);
            res.json({ success: true, noticia });
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
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
            version: '8.0'
        });
    } catch (error
