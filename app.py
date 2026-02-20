import os, re
from flask import (Flask, render_template, request, redirect,
                   url_for, session, flash, send_from_directory, abort)
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from functools import wraps
from unicodedata import normalize
from werkzeug.utils import secure_filename

app = Flask(__name__)

# ─────────────────────────────────────────
#  CONFIGURACIÓN MULTIMEDIA Y DB
# ─────────────────────────────────────────
UPLOAD_FOLDER = os.path.join('static', 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'avi'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB para videos
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'el_farol_mxl_2026_secreto')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Lógica de Base de Datos: PostgreSQL (Railway) o SQLite (Local)
DATABASE_URL = os.environ.get('DATABASE_URL', '')
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL or \
    f"sqlite:///{os.path.join(os.path.abspath(os.path.dirname(__file__)), 'noticias.db')}"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
db = SQLAlchemy(app)

# ─────────────────────────────────────────
#  MODELO DE DATOS SEO-READY
# ─────────────────────────────────────────
class Noticia(db.Model):
    __tablename__ = 'noticias'
    id               = db.Column(db.Integer, primary_key=True)
    titulo           = db.Column(db.String(200), nullable=False)
    slug             = db.Column(db.String(220), unique=True, nullable=False)
    resumen          = db.Column(db.String(300))          
    contenido        = db.Column(db.Text, nullable=False)
    multimedia_url   = db.Column(db.String(400))
    tipo_multimedia  = db.Column(db.String(10))           # 'imagen' | 'video'
    categoria        = db.Column(db.String(80))
    autor            = db.Column(db.String(100), default='Redacción')
    fecha            = db.Column(db.DateTime, default=datetime.utcnow)
    publicada        = db.Column(db.Boolean, default=True)

with app.app_context():
    db.create_all()

# ─────────────────────────────────────────
#  UTILIDADES Y SEGURIDAD
# ─────────────────────────────────────────
def slugify(text):
    text = normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

# ─────────────────────────────────────────
#  RUTAS PÚBLICAS Y SEO
# ─────────────────────────────────────────
@app.route('/')
def index():
    categoria = request.args.get('categoria')
    query = Noticia.query.filter_by(publicada=True)
    if categoria:
        query = query.filter_by(categoria=categoria)
    noticias = query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

@app.route('/noticia/<slug>')
def noticia_slug(slug):
    nota = Noticia.query.filter_by(slug=slug, publicada=True).first_or_404()
    return render_template('noticia.html', noticia=nota)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/sitemap.xml')
def sitemap():
    noticias = Noticia.query.filter_by(publicada=True).all()
    base = request.host_url.rstrip('/')
    xml = render_template('sitemap.xml', noticias=noticias, base=base)
    return app.response_class(xml, mimetype='application/xml')

# ─────────────────────────────────────────
#  ADMINISTRACIÓN MULTIMEDIA
# ─────────────────────────────────────────
ADMIN_USER = os.environ.get('ADMIN_USER', 'director')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'farol2026')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('usuario') == ADMIN_USER and request.form.get('password') == ADMIN_PASS:
            session['logged_in'] = True
            return redirect(url_for('admin'))
    return render_template('login.html')

@app.route('/admin', methods=['GET', 'POST'])
@login_required
def admin():
    if request.method == 'POST':
        file = request.files.get('archivo')
        filename, tipo = '', 'imagen'
        if file and allowed_file(file.filename):
            ext = file.filename.rsplit('.', 1)[1].lower()
            filename = secure_filename(f"{int(datetime.utcnow().timestamp())}.{ext}")
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            if ext in {'mp4', 'mov', 'avi'}: tipo = 'video'

        titulo = request.form.get('titulo')
        nueva = Noticia(
            titulo=titulo,
            slug=slugify(titulo),
            resumen=request.form.get('resumen'),
            contenido=request.form.get('contenido'),
            multimedia_url=filename,
            tipo_multimedia=tipo,
            categoria=request.form.get('categoria'),
            autor=request.form.get('autor')
        )
        db.session.add(nueva)
        db.session.commit()
        return redirect(url_for('admin'))
    
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# ─────────────────────────────────────────
#  ARRANQUE DINÁMICO (FIX RAILWAY)
# ─────────────────────────────────────────
if __name__ == '__main__':
    # Esto detecta si Railway pide el puerto 8080 o 5000
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
