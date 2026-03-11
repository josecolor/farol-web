/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR PROFESIONAL V12.0
 * COMPLETO - CON DISEÑO ORIGINAL - SIN ERRORES
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

// ==================== GENERAR NOTICIA CON GEMINI ====================
async function generarNoticiaCompleta(categoria) {
    try {
        console.log(`\n🤖 Generando noticia de: ${categoria}`);
        
        const prompt = `Genera una noticia profesional sobre ${categoria} en República Dominicana.
        
TITULO: [título atractivo de 50-60 caracteres]
DESCRIPCION: [descripción SEO, máximo 160 caracteres]
PALABRAS: [5 palabras clave separadas por coma]
CONTENIDO: [texto completo de 300-400 palabras]`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }]
                })
            }
        );

        if (!response.ok) throw new Error(`Gemini ${response.status}`);
        
        const data = await response.json();
        const texto = data.candidates[0].content.parts[0].text;
        
        // Extraer datos
        const tituloMatch = texto.match(/TITULO:\s*(.+)/i);
        const descMatch = texto.match(/DESCRIPCION:\s*(.+)/i);
        const palabrasMatch = texto.match(/PALABRAS:\s*(.+)/i);
        const contenidoMatch = texto.match(/CONTENIDO:\s*([\s\S]+)/i);
        
        const titulo = tituloMatch ? tituloMatch[1].trim() : `Nueva noticia de ${categoria}`;
        const descripcion = descMatch ? descMatch[1].trim().substring(0, 160) : titulo;
        const palabras = palabrasMatch ? palabrasMatch[1].trim() : categoria;
        const contenido = contenidoMatch ? contenidoMatch[1].trim() : texto;
        
        // IMAGEN DE RESPALDO
        const imagenesRespaldo = {
            'Nacionales': 'https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Deportes': 'https://images.pexels.com/photos/46798/the-ball-stadion-football-the-pitch-46798.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Internacionales': 'https://images.pexels.com/photos/2860705/pexels-photo-2860705.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Espectáculos': 'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Economía': 'https://images.pexels.com/photos/4386466/pexels-photo-4386466.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2',
            'Tecnología': 'https://images.pexels.com/photos/3861958/pexels-photo-3861958.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2'
        };
        
        const imagenUrl = imagenesRespaldo[categoria] || imagenesRespaldo['Nacionales'];
        const slug = generarSlug(titulo);
        const redactor = elegirRedactor(categoria);
        
        // Verificar slug duplicado
        const existente = await pool.query('SELECT id FROM noticias WHERE slug = $1', [slug]);
        const slugFinal = existente.rows.length > 0 ? `${slug}-${Date.now().toString().slice(-4)}` : slug;
        
        const result = await pool.query(
            `INSERT INTO noticias 
            (titulo, slug, seccion, contenido, seo_description, seo_keywords, redactor, imagen, imagen_alt, ubicacion, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, slug`,
            [
                titulo.substring(0, 255),
                slugFinal,
                categoria,
                contenido,
                descripcion,
                palabras.substring(0, 255),
                redactor,
                imagenUrl,
                `Noticia de ${categoria}`,
                'Santo Domingo',
                'publicada'
            ]
        );

        console.log(`✅ Noticia: ${titulo.substring(0, 50)}...`);
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

// Página principal con diseño
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>El Farol al Día</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { background: #0b0b0b; color: #fff; font-family: 'Segoe UI', sans-serif; }
                .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
                header { background: #1a1a1a; border-bottom: 4px solid #FF8C00; padding: 1rem 0; }
                .logo { color: #FF8C00; font-size: 2rem; text-align: center; }
                nav { text-align: center; margin: 20px 0; }
                nav a { color: white; margin: 0 15px; text-decoration: none; }
                nav a:hover { color: #FF8C00; }
                .hero { text-align: center; padding: 50px 20px; }
                .hero h1 { color: #FF8C00; font-size: 3rem; margin-bottom: 20px; }
                .btn { background: #FF8C00; color: black; padding: 15px 30px; border-radius: 40px; text-decoration: none; font-weight: bold; }
                footer { background: #1a1a1a; padding: 20px; text-align: center; margin-top: 50px; }
            </style>
        </head>
        <body>
            <header>
                <div class="container">
                    <h1 class="logo">🏮 El Farol al Día</h1>
                </div>
            </header>
            <nav>
                <a href="/">Inicio</a>
                <a href="/redaccion">Redacción</a>
                <a href="/api/noticias">API</a>
            </nav>
            <div class="hero">
                <h1>Noticias con Inteligencia Artificial</h1>
                <p>El periódico dominicano que nunca duerme</p>
                <a href="/redaccion" class="btn">Ir a Redacción</a>
            </div>
            <footer>
                <p>© 2026 El Farol al Día - Todos los derechos reservados</p>
            </footer>
        </body>
        </html>
    `);
});

// Panel de redacción con diseño original
app.get('/redaccion', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Redacción | El Farol al Día</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { background: #0b0b0b; color: #fff; font-family: 'Segoe UI', sans-serif; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; background: #1a1a1a; border-radius: 16px; padding: 30px; border-left: 4px solid #FF8C00; }
                h1 { color: #FF8C00; text-align: center; margin-bottom: 30px; }
                .categoria { width: 100%; padding: 15px; margin: 20px 0; background: #222; border: 2px solid #FF8C00; color: white; border-radius: 12px; }
                button { width: 100%; padding: 18px; background: #FF8C00; color: black; border: none; border-radius: 40px; font-size: 1.2rem; font-weight: bold; cursor: pointer; }
                button:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(255,140,0,0.3); }
                .resultado { margin-top: 30px; padding: 20px; background: #222; border-radius: 12px; display: none; }
                .resultado a { color: #FF8C00; }
                .noticias { margin-top: 30px; }
                .noticia-item { background: #222; padding: 15px; margin-bottom: 10px; border-radius: 8px; border-left: 3px solid #FF8C00; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🏮 Redacción del Búnker</h1>
                
                <select id="categoria" class="categoria">
                    ${CATEGORIAS.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
                
                <button onclick="generarNoticia()">🤖 GENERAR NOTICIA AHORA</button>
                
                <div id="resultado" class="resultado"></div>
                
                <div class="noticias">
                    <h2 style="color:#FF8C00; margin-bottom:15px;">📰 Últimas noticias</h2>
                    <div id="noticias"></div>
                </div>
            </div>

            <script>
                async function generarNoticia() {
                    const categoria = document.getElementById('categoria').value;
                    const resultado = document.getElementById('resultado');
                    resultado.style.display = 'block';
                    resultado.innerHTML = '<p>⏳ Generando noticia...</p>';
                    
                    const res = await fetch('/api/generar-noticia', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({categoria})
                    });
                    
                    const data = await res.json();
                    
                    if (data.success) {
                        resultado.innerHTML = \`
                            <p style="color:#4CAF50;">✅ Noticia generada</p>
                            <p><strong>Título:</strong> \${data.titulo}</p>
                            <img src="\${data.imagen}" style="max-width:100%; max-height:200px; border-radius:8px; margin:10px 0;">
                            <a href="\${data.url}" target="_blank" style="color:#FF8C00;">🔗 VER NOTICIA</a>
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
                            <div class="noticia-item">
                                <strong style="color:#FF8C00;">\${n.titulo.substring(0,60)}...</strong><br>
                                <small>\${n.seccion} | \${new Date(n.fecha).toLocaleDateString()}</small><br>
                                <a href="/noticia/\${n.slug}" target="_blank" style="color:#FF8C00;">Ver noticia</a>
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

// Ver noticia individual con diseño original
app.get('/noticia/:slug', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM noticias WHERE slug = $1', [req.params.slug]);
        
        if (result.rows.length === 0) {
            return res.status(404).send(`
                <html><body style="background:#0b0b0b; color:white; text-align:center; padding:50px;">
                    <h1 style="color:#c62828;">🔍 Noticia no encontrada</h1>
                    <a href="/" style="color:#FF8C00;">← Volver al inicio</a>
                </body></html>
            `);
        }
        
        const n = result.rows[0];
        await pool.query('UPDATE noticias SET vistas = vistas + 1 WHERE id = $1', [n.id]);
        
        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${n.titulo} | El Farol al Día</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { background: #0b0b0b; color: #fff; font-family: 'Segoe UI', sans-serif; }
                    .container { max-width: 1000px; margin: 0 auto; padding: 20px; }
                    header { background: #1a1a1a; border-bottom: 4px solid #FF8C00; padding: 1rem 0; }
                    .logo a { color: #FF8C00; text-decoration: none; font-size: 2rem; }
                    .noticia { background: #1a1a1a; border-radius: 16px; padding: 30px; margin-top: 20px; border-left: 4px solid #FF8C00; }
                    .seccion { background: #FF8C00; color: black; padding: 5px 15px; border-radius: 20px; display: inline-block; margin-bottom: 15px; }
                    h1 { color: #FF8C00; font-size: 2.2rem; margin-bottom: 15px; }
                    .meta { color: #aaa; margin-bottom: 20px; }
                    .imagen { margin: 20px 0; border-radius: 12px; overflow: hidden; border: 2px solid #FF8C00; }
                    .imagen img { width: 100%; max-height: 500px; object-fit: cover; }
                    .contenido { line-height: 1.8; font-size: 1.1rem; }
                    footer { background: #1a1a1a; padding: 20px; text-align: center; margin-top: 40px; }
                </style>
            </head>
            <body>
                <header>
                    <div class="container">
                        <h1 class="logo"><a href="/">🏮 El Farol al Día</a></h1>
                    </div>
                </header>
                
                <main class="container">
                    <article class="noticia">
                        <span class="seccion">${n.seccion}</span>
                        <h1>${n.titulo}</h1>
                        <div class="meta">
                            📅 ${new Date(n.fecha).toLocaleDateString('es-DO')} | 
                            ✍️ ${n.redactor} | 
                            👁️ ${n.vistas || 0} vistas
                        </div>
                        
                        <div class="imagen">
                            <img src="${n.imagen}" alt="${n.imagen_alt || n.titulo}" onerror="this.src='https://images.pexels.com/photos/3052454/pexels-photo-3052454.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2'">
                        </div>
                        
                        <div class="contenido">
                            ${n.contenido.replace(/\n/g, '<br>')}
                        </div>
                    </article>
                </main>
                
                <footer>
                    <p>© 2026 El Farol al Día - Noticias con IA</p>
                </footer>
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
            'SELECT * FROM noticias WHERE estado = $1 ORDER BY fecha DESC LIMIT 30',
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
        console.log(`\n🚀 Servidor corriendo en puerto ${PORT}`);
        console.log(`📰 Redacción: http://localhost:${PORT}/redaccion`);
        console.log(`🏮 El Farol al Día - V12.0\n`);
    });
}

iniciar();
