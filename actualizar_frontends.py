import os

print("🎨 [MXL FRONTEND] Actualizando vistas públicas y de redacción...")

# Directorios y archivos de frontend a limpiar y unificar
vistas = [
    'client/index.html',
    'client/noticia.html',
    'client/redaccion.html',
    'client/ingeniero.html',
    'index.html',
    'noticia.html',
    'redaccion.html',
    'ingeniero.html'
]

for vista in vistas:
    if os.path.exists(vista):
        with open(vista, 'r', encoding='utf-8', errors='ignore') as f:
            html = f.read()
        
        # Limpiar elementos obsoletos de redes sociales y widgets muertos
        html = html.replace('Facebook', 'Comunidad')
        html = html.replace('Twitter / X', 'Actualidad')
        html = html.replace('Telegram Bot', 'Sistema Local')
        
        with open(vista, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"✨ Frontend optimizado: {vista}")

print("🚀 ¡Vistas frontales actualizadas con éxito!")
