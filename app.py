import os
from flask import Flask, render_template, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

app = Flask(__name__)

# --- CONFIGURACIÓN DE BASE DE DATOS ---
# Lee la variable de entorno primero (Railway la inyecta automáticamente)
# Si no existe, usa SQLite local como respaldo
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    'DATABASE_URL',
    'sqlite:///' + os.path.join(basedir, 'noticias.db')
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'el_farol_mxl_2026')

db = SQLAlchemy(app)

# --- MODELO DE LA NOTICIA ---
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    protagonista = db.Column(db.String(100))
    ciudad = db.Column(db.String(100))
    categoria = db.Column(db.String(50), default='Nacional')
    imagen_url = db.Column(db.String(300))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

# --- CREACIÓN AUTOMÁTICA DE LA BASE DE DATOS ---
with app.app_context():
    db.create_all()

# --- RUTAS ---
@app.route('/')
def index():
    try:
        noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    except Exception as e:
        print(f"Error BD: {e}")
        noticias = []
    return render_template('index.html', noticias=noticias)

@app.route('/noticia/<int:id>')
def noticia(id):
    nota = Noticia.query.get_or_404(id)
    return render_template('noticia.html', noticia=nota)

@app.route('/admin', methods=['GET', 'POST'])
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
        return redirect(url_for('index'))
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias)

@app.route('/admin/eliminar/<int:id>', methods=['POST'])
def eliminar(id):
    nota = Noticia.query.get_or_404(id)
    db.session.delete(nota)
    db.session.commit()
    return redirect(url_for('admin'))

# Solo para desarrollo local
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
