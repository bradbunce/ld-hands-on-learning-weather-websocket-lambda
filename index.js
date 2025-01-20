const CONFIG = require('./config');
const {
  storeConnection,
  removeConnection,
  sendMessageToClient,
  verifyToken,
  updateConnectionLocation,
  updateConnectionTTL
} = require("./websocket");
const { processWeatherData } = require("./dataProcessor");
const { getWeatherUpdates } = require("./weatherAPI");
const { getLocationsForUser } = require("./database");

exports.handler = async (event) => {
  console.log(
    "Received WebSocket Event:",
    JSON.stringify({
      routeKey: event.requestContext.routeKey,
      connectionId: event.requestContext.connectionId,
      queryParams: event.queryStringParameters,
      body: event.body,
    }, null, 2)
  );

  const connectionId = event.requestContext.connectionId;
  const startTime = Date.now();

  const logWithTiming = (message, details = {}) => {
    const elapsedTime = Date.now() - startTime;
    console.log(`[${elapsedTime}ms] ${message}`, {
      connectionId,
      ...details,
    });
  };

  try {
    switch (event.requestContext.routeKey) {
      case "$connect": {
        logWithTiming("Processing $connect route");
        const token = event.queryStringParameters?.token;

        if (!token) {
          logWithTiming("No token provided during connection");
          return { statusCode: 401, body: JSON.stringify({ message: "Authorization token required" }) };
        }

        try {
          const decoded = verifyToken(token);
          logWithTiming("Token verified", { userId: decoded.userId });

          await storeConnection(connectionId, decoded.userId);
          logWithTiming("Connection stored");

          const locations = await getLocationsForUser(decoded.userId);
          logWithTiming("Retrieved locations", { 
            locationCount: locations.length,
            locations: locations.map(loc => ({
              id: loc.location_id,
              name: loc.city_name,
              country: loc.country_code
            }))
          });

          if (locations.length > 0) {
            // Get and send weather data for all locations
            const weatherData = await getWeatherUpdates(locations);
            const processedData = await processWeatherData(weatherData);
            
            await sendMessageToClient(connectionId, {
              type: "weatherUpdate",
              data: processedData,
              timestamp: new Date().toISOString()
            });
          } else {
            await sendMessageToClient(connectionId, {
              type: "noLocations",
              message: "No locations found. Please add a location to get weather updates.",
              timestamp: new Date().toISOString()
            });
          }

          return { statusCode: 200, body: JSON.stringify({ message: "Connected successfully" }) };
        } catch (verificationError) {
          logWithTiming("Token verification failed", { error: verificationError.message });
          return { statusCode: 401, body: JSON.stringify({ message: "Invalid token" }) };
        }
      }

      case "$disconnect": {
        logWithTiming("Processing $disconnect route");
        await removeConnection(connectionId);
        return { statusCode: 200, body: JSON.stringify({ message: "Disconnected successfully" }) };
      }

      case "getWeather": {
        logWithTiming("Processing getWeather route");
        const messageData = JSON.parse(event.body);
        const { token, locationName, countryCode } = messageData;

        const decoded = verifyToken(token);
        logWithTiming("Token verified", { userId: decoded.userId });

        if (locationName) {
          await updateConnectionLocation(connectionId, locationName);
          logWithTiming("Updated active location", { locationName });
        } else {
          await updateConnectionTTL(connectionId);
          logWithTiming("Refreshed connection TTL");
        }

        const locations = locationName 
          ? [{ city_name: locationName, country_code: countryCode }]
          : await getLocationsForUser(decoded.userId);

        logWithTiming("Fetching weather for locations", { 
          locationCount: locations.length 
        });

        const weatherData = await getWeatherUpdates(locations);
        const processedData = await processWeatherData(weatherData);

        await sendMessageToClient(connectionId, {
          type: "weatherUpdate",
          data: processedData,
          timestamp: new Date().toISOString()
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Weather data sent" }) };
      }

      case "$default": {
        logWithTiming("Processing $default route");
        
        try {
            const messageData = JSON.parse(event.body);
            switch (messageData.action) {
                case "subscribe": {
                    const { token, locationName, countryCode } = messageData;
                    
                    if (!locationName) {
                        return {
                            statusCode: 400,
                            body: JSON.stringify({ message: "Location name is required for subscription" })
                        };
                    }
    
                    const decoded = verifyToken(token);
                    logWithTiming("Token verified for subscription", {
                        userId: decoded.userId,
                        locationName
                    });
    
                    await updateConnectionLocation(connectionId, locationName);
                    logWithTiming("Location subscription updated");
    
                    const weatherData = await getWeatherUpdates([{
                        city_name: locationName,
                        country_code: countryCode
                    }]);
                    
                    const processedData = await processWeatherData(weatherData);
                    
                    await sendMessageToClient(connectionId, {
                        type: "weatherUpdate",
                        data: processedData,
                        timestamp: new Date().toISOString()
                    });
    
                    return { statusCode: 200, body: JSON.stringify({ message: "Subscribed successfully" }) };
                }
    
                case "unsubscribe": {
                    await updateConnectionLocation(connectionId, null);
                    logWithTiming("Location subscription removed");
                    return { statusCode: 200, body: JSON.stringify({ message: "Unsubscribed successfully" }) };
                }
    
                case "logout": {
                    const { token } = messageData;
                    logWithTiming("Processing logout cleanup", { connectionId });
    
                    const decoded = verifyToken(token);
                    logWithTiming("Token verified for logout", { 
                        userId: decoded.userId 
                    });
    
                    try {
                        // Clean up all connections for this user
                        await cleanupUserConnections(decoded.userId);
                        logWithTiming("User connections cleaned up", { 
                            userId: decoded.userId 
                        });
    
                        // Remove the current connection explicitly
                        await removeConnection(connectionId);
                        logWithTiming("Current connection removed");
    
                        return {
                            statusCode: 200,
                            body: JSON.stringify({ message: "Logout cleanup completed" })
                        };
                    } catch (cleanupError) {
                        logWithTiming("Error during logout cleanup", { 
                            error: cleanupError.message 
                        });
                        throw cleanupError;
                    }
                }
    
                default:
                    logWithTiming("Unknown action received", { action: messageData.action });
                    return { statusCode: 400, body: JSON.stringify({ message: "Unknown action" }) };
            }
        } catch (error) {
            logWithTiming("Error processing default route", { error: error.message });
            throw error; // Let the global error handler deal with it
        }
    }

      default:
        logWithTiming("Unknown route");
        return { statusCode: 400, body: JSON.stringify({ message: "Unknown route" }) };
    }
  } catch (error) {
    logWithTiming("Unexpected error", {
      error: error.message,
      stack: error.stack
    });

    try {
      await sendMessageToClient(connectionId, {
        type: "error",
        message: "An unexpected error occurred",
        timestamp: new Date().toISOString()
      });
    } catch (sendError) {
      logWithTiming("Failed to send error message", { error: sendError.message });
    }

    return { statusCode: 500, body: JSON.stringify({ message: "Internal server error" }) };
  } finally {
    logWithTiming("Request completed", { 
      totalTime: Date.now() - startTime 
    });
  }
};