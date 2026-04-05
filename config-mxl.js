// config-mxl.js - CONFIGURACIÓN CENTRAL
const path = require('path');
const fs = require('fs');

const ENV = {
    GEMINI_KEYS: [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY2,
        process.env.GEMINI_API_KEY3,
        process.env.GEMINI_API_KEY4
    ].filter(k => k),
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    ADMIN_USER: 'mxl',
    ADMIN_PIN: '1128',
    PORT: process.env.PORT || 8080,
    BASE_URL: process.env.BASE_URL || 'https://elfarolaldia.com',
    DATABASE_URL: process.env.DATABASE_URL,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: 'mailto:jose.colorvision@gmail.com'
};

const CATEGORIAS = ['Sucesos', 'Comunidad', 'Política', 'Deportes', 'Showbiz'];
const PB = 'https://images.pexels.com/photos';
const OPT = '?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1';

const BANCO_LOCAL = {
    "Los Mina": [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`],
    "Invivienda": [`${PB}/210012/pexels-photo-210012.jpeg${OPT}`],
    "Ozama": [`${PB}/1739855/pexels-photo-1739855.jpeg${OPT}`],
    "default": [`${PB}/3052454/pexels-photo-3052454.jpeg${OPT}`]
};

const CAT_FALLBACK = { 
    'Sucesos': 'Los Mina', 
    'Comunidad': 'Ozama',
    'Política': 'default',
    'Deportes': 'default',
    'Showbiz': 'default'
};

function getPromptBase() {
    return `Actúa como Director de El Farol al Día. Escribe para gente de Santo Domingo Este.
    Usa términos como: tiguere, motor, colmado, la policía, se armó, se supo.
    Mínimo 8 a 10 párrafos. Menciona calles como Av. Venezuela, Carretera Mella, Sabana Larga.
    No seas robótico.`;
}

const RUTAS = {
    WATERMARK_PATH: (() => {
        const posibles = [
            path.join(__dirname, 'static', 'watermark.png'),
            path.join(process.cwd(), 'static', 'watermark.png'),
            './static/watermark.png'
        ];
        for (const ruta of posibles) {
            if (fs.existsSync(ruta)) return ruta;
        }
        return null;
    })(),
    TMP_DIR: '/tmp'
};

module.exports = { ENV, CATEGORIAS, PB, OPT, BANCO_LOCAL, CAT_FALLBACK, getPromptBase, RUTAS };
