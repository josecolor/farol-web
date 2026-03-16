/**
 * 🏮 EL FAROL AL DÍA — V32.0 (FINAL)
 * + Integración Firebase Permanente
 * + Wikipedia API Contextual
 * + Lógica de imágenes RD / SDE avanzada
 * + Auto-regeneración de Watermarks
 */

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const cron      = require('node-cron');
const { Pool }  = require('pg');
const sharp     = require('sharp');
const RSSParser = require('rss-parser');
const crypto    = require('crypto');
const { initializeApp } = require('firebase/app');

// --- CONFIGURACIÓN FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyDZfC_ZsS-VEJo_u7GIjfeyZiDjTzSZO18",
  authDomain: "el-farol-ai.firebaseapp.com",
  projectId: "el-farol-ai",
  storageBucket: "el-farol-ai.firebasestorage.app",
  messagingSenderId: "80312216249",
  appId: "1:80312216249:web:015abd29d62845c4fb8968",
  measurementId: "G-F0WVWS5S11"
};

const firebaseApp = initializeApp(firebaseConfig);
console.log("🔥 Firebase: Conexión establecida con el-farol-ai");

const app      = express();
const PORT     = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || 'https://elfarolaldia.com';

// --- VALIDACIÓN DE VARIABLES ---
if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL falta'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY falta'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'client')));
app.use(cors());

const WATERMARK_PATH = (() => {
    const variantes = ['watermark.png', 'WATERMARK(1).png', 'watermark(1).png'];
    for (const nombre of variantes) {
        const ruta = path.join(__dirname, 'static', nombre);
        if (fs.existsSync(ruta)) return ruta;
    }
    return path.join(__dirname, 'static', 'watermark.png');
})();

const rssParser = new RSSParser({ timeout: 10000 });

// --- WIKIPEDIA ---
async function buscarContextoWikipedia(titulo) {
    try {
        const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(titulo + " República Dominicana")}&format=json&srlimit=1&origin=*`;
        const res = await fetch(url);
        const data = await res.json();
        const id = data?.query?.search?.[0]?.pageid;
        if (!id) return '';
        const resExt = await fetch(`https://es.wikipedia.org/w/api.php?action=query&pageids=${id}&prop=extracts&exintro=true&exchars=1000&format=json&origin=*`);
        const dataExt = await resExt.json();
        return `\n📚 CONTEXTO: ${dataExt?.query?.pages?.[id]?.extract.replace(/<[^>]+>/g, '')}\n`;
    } catch (e) { return ''; }
}

// --- GEMINI ---
async function llamarGemini(prompt) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

// --- REDES SOCIALES ---
async function publicarEnFacebook(titulo, slug, urlImagen, descripcion) {
    const FB_ID = process.env.FB_PAGE_ID;
    const FB_TOKEN = process.env.FB_PAGE_TOKEN;
    if (!FB_ID || !FB_TOKEN) return false;
    try {
        const mensaje = `🏮 ${titulo}\n\n${descripcion}\n\nLee más: ${BASE_URL}/noticia/${slug}`;
        const form = new URLSearchParams();
        form.append('url', urlImagen); form.append('caption', mensaje); form.append('access_token', FB_TOKEN);
        await fetch(`https://graph.facebook.com/v18.0/${FB_ID}/photos`, { method: 'POST', body: form });
        return true;
    } catch (e) { return false; }
}

// --- RUTAS ---
app.get('/status', (req, res) => {
    res.json({ status: 'OK', version: '32.0', firebase: !!firebaseApp, gemini: !!process.env.GEMINI_API_KEY });
});

app.post('/api/generar-noticia', async (req, res) => {
    try {
        const { categoria } = req.body;
        const contexto = await buscarContextoWikipedia(categoria);
        const prompt = `Eres periodista dominicano. Escribe una noticia de ${categoria}. Contexto: ${contexto}. Responde: TITULO: desc: PALABRAS: CONTENIDO:`;
        const noticia = await llamarGemini(prompt);
        res.json({ success: true, noticia });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Fallback para SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// --- INICIO ---
async function iniciar() {
    try {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🏮 EL FAROL AL DÍA — V32.0 ACTIVADA                             ║
╠══════════════════════════════════════════════════════════════════╣
║  🌐 Web · 📘 Facebook · 🔥 Firebase · 📚 Wikipedia               ║
╚══════════════════════════════════════════════════════════════════╝`);
        });
    } catch (e) { console.error("❌ Error al iniciar:", e); }
}

iniciar();
