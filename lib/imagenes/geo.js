'use strict';
const dbg = (...a) => { if (process.env.LOG_DETALLE === '1') dbg(...a); };   // progreso solo con LOG_DETALLE=1
/**
 * FILTRO GEOGRÁFICO ESTRICTO para la búsqueda de imágenes.
 *
 *  1) detectarContexto()   → país/lugar de la primicia (República Dominicana, Panamá, Colombia, Santo Domingo, ...)
 *  2) anclarConsulta()     → TODA consulta web antepone ese contexto geográfico (no hay búsquedas genéricas)
 *  3) validarCandidato()   → descarta lo que no pertenece a la noticia:
 *        · contexto geográfico ajeno (otro país/ciudad que la noticia no menciona)
 *        · paisajes/lugares de Asia (salvo que la noticia sea de Asia)
 *        · fotos de archivo / stock / genéricas / ilustrativas / antiguas (por fecha, año o leyenda)
 *        · rostros fuera de contexto: retratos o personas con nombre que NO aparecen en la noticia
 *        · (modo estricto) fotos sin ninguna evidencia local del país de la noticia
 *
 *  ⚠️ Límite honesto: no hay reconocimiento facial ni visión por computador (el LLM local es solo texto).
 *     La validación trabaja sobre los metadatos que acompañan a la foto: título, descripción, leyenda, URL, fecha, dominio.
 *
 *  Variables: IMG_GEO_ESTRICTO (1 por defecto; 0 = no exige evidencia local positiva), IMG_MAX_ANTIGUEDAD_DIAS (365).
 */

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const frase = lista => new RegExp(`(?<![a-z0-9])(?:${lista.map(esc).join('|')})(?![a-z0-9])`);

const ESTRICTO = process.env.IMG_GEO_ESTRICTO !== '0';
const MAX_DIAS = parseInt(process.env.IMG_MAX_ANTIGUEDAD_DIAS || '365', 10);

// ── Tabla de países ─────────────────────────────────────────────────────
// nombre (consulta en español) · en (consulta en inglés) · tld · mkt (Bing) · kl (DuckDuckGo) · alias · lugares
const _P = (id, nombre, en, tld, mkt, kl, alias, lugares = '', asia = false) => ({
    id, nombre, en, tld, mkt, kl, asia, lugaresDisp: lugares ? lugares.split('|') : [],
    // "china" (naranja en RD), "usa" (verbo) y "uk" se detectan aparte, sensibles a mayúsculas (ver SENSIBLES)
    alias: [...new Set([nombre, en, ...alias.split('|')].map(norm).filter(a => a && a !== 'china'))],
    lugares: lugares ? lugares.split('|').map(norm) : [],
});
const PAISES = [
    _P('DO', 'República Dominicana', 'Dominican Republic', 'do', 'es-DO', 'do-es', 'dominicana|dominicano|dominicanos|dominicanas|dominican',
        'Santo Domingo Este|Santo Domingo|SDE|Los Mina|Invivienda|Sabana Perdida|Villa Mella|Charles de Gaulle|Ensanche Ozama|Los Trinitarios|Boca Chica|San Isidro|Distrito Nacional|Santiago de los Caballeros|La Romana|Punta Cana|Higüey|Puerto Plata|San Pedro de Macorís|San Cristóbal|La Vega|Bonao|Barahona|Samaná|Jarabacoa|Haina|Bávaro|Azua|San Francisco de Macorís|Monte Plata|Palacio Nacional|Malecón|Zona Colonial|Aeropuerto de Las Américas|Autopista Las Américas|Cibao|Gazcue|Naco|Piantini|Bella Vista'),
    _P('PA', 'Panamá', 'Panama', 'pa', 'es-PA', 'xl-es', 'panameno|panamenos|panamena|panamenas|panamanian', 'Ciudad de Panamá|Canal de Panamá|Tocumen|Chiriquí|Bocas del Toro|Panamá Oeste|Colón Panamá'),
    _P('CO', 'Colombia', 'Colombia', 'co', 'es-CO', 'co-es', 'colombiano|colombianos|colombiana|colombianas', 'Bogotá|Medellín|Cali|Barranquilla|Cartagena|Bucaramanga|Cúcuta'),
    _P('VE', 'Venezuela', 'Venezuela', 've', 'es-VE', 've-es', 'venezolano|venezolanos|venezolana|venezolanas', 'Caracas|Maracaibo|Barquisimeto'),
    _P('MX', 'México', 'Mexico', 'mx', 'es-MX', 'mx-es', 'mexicano|mexicanos|mexicana|mexicanas|cdmx', 'Ciudad de México|Guadalajara|Monterrey|Tijuana|Cancún'),
    _P('CU', 'Cuba', 'Cuba', 'cu', 'es-US', 'xl-es', 'cubano|cubanos|cubana|cubanas', 'La Habana|Havana|Santiago de Cuba'),
    _P('PR', 'Puerto Rico', 'Puerto Rico', 'pr', 'es-US', 'xl-es', 'puertorriqueno|puertorriquenos|boricua|boricuas', 'San Juan Puerto Rico|Ponce|Bayamón'),
    _P('HT', 'Haití', 'Haiti', 'ht', 'es-US', 'xl-es', 'haitiano|haitianos|haitiana|haitianas|haitian', 'Puerto Príncipe|Port-au-Prince|Cabo Haitiano'),
    _P('US', 'Estados Unidos', 'United States', 'us', 'es-US', 'us-es', 'estadounidense|estadounidenses|norteamericano|norteamericanos', 'Washington|Nueva York|New York|Miami|Florida|Texas|California|Casa Blanca|Boston|Chicago|Los Ángeles|Orlando|Nueva Jersey|Filadelfia|Pensilvania|Capitolio'),
    _P('ES', 'España', 'Spain', 'es', 'es-ES', 'es-es', 'espana|espanola|espanoles|espanolas', 'Madrid|Barcelona|Sevilla|Valencia España|Bilbao|Real Madrid'),
    _P('AR', 'Argentina', 'Argentina', 'ar', 'es-AR', 'ar-es', 'argentino|argentinos|argentina|argentinas', 'Buenos Aires|Córdoba Argentina|Rosario'),
    _P('CL', 'Chile', 'Chile', 'cl', 'es-CL', 'cl-es', 'chileno|chilenos|chilena|chilenas', 'Santiago de Chile|Valparaíso'),
    _P('PE', 'Perú', 'Peru', 'pe', 'es-PE', 'pe-es', 'peruano|peruanos|peruana|peruanas', 'Lima|Cusco|Machu Picchu'),
    _P('EC', 'Ecuador', 'Ecuador', 'ec', 'es-EC', 'xl-es', 'ecuatoriano|ecuatorianos|ecuatoriana', 'Quito|Guayaquil'),
    _P('BR', 'Brasil', 'Brazil', 'br', 'pt-BR', 'br-pt', 'brasileno|brasilenos|brasilena|brazilian', 'Brasilia|São Paulo|Sao Paulo|Río de Janeiro|Rio de Janeiro'),
    _P('UY', 'Uruguay', 'Uruguay', 'uy', 'es-AR', 'xl-es', 'uruguayo|uruguayos|uruguaya', 'Montevideo'),
    _P('PY', 'Paraguay', 'Paraguay', 'py', 'es-AR', 'xl-es', 'paraguayo|paraguayos|paraguaya', 'Asunción'),
    _P('BO', 'Bolivia', 'Bolivia', 'bo', 'es-AR', 'xl-es', 'boliviano|bolivianos|boliviana', 'La Paz Bolivia|Santa Cruz de la Sierra'),
    _P('CR', 'Costa Rica', 'Costa Rica', 'cr', 'es-MX', 'xl-es', 'costarricense|costarricenses|tico|ticos', 'San José Costa Rica'),
    _P('GT', 'Guatemala', 'Guatemala', 'gt', 'es-MX', 'xl-es', 'guatemalteco|guatemaltecos|guatemalteca', 'Ciudad de Guatemala'),
    _P('HN', 'Honduras', 'Honduras', 'hn', 'es-MX', 'xl-es', 'hondureno|hondurenos|hondurena', 'Tegucigalpa|San Pedro Sula'),
    _P('SV', 'El Salvador', 'El Salvador', 'sv', 'es-MX', 'xl-es', 'salvadoreno|salvadorenos|salvadorena', 'San Salvador'),
    _P('NI', 'Nicaragua', 'Nicaragua', 'ni', 'es-MX', 'xl-es', 'nicaraguense|nicaraguenses', 'Managua'),
    _P('CA', 'Canadá', 'Canada', 'ca', 'es-US', 'xl-es', 'canadiense|canadienses', 'Toronto|Ottawa|Montreal|Vancouver'),
    _P('GB', 'Reino Unido', 'United Kingdom', 'uk', 'es-ES', 'xl-es', 'inglaterra|britanico|britanicos|britanica|england|britain', 'Londres|London|Manchester|Liverpool'),
    _P('FR', 'Francia', 'France', 'fr', 'es-ES', 'xl-es', 'frances|francesa|franceses|french', 'París|Paris|Marsella|Lyon'),
    _P('DE', 'Alemania', 'Germany', 'de', 'es-ES', 'xl-es', 'aleman|alemana|alemanes|german', 'Berlín|Berlin|Múnich|Munich|Fráncfort'),
    _P('IT', 'Italia', 'Italy', 'it', 'es-ES', 'xl-es', 'italiano|italiana|italianos|italian', 'Roma|Milán|Milan|Nápoles|Vaticano'),
    _P('RU', 'Rusia', 'Russia', 'ru', 'es-ES', 'xl-es', 'ruso|rusa|rusos|russian', 'Moscú|Moscow|Kremlin|San Petersburgo'),
    _P('UA', 'Ucrania', 'Ukraine', 'ua', 'es-ES', 'xl-es', 'ucraniano|ucraniana|ucranianos|ukrainian', 'Kiev|Kyiv|Járkov|Odesa'),
    _P('IL', 'Israel', 'Israel', 'il', 'es-ES', 'xl-es', 'israeli|israelies', 'Tel Aviv|Jerusalén|Jerusalem'),
    _P('PS', 'Palestina', 'Palestine', 'ps', 'es-ES', 'xl-es', 'palestino|palestina|palestinos|gaza|franja de gaza|cisjordania|hamas', 'Ramala'),
    _P('IR', 'Irán', 'Iran', 'ir', 'es-ES', 'xl-es', 'iraní|irani|iranies', 'Teherán|Tehran'),
    _P('TR', 'Turquía', 'Turkey', 'tr', 'es-ES', 'xl-es', 'turco|turca|turcos', 'Estambul|Ankara'),
    _P('SA', 'Arabia Saudita', 'Saudi Arabia', 'sa', 'es-ES', 'xl-es', 'saudi|saudita', 'Riad|Riyadh'),
    _P('EG', 'Egipto', 'Egypt', 'eg', 'es-ES', 'xl-es', 'egipcio|egipcia|egipcios', 'El Cairo|Cairo'),
    _P('ZA', 'Sudáfrica', 'South Africa', 'za', 'es-ES', 'xl-es', 'sudafricano|sudafricana', 'Johannesburgo|Ciudad del Cabo'),
    _P('NG', 'Nigeria', 'Nigeria', 'ng', 'es-ES', 'xl-es', 'nigeriano|nigeriana', 'Lagos|Abuya'),
    _P('AU', 'Australia', 'Australia', 'au', 'es-ES', 'xl-es', 'australiano|australiana', 'Sídney|Sydney|Melbourne'),
    // Asia (la noticia SOLO puede usar fotos asiáticas si ella misma es de Asia)
    _P('CN', 'China', 'China', 'cn', 'es-ES', 'xl-es', 'republica popular china|chino|chinos|china continental|chinese', 'Pekín|Beijing|Shanghái|Shanghai|Hong Kong|Gran Muralla|Shenzhen|Cantón', true),
    _P('JP', 'Japón', 'Japan', 'jp', 'es-ES', 'xl-es', 'japones|japonesa|japoneses|japanese', 'Tokio|Tokyo|Kioto|Kyoto|Osaka|Monte Fuji|Mount Fuji|Hiroshima', true),
    _P('KR', 'Corea del Sur', 'South Korea', 'kr', 'es-ES', 'xl-es', 'corea|corea del norte|surcoreano|norcoreano|korea|korean', 'Seúl|Seoul|Busan|Pionyang', true),
    _P('IN', 'India', 'India', 'in', 'es-ES', 'xl-es', 'indio|hindu|indian', 'Nueva Delhi|New Delhi|Mumbai|Bombay|Taj Mahal|Bangalore', true),
    _P('TH', 'Tailandia', 'Thailand', 'th', 'es-ES', 'xl-es', 'tailandes|tailandesa|thai', 'Bangkok|Phuket|Chiang Mai', true),
    _P('VN', 'Vietnam', 'Vietnam', 'vn', 'es-ES', 'xl-es', 'vietnamita|vietnamitas', 'Hanói|Hanoi|Ho Chi Minh', true),
    _P('ID', 'Indonesia', 'Indonesia', 'id', 'es-ES', 'xl-es', 'indonesio|indonesia|indonesa', 'Yakarta|Jakarta|Bali', true),
    _P('PH', 'Filipinas', 'Philippines', 'ph', 'es-ES', 'xl-es', 'filipino|filipina|filipinos', 'Manila', true),
    _P('SG', 'Singapur', 'Singapore', 'sg', 'es-ES', 'xl-es', 'singapurense', '', true),
    _P('MY', 'Malasia', 'Malaysia', 'my', 'es-ES', 'xl-es', 'malayo|malasio', 'Kuala Lumpur', true),
    _P('TW', 'Taiwán', 'Taiwan', 'tw', 'es-ES', 'xl-es', 'taiwanes|taiwanesa', 'Taipéi|Taipei', true),
    _P('PK', 'Pakistán', 'Pakistan', 'pk', 'es-ES', 'xl-es', 'pakistani|paquistani', 'Islamabad|Karachi', true),
    _P('NP', 'Nepal', 'Nepal', 'np', 'es-ES', 'xl-es', 'nepali|himalaya', 'Katmandú|Kathmandu', true),
    _P('KH', 'Camboya', 'Cambodia', 'kh', 'es-ES', 'xl-es', 'camboyano|angkor', '', true),
].map(p => ({ ...p, _alias: frase([...p.alias, ...p.lugares]), _soloAlias: frase(p.alias), _lugares: p.lugares.length ? frase(p.lugares) : null }));
const POR_ID = Object.fromEntries(PAISES.map(p => [p.id, p]));
const DO = POR_ID.DO;

// Siglas/nombres ambiguos: solo cuentan con su mayúscula original ("China" ≠ "jugo de china", "USA" ≠ "usa")
const SENSIBLES = {
    US: /(?<![\p{L}])(?:USA|U\.S\.A?\.?|EE\.?\s?UU\.?)(?![\p{L}])/gu,
    GB: /(?<![\p{L}])UK(?![\p{L}])/gu,
    CN: /(?<![\p{L}])China(?![\p{L}])/gu,
};
const _sens = (id, orig) => (String(orig || '').match(SENSIBLES[id]) || []).length;

// Otros términos asiáticos que delatan un paisaje/lugar de Asia (no incluye "china"/"india" sueltos: en RD "china" = naranja)
const ASIA_RE = frase(['asia', 'asiatico', 'asiatica', 'asian', 'pagoda', 'templo budista', 'buddhist temple', 'cherry blossom', 'sakura', 'cerezos en flor',
    'torii', 'geisha', 'kimono', 'terrazas de arroz', 'rice terrace', 'rice terraces', 'angkor', 'himalaya', 'monte fuji', 'mount fuji', 'gran muralla',
    'great wall', 'forbidden city', 'ciudad prohibida', 'bund', 'skyline de shanghai', 'tokyo tower', 'bangkok', 'seoul', 'hanoi']);

// Fotos de archivo / stock / genéricas
const ARCHIVO_RE = frase(['foto de archivo', 'fotos de archivo', 'foto archivo', 'imagen de archivo', 'imagenes de archivo', 'file photo', 'file image', 'archive photo',
    'stock photo', 'stock image', 'stock footage', 'foto stock', 'imagen stock', 'imagen referencial', 'foto referencial', 'imagen ilustrativa', 'foto ilustrativa',
    'imagen de referencia', 'foto de referencia', 'imagen generica', 'foto generica', 'generic image', 'representative image', 'photo illustration', 'ilustracion',
    'illustration', 'throwback', 'tbt', 'foto antigua', 'imagen antigua', 'old photo', 'vintage', 'archivo historico', 'clipart', 'render 3d']);

// Retratos / primeros planos (rostro sin respaldo en la noticia)
const RETRATO_RE = frase(['retrato', 'portrait', 'headshot', 'primer plano', 'close-up', 'closeup', 'close up', 'selfie', 'foto de perfil', 'profile picture', 'mugshot', 'rostro', 'official portrait']);

// Palabras que NO son nombres de persona aunque vayan en mayúscula (instituciones, lugares, marcas, genéricos)
const NO_NOMBRE = new Set(('gobierno ministerio ministro ministra presidente presidenta palacio nacional banco central policia ejercito armada senado camara diputados congreso republica ' +
    'dominicana dominicano estado estados unidos ciudad plaza parque avenida calle autopista carretera puente aeropuerto puerto hospital universidad colegio escuela liceo ' +
    'iglesia catedral mercado centro estadio club liga equipo seleccion copa mundial festival concierto noticias noticia diario listin hoy ayer foto fotos imagen imagenes ' +
    'fotografia video archivo santo santa san domingo este oeste norte sur mina invivienda palacio alcalde alcaldia ayuntamiento director directora doctor doctora ' +
    'general coronel capitan teniente fiscal procuraduria juez tribunal corte suprema electoral junta comision comite partido movimiento ' +
    'el la los las del una uno con por para sobre entre desde hasta ante tras segun durante nuevo nueva gran grande ' +
    'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre lunes martes miercoles jueves viernes sabado ' +
    'libre digital semana online news world times post press agency agencia television canal radio telemundo noticiero cnn bbc').split(/\s+/));
PAISES.forEach(p => [...p.alias, ...p.lugares].forEach(a => a.split(/[^a-z0-9]+/).forEach(t => t && NO_NOMBRE.add(t))));

const NOMBRE_RE = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’]{2,}(?:\s+(?:(?:de|del|la|van|von|da|di)\s+)?\p{Lu}[\p{L}'’]{2,}){1,3}/gu;
const CONECTORES = new Set(['de', 'del', 'la', 'van', 'von', 'da', 'di']);

/** Nombres de persona (2+ palabras en mayúscula que no sean instituciones/lugares/marcas) presentes en un texto. */
function extraerNombres(texto) {
    const out = [];
    for (const m of String(texto || '').matchAll(NOMBRE_RE)) {
        const toks = m[0].split(/\s+/).filter(t => !CONECTORES.has(t.toLowerCase())).map(norm);
        const buenos = toks.filter(t => t.length > 2 && !NO_NOMBRE.has(t));
        if (buenos.length >= 2 && buenos.length === toks.length) out.push(buenos);
    }
    return out;
}
const tokensDe = s => new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t.length > 3));

function _cuenta(re, texto) { const m = texto.match(new RegExp(re.source, 'g')); return m ? m.length : 0; }

// ── 1) Contexto geográfico de la noticia ────────────────────────────────
/**
 * @returns {{pais, id, anchor, anchorEn, lugar, permitidos:Set, asiaPermitida, tokens:Set, personas:string[][], implicito:boolean, años:Set}}
 *  pais = objeto de la tabla (o null si es una noticia internacional sin país identificable)
 */
function detectarContexto({ titulo = '', contenido = '', categoria = '', comunicado = '' } = {}) {
    const t = norm(titulo), com = norm(comunicado).slice(0, 1200), c = norm(contenido).slice(0, 2500);
    const todo = `${t} ${com} ${c}`;
    const puntaje = PAISES.map(p => {
        const sol = (p._soloAlias.test(t) ? _cuenta(p._soloAlias, t) * 4 : 0) + _cuenta(p._soloAlias, com) * 2 + _cuenta(p._soloAlias, c);
        const lug = p._lugares ? _cuenta(p._lugares, t) * 4 + _cuenta(p._lugares, com) * 2 + _cuenta(p._lugares, c) : 0;
        const sen = SENSIBLES[p.id] ? _sens(p.id, titulo) * 4 + _sens(p.id, comunicado.slice(0, 1200)) * 2 + _sens(p.id, contenido.slice(0, 2500)) : 0;
        const pos = [p._alias.exec(t)?.index, ...(SENSIBLES[p.id] ? [[...String(titulo).matchAll(SENSIBLES[p.id])][0]?.index] : [])].filter(i => i !== undefined);
        return { p, s: sol + lug + sen, pos: pos.length ? Math.min(...pos) : 1e9 };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.pos - b.pos);                // empate → el que se menciona primero en el titular

    let pais = puntaje[0]?.p || null, implicito = false;
    if (!pais) { if (categoria === 'Internacionales') pais = null; else { pais = DO; implicito = true; } }
    // Primicia con "dominicano" + otro país (p. ej. "dominicano gana en Miami"): gana el que más pesa; en empate, RD.
    if (pais && pais.id !== 'DO') { const d = puntaje.find(x => x.p.id === 'DO'); if (d && d.s >= puntaje[0].s) pais = DO; }

    // Lugar más específico (de la tabla del país) que aparece en la noticia; si no hay, el de la categoría local por defecto
    let lugar = '';
    if (pais?._lugares) {
        const hallados = pais.lugares.filter(l => frase([l]).test(todo)).sort((a, b) => b.length - a.length);
        const enTitulo = hallados.find(l => frase([l]).test(t));
        lugar = enTitulo || hallados[0] || '';
    }
    if (pais?.id === 'DO' && !lugar) lugar = implicito ? 'santo domingo' : '';
    const lugarTxt = lugar ? (pais.lugaresDisp.find(d => norm(d) === lugar) || lugar.replace(/(^|\s)\S/g, x => x.toUpperCase())) : '';
    const yaIncluye = lugarTxt && pais && norm(pais.nombre).includes(norm(lugarTxt));
    const anchor = pais ? (lugarTxt && !yaIncluye ? `${lugarTxt} ${pais.nombre}` : pais.nombre) : 'noticias internacionales';
    const anchorEn = pais ? (lugarTxt && !yaIncluye ? `${lugarTxt} ${pais.en}` : pais.en) : 'international news';

    const permitidos = new Set(puntaje.map(x => x.p.id)); if (pais) permitidos.add(pais.id);
    const asiaPermitida = [...permitidos].some(id => POR_ID[id].asia) || ASIA_RE.test(todo);
    const personas = extraerNombres(`${titulo} ${comunicado.slice(0, 1200)} ${contenido.slice(0, 2500)}`);
    const años = new Set((todo.match(/\b(19|20)\d{2}\b/g) || []));
    return { pais, id: pais?.id || null, anchor, anchorEn, lugar: lugarTxt, permitidos, asiaPermitida,
        tokens: tokensDe(`${titulo} ${comunicado} ${contenido}`), personas, implicito, años };
}

// ── 2) Anclaje geográfico obligatorio de toda consulta ──────────────────
/** Antepone el contexto geográfico a la consulta (salvo que ya lo incluya). idioma: 'es' | 'en'. */
function anclarConsulta(consulta, ctx, { idioma = 'es' } = {}) {
    ctx = ctx || detectarContexto({ categoria: 'Nacionales' });
    const q = String(consulta || '').replace(/\s+/g, ' ').trim();
    const nq = norm(q);
    const ya = ctx.pais ? (ctx.pais._alias.test(nq) || (ctx.pais.id === 'DO' && /(^|[^a-z])rd([^a-z]|$)/.test(nq))) : /internacional|international|mundo|world/.test(nq);
    if (ya) return q.slice(0, 140);
    return `${idioma === 'en' ? ctx.anchorEn : ctx.anchor} ${q}`.trim().slice(0, 140);
}

// ── 3) Validación estricta de candidatos ────────────────────────────────
const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const rutaTxt = u => { try { const x = new URL(u); return decodeURIComponent(x.pathname).replace(/[-_/.]+/g, ' '); } catch { return ''; } };
const TLD_PAIS = Object.fromEntries(PAISES.filter(p => !['co', 'id', 'in'].includes(p.tld)).map(p => [p.tld, p.id]));   // .co/.id/.in se usan como dominios genéricos
const tldDe = h => { const partes = h.split('.'); const t = partes[partes.length - 1]; return (t.length === 2 || t === 'uk') ? TLD_PAIS[t] || null : null; };
// Medios locales de RD con dominio genérico (.com/.net): cuentan como evidencia local
const MEDIOS_DO = ['listindiario.com', 'diariolibre.com', 'eldinero.com.do', 'elnuevodiario.com.do', 'hoy.com.do', 'elcaribe.com.do', 'noticiassin.com', 'cdn.com.do',
    'almomento.net', 'elnacional.com.do', 'n.com.do', 'z101digital.com', 'telemicro.com.do', 'color-vision.com', 'rcc.com.do', 'ultimahora.com.do', 'dominicanoshoy.com', 'metro.com.do'];

function _fecha(f) { if (!f) return null; const d = f instanceof Date ? f : new Date(f); return isNaN(d) ? null : d; }

/**
 * ¿Esta foto pertenece a ESTA noticia? Devuelve { ok, motivo }.
 * Campos usados del candidato (todos opcionales): titulo, descripcion, categorias[], urlPagina, urlDescarga, fecha, esFuente.
 * La foto de la fuente original (og:image de la nota RSS) es, por definición, del hecho: solo se le aplica el filtro de archivo.
 */
function validarCandidato(c, ctx, { estricto = ESTRICTO, ahora = new Date(), maxDias = MAX_DIAS } = {}) {
    ctx = ctx || detectarContexto({ categoria: 'Nacionales' });
    const descr = `${c.titulo || ''} ${c.descripcion || ''}`;
    const texto = norm(`${descr} ${(c.categorias || []).join(' ')} ${rutaTxt(c.urlPagina)} ${rutaTxt(c.urlDescarga)}`);
    const hPag = host(c.urlPagina), hImg = host(c.urlDescarga);

    // A. Foto de archivo / stock / genérica / ilustrativa
    const arch = texto.match(ARCHIVO_RE);
    if (arch) return { ok: false, motivo: `foto de archivo/genérica ("${arch[0]}")` };
    if (c.esFuente) return { ok: true };

    // B. Paisajes / lugares de Asia fuera de contexto
    if (!ctx.asiaPermitida) {
        const asia = texto.match(ASIA_RE) || PAISES.filter(p => p.asia).map(p => texto.match(p._alias)).find(Boolean) || (_sens('CN', descr) ? ['China'] : null);
        const tld = [tldDe(hPag), tldDe(hImg)].map(id => id && POR_ID[id]).find(p => p && p.asia);
        if (asia || tld) return { ok: false, motivo: `paisaje/lugar de Asia fuera de contexto ("${asia ? asia[0] : tld.nombre}")` };
    }

    // C. Contexto geográfico ajeno
    const mencionados = PAISES.filter(p => p._alias.test(texto) || (SENSIBLES[p.id] && _sens(p.id, descr))).map(p => p.id);
    const tlds = [tldDe(hPag), tldDe(hImg)].filter(Boolean);
    const ajenos = [...new Set([...mencionados, ...tlds])].filter(id => !ctx.permitidos.has(id));
    const propios = mencionados.filter(id => ctx.permitidos.has(id));
    if (ajenos.length && !propios.length && !(ctx.id && tlds.includes(ctx.id))) return { ok: false, motivo: `contexto geográfico ajeno (${POR_ID[ajenos[0]].nombre})` };

    // D. Antigüedad: fecha de publicación, año en la leyenda/URL, o fecha claramente vieja
    const f = _fecha(c.fecha);
    if (f && (ahora - f) / 864e5 > maxDias) return { ok: false, motivo: `foto antigua (${f.toISOString().slice(0, 10)})` };
    const corto = norm(`${c.titulo || ''} ${(c.categorias || []).join(' ')} ${rutaTxt(c.urlPagina)} ${rutaTxt(c.urlDescarga)}`);   // sin la descripción larga (menciona años históricos)
    const años = [...(corto.match(/(?<![0-9])(19[5-9]\d|20[0-3]\d)(?![0-9])/g) || [])].filter(a => !ctx.años.has(a));
    const viejo = años.find(a => +a < ahora.getFullYear() - 1);
    if (viejo) return { ok: false, motivo: `foto antigua (año ${viejo} en leyenda/URL)` };

    // E. Rostros fuera de contexto (por leyenda): persona con nombre que la noticia no menciona, o retrato sin respaldo
    const limpia = descr.split(/\s[|–—-]\s/)[0].slice(0, 220);                 // quita el sufijo "| Nombre del medio"
    const pal = limpia.split(/\s+/).filter(w => /\p{L}{3,}/u.test(w)), mayus = pal.filter(w => /^\p{Lu}/u.test(w)).length;
    const titleCase = pal.length >= 5 && mayus / pal.length >= 0.8;               // "Dominican Republic Announces New Tax": no hay forma de distinguir nombres
    const nombres = titleCase ? [] : extraerNombres(limpia).filter(n => !n.some(t => hPag.includes(t) || hImg.includes(t)));
    const ajena = nombres.find(n => !n.some(t => ctx.tokens.has(t)));
    if (ajena) return { ok: false, motivo: `persona fuera de contexto ("${ajena.join(' ')}")` };
    if (RETRATO_RE.test(texto) && !nombres.some(n => n.some(t => ctx.tokens.has(t))))
        return { ok: false, motivo: 'retrato/primer plano sin respaldo en la noticia' };

    // F. Modo estricto: debe haber evidencia LOCAL (país/lugar en la leyenda, dominio del país o medio local)
    if (estricto && ctx.pais) {
        const local = propios.length || tlds.includes(ctx.id) || (ctx.id === 'DO' && [hPag, hImg].some(h => MEDIOS_DO.some(m => h === m || h.endsWith('.' + m))));
        if (!local) return { ok: false, motivo: `sin evidencia de ${ctx.pais.nombre} (modo estricto)` };
    }
    return { ok: true };
}

module.exports = { detectarContexto, anclarConsulta, validarCandidato, extraerNombres, PAISES, norm, MAX_DIAS, ESTRICTO };
