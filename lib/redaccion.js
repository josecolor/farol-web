'use strict';
/**
 * EL FAROL AL DÍA — Redacción autónoma de la nota (mínimo de palabras garantizado por AMPLIACIONES automáticas).
 * Un modelo pequeño rara vez llega a 900 palabras de una sola vez: en vez de fallar y quemar intentos, se le pide
 * continuar/profundizar la misma nota hasta alcanzar el mínimo. Sin preguntas ni intervención humana.
 */
const jefe = require('./jefe');

const contarPalabras = t => String(t || '').split(/\s+/).filter(w => w.length > 1).length;
const norm = p => p.toLowerCase().replace(/[^a-záéíóúñ0-9]+/g, ' ').trim();

function promptAmpliacion({ titulo, nombre, cargo, actual, falta, ultima }) {
    return [
        `Eres ${nombre}, ${cargo} de "El Farol al Día". Estás redactando la nota "${titulo}".`,
        'Este es el final del texto escrito hasta ahora:',
        '"""', actual.slice(-1800), '"""',
        `Escribe ahora SOLO los párrafos siguientes que continúen y profundicen la nota (faltan unas ${falta} palabras): antecedentes, contexto, ` +
            'alcance para la comunidad y lo que viene. No repitas lo ya dicho, no inventes cifras ni declaraciones que no estén en el contexto.',
        ultima ? 'Cierra la nota con un párrafo final de conclusión.' : 'No cierres todavía la nota.',
        'Responde únicamente con los párrafos nuevos: sin saludos, sin preguntas, sin notas, sin títulos ni etiquetas.',
    ].join('\n');
}

/**
 * @param generar   async (prompt, {system,temperature}) → texto
 * @returns {parsed, palabras, ampliaciones, alcanzoMinimo}
 */
async function redactar({ generar, prompt, system, temperature, categoria, rol, minPalabras = 900, rondasMax = 3 }) {
    let parsed = jefe.parsearRespuesta(await generar(prompt, { system, temperature }), { categoria });
    let ampliaciones = 0;
    const titulo = jefe.elegirTitular(parsed.tituloA, parsed.tituloB);
    while (contarPalabras(parsed.contenido) < minPalabras && ampliaciones < rondasMax) {
        const falta = minPalabras - contarPalabras(parsed.contenido);
        const ultima = ampliaciones === rondasMax - 1 || falta < 250;
        let extra = '';
        try { extra = jefe.limpiarContinuacion(await generar(promptAmpliacion({ titulo, nombre: rol.nombre, cargo: rol.cargo, actual: parsed.contenido, falta, ultima }), { system, temperature })); }
        catch { break; }                                                       // si el motor falla en la ampliación, se publica lo que hay (si supera el piso)
        const vistos = new Set(parsed.contenido.split('\n\n').map(norm));
        const nuevos = extra.split('\n\n').filter(p => p.length > 30 && !vistos.has(norm(p)));
        ampliaciones++;
        if (!nuevos.length) continue;
        parsed.contenido = `${parsed.contenido}\n\n${nuevos.join('\n\n')}`.trim();
    }
    const palabras = contarPalabras(parsed.contenido);
    return { parsed, palabras, ampliaciones, alcanzoMinimo: palabras >= minPalabras };
}

module.exports = { redactar, contarPalabras };
