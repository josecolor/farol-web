'use strict';
/**
 * EL FAROL AL DÍA — Router de texto con Llama autohospedado (Fase 2)
 * Sin API keys: habla con un servicio Ollama propio. Motor por defecto: qwen2.5:1.5b.
 */
const cache = require('./cache');

const BASE      = (process.env.LLM_BASE_URL || 'http://llama.railway.internal:11434').replace(/\/$/, '');
const MODELOS   = [process.env.LLM_MODEL || 'qwen2.5:1.5b', process.env.LLM_MODEL_FALLBACK || '']
                    .filter((m, i, a) => m && a.indexOf(m) === i);
const NUM_CTX   = parseInt(process.env.LLM_NUM_CTX || '8192');
const STALL_MS  = parseInt(process.env.LLM_STALL_MS || '180000');
const TOTAL_MS  = parseInt(process.env.LLM_TOTAL_MS || '1200000');
const MAX_COLA  = parseInt(process.env.LLM_MAX_COLA || '6');

const SISTEMA_DEFAULT =
 'Eres redactor del periódico digital "El Farol al Día" (Santo Domingo Este, República Dominicana). ' +
 'Escribes en español neutro claro, tono periodístico cercano. REGLAS ESTRICTAS: ' +
 '1. Ve directamente a la noticia o formato solicitado sin preámbulos. ' +
 '2. PROHIBIDO incluir saludos, introducciones conversacionales ni comentarios como "Hola, me alegra que te guste". ' +
 '3. No inventes datos, cifras, nombres, declaraciones ni lugares; si el contexto no trae un dato, no lo menciones. ' +
 '4. Respeta EXACTAMENTE el formato de etiquetas que se te pida.';

let _ocupado = false; const _cola = [];
function _encolar(tarea) {
    if (_cola.length >= MAX_COLA) return Promise.reject(new Error('LLM_COLA_LLENA'));
    return new Promise((ok, ko) => { _cola.push({ tarea, ok, ko }); _siguiente(); });
}
async function _siguiente() {
    if (_ocupado || !_cola.length) return;
    _ocupado = true;
    const { tarea, ok, ko } = _cola.shift();
    try { ok(await tarea()); } catch (e) { ko(e); } finally { _ocupado = false; _siguiente(); }
}

const cb = { fallos: 0, abiertoHasta: 0, ultimoOk: 0, ultimoError: null, modeloActivo: null, generadas: 0 };
function disponible() { return Date.now() >= cb.abiertoHasta; }
function _fallo(e) {
    cb.fallos++; cb.ultimoError = e.message;
    if (cb.fallos >= 3) { cb.abiertoHasta = Date.now() + 2 * 60 * 1000; cb.fallos = 0; }
}

async function _chat(modelo, mensajes, { maxTokens, temperature, json }) {
    const ctrl = new AbortController();
    const tTotal = setTimeout(() => ctrl.abort(new Error('LLM_TIMEOUT_TOTAL')), TOTAL_MS);
    let tStall = setTimeout(() => ctrl.abort(new Error('LLM_STALL')), STALL_MS);
    const rearmar = () => { clearTimeout(tStall); tStall = setTimeout(() => ctrl.abort(new Error('LLM_STALL')), STALL_MS); };
    try {
        const res = await fetch(`${BASE}/api/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
            body: JSON.stringify({
                model: modelo, messages: mensajes, stream: true, keep_alive: '24h',
                ...(json ? { format: 'json' } : {}),
                options: { temperature, top_p: 0.9, repeat_penalty: 1.1, num_ctx: NUM_CTX, num_predict: maxTokens },
            }),
        });
        if (!res.ok) throw new Error(`LLM_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}`);
        const dec = new TextDecoder(); let buf = '', texto = '';
        for await (const trozo of res.body) {
            rearmar();
            buf += dec.decode(trozo, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const linea = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
                if (!linea) continue;
                const o = JSON.parse(linea);
                if (o.error) throw new Error(`LLM_ERR: ${o.error}`);
                texto += o.message?.content || '';
            }
        }
        if (!texto.trim()) throw new Error('LLM_VACIO');
        return texto.trim();
    } catch (e) {
        throw ctrl.signal.aborted && ctrl.signal.reason ? ctrl.signal.reason : e;
    } finally { clearTimeout(tTotal); clearTimeout(tStall); }
}

async function generar(prompt, { maxTokens = 2500, temperature = 0.7, system = SISTEMA_DEFAULT, json = false, retries = 2 } = {}) {
    if (!disponible()) throw new Error('LLM_CIRCUITO_ABIERTO');
    const mensajes = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
    return _encolar(async () => {
        let ultimo;
        for (const modelo of MODELOS) {
            for (let i = 0; i < Math.max(1, retries); i++) {
                try {
                    const t0 = Date.now();
                    const txt = await _chat(modelo, mensajes, { maxTokens, temperature, json });
                    cb.fallos = 0; cb.ultimoOk = Date.now(); cb.modeloActivo = modelo; cb.generadas++;
                    return txt;
                } catch (e) {
                    ultimo = e;
                    if (/fetch failed|ECONNREFUSED|ENOTFOUND/.test(e.message)) break;
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
        }
        _fallo(ultimo); throw new Error(`Llama falló: ${ultimo?.message}`);
    });
}

function _repararJSON(t) {
    let s = t.replace(/```json|```/gi, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    s = s.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(s);
}

async function generarJSON(prompt, { cacheSeg = 0, ...opts } = {}) {
    const ejecutar = async () => {
        const t = await generar(prompt, { maxTokens: 600, temperature: 0.2, ...opts, json: true });
        return _repararJSON(t);
    };
    if (!cacheSeg) return ejecutar();
    const k = require('crypto').createHash('md5').update(prompt).digest('hex');
    return cache.wrap('llm', k, cacheSeg, ejecutar);
}

async function llamarGemini(prompt, reintentos = 2, maxTokens = 8000, opts = {}) {
    return generar(prompt, { retries: reintentos, maxTokens: Math.min(maxTokens, 3500), ...opts });
}

async function estado() {
    const base = { servicio: BASE, modelos: MODELOS, cola: _cola.length, ocupado: _ocupado, circuito: disponible() ? 'cerrado' : 'ABIERTO', generadas: cb.generadas };
    try {
        const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(4000) });
        const j = await r.json();
        return { ...base, servicio_vivo: true, instalados: (j.models || []).map(m => m.name) };
    } catch (e) { return { ...base, servicio_vivo: false, error: e.message }; }
}

let _calentando = false, _calentado = false;
async function calentar({ intentos = 12, baseMs = 10000 } = {}) {
    if (_calentando || _calentado) return;
    _calentando = true;
    try {
        for (let n = 1; n <= intentos; n++) {
            try {
                const t = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(8000) });
                if (!t.ok) throw new Error();
                const instalados = ((await t.json()).models || []).map(m => m.name);
                const modelo = MODELOS.find(m => instalados.some(i => i === m || i === `${m}:latest`));
                if (!modelo) throw new Error();
                const r = await fetch(`${BASE}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: modelo, prompt: '', keep_alive: '24h' }), signal: AbortSignal.timeout(300000) });
                if (!r.ok) throw new Error();
                await r.arrayBuffer();
                _calentado = true; cb.fallos = 0; cb.ultimoOk = Date.now(); cb.modeloActivo = modelo;
                return;
            } catch (e) {
                if (n < intentos) await new Promise(r => setTimeout(r, Math.min(baseMs * 2 ** (n - 1), 120000)));
            }
        }
    } catch {} finally { _calentando = false; }
}

let _mongoCol = null;
(async () => {
    if (!process.env.MONGO_URL) return;
    try {
        const { MongoClient } = require('mongodb');
        const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        _mongoCol = client.db('farol').collection('noticias_meta');
    } catch {}
})();

async function guardarMetaMongo(meta) {
    if (!_mongoCol) return;
    await _mongoCol.insertOne({ ...meta, _ts: new Date() });
}

module.exports = { generar, generarJSON, llamarGemini, disponible, estado, calentar, guardarMetaMongo };
