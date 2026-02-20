# coding: utf-8
import os
import logging
import psycopg2
import psycopg2.extras
from flask import Flask, render_template, request, jsonify

# Configuración de Logs para ver errores en Railway
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'farol2026')

# Conexión a la Base de Datos
DATABASE_URL = os.environ.get('DATABASE_URL')

def get_db():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)

# 1. PORTADA PRINCIPAL
@app.route('/')
def index():
    try:
        conn = get_db()
        cur = conn.cursor()
        # Intentamos traer las noticias
        cur.execute("SELECT * FROM noticias ORDER BY creado_en DESC LIMIT 20;")
        noticias = cur.fetchall()
        cur.close()
        conn.close()
        return render_template('index.html', noticias=noticias)
    except Exception as e:
        logger.error(f"Error en portada: {e}")
        # Si la tabla no existe aún, mostramos la portada vacía sin dar Error 500
        return render_template('index.html', noticias=[])

# 2. PANEL DE ADMINISTRACIÓN (Sincronizado con admin.html)
@app.route('/admin')
def admin_panel():
    try:
        # Aquí usamos 'admin.html' que es el archivo que tienes en tu GitHub
        return render_template('admin.html')
    except Exception as e:
        logger.error(f"Error al cargar admin.html: {e}")
        return f"Error: No se encuentra el archivo admin.html en la carpeta templates. {e}", 404

# 3. GUARDAR NOTICIA (Crea la tabla si no existe)
@app.route('/noticias', methods=['POST'])
def crear_noticia():
    datos = request.get_json()
    if not datos:
        return jsonify({'error': 'No se recibieron datos'}), 400
        
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # CREACIÓN AUTOMÁTICA DE TABLA (Por si Railway la borró)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS noticias (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                contenido TEXT NOT NULL,
                imagen TEXT,
                creado_en TIMESTAMP DEFAULT NOW()
            );
        """)
        
        # INSERTAR LA NOTICIA
        cur.execute(
            "INSERT INTO noticias (titulo, contenido, imagen) VALUES (%s, %s, %s) RETURNING id;",
            (datos.get('titulo'), datos.get('contenido'), datos.get('imagen'))
        )
        
        nuevo_id = cur.fetchone()['id']
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({'mensaje': '¡Noticia publicada con éxito!', 'id': nuevo_id}), 201
        
    except Exception as e:
        logger.error(f"Error al guardar noticia: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    puerto = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=puerto)
