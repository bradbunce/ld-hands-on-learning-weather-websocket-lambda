const { getConnection } = require('./database');

const getWeatherForLocation = async (location) => {
  let connection;
  try {
    console.log('Fetching weather for location:', {
      locationId: location.location_id,
      timestamp: new Date().toISOString()
    });
    
    connection = await getConnection('read');

    // Get current weather from cache and location details
    const [weatherRows] = await connection.query(`
      SELECT 
        w.*,
        l.name,
        l.region,
        l.country,
        l.country_code,
        l.latitude,
        l.longitude,
        l.timezone
      FROM weather_cache w
      JOIN locations l ON w.location_id = l.location_id
      WHERE w.location_id = ?
      AND w.last_updated > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    `, [location.location_id]);

    if (weatherRows.length === 0) {
      throw new Error(`No recent weather data found for location ID: ${location.location_id}`);
    }

    const weatherData = weatherRows[0];

    // Format the data to match your existing data processor's expectations
    return {
      locationId: location.location_id,
      locationName: weatherData.name,
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
        region: weatherData.region,
        country: weatherData.country,
        country_code: weatherData.country_code,
        timezone: weatherData.timezone,
        provider: "Database Cache"
      },
      details: {
        is_day: weatherData.is_day,
        condition_code: weatherData.condition_code,
        condition_icon: weatherData.condition_icon,
        wind_kph: weatherData.wind_kph,
        wind_degree: weatherData.wind_degree,
        wind_dir: weatherData.wind_dir,
        pressure_mb: weatherData.pressure_mb,
        pressure_in: weatherData.pressure_in,
        precip_mm: weatherData.precip_mm,
        precip_in: weatherData.precip_in,
        cloud: weatherData.cloud,
        vis_km: weatherData.vis_km,
        vis_miles: weatherData.vis_miles,
        uv: weatherData.uv,
        gust_mph: weatherData.gust_mph,
        gust_kph: weatherData.gust_kph
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
      location_id: sub.location_id
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