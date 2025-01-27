/**
 * Weather Data Processing Module
 * 
 * Processes and transforms weather data from various sources into a standardized format.
 * Handles data validation, error cases, and prepares data for client consumption.
 * 
 * Features:
 * - Standardizes weather data from multiple sources
 * - Handles error cases and data validation
 * - Provides data transformation for caching
 */

const { logger } = require('@bradbunce/launchdarkly-lambda-logger');

/**
 * Processes raw weather data into a standardized format
 * 
 * @param {Array} weatherData - Array of weather data objects from various sources
 * @returns {Array} Processed and standardized weather data
 * @throws {Error} If data processing fails
 */
const processWeatherData = async (weatherData) => {
  logger.info("Weather data received for processing", { 
      locationCount: weatherData?.length,
      locations: weatherData?.map(loc => ({
          id: loc.location_id || loc.locationId,
          name: loc.name || loc.locationName
      }))
  });

  if (!Array.isArray(weatherData)) {
      logger.error("Weather data must be an array", { 
          receivedType: typeof weatherData,
          value: weatherData 
      });
      throw new Error("Invalid weather data format");
  }

  try {
      return weatherData.map((location) => {
          // Handle error cases where the location fetch failed
          if (location.error) {
              return {
                  id: location.locationId,
                  name: location.locationName,
                  error: location.error,
                  timestamp: location.timestamp,
              };
          }

          try {
              // If data is already processed (comes from our API wrapper)
              if (location.temperature !== undefined) {
                return {
                    id: location.location_id,  // Change locationId to location_id
                    name: location.name,       // name is correct
                    weather: {
                        temperature: location.temperature,
                        condition: location.condition,
                        humidity: location.humidity,
                        windSpeed: location.wind_speed,
                        feelsLike: location.feels_like,
                        lastUpdated: location.last_updated
                    }
                };
            }
              
              // If raw API data
              if (location.current) {
                  return {
                      id: location.id || location.locationId,
                      name: location.name || location.locationName,
                      weather: {
                          temperature: location.current.temp_c,
                          condition: location.current.condition?.text,
                          icon: location.current.condition?.icon,
                          humidity: location.current.humidity,
                          windSpeed: location.current.wind_kph,
                          feelsLike: location.current.feelslike_c,
                          lastUpdated: location.current.last_updated
                      },
                      coordinates: location.latitude && location.longitude
                          ? {
                              latitude: location.latitude,
                              longitude: location.longitude,
                          }
                          : undefined,
                      metadata: {
                          country: location.country || location.country_code,
                          timezone: location.timezone,
                          localTime: location.localtime,
                          provider: "WeatherAPI.com",
                      }
                  };
              }

              throw new Error("No weather data available");
          } catch (locationError) {
              logger.error("Error processing individual location", {
                  location: location.name || location.locationName,
                  locationId: location.location_id || location.locationId,
                  error: locationError.message,
                  stack: locationError.stack
              });

              // Return error state for this location
              return {
                  id: location.locationId,
                  name: location.locationName,
                  error: "Failed to process weather data",
                  timestamp: new Date().toISOString(),
              };
          }
      });
  } catch (error) {
      logger.error("Error processing weather data", { 
          error: error.message,
          stack: error.stack
      });
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
