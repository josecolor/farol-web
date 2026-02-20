import os
from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from functools import wraps

app = Flask(__name__)

basedir = os.path.abspath(os.path.dirname(__file__))
db_path = os.path.join(basedir, 'noticias.db')
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'el_farol_mxl_2026_secreto')
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'connect_args': {'check_same_thread': False}
}

# --- CREDENCIALES DE ADMIN (cámbielas en Variables de Railway) ---
ADMIN_USER = os.environ.get('ADMIN_USER', 'director')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'farol2026')

db = SQLAlchemy(app)

class Noticia(db.Model):
    __tablename__ = 'noticia'
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    protagonista = db.Column(db.String(100))
    ciudad = db.Column(db.String(100))
    categoria = db.Column(db.String(50), default='Nacional')
    imagen_url = db.Column(db.String(300))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# --- DECORADOR: protege rutas de admin ---
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

# --- LOGIN ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if (request.form.get('usuario') == ADMIN_USER and
                request.form.get('password') == ADMIN_PASS):
            session['logged_in'] = True
            return redirect(url_for('admin'))
        flash('Usuario o contraseña incorrectos')
    return render_template('login.html')

# --- LOGOUT ---
@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# --- PORTADA (pública) ---
@app.route('/')
def index():
    try:
        noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    except Exception as e:
        print(f"Error BD: {e}")
        noticias = []
    return render_template('index.html', noticias=noticias)

# --- NOTICIA INDIVIDUAL (pública) ---
@app.route('/noticia/<int:id>')
def noticia(id):
    nota = Noticia.query.get_or_404(id)
    return render_template('noticia.html', noticia=nota)

# --- ADMIN (protegido) ---
@app.route('/admin', methods=['GET', 'POST'])
@login_required
def admin():
    if request.method == 'POST':
        nueva_nota = Noticia(
            titulo=request.form.get('titulo'),
            contenido=request.form.get('contenido'),
            protagonista=request.form.get('protagonista'),
            ciudad=request.form.get('ciudad'),
            categoria=request.form.get('categoria'),
            imagen_url=request.form.get('imagen_url')
        )
        db.session.add(nueva_nota)
        db.session.commit()
        flash('Noticia publicada correctamente')
        return redirect(url_for('admin'))
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias)

# --- ELIMINAR (protegido) ---
@app.route('/admin/eliminar/<int:id>', methods=['POST'])
@login_required
def eliminar(id):
    nota = Noticia.query.get_or_404(id)
    db.session.delete(nota)
    db.session.commit()
    flash('Noticia eliminada')
    return redirect(url_for('admin'))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
