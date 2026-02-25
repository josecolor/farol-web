from flask import Flask, render_template_string, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
# Llave de seguridad para las sesiones del staff
app.secret_key = os.environ.get('SECRET_KEY', 'farol_roswell_2026')

# --- CONEXIÓN CON SUPABASE ---
uri = os.environ.get('DATABASE_URL')
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = uri or 'sqlite:///roswell_backup.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Modelo de Noticias
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    location = db.Column(db.String(100))
    autor = db.Column(db.String(100))
    date = db.Column(db.DateTime, default=datetime.utcnow)

# Crear tablas al iniciar
with app.app_context():
    db.create_all()

# --- PORTADA DEL PERIÓDICO ---
@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.date.desc()).all()
    return render_template_string('''
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>THE LANTERN</title>
            <style>
                body { background: #000; color: #eee; font-family: sans-serif; margin: 0; padding: 0; }
                header { border-bottom: 5px solid #ff8c00; padding: 30px 15px; text-align: center; background: #0a0a0a; }
                h1 { color: #ff8c00; font-family: Impact; font-size: 2.8rem; margin: 0; letter-spacing: 3px; }
                .container { max-width: 650px; margin: auto; padding: 15px; }
                .card { background: #111; border: 1px solid #222; border-radius: 15px; padding: 20px; margin-bottom: 20px; text-align: left; }
                .meta { color: #ff8c00; font-weight: bold; font-size: 0.8rem; text-transform: uppercase; }
                h2 { color: #fff; margin: 10px 0; font-size: 1.5rem; }
                .content { line-height: 1.6; color: #ccc; }
            </style>
        </head>
        <body>
            <header><h1>🏮 THE LANTERN</h1></header>
            <div class="container">
                {% for n in noticias %}
                <div class="card">
                    <div class="meta">📍 {{ n.location }} | POR: {{ n.autor }}</div>
                    <h2>{{ n.titulo }}</h2>
                    <div class="content">{{ n.resumen|safe }}</div>
                </div>
                {% else %}
                <p style="text-align:center; color:#444; margin-top:50px;">Esperando reportes...</p>
                {% endfor %}
            </div>
        </body>
        </html>
    ''', noticias=noticias)

# --- LOGIN STAFF ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        if email in ["hsy@elfarol.com", "reportero2@elfarol.com", "reportero3@elfarol.com", "reportero4@elfarol.com"]:
            session['user'] = email
            return redirect(url_for('panel'))
    return '''<body style="background:#000; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; font-family:sans-serif;">
                <form method="post" style="border:2px solid #ff8c00; padding:30px; border-radius:20px; background:#0a0a0a; width:80%; max-width:350px;">
                    <h2 style="color:#ff8c00; text-align:center; font-family:Impact;">🏮 ACCESO</h2>
                    <input type="email" name="email" placeholder="Email" required style="width:100%; padding:12px; margin:10px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:8px; box-sizing:border-box;">
                    <button type="submit" style="width:100%; padding:12px; background:#ff8c00; color:#000; font-weight:bold; border:none; border-radius:8px;">CONECTAR</button>
                </form></body>'''

# --- PANEL DE REDACCIÓN ---
@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user' not in session: return redirect(url_for('login'))
    if request.method == 'POST':
        nueva = Noticia(titulo=request.form.get('titulo'), resumen=request.form.get('resumen'), 
                        location=request.form.get('location'), autor=session['user'])
        db.session.add(nueva)
        db.session.commit()
        return redirect('/')
    return render_template_string('''
        <body style="background:#000; color:#fff; font-family:sans-serif; padding:10px;">
            <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
            <div style="border:1px solid #ff8c00; padding:15px; border-radius:15px; background:#0a0a0a; max-width:600px; margin:auto;">
                <h2 style="color:#ff8c00; text-align:center; font-family:Impact;">🏮 REDACCIÓN</h2>
                <form method="post">
                    <input type="text" name="titulo" placeholder="Titular..." required style="width:100%; padding:10px; margin:5px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:5px; box-sizing:border-box;">
                    <input type="text" name="location" placeholder="📍 Ubicación" style="width:100%; padding:10px; margin:5px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:5px; box-sizing:border-box;">
                    <textarea name="resumen" id="editor"></textarea>
                    <button type="submit" style="width:100%; padding:15px; background:#ff8c00; color:#000; font-weight:bold; margin-top:10px; border:none; border-radius:10px;">PUBLICAR 🔥</button>
                </form>
            </div>
            <script>CKEDITOR.replace('editor', { uiColor: '#1a1a1a', versionCheck: false, height: 250 });</script>
        </body>
    ''')

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))
