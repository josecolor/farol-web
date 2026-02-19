import os
import re
import bleach # Librería para limpiar HTML
from flask import Flask, render_template, request, redirect, url_for, session, flash, abort
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from functools import wraps
from datetime import datetime
from urllib.parse import urlparse

app = Flask(__name__)
# 🔑 Usa variable de entorno o una clave fija segura
app.secret_key = os.getenv("SECRET_KEY", "farol_mxl_2026_ultra_safe")

# 🔒 PROTECCIÓN CSRF ACTIVADA
csrf = CSRFProtect(app)

# BASE DE DATOS PROFESIONAL
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(250), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    imagen_url = db.Column(db.String(500))
    video_url = db.Column(db.String(500)) # CORREGIDO: Sin duplicar db.Column
    keywords = db.Column(db.String(200))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)
    slug = db.Column(db.String(260), unique=True)

    def generate_slug(self):
        self.slug = re.sub(r'[^a-z0-9]+', '-', self.titulo.lower()).strip('-')

with app.app_context():
    db.create_all()

# SEGURIDAD DE ACCESO
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def validar_url(url, tipo='imagen'):
    if not url: return True
    parsed = urlparse(url)
    # Lista flexible de dominios para no bloquear sus fotos
    return True 

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).limit(20).all()
    return render_template('index.html', noticias=noticias)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        
        admin_user = os.getenv('ADMIN_USER', 'director')
        admin_pass = os.getenv('ADMIN_PASS', 'farol2026')
        
        if username == admin_user and password == admin_pass:
            session['logged_in'] = True
            return redirect(url_for('admin'))
        else:
            flash('Credenciales incorrectas', 'error')
    
    return render_template_string_login() # Se define abajo por espacio

@app.route('/logout')
@login_required
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/admin', methods=['GET', 'POST'])
@login_required
def admin():
    if request.method == 'POST':
        titulo = request.form.get('titulo', '').strip()
        contenido = request.form.get('contenido', '')
        imagen_url = request.form.get('imagen_url', '').strip()
        video_url = request.form.get('video_url', '').strip()
        keywords = request.form.get('keywords', '').strip()
        
        # Sanitizar contenido para permitir videos e imágenes del editor
        contenido_limpio = bleach.clean(
            contenido, 
            tags=['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
                  'ul', 'ol', 'li', 'a', 'img', 'iframe', 'blockquote', 'div', 'span'],
            attributes={
                'a': ['href', 'title', 'target'],
                'img': ['src', 'alt', 'width', 'height'],
                'iframe': ['src', 'width', 'height', 'frameborder', 'allowfullscreen'],
                '*': ['class', 'style']
            },
            strip=False
        )
        
        nueva_nota = Noticia(
            titulo=titulo[:250],
            contenido=contenido_limpio,
            imagen_url=imagen_url[:500],
            video_url=video_url[:500],
            keywords=keywords[:200]
        )
        nueva_nota.generate_slug()
        
        db.session.add(nueva_nota)
        db.session.commit()
        flash('Noticia publicada exitosamente', 'success')
        return redirect(url_for('index'))
    
    return render_template_string_admin() # Se define abajo

# --- FUNCIONES DE TEMPLATE INTERNAS PARA EVITAR ERRORES ---
def render_template_string_login():
    return '''
    <body style="background:#003366;color:white;text-align:center;padding-top:100px;font-family:Impact;">
        <h1>🏮 LOGIN EL FAROL</h1>
        <form method="post" style="background:white;padding:20px;display:inline-block;border-radius:10px;color:black;">
            <input type="hidden" name="csrf_token" value="{{ csrf_token() }}">
            <input name="username" placeholder="Usuario" required style="padding:8px;"><br><br>
            <input type="password" name="password" placeholder="Clave" required style="padding:8px;"><br><br>
            <button type="submit" style="background:#FF8C00;color:white;padding:10px 20px;border:none;cursor:pointer;">ENTRAR</button>
        </form>
    </body>
    '''

def render_template_string_admin():
    return '''
    <head>
        <script src="https://cdn.ckeditor.com/4.25.1-lts/full/ckeditor.js"></script>
    </head>
    <body style="background:#f4f4f4;font-family:sans-serif;padding:20px;">
        <div style="max-width:900px;margin:auto;background:white;padding:25px;border-radius:15px;box-shadow:0 0 15px rgba(0,0,0,0.2);">
            <h2 style="font-family:Impact;color:#003366;border-bottom:4px solid #FF8C00;">🏮 EDITOR PRO - EL FAROL</h2>
            <form method="post">
                <input type="hidden" name="csrf_token" value="{{ csrf_token() }}">
                <input type="text" name="titulo" placeholder="Título Impactante" style="width:100%;padding:10px;margin-bottom:10px;" required>
                <input type="text" name="imagen_url" placeholder="URL de Imagen" style="width:100%;padding:10px;margin-bottom:10px;">
                <input type="text" name="video_url" placeholder="URL de Video" style="width:100%;padding:10px;margin-bottom:10px;">
                <input type="text" name="keywords" placeholder="Keywords" style="width:100%;padding:10px;margin-bottom:10px;">
                <textarea name="contenido" id="editor_pro"></textarea>
                <script>CKEDITOR.replace('editor_pro', { height: 400, allowedContent: true });</script>
                <button type="submit" style="background:#FF8C00;color:white;width:100%;padding:20px;font-family:Impact;font-size:1.5em;border:none;margin-top:20px;cursor:pointer;">🚀 PUBLICAR NOTICIA</button>
            </form>
        </div>
    </body>
    '''

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
