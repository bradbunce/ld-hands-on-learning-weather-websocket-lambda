const processWeatherData = async (weatherData) => {
    try {
        return weatherData.map(location => ({
            id: location.id,
            name: location.name,
            weather: {
                temperature: location.current.temp_c,
                condition: location.current.condition.text,
                icon: location.current.condition.icon,
                humidity: location.current.humidity,
                windSpeed: location.current.wind_kph,
                feelsLike: location.current.feelslike_c,
                lastUpdated: location.current.last_updated
            }
        }));
    } catch (error) {
        console.error('Error processing weather data:', error);
        throw error;
    }
};

module.exports = {
    processWeatherData
};