import os

print("🧹 [MXL LIMPIEZA] Removiendo referencias obsoletas de redes y optimizando para Ollama...")

# Limpiar referencias en el index o ingeniero si existen
archivos_a_revisar = ['client/ingeniero.html', 'client/redaccion.html', 'ingeniero.html', 'redaccion.html']

for archivo in archivos_a_revisar:
    if os.path.exists(archivo):
        with open(archivo, 'r', encoding='utf-8', errors='ignore') as f:
            contenido = f.read()
        
        # Reemplazar menciones a redes sociales obsoletas por indicadores limpios de Ollama
        contenido = contenido.replace('Facebook', 'Ollama Local')
        contenido = contenido.replace('Twitter / X', 'Motor Autónomo')
        contenido = contenido.replace('Telegram Bot', 'Sistema Interno')
        
        with open(archivo, 'w', encoding='utf-8') as f:
            f.write(contenido)
        print(f"✨ Archivo actualizado y limpio: {archivo}")

print("🚀 ¡Limpieza de interfaz completada con éxito!")
