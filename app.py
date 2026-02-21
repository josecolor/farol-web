import os, re  # Fixed: Lowercase 'import' to prevent startup crash
from flask import (Flask, render_template, request, redirect,
                   url_for, session, flash, send_from_directory)
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from functools import wraps
from unicodedata import normalize
from werkzeug.utils import secure_filename

app = Flask(__name__)

# ── CONFIGURATION & SECURITY ──
UPLOAD_FOLDER = os.path.join('static', 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'avi'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'el_farol_mxl_2026_secreto')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Dynamic Database Configuration for Railway (PostgreSQL) or Local (SQLite)
DATABASE_URL = os.environ.get('DATABASE_URL', '')
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL or \
    f"sqlite:///{os.path.join(os.path.abspath(os.path.dirname(__file__)), 'noticias.db')}"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
db = SQLAlchemy(app)

# ── DATA MODEL (STABLE ARCHITECTURE) ──
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
    autor           = db.Column(db.String(100), default='Redacción')
    fecha           = db.Column(db.DateTime, default=datetime.utcnow)
    publicada       = db.Column(db.Boolean, default=True)

with app.app_context():
    db.create_all()

# ── MASTER UTILITIES ──
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

# ── SEO & SYSTEM ROUTES ──
@app.route('/sitemap.xml')
def sitemap():
    noticias = Noticia.query.filter_by(publicada=True).all()
    base = request.host_url.rstrip('/')
    urls = [f"<url><loc>{base}/</loc><priority>1.0</priority></url>"]
    for n in noticias:
        urls.append(f"<url><loc>{base}/noticia/{n.slug}</loc><lastmod>{n.fecha.strftime('%Y-%m-%d')}</lastmod></url>")
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{"".join(urls)}</urlset>'
    return app.response_class(xml, mimetype='application/xml')

@app.route('/robots.txt')
def robots():
    base = request.host_url.rstrip('/')
    return app.response_class(
        f"User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: {base}/sitemap.xml",
        mimetype='text/plain')

# ── PUBLIC ROUTES ──
@app.route('/')
def index():
    categoria = request.args.get('categoria')
    query = Noticia.query.filter_by(publicada=True)
    if categoria:
        query = query.filter_by(categoria=categoria)
    noticias = query.order_by(Noticia.fecha.desc()).all()
    categorias = [c[0] for c in db.session.query(Noticia.categoria).filter(
        Noticia.categoria != None).distinct().all()]
    return render_template('index.html', noticias=noticias,
                           categorias=categorias, categoria_activa=categoria)

@app.route('/noticia/<slug>')
def noticia_slug(slug):
    nota = Noticia.query.filter_by(slug=slug, publicada=True).first_or_404()
    relacionadas = Noticia.query.filter(
        Noticia.categoria == nota.categoria,
        Noticia.id != nota.id,
        Noticia.publicada == True
    ).limit(3).all()
    return render_template('noticia.html', noticia=nota, relacionadas=relacionadas)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# ── AUTHENTICATION ──
@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'):
        return redirect(url_for('admin'))
    if request.method == 'POST':
        user_env = os.environ.get('ADMIN_USER', 'director')
        pass_env = os.environ.get('ADMIN_PASS', 'farol2026')
        if (request.form.get('usuario') == user_env and
                request.form.get('password') == pass_env):
            session['logged_in'] = True
            return redirect(url_for('admin'))
        flash('Credenciales incorrectas.', 'danger')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# ── ADMIN PANEL (EDITOR MAESTRO SYNC) ──
@app.route('/admin', methods=['GET', 'POST'])
@login_required
def admin():
    if request.method == 'POST':
        titulo = request.form.get('titulo', '').strip()
        ciudad = request.form.get('ciudad', 'Mexicali').strip()
        protagonista = request.form.get('protagonista', 'N/A').strip()
        contenido = request.form.get('contenido', '')
        multimedia_url = request.form.get('multimedia', '')
        
        if not titulo:
            flash('El título es obligatorio.', 'danger')
            return redirect(url_for('admin'))

        # Media Handling (Upload vs URL)
        tipo = 'imagen'
        file = request.files.get('archivo')
        if file and file.filename and allowed_file(file.filename):
            base, ext = os.path.splitext(secure_filename(file.filename))
            filename = f"{base}_{int(datetime.utcnow().timestamp())}{ext}"
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            multimedia_url = filename
            if ext.lower().lstrip('.') in {'mp4', 'mov', 'avi'}:
                tipo = 'video'

        # SEO-Driven Slug (City + Title)
        base_slug = slugify(f"{ciudad} {titulo}")
        slug, counter = base_slug, 1
        while Noticia.query.filter_by(slug=slug).first():
            slug = f"{base_slug}-{counter}"
            counter += 1

        # Save to DB (Mapping City/Protagonist to Resumen field for SEO)
        resumen_seo = f"{ciudad} | {protagonista}"
        
        db.session.add(Noticia(
            titulo=titulo, 
            slug=slug,
            resumen=resumen_seo,
            contenido=contenido,
            multimedia_url=multimedia_url, 
            tipo_multimedia=tipo,
            categoria=request.form.get('categoria', 'Nacional').strip() or 'Nacional',
            autor=request.form.get('autor', 'Redacción').strip(),
            publicada=True
        ))
        db.session.commit()
        flash('Noticia lanzada al aire con éxito.', 'success')
        return redirect(url_for('admin'))

    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias)

@app.route('/admin/eliminar/<int:id>', methods=['POST'])
@login_required
def eliminar(id):
    nota = Noticia.query.get_or_404(id)
    if nota.multimedia_url and not nota.multimedia_url.startswith('http'):
        ruta = os.path.join(app.config['UPLOAD_FOLDER'], nota.multimedia_url)
        if os.path.exists(ruta):
            os.remove(ruta)
    db.session.delete(nota)
    db.session.commit()
    flash('Noticia eliminada del sistema.', 'info')
    return redirect(url_for('admin'))

@app.route('/admin/editar/<int:id>', methods=['GET', 'POST'])
@login_required
def editar(id):
    nota = Noticia.query.get_or_404(id)
    if request.method == 'POST':
        nota.titulo    = request.form.get('titulo', nota.titulo).strip()
        nota.contenido = request.form.get('contenido', nota.contenido)
        nota.autor     = request.form.get('autor', nota.autor).strip()
        
        file = request.files.get('archivo')
        if file and file.filename and allowed_file(file.filename):
            base, ext = os.path.splitext(secure_filename(file.filename))
            filename = f"{base}_{int(datetime.utcnow().timestamp())}{ext}"
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            nota.multimedia_url  = filename
            nota.tipo_multimedia = 'video' if ext.lower().lstrip('.') in {'mp4','mov','avi'} else 'imagen'
        
        db.session.commit()
        flash('Cambios guardados.', 'success')
        return redirect(url_for('admin'))
    return render_template('editar.html', noticia=nota)
