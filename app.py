# --- DISEÑO MAESTRO RESTABLECIDO: NARANJA Y NEGRO ---

html_portada = '''
<!DOCTYPE html>
<html lang="es">
<head>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-V5QW7Y6X8Z"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-V5QW7Y6X8Z');
    </script>

    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>El Farol | La Luz de la Información</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; margin: 0; }
        
        /* BARRA SUPERIOR NEGRA */
        .top-bar { background: #000; border-bottom: 1px solid #222; padding: 10px 0; }
        
        /* NAVBAR CON EL NARANJA OFICIAL */
        .navbar { border-bottom: 3px solid #ff8c00; background-color: #000 !important; }
        .navbar-brand { 
            color: #ff8c00 !important; 
            font-size: 2.2rem; 
            font-weight: 900; 
            font-family: 'Impact', sans-serif; 
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        
        /* BOTÓN ARMY NARANJA */
        .btn-army { 
            background: #ff8c00; 
            color: #000; 
            font-weight: bold; 
            border-radius: 5px; 
            padding: 8px 18px; 
            text-decoration: none; 
            display: inline-block;
            transition: 0.3s;
        }
        .btn-army:hover { background: #e67e00; color: #000; transform: scale(1.05); }

        /* TARJETAS DE NOTICIAS */
        .card-noticia { 
            background: #151515; 
            border: 1px solid #252525; 
            border-radius: 12px; 
            margin-bottom: 25px; 
            transition: 0.3s; 
        }
        .card-noticia:hover { border-color: #ff8c00; }
        .badge-seo { color: #ff8c00; font-size: 0.7rem; font-weight: bold; text-transform: uppercase; }
        
        /* RESPONSIVE */
        @media (max-width: 600px) {
            .navbar-brand { font-size: 1.7rem; }
            .top-container { flex-direction: column; gap: 10px; text-align: center; }
            .btn-army { width: 100%; }
        }
    </style>
</head>
<body>

<div class="top-bar">
    <div class="container d-flex justify-content-between align-items-center top-container">
        <div id="google_translate_element"></div>
        <a href="/admin" class="btn-army">UNIRSE AL ARMY 🚨</a>
    </div>
</div>

<nav class="navbar navbar-dark mb-4 shadow-lg">
    <div class="container text-center">
        <a class="navbar-brand mx-auto" href="/">🏮 EL FAROL</a>
    </div>
</nav>

<div class="container">
    <div class="row">
        {% if noticias %}
            {% for noticia in noticias %}
                <div class="col-12 col-md-6 col-lg-4">
                    <div class="card card-noticia shadow">
                        <img src="/uploads/{{ noticia.multimedia_url }}" class="card-img-top" style="height:220px; object-fit:cover; border-bottom: 2px solid #ff8c00;">
                        <div class="card-body">
                            <h5 class="text-white fw-bold">{{ noticia.titulo }}</h5>
                            <div class="card-text text-muted small mb-2">{{ noticia.resumen|safe }}</div>
                            <div class="d-flex justify-content-between align-items-center mt-3">
                                <span class="badge-seo">#{{ noticia.keywords }}</span>
                                <small class="text-warning" style="font-size:0.7rem;">{{ noticia.fecha.strftime('%d %b') }}</small>
                            </div>
                        </div>
                    </div>
                </div>
            {% endfor %}
        {% else %}
            <div class="col-12 text-center py-5">
                <h3 style="color: #ff8c00;">🏮 Esperando la próxima exclusiva...</h3>
            </div>
        {% endif %}
    </div>
</div>

<script type="text/javascript">
function googleTranslateElementInit() {
  new google.translate.TranslateElement({pageLanguage: 'es', layout: google.translate.TranslateElement.InlineLayout.SIMPLE}, 'google_translate_element');
}
</script>
<script type="text/javascript" src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>

</body>
</html>
'''
