import os
from flask import Flask, render_template, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)

# --- CORRECCIÓN DE BASE DE DATOS PARA RAILWAY ---
uri = os.getenv("DATABASE_URL")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Modelo de la base de datos
class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200), nullable=False)
    contenido = db.Column(db.Text, nullable=False)

# Crear las tablas automáticamente
with app.app_context():
    db.create_all()

@app.route('/')
def index():
    noticias = Noticia.query.all()
    return render_template('index.html', noticias=noticias)

@app.route('/agregar', methods=['POST'])
def agregar():
    titulo = request.form.get('titulo')
    contenido = request.form.get('contenido')
    nueva_noticia = Noticia(titulo=titulo, contenido=contenido)
    db.session.add(nueva_noticia)
    db.session.commit()
    return redirect(url_for('index'))

if __name__ == '__main__':
    app.run(debug=True)
