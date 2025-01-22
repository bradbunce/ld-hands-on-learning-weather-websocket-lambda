const { getConnection } = require('./database');

const getWeatherForLocation = async (location) => {
  let connection;
  try {
    console.log('Fetching weather for location:', {
      locationId: location.location_id,
      cityName: location.city_name,
      timestamp: new Date().toISOString()
    });
    
    connection = await getConnection('read');

    // Get current weather from cache
    const [weatherRows] = await connection.query(`
      SELECT 
        w.*,
        l.name,
        l.country_code,
        l.latitude,
        l.longitude,
        l.timezone
      FROM weather_cache w
      JOIN locations l ON w.location_id = l.location_id
      WHERE l.location_id = ?
    `, [location.location_id]);

    if (weatherRows.length === 0) {
      throw new Error(`No weather data found for location: ${location.city_name || location.location_id}`);
    }

    const weatherData = weatherRows[0];

    // Format the data to match your existing data processor's expectations
    return {
      locationId: location.location_id,
      locationName: weatherData.name || location.city_name,
      temperature: weatherData.temp_f,
      condition: weatherData.condition_text,
      humidity: weatherData.humidity,
      windSpeed: weatherData.wind_mph,
      feelsLike: weatherData.feelslike_f,
      timestamp: weatherData.last_updated.toISOString(),
      coordinates: {
        latitude: weatherData.latitude,
        longitude: weatherData.longitude
      },
      metadata: {
        country: weatherData.country_code,
        timezone: weatherData.timezone,
        provider: "MySQL Database"
      }
    };
  } catch (error) {
    console.error('Error fetching weather for location:', {
      locationId: location.location_id,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    return {
      locationId: location.location_id,
      locationName: location.city_name,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const getWeatherUpdates = async (locations) => {
  console.log('Fetching weather updates for locations:', {
    locationCount: locations.length,
    locationIds: locations.map(l => l.location_id),
    timestamp: new Date().toISOString()
  });

  if (!Array.isArray(locations) || locations.length === 0) {
    console.warn('No locations provided for weather updates');
    return [];
  }

  const results = await Promise.all(
    locations.map(location => getWeatherForLocation(location))
  );

  return results;
};

const getWeatherForSubscriptions = async (subscriptions) => {
  try {
    console.log('Fetching weather data for subscriptions:', {
      subscriptionCount: subscriptions.length,
      timestamp: new Date().toISOString()
    });

    const locations = subscriptions.map(sub => ({
      location_id: sub.location_id,
      city_name: sub.location_name
    }));

    const weatherData = await getWeatherUpdates(locations);

    // Map weather data to subscriptions
    return subscriptions.map(subscription => {
      const locationWeather = weatherData.find(data => 
        data.locationId === subscription.location_id
      );

      return {
        connection_id: subscription.connection_id,
        weather: locationWeather || {
          locationId: subscription.location_id,
          locationName: subscription.location_name,
          error: "No weather data available",
          timestamp: new Date().toISOString()
        }
      };
    });
  } catch (error) {
    console.error('Error fetching subscription weather data:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

module.exports = {
  getWeatherUpdates,
  getWeatherForLocation,
  getWeatherForSubscriptions
};