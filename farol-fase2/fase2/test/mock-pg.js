// Precarga para humo: sustituye 'pg' por un Pool falso en memoria.
const Module = require('module'); const orig = Module._load;
const filas = { noticias: [{ id: 1, titulo: 'Prueba', slug: 'prueba', seccion: 'Nacionales', contenido: 'Hola\n\nMundo', imagen: '/img/x.jpg', imagen_alt: 'alt', imagen_original: 'https://commons.wikimedia.org/wiki/File:X.jpg', imagen_credito: 'Juan / Wikimedia Commons', imagen_licencia: 'CC BY 4.0', imagen_licencia_url: 'https://creativecommons.org/licenses/by/4.0/', vistas: 3, fecha: new Date(), redactor: 'EFD', estado: 'publicada', seo_description: 'd', seo_keywords: 'k' }] };
global.__consultas = 0;
class Pool { async connect() { return { query: async () => ({ rows: [{ count: 0 }] }), release() {} }; }
  async query(sql, p) { global.__consultas++; if (/FROM noticias WHERE slug/.test(sql)) return { rows: p[0] === 'prueba' ? filas.noticias : [] };
    if (/ORDER BY fecha DESC LIMIT 30/.test(sql)) return { rows: filas.noticias }; if (/UPDATE noticias SET vistas/.test(sql)) { global.__vistas = (global.__vistas || 0) + p[1]; return { rows: [] }; }
    return { rows: [] }; } }
Module._load = function (r, ...a) { return r === 'pg' ? { Pool } : orig.call(this, r, ...a); };
