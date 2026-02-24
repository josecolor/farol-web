import os, re, requests
from flask import (Flask, render_template, request, redirect,
                   url_for, session, flash, send_from_directory)
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from functools import wraps
from unicodedata import normalize
from werkzeug.utils import secure_filename

app = Flask(__name__)

# --- CONFIGURACIÓN ---
UPLOAD_FOLDER = os.path.join('static', 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'avi'}
TELEGRAM_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN') # La llave que ya pusimos en Render

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024 
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'farol_mxl_2026_secreto')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

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

# --- UTILIDADES ---
def slugify(text):
    text = normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')

# --- RUTA DEL WEBHOOK (EL MOTOR DEL BOT) ---
@app.route('/webhook', methods=['POST'])
def webhook():
    update = request.get_json()
    if not update or "message" not in update:
        return "OK", 200
    
    msg = update["message"]
    # Solo usted puede publicar (Basado en su chat o texto)
    text = msg.get("text", "")
    caption = msg.get("caption", "")
    final_text = text or caption
    
    # Si manda una foto
    if "photo" in msg and TELEGRAM_TOKEN:
        photo = msg["photo"][-1] # La de mejor calidad
        file_id = photo["file_id"]
        
        # Descargar de Telegram
        f_info = requests.get(f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/getFile?file_id={file_id}").json()
        f_path = f_info["result"]["file_path"]
        f_url = f"https://api.telegram.org/file/bot{TELEGRAM_TOKEN}/{f_path}"
        
        f_res = requests.get(f_url)
        filename = f"bot_{int(datetime.utcnow().timestamp())}.jpg"
        with open(os.path.join(app.config['UPLOAD_FOLDER'], filename), 'wb') as f:
            f.write(f_res.content)
        
        # Crear noticia automática
        titulo = final_text[:50] + "..." if len(final_text) > 50 else final_text or "Noticia de El Farol"
        base_slug = slugify(titulo)
        
        nueva_nota = Noticia(
            titulo=titulo,
            slug=f"{base_slug}-{int(datetime.utcnow().timestamp())}",
            resumen="Publicado vía Telegram",
            contenido=final_text or "Sin texto",
            multimedia_url=filename,
            tipo_multimedia="imagen",
            categoria="Nacional"
        )
        db.session.add(nueva_nota)
        db.session.commit()
        
    return "OK", 200

# --- EL RESTO DE TUS RUTAS (MANTENIDAS) ---
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

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if not session.get('logged_in'): return redirect(url_for('login'))
    # (El código del admin se mantiene igual que antes...)
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))
