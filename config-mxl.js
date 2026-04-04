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
    PORT: process.env.PORT || 3000,
    BASE_URL: 'https://elfarolaldia.com',
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
    "Ozama": [`${PB}/1739855/pexels-photo-1739855.jpeg${OPT}`]
};

const CAT_FALLBACK = { 'Sucesos': 'Los Mina', 'Comunidad': 'Ozama' };

function getPromptBase() {
    return `Actúa como Director de El Farol al Día. Escribe para gente de SDE. 
    Usa términos como: tiguere, motor, colmado, la policía, se armó, se supo.
    Mínimo 8 a 10 párrafos. No seas robótico.`;
}

module.exports = { ENV, CATEGORIAS, PB, OPT, BANCO_LOCAL, CAT_FALLBACK, getPromptBase, RUTAS: { WATERMARK_PATH: './static/watermark.png', TMP_DIR: '/tmp' } };
