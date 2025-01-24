const processWeatherData = async (weatherData) => {
  if (!Array.isArray(weatherData)) {
      throw new Error("Invalid weather data format");
  }

  try {
      const processed = weatherData.map((location) => {
          if (location.error) {
              return {
                  id: location.locationId,
                  name: location.locationName,
                  error: location.error,
                  timestamp: location.timestamp,
              };
          }

          try {
              // Map DB data (from weather_cache table)
              if (location.temperature !== undefined) {
                  console.log('Processing DB weather data:', location);
                  return {
                      id: location.location_id,
                      name: location.name,
                      weather: {
                          temp_f: location.temperature,
                          condition_text: location.condition,
                          humidity: location.humidity,
                          wind_mph: location.wind_speed,
                          feelslike_f: location.feels_like,
                          last_updated: location.last_updated,
                          is_day: location.is_day,
                          condition_code: location.condition_code,
                          condition_icon: location.condition_icon,
                          wind_degree: location.wind_degree,
                          wind_dir: location.wind_dir,
                          pressure_mb: location.pressure_mb,
                          pressure_in: location.pressure_in,
                          precip_mm: location.precip_mm,
                          precip_in: location.precip_in,
                          cloud: location.cloud,
                          vis_km: location.vis_km,
                          vis_miles: location.vis_miles,
                          uv: location.uv,
                          gust_mph: location.gust_mph,
                          gust_kph: location.gust_kph
                      },
                      coordinates: {
                          latitude: location.latitude,
                          longitude: location.longitude
                      },
                      metadata: {
                          region: location.region,
                          country: location.country,
                          country_code: location.country_code,
                          timezone: location.timezone
                      }
                  };
              }
              
              // Map API data
              if (location.current) {
                  console.log('Processing API weather data:', location);
                  return {
                      id: location.id || location.locationId,
                      name: location.name || location.locationName,
                      weather: {
                          temp_f: location.current.temp_f,
                          condition_text: location.current.condition?.text,
                          humidity: location.current.humidity,
                          wind_mph: location.current.wind_mph,
                          feelslike_f: location.current.feelslike_f,
                          last_updated: location.current.last_updated,
                          is_day: location.current.is_day,
                          condition_code: location.current.condition?.code,
                          condition_icon: location.current.condition?.icon,
                          wind_degree: location.current.wind_degree,
                          wind_dir: location.current.wind_dir,
                          pressure_mb: location.current.pressure_mb,
                          pressure_in: location.current.pressure_in,
                          precip_mm: location.current.precip_mm,
                          precip_in: location.current.precip_in,
                          cloud: location.current.cloud,
                          vis_km: location.current.vis_km,
                          vis_miles: location.current.vis_miles,
                          uv: location.current.uv,
                          gust_mph: location.current.gust_mph,
                          gust_kph: location.current.gust_kph
                      },
                      coordinates: location.latitude && location.longitude ? {
                          latitude: location.latitude,
                          longitude: location.longitude
                      } : undefined,
                      metadata: {
                          region: location.region,
                          country: location.country,
                          country_code: location.country_code,
                          timezone: location.timezone,
                          localTime: location.localtime
                      }
                  };
              }

              throw new Error("No weather data available");
          } catch (locationError) {
              console.error("Error processing location:", locationError);
              return {
                  id: location.locationId,
                  name: location.locationName,
                  error: "Failed to process weather data",
                  timestamp: new Date().toISOString(),
              };
          }
      });

      console.log('Processed weather data:', processed);
      return processed;
  } catch (error) {
      throw new Error("Failed to process weather data: " + error.message);
  }
};

// Validate individual weather data fields
const validateWeatherData = (weatherData) => {
  if (!weatherData || typeof weatherData !== "object") {
    throw new Error("Invalid weather data object");
  }

  const required = ["temperature", "condition", "humidity", "windSpeed"];
  const missing = required.filter((field) => {
    const value = weatherData[field];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw new Error(`Missing required weather fields: ${missing.join(", ")}`);
  }

  // Validate numeric fields
  if (
    isNaN(weatherData.temperature) ||
    isNaN(weatherData.humidity) ||
    isNaN(weatherData.windSpeed)
  ) {
    throw new Error("Invalid numeric values in weather data");
  }

  // Validate ranges
  if (weatherData.humidity < 0 || weatherData.humidity > 100) {
    throw new Error("Invalid humidity value");
  }

  if (weatherData.windSpeed < 0) {
    throw new Error("Invalid wind speed value");
  }

  return true;
};

// Format weather data for database caching
const formatWeatherForCache = (processedData) => {
  return processedData.map((location) => ({
    locationId: location.id,
    locationName: location.name,
    weatherData: location.error
      ? null
      : {
          temperature: location.weather?.temperature,
          condition: location.weather?.condition,
          icon: location.weather?.icon,
          humidity: location.weather?.humidity,
          windSpeed: location.weather?.windSpeed,
          feelsLike: location.weather?.feelsLike,
          lastUpdated: location.weather?.lastUpdated,
        },
    error: location.error || null,
    timestamp: new Date().toISOString(),
  }));
};

module.exports = {
  processWeatherData,
  validateWeatherData,
  formatWeatherForCache,
};
