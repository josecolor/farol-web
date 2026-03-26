/**
 * 🏮 EL FAROL AL DÍA — V34.7-TEST
 * VERSIÓN MÍNIMA PARA PROBAR QUE RAILWAY NO MATE EL PROCESO
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware básico
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// Health check - DEBE RESPONDER INMEDIATAMENTE
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Ruta de redacción (sin auth para prueba)
app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// API simple de noticias
app.get('/api/noticias', (req, res) => {
    res.json({ success: true, noticias: [] });
});

// API de estadísticas
app.get('/api/estadisticas', (req, res) => {
    res.json({ success: true, estadisticas: { total: 0, vistasTotales: 0 } });
});

// API para publicar manual
app.post('/api/publicar', (req, res) => {
    res.json({ success: true, slug: 'noticia-de-prueba' });
});

// API para generar con IA
app.post('/api/generar', (req, res) => {
    res.json({ success: true, mensaje: 'Noticia generada' });
});

// API para eliminar
app.delete('/api/eliminar/:id', (req, res) => {
    res.json({ success: true });
});

// API de configuración
app.get('/api/admin/config', (req, res) => {
    res.json({ enabled: true });
});

app.post('/api/admin/config', (req, res) => {
    res.json({ success: true });
});

// API de memoria
app.get('/api/memoria', (req, res) => {
    res.json({ success: true, registros: [] });
});

// API de coach
app.get('/api/coach', (req, res) => {
    res.json({ success: true, categorias: {} });
});

// Status
app.get('/status', (req, res) => {
    res.json({ version: '34.7', status: 'OK' });
});

// Sitemap
app.get('/sitemap.xml', (req, res) => {
    res.header('Content-Type', 'application/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://elfarolaldia.com/</loc></url></urlset>');
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
    res.send('User-agent: *\nAllow: /\nDisallow: /redaccion\n');
});

// Ads.txt
app.get('/ads.txt', (req, res) => {
    res.send('google.com, pub-5280872495839888, DIRECT, f08c47fec0942fa0\n');
});

// Fallback para cualquier otra ruta
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Inicio del servidor - SIN NADA ASÍNCRONO
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor iniciado correctamente`);
    console.log(`   Puerto: ${PORT}`);
    console.log(`   URL: https://elfarolaldia.com`);
    console.log(`   Health check: /health`);
});

// Manejo de señales para Railway
process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM recibido, cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('⚠️ SIGINT recibido, cerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor cerrado');
        process.exit(0);
    });
});

module.exports = app;
