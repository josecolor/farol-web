import os, re
from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from functools import wraps
from unicodedata import normalize

app = Flask(__name__)

# --- CONFIGURACIÓN DE RUTAS Y DB ---
basedir = os.path.abspath(os.path.dirname(__file__))
db_path = os.path.join(basedir, 'noticias.db')
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'el_farol_mxl_2026_secreto')
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'connect_args': {'check_same_thread': False}
}

# --- CREDENCIALES ---
ADMIN_USER = os.environ.get('ADMIN_USER', 'director')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'farol2026')

db = SQLAlchemy(app)

# --- SEO: GENERADOR DE URLS AMIGABLES (SLUGS) ---
def slugify(text):
    text = normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')

class Noticia(db.Model):
    __tablename__ = 'noticia'
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(200), unique=True)
    contenido = db.Column(db.Text, nullable=False)
    protagonista = db.Column(db.String(100))
    ciudad = db.Column(db.String(100))
    categoria = db.Column(db.String(50), default='Nacional')
    imagen_url = db.Column(db.String(300))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

# --- INICIALIZACIÓN DE LA BASE DE DATOS ---
with app.app_context():
    # db.drop_all() # <-- LÍNEA DESACTIVADA: Ya no se borrarán tus noticias al reiniciar.
    db.create_all()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

# --- RUTAS ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if (request.form.get('usuario') == ADMIN_USER and
                request.form.get('password') == ADMIN_PASS):
            session['logged_in'] = True
            return redirect(url_for('admin'))
        flash('Usuario o contraseña incorrectos')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

@app.route('/')
def index():
    try:
        noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    except Exception as e:
        print(f"Error BD: {e}")
        noticias = []
    return render_template('index.html', noticias=noticias,
                           meta_title="El Farol al Día - Noticias de Mexicali",
                           meta_desc="Últimas noticias de Mexicali, Baja California y México.")

@app.route('/noticia/<slug>')
def noticia_slug(slug):
    nota = Noticia.query.filter_by(slug=slug).first_or_404()
    return render_template('noticia.html', noticia=nota,
                           meta_title=nota.titulo + " - El Farol al Día",
                           meta_desc=nota.contenido[:150])

@app.route('/admin', methods=['GET', 'POST'])
@login_required
def admin():
    if request.method == 'POST':
        titulo = request.form.get('titulo')
        base_slug = slugify(titulo)
        slug = base_slug
        contador = 1
        # Evita duplicados de slug
        while Noticia.query.filter_by(slug=slug).first():
            slug = f"{base_slug}-{contador}"
            contador += 1
        
        nueva_nota = Noticia(
            titulo=titulo,
            slug=slug,
            contenido=request.form.get('contenido'),
            protagonista=request.form.get('protagonista'),
            ciudad=request.form.get('ciudad'),
            categoria=request.form.get('categoria'),
            imagen_url=request.form.get('imagen_url')
        )
        db.session.add(nueva_nota)
        db.session.commit()
        flash('Noticia publicada correctamente')
        return redirect(url_for('admin'))
    
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias)

@app.route('/admin/elim
