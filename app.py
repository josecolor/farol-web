from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_ultra_secreto_2026'

# CONFIGURACIÓN
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELOS
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    keywords = db.Column(db.String(200))
    multimedia_url = db.Column(db.String(400))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- PORTADA NARANJA Y NEGRO (CORREGIDA) ---
html_portada = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-V5QW7Y6X8Z"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-V5QW7Y6X8Z');
    </script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>El Farol</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #000; color: #fff; font-family: sans-serif; }
        .header-farol { background: #000; border-bottom: 3px solid #ff8c00; padding: 20px 0; text-align: center; }
        .logo-text { color: #ff8c00; font-family: 'Impact', sans-serif; font-size: 2.5rem; text-transform: uppercase; }
        
        /* BOTÓN ARMY CORREGIDO */
        .btn-army { 
            background: #ff8c00; 
            color: #000; 
            font-weight: bold; 
            border: none; 
            padding: 12px; 
            width: 100%; 
            display: block;
            text-align: center;
            text-decoration: none;
            font-size: 1.1rem;
            text-transform: uppercase;
        }
    </style>
</head>
<body>

<a href="/unirse" class="btn-army">UNIRSE AL ARMY 🚨</a>

<div class="header-farol">
    <h1 class="logo-text">🏮 EL FAROL</h1>
</div>

<div class="container mt-5 text-center">
    {% if noticias %}
        {% else %}
        <h3 style="color: #ff8c00;">Esperando la primera exclusiva...</h3>
    {% endif %}
</div>
</body>
</html>
'''

# --- FORMULARIO DEL ARMY (LA PÁGINA QUE DABA ERROR) ---
html_unirse = '''
<body style="background:#000; color:#fff; font-family:sans-serif; text-align:center; padding:50px;">
    <h1 style="color:#ff8c00;">ÚNETE AL ARMY 🚨</h1>
    <p>Introduce tus datos para recibir las exclusivas de EL FAROL.</p>
    <form style="background:#111; padding:30px; display:inline-block; border-radius:10px; border:1px solid #ff8c00;">
        <input type="text" placeholder="Nombre" style="width:100%; padding:10px; margin-bottom:10px;"><br>
        <input type="email" placeholder="Email" style="width:100%; padding:10px; margin-bottom:20px;"><br>
        <button type="button" style="background:#ff8c00; color:#000; font-weight:bold; padding:10px 20px; border:none; cursor:pointer;">ENVIAR REGISTRO</button>
    </form>
    <br><br>
    <a href="/" style="color:#ff8c00; text-decoration:none;">← Volver a la portada</a>
</body>
'''

@app.route('/')
def index():
    return render_template_string(html_portada)

@app.route('/unirse')
def unirse():
    return render_template_string(html_unirse)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
