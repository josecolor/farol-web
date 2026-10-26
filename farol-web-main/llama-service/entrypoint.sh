#!/bin/sh
# Arranca Ollama y descarga los modelos la primera vez (quedan en el Volume).
ollama serve &
PID=$!
until ollama list >/dev/null 2>&1; do sleep 1; done
for m in $LLM_MODELS; do
  if ! ollama list | grep -q "^$m"; then echo "⬇️  Descargando $m ..."; ollama pull "$m"; fi
done
echo "✅ Llama listo: $LLM_MODELS"
wait $PID
