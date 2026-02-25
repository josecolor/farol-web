from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = 'farol_blogger_style_2026'

# CONFIGURACIÓN
UPLOAD_FOLDER = 'static/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///farol_pro_editor.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELOS
class Usuario(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True)
    password = db.Column(db.String(50))

class Noticia(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(200))
    resumen = db.Column(db.Text) # Aquí se guardará el HTML del editor
    keywords = db.Column(db.String(200))
    multimedia_url = db.Column(db.String(400))
    fecha = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()
    if not Usuario.query.filter_by(username='director').first():
        db.session.add(Usuario(username='director', password='farol_director'))
        db.session.commit()

# --- PANEL DE PRENSA ESTILO BLOGGER (PROFESIONAL) ---
html_panel = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Editor El Farol</title>
    <script src="https://cdn.ckeditor.com/4.22.1/standard/ckeditor.js"></script>
    <style>
        body { background-color: #000; color: #fff; font-family: 'Segoe UI', sans-serif; padding: 10px; }
        .editor-container { max-width: 900px; margin: auto; background: #111; padding: 20px; border-radius: 15px; border: 2px solid #ff8c00; }
        .header-editor { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 10px; }
        .btn-publicar { background: #ff8c00; color: #000; font-weight: 900; border: none; padding: 12px 30px; border-radius: 8px; cursor: pointer; text-transform: uppercase; }
        label { color: #ff8c00; font-weight: bold; display: block; margin-bottom: 5px; margin-top: 15px; }
        input[type="text"] { width: 100%; padding: 12px; border-radius: 5px; border: 1px solid #333; background: #fff; color: #000; font-weight: bold; margin-bottom: 10px; box-sizing: border-box; }
        .file-upload { background: #222; padding: 15px; border-radius: 8px; border: 1px dashed #ff8c00; margin-top: 15px; }
    </style>
</head>
<body>
    <form method="post" enctype="multipart/form-data" class="editor-container">
        <div class="header-editor">
            <h2 style="color: #ff8c00; margin: 0;">🎤 REDACCIÓN ELITE</h2>
            <button type="submit" class="btn-publicar">PUBLICAR 🚀</button>
        </div>

        <label>TÍTULO DE LA ENTRADA</label>
        <input type="text" name="titulo" placeholder="Escriba un título de impacto..." required>

        <label>CUERPO DE LA NOTICIA (ESTILO BLOGGER)</label>
        <textarea name="resumen" id="editor1"></textarea>

        <label>ETIQUETAS SEO</label>
        <input type="text" name="keywords" placeholder="noticias, army, farol...">

        <div class="file-upload">
            <label style="margin-top: 0;">IMAGEN DE PORTADA</label>
            <input type="file" name="foto" required style="color: #fff;">
        </div>
    </form>

    <script>
        // ACTIVACIÓN DEL EDITOR PROFESIONAL
        CKEDITOR.replace('editor1', {
            height: 350,
            removeButtons: 'About',
            // Colores oscuros para el editor si se desea, pero dejamos blanco para visibilidad
        });
    </script>
</body>
</html>
'''

# --- PORTADA (REPRESENTA EL CONTENIDO FORMATEADO) ---
html_portada = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>El Farol</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #000; color: #fff; }
        .navbar { border-bottom: 5px solid #ff8c00; background: #000; padding: 20px; text-align: center; }
        .card-noticia { background: #0a0a0a; border: 1px solid #222; border-radius: 15px; margin-bottom: 30px; overflow: hidden; }
        .noticia-contenido { color: #ccc; line-height: 1.6; }
        .noticia-contenido b, .noticia-contenido strong { color: #ff8c00; } /* Resalta las negritas en naranja */
    </style>
</head>
<body>
    <div class="navbar"><h1 style="color:#ff8c00; font-family:Impact; font-size:2.5rem;">🏮 EL FAROL</h1></div>
    <div class="container mt-5">
        <div class="row">
            {% for n in noticias %}
            <div class="col-12 col-md-8 mx-auto">
                <div class="card-noticia">
                    <img src="/uploads/{{ n.multimedia_url }}" style="width:100%; height:400px; object-fit:cover;">
                    <div style="padding:30px;">
                        <h1 style="color:#ff8c00; font-weight:900;">{{ n.titulo }}</h1>
                        <hr style="border-color:#333;">
                        <div class="noticia-contenido">{{ n.resumen|safe }}</div>
                        <p class="mt-4" style="color:#ff8c00; font-weight:bold;">#{{ n.keywords }}</p>
                    </div>
                </div>
            </div>
            {% endfor %}
        </div>
    </div>
</body>
</html>
'''

@app.route('/')
def index():
    noticias = Noticia.query.order_by(Noticia.fecha.desc()).all()
    return render_template_string(html_portada, noticias=noticias)

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        if request.form.get('u') == 'director' and request.form.get('p') == 'farol_director':
            session['user_id'] = 1
            return redirect(url_for('panel'))
    return '<body style="background:#000;text-align:center;padding-top:100px;"><form method="post" style="display:inline-block;background:#111;padding:40px;border:2px solid #ff8c00;border-radius:15px;"><h2 style="color:#ff8c00;">EDITOR LOGIN</h2><input name="u" placeholder="Usuario"><br><br><input name="p" type="password" placeholder="Contraseña"><br><br><button type="submit" style="background:#ff8c00;padding:10px 40px;font-weight:900;">ENTRAR</button></form></body>'

@app.route('/panel', methods=['GET', 'POST'])
def panel():
    if 'user_id' not in session: return redirect(url_for('admin'))
    if request.method == 'POST':
        t, r, k = request.form.get('titulo'), request.form.get('resumen'), request.form.get('keywords')
        f = request.files.get('foto')
        if f:
            fname = f"noticia_{datetime.utcnow().timestamp()}.jpg"
            f.save(os.path.join(UPLOAD_FOLDER, fname))
            db.session.add(Noticia(titulo=t, resumen=r, keywords=k, multimedia_url=fname))
            db.session.commit()
            return redirect(url_for('index'))
    return render_template_string(html_panel)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))

