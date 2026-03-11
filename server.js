/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V9.0
 * Gemini genera noticias con DETECCIÓN DE ENTIDADES
 * Horarios automáticos: Cada 6 horas + Diaria 8 AM
 * VERSIÓN DEFINITIVA - CON BÚSQUEDA INTELIGENTE DE PERSONAJES FAMOSOS
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

// ==================== 🖼️ BUSCAR IMAGEN CON ENTIDADES PRIORITARIAS ====================
async function buscarImagen(entity, imageQueries, categoria) {
    try {
        console.log(`🔍 Búsqueda de imágenes:`);
        console.log(`   Entity: ${entity || 'ninguna'}`);
        console.log(`   Queries: ${imageQueries.length}`);
        
        // Si imageQueries no es un array, convertirlo
        if (!Array.isArray(imageQueries)) {
            imageQueries = [imageQueries];
        }
        
        // CONSTRUIR LISTA DE QUERIES PRIORITARIAS
        let queriesPrioritarias = [];
        
        // Si hay ENTITY, crear queries con esa entidad
        if (entity && entity.length > 2) {
            console.log(`🎯 Usando ENTITY como prioridad: ${entity}`);
            
            // Queries específicas para la entidad según la categoría
            if (categoria === 'Espectáculos' || categoria === 'Deportes' || categoria === 'Internacionales') {
                queriesPrioritarias = [
                    `${entity} celebrity`,
                    `${entity} person`,
                    `${entity} portrait`,
                    `${entity} photo`,
                    `${entity} ${categoria.toLowerCase()}`
                ];
            } else if (categoria === 'Nacionales') {
                queriesPrioritarias = [
                    `${entity} político`,
                    `${entity} gobierno`,
                    `${entity} presidente`,
                    `${entity} funcionario`
                ];
            } else {
                queriesPrioritarias = [
                    `${entity}`,
                    `${entity} news`,
                    `${entity} ${categoria.toLowerCase()}`
                ];
            }
            
            // Traducir a inglés para las APIs
            queriesPrioritarias = queriesPrioritarias.map(q => q.replace(/[áéíóú]/g, (letra) => {
                const map = { 'á':'a', 'é':'e', 'í':'i', 'ó':'o', 'ú':'u' };
                return map[letra] || letra;
            }));
        }
        
        // Combinar queries: primero las prioritarias, luego las de IMAGE_QUERY
        const todasLasQueries = [...queriesPrioritarias, ...imageQueries].filter(q => q.length > 3);
        
        console.log(`📋 Queries a probar (${todasLasQueries.length}):`, todasLasQueries.slice(0, 3));
        
        // Convertir a formato de búsqueda
        const queriesFormateadas = todasLasQueries.map(q => q.trim().replace(/\s+/g, '+'));
        
        let imagenesEncontradas = [];
        
        // ========== 1. UNSPLASH ==========
        if (process.env.UNSPLASH_ACCESS_KEY) {
            for (const query of queriesFormateadas) {
                try {
                    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&orientation=landscape&per_page=5`;
                    const response = await fetch(url);
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.results && data.results.length > 0) {
                            data.results.forEach(img => {
                                // Calcular relevancia
                                let relevancia = 0;
                                const descripcion = (img.alt_description || img.description || '').toLowerCase();
                                const tags = img.tags?.map(t => t.title.toLowerCase()) || [];
                                
                                // Si es la primera query (la más prioritaria), dar bonus
                                if (query === queriesFormateadas[0]) relevancia += 5;
                                
                                // Si contiene el nombre de la entidad
                                if (entity && descripcion.includes(entity.toLowerCase())) relevancia += 10;
                                
                                imagenesEncontradas.push({
                                    url: img.urls.regular,
                                    alt: img.alt_description || img.description || 'Noticia',
                                    source: 'Unsplash',
                                    relevancia: relevancia,
                                    query: query
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.log(`⚠️ Unsplash error: ${e.message}`);
                }
            }
        }
        
        // ========== 2. PEXELS ==========
        if (process.env.PEXELS_API_KEY && imagenesEncontradas.length < 10) {
            for (const query of queriesFormateadas) {
                try {
                    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
                    const response = await fetch(url, {
                        headers: { 'Authorization': process.env.PEXELS_API_KEY }
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.photos && data.photos.length > 0) {
                            data.photos.forEach(img => {
                                let relevancia = 0;
                                if (query === queriesFormateadas[0]) relevancia += 5;
                                
                                imagenesEncontradas.push({
                                    url: img.src.landscape,
                                    alt: img.alt || 'Noticia',
                                    source: 'Pexels',
                                    relevancia: relevancia,
                                    query: query
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.log(`⚠️ Pexels error: ${e.message}`);
                }
            }
        }
        
        // ========== 3. PIXABAY ==========
        if (process.env.PIXABAY_API_KEY && imagenesEncontradas.length < 10) {
            for (const query of queriesFormateadas) {
                try {
                    const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=5&safesearch=true`;
                    const response = await fetch(url);
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.hits && data.hits.length > 0) {
                            data.hits.forEach(img => {
                                let relevancia = 0;
                                if (query === queriesFormateadas[0]) relevancia += 5;
                                
                                imagenesEncontradas.push({
                                    url: img.webformatURL,
                                    alt: img.tags || 'Noticia',
                                    source: 'Pixabay',
                                    relevancia: relevancia,
                                    query: query
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.log(`⚠️ Pixabay error: ${e.message}`);
                }
            }
        }
        
        // ========== SELECCIONAR LA MEJOR IMAGEN ==========
        if (imagenesEncontradas.length > 0) {
            // Ordenar por relevancia
            imagenesEncontradas.sort((a, b) => (b.relevancia || 0) - (a.relevancia || 0));
            
            // Mostrar top resultados
            console.log(`📊 Mejores resultados:`);
            imagenesEncontradas.slice(0, 3).forEach((img, i) => {
                console.log(`   ${i+1}. ${img.source} | relevancia: ${img.relevancia || 0} | query: ${img.query}`);
            });
            
            // Elegir el primero (mayor relevancia)
            const seleccionada = imagenesEncontradas[0];
            console.log(`✅ Imagen seleccionada de ${seleccionada.source} (relevancia: ${seleccionada.relevancia || 0})`);
            
            return {
                url: seleccionada.url,
                alt: seleccionada.alt || `Noticia sobre ${entity || categoria}`,
                source: seleccionada.source
            };
        }
        
        // ========== BANCO DE RESPALDO POR CATEGORÍA ==========
        console.log(`📸 Usando banco de respaldo para: ${categoria}`);
        
        const imagenesRespaldo = {
            'Nacionales': [
                { url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg', alt: 'Gobierno dominicano', source: 'respaldo' },
                { url: 'https://images.pexels.com/photos/290595/pexels-photo-290595.jpeg', alt: 'Congreso', source: 'respaldo' }
            ],
            'Deportes': [
                { url: 'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg', alt: 'Estadio', source: 'respaldo' },
                { url: 'https://images.pexels.com/photos/1884574/pexels-photo-1884574.jpeg', alt: 'Béisbol', source: 'respaldo' }
            ],
            'Internacionales': [
                { url: 'https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg', alt: 'Relaciones internacionales', source: 'respaldo' },
                { url: 'https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg', alt: 'Mundo', source: 'respaldo' }
            ],
            'Espectáculos': [
                { url: 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg', alt: 'Concierto', source: 'respaldo' },
                { url: 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg', alt: 'Espectáculo', source: 'respaldo' }
            ],
            'Economía': [
                { url: 'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg', alt: 'Negocios', source: 'respaldo' },
                { url: 'https://images.pexels.com/photos/6772070/pexels-photo-6772070.jpeg', alt: 'Economía', source: 'respaldo' }
            ],
            'Tecnología': [
                { url: 'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg', alt: 'Tecnología', source: 'respaldo' },
                { url: 'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg', alt: 'Innovación', source: 'respaldo' }
            ]
        };

        const imagenes = imagenesRespaldo[categoria] || imagenesRespaldo['Nacionales'];
        return imagenes[Math.floor(Math.random() * imagenes.length)];

    } catch (error) {
        console.error('❌ Error buscando imagen:', error.message);
        return {
            url: 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg',
            alt: 'Noticia',
            source: 'emergencia'
        };
    }
}

// ==================== 🤖 GENERAR NOTICIA CON GEMINI (VERSIÓN CON ENTIDADES) ====================
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
ENTITY: [nombre de la persona principal, artista, DJ, político, equipo, o dejar vacío si no aplica]
DESCRIPCION_SEO: [descripción, máx 160 caracteres]
PALABRAS_CLAVE: [5 palabras clave separadas por coma]
IMAGE_QUERY: [4 frases de búsqueda de imágenes en inglés, separadas por comas]
CONTENIDO: [contenido completo de 400-500 palabras]

Ejemplo con ENTITY:
TITULO: Diplo sorprende con nuevo set en festival de Miami
ENTITY: Diplo
DESCRIPCION_SEO: El reconocido DJ y productor Diplo presentó un innovador set en el festival de Miami
PALABRAS_CLAVE: Diplo, música electrónica, festival, DJ, Miami
IMAGE_QUERY: Diplo DJ performing live, Diplo festival stage, Diplo electronic music performance
CONTENIDO: El reconocido DJ estadounidense...

Ejemplo sin ENTITY:
TITULO: Nuevo plan de viviendas en Santo Domingo
ENTITY: 
DESCRIPCION_SEO: El gobierno anuncia plan de viviendas sociales
PALABRAS_CLAVE: viviendas, gobierno, construcción, santo domingo
IMAGE_QUERY: government housing project, construction workers building homes
CONTENIDO: El presidente...`;

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
            const errorText = await response.text();
            console.error('❌ Error Gemini:', errorText);
            throw new Error(`Gemini ${response.status}`);
        }

        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;
        console.log(`📝 Respuesta: ${texto.length} caracteres`);

        // PARSEO CORREGIDO
        const lineas = texto.split('\n').filter(l => l.trim() !== '');
        
        let titulo = "";
        let entity = "";
        let seoDesc = "";
        let keywords = categoria;
        let imageQueries = [];
        let contenido = "";

        let seccionActual = "";
        for (const linea of lineas) {
            const lineaUpper = linea.toUpperCase();
            
            if (lineaUpper.includes('TITULO:') || lineaUpper.includes('TÍTULO:')) {
                seccionActual = 'titulo';
                titulo = linea.replace(/TITULO:|TÍTULO:|Título:/i, '').trim();
            }
            else if (lineaUpper.includes('ENTITY:')) {
                seccionActual = 'entity';
                entity = linea.replace(/ENTITY:/i, '').trim();
            }
            else if (lineaUpper.includes('DESCRIPCION_SEO:') || lineaUpper.includes('DESCRIPCIÓN:')) {
                seccionActual = 'desc';
                seoDesc = linea.replace(/DESCRIPCION_SEO:|DESCRIPCIÓN:|Descripción:/i, '').trim();
            }
            else if (lineaUpper.includes('PALABRAS_CLAVE:') || lineaUpper.includes('PALABRAS CLAVE:')) {
                seccionActual = 'keywords';
                keywords = linea.replace(/PALABRAS_CLAVE:|PALABRAS CLAVE:|Palabras clave:/i, '').trim();
            }
            else if (lineaUpper.includes('IMAGE_QUERY:')) {
                seccionActual = 'image_query';
                const queriesTexto = linea.replace(/IMAGE_QUERY:/i, '').trim();
                imageQueries = queriesTexto.split(',').map(q => q.trim()).filter(q => q.length > 0);
            }
            else if (lineaUpper.includes('CONTENIDO:')) {
                seccionActual = 'contenido';
                contenido = linea.replace(/CONTENIDO:/i, '').trim();
            }
            else {
                // Acumular según la sección actual
                if (seccionActual === 'titulo' && linea) {
                    titulo += ' ' + linea.trim();
                } else if (seccionActual === 'entity' && linea) {
                    entity += ' ' + linea.trim();
                } else if (seccionActual === 'desc' && linea) {
                    seoDesc += ' ' + linea.trim();
                } else if (seccionActual === 'keywords' && linea) {
                    keywords += ' ' + linea.trim();
                } else if (seccionActual === 'image_query' && linea) {
                    const nuevasQueries = linea.split(',').map(q => q.trim()).filter(q => q.length > 0);
                    imageQueries = [...imageQueries, ...nuevasQueries];
                } else if (seccionActual === 'contenido' && linea) {
                    contenido += '\n' + linea.trim();
                }
            }
        }

        // Limpiar y validar
        titulo = titulo.replace(/[*_#`]/g, '').trim();
        entity = entity.replace(/[*_#`]/g, '').trim();
        seoDesc = seoDesc.replace(/[*_#`]/g, '').substring(0, 160).trim();
        keywords = keywords.replace(/[*_#`]/g, '').substring(0, 255).trim();
        
        // Si no hay IMAGE_QUERY, generar algunas
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

        console.log(`📌 ENTITY detectada: ${entity || 'ninguna'}`);
        console.log(`📸 IMAGE_QUERY (${imageQueries.length}):`, imageQueries.slice(0, 3));

        if (!titulo || titulo.length < 10) {
            titulo = `Nuevos avances en ${categoria} transforman la realidad dominicana`;
        }

        if (!contenido || contenido.length < 200) {
            contenido = `Las autoridades dominicanas han anunciado importantes medidas en el ámbito de ${categoria} que buscan mejorar la calidad de vida de los ciudadanos. Según expertos consultados por El Farol al Día, estas iniciativas representan un avance significativo para el país.`;
        }

        console.log(`✅ Título: ${titulo.substring(0, 70)}`);
        console.log(`✅ Contenido: ${contenido.length} caracteres`);

        // BUSCAR IMAGEN CON ENTIDAD PRIORITARIA
        const imagenData = await buscarImagen(entity, imageQueries, categoria);
        
        const slug = generarSlug(titulo);
        const redactorAsignado = elegirRedactor(categoria);
        
        console.log(`👤 Redactor asignado: ${redactorAsignado}`);
        console.log(`🖼️ Imagen: ${imagenData.source || 'desconocida'}`);

        // Verificar slug duplicado
        const slugExistente = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        let slugFinal = slug;
        if (slugExistente.rows.length > 0) {
            slugFinal = `${slug}-${Date.now().toString().slice(-4)}`;
        }

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
                imagenData.alt || `Noticia sobre ${entity || categoria}`,
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
            entity: entity || 'ninguna',
            fuente_imagen: imagenData.source,
            mensaje: '✅ Noticia generada'
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

        let xml = '<?xml version="1.0
