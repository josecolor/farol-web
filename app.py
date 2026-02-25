from flask import Flask, render_template_string, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import os
from functools import lru_cache

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'farol_ultra_final_2026')

# --- CONFIGURACIÓN DE BASE DE DATOS ---
uri = os.environ.get('DATABASE_URL')
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = uri or 'sqlite:///temp.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "pool_size": 2,
    "max_overflow": 0,
    "pool_timeout": 15,
    "pool_recycle": 600,
    "pool_pre_ping": True,
}

db = SQLAlchemy(app)

# --- MODELOS ---
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(50), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password = db.Column(db.String(200), nullable=False)
    es_staff = db.Column(db.Boolean, default=False, index=True)

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(150), nullable=False)
    resumen = db.Column(db.Text, nullable=False)
    imagen_url = db.Column(db.String(300))
    location = db.Column(db.String(50), nullable=False)
    autor = db.Column(db.String(50), nullable=False)
    date = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    comentarios = db.relationship('Comentario', backref='noticia', lazy='dynamic', cascade='all, delete-orphan')

class Comentario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    texto = db.Column(db.String(300), nullable=False)
    autor_nombre = db.Column(db.String(50), nullable=False)
    noticia_id = db.Column(db.Integer, db.ForeignKey('noticia.id'), nullable=False)

# Crear tablas con manejo de errores para que Railway no se caiga al inicio
with app.app_context():
    try:
        db.create_all()
    except Exception as e:
        print(f"Esperando base de datos... {e}")

# --- DISEÑO CACHEADO ---
@lru_cache(maxsize=1)
def get_template():
    return '''
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
        <title>FAROL AL DÍA</title>
        <style>
            body { background:#000; color:#eee; font-family:sans-serif; margin:0; padding-bottom:30px; }
            header { border-bottom:4px solid #ff8c00; padding:15px; text-align:center; background:#0a0a0a; position:sticky; top:0; z-index:100; }
            h1 { color:#ff8c00; font-family:Impact; margin:0; font-size:1.8rem; }
            .nav { margin-top:8px; font-size:0.75rem; }
            .nav a { color:#ff8c00; text-decoration:none; padding:5px 10px; border:1px solid #333; border-radius:20px; margin:0 3px; }
            .container { max-width:500px; margin:auto; padding:10px; }
            .card { background:#111; border-radius:12px; margin-bottom:25px; border:1px solid #222; overflow:hidden; }
            .img-news { width:100%; height:auto; display:block; background:#1a1a1a; }
            .content { padding:15px; }
            .meta { color:#ff8c00; font-size:0.7rem; font-weight:bold; }
            h2 { margin:8px 0; font-size:1.3rem; color:#fff; }
            .com-box { background:#0a0a0a; padding:12px; border-top:1px solid #222; }
            .com-item { font-size:0.8rem; margin-bottom:6px; border-bottom:1px solid #1a1a1a; padding-bottom:4px; }
            .com-item b { color:#ff8c00; }
            .in-com { background:#1a1a1a; border:1px solid #333; color:#fff; padding:8px; border-radius:6px; flex:1; }
            .btn-com { background:#ff8c00; border:none; padding:8px 12px; border-radius:6px; font-weight:bold; }
        </style>
    </head>
    <body>
        <header>
            <h1>🏮 FAROL AL DÍA</h1>
            <div class="nav">
                {% if user_id %}
                    <span>👤 {{ user_nombre }}</span> |
                    {% if es_staff %}<a href="/panel" style="background:#ff8c00;color:#000">REDACTAR</a>{% endif %}
                    <a href="/logout">SALIR</a>
                {% else %}
                    <a href="/login">ENTRAR</a> <a href="/register">UNIRSE</a>
                {% endif %}
            </div>
        </header>
        <div class="container">
            {% for n in noticias %}
            <div class="card">
                {% if n.imagen_url %}<img src="{{ n.imagen_url }}" class="img-news" loading="lazy">{% endif %}
                <div class="content">
                    <div class="meta">📍 {{ n.location }} | POR: {{ n.autor }}</div>
                    <h2>{{ n.titulo }}</h2>
                    <div style="color:#ccc; font-size:0.9rem; line-height:1.4;">{{ n.resumen|safe }}</div>
                </div>
                <div class="com-box">
                    {% for c in n.comentarios %}
                        <div class="com-item"><b>{{ c.autor_nombre }}:</b> {{ c.texto }}</div>
                    {% endfor %}
                    {% if user_id %}
                        <form action="/comentar/{{ n.id }}" method="post" style="display:flex;gap:5px;">
                            <input type="text" name="texto" class="in-com" placeholder="Escribe..." required>
                            <button type="submit" class="btn-com">OK</button>
                        </form>
                    {% endif %}
                </div>
            </div>
            {% endfor %}
        </div>
    </body>
    </html>
    '''

# --- RUTAS ---
@app.route('/')
def index():
    try:
        noticias = Noticia.query.order_by(Noticia.date.desc()).limit(15).all()
        return render_template_string(get_template(), noticias=noticias, user_id=session.get('user_id'), user_nombre=session.get('user_nombre'), es_staff=session.get('es_staff'))
    except:
        return "<body style='background:#000;color:#ff8c00;text-align:center;padding:50px;'><h2>🏮 FAROL AL DÍA</h2><p>Conectando con el Bosque... Recarga en 10 segundos.</p></body>"

@app.route('/comentar/<int:noticia_id>', methods=['POST'])
def comentar(noticia_id):
    if 'user_id' in session:
        nuevo = Comentario(texto=request.form.get('texto')[:300], autor_nombre=session['user_nombre'], noticia_id=noticia_id)
        db.session.add(nuevo)
        db.session.commit()
    return redirect(url_for('index'))

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        email = request.form.get('email').lower().strip()
        # REPORTEROS AUTORIZADOS
        staff_list = ["hsy@elfarol.com", "reportero2@elfarol.com"]
        es_staff = email in staff_list
        
        pw = generate_password_hash(request.form.get('password'), method='pbkdf2:sha256')
        u = Usuario(nombre=request.form.get('nombre')[:50], email=email, password=pw, es_staff=es_staff)
        db.session.add(u)
        db.session.commit()
        return redirect('/login')
    return '<body style="background:#000;color:#fff;padding:20px;"><form method="post"><h2>Registro</h2><input name="nombre" placeholder="Nombre" required style="width:100%;padding:10px;margin-bottom:10px;"><br><input name="email" type="email" placeholder="Email" required style="width:100%;padding:10px;margin-bottom:10px;"><br><input type="password" name="password" placeholder="Contraseña" required style="width:100%;padding:10px;margin-bottom:10px;"><br><button style="width:100%;padding:10px;background:#ff8c00;">UNIRSE</button></form></body>'

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        u = Usuario.query.filter_by(email=request.form.get('email').lower().strip()).first()
        if u and check_password_hash(u.password, request.form.get('password')):
            session['user_id'] = u.id
            session['user_nombre'] = u.nombre
            session['es_staff'] = u.es_staff
            return redirect('/')
    return '<body style="background:#000;color:#fff;padding:20px;"><form method="post"><h2>Entrar</h2><input name="email" type="email" placeholder="Email" required style="width:100%;padding:10px;margin-bottom:10px;"><br><input type="password" name="password" placeholder="Pass" required style="width:100%;padding:10px;margin-bottom:10px;"><br><button style="width:100%;padding:10px;background:#ff8c00;">ENTRAR</button></form></body>'

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/')

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if not session.get('es_staff'): return "Acceso denegado", 403
    if request.method == 'POST':
        n = Noticia(titulo=request.form.get('titulo'), resumen=request.form.get('resumen'), imagen_url=request.form.get('imagen_url'), location=request.form.get('location'), autor=session['user_nombre'])
        db.session.add(n)
        db.session.commit()
        return redirect('/')
    return '<body style="background:#000;color:#fff;padding:20px;"><form method="post"><h2>Redacción</h2><input name="titulo" placeholder="Título" required style="width:100%;padding:10px;"><br><input name="location" placeholder="📍 Ubicación" required style="width:100%;padding:10px;"><br><input name="imagen_url" placeholder="URL Foto" style="width:100%;padding:10px;"><br><textarea name="resumen" placeholder="Contenido" style="width:100%;height:150px;"></textarea><br><button style="width:100%;padding:15px;background:#ff8c00;font-weight:bold;">PUBLICAR</button></form></body>'

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))
