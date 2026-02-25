from flask import Flask, render_template_string, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'farol_al_dia_multimedia_2026')

# --- CONEXIÓN AL BOSQUE (SUPABASE) ---
uri = os.environ.get('DATABASE_URL')
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Modelo con Multimedia
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    imagen_url = db.Column(db.String(500)) # NUEVO CAMPO PARA FOTOS
    location = db.Column(db.String(100))
    autor = db.Column(db.String(100))
    date = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- PORTADA CON IMÁGENES ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.date.desc()).all()
    return render_template_string('''
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>FAROL AL DÍA</title>
            <style>
                body { background: #000; color: #eee; font-family: sans-serif; margin: 0; }
                header { border-bottom: 5px solid #ff8c00; padding: 30px; text-align: center; background: #0a0a0a; }
                h1 { color: #ff8c00; font-family: Impact; font-size: 2.8rem; margin: 0; }
                .container { max-width: 650px; margin: auto; padding: 15px; }
                .card { background: #111; border-radius: 15px; overflow: hidden; margin-bottom: 30px; border: 1px solid #222; }
                .img-news { width: 100%; height: auto; display: block; background: #222; }
                .p-3 { padding: 20px; }
                .meta { color: #ff8c00; font-weight: bold; font-size: 0.8rem; }
                h2 { color: #fff; margin: 10px 0; }
            </style>
        </head>
        <body>
            <header><h1>🏮 FAROL AL DÍA</h1></header>
            <div class="container">
                {% for n in noticias %}
                <div class="card">
                    {% if n.imagen_url %}
                    <img src="{{ n.imagen_url }}" class="img-news" alt="Multimedia">
                    {% endif %}
                    <div class="p-3">
                        <span class="meta">📍 {{ n.location }} | POR: {{ n.autor }}</span>
                        <h2>{{ n.titulo }}</h2>
                        <div style="color:#ccc; line-height:1.6;">{{ n.resumen|safe }}</div>
                    </div>
                </div>
                {% else %}
                <p style="text-align:center; color:#444; margin-top:50px;">Sin noticias multimedia aún...</p>
                {% endfor %}
            </div>
        </body>
        </html>
    ''', noticias=noticias)

# --- LOGIN ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('email') in ["hsy@elfarol.com", "reportero2@elfarol.com"]:
            session['user'] = request.form.get('email')
            return redirect(url_for('panel'))
    return '''<body style="background:#000; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; font-family:sans-serif;">
                <form method="post" style="border:2px solid #ff8c00; padding:30px; border-radius:20px; background:#0a0a0a; width:85%; max-width:350px;">
                    <h2 style="color:#ff8c00; text-align:center; font-family:Impact;">🏮 ACCESO STAFF</h2>
                    <input type="email" name="email" placeholder="Email" required style="width:100%; padding:12px; margin:15px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:8px; box-sizing:border-box;">
                    <button type="submit" style="width:100%; padding:12px; background:#ff8c00; color:#000; font-weight:bold; border:none; border-radius:8px;">ENTRAR</button>
                </form></body>'''

# --- PANEL CON CARGA DE IMAGEN ---
@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user' not in session: return redirect(url_for('login'))
    if request.method == 'POST':
        nueva = Noticia(
            titulo=request.form.get('titulo'), 
            resumen=request.form.get('resumen'), 
            imagen_url=request.form.get('imagen_url'), # GUARDAR URL DE FOTO
            location=request.form.get('location'), 
            autor=session['user']
        )
        db.session.add(nueva)
        db.session.commit()
        return redirect('/')
    return render_template_string('''
        <body style="background:#000; color:#fff; font-family:sans-serif; padding:15px;">
            <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
            <div style="border:1px solid #ff8c00; padding:20px; border-radius:15px; background:#0a0a0a; max-width:600px; margin:auto;">
                <h2 style="color:#ff8c00; text-align:center; font-family:Impact;">🏮 REDACCIÓN MULTIMEDIA</h2>
                <form method="post">
                    <input type="text" name="titulo" placeholder="Titular..." required style="width:100%; padding:10px; margin:5px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:5px; box-sizing:border-box;">
                    <input type="text" name="location" placeholder="📍 Ubicación" style="width:100%; padding:10px; margin:5px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:5px; box-sizing:border-box;">
                    <input type="text" name="imagen_url" placeholder="🖼️ URL de la imagen (Link de la foto)" style="width:100%; padding:10px; margin:5px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:5px; box-sizing:border-box;">
                    <textarea name="resumen" id="editor"></textarea>
                    <button type="submit" style="width:100%; padding:15px; background:#ff8c00; color:#000; font-weight:bold; margin-top:10px; border:none; border-radius:10px;">PUBLICAR CON FOTO 🔥</button>
                </form>
            </div>
            <script>CKEDITOR.replace('editor', { uiColor: '#1a1a1a', versionCheck: false, height: 250 });</script>
        </body>
    ''')

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))
