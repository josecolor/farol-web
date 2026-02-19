import os
from flask import Flask, render_template, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from functools import wraps

app = Flask(__name__)
app.secret_key = "farol_secreto_2026" # LLave para la seguridad

# Configuración de Base de Datos
uri = os.getenv("DATABASE_URL", "sqlite:///farol.db")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
db = SQLAlchemy(app)

# Modelo Profesional (Foto, Texto, Video, SEO)
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    imagen_url = db.Column(db.String(500))
    video_url = db.Column(db.String(500))
    keywords = db.Column(db.String(200))
    fecha = db.Column(db.DateTime, server_default=db.func.now())

with app.app_context():
    db.create_all()

# --- SEGURIDAD: CONTROL DE ACCESO ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        # AQUÍ DEFINE SU CLAVE (Cámbiela si desea)
        if request.form['username'] == 'director' and request.form['password'] == 'farol2026':
            session['logged_in'] = True
            return redirect(url_for('admin'))
        else:
            error = 'Acceso Denegado. Credenciales incorrectas.'
    return f'''
        <div style="background:#003366; color:white; padding:40px; font-family:Impact; text-align:center; height:100vh;">
            <h1>🏮 ACCESO RESTRINGIDO - EL FAROL</h1>
            <form method="post" style="max-width:300px; margin:auto; background:white; padding:20px; color:black; border-radius:10px;">
                <input type="text" name="username" placeholder="Usuario" style="width:100%; margin-bottom:10px; padding:10px;" required><br>
                <input type="password" name="password" placeholder="Contraseña" style="width:100%; margin-bottom:10px; padding:10px;" required><br>
                <button type="submit" style="background:#FF8C00; color:white; border:none; padding:10px; width:100%; cursor:pointer;">ENTRAR</button>
                <p style="color:red; font-size:0.8em;">{error if error else ""}</p>
            </form>
        </div>
    '''

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.id.desc()).all()
    return render_template('index.html', noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
@login_required # Solo entra quien tenga la clave
def admin():
    if request.method == 'POST':
        nueva_nota = Noticia(
            titulo=request.form['titulo'],
            contenido=request.form['contenido'],
            imagen_url=request.form['imagen_url'],
            video_url=request.form['video_url'],
            keywords=request.form['keywords']
        )
        db.session.add(nueva_nota)
        db.session.commit()
        return redirect(url_for('index'))
    return render_template('admin.html') # Usaremos un template para que se vea pro

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
