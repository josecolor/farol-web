/**
 * 📜 LEDGER.JS — El Farol al Día
 * Certificación SHA-256 de autenticidad para cada noticia.
 * Genera un hash único e inmutable del contenido en el momento de publicación.
 * Si el contenido cambia, el hash no coincide → detecta alteraciones.
 */

'use strict';

const crypto = require('crypto');

/**
 * Genera el hash SHA-256 de una noticia.
 * Incluye: titulo + contenido + seccion + fecha (truncada a minuto).
 * La fecha se trunca al minuto para tolerar diferencias de segundos en el guardado.
 *
 * @param {Object} noticia
 * @param {string} noticia.titulo
 * @param {string} noticia.contenido
 * @param {string} noticia.seccion
 * @param {string|Date} noticia.fecha
 * @returns {string} Hash hex de 64 caracteres
 */
function generarHash(noticia) {
    const fecha = noticia.fecha ? new Date(noticia.fecha) : new Date();
    // Truncar a minuto exacto para evitar variaciones de ms
    fecha.setSeconds(0, 0);

    const payload = [
        (noticia.titulo  || '').trim(),
        (noticia.contenido || '').trim(),
        (noticia.seccion || '').trim(),
        fecha.toISOString()
    ].join('||FAROL||');

    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Verifica si el hash de una noticia coincide con su contenido actual.
 *
 * @param {Object} noticia  — objeto con titulo, contenido, seccion, fecha
 * @param {string} hashGuardado — el hash almacenado al publicar
 * @returns {{ valido: boolean, hashActual: string, hashGuardado: string }}
 */
function verificarHash(noticia, hashGuardado) {
    const hashActual = generarHash(noticia);
    return {
        valido: hashActual === hashGuardado,
        hashActual,
        hashGuardado
    };
}

/**
 * Crea el bloque de certificación completo para guardar en BD.
 * Guarda: hash + timestamp ISO + versión del algoritmo.
 *
 * @param {Object} noticia
 * @returns {{ hash: string, timestamp: string, algoritmo: string, version: string }}
 */
function certificar(noticia) {
    return {
        hash:       generarHash(noticia),
        timestamp:  new Date().toISOString(),
        algoritmo:  'SHA-256',
        version:    'EFD-1.0'
    };
}

/**
 * Formatea el hash para mostrar en frontend (primeros 12 chars + …).
 * Ejemplo: "a3f7c1d09e2b…"
 *
 * @param {string} hash
 * @returns {string}
 */
function hashCorto(hash) {
    if (!hash || hash.length < 12) return hash || '';
    return `${hash.substring(0, 12)}…`;
}

/**
 * Genera el badge HTML de certificación para insertar en noticia.html.
 *
 * @param {string} hash — hash completo
 * @param {string} timestamp — ISO string
 * @returns {string} HTML del badge
 */
function badgeCertificacion(hash, timestamp) {
    const fechaFmt = timestamp
        ? new Date(timestamp).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'medium', timeStyle: 'short' })
        : '';
    const corto = hashCorto(hash);
    return `<div class="ledger-badge" title="Hash SHA-256: ${hash}" onclick="navigator.clipboard&&navigator.clipboard.writeText('${hash}')">
  <span class="ledger-icon">🔐</span>
  <span class="ledger-text">Noticia certificada · <code>${corto}</code></span>
  ${fechaFmt ? `<span class="ledger-fecha">${fechaFmt}</span>` : ''}
</div>`;
}

module.exports = { generarHash, verificarHash, certificar, hashCorto, badgeCertificacion };
