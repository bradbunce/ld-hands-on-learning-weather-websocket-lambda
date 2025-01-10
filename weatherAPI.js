const axios = require('axios');

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_BASE_URL = 'http://api.weatherapi.com/v1';

const getWeatherUpdates = async (locations) => {
    try {
        const weatherPromises = locations.map(location => 
            axios.get(`${WEATHER_API_BASE_URL}/current.json`, {
                params: {
                    key: WEATHER_API_KEY,
                    q: `${location.latitude},${location.longitude}`
                }
            })
        );
        
        const responses = await Promise.all(weatherPromises);
        return responses.map(response => response.data);
    } catch (error) {
        console.error('Error fetching weather data:', error);
        throw error;
    }
};

module.exports = {
    getWeatherUpdates
};