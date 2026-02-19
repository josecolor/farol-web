import os
import re
import bleach
from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from functools import wraps
from datetime import datetime

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "farol_mxl_2026_oficial_master")
csrf = CSRFProtect(app)

# --- BASE DE DATOS PROFESIONAL (CON VISTAS) ---
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
    vistas = db.Column(db.Integer, default=0) # Para sus gráficas de Blogger
    fecha = db.Column(db.DateTime, default=datetime.utcnow)
    slug = db.Column(db.String(260), unique=True)

    def generate_slug(self):
        self.slug = re.sub(r'[^a-z0-9]+', '-', self.titulo.lower()).strip('-')

with app.app_context():
    db.create_all()

# --- SEGURIDAD DE ACCESO ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- RUTAS PÚBLICAS ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

@app.route('/login', methods=['GET', 'POST'])
@csrf.exempt
def login():
    if request.method == 'POST':
        if request.form.get('username') == 'director' and request.form.get('password') == 'farol2026':
            session['logged_in'] = True
            return redirect(url_for('admin'))
    return '''<body style="background:#003366;color:white;text-align:center;padding-top:100px;font-family:Impact;">
        <h1>🏮 ACCESO EL FAROL</h1><form method="post" style="background:white;padding:20px;display:inline-block;border-radius:10px;color:black;">
        <input name="username" placeholder="Usuario" style="width:100%;margin-bottom:10px;"><br>
        <input type="password" name="password" placeholder="Contraseña" style="width:100%;margin-bottom:10px;"><br>
        <button type="submit" style="background:#FF8C00;color:white;border:none;padding:10px;width:100%;cursor:pointer;">ENTRAR</button></form></body>'''

# --- PANEL ADMIN: DISEÑO BLOGGER + GADGETS ---
@app.route('/admin', methods=['GET', 'POST'])
@login_required
@csrf.exempt
def admin():
    if request.method == 'POST':
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
        return redirect(url_for('admin'))

    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Panel El Farol</title>
        <script src="https://cdn.ckeditor.com/4.22.1/full/ckeditor.js"></script>
        <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 0; display: flex; background: #f4f7f6; }
            .sidebar { width: 260px; background: #003366; color: white; height: 100vh; position: fixed; padding-top: 20px; }
            .sidebar a { display: block; color: white; padding: 15px; text-decoration: none; border-bottom: 1px solid #004080; }
            .sidebar a:hover { background: #FF8C00; }
            .main { margin-left: 260px; padding: 30px; width: 100%; }
            .card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
            th { text-align: left; background: #eee; padding: 10px; }
            td { padding: 10px; border-bottom: 1px solid #eee; }
        </style>
    </head>
    <body>
        <div class="sidebar">
            <h2 style="text-align:center; font-family:Impact;">🏮 EL FAROL</h2>
            <a href="#">📝 Entradas</a>
            <a href="#">📊 Estadísticas</a>
            <a href="#">💬 Comentarios</a>
            <a href="#">🎨 Diseño / Gadgets</a>
            <a href="/logout" style="margin-top:50px; color:#ff6666;">Cerrar Sesión</a>
        </div>
        <div class="main">
            <div class="grid">
                <div class="card">
                    <h2 style="font-family:Impact; color:#003366;">NUEVA ENTRADA</h2>
                    <form method="post">
                        <input type="text" name="titulo" placeholder="Título de la noticia" style="width:100%; padding:10px; margin-bottom:15px;" required>
                        <textarea name="contenido" id="editor_pro"></textarea>
                        <script>CKEDITOR.replace('editor_pro', { height: 350, versionCheck: false });</script>
                        <button type="submit" style="background:#FF8C00; color:white; width:100%; padding:15px; border:none; margin-top:15px; font-family:Impact; font-size:1.2em; cursor:pointer;">🚀 PUBLICAR</button>
                    </form>
                </div>
                <div class="card">
                    <h3 style="font-family:Impact;">📦 GADGETS Y SEO</h3>
                    <input type="text" name="imagen_url" placeholder="URL Imagen (Blur 20%)" style="width:100%; padding:8px; margin-bottom:10px;">
                    <input type="text" name="video_url" placeholder="URL Video (Youtube)" style="width:100%; padding:8px; margin-bottom:10px;">
                    <input type="text" name="keywords" placeholder="Keywords: Nacional, Viral, MXL" style="width:100%; padding:8px;">
                    <hr>
                    <h4>📈 RESUMEN DE VISTAS</h4>
                    <div style="font-size:0.9em;">
                        ''' + "".join([f'<div style="display:flex; justify-content:space-between; margin-bottom:5px;"><span>{n.titulo[:30]}...</span><b>👁️ {n.vistas}</b></div>' for n in noticias[:5]]) + '''
                    </div>
                </div>
            </div>
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
