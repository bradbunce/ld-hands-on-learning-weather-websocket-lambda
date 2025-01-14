const axios = require('axios');

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_BASE_URL = 'http://api.weatherapi.com/v1';

if (!WEATHER_API_KEY) {
    throw new Error('WEATHER_API_KEY environment variable is required');
}

const formatWeatherData = (weatherData, location) => {
    try {
        // Explicitly check for required properties
        if (!location.city_name) {
            throw new Error('Location must have city_name');
        }

        return {
            locationName: location.city_name,
            locationId: location.location_id,
            temperature: weatherData.current.temp_f,
            condition: weatherData.current.condition.text,
            humidity: weatherData.current.humidity,
            windSpeed: weatherData.current.wind_mph,
            timestamp: new Date().toISOString(),
            // Additional data that might be useful
            feelsLike: weatherData.current.feelslike_c,
            windDirection: weatherData.current.wind_dir,
            pressure: weatherData.current.pressure_mb,
            precipitation: weatherData.current.precip_mm,
            cloud: weatherData.current.cloud,
            uv: weatherData.current.uv
        };
    } catch (error) {
        console.error('Error formatting weather data:', {
            error: error.message,
            location,
            weatherData
        });
        throw new Error('Invalid weather data format received from API');
    }
};

const getLocationQuery = (location) => {
    // Check for coordinate variations, converting string to number
    const lat = location.latitude 
        ? (typeof location.latitude === 'string' ? parseFloat(location.latitude) : location.latitude)
        : null;
    
    const lon = location.longitude 
        ? (typeof location.longitude === 'string' ? parseFloat(location.longitude) : location.longitude)
        : null;

    // Comprehensive coordinates check
    if (lat && lon) {
        return `${lat},${lon}`;
    }
    
    // Check for name variations with country code
    if (location.city_name && location.country_code) {
        return `${location.city_name}, ${location.country_code}`;
    }
    
    // Detailed error logging
    console.error('Invalid location object received:', JSON.stringify(location, null, 2));
    throw new Error('Location must have either coordinates or name');
};

const getWeatherForLocation = async (location) => {
    try {
        console.log('Fetching weather for location:', location);

        const query = getLocationQuery(location);
        const response = await Promise.race([
            axios.get(`${WEATHER_API_BASE_URL}/current.json`, {
                params: {
                    key: WEATHER_API_KEY,
                    q: query
                },
                timeout: 10000 // 10 second timeout
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Weather API request timeout')), 10000)
            )
        ]);

        console.log('Weather API raw response:', {
            data: JSON.stringify(response.data),
            status: response.status,
            locationName: location.city_name
        });

        console.log('Weather API response received for:', location.name || query);
        return formatWeatherData(response.data, location);
    } catch (error) {
        console.error('Error fetching weather for location:', {
            location: location.name || getLocationQuery(location),
            error: error.message,
            status: error.response?.status,
            data: error.response?.data
        });

        // Throw specific errors based on the response
        if (error.response?.status === 400) {
            throw new Error(`Invalid location: ${location.name || getLocationQuery(location)}`);
        }
        if (error.response?.status === 401) {
            throw new Error('Invalid API key');
        }
        if (error.response?.status === 403) {
            throw new Error('API key has exceeded its rate limit');
        }
        
        throw new Error('Failed to fetch weather data');
    }
};

const getWeatherUpdates = async (locations) => {
    console.log('Locations before processing:', JSON.stringify(locations, null, 2));

    if (!Array.isArray(locations) || locations.length === 0) {
        console.warn('No locations provided for weather updates');
        return [];
    }

    console.log('Fetching weather updates for locations:', locations);

    // Add overall timeout for all weather updates
    const weatherPromises = locations.map(location => 
        getWeatherForLocation(location)
            .catch(error => {
                console.error('Weather fetch error for location:', {
                    location,
                    errorMessage: error.message,
                    errorStack: error.stack
                });
                throw error; // Re-throw to prevent silent failures
            })
    );

    // Race between all weather updates and a global timeout
    const results = await Promise.race([
        Promise.all(weatherPromises),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Weather updates global timeout')), 20000)
        )
    ]);

    return results;
};

// Cache weather data with TTL
const weatherCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getCachedWeather = async (locations, forceFresh = false) => {
    const now = Date.now();
    const results = [];

    for (const location of locations) {
        const cacheKey = getLocationQuery(location);
        const cached = weatherCache.get(cacheKey);

        if (!forceFresh && cached && (now - cached.timestamp) < CACHE_TTL) {
            results.push(cached.data);
        } else {
            try {
                const freshData = await getWeatherForLocation(location);
                weatherCache.set(cacheKey, {
                    data: freshData,
                    timestamp: now
                });
                results.push(freshData);
            } catch (error) {
                console.error('Error fetching fresh weather data:', error);
                if (cached) {
                    // Use stale cache if fresh fetch fails
                    results.push({
                        ...cached.data,
                        isStale: true
                    });
                } else {
                    results.push({
                        locationName: location.name || getLocationQuery(location),
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }
    }

    return results;
};

module.exports = {
    getWeatherUpdates,
    getCachedWeather,
    getWeatherForLocation
};
