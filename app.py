import os
from flask import Flask, render_template, request, jsonify
from PIL import Image, ImageFilter

app = Flask(__name__)

# CONFIGURACIÓN API DE EL FAROL
app.config['SECRET_KEY'] = 'seoacuerdate-mxl-2026'
app.config['UPLOAD_FOLDER'] = 'static' # Donde reside el logo y las ráfagas

# Crear directorio de trabajo si no existe
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

@app.route('/')
def home():
    """API de Portada: Muestra el Farol al Día"""
    return render_template('index.html')

@app.route('/admin')
def admin():
    """API Administrativa: El Lápiz de Redacción"""
    return render_template('admin.html')

@app.route('/publicar', methods=['POST'])
def api_publicar():
    """Motor de Procesamiento: Imagen + Blur + SEO"""
    titulo = request.form.get('titulo')
    file = request.files.get('imagen')
    
    if file:
        filename = file.filename
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # REGLA DE ORO: Procesamiento de 20% Blur
        img = Image.open(filepath)
        img = img.filter(ImageFilter.GaussianBlur(radius=5)) 
        img.save(filepath)
        
        # Retorno de éxito con el Mantra
        return jsonify({
            "status": "success",
            "message": "Noticia publicada: seoacuerdate mxl",
            "image_path": f"/static/{filename}"
        }), 200

if __name__ == '__main__':
    # Configuración dinámica para Railway
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
