#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🏮 EL FAROL - SISTEMA PROFESIONAL DE NOTICIAS
Versión: 2026.1.0
Seguridad: Industrial (HTTPS, HSTS, CSP, Rate Limiting)
SEO: Profesional (Sitemap, Robots, Schema.org, Meta tags)
"""

from flask import Flask, render_template_string, request, redirect, url_for, session, send_from_directory, jsonify, make_response
from flask_sqlalchemy import SQLAlchemy
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from datetime import datetime, timedelta
import os
import json
import hashlib
import re
from functools import wraps

# ============= INICIALIZACIÓN FLASK =============
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'farol_olimpo_final_2026_' + os.urandom(32).hex())

# ============= CONFIGURACIÓN DE SEGURIDAD =============
Talisman(app, 
    force_https=True,
    strict_transport_security=True,
    strict_transport_security_max_age=31536000,
    strict_transport_security_include_subdomains=True,
    content_security_policy={
        'default-src': "'self'",
        'script-src': ["'self'", 'cdn.ckeditor.com', 'www.googletagmanager.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'],
        'style-src': ["'self'", 'cdnjs.cloudflare.com', "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'www.google-analytics.com'],
        'frame-ancestors': "'none'",
        'base-uri': "'self'",
        'form-action': "'self'"
    },
    referrer_policy='strict-origin-when-cross-origin',
    permissions_policy={
        'geolocation': "();",
        'microphone': "();",
        'camera': "();"
    }
)

# Rate Limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# ============= CONFIGURACIÓN DE BASE DE DATOS =============
UPLOAD_FOLDER = 'static/uploads'
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///farol_limpio.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=2)

db = SQLAlchemy(app)

# ============= MODELOS DE DATOS =============
class Usuario(db.Model):
    """Modelo para usuarios administrativos"""
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    fecha_creacion = db.Column(db.DateTime, default=datetime.utcnow)
    ultimo_acceso = db.Column(db.DateTime)
    activo = db.Column(db.Boolean, default=True)

class Noticia(db.Model):
    """Modelo para noticias"""
    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(300), nullable=False)
    resumen = db.Column(db.Text, nullable=False)
    contenido_html = db.Column(db.Text, nullable=False)
    keywords = db.Column(db.String(500))
    meta_descripcion = db.Column(db.String(160))
    slug = db.Column(db.String(300), unique=True, nullable=False)
    multimedia_url = db.Column(db.String(400))
    fecha = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    fecha_modificacion = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    vistas = db.Column(db.Integer, default=0, index=True)
    autor = db.Column(db.String(100), default='Redacción')
    estado = db.Column(db.String(20), default='publicada', index=True)
    indexable = db.Column(db.Boolean, default=True, index=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'))

class Analytics(db.Model):
    """Modelo para analítica de visitas"""
    id = db.Column(db.Integer, primary_key=True)
    noticia_id = db.Column(db.Integer, db.ForeignKey('noticia.id'), index=True)
    ip_address = db.Column(db.String(50))
    fecha_acceso = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    referer = db.Column(db.String(500))
    user_agent = db.Column(db.String(500))
    tiempo_permanencia = db.Column(db.Integer, default=0)

class AuditLog(db.Model):
    """Modelo para auditoría de acciones"""
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuario.id'))
    accion = db.Column(db.String(255))
    detalle = db.Column(db.Text)
    fecha = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    ip_address = db.Column(db.String(50))
    estado = db.Column(db.String(20), default='exitoso')

# ============= CREAR TABLAS =============
with app.app_context():
    db.create_all()
    # Crear usuario por defecto si no existe
    if not Usuario.query.filter_by(username='director').first():
        user = Usuario(
            username='director',
            password_hash=generate_password_hash('farol_director'),
            email='director@farol.olimpo'
        )
        db.session.add(user)
        db.session.commit()

# ============= FUNCIONES AUXILIARES =============

def allowed_file(filename):
    """Valida extensión de archivo"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def generate_slug(titulo):
    """Genera slug SEO-friendly"""
    slug = re.sub(r'[^\w\s-]', '', titulo.lower())
    slug = re.sub(r'[-\s]+', '-', slug)
    return slug.strip('-')[:100]

def sanitize_html(html_content):
    """Elimina contenido peligroso del HTML"""
    dangerous_patterns = [
        r'<script[^>]*>.*?</script>',
        r'javascript:',
        r'on\w+\s*=',
        r'<iframe',
        r'<object',
        r'<embed'
    ]
    result = html_content
    for pattern in dangerous_patterns:
        result = re.sub(pattern, '', result, flags=re.IGNORECASE | re.DOTALL)
    return result

def registrar_auditoria(accion, detalle='', estado='exitoso'):
    """Registra acciones administrativas"""
    usuario_id = session.get('user_id')
    log = AuditLog(
        usuario_id=usuario_id,
        accion=accion,
        detalle=detalle,
        ip_address=request.remote_addr,
        estado=estado
    )
    db.session.add(log)
    db.session.commit()

def login_required(f):
    """Decorador para proteger rutas"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('admin'))
        return f(*args, **kwargs)
    return decorated_function

def get_analytics_data():
    """Obtiene datos analíticos para dashboard"""
    total_noticias = Noticia.query.filter_by(estado='publicada').count()
    total_vistas = db.session.query(db.func.sum(Noticia.vistas)).scalar() or 0
    promedio_vistas = int(total_vistas / total_noticias) if total_noticias > 0 else 0
    
    noticias = Noticia.query.filter_by(estado='publicada').order_by(Noticia.vistas.desc()).all()
    top_noticias = noticias[:5]
    
    labels = [n.titulo[:30] for n in noticias[:10]]
    data = [n.vistas for n in noticias[:10]]
    
    return {
        'total_noticias': total_noticias,
        'total_vistas': total_vistas,
        'promedio_vistas': promedio_vistas,
        'top_noticias': top_noticias,
        'labels': labels,
        'data': data
    }

# ============= TEMPLATES HTML =============

HTML_LOGIN = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>🔐 Acceso - El Farol</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-iecdLmaskl7CVJkEZSMUkrQ6usRd61hmVHambPvXiJ2G/By6SCTQScuHSBIkimT/MfktOLzko6zimDBiZvQvQ==" crossorigin="anonymous" referrerpolicy="no-referrer">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        .login-container {
            background: #000;
            border: 3px solid #ff8c00;
            border-radius: 20px;
            padding: 50px;
            width: 100%;
            max-width: 450px;
            box-shadow: 0 8px 30px rgba(255, 140, 0, 0.3);
        }
        .login-container h1 {
            text-align: center;
            color: #ff8c00;
            margin-bottom: 30px;
            font-size: 2.5rem;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group input {
            width: 100%;
            padding: 15px;
            border: none;
            border-radius: 10px;
            background: #222;
            color: #fff;
            font-size: 1rem;
            transition: all 0.3s;
        }
        .form-group input:focus {
            outline: 2px solid #ff8c00;
            background: #333;
        }
        button {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #ff8c00, #ffaa22);
            border: none;
            border-radius: 10px;
            color: #000;
            font-weight: bold;
            font-size: 1.1rem;
            cursor: pointer;
            text-transform: uppercase;
            transition: all 0.3s;
            box-shadow: 0 4px 15px rgba(255, 140, 0, 0.4);
        }
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 25px rgba(255, 140, 0, 0.6);
        }
        .error {
            background: #3a0a0a;
            color: #ff6666;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #ff0000;
        }
        .info {
            background: rgba(255, 140, 0, 0.1);
            color: #ff8c00;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #ff8c00;
            font-size: 0.9rem;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h1><i class="fas fa-fire"></i> EL FAROL</h1>
        
        {% if error %}
        <div class="error"><i class="fas fa-exclamation-circle"></i> {{ error }}</div>
        {% endif %}
        
        <div class="info">
            <i class="fas fa-info-circle"></i> Demo: director / farol_director
        </div>
        
        <form method="post" autocomplete="off">
            <div class="form-group">
                <input type="text" name="u" placeholder="Usuario" required autofocus autocomplete="off">
            </div>
            <div class="form-group">
                <input type="password" name="p" placeholder="Contraseña" required autocomplete="current-password">
            </div>
            <button type="submit"><i class="fas fa-sign-in-alt"></i> ENTRAR</button>
        </form>
    </div>
</body>
</html>
'''

HTML_PANEL = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>📋 Redacción - El Farol</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-iecdLmaskl7CVJkEZSMUkrQ6usRd61hmVHambPvXiJ2G/By6SCTQScuHSBIkimT/MfktOLzko6zimDBiZvQvQ==" crossorigin="anonymous" referrerpolicy="no-referrer">
    <script src="https://cdn.ckeditor.com/4.25.0/standard/ckeditor.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%); 
            color: #fff; 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            min-height: 100vh;
        }
        .navbar {
            background: #000;
            border-bottom: 4px solid #ff8c00;
            padding: 20px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 20px rgba(255, 140, 0, 0.3);
        }
        .navbar h1 { font-size: 1.8rem; color: #ff8c00; display: flex; align-items: center; gap: 10px; }
        .nav-links { display: flex; gap: 20px; align-items: center; }
        .nav-links a { color: #ff8c00; text-decoration: none; transition: all 0.3s; }
        .nav-links a:hover { color: #ffaa22; }
        .btn-logout { background: #cc3300; color: #fff; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
        .btn-logout:hover { background: #ff4400; }
        
        .container { max-width: 1100px; margin: auto; padding: 30px 20px; }
        .editor-section { 
            background: #111; 
            border: 2px solid #ff8c00; 
            border-radius: 20px; 
            padding: 40px; 
            margin-bottom: 30px;
            box-shadow: 0 8px 30px rgba(255, 140, 0, 0.2);
        }
        
        .form-group { margin-bottom: 25px; }
        label { 
            display: block; 
            color: #ff8c00; 
            font-weight: bold; 
            font-size: 1.1rem;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        input[type="text"], input[type="file"], textarea {
            width: 100%;
            padding: 15px;
            border: none;
            border-radius: 10px;
            background: #222;
            color: #fff;
            font-size: 1rem;
            font-family: 'Segoe UI', sans-serif;
            transition: all 0.3s;
        }
        
        input[type="text"]:focus, textarea:focus {
            background: #333;
            outline: 2px solid #ff8c00;
        }
        
        textarea { resize: none; min-height: 80px; }
        
        .file-upload-area {
            background: linear-gradient(135deg, #1a1a1a, #0a0a0a);
            border: 3px dashed #ff8c00;
            border-radius: 15px;
            padding: 30px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s;
            margin-bottom: 20px;
        }
        
        .file-upload-area:hover {
            background: linear-gradient(135deg, #2a2a2a, #1a1a1a);
            border-color: #ffaa22;
        }
        
        button[type="submit"] {
            background: linear-gradient(135deg, #ff8c00, #ffaa22);
            color: #000;
            padding: 15px 40px;
            border: none;
            border-radius: 12px;
            font-weight: 900;
            font-size: 1.1rem;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 1px;
            transition: all 0.3s;
            box-shadow: 0 4px 15px rgba(255, 140, 0, 0.4);
        }
        
        button[type="submit"]:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 25px rgba(255, 140, 0, 0.6);
        }
        
        .btn-group {
            display: flex;
            gap: 15px;
            justify-content: center;
            margin-top: 30px;
        }
        
        .btn-borrador {
            background: #555;
            color: #fff;
        }
        
        .seo-info {
            background: rgba(255, 140, 0, 0.1);
            border-left: 4px solid #ff8c00;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            color: #ff8c00;
        }
        
        small { color: #888; }
        
        .success {
            background: rgba(0, 255, 0, 0.1);
            color: #00ff00;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #00ff00;
        }
    </style>
</head>
<body>
    <div class="navbar">
        <h1><i class="fas fa-fire"></i> REDACCIÓN EL FAROL</h1>
        <div class="nav-links">
            <a href="/analytics"><i class="fas fa-chart-line"></i> Analítica</a>
            <a href="/logout" class="btn-logout"><i class="fas fa-sign-out-alt"></i> Cerrar</a>
        </div>
    </div>
    
    <div class="container">
        <div class="seo-info">
            <i class="fas fa-lightbulb"></i> <strong>SEO Pro:</strong> El slug se genera automáticamente. Meta descripción: 150-160 caracteres.
        </div>
        
        {% if success %}
        <div class="success"><i class="fas fa-check-circle"></i> {{ success }}</div>
        {% endif %}
        
        <form method="post" enctype="multipart/form-data" class="editor-section" id="newsForm">
            <h2 style="color: #ff8c00; margin-bottom: 30px;">✍️ REDACTAR NOTICIA</h2>
            
            <div class="form-group">
                <label><i class="fas fa-heading"></i> Título (60 caracteres máx)</label>
                <input type="text" name="titulo" placeholder="Título SEO friendly" maxlength="60" required>
                <small>Recomendado: 50-60 caracteres</small>
            </div>
            
            <div class="form-group">
                <label><i class="fas fa-align-left"></i> Contenido</label>
                <textarea name="resumen" id="editor1" placeholder="Contenido de la noticia..." required></textarea>
            </div>
            
            <div class="form-group">
                <label><i class="fas fa-search"></i> Meta Descripción (160 caracteres máx)</label>
                <textarea name="meta_descripcion" maxlength="160" placeholder="Aparecerá en Google..." style="min-height: 60px;"></textarea>
                <small id="charCount">0/160 caracteres</small>
            </div>
            
            <div class="form-group">
                <label><i class="fas fa-tags"></i> Palabras Clave</label>
                <input type="text" name="keywords" placeholder="olimpo, noticias, farol..." maxlength="500">
            </div>
            
            <div class="form-group">
                <label><i class="fas fa-image"></i> Imagen de Portada</label>
                <div class="file-upload-area" id="uploadArea">
                    <i class="fas fa-cloud-upload-alt" style="font-size: 3rem; color: #ff8c00; margin-bottom: 10px; display: block;"></i>
                    <p>Arrastra una imagen aquí</p>
                    <p style="font-size: 0.9rem; color: #888; margin-top: 5px;">JPG, PNG, GIF (máx. 16MB)</p>
                </div>
                <input type="file" name="foto" id="fotoInput" accept="image/*" required style="display: none;">
            </div>
            
            <div class="form-group">
                <label><i class="fas fa-user"></i> Autor</label>
                <input type="text" name="autor" placeholder="Nombre del autor">
            </div>
            
            <div class="form-group">
                <label><i class="fas fa-robot"></i> Indexable en Google</label>
                <input type="checkbox" name="indexable" value="true" checked style="width: auto; margin-right: 10px;">
                <small style="color: #ff8c00;">Permitir que Google indexe esta noticia</small>
            </div>
            
            <div class="btn-group">
                <button type="submit" name="estado" value="borrador" class="btn-borrador">
                    <i class="fas fa-save"></i> GUARDAR BORRADOR
                </button>
                <button type="submit" name="estado" value="publicada">
                    <i class="fas fa-rocket"></i> PUBLICAR AHORA
                </button>
            </div>
        </form>
    </div>
    
    <script>
        CKEDITOR.replace('editor1', {
            height: 450,
            removeButtons: 'About',
            toolbar: [
                { name: 'basicstyles', items: ['Bold', 'Italic', 'Underline', 'Strike'] },
                { name: 'paragraph', items: ['BulletedList', 'NumberedList', '-', 'Blockquote'] },
                { name: 'links', items: ['Link', 'Unlink'] },
                { name: 'document', items: ['Source'] }
            ],
            versionCheck: false
        });
        
        document.querySelector('textarea[name="meta_descripcion"]').addEventListener('input', function() {
            document.getElementById('charCount').textContent = this.value.length + '/160 caracteres';
        });
        
        const uploadArea = document.getElementById('uploadArea');
        const fotoInput = document.getElementById('fotoInput');
        
        uploadArea.addEventListener('click', () => fotoInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = '#ffaa22';
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.borderColor = '#ff8c00';
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            fotoInput.files = e.dataTransfer.files;
        });
    </script>
</body>
</html>
'''

HTML_PORTADA = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <meta name="description" content="El Farol - Noticias de Olimpo en tiempo real. Información verificada y análisis profundo.">
    <meta name="keywords" content="olimpo, noticias, farol, actualidad, análisis">
    <meta name="author" content="Redacción El Farol">
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
    <meta property="og:type" content="website">
    <meta property="og:title" content="El Farol - Noticias de Olimpo">
    <meta property="og:description" content="El Farol - Noticias de Olimpo en tiempo real">
    <meta property="og:url" content="https://elfarol.olimpo">
    <meta property="twitter:card" content="summary_large_image">
    <link rel="canonical" href="https://elfarol.olimpo/">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏮</text></svg>">
    <title>El Farol | Noticias de Olimpo</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-iecdLmaskl7CVJkEZSMUkrQ6usRd61hmVHambPvXiJ2G/By6SCTQScuHSBIkimT/MfktOLzko6zimDBiZvQvQ==" crossorigin="anonymous" referrerpolicy="no-referrer">
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-V5QW7Y6X8Z"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-V5QW7Y6X8Z');
    </script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            background: #000; 
            color: #fff; 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
        }
        
        .header {
            background: linear-gradient(135deg, #000 0%, #1a1a1a 100%);
            border-bottom: 5px solid #ff8c00;
            padding: 40px 20px;
            text-align: center;
            box-shadow: 0 8px 25px rgba(255, 140, 0, 0.3);
        }
        
        .header h1 { 
            font-size: 3.5rem; 
            color: #ff8c00; 
            font-family: 'Impact', sans-serif;
            margin-bottom: 10px;
            letter-spacing: 3px;
        }
        
        .header p { 
            color: #aaa; 
            font-size: 1rem;
            font-style: italic;
        }
        
        .container { max-width: 950px; margin: auto; padding: 40px 20px; }
        
        .grid-noticias { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 30px; }
        
        .noticia {
            background: #0a0a0a;
            border: 2px solid #222;
            border-radius: 15px;
            overflow: hidden;
            transition: all 0.3s;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
        }
        
        .noticia:hover {
            transform: translateY(-8px);
            border-color: #ff8c00;
            box-shadow: 0 12px 35px rgba(255, 140, 0, 0.3);
        }
        
        .noticia img {
            width: 100%;
            height: 220px;
            object-fit: cover;
            border-bottom: 4px solid #ff8c00;
        }
        
        .contenido { padding: 25px; }
        .contenido h2 { 
            color: #ff8c00; 
            font-size: 1.4rem; 
            margin-bottom: 12px;
            line-height: 1.3;
        }
        
        .contenido p { color: #ccc; font-size: 0.95rem; margin-bottom: 15px; }
        
        .meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.85rem;
            color: #888;
            border-top: 1px solid #333;
            padding-top: 12px;
        }
        
        .fecha { color: #ff8c00; font-weight: bold; }
        
        .footer {
            text-align: center;
            padding: 30px;
            border-top: 2px solid #ff8c00;
            color: #666;
            margin-top: 60px;
        }
        
        .btn-admin {
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: #ff8c00;
            color: #000;
            padding: 15px 25px;
            border-radius: 50px;
            text-decoration: none;
            font-weight: bold;
            box-shadow: 0 4px 15px rgba(255, 140, 0, 0.4);
            transition: all 0.3s;
            z-index: 100;
        }
        
        .btn-admin:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 25px rgba(255, 140, 0, 0.6);
        }
        
        @media (max-width: 768px) {
            .header h1 { font-size: 2.2rem; }
            .grid-noticias { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🏮 EL FAROL</h1>
        <p>Noticias de Olimpo en tiempo real</p>
    </div>
    
    <div class="container">
        {% if noticias %}
            <div class="grid-noticias">
            {% for n in noticias %}
                <article class="noticia" itemscope itemtype="https://schema.org/NewsArticle" onclick="trackView({{ n.id }})">
                    <img src="/uploads/{{ n.multimedia_url }}" alt="{{ n.titulo }}" itemprop="image">
                    <div class="contenido">
                        <h2 itemprop="headline">{{ n.titulo }}</h2>
                        <p itemprop="description">{{ n.meta_descripcion or (n.resumen | striptags | truncate(100)) }}</p>
                        <div class="meta">
                            <time itemprop="datePublished" datetime="{{ n.fecha.isoformat() }}">{{ n.fecha.strftime('%d/%m/%Y') }}</time>
                            <span><i class="fas fa-eye"></i> {{ n.vistas }}</span>
                        </div>
                    </div>
                    <meta itemprop="author" content="{{ n.autor }}">
                </article>
            {% endfor %}
            </div>
        {% else %}
            <div style="text-align: center; padding: 60px 20px; color: #666;">
                <i class="fas fa-newspaper" style="font-size: 4rem; margin-bottom: 20px; color: #ff8c00;"></i>
                <p>Aún no hay noticias publicadas.</p>
            </div>
        {% endif %}
    </div>
    
    <div class="footer">
        <p>&copy; 2026 El Farol - Olimpo | Todos los derechos reservados</p>
    </div>
    
    <a href="/admin" class="btn-admin"><i class="fas fa-lock"></i> REDACCIÓN</a>
    
    <script>
        function trackView(noticiaId) {
            fetch(`/api/track/${noticiaId}`, { method: 'POST' });
        }
    </script>
</body>
</html>
'''

HTML_ANALYTICS = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>📊 Analítica - El Farol</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-iecdLmaskl7CVJkEZSMUkrQ6usRd61hmVHambPvXiJ2G/By6SCTQScuHSBIkimT/MfktOLzko6zimDBiZvQvQ==" crossorigin="anonymous" referrerpolicy="no-referrer">
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
            color: #fff;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        .navbar {
            background: #000;
            border-bottom: 4px solid #ff8c00;
            padding: 20px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .navbar h1 { color: #ff8c00; }
        .btn-back { background: #555; color: #fff; padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; }
        .btn-back:hover { background: #666; }
        
        .container { max-width: 1200px; margin: auto; padding: 30px; }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .stat-card {
            background: #111;
            border: 2px solid #ff8c00;
            border-radius: 15px;
            padding: 25px;
            text-align: center;
        }
        
        .stat-card h3 { color: #ff8c00; margin-bottom: 10px; }
        .stat-card .number { font-size: 2.5rem; font-weight: bold; color: #fff; }
        
        .chart-section {
            background: #111;
            border: 2px solid #ff8c00;
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
        }
        
        .chart-section h3 { color: #ff8c00; margin-bottom: 20px; }
        
        .noticias-ranking {
            background: #111;
            border: 2px solid #ff8c00;
            border-radius: 15px;
            padding: 30px;
        }
        
        .noticias-ranking h3 { color: #ff8c00; margin-bottom: 20px; }
        
        .ranking-item {
            background: #0a0a0a;
            padding: 15px;
            margin-bottom: 10px;
            border-left: 4px solid #ff8c00;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .ranking-item strong { color: #ff8c00; }
    </style>
</head>
<body>
    <div class="navbar">
        <h1><i class="fas fa-chart-line"></i> ANALÍTICA EL FAROL</h1>
        <a href="/panel" class="btn-back"><i class="fas fa-arrow-left"></i> Volver</a>
    </div>
    
    <div class="container">
        <div class="stats-grid">
            <div class="stat-card">
                <h3><i class="fas fa-newspaper"></i> Noticias</h3>
                <div class="number">{{ total_noticias }}</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-eye"></i> Vistas Total</h3>
                <div class="number">{{ total_vistas }}</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-chart-bar"></i> Promedio</h3>
                <div class="number">{{ promedio_vistas }}</div>
            </div>
        </div>
        
        <div class="chart-section">
            <h3>📈 Vistas por Noticia</h3>
            <canvas id="chartVistas"></canvas>
        </div>
        
        <div class="noticias-ranking">
            <h3>🏆 Top 5 Noticias Más Vistas</h3>
            {% for n in top_noticias %}
            <div class="ranking-item">
                <span>{{ loop.index }}. {{ n.titulo[:50] }}</span>
                <strong>{{ n.vistas }} <i class="fas fa-eye"></i></strong>
            </div>
            {% endfor %}
        </div>
    </div>
    
    <script>
        const ctx = document.getElementById('chartVistas').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: {{ labels | tojson }},
                datasets: [{
                    label: 'Vistas',
                    data: {{ data | tojson }},
                    backgroundColor: '#ff8c00',
                    borderColor: '#ffaa22',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { labels: { color: '#fff' } }
                },
                scales: {
                    y: { ticks: { color: '#fff' }, grid: { color: '#333' } },
                    x: { ticks: { color: '#fff' }, grid: { color: '#333' } }
                }
            }
        });
    </script>
</body>
</html>
'''

# ============= RUTAS =============

@app.route('/')
@limiter.limit("100 per hour")
def index():
    """Portada pública"""
    noticias = Noticia.query.filter_by(estado='publicada', indexable=True).order_by(Noticia.fecha.desc()).all()
    return render_template_string(HTML_PORTADA, noticias=noticias)

@app.route('/sitemap.xml')
@limiter.limit("10 per hour")
def sitemap():
    """Sitemap XML para motores de búsqueda"""
    noticias = Noticia.query.filter_by(estado='publicada', indexable=True).all()
    
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    xml += '<url><loc>https://elfarol.olimpo/</loc><lastmod>' + datetime.utcnow().isoformat() + '</lastmod><priority>1.0</priority></url>\n'
    
    for noticia in noticias:
        xml += f'<url>\n<loc>https://elfarol.olimpo/noticia/{noticia.slug}</loc>\n'
        xml += f'<lastmod>{noticia.fecha_modificacion.isoformat()}</lastmod>\n'
        xml += f'<changefreq>weekly</changefreq>\n<priority>0.8</priority>\n</url>\n'
    
    xml += '</urlset>'
    response = make_response(xml)
    response.headers['Content-Type'] = 'application/xml; charset=utf-8'
    return response

@app.route('/robots.txt')
def robots():
    """Archivo robots.txt"""
    robots_txt = """User-agent: *
Allow: /
Allow: /sitemap.xml
Disallow: /admin
Disallow: /panel
Disallow: /analytics
Disallow: /api/
Disallow: /*.php

Sitemap: https://elfarol.olimpo/sitemap.xml

User-agent: Googlebot
Allow: /
Crawl-delay: 1
"""
    response = make_response(robots_txt)
    response.headers['Content-Type'] = 'text/plain; charset=utf-8'
    return response

@app.route('/admin', methods=['GET', 'POST'])
@limiter.limit("5 per minute")
def admin():
    """Página de login"""
    if request.method == 'POST':
        usuario = request.form.get('u', '').strip()
        clave = request.form.get('p', '')
        
        user = Usuario.query.filter_by(username=usuario).first()
        
        if user and user.activo and check_password_hash(user.password_hash, clave):
            session.permanent = True
            session['user_id'] = user.id
            session['username'] = usuario
            user.ultimo_acceso = datetime.utcnow()
            db.session.commit()
            
            registrar_auditoria('Login exitoso', f'Usuario: {usuario}')
            return redirect(url_for('panel'))
        else:
            registrar_auditoria('Login fallido', f'Usuario: {usuario}', estado='fallido')
            error = 'Usuario o contraseña inválidos'
            return render_template_string(HTML_LOGIN, error=error)
    
    return render_template_string(HTML_LOGIN)

@app.route('/logout')
def logout():
    """Cerrar sesión"""
    usuario = session.get('username', 'desconocido')
    registrar_auditoria('Logout', f'Usuario: {usuario}')
    session.clear()
    return redirect(url_for('index'))

@app.route('/panel', methods=['GET', 'POST'])
@limiter.limit("20 per hour")
@login_required
def panel():
    """Panel de redacción"""
    if request.method == 'POST':
        titulo = request.form.get('titulo', '').strip()
        resumen = request.form.get('resumen', '').strip()
        meta_descripcion = request.form.get('meta_descripcion', '').strip()
        keywords = request.form.get('keywords', '').strip()
        autor = request.form.get('autor', 'Redacción').strip()
        estado = request.form.get('estado', 'publicada')
        indexable = request.form.get('indexable') == 'true'
        foto = request.files.get('foto')
        
        if not titulo or not resumen or not foto:
            return render_template_string(HTML_PANEL, error='Faltan datos requeridos')
        
        slug = generate_slug(titulo)
        if Noticia.query.filter_by(slug=slug).first():
            slug = f"{slug}-{int(datetime.utcnow().timestamp())}"
        
        resumen_sanitizado = sanitize_html(resumen)
        
        if foto and allowed_file(foto.filename):
            filename = secure_filename(f"noticia_{int(datetime.utcnow().timestamp())}_{foto.filename}")
            foto.save(os.path.join(UPLOAD_FOLDER, filename))
            
            noticia = Noticia(
                titulo=titulo,
                resumen=resumen_sanitizado,
                contenido_html=resumen_sanitizado,
                meta_descripcion=meta_descripcion,
                keywords=keywords,
                slug=slug,
                multimedia_url=filename,
                autor=autor,
                estado=estado,
                indexable=indexable,
                usuario_id=session.get('user_id')
            )
            db.session.add(noticia)
            db.session.commit()
            
            registrar_auditoria('Noticia creada', f'Título: {titulo}, Estado: {estado}')
            
            if estado == 'publicada':
                return redirect(url_for('index'))
            else:
                return render_template_string(HTML_PANEL, success='✅ Noticia guardada como borrador')
    
    return render_template_string(HTML_PANEL)

@app.route('/analytics')
@login_required
def analytics():
    """Dashboard de analítica"""
    data = get_analytics_data()
    return render_template_string(HTML_ANALYTICS, **data)

@app.route('/api/track/<int:noticia_id>', methods=['POST'])
@limiter.limit("100 per hour")
def track_view(noticia_id):
    """Registra vista de noticia"""
    noticia = Noticia.query.get(noticia_id)
    if noticia:
        noticia.vistas += 1
        
        analytic = Analytics(
            noticia_id=noticia_id,
            ip_address=request.remote_addr,
            referer=request.referrer,
            user_agent=request.user_agent.string
        )
        db.session.add(analytic)
        db.session.commit()
    
    return jsonify({'status': 'ok'}), 200

@app.route('/uploads/<filename>')
@limiter.limit("200 per hour")
def uploaded_file(filename):
    """Servir archivos subidos"""
    return send_from_directory(UPLOAD_FOLDER, filename)

# ============= MANEJO DE ERRORES =============

@app.errorhandler(404)
def not_found(e):
    return '''
    <html><head><title>404</title><style>body{background:#000;color:#fff;text-align:center;padding-top:100px;font-family:sans-serif;}</style></head>
    <body><h1 style="color:#ff8c00;">404</h1><p>Página no encontrada</p><a href="/" style="color:#ff8c00;">Volver</a></body></html>
    ''', 404

@app.errorhandler(500)
def server_error(e):
    return '''
    <html><head><title>500</title><style>body{background:#000;color:#fff;text-align:center;padding-top:100px;font-family:sans-serif;}</style></head>
    <body><h1 style="color:#ff8c00;">500</h1><p>Error del servidor</p><a href="/" style="color:#ff8c00;">Volver</a></body></html>
    ''', 500

@app.errorhandler(429)
def ratelimit_handler(e):
    return '''
    <html><head><title>429</title><style>body{background:#000;color:#fff;text-align:center;padding-top:100px;font-family:sans-serif;}</style></head>
    <body><h1 style="color:#ff8c00;">429</h1><p>Demasiadas solicitudes. Intenta más tarde.</p></body></html>
    ''', 429

# ============= MAIN =============

if __name__ == "__main__":
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
