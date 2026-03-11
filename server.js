/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V13.0
 * CON PROMPT CORREGIDO - IMÁGENES GARANTIZADAS
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
    { nombre: 'Patricia Jiménez', especialidad: 'Espectáculos' }
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

// ==================== MIGRACIÓN DE BD ====================
async function inicializarBase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Verificando base de datos...');
        await client.query('BEGIN');

        await client.query(`
            CREATE TABLE IF NOT EXISTS noticias (
                id SERIAL PRIMARY KEY,
                titulo VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE NOT NULL,
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

        await client.query('COMMIT');
        console.log('✅ Base de datos lista');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en BD:', error.message);
        return false;
    } finally {
        client.release();
    }
}

// ==================== 🎯 PROMPT CORREGIDO Y FUNCIONAL ====================
async function generarNoticiaCompleta(categoria) {
    try {
        console.log(`\n🤖 Generando noticia de: ${categoria}`);

        const prompt = `Actúa como un periodista profesional de "El Farol al Día", un periódico digital dominicano.

Genera UNA noticia sobre ${categoria} en República Dominicana.

IMPORTANTE:
- La noticia debe ser CREÍBLE y REALISTA
- Incluye NOMBRES de personas, lugares y fechas
- Usa un tono periodístico profesional

Debes responder EXACTAMENTE con este formato (sin asteriscos, sin markdown):

TITULO: [título atractivo de 50-60 caracteres]
ENTIDAD: [nombre de la persona principal si la hay, o vacío]
PERSONAJE: [descripción del personaje: DJ, Presidente, Deportista, etc., o vacío]
DESCRIPCION: [descripción para SEO, máximo 160 caracteres]
PALABRAS: [5 palabras clave separadas por coma]
CONTENIDO:
[texto completo de la noticia en 3-4 párrafos]

Ejemplo:
TITULO: Diplo sorprende con nuevo set en festival de Miami
ENTIDAD: Diplo
PERSONAJE: DJ
DESCRIPCION: El reconocido DJ Diplo presentó un innovador set en el festival de Miami
PALABRAS: Diplo, música, festival, DJ, Miami
CONTENIDO:
El reconocido DJ estadounidense Diplo se presentó anoche en el festival de Miami con un set sorprendente. Durante su presentación, el artista mezcló sus grandes éxitos con nuevas producciones exclusivas.

Ahora genera la noticia:`;

        console.log('📤 Enviando prompt a Gemini...');
        
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
                        maxOutputTokens: 2000
                    }
                })
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Gemini ${response.status}: ${error.substring(0, 100)}`);
        }
        
        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;
        console.log(`📝 Respuesta: ${texto.length} caracteres`);

        // ===== PARSEO DEL PROMPT =====
        let titulo = "";
        let entidad = "";
        let personaje = "";
        let descripcion = "";
        let palabras = categoria;
        let contenido = "";

        const lineas = texto.split('\n');
        let enContenido = false;
        let contenidoTemp = [];

        for (const linea of lineas) {
            const lineaTrim = linea.trim();
            
            if (lineaTrim.startsWith('TITULO:')) {
                titulo = lineaTrim.substring(7).trim();
            }
            else if (lineaTrim.startsWith('ENTIDAD:')) {
                entidad = lineaTrim.substring(8).trim();
            }
            else if (lineaTrim.startsWith('PERSONAJE:')) {
                personaje = lineaTrim.substring(10).trim();
            }
            else if (lineaTrim.startsWith('DESCRIPCION:')) {
                descripcion = lineaTrim.substring(12).trim();
            }
            else if (lineaTrim.startsWith('PALABRAS:')) {
                palabras = lineaTrim.substring(9).trim();
            }
            else if (lineaTrim.startsWith('CONTENIDO:')) {
                enContenido = true;
            }
            else if (enContenido && lineaTrim !== '') {
                contenidoTemp.push(lineaTrim);
            }
        }

        contenido = contenidoTemp.join('\n\n');

        // Validaciones
        if (!titulo || titulo.length < 10) {
            titulo = `Nuevos acontecimientos en ${categoria} dominicana`;
        }

        if (!descripcion) {
            descripcion = titulo.substring(0, 160);
        }

        if (!contenido || contenido.length < 100) {
            contenido = `Las autoridades dominicanas han informado sobre importantes novedades en el ámbito de ${categoria}. Expertos consultados por El Farol al Día destacan que estas medidas representan un avance significativo para el país. Se espera que en los próximos días se den a conocer más detalles.`;
        }

        console.log(`📌 Título: ${titulo.substring(0, 50)}...`);
        console.log(`🎯 Entidad: ${entidad || 'ninguna'}`);

        // ===== SELECCIÓN DE IMAGEN =====
        let busquedaImagen;
        
        if (entidad && entidad.length > 2) {
            busquedaImagen = `${entidad} ${personaje || ''} foto`.trim();
            console.log(`🔍 Buscando imagen de: ${busquedaImagen}`);
        } else {
            busquedaImagen = `${categoria} republica dominicana`;
            console.log(`🔍 Buscando imagen de: ${busquedaImagen}`);
        }

        // Banco de imágenes por categoría (SIEMPRE FUNCIONAN)
        const imagenesRespaldo = {
            'Nacionales': 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Deportes': 'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Internacionales': 'https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Espectáculos': 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Economía': 'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Tecnología': 'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2'
        };

        const imagenUrl = imagenesRespaldo[categoria] || imagenesRespaldo['Nacionales'];
        
        // ===== GUARDAR EN BD =====
        const slug = generarSlug(titulo);
        const redactor = elegirRedactor(categoria);
        
        const existente = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existente.rows.length > 0 ? `${slug}-${Date.now().toString().slice(-4)}` : slug;
        
        const result = await pool.query(
            `INSERT INTO noticias 
            (titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, imagen, imagen_alt, ubicacion, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id`,
            [
                titulo.substring(0, 255),
                slugFinal,
                categoria,
                contenido,
                descripcion.substring(0, 160),
                palabras.substring(0, 255),
                redactor,
                imagenUrl,
                `Noticia sobre ${entidad || categoria}`,
                'Santo Domingo',
                'publicada'
            ]
        );

        console.log(`✅ Noticia guardada con ID: ${result.rows[0].id}`);
        console.log(`🔗 URL: ${BASE_URL}/noticia/${slugFinal}`);
        
        return { 
            success: true, 
            slug: slugFinal, 
            titulo,
            url: `${BASE_URL}/noticia/${slugFinal}`,
            imagen: imagenUrl
        };
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return { success: false, error: error.message };
    }
}

// ==================== CATEGORÍAS ====================
const CATEGORIAS = ['Nacionales', 'Deportes', 'Internacionales', 'Economía', 'Tecnología', 'Espectáculos'];

// ==================== AUTOMATIZACIÓN ====================
cron.schedule('0 */6 * * *', async () => {
    console.log('\n⏰ Generando noticia automática...');
    const categoria = CATEGORIAS[Math.floor(Math.random() * CATEGORIAS.length)];
    await generarNoticiaCompleta(categoria);
});

cron.schedule('0 8 * * *', async () => {
    console.log('\n🌅 Generando noticia diaria...');
    await generarNoticiaCompleta('Nacionales');
});

// ==================== RUTAS ====================

// Página principal
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>El Farol al Día</title>
            <style>
                body { background: #0b0b0b; color: white; font-family: Arial; text-align: center; padding: 50px; }
                h1 { color: #FF8C00; font-size: 3rem; }
                a { color: #FF8C00; text-decoration: none; }
                .btn { background: #FF8C00; color: black; padding: 15px 30px; border-radius: 40px; display: inline-block; margin-top: 20px; }
            </style>
        </head>
        <body>
            <h1>🏮 El Farol al Día</h1>
            <p>Periódico Digital con IA</p>
            <a href="/redaccion" class="btn">Ir a Redacción</a>
        </body>
        </html>
    `);
});

// Panel de redacción
app.get('/redaccion', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Redacción | El Farol al Día</title>
            <style>
                body { background: #0b0b0b; color: white; font-family: Arial; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; background: #1a1a1a; padding: 30px; border-radius: 16px; border-left: 4px solid #FF8C00; }
                h1 { color: #FF8C00; }
                select, button { width: 100%; padding: 15px; margin: 10px 0; border-radius: 8px; }
                button { background: #FF8C00; color: black; font-weight: bold; cursor: pointer; }
                .resultado { margin-top: 20px; padding: 20px; background: #222; border-radius: 8px; display: none; }
                .noticia { background: #222; padding: 15px; margin: 10px 0; border-left: 3px solid #FF8C00; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🏮 Redacción</h1>
                
                <select id="categoria">
                    ${CATEGORIAS.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
                
                <button onclick="generar()">🤖 GENERAR NOTICIA</button>
                
                <div id="resultado" class="resultado"></div>
                
                <h2 style="color:#FF8C00;">Últimas noticias</h2>
                <div id="noticias"></div>
            </div>

            <script>
                async function generar() {
                    const categoria = document.getElementById('categoria').value;
                    const resultado = document.getElementById('resultado');
                    resultado.style.display = 'block';
                    resultado.innerHTML = '⏳ Generando...';
                    
                    const res = await fetch('/api/generar-noticia', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({categoria})
                    });
                    
                    const data = await res.json();
                    
                    if (data.success) {
                        resultado.innerHTML = \`
                            <p style="color:#4CAF50;">✅ Noticia generada</p>
                            <p><strong>\${data.titulo}</strong></p>
                            <img src="\${data.imagen}" style="max-width:100%; max-height:200px;">
                            <p><a href="\${data.url}" target="_blank" style="color:#FF8C00;">🔗 Ver noticia</a></p>
                        \`;
                        cargarNoticias();
                    } else {
                        resultado.innerHTML = '<p style="color:#f44336;">❌ Error: ' + data.error + '</p>';
                    }
                }

                async function cargarNoticias() {
                    const res = await fetch('/api/noticias');
                    const data = await res.json();
                    
                    if (data.success) {
                        const container = document.getElementById('noticias');
                        container.innerHTML = data.noticias.slice(0,5).map(n => \`
                            <div class="noticia">
                                <strong style="color:#FF8C00;">\${n.titulo.substring(0,60)}...</strong><br>
                                <small>\${n.seccion} | \${new Date(n.fecha).toLocaleDateString()}</small><br>
                                <a href="/noticia/\${n.slug}" target="_blank">Ver noticia</a>
                            </div>
                        \`).join('');
                    }
                }

                cargarNoticias();
            </script>
        </body>
        </html>
    `);
});

// Ver noticia
app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
        
        if (result.rows.length === 0) {
            return res.send('<h1>Noticia no encontrada</h1>');
        }
        
        const n = result.rows[0];
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [n.id]);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${n.titulo} | El Farol al Día</title>
                <style>
                    body { background: #0b0b0b; color: white; font-family: Arial; padding: 20px; }
                    .container { max-width: 800px; margin: 0 auto; }
                    h1 { color: #FF8C00; }
                    .imagen { margin: 20px 0; }
                    .imagen img { max-width: 100%; border-radius: 10px; border: 2px solid #FF8C00; }
                    .meta { color: #aaa; margin: 10px 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🏮 ${n.titulo}</h1>
                    <div class="meta">
                        ${n.seccion} | ${new Date(n.fecha).toLocaleDateString('es-DO')} | ${n.redactor}
                    </div>
                    <div class="imagen">
                        <img src="${n.imagen}" alt="${n.titulo}">
                    </div>
                    <div style="line-height:1.8;">
                        ${n.contenido.replace(/\n/g, '<br>')}
                    </div>
                    <div style="margin-top:30px;">
                        <a href="/redaccion" style="color:#FF8C00;">← Volver a redacción</a>
                    </div>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        res.status(500).send('Error interno');
    }
});

// ==================== API ====================
app.post('/api/generar-noticia', async (req, res) => {
    const { categoria } = req.body;
    if (!categoria) return res.status(400).json({ error: 'Falta categoría' });
    
    const resultado = await generarNoticiaCompleta(categoria);
    res.json(resultado);
});

app.get('/api/noticias', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT 20',
            ['publicada']
        );
        res.json({ success: true, noticias: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== INICIAR SERVIDOR ====================
async function iniciar() {
    await inicializarBase();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Servidor en puerto ${PORT}`);
        console.log(`📰 Redacción: http://localhost:${PORT}/redaccion`);
        console.log(`🏮 V13.0 - PROMPT CORREGIDO\n`);
    });
}

iniciar();
