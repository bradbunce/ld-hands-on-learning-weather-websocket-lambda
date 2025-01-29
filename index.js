/**
 * AWS Lambda WebSocket Handler for Real-time Weather Updates
 * 
 * This Lambda function manages WebSocket connections for a real-time weather update service.
 * It handles connection lifecycle (connect/disconnect), authentication, and weather data delivery
 * to connected clients.
 */

const CONFIG = require('./config');
const LaunchDarkly = require('@launchdarkly/node-server-sdk');
const { logger } = require('@bradbunce/launchdarkly-lambda-logger');
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

/**
 * Main Lambda handler function that processes WebSocket events
 * 
 * @param {Object} event - AWS Lambda event object containing WebSocket event details
 * @returns {Object} Response object with statusCode and body
 */
exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  let ldClient;
  try {
    // Initialize LaunchDarkly client with debug logging
    ldClient = LaunchDarkly.init(process.env.LD_SDK_KEY, {
      logger: LaunchDarkly.basicLogger({
        level: 'debug',
        destination: (level, message) => {
          console.debug(`[LaunchDarkly SDK ${level}] ${message}`);
        }
      })
    });
    
    await ldClient.waitForInitialization();
  } catch (error) {
    logger.error('LaunchDarkly initialization failed:', {
      error: error.message
    });
    throw error;
  }
  
  // Set up flag change listeners for debugging
  ldClient.on('update', () => {
    logger.debug('LaunchDarkly flag update received');
  });

  ldClient.on('change', (settings) => {
    logger.debug('LaunchDarkly flag change detected:', { settings });
  });

  // Helper function to create user context from token
  const createUserContext = (token) => {
    if (!token) {
      return {
        kind: 'user',
        key: 'anonymous',
        anonymous: true
      };
    }

    try {
      const decoded = verifyToken(token);
      return {
        kind: 'user',
        key: decoded.username || String(decoded.userId),
        name: decoded.name,
        userId: decoded.userId,
        anonymous: false
      };
    } catch (error) {
      return {
        kind: 'user',
        key: 'anonymous',
        anonymous: true
      };
    }
  };

  // Helper function to get token based on route
  const getTokenFromEvent = (event) => {
    switch (event.requestContext.routeKey) {
      case '$connect':
        return event.queryStringParameters?.token;
      case 'getWeather':
      case 'locationUpdate':
      case '$default':
        try {
          const messageData = JSON.parse(event.body || '{}');
          return messageData.token;
        } catch {
          return null;
        }
      default:
        return null;
    }
  };

  // Create service context
  const serviceContext = {
    kind: 'service',
    key: 'weather-app-websocket-lambda',
    name: 'Weather App WebSocket Lambda',
    environment: process.env.NODE_ENV || 'development'
  };

  // Create multi-context using token from appropriate source
  const token = getTokenFromEvent(event);
  const multiContext = {
    kind: 'multi',
    user: createUserContext(token),
    service: serviceContext
  };

  // Initialize logger with our LaunchDarkly client and flag key
  await logger.initialize(ldClient, multiContext, {
    logLevelFlagKey: process.env.LD_LOG_LEVEL_FLAG_KEY
  });

  // Explicitly check current log level for debugging
  const currentLogLevel = await ldClient.variation(process.env.LD_LOG_LEVEL_FLAG_KEY, multiContext, 'info');
  logger.debug('Current log level configuration:', { 
    level: currentLogLevel, 
    context: multiContext,
    flagKey: process.env.LD_LOG_LEVEL_FLAG_KEY
  });

  const startTime = Date.now();

  // Log at different levels to see flag evaluations
  logger.trace('Trace level details:', { event });
  logger.debug('Debug level connection info:', { connectionId });
  logger.info('Received WebSocket Event', {
    routeKey: event.requestContext.routeKey,
    connectionId: event.requestContext.connectionId,
    queryParams: event.queryStringParameters,
    body: event.body
  });

  const logWithTiming = (message, details = {}) => {
    const elapsedTime = Date.now() - startTime;
    logger.info(message, {
      connectionId,
      elapsedTime,
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
            logger.warn("Missing token or userId", { 
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
                logger.warn("UserId validation failed", { 
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
            logger.error("Token verification failed", { 
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
                logger.warn("No token provided", { connectionId });
                
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
            await updateConnectionTTL(connectionId, decoded.userId);
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
            logger.error("GetWeather failed", { 
                error: error.message,
                connectionId,
                stack: error.stack
            });
    
            // Send specific error messages
            try {
                await sendMessageToClient(connectionId, {
                    type: "error",
                    message: error.message,
                    code: error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNKNOWN_ERROR'
                });
            } catch (sendError) {
                logger.error("Failed to send error message", { 
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

    case "locationUpdate": {
      logWithTiming("Processing locationUpdate route");
      const messageData = JSON.parse(event.body);
      const decoded = verifyToken(messageData.token);
      
      
      const locations = await getLocationsForUser(decoded.userId);
      const processedData = await processWeatherData(locations);
      
      await sendMessageToClient(connectionId, {
        type: "weatherUpdate",
        data: processedData,
        timestamp: new Date().toISOString()
      });
    
      return { statusCode: 200, body: JSON.stringify({ message: "Location update sent" }) };
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
              logger.warn("Unknown action received", { action: messageData.action });
              return { statusCode: 400, body: JSON.stringify({ message: "Unknown action" }) };
          }
        } catch (error) {
          logger.error("Default route error", { 
            error: error.message,
            stack: error.stack
          });
          throw error;
        }
      }

      default:
        logger.warn("Unknown route", { routeKey: event.requestContext.routeKey });
        return { statusCode: 400, body: JSON.stringify({ message: "Unknown route" }) };
      }
    } catch (error) {
      logger.error("Unexpected error", {
        error: error.message,
        stack: error.stack,
        connectionId
      });
  
      try {
        await sendMessageToClient(connectionId, {
          type: "error",
          message: "An unexpected error occurred",
          timestamp: new Date().toISOString()
        });
      } catch (sendError) {
        logger.error("Failed to send error message", { 
          error: sendError.message,
          originalError: error.message,
          connectionId
        });
      }
  
      return { statusCode: 500, body: JSON.stringify({ message: "Internal server error" }) };
    } finally {
      logger.info("Request completed", { 
        totalTime: Date.now() - startTime 
      });
    
      // Flush events before closing
      await ldClient.flush();
      
      await Promise.all([
        logger.close(),
        ldClient.close()
      ]);
    }
  };
