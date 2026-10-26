'use strict';
/**
 * Política de licencias del portal (estricta, pensada para AdSense):
 *   ✅ CC0 / Dominio público      → uso libre
 *   ✅ CC BY (cualquier versión)  → permitido CON atribución visible (la mostramos bajo la foto)
 *   ❌ CC BY-SA                   → obligaría a re-licenciar la foto con marca de agua
 *   ❌ CC BY-NC / NC-ND / ND      → NC prohíbe uso comercial (publicidad); ND prohíbe modificarla (marca de agua)
 *   ❌ GFDL, "fair use", "all rights reserved", desconocida → rechazada
 */
const strip = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

function clasificar(texto, version) {
    const s = strip(texto).toLowerCase();
    if (!s) return { permitida: false, motivo: 'licencia vacía' };
    if (/\b(nc|nd|sa)\b|by[\s-]*(nc|nd|sa)/.test(s) && /\bby\b|cc/.test(s)) return { permitida: false, motivo: `licencia restrictiva (${s})` };
    if (/gfdl|fair use|all rights reserved|copyrighted|non-?free|unknown|desconocid/.test(s)) return { permitida: false, motivo: `licencia no apta (${s})` };
    if (/\bcc0\b|\bpdm\b|public domain|dominio p[uú]blico|\bpd[\s-]|cc zero/.test(s))
        return { permitida: true, tipo: 'cc0', etiqueta: /cc0|cc zero/.test(s) ? 'CC0' : 'Dominio público', url: /cc0|cc zero/.test(s) ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://creativecommons.org/publicdomain/mark/1.0/', requiereCredito: false };
    const m = s.match(/cc[\s-]*by[\s-]*(\d\.\d)?/) || s.match(/^by\b/);
    if (m && !/by[\s-]*(nc|nd|sa)/.test(s)) {
        const v = m[1] || version || '4.0';
        return { permitida: true, tipo: 'by', etiqueta: `CC BY ${v}`, url: `https://creativecommons.org/licenses/by/${v}/`, requiereCredito: true };
    }
    return { permitida: false, motivo: `licencia no reconocida (${s})` };
}
module.exports = { clasificar, strip };
