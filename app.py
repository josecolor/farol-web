from flask import Flask, render_template_string, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import os

app = Flask(__name__)
# Llave maestra optimizada
app.secret_key = os.environ.get('SECRET_KEY', 'farol_fuerza_2026')

# --- CONEXIÓN OPTIMIZADA ---
uri = os.environ.get('DATABASE_URL')
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
# Añadimos límites para no saturar el servidor
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {"pool_pre_ping": True, "pool_recycle": 280}

db = SQLAlchemy(app)

# --- MODELOS ---
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100))
    email = db.Column(db.String(120), unique=True)
    password = db.Column(db.String(200))
    es_staff = db.Column(db.Boolean, default=False)

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    imagen_url = db.Column(db.String(500))
    location = db.Column(db.String(100))
    autor = db.Column(db.String(100))
    date = db.Column(db.DateTime, default=datetime.utcnow)
    comentarios = db.relationship('Comentario', backref='noticia', lazy='dynamic')

class Comentario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    texto = db.Column(db.Text)
    autor_nombre = db.Column(db.String(100))
    noticia_id = db.Column(db.Integer, db.ForeignKey('noticia.id'))

with app.app_context():
    db.create_all()

# --- VISTA ÚNICA (MÁS RÁPIDA) ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.date.desc()).all()
    return render_template_string('''
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>FAROL AL DÍA</title>
            <style>
                body { background:#000; color:#eee; font-family:sans-serif; margin:0; }
                header { border-bottom:4px solid #ff8c00; padding:15px; text-align:center; background:#0a0a0a; }
                h1 { color:#ff8c00; font-family:Impact; margin:0; font-size:2rem; }
                .nav { margin-top:10px; font-size:0.8rem; }
                .nav a { color:#ff8c00; text-decoration:none; border:1px solid #333; padding:4px 8px; border-radius:4px; }
                .container { max-width:500px; margin:auto; padding:10px; }
                .card { background:#111; border-radius:10px; margin-bottom:20px; border:1px solid #222; overflow:hidden; }
                .img-news { width:100%; height:auto; display:block; }
                .content { padding:15px; }
                .com-section { background:#0a0a0a; padding:10px; border-top:1px solid #222; font-size:0.85rem; }
                .com { margin-bottom:5px; border-bottom:1px solid #1a1a1a; padding-bottom:3px; }
                .com b { color:#ff8c00; }
                input { background:#1a1a1a; border:1px solid #333; color:#fff; padding:5px; border-radius:4px; width:70%; }
                button { background:#ff8c00; border:none; padding:6px; font-weight:bold; border-radius:4px; }
            </style>
        </head>
        <body>
            <header>
                <h1>🏮 FAROL AL DÍA</h1>
                <div class="nav">
                    {% if session.get('user_id') %}
                        <span>Hola, {{ session.user_nombre }}</span> | 
                        {% if session.es_staff %}<a href="/panel">REDACTAR</a> | {% endif %}
                        <a href="/logout">SALIR</a>
                    {% else %}
                        <a href="/login">ENTRAR</a> | <a href="/register">REGISTRARSE</a>
                    {% endif %}
                </div>
            </header>
            <div class="container">
                {% for n in noticias %}
                <div class="card">
                    {% if n.imagen_url %}<img src="{{ n.imagen_url }}" class="img-news">{% endif %}
                    <div class="content">
                        <small style="color:#ff8c00;">📍 {{ n.location }}</small>
                        <h2 style="margin:5px 0; font-size:1.4rem;">{{ n.titulo }}</h2>
                        <div style="color:#ccc;">{{ n.resumen|safe }}</div>
                    </div>
                    <div class="com-section">
                        {% for c in n.comentarios %}
                            <div class="com"><b>{{ c.autor_nombre }}:</b> {{ c.texto }}</div>
                        {% endfor %}
                        {% if session.get('user_id') %}
                            <form action="/comentar/{{ n.id }}" method="post" style="margin-top:10px;">
                                <input type="text" name="texto" placeholder="Comentar..." required>
                                <button type="submit">Enviar</button>
                            </form>
                        {% endif %}
                    </div>
                </div>
                {% endfor %}
            </div>
        </body>
        </html>
    ''', noticias=noticias)

@app.route('/comentar/<int:noticia_id>', methods=['POST'])
def comentar(noticia_id):
    if 'user_id' in session:
        nuevo = Comentario(texto=request.form.get('texto'), 
                           autor_nombre=session['user_nombre'], 
                           noticia_id=noticia_id)
        db.session.add(nuevo)
        db.session.commit()
    return redirect('/')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        email = request.form.get('email')
        pw = generate_password_hash(request.form.get('password'), method='pbkdf2:sha256')
        es_staff = True if email == "hsy@elfarol.com" else False
        u = Usuario(nombre=request.form.get('nombre'), email=email, password=pw, es_staff=es_staff)
        db.session.add(u)
        db.session.commit()
        return redirect('/login')
    return '<body><form method="post"><h2>Registro</h2><input name="nombre" placeholder="Nombre"><br><input name="email" placeholder="Email"><br><input type="password" name="password" placeholder="Pass"><br><button>Unirse</button></form></body>'

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        u = Usuario.query.filter_by(email=request.form.get('email')).first()
        if u and check_password_hash(u.password, request.form.get('password')):
            session['user_id'] = u.id
            session['user_nombre'] = u.nombre
            session['es_staff'] = u.es_staff
            return redirect('/')
    return '<body><form method="post"><h2>Login</h2><input name="email" placeholder="Email"><br><input type="password" name="password" placeholder="Pass"><br><button>Entrar</button></form></body>'

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/')

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if not session.get('es_staff'): return "No staff"
    if request.method == 'POST':
        n = Noticia(titulo=request.form.get('titulo'), resumen=request.form.get('resumen'), 
                    imagen_url=request.form.get('imagen_url'), location=request.form.get('location'), 
                    autor=session['user_nombre'])
        db.session.add(n)
        db.session.commit()
        return redirect('/')
    return '<body><form method="post"><h2>Nueva Noticia</h2><input name="titulo" placeholder="Título"><br><input name="location" placeholder="📍"><br><input name="imagen_url" placeholder="URL Foto"><br><textarea name="resumen"></textarea><br><button>Publicar</button></form></body>'

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))
