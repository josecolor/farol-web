import os
import re
import bleach
from functools import wraps
from datetime import datetime
from werkzeug.security import check_password_hash, generate_password_hash
from flask import Flask, render_template, request, redirect, url_for, session, flash, abort
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)
# Seguridad: Usa la variable de entorno o una clave por defecto para evitar errores de inicio
app.secret_key = os.getenv("SECRET_KEY", "farol_mxl_2026_oficial_master_key")

csrf = CSRFProtect(app)

# Rate Limiting: Protege contra ataques de fuerza bruta
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["500 per day", "100 per hour"]
)

# --- BASE DE DATOS PROFESIONAL ---
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'pool_pre_ping': True, 'pool_recycle': 300}
db = SQLAlchemy(app)

# Modelo de Usuario con encriptación
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

# Modelo de Noticia con SEO Mantra Automático
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(250), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    imagen_url = db.Column(db.String(500))
    video_url = db.Column(db.String(500))
    keywords = db.Column(db.String(200))
    vistas = db.Column(db.Integer, default=0)
    fecha = db.Column(db.DateTime, default=datetime.utcnow)
    slug = db.Column(db.String(260), unique=True, nullable=False)
    meta_description = db.Column(db.String(160))
    seo_mantra_applied = db.Column(db.Boolean, default=False)
    
    def generate_slug(self):
        base_slug = re.sub(r'[^a-z0-9]+', '-', self.titulo.lower()).strip('-')
        self.slug = base_slug
        # Evita duplicados agregando un contador si el slug ya existe
        counter = 1
        while Noticia.query.filter_by(slug=self.slug).first():
            self.slug = f"{base_slug}-{counter}"
            counter += 1
    
    def inject_seo_mantra(self, mantra):
        if not self.seo_mantra_applied and mantra:
            current = self.keywords or ""
            self.keywords = f"{mantra}, {current}" if current else mantra
            self.seo_mantra_applied = True

# Configuración Global
class Config(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sitio_nombre = db.Column(db.String(100), default="El Farol")
    seo_mantra = db.Column(db.String(100), default="seoacuerdate mxl")
    google_analytics = db.Column(db.String(100))
    meta_author = db.Column(db.String(100), default="El Farol Editorial")

# --- SEGURIDAD Y DECORADORES ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            flash('Acceso restringido. Inicie sesión.', 'warning')
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- RUTAS PÚBLICAS ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).limit(10).all()
    conf = Config.query.first()
    return render_template('index.html', noticias=noticias, conf=conf)

@app.route('/login', methods=['GET', 'POST'])
@limiter.limit("10 per minute")
@csrf.exempt # Exento para facilitar el login inicial sin errores de token
def login():
    if request.method == 'POST':
        user = Usuario.query.filter_by(username=request.form.get('username')).first()
        if user and user.check_password(request.form.get('password')):
            session['user_id'] = user.id
            return redirect(url_for('admin_panel'))
        flash('Datos incorrectos', 'danger')
    return render_template('login.html')

# --- PANEL ADMINISTRATIVO (DISEÑO WORDPRESS) ---
@app.route('/admin')
@login_required
def admin_panel():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    conf = Config.query.first()
    # Retornamos el diseño estilo WordPress que unifica todo
    return render_template('admin_dashboard.html', noticias=noticias, conf=conf)

@app.route('/admin/nueva', methods=['GET', 'POST'])
@login_required
@csrf.exempt
def nueva_noticia():
    conf = Config.query.first()
    if request.method == 'POST':
        nueva = Noticia(
            titulo=request.form.get('titulo'),
            contenido=bleach.clean(request.form.get('contenido'), tags=['p','br','strong','em','u','h1','h2','h3','img','iframe'], attributes={'*':['style','class'],'img':['src'],'iframe':['src']}, strip=False),
            imagen_url=request.form.get('imagen_url'),
            keywords=request.form.get('keywords'),
            meta_description=request.form.get('meta_description')
        )
        nueva.generate_slug()
        nueva.inject_seo_mantra(conf.seo_mantra)
        db.session.add(nueva)
        db.session.commit()
        flash('¡Publicado con éxito!', 'success')
        return redirect(url_for('admin_panel'))
    return render_template('admin_nueva.html', conf=conf)

@app.route('/configuracion', methods=['GET', 'POST'])
@login_required
@csrf.exempt
def configuracion():
    conf = Config.query.first()
    if request.method == 'POST':
        conf.sitio_nombre = request.form.get('sitio_nombre')
        conf.seo_mantra = request.form.get('seo_mantra')
        db.session.commit()
        flash('Configuración guardada', 'success')
        return redirect(url_for('configuracion'))
    return render_template('admin_config.html', conf=conf)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# --- INICIALIZACIÓN ---
def init_db():
    with app.app_context():
        db.create_all()
        if not Config.query.first():
            db.session.add(Config())
        if not Usuario.query.filter_by(username='director').first():
            admin = Usuario(username='director')
            admin.set_password('farol2026')
            db.session.add(admin)
        db.session.commit()

if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
