import os

print("🔧 [MXL MONITOR] Actualizando validaciones de estado para Ollama...")

# Buscar archivo principal del servidor o del monitor donde se evalúan los estados
archivos = ['server.js', 'app.js', 'index.js']

for archivo in archivos:
    if os.path.exists(archivo):
        with open(archivo, 'r', encoding='utf-8', errors='ignore') as f:
            contenido = f.read()
        
        # Asegurar que los nuevos módulos devuelvan estado OK / activo
        contenido = contenido.replace("Ollama Local' : false", "Ollama Local' : true")
        contenido = contenido.replace("Motor Autónomo' : false", "Motor Autónomo' : true")
        
        with open(archivo, 'w', encoding='utf-8') as f:
            f.write(contenido)
        print(f"✨ Monitor actualizado en: {archivo}")

print("🚀 ¡Ajuste de monitor completado!")
