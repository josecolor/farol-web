# El Farol al Día — Motor V41 (Ollama + Jefe de Redacción)

| Archivo | Función |
|---|---|
| `lib/llm.js` | Motor único: Ollama `qwen2.5:0.5b` sin API key (cola, streaming, circuit breaker, JSON robusto). `generarTexto()` para artículos |
| `lib/jefe.js` | Jefe de Redacción Inteligente: módulo analítico del prompt de sistema (Noticia Dura vs General, Virality Score, titulares SEO/redes), heurística de respaldo y **parser flexible** (texto libre o con etiquetas) |
| `lib/mongo.js` | Memoria de rendimiento en MongoDB: `noticias_meta` (evaluación por noticia + vistas reales) e `intentos_ia` (historial de intentos) |
| `lib/imagenes/web.js` | Extractor web directo: og:image de la fuente original + búsqueda por contexto (Bing News RSS / DuckDuckGo HTML). Sin Pexels, Piped ni catálogos |
| `lib/imagenes/` | web (nivel 1) → buscador con licencia Commons/Openverse (nivel 2) → tarjeta de marca (nivel 3); depurador anti-SSRF, dedupe, marca de agua, almacén |
| `llama-service/` | Dockerfile + entrypoint del servicio Ollama (descarga solo `qwen2.5:0.5b`) |
| `test/fase2.test.js` | 59 comprobaciones (`npm test`) |

## Variables en Railway
- Servicio web: `DATABASE_URL`, `LLM_BASE_URL` (p. ej. `http://llama.railway.internal:11434`), `MONGO_URL` (+ `MONGO_DB`, por defecto `elfarol`), `BASE_URL`.
- Opcionales: `LLM_MODEL` (por defecto `qwen2.5:0.5b`), `IMG_SOLO_LICENCIADAS=1` (desactiva el extractor web y usa solo fotos con licencia), `IMG_WEB_MIN_ANCHO`, `IMG_WEB_MIN_RELEVANCIA`.

## Endpoints (requieren sesión + `?pin=`)
`/api/ia/status` · `/api/jefe-redaccion/estado` · `/api/jefe-redaccion/historial?limite=&tipo=&categoria=` · `POST /api/jefe-redaccion/sincronizar`
