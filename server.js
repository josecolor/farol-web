const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

// ================= VALIDACIÓN ESTRICTA DE MONGO_URI =================
const MONGODB_URI = process.env.MONGO_URI;

if (!MONGODB_URI) {
    console.error('\n❌ ERROR CRÍTICO: MONGO_URI no está definida');
    console.error('🔴 El búnker no puede arrancar sin la base de datos');
    console.error('\n📌 Solución inmediata:');
    console.error('   1. Ve a Railway Dashboard → Variables');
    console.error('   2. Agrega una nueva variable:');
    console.error('      NAME: MONGO_URI');
    console.error('      VALUE: (pega el link de tu MongoDB)');
    console.error('   3. Espera el redeploy automático\n');
    process.exit(1); // El contenedor se detiene CON PROPÓSITO
}

console.log('📡 MONGO_URI encontrada. Conectando a MongoDB...');

// ================= SISTEMA DE REINTENTOS =================
async function conectarMongoDB(intentos = 5) {
    for (let i = 1; i <= intentos; i++) {
        try {
            console.log(`📡 Intento ${i}/${intentos} - Conectando a MongoDB...`);
            
            await mongoose.connect(MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });
            
            console.log('🟢 ¡BÚNKER CONECTADO A MONGODB!');
            console.log('📱 Meta tags en servidor: ACTIVADO');
            return true;
            
        } catch (error) {
            console.error(`❌ Intento ${i} falló:`, error.message);
            
            if (i === intentos) {
                console.error('\n🔴 NO SE PUDO CONECTAR A MONGODB DESPUÉS DE 5 INTENTOS');
                console.error('⏳ Esperando 30 segundos antes de reintentar...\n');
                
                setTimeout(() => {
                    console.log('🔄 Reintentando conexión...');
                    conectarMongoDB(intentos);
                }, 30000);
                
                return false;
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Iniciar conexión
conectarMongoDB();

// ================= ESQUEMAS =================
const noticiaSchema = new mongoose.Schema({
    titulo: { type: String, required: true, trim: true },
    seccion: {
        type: String,
        required: true,
        enum: ['Nacionales', 'Deportes', 'Internacionales', 'Espectáculos', 'Economía']
    },
    contenido: { type: String, required: true, trim: true },
    ubicacion: { type: String, default: '' },
    redactor: { type: String, default: 'mxl' },
    imagen: { type: String, default: null },
    vistas: { type: Number, default: 0 },
    fecha: { type: Date, default: Date.now }
});

const Noticia = mongoose.model('Noticia', noticiaSchema);

// ================= RUTA PARA NOTICIAS =================
app.get('/noticia/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).send('Noticia no encontrada');
        }

        const noticia = await Noticia.findById(id);

        if (!noticia) {
            return res.status(404).send('Noticia no encontrada');
        }

        noticia.vistas += 1;
        await noticia.save();

        const templatePath = path.join(__dirname, 'client', 'noticia-template.html');
        let html = fs.readFileSync(templatePath, 'utf8');

        const titulo = noticia.titulo.replace(/"/g, '&quot;');
        const descripcion = noticia.contenido.substring(0, 160).replace(/"/g, '&quot;').replace(/\n/g, ' ');
        const imagen = noticia.imagen || 'https://elfarolaldia.com/default-share.jpg';
        const url = `https://elfarolaldia.com/noticia/${id}`;
        const fecha = noticia.fecha.toISOString();
        const fechaFormateada = new Date(noticia.fecha).toLocaleDateString('es-DO', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const contenidoHTML = noticia.contenido.replace(/\n/g, '<br>');

        const esVideo = noticia.imagen && noticia.imagen.includes('video');

        html = html
            .replace(/{{TITULO}}/g, titulo)
            .replace(/{{DESCRIPCION}}/g, descripcion)
            .replace(/{{IMAGEN}}/g, imagen)
            .replace(/{{URL}}/g, url)
            .replace(/{{FECHA_ISO}}/g, fecha)
            .replace(/{{FECHA_FORMATEADA}}/g, fechaFormateada)
            .replace(/{{SECCION}}/g, noticia.seccion)
            .replace(/{{REDACTOR}}/g, noticia.redactor || 'Redacción')
            .replace(/{{CONTENIDO}}/g, contenidoHTML)
            .replace(/{{VISTAS}}/g, noticia.vistas || 0)
            .replace(/{{UBICACION}}/g, noticia.ubicacion || 'Santo Domingo');

        if (noticia.imagen) {
            if (esVideo) {
                html = html.replace('{{MULTIMEDIA}}', `<video class="noticia-imagen" src="${noticia.imagen}" controls></video>`);
            } else {
                html = html.replace('{{MULTIMEDIA}}', `<img class="noticia-imagen" src="${noticia.imagen}" alt="${titulo}">`);
            }
        } else {
            html = html.replace('{{MULTIMEDIA}}', '');
        }

        res.send(html);

    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Error interno');
    }
});

// ================= RUTAS API =================
app.get('/noticias', async (req, res) => {
    try {
        const noticias = await Noticia.find().sort({ fecha: -1 }).limit(50).lean();
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error' });
    }
});

app.get('/seccion/:nombre', async (req, res) => {
    try {
        const noticias = await Noticia.find({ seccion: req.params.nombre }).sort({ fecha: -1 }).limit(50).lean();
        res.json({ success: true, noticias });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error' });
    }
});

app.post('/publicar', async (req, res) => {
    try {
        const { pin, titulo, seccion, contenido, ubicacion, redactor, imagen } = req.body;

        if (pin !== "311") {
            return res.status(403).json({ success: false, error: 'PIN incorrecto' });
        }

        const noticia = new Noticia({
            titulo: titulo.trim(),
            seccion,
            contenido: contenido.trim(),
            ubicacion: ubicacion || '',
            redactor: redactor || 'mxl',
            imagen: imagen || null
        });

        await noticia.save();
        res.status(201).json({ success: true, noticia });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error' });
    }
});

// ================= ARCHIVOS ESTÁTICOS =================
app.use(express.static(path.join(__dirname, 'client')));

// ================= INICIAR SERVIDOR =================
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
    console.log(`✅ Servidor escuchando en puerto ${PORT}`);
    console.log('🏮 BÚNKER LISTO PARA OPERAR (cuando MongoDB conecte)');
});

// ================= CIERRE GRACEFUL =================
process.on('SIGTERM', async () => {
    console.log('🟡 Cerrando servidor gracefulmente...');
    server.close(async () => {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
            console.log('🔌 Conexión MongoDB cerrada');
        }
        process.exit(0);
    });
});

module.exports = app;
