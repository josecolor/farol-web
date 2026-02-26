import os
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.secret_key = "farol_mxl_security_2026"  # Llave de seguridad del búnker

# --- 1. CONFIGURACIÓN DE BASE DE DATOS ---
# Detecta si estamos en Railway (Postgres) o local (SQLite)
uri = os.environ.get('DATABASE_URL', 'sqlite:///farol_pro.db')
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- 2. MODELO DE DATOS (SEO & SEGURIDAD) ---
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(200), unique=True, nullable=False)  # Para URLs amigables SEO
    contenido = db.Column(db.Text, nullable=False)
    resumen = db.Column(db.String(300))  # Para meta-description Google
    imagen = db.Column(db.String(500))
    categoria = db.Column(db.String(50), default="Actualidad")
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- 3. RUTAS PÚBLICAS (EL PERIÓDICO) ---

@app.route('/')
def index():
    # Carga todas las noticias, la más reciente primero
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('index.html', noticias=noticias)

@app.route('/nota/<slug>')
def noticia(slug):
    # Ruta SEO: busca la noticia por su nombre en el link
    n = Noticia.query.filter_by(slug=slug).first_or_404()
    return render_template('noticia.html', n=n)

# --- 4. RUTAS DE ADMINISTRACIÓN (EL BÚNKER) ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = request.form.get('user')
        password = request.form.get('pass')
        # Credenciales directas para seguridad mxl
        if user == "mxl" and password == "mxl2026":
            session['admin'] = True
            return redirect(url_for('admin'))
        else:
            flash("Acceso denegado: Credenciales incorrectas")
    return render_template('login.html')

@app.route('/admin')
def admin():
    if not session.get('admin'):
        return redirect(url_for('login'))
    noticias_list = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias_list)

@app.route('/publicar', methods=['POST'])
def publicar():
    if not session.get('admin'):
        return redirect(url_for('login'))
    
    titulo = request.form.get('titulo')
    # Generar SLUG automático para SEO (ej: "Hola Mundo" -> "hola-mundo")
    slug = titulo.lower().replace(" ", "-")[:60]
    
    nueva = Noticia(
        titulo=titulo,
        slug=slug,
        contenido=request.form.get('contenido'),
        resumen=request.form.get('contenido')[:150], # Auto-resumen para Google
        imagen=request.form.get('imagen'),
        categoria=request.form.get('categoria')
    )
    
    try:
        db.session.add(nueva)
        db.session.commit()
    except:
        db.session.rollback()
        flash("Error: El título ya existe o el link está duplicado.")
        
    return redirect(url_for('admin'))

@app.route('/borrar/<int:id>')
def borrar(id):
    if not session.get('admin'):
        return redirect(url_for('login'))
    n = Noticia.query.get_or_404(id)
    db.session.delete(n)
    db.session.commit()
    return redirect(url_for('admin'))

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# --- 5. ARRANQUE DEL SERVIDOR ---
if __name__ == "__main__":
    # Importante para Railway: usar el puerto que asigne el sistema
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
