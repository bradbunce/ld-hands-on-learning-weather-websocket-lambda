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
        const userId = event.queryStringParameters?.userId;
    
        if (!token || !userId) {
            logWithTiming("Missing token or userId", { 
                hasToken: !!token, 
                hasUserId: !!userId 
            });
            return { statusCode: 401, body: JSON.stringify({ message: "Authorization token and userId required" }) };
        }
    
        try {
            const decoded = verifyToken(token);
            
            // Ensure userId matches decoded token's userId
            if (String(decoded.userId) !== String(userId)) {
                logWithTiming("UserId mismatch", { 
                    tokenUserId: decoded.userId, 
                    providedUserId: userId 
                });
                return { statusCode: 401, body: JSON.stringify({ message: "Invalid user identification" }) };
            }
            
          if (locations.length > 0) {
            const processedData = await processWeatherData(locations);
            
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

          const locations = await getLocationsForUser(decoded.userId);
          logWithTiming("Retrieved locations with weather data", { 
            locationCount: locations.length 
          });

          const processedData = await processWeatherData(locations);

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

              const locations = await getLocationsForUser(decoded.userId);
              const processedData = await processWeatherData(locations);
              
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