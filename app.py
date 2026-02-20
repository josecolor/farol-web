import os
from flask import Flask, render_template, request, redirect, url_for
from PIL import Image, ImageFilter

app = Flask(__name__)
app.config['SECRET_KEY'] = 'seoacuerdate-mxl-2026'
app.config['UPLOAD_FOLDER'] = 'static/uploads'

# El sistema crea las carpetas solo, tal como quedamos
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

@app.route('/')
def index():
    # Carga la fachada de Mexicali
    return render_template('index.html')

@app.route('/admin')
def admin():
    # El panel de redacción profesional
    return render_template('admin.html')

@app.route('/publicar', methods=['POST'])
def publicar():
    titulo = request.form.get('titulo')
    # Proceso de imagen con REGLA DE ORO: 20% Blur
    file = request.files.get('imagen')
    if file:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)
        
        # Aplicación del efecto ráfaga
        img = Image.open(filepath)
        img = img.filter(ImageFilter.GaussianBlur(radius=5)) # 20% de blur
        img.save(filepath)
        
    return "Publicado con seoacuerdate mxl"

if __name__ == '__main__':
    # Configuración para que Railway lo vea de inmediato
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
