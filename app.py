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

# --- BASE DE DATOS CON ESTADÍSTICAS (TIPO BLOGGER) ---
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
    vistas = db.Column(db.Integer, default=0) # <--- CONTADOR DE VISTAS (Blogger Style)
    fecha = db.Column(db.DateTime, default=datetime.utcnow)
    slug = db.Column(db.String(260), unique=True)

    def generate_slug(self):
        self.slug = re.sub(r'[^a-z0-9]+', '-', self.titulo.lower()).strip('-')

with app.app_context():
    db.create_all()

# --- SEGURIDAD ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- RUTAS ---
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
        <input name="username" placeholder="Usuario"><br><input type="password" name="password" placeholder="Clave"><br>
        <button type="submit" style="background:#FF8C00;color:white;border:none;padding:10px;width:100%;">ENTRAR</button></form></body>'''

# --- PANEL DE ADMINISTRACIÓN INTEGRADO (CON ESTADÍSTICAS) ---
@app.route('/admin', methods=['GET', 'POST'])
@login_required
@csrf.exempt
def admin():
    if request.method == 'POST':
        # Limpieza de contenido para iconos
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
        return redirect(url_for('admin')) # Regresa al admin para ver la lista

    # Cargamos noticias para mostrar estadísticas abajo (como en su captura de Blogger)
    lista_noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Panel de Control - El Farol</title>
        <script src="https://cdn.ckeditor.com/4.22.1/full/ckeditor.js"></script>
        <style>
            body { font-family: sans-serif; background: #f0f2f5; margin: 0; display: flex; }
            .sidebar { width: 250px; background: #003366; color: white; height: 100vh; padding: 20px; position: fixed; }
            .main-content { margin-left: 290px; padding: 20px; width: 100%; }
            .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .stat-box { display: flex; justify-content: space-between; border-bottom: 1px solid #eee; padding: 10px 0; }
            .btn-pub { background: #FF8C00; color: white; padding: 15px; border: none; width: 100%; font-family: Impact; cursor: pointer; font-size: 1.2em; border-radius: 5px; }
        </style>
    </head>
    <body>
        <div class="sidebar">
            <h2 style="font-family:Impact;">🏮 EL FAROL</h2>
            <p>📊 Estadísticas</p>
            <p>📝 Entradas</p>
            <p>🎨 Diseño (Gadgets)</p>
            <p>⚙️ Configuración</p>
            <hr>
            <a href="/logout" style="color:#ff4444; text-decoration:none;">Cerrar Sesión</a>
        </div>

        <div class="main-content">
            <div class="card">
                <h3 style="border-bottom: 2px solid #FF8C00; padding-bottom: 10px;">CREAR NUEVA ENTRADA</h3>
                <form method="post">
                    <input type="text" name="titulo" placeholder="TÍTULO IMPACTANTE" style="width:100%; padding:10px; margin-bottom:10px;" required>
                    <input type="text" name="imagen_url" placeholder="URL Foto (Blur 20%)" style="width:48%; padding:10px;">
                    <input type="text" name="video_url" placeholder="URL Video" style="width:48%; padding:10px;">
                    <input type="text" name="keywords" placeholder="Keywords (SEO)" style="width:100%; padding:10px; margin:10px 0;">
                    <textarea name="contenido" id="editor_pro"></textarea>
                    <script>CKEDITOR.replace('editor_pro', { height: 300, versionCheck: false });</script>
                    <button type="submit" class="btn-pub">🚀 PUBLICAR AHORA</button>
                </form>
            </div>

            <div class="card">
                <h3>📈 ESTADÍSTICAS DE ENTRADAS RECIENTES</h3>
                <div style="background: #fafafa; padding: 10px; border-radius: 5px;">
                    ''' + "".join([f'<div class="stat-box"><span>{n.titulo[:50]}...</span> <b>👁️ {n.vistas} vistas</b></div>' for n in lista_noticias]) + '''
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
