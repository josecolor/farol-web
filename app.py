import os
from flask import Flask, render_template, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

app = Flask(__name__)

# Configuración de la Base de Datos
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'noticias.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'el_farol_mxl_2026')

db = SQLAlchemy(app)

# Modelo de la Noticia
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    protagonista = db.Column(db.String(100))
    ciudad = db.Column(db.String(100), default='Mexicali')
    categoria = db.Column(db.String(50), default='National')
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

# ESTO ES LO QUE ARREGLA EL ERROR 500: Se ejecuta al importar
with app.app_context():
    db.create_all()

@app.route('/')
def index():
    try:
        noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
        return render_template('index.html', noticias=noticias)
    except Exception as e:
        print(f"Error en portada: {e}")
        return render_template('index.html', noticias=[])

@app.route('/noticia/<int:id>')
def ver_noticia(id):
    noticia = Noticia.query.get_or_404(id)
    return render_template('noticia.html', noticia=noticia)

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        nueva_noticia = Noticia(
            titulo=request.form.get('titulo', 'Sin Título'),
            contenido=request.form.get('contenido', ''),
            protagonista=request.form.get('protagonista', 'Desconocido'),
            ciudad=request.form.get('ciudad', 'Mexicali'),
            categoria=request.form.get('categoria', 'National')
        )
        db.session.add(nueva_noticia)
        db.session.commit()
        return redirect(url_for('index'))
    
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template('admin.html', noticias=noticias)

@app.route('/eliminar/<int:id>')
def eliminar(id):
    noticia = Noticia.query.get_or_404(id)
    db.session.delete(noticia)
    db.session.commit()
    return redirect(url_for('admin'))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
