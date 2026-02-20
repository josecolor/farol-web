# coding: utf-8
import os
import logging
import psycopg2
import psycopg2.extras
from flask import Flask, render_template, request, jsonify

# Configuración de Logs para Railway
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'farol2026')

# Enlace a la Base de Datos de Railway
DATABASE_URL = os.environ.get('DATABASE_URL')

def get_db():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)

# --- RUTAS DEL PORTAL ---

@app.route('/')
def index():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM noticias ORDER BY creado_en DESC LIMIT 20;")
        noticias = cur.fetchall()
        cur.close()
        conn.close()
        return render_template('index.html', noticias=noticias, titulo="EL FAROL AL DÍA | NOTICIAS")
    except Exception as e:
        logger.error(f"Error en portada: {e}")
        return render_template('index.html', noticias=[], titulo="EL FAROL AL DÍA")

@app.route('/admin')
def admin_panel():
    # Este busca el archivo que moveremos a la carpeta templates
    return render_template('admin.html', titulo="ADMINISTRACIÓN | EL FAROL")

@app.route('/noticias', methods=['POST'])
def crear_noticia():
    datos = request.get_json()
    try:
        conn = get_db()
        cur = conn.cursor()
        # Crear tabla automáticamente si es la primera vez
        cur.execute("""
            CREATE TABLE IF NOT EXISTS noticias (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                contenido TEXT NOT NULL,
                imagen TEXT,
                creado_en TIMESTAMP DEFAULT NOW()
            );
        """)
        cur.execute(
            "INSERT INTO noticias (titulo, contenido, imagen) VALUES (%s, %s, %s) RETURNING id;",
            (datos.get('titulo'), datos.get('contenido'), datos.get('imagen'))
        )
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'mensaje': '¡Noticia publicada con éxito!'}), 201
    except Exception as e:
        logger.error(f"Error al guardar: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    puerto = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=puerto)
