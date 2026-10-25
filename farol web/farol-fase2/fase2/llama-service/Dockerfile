# Servicio privado de Llama para El Farol al Día (Railway).
# Crear como SERVICIO NUEVO en el mismo proyecto, con un Volume montado en /root/.ollama
# y SIN dominio público (Ollama no tiene autenticación).
FROM ollama/ollama:latest

ENV OLLAMA_HOST=0.0.0.0:11434 \
    OLLAMA_KEEP_ALIVE=24h \
    OLLAMA_NUM_PARALLEL=1 \
    OLLAMA_MAX_LOADED_MODELS=1 \
    OLLAMA_FLASH_ATTENTION=1 \
    LLM_MODELS="llama3.1:8b llama3.2:3b"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
