from flask import Flask, render_template_string, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
# Seguridad del sistema Roswell para Farol al Día
app.secret_key = os.environ.get('SECRET_KEY', 'farol_al_dia_2026_mxl')

# --- CONEXIÓN AL BOSQUE (SUPABASE) ---
uri = os.environ.get('DATABASE_URL')
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Estructura de las Noticias
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text)
    location = db.Column(db.String(100))
    autor = db.Column(db.String(100))
    date = db.Column(db.DateTime, default=datetime.utcnow)

# Asegurar que las tablas existan en Supabase
with app.app_context():
    try:
        db.create_all()
    except Exception as e:
        print(f"Error de conexión: {e}")

# --- PORTADA OFICIAL ---
@app.route('/')
def index():
    try:
        noticias = Noticia.query.order_by(Noticia.date.desc()).all()
    except:
        noticias = []
    return render_template_string('''
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>FAROL AL DÍA</title>
            <style>
                body { background: #000; color: #eee; font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; }
                header { border-bottom: 6px solid #ff8c00; padding: 40px 20px; text-align: center; background: #0a0a0a; box-shadow: 0 4px 20px rgba(255,140,0,0.2); }
                h1 { color: #ff8c00; font-family: Impact, sans-serif; font-size: 3.2rem; margin: 0; letter-spacing: 2px; text-transform: uppercase; }
                .sub-header { color: #666; font-size: 0.8rem; letter-spacing: 3px; margin-top: 5px; }
                .container { max-width: 700px; margin: auto; padding: 20px; }
                .card { background: #111; border: 1px solid #222; border-radius: 12px; padding: 25px; margin-bottom: 30px; border-left: 4px solid #ff8c00; }
                .meta { color: #ff8c00; font-weight: bold; font-size: 0.85rem; margin-bottom: 12px; display: block; }
                h2 { color: #fff; margin: 0 0 15px 0; font-size: 1.8rem; line-height: 1.2; }
                .text { line-height: 1.8; color: #ccc; font-size: 1.1rem; }
            </style>
        </head>
        <body>
            <header>
                <h1>🏮 FAROL AL DÍA</h1>
                <div class="sub-header">NOTICIAS DESDE EL CORAZÓN DEL BOSQUE</div>
            </header>
            <div class="container">
                {% for n in noticias %}
                <article class="card">
                    <span class="meta">📍 {{ n.location }} | POR: {{ n.autor }}</span>
                    <h2>{{ n.titulo }}</h2>
                    <div class="text">{{ n.resumen|safe }}</div>
                </article>
                {% else %}
                <div style="text-align:center; color:#444; margin-top:100px;">
                    <p style="font-size:1.2rem; font-style:italic;">Esperando el primer reporte de Farol al Día...</p>
                </div>
                {% endfor %}
            </div>
        </body>
        </html>
    ''', noticias=noticias)

# --- SISTEMA DE ACCESO ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        if email in ["hsy@elfarol.com", "reportero2@elfarol.com", "reportero3@elfarol.com", "reportero4@elfarol.com"]:
            session['user'] = email
            return redirect(url_for('panel'))
    return '''<body style="background:#000; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; font-family:sans-serif;">
                <form method="post" style="border:2px solid #ff8c00; padding:40px; border-radius:20px; background:#0a0a0a; width:85%; max-width:380px; text-align:center;">
                    <h2 style="color:#ff8c00; font-family:Impact; font-size:2.5rem; margin-bottom:20px;">🏮 ACCESO STAFF</h2>
                    <input type="email" name="email" placeholder="Correo del Reportero" required style="width:100%; padding:15px; margin-bottom:20px; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:10px; box-sizing:border-box; font-size:1rem;">
                    <button type="submit" style="width:100%; padding:15px; background:#ff8c00; color:#000; font-weight:bold; border:none; border-radius:10px; cursor:pointer; text-transform:uppercase; font-size:1rem;">Entrar al Farol</button>
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
        <body style="background:#000; color:#fff; font-family:sans-serif; padding:15px;">
            <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
            <div style="border:1px solid #ff8c00; padding:25px; border-radius:15px; background:#0a0a0a; max-width:650px; margin:auto;">
                <h2 style="color:#ff8c00; text-align:center; font-family:Impact; font-size:2.2rem;">🏮 REDACCIÓN: FAROL AL DÍA</h2>
                <form method="post">
                    <input type="text" name="titulo" placeholder="Titular de la Noticia..." required style="width:100%; padding:12px; margin:10px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:8px; box-sizing:border-box;">
                    <input type="text" name="location" placeholder="📍 Ubicación de los hechos" style="width:100%; padding:12px; margin:10px 0; background:#1a1a1a; color:#fff; border:1px solid #333; border-radius:8px; box-sizing:border-box;">
                    <textarea name="resumen" id="editor"></textarea>
                    <button type="submit" style="width:100%; padding:20px; background:#ff8c00; color:#000; font-weight:bold; margin-top:20px; border:none; border-radius:12px; cursor:pointer; font-size:1.2rem;">PUBLICAR NOTICIA 🔥</button>
                </form>
            </div>
            <script>CKEDITOR.replace('editor', { uiColor: '#1a1a1a', versionCheck: false, height: 350 });</script>
        </body>
    ''')

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))
