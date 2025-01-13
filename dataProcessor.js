const processWeatherData = async (weatherData) => {
    if (!Array.isArray(weatherData)) {
        console.error('Weather data must be an array');
        throw new Error('Invalid weather data format');
    }

    try {
        return weatherData.map(location => {
            // Handle error cases where the location fetch failed
            if (location.error) {
                return {
                    id: location.locationId,
                    name: location.locationName,
                    error: location.error,
                    timestamp: location.timestamp
                };
            }

            try {
                // Check if we're dealing with raw API data or our cached format
                const current = location.current || location.weather;
                const locationName = location.name || location.locationName;

                if (!current) {
                    throw new Error('No weather data available');
                }

                return {
                    id: location.id || location.locationId,
                    name: locationName,
                    weather: {
                        temperature: current.temp_c || current.temperature,
                        condition: current.condition?.text || current.condition,
                        icon: current.condition?.icon || current.icon,
                        humidity: current.humidity,
                        windSpeed: current.wind_kph || current.windSpeed,
                        feelsLike: current.feelslike_c || current.feelsLike,
                        lastUpdated: current.last_updated || location.timestamp || new Date().toISOString()
                    },
                    coordinates: location.latitude && location.longitude ? {
                        latitude: location.latitude,
                        longitude: location.longitude
                    } : undefined,
                    metadata: {
                        country: location.country || location.country_code,
                        timezone: location.timezone,
                        localTime: location.localtime,
                        cached: !!location.cached,
                        provider: 'WeatherAPI.com'
                    }
                };
            } catch (locationError) {
                console.error('Error processing individual location:', {
                    location: location.name || location.locationName,
                    error: locationError.message
                });

                // Return error state for this location
                return {
                    id: location.id || location.locationId,
                    name: location.name || location.locationName,
                    error: 'Failed to process weather data',
                    timestamp: new Date().toISOString()
                };
            }
        });
    } catch (error) {
        console.error('Error processing weather data:', error);
        throw new Error('Failed to process weather data: ' + error.message);
    }
};

// Validate individual weather data fields
const validateWeatherData = (weatherData) => {
    if (!weatherData || typeof weatherData !== 'object') {
        throw new Error('Invalid weather data object');
    }

    const required = ['temperature', 'condition', 'humidity', 'windSpeed'];
    const missing = required.filter(field => {
        const value = weatherData[field];
        return value === undefined || value === null || value === '';
    });

    if (missing.length > 0) {
        throw new Error(`Missing required weather fields: ${missing.join(', ')}`);
    }

    // Validate numeric fields
    if (isNaN(weatherData.temperature) || 
        isNaN(weatherData.humidity) || 
        isNaN(weatherData.windSpeed)) {
        throw new Error('Invalid numeric values in weather data');
    }

    // Validate ranges
    if (weatherData.humidity < 0 || weatherData.humidity > 100) {
        throw new Error('Invalid humidity value');
    }

    if (weatherData.windSpeed < 0) {
        throw new Error('Invalid wind speed value');
    }

    return true;
};

// Format weather data for database caching
const formatWeatherForCache = (processedData) => {
    return processedData.map(location => ({
        locationId: location.id,
        locationName: location.name,
        weatherData: location.error ? null : {
            temperature: location.weather?.temperature,
            condition: location.weather?.condition,
            icon: location.weather?.icon,
            humidity: location.weather?.humidity,
            windSpeed: location.weather?.windSpeed,
            feelsLike: location.weather?.feelsLike,
            lastUpdated: location.weather?.lastUpdated
        },
        error: location.error || null,
        timestamp: new Date().toISOString()
    }));
};

module.exports = {
    processWeatherData,
    validateWeatherData,
    formatWeatherForCache
};