const CONFIG = require('./config');
const {
  storeConnection,
  removeConnection,
  sendMessageToClient,
  verifyToken,
  updateConnectionLocations,
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
        const connectionId = event.requestContext.connectionId;
        const token = event.queryStringParameters?.token;
        const providedUserId = event.queryStringParameters?.userId;
    
        if (!token || !providedUserId) {
            logWithTiming("Missing token or userId", { 
                hasToken: !!token, 
                hasUserId: !!providedUserId 
            });
            return { 
                statusCode: 401, 
                body: JSON.stringify({ 
                    message: "Authorization token and userId required" 
                }) 
            };
        }
    
        try {
            const decoded = verifyToken(token);
            
            // Allow connection if either:
            // 1. Provided userId matches the numeric user ID from token
            // 2. Provided userId matches the username from token
            const isValidUser = 
                String(decoded.userId) === String(providedUserId) || 
                decoded.username === providedUserId;
    
            if (!isValidUser) {
                logWithTiming("UserId validation failed", { 
                    tokenUserId: decoded.userId, 
                    tokenUsername: decoded.username,
                    providedUserId 
                });
                return { 
                    statusCode: 401, 
                    body: JSON.stringify({ 
                        message: "Invalid user identification" 
                    }) 
                };
            }
    
            // Store the connection with the numeric user ID
            await storeConnection(connectionId, decoded.userId);
            logWithTiming("Connection stored");
    
            // Retrieve user's locations
            const locations = await getLocationsForUser(decoded.userId);
            logWithTiming("Retrieved locations with weather data", { 
                locationCount: locations.length,
                locations: locations.map(loc => ({
                    id: loc.location_id,
                    name: loc.name
                }))
            });
    
            // Process and send weather data if locations exist
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
    
            // Successful connection
            return { 
                statusCode: 200, 
                body: JSON.stringify({ 
                    message: "Connected successfully" 
                }) 
            };
    
        } catch (verificationError) {
            logWithTiming("Token verification failed", { 
                error: verificationError.message,
                connectionId 
            });
    
            // Specific error handling
            if (verificationError.message.includes('expired')) {
                return { 
                    statusCode: 401, 
                    body: JSON.stringify({ 
                        message: "Token has expired. Please log in again." 
                    }) 
                };
            }
    
            return { 
                statusCode: 401, 
                body: JSON.stringify({ 
                    message: "Invalid token" 
                }) 
            };
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
        const connectionId = event.requestContext.connectionId;
        
        // Extract token and locations, with fallbacks
        const token = messageData.token;
        const locations = messageData.locations || [];
    
        try {
            // Check if token is provided
            if (!token) {
                logWithTiming("No token provided", { connectionId });
                
                await sendMessageToClient(connectionId, {
                    type: "error",
                    message: "Authentication required. Please reconnect.",
                    code: "NO_TOKEN"
                });
    
                return { 
                    statusCode: 401, 
                    body: JSON.stringify({ 
                        message: "Authentication token is required" 
                    }) 
                };
            }
    
            // Verify token
            const decoded = verifyToken(token);
            logWithTiming("Token verified", { userId: decoded.userId });
    
            // Update connection TTL
            await updateConnectionTTL(connectionId);
            logWithTiming("Refreshed connection TTL");
    
            // Retrieve user locations
            const userLocations = await getLocationsForUser(decoded.userId);
            
            // Filter locations if specific ones are requested
            const filteredLocations = locations.length > 0 
                ? userLocations.filter(loc => locations.includes(loc.location_id))
                : userLocations;
    
            logWithTiming("Retrieved locations with weather data", {
                requestedLocationCount: locations.length,
                totalUserLocations: userLocations.length,
                filteredLocationCount: filteredLocations.length
            });
    
            // Process weather data
            const processedData = await processWeatherData(filteredLocations);
    
            // Send weather update
            await sendMessageToClient(connectionId, {
                type: "weatherUpdate",
                data: processedData,
                timestamp: new Date().toISOString()
            });
    
            return { 
                statusCode: 200, 
                body: JSON.stringify({ 
                    message: "Weather data sent successfully",
                    locationCount: processedData.length
                }) 
            };
    
        } catch (error) {
            // Detailed error handling
            logWithTiming("GetWeather failed", { 
                error: error.message,
                connectionId 
            });
    
            // Send specific error messages
            try {
                await sendMessageToClient(connectionId, {
                    type: "error",
                    message: error.message,
                    code: error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNKNOWN_ERROR'
                });
            } catch (sendError) {
                logWithTiming("Failed to send error message", { 
                    originalError: error.message,
                    sendError: sendError.message 
                });
            }
    
            // Throw or return error response
            return { 
                statusCode: 500, 
                body: JSON.stringify({ 
                    message: "Failed to retrieve weather data",
                    error: error.message 
                }) 
            };
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

              await updateConnectionLocations(connectionId, locationId);
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
              await updateConnectionLocations(connectionId, null);
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