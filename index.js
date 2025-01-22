const CONFIG = require('./config');
const {
  storeConnection,
  removeConnection,
  sendMessageToClient,
  verifyToken,
  updateConnectionLocation,
  updateConnectionTTL,
  cleanupUserConnections
} = require("./websocket");
const { processWeatherData } = require("./dataProcessor");
const { getWeatherUpdates } = require("./weather-queries");
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
              name: loc.city_name
            }))
          });

          if (locations.length > 0) {
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
        const { token, locationId } = messageData;

        try {
          const decoded = verifyToken(token);
          logWithTiming("Token verified", { userId: decoded.userId });

          if (locationId) {
            await updateConnectionLocation(connectionId, locationId);
            logWithTiming("Updated active location", { locationId });
          } else {
            await updateConnectionTTL(connectionId);
            logWithTiming("Refreshed connection TTL");
          }

          const locations = locationId 
            ? [{ location_id: locationId }]
            : await getLocationsForUser(decoded.userId);

          logWithTiming("Fetching weather data", { 
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
        } catch (error) {
          logWithTiming("GetWeather failed", { error: error.message });
          throw error;
        }
      }

      case "$default": {
        logWithTiming("Processing $default route");
        
        try {
          const messageData = JSON.parse(event.body);
          const decoded = verifyToken(messageData.token);
          
          switch (messageData.action) {
            case "subscribe": {
              const { locationId } = messageData;
              
              if (!locationId) {
                return {
                  statusCode: 400,
                  body: JSON.stringify({ message: "Location ID is required for subscription" })
                };
              }

              logWithTiming("Processing subscription", {
                userId: decoded.userId,
                locationId
              });

              await updateConnectionLocation(connectionId, locationId);
              logWithTiming("Location subscription updated");

              const locations = [{ location_id: locationId }];
              const weatherData = await getWeatherUpdates(locations);
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
              logWithTiming("Processing logout", { userId: decoded.userId });
              await cleanupUserConnections(decoded.userId);
              logWithTiming("User connections cleaned up");
              return { statusCode: 200, body: JSON.stringify({ message: "Logout successful" }) };
            }

            default:
              logWithTiming("Unknown action received", { action: messageData.action });
              return { statusCode: 400, body: JSON.stringify({ message: "Unknown action" }) };
          }
        } catch (error) {
          logWithTiming("Default route error", { error: error.message });
          throw error;
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