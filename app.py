import os
from datetime import datetime
from flask import Flask, render_template_string, request, redirect, session, url_for
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = "farol_mxl_periodista_2026"

# --- 1. CONFIGURACIÓN DE BASE DE DATOS ---
uri = os.environ.get('DATABASE_URL', 'sqlite:///farol_prensa.db')
if uri.startswith("postgres://"): uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- 2. LISTA NEGRA/BLANCA DE PERIODISTAS ---
STAFF = ["jose.colorvision@gmail.com", "hsy@elfarol.com"]

# --- 3. MODELOS ---
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(150), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    imagen = db.Column(db.String(300))
    autor = db.Column(db.String(50))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

class Periodista(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(50))
    email = db.Column(db.String(120), unique=True)
    password = db.Column(db.String(200))
    biografia = db.Column(db.String(200), default="Periodista de El Farol")

with app.app_context():
    db.create_all()

# --- 4. DISEÑO "FAROL AL DÍA" CON PERFILES ---
HTML = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FAROL AL DÍA | Prensa</title>
    <style>
        body { background:#000; color:#eee; font-family:sans-serif; margin:0; }
        header { padding:20px; border-bottom:3px solid #ff8c00; text-align:center; background:#0a0a0a; }
        .logo { font-size:1.8rem; font-family:Impact; color:#ff8c00; margin:0; }
        .nav { font-size:0.8rem; margin-top:10px; }
        .nav a { color:#ff8c00; text-decoration:none; margin:0 10px; border:1px solid #333; padding:5px 10px; border-radius:15px; }
        .container { max-width:500px; margin:auto; padding:10px; }
        .card { background:#111; margin-bottom:25px; border-radius:12px; overflow:hidden; border:1px solid #222; }
        .card img { width:100%; height:220px; object-fit:cover; }
        .card-body { padding:15px; }
        .autor-tag { font-size:0.7rem; color:#ff8c00; font-weight:bold; text-transform:uppercase; margin-bottom:5px; display:block; }
        h2 { margin:5px 0; font-size:1.4rem; color:#fff; }
        .btn-post { background:#ff8c00; color:#000; padding:15px; width:100%; border:none; border-radius:10px; font-weight:bold; font-size:1.1rem; }
        input, textarea { width:100%; padding:12px; margin:10px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:8px; box-sizing:border-box; }
    </style>
</head>
<body>
    <header>
        <p class="logo">🏮 FAROL AL DÍA</p>
        <div class="nav">
            {% if session.get('user_id') %}
                <span style="color:#aaa">Periodista: {{ session.get('user_name') }}</span> | 
                <a href="/redactar">NUEVA NOTICIA</a> | <a href="/logout">SALIR</a>
            {% else %}
                <a href="/login">ENTRAR STAFF</a>
            {% endif %}
        </div>
    </header>

    <div class="container">
        {% for n in noticias %}
        <div class="card">
            {% if n.imagen %}<img src="{{ n.imagen }}">{% endif %}
            <div class="card-body">
                <span class="autor-tag">✍️ POR: {{ n.autor }}</span>
                <h2>{{ n.titulo }}</h2>
                <p style="color:#ccc; line-height:1.5;">{{ n.contenido|safe }}</p>
                <small style="color:#555;">{{ n.fecha.strftime('%d %b, %Y') }}</small>
            </div>
        </div>
        {% endfor %}
    </div>
</body>
</html>
'''

# --- 5. RUTAS DE PRENSA ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template_string(HTML, noticias=noticias)

@app.route('/redactar', methods=['GET', 'POST'])
def redactar():
    if 'user_id' not in session: return redirect('/login')
    if request.method == 'POST':
        n = Noticia(titulo=request.form['titulo'], contenido=request.form['contenido'], 
                    imagen=request.form['imagen'], autor=session.get('user_name'))
        db.session.add(n)
        db.session.commit()
        return redirect('/')
    return '''
    <body style="background:#000;color:#fff;padding:20px;font-family:sans-serif;">
        <h2 style="color:#ff8c00;">🏮 Redacción de Noticia</h2>
        <form method="POST">
            <input name="titulo" placeholder="Título Impactante" required>
            <input name="imagen" placeholder="URL de la Foto">
            <textarea name="contenido" rows="10" placeholder="Escribe la noticia aquí..." required></textarea>
            <button style="background:#ff8c00;color:#000;padding:15px;width:100%;font-weight:bold;border-radius:10px;">PUBLICAR YA 🚀</button>
        </form>
        <a href="/" style="color:#aaa; display:block; margin-top:20px;">Volver</a>
    </body>
    '''

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        p = Periodista.query.filter_by(email=request.form['email'].lower().strip()).first()
        if p and check_password_hash(p.password, request.form['password']):
            session['user_id'] = p.id
            session['user_name'] = p.nombre
            return redirect('/')
    return '<body style="background:#000;color:#fff;padding:50px;"><form method="POST"><h2>Staff Login</h2><input name="email" type="email" placeholder="Email"><br><input name="password" type="password" placeholder="Pass"><br><button>ENTRAR</button></form><p><a href="/registro" style="color:#ff8c00;">Registrarse como Periodista</a></p></body>'

@app.route('/registro', methods=['GET', 'POST'])
def registro():
    if request.method == 'POST':
        email = request.form['email'].lower().strip()
        pw = generate_password_hash(request.form['password'], method='pbkdf2:sha256')
        p = Periodista(nombre=request.form['nombre'], email=email, password=pw)
        db.session.add(p)
        db.session.commit()
        return redirect('/login')
    return '<body style="background:#000;color:#fff;padding:50px;"><form method="POST"><h2>Registro Periodista</h2><input name="nombre" placeholder="Nombre Público"><br><input name="email" type="email" placeholder="Email"><br><input name="password" type="password" placeholder="Contraseña"><br><button>UNIRSE AL STAFF</button></form></body>'

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/')

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))
