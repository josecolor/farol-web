# El Farol al Día — Motor V43 (Ollama + Jefe de Redacción + Fase final)

| Archivo | Función |
|---|---|
| `lib/llm.js` | Motor único: Ollama `qwen2.5:0.5b` sin API key (cola, streaming, circuit breaker, JSON robusto). `generarTexto()` para artículos |
| `lib/jefe.js` | Jefe de Redacción Inteligente: módulo analítico del prompt de sistema (Noticia Dura vs General, Virality Score, titulares SEO/redes), heurística de respaldo y **parser flexible** (texto libre o con etiquetas) |
| `lib/mongo.js` | Memoria de rendimiento en MongoDB: `noticias_meta` (evaluación por noticia + vistas reales) e `intentos_ia` (historial de intentos) |
| `lib/imagenes/web.js` | Extractor web directo: og:image de la fuente original + búsqueda por contexto (Bing News RSS / DuckDuckGo HTML). Sin Pexels, Piped ni catálogos |
| `lib/imagenes/` | web (nivel 1) → buscador con licencia Commons/Openverse (nivel 2) → tarjeta de marca (nivel 3); depurador anti-SSRF, dedupe, marca de agua, almacén |
| `llama-service/` | Dockerfile + entrypoint del servicio Ollama (descarga solo `qwen2.5:0.5b`) |
| `lib/imagenes/geo.js` | **Filtro geográfico estricto**: detecta país/lugar de la primicia, ancla TODA consulta web con ese contexto y valida cada foto candidata (descarta Asia ajena, fotos de archivo/stock/antiguas, personas y retratos fuera de contexto, y —en modo estricto— fotos sin evidencia local) |
| `lib/videos/index.js` | **Micro-pipeline de videos cortos** (FFmpeg local): degradado de marca + filete + marca de agua, sin metadatos (título, GPS, dispositivo, fecha, capítulos), H.264/AAC ≤720p con `+faststart`, póster y descriptor |
| `nixpacks.toml` | Instala FFmpeg en Railway |
| `test/fase2.test.js` · `test/fase3.test.js` | 59 + 82 comprobaciones (`npm test`) |

## Variables en Railway
- Servicio web: `DATABASE_URL`, `LLM_BASE_URL` (p. ej. `http://llama.railway.internal:11434`), `MONGO_URL` (+ `MONGO_DB`, por defecto `elfarol`), `BASE_URL`.
- Opcionales: `LLM_MODEL` (por defecto `qwen2.5:0.5b`), `IMG_SOLO_LICENCIADAS=1` (desactiva el extractor web y usa solo fotos con licencia), `IMG_WEB_MIN_ANCHO`, `IMG_WEB_MIN_RELEVANCIA`, `IMG_GEO_ESTRICTO` (1 por defecto), `IMG_MAX_ANTIGUEDAD_DIAS` (365), `VIDEO_MIN_SEG`/`VIDEO_MAX_SEG`/`VIDEO_MAX_MB`/`VIDEO_CRF`, `VIDEO_DEGRADADO` (0 = sin degradado).

## Endpoints (requieren sesión + `?pin=`)
`/api/ia/status` · `/api/jefe-redaccion/estado` · `/api/jefe-redaccion/historial?limite=&tipo=&categoria=` · `POST /api/jefe-redaccion/sincronizar`

## Fase final
**Imágenes.** `obtenerImagenLimpia()` calcula el contexto geográfico (`geo.detectarContexto`) con titular + comunicado + contenido; Bing News (mercado del país), DuckDuckGo (región del país) y Commons/Openverse reciben la consulta con el país/lugar antepuesto, y cada candidato pasa por `geo.validarCandidato` antes de descargarse. La validación trabaja sobre metadatos (título, leyenda, URL, fecha, dominio): no hay reconocimiento facial.

**Videos.** Entradas: (1) el redactor sube el clip en `/redaccion` (campo "Clip de video") → `POST /api/video/subir` (cuerpo binario `video/*`, `?fuente=&titulo=`); (2) `POST /api/video/desde-url` `{url, fuente, noticia_id?}`; (3) automático: si un ítem RSS trae `enclosure`/`media:content` de video, `procesarRSS` lo procesa y lo publica con la noticia. Luego `POST /api/video/adjuntar/:id` `{nombre}` o `video_nombre` en `/api/generar-noticia` y `/api/publicar`. La noticia muestra `<video>` con póster y crédito, `og:video` y JSON-LD `VideoObject`. `GET /video/:nombre` sirve con Range (iOS/Safari). `GET /api/video/status` (sesión) indica si hay FFmpeg.
