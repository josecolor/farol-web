import os, re
from flask import (Flask, render_template, request, redirect,
                   url_for, session, flash, send_from_directory)
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from functools import wraps
from unicodedata import normalize
from werkzeug.utils import secure_filename

app = Flask(__name__)

# --- CONFIGURACIÓN PARA NUBE (RAILWAY) ---
# Recomendación: Static/uploads es la ruta más segura para persistencia temporal.
UPLOAD_FOLDER = os.path.join('static', 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'avi'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024 
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'el_farol_mxl_2026_secreto')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Base de Datos Adaptable
DATABASE_URL = os.environ.get('DATABASE_URL', '')
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL or \
    f"sqlite:///{os.path.join(os.path.abspath(os.path.dirname(__file__)), 'noticias.db')}"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
db = SQLAlchemy(app)

# --- MODELO DE DATOS ---
class Noticia(db.Model):
    __tablename__ = 'noticias'
    id              = db.Column(db.Integer, primary_key=True)
    titulo          = db.Column(db.String(200), nullable=False)
    slug            = db.Column(db.String(220), unique=True, nullable=False)
    resumen         = db.Column(db.String(300))
    contenido       = db.Column(db.Text, nullable=False)
    multimedia_url  = db.Column(db.String(400))
    tipo_multimedia = db.Column(db.String(10))
    categoria       = db.Column(db.String(80))
    autor           = db.Column(db.String(100), default='Redacción El Farol')
    fecha           = db.Column(db.DateTime, default=datetime.utcnow)
    publicada       = db.Column(db.Boolean, default=True)

with app.app_context():
    db.create_all()

# --- UTILIDADES EDITORIALES (SEO MXL) ---
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

# --- RUTAS PÚBLICAS ---
@app.route('/')
def index():
    categoria = request.args.get('categoria')
    query = Noticia.query.filter_by(publicada=True)
    if categoria: query = query.filter_by(categoria=categoria)
    noticias = query.order_by(Noticia.fecha.desc()).all()
    categorias = [c[0] for c in db.session.query(Noticia.categoria).filter(Noticia.categoria != None).distinct().all()]
    return render_template('index.html', noticias=noticias, categorias=categorias, categoria_activa=categoria)

@app.route('/noticia/<slug>')
def noticia_slug(slug):
    nota = Noticia.query.filter_by(slug=slug, publicada=True).first_or_404()
    return render_template('noticia.html', noticia=nota)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# --- ACCESO ADMINISTRATIVO ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'): return redirect(url_for('admin'))
    if request.method == 'POST':
        u = os.environ.get('ADMIN_USER', 'director')
        p = os.environ.get('ADMIN_PASS', 'farol2026')
        if (request.form.get('usuario') == u and request.form.get('password') == p):
            session['logged_in'] = True
            return redirect(url_for('admin'))
        flash('Acceso denegado.', 'danger')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

@app.route('/admin', methods=['GET', 'POST'])
@login_required
def admin():
    if request.method == 'POST':
        titulo = request.form.get('titulo', '').strip()
        ciudad = request.form.get('ciudad', 'Mexicali').strip()
        protagonista = request.form.get('protagonista', 'General').strip()
        contenido = request.form.get('contenido', '')
        
        if not titulo or not contenido:
            flash('Datos incompletos.', 'danger')
            return redirect(url_for('admin'))

        # Manejo de Archivos
        multimedia_url = request.form.get('multimedia', '')
        tipo = 'imagen'
        file = request.files.get('archivo')
        if file and file.filename and allowed_file(file.filename):
            base, ext = os.path.splitext(secure_filename(file.filename))
            filename = f"{base}_{int(datetime.utcnow().timestamp())}{ext}"
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            multimedia_url = filename
            if ext.lower().lstrip('.') in {'mp4', 'mov', 'avi'}: tipo = 'video'

        # SEO Slug Automático (Ciudad-Titulo)
        base_slug = slugify(f"{ciudad} {titulo}")
        slug, counter = base_slug, 1
        while Noticia.query.filter_by(slug=slug).first():
            slug = f"{base_slug}-{counter}"
            counter += 1

        db.session.add(Noticia(
            titulo=titulo, slug=slug, resumen=f"{ciudad} | {protagonista}",
            contenido=contenido, multimedia_url=multimedia_url, 
            tipo_multimedia=tipo, categoria=request.form.get('categoria', 'Nacional')
        ))
        db.session.commit()
        flash('Publicado.', 'success')
        return redirect(url_for('admin'))
    
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias)

@app.route('/admin/eliminar/<int:id>', methods=['POST'])
@login_required
def eliminar(id):
    nota = Noticia.query.get_or_404(id)
    db.session.delete(nota)
    db.session.commit()
    return redirect(url_for('admin'))

# Recomendación: Dejar el inicio del servidor al Procfile.
# Solo se incluye este bloque para compatibilidad en pruebas locales.
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
