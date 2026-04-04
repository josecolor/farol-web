const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function sincronizarGoogleConsole() {
    console.log('📊 Conectando con Google Search Console, mxl...');
    
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, 'google-creds.json'), // El archivo que creaste
            scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
        });

        const authClient = await auth.getClient();
        const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });

        // Pedimos los datos de los últimos 3 días
        const res = await searchconsole.searchanalytics.query({
            siteUrl: 'https://elfarolaldia.com/', // Asegúrate que sea tu URL exacta
            requestBody: {
                startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                endDate: new Date().toISOString().split('T')[0],
                dimensions: ['query'],
                rowLimit: 10
            }
        });

        const keywords = res.data.rows ? res.data.rows.map(r => r.keys[0]) : [];
        
        // Creamos la estrategia para Gemini
        const estrategiaActualizada = {
            ultima_actualizacion: new Date().toLocaleString(),
            tendencias_reales: keywords,
            instruccion_ia: `Usa estas palabras para subir el SEO: ${keywords.join(', ')}. Si ves temas de 'Juegos 2030' o 'Sargazo' flojos, dales prioridad.`
        };

        fs.writeFileSync(path.join(__dirname, 'estrategia.json'), JSON.stringify(estrategiaActualizada, null, 2));
        console.log('✅ Estrategia actualizada con datos reales de Google.');

    } catch (error) {
        console.error('❌ Error en la conexión:', error.message);
    }
}

sincronizarGoogleConsole();
