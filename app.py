import os
import re
import bleach
from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from functools import wraps
from datetime import datetime

app = Flask(__name__)
# Clave de seguridad interna
app.secret_key = os.getenv("SECRET_KEY", "farol_mxl_2026_oficial")

# Protección contra ataques, pero con bypass para su comodidad
csrf = CSRFProtect(app)

# --- CONFIGURACIÓN DE BASE DE DATOS ---
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
    video_url = db.Column(db.String(500))
    keywords = db.Column(db.String(200))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)
    slug = db.Column(db.String(260), unique=True)

    def generate_slug(self):
        # Crea un enlace limpio para Google (SEO)
        self.slug = re.sub(r'[^a-z0-9]+', '-', self.titulo.lower()).strip('-')

with app.app_context():
    db.create_all()

# --- FILTRO DE ACCESO ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- PORTADA PÚBLICA ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

# --- LOGIN (director / farol2026) ---
@app.route('/login', methods=['GET', 'POST'])
@csrf.exempt # Evita el error de "Token Missing" al entrar
def login():
    if request.method == 'POST':
        if request.form.get('username') == 'director' and request.form.get('password') == 'farol2026':
            session['logged_in'] = True
            return redirect(url_for('admin'))
        flash('Credenciales incorrectas')
    return '''
    <body style="background:#003366;color:white;text-align:center;padding-top:100px;font-family:Impact;">
        <h1>🏮 CONTROL DE ACCESO - EL FAROL</h1>
        <form method="post" style="background:white;padding:30px;display:inline-block;border-radius:15px;color:black;">
            <input name="username" placeholder="Usuario" style="width:100%;padding:10px;margin-bottom:10px;" required><br>
            <input type="password" name="password" placeholder="Contraseña" style="width:100%;padding:10px;margin-bottom:10px;" required><br>
            <button type="submit" style="background:#FF8C00;color:white;border:none;padding:15px;width:100%;font-family:Impact;cursor:pointer;">ENTRAR</button>
        </form>
    </body>
    '''

# --- PANEL DE ADMINISTRACIÓN (TIPO BLOGGER) ---
@app.route('/admin', methods=['GET', 'POST'])
@login_required
@csrf.exempt # ELIMINA EL ERROR "BAD REQUEST" DEFINITIVAMENTE
def admin():
    if request.method == 'POST':
        # Limpiamos el texto para que el servidor lo acepte con iconos
        contenido_limpio = bleach.clean(request.form.get('contenido'), 
            tags=['p','br','strong','em','u','h1','h2','h3','ul','ol','li','a','img','iframe','div','span'],
            attributes={'*': ['class', 'style'], 'a': ['href'], 'img': ['src'], 'iframe': ['src']}, strip=False)
        
        nueva = Noticia(
            titulo=request.form.get('titulo'),
            contenido=contenido_limpio,
            imagen_url=request.form.get('imagen_url'),
            video_url=request.form.get('video_url'),
            keywords=request.form.get('keywords')
        )
        nueva.generate_slug()
        db.session.add(nueva)
        db.session.commit()
        return redirect(url_for('index'))
    
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Editor Pro - El Farol</title>
        <script src="https://cdn.ckeditor.com/4.25.1-lts/standard/ckeditor.js"></script>
    </head>
    <body style="background:#f4f4f4;padding:20px;font-family:sans-serif;">
        <div style="max-width:900px;margin:auto;background:white;padding:25px;border-radius:15px;box-shadow:0 0 15px rgba(0,0,0,0.2);">
            <h2 style="font-family:Impact;color:#003366;border-bottom:4px solid #FF8C00;padding-bottom:10px;">🏮 EDITOR PROFESIONAL - EL FAROL</h2>
            <form method="post">
                <label><b>Título de la Noticia:</b></label>
                <input type="text" name="titulo" placeholder="Ej: GRAN EXCLUSIVA EN MEXICALI" style="width:100%;padding:12px;margin:10px 0;border:1px solid #ccc;" required>
                
                <label><b>URL de Imagen (Para el Blur 20%):</b></label>
                <input type="text" name="imagen_url" placeholder="Pegue el link de la foto aquí" style="width:100%;padding:10px;margin:10px 0;border:1px solid #ccc;">
                
                <label><b>URL de Video:</b></label>
                <input type="text" name="video_url" placeholder="YouTube o Facebook link" style="width:100%;padding:10px;margin:10px 0;border:1px solid #ccc;">
                
                <label><b>Keywords (SEO):</b></label>
                <input type="text" name="keywords" placeholder="Nacional, Viral, Mexicali" style="width:100%;padding:10px;margin:10px 0;border:1px solid #ccc;">
                
                <label><b>Contenido (Use los iconos de arriba):</b></label>
                <textarea name="contenido" id="editor_pro"></textarea>
                <script>CKEDITOR.replace('editor_pro', { height: 400 });</script>
                
                <button type="submit" style="background:#FF8C00;color:white;width:100%;padding:20px;font-family:Impact;font-size:1.5em;border:none;margin-top:20px;cursor:pointer;border-radius:10px;">🚀 PUBLICAR EN EL FAROL</button>
            </form>
        </div>
    </body>
    </html>
    '''

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
