/**
 * 🔍 NEWS HUNTER - Buscador inteligente de noticias
 * Busca en Google las noticias más relevantes por categoría
 */

const axios = require('axios');

class NewsHunter {
    constructor(googleApiKey, searchEngineId) {
        this.apiKey = googleApiKey;
        this.searchEngineId = searchEngineId;
    }

    async buscarEnGoogle(query, cantidad = 3) {
        try {
            if (!this.apiKey || !this.searchEngineId) {
                console.log('⚠️ Sin Google APIs, usando datos simulados');
                return this.buscarMock(query);
            }

            const url = 'https://www.googleapis.com/customsearch/v1';
            const params = {
                key: this.apiKey,
                cx: this.searchEngineId,
                q: query,
                num: cantidad,
                dateRestrict: 'd1'
            };

            const response = await axios.get(url, { params, timeout: 5000 });
            
            if (!response.data.items) {
                return this.buscarMock(query);
            }

            return response.data.items.map(item => ({
                titulo: item.title,
                url: item.link,
                snippet: item.snippet,
                fecha: new Date()
            }));
        } catch (error) {
            console.error('❌ Error búsqueda:', error.message);
            return this.buscarMock(query);
        }
    }

    buscarMock(query) {
        const resultados = {
            'noticias dominicana': [
                { titulo: 'Gobierno anuncia nuevo programa nacional', snippet: 'Las autoridades dominicanas anunciaron...', url: '#' },
                { titulo: 'Crisis política genera debates intensos', snippet: 'En el congreso se intensifican los debates...', url: '#' },
                { titulo: 'Economía muestra recuperación importante', snippet: 'El PIB del país creció significativamente...', url: '#' }
            ],
            'política república dominicana': [
                { titulo: 'Candidato declara sus intenciones políticas', snippet: 'En una conferencia de prensa...', url: '#' },
                { titulo: 'Reformas legislativas generan polémica', snippet: 'El congreso debate cambios importantes...', url: '#' },
                { titulo: 'Cambios en el gabinete presidencial', snippet: 'Se confirmaron varios cambios...', url: '#' }
            ],
            'economía dominicana': [
                { titulo: 'Peso dominicano se fortalece frente dólar', snippet: 'El tipo de cambio mostró...', url: '#' },
                { titulo: 'Sector turismo recupera dinamismo', snippet: 'Las llegadas de turistas aumentaron...', url: '#' },
                { titulo: 'Inversión extranjera en crecimiento', snippet: 'Nuevos proyectos fueron confirmados...', url: '#' }
            ],
            'béisbol dominicano': [
                { titulo: 'Águilas Cibaeñas avanzan en playoffs', snippet: 'En una emocionante jornada...', url: '#' },
                { titulo: 'Estrellas dominicanas brillan en MLB', snippet: 'Los jugadores dominicanos...', url: '#' },
                { titulo: 'Nueva era en Liga Dominicana', snippet: 'Se esperan cambios importantes...', url: '#' }
            ]
        };

        for (const [key, value] of Object.entries(resultados)) {
            if (query.toLowerCase().includes(key)) {
                return value.map(item => ({
                    ...item,
                    fecha: new Date()
                }));
            }
        }

        return resultados['noticias dominicana'];
    }
}

module.exports = NewsHunter;
