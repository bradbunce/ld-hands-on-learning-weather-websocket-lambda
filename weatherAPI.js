const axios = require('axios');

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_BASE_URL = 'http://api.weatherapi.com/v1';

if (!WEATHER_API_KEY) {
    throw new Error('WEATHER_API_KEY environment variable is required');
}

const formatWeatherData = (weatherData, location) => {
    try {
        return {
            // Try multiple variations of location name
            locationName: location.city_name || location.name || 
                          weatherData.location.name || 
                          (location.latitude && location.longitude 
                           ? `${location.latitude},${location.longitude}` 
                           : 'Unknown Location'),
            locationId: location.location_id,
            name: location.city_name || location.name || weatherData.location.name, // Add this line
            temperature: weatherData.current.temp_c,
            condition: weatherData.current.condition.text,
            humidity: weatherData.current.humidity,
            windSpeed: weatherData.current.wind_kph,
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
};

const getLocationQuery = (location) => {
    // Check for coordinate variations, converting string to number
    const lat = location.latitude 
        ? (typeof location.latitude === 'string' ? parseFloat(location.latitude) : location.latitude)
        : (location.lat ? parseFloat(location.lat) : null);
    
    const lon = location.longitude 
        ? (typeof location.longitude === 'string' ? parseFloat(location.longitude) : location.longitude)
        : (location.lon ? parseFloat(location.lon) : null);

    // Comprehensive coordinates check
    if (lat && lon) {
        return `${lat},${lon}`;
    }
    
    // Check for coordinate-like nested object
    if (location.coordinates && location.coordinates.lat && location.coordinates.lon) {
        return `${location.coordinates.lat},${location.coordinates.lon}`;
    }
    
    // Check for name variations with optional country code for precision
    if (location.name || location.city_name) {
        // Prioritize city_name and country_code if both are available
        if (location.city_name && location.country_code) {
            return `${location.city_name}, ${location.country_code}`;
        }
        return location.name || location.city_name;
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
    // Extremely detailed logging of input locations
    console.log('Locations FULL DETAILS before processing:', JSON.stringify(locations, null, 2));
    console.log('Location types:', locations.map(loc => Object.keys(loc)));

    if (!Array.isArray(locations) || locations.length === 0) {
        console.warn('No locations provided for weather updates');
        return [];
    }

    // Add overall timeout for all weather updates
    const weatherPromises = locations.map(location => {
        console.log('Processing individual location:', JSON.stringify(location, null, 2));
        return getWeatherForLocation(location)
            .catch(error => {
                console.error('FULL Weather fetch error for location:', {
                    location: JSON.stringify(location, null, 2),
                    errorMessage: error.message,
                    errorStack: error.stack
                });
                return {
                    locationName: location.name || location.city_name || getLocationQuery(location),
                    error: error.message,
                    timestamp: new Date().toISOString()
                };
            });
    });

    // Race between all weather updates and a global timeout
    const results = await Promise.race([
        Promise.all(weatherPromises),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Weather updates global timeout')), 20000)
        )
    ]);

    // Detailed logging of results
    console.log('Weather updates results:', JSON.stringify(results, null, 2));

    // Log any errors that occurred
    results.forEach(result => {
        if (result.error) {
            console.error('Weather fetch failed for location:', result);
        }
    });

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
