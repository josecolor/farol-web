from flask import Flask, render_template_string, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'farol_al_dia_interactivo_2026')

# --- CONEXIÓN AL BOSQUE (SUPABASE) ---
uri = os.environ.get('DATABASE_URL')
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- MODELOS ---
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100))
    email = db.Column(db.String(120), unique=True)
    password = db.Column(db.String(200))
    es_staff = db.Column(db.Boolean, default=False)
    comentarios = db.relationship('Comentario', backref='autor_user', lazy=True)

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    imagen_url = db.Column(db.String(500))
    location = db.Column(db.String(100))
    autor = db.Column(db.String(100))
    date = db.Column(db.DateTime, default=datetime.utcnow)
    comentarios = db.relationship('Comentario', backref='noticia_rel', lazy=True)

class Comentario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    texto = db.Column(db.Text, nullable=False)
    fecha = db.Column(db.DateTime, default=datetime.utcnow)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'))
    noticia_id = db.Column(db.Integer, db.ForeignKey('noticia.id'))

with app.app_context():
    db.create_all()

# --- PORTADA CON COMENTARIOS ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.date.desc()).all()
    return render_template_string('''
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>FAROL AL DÍA</title>
            <style>
                body { background: #000; color: #eee; font-family: sans-serif; margin: 0; }
                header { border-bottom: 5px solid #ff8c00; padding: 20px; text-align: center; background: #0a0a0a; }
                h1 { color: #ff8c00; font-family: Impact; margin: 0; }
                .nav { margin: 10px 0; }
                .nav a { color: #ff8c00; text-decoration: none; margin: 0 10px; font-size: 0.9rem; border: 1px solid #333; padding: 5px 10px; border-radius: 5px; }
                .container { max-width: 600px; margin: auto; padding: 15px; }
                .card { background: #111; border-radius: 15px; margin-bottom: 40px; border: 1px solid #222; overflow: hidden; }
                .img-news { width: 100%; display: block; }
                .content { padding: 20px; }
                .comentarios-box { background: #0a0a0a; padding: 15px; border-top: 1px solid #222; }
                .comentario { border-bottom: 1px solid #222; padding: 8px 0; font-size: 0.9rem; }
                .comentario b { color: #ff8c00; }
                input[type="text"] { width: 80%; padding: 8px; background: #1a1a1a; border: 1px solid #333; color: #fff; border-radius: 5px; }
                .btn-com { background: #ff8c00; border: none; padding: 8px 15px; border-radius: 5px; font-weight: bold; cursor: pointer; }
            </style>
        </head>
        <body>
            <header>
                <h1>🏮 FAROL AL DÍA</h1>
                <div class="nav">
                    {% if session.get('user_id') %}
                        <span style="color:#888;">Bienvenido, <b>{{ session.user_nombre }}</b></span>
                        {% if session.get('es_staff') %}<a href="/panel" style="background:#ff8c00; color:#000;">REDACTAR</a>{% endif %}
                        <a href="/logout">SALIR</a>
                    {% else %}
                        <a href="/login">ENTRAR</a> <a href="/register">REGISTRARSE</a>
                    {% endif %}
                </div>
            </header>
            <div class="container">
                {% for n in noticias %}
                <div class="card">
                    {% if n.imagen_url %}<img src="{{ n.imagen_url }}" class="img-news">{% endif %}
                    <div class="content">
                        <small style="color:#ff8c00;">📍 {{ n.location }} | POR: {{ n.autor }}</small>
                        <h2 style="margin:10px 0;">{{ n.titulo }}</h2>
                        <div style="color:#ccc; line-height:1.6;">{{ n.resumen|safe }}</div>
                    </div>
                    
                    <div class="comentarios-box">
                        <h4 style="margin:0 0 10px 0; font-size:0.9rem;">Comentarios ({{ n.comentarios|length }})</h4>
                        {% for c in n.comentarios %}
                        <div class="comentario">
                            <b>{{ c.autor_user.nombre }}:</b> {{ c.texto }}
                        </div>
                        {% endfor %}
                        
                        {% if session.get('user_id') %}
                        <form action="/comentar/{{ n.id }}" method="post" style="margin-top:15px;">
                            <input type="text" name="texto" placeholder="Escribe un comentario..." required>
                            <button type="submit" class="btn-com">Pulsar</button>
                        </form>
                        {% else %}
                        <p style="font-size:0.8rem; color:#555; margin-top:10px;">Inicia sesión para comentar.</p>
                        {% endif %}
                    </div>
                </div>
                {% endfor %}
            </div>
        </body>
        </html>
    ''', noticias=noticias)

# --- RUTA PARA COMENTAR ---
@app.route('/comentar/<int:noticia_id>', methods=['POST'])
def comentar(noticia_id):
    if 'user_id' not in session: return redirect(url_for('login'))
    texto = request.form.get('texto')
    if texto:
        nuevo_com = Comentario(texto=texto, usuario_id=session['user_id'], noticia_id=noticia_id)
        db.session.add(nuevo_com)
        db.session.commit()
    return redirect(url_for('index'))

# --- REGISTRO, LOGIN Y PANEL (IGUAL QUE ANTES PERO CON FILTRO STAFF) ---
@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        email = request.form.get('email')
        pw = generate_password_hash(request.form.get('password'), method='pbkdf2:sha256')
        staff = True if email == "hsy@elfarol.com" else False
        nuevo = Usuario(nombre=request.form.get('nombre'), email=email, password=pw, es_staff=staff)
        db.session.add(nuevo)
        db.session.commit()
        return redirect(url_for('login'))
    return '''<body style="background:#000; color:#fff; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh;">
                <form method="post" style="border:2px solid #ff8c00; padding:30px; border-radius:20px; background:#0a0a0a; width:300px;">
                    <h2 style="color:#ff8c00; text-align:center;">ÚNETE AL FAROL</h2>
                    <input type="text" name="nombre" placeholder="Tu Nombre" required style="width:100%; padding:10px; margin:10px 0;">
                    <input type="email" name="email" placeholder="Correo" required style="width:100%; padding:10px; margin:10px 0;">
                    <input type="password" name="password" placeholder="Contraseña" required style="width:100%; padding:10px; margin:10px 0;">
                    <button type="submit" style="width:100%; padding:10px; background:#ff8c00; font-weight:bold;">CREAR CUENTA</button>
                </form></body>'''

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = Usuario.query.filter_by(email=request.form.get('email')).first()
        if user and check_password_hash(user.password, request.form.get('password')):
            session['user_id'] = user.id
            session['user_nombre'] = user.nombre
            session['es_staff'] = user.es_staff
            return redirect(url_for('index'))
    return '''<body style="background:#000; color:#fff; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh;">
                <form method="post" style="border:2px solid #ff8c00; padding:30px; border-radius:20px; background:#0a0a0a; width:300px;">
                    <h2 style="color:#ff8c00; text-align:center;">ENTRAR</h2>
                    <input type="email" name="email" placeholder="Email" required style="width:100%; padding:10px; margin:10px 0;">
                    <input type="password" name="password" placeholder="Contraseña" required style="width:100%; padding:10px; margin:10px 0;">
                    <button type="submit" style="width:100%; padding:10px; background:#ff8c00; font-weight:bold;">INGRESAR</button>
                </form></body>'''

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/')

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if not session.get('es_staff'): return "ACCESO DENEGADO."
    if request.method == 'POST':
        nueva = Noticia(titulo=request.form.get('titulo'), resumen=request.form.get('resumen'), 
                        imagen_url=request.form.get('imagen_url'), location=request.form.get('location'), 
                        autor=session['user_nombre'])
        db.session.add(nueva)
        db.session.commit()
        return redirect('/')
    return render_template_string('''
        <body style="background:#000; color:#fff; padding:20px; font-family:sans-serif;">
            <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
            <div style="max-width:600px; margin:auto; border:1px solid #ff8c00; padding:20px; border-radius:10px;">
                <h2 style="color:#ff8c00;">🏮 REDACCIÓN STAFF</h2>
                <form method="post">
                    <input type="text" name="titulo" placeholder="Titular" required style="width:100%; padding:10px; margin-bottom:10px;">
                    <input type="text" name="location" placeholder="📍 Ubicación" style="width:100%; padding:10px; margin-bottom:10px;">
                    <input type="text" name="imagen_url" placeholder="🖼️ Link de imagen" style="width:100%; padding:10px; margin-bottom:10px;">
                    <textarea name="resumen" id="editor"></textarea>
                    <button type="submit" style="width:100%; padding:15px; background:#ff8c00; margin-top:10px; font-weight:bold;">PUBLICAR</button>
                </form>
            </div>
            <script>CKEDITOR.replace('editor');</script>
        </body>
    ''')

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))
