const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware básico
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// Health check
app.get('/health', (req, res) => {
    res.send('OK');
});

// Ruta redacción SIN AUTH para probar
app.get('/redaccion', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'redaccion.html'));
});

// API mínima
app.get('/api/noticias', (req, res) => {
    res.json({ success: true, noticias: [] });
});

app.get('/api/estadisticas', (req, res) => {
    res.json({ success: true, estadisticas: { total: 0, vistasTotales: 0 } });
});

app.post('/api/publicar', (req, res) => {
    res.json({ success: true });
});

app.post('/api/generar', (req, res) => {
    res.json({ success: true });
});

app.delete('/api/eliminar/:id', (req, res) => {
    res.json({ success: true });
});

app.get('/api/admin/config', (req, res) => {
    res.json({});
});

app.post('/api/admin/config', (req, res) => {
    res.json({});
});

app.get('/api/memoria', (req, res) => {
    res.json({});
});

app.get('/api/coach', (req, res) => {
    res.json({});
});

app.get('/status', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/sitemap.xml', (req, res) => {
    res.send('<?xml version="1.0"?><urlset></urlset>');
});

app.get('/robots.txt', (req, res) => {
    res.send('User-agent: *\nAllow: /');
});

app.get('/ads.txt', (req, res) => {
    res.send('google.com, pub-5280872495839888');
});

// Página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Noticia individual
app.get('/noticia/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'noticia.html'));
});

// Páginas estáticas
app.get('/contacto', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'contacto.html'));
});

app.get('/nosotros', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'nosotros.html'));
});

app.get('/privacidad', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'privacidad.html'));
});

app.get('/terminos', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'terminos.html'));
});

app.get('/cookies', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'cookies.html'));
});

// Fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Inicio
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor OK en puerto ${PORT}`);
});
