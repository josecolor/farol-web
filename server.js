/**
 * 🏮 EL FAROL AL DÍA - SERVIDOR DEFINITIVO
 * Simplificado y funcional. Conéctate a MongoDB y sirve páginas.
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

// Health check
app.get('/health', (req, res) => res.send('OK'));

// ==================== CONEXIÓN A MONGODB ====================
const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL) {
    console.error('❌ ERROR: Variable MONGO_URL no definida en Railway.');
    process.exit(1);
}

async function conectarMongoDB() {
    const maxIntentos = 5;
    for (let i = 1; i <= maxIntentos; i++) {
        try {
            console.log(`📡 Intento ${i}/${maxIntentos} - Conectando a MongoDB...`);
            await mongoose.connect(MONGO_URL, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                family: 4, // Fuerza IPv4
            });
            console.log('✅ Conectado a MongoDB');
            return;
        } catch (err) {
            console.error(`❌ Intento ${i} falló:`, err.message);
            if (i === maxIntentos) {
                console.error('🛑 No se pudo conectar. Saliendo...');
                process.exit(1);
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// ==================== ESQUEMA Y MODELO DE CONFIGURACIÓN ====================
const configSchema = new mongoose.Schema({
    googleVerification: String,
    // otros campos que necesites...
});
const Config = mongoose.model('Config', configSchema);

// ==================== FUNCIÓN PARA INYECTAR METAETIQUETA ====================
async function inyectarMeta(html) {
    try {
        const config = await Config.findOne();
        if (config?.googleVerification) {
            const meta = `<meta name="google-site-verification" content="${config.googleVerification}" />`;
            return html.replace('<!-- META_GOOGLE_VERIFICATION -->', meta);
        }
    } catch (e) {
        console.error('Error inyectando meta:', e);
    }
    return html.replace('<!-- META_GOOGLE_VERIFICATION -->', '');
}

// ==================== RUTAS DE PÁGINAS ====================
app.get('/', async (req, res) => {
    try {
        let html = fs.readFileSync(path.join(__dirname, 'client', 'index.html'), 'utf8');
        html = await inyectarMeta(html);
        res.send(html);
    } catch (e) {
        res.status(500).send('Error interno');
    }
});

app.get('/noticia/:id', async (req, res) => {
    try {
        let html = fs.readFileSync(path.join(__dirname, 'client', 'noticia.html'), 'utf8');
        html = await inyectarMeta(html);
        res.send(html);
    } catch (e) {
        res.status(500).send('Error interno');
    }
});

app.get('/redaccion', (req, res) => res.sendFile(path.join(__dirname, 'client', 'redaccion.html')));
app.get('/ajustes', (req, res) => res.sendFile(path.join(__dirname, 'client', 'ajustes.html')));

// ==================== RUTAS API MÍNIMAS ====================
app.get('/api/configuracion', async (req, res) => {
    const config = await Config.findOne() || await Config.create({});
    res.json({ success: true, config });
});

app.post('/api/configuracion', async (req, res) => {
    if (req.body.pin !== '311') return res.status(403).json({ success: false, error: 'PIN incorrecto' });
    const config = await Config.findOneAndUpdate({}, req.body.config, { upsert: true, new: true });
    res.json({ success: true, config });
});

// ==================== INICIAR SERVIDOR ====================
async function iniciar() {
    await conectarMongoDB();
    app.listen(PORT, () => {
        console.log(`🚀 Servidor en puerto ${PORT}`);
        console.log(`👉 https://elfarolaldia.com`);
    });
}

iniciar();
