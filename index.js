const {
    storeConnection,
    removeConnection,
    sendMessageToClient,
    verifyToken,
    updateConnectionLocation
} = require('./websocket');
const { processWeatherData } = require('./dataProcessor');
const { getWeatherUpdates } = require('./weatherAPI');
const { getLocationsForUser } = require('./database');

exports.handler = async (event) => {
    console.log('Received WebSocket Event:', JSON.stringify({
        routeKey: event.requestContext.routeKey,
        connectionId: event.requestContext.connectionId,
        queryParams: event.queryStringParameters,
        body: event.body
    }, null, 2));

    const connectionId = event.requestContext.connectionId;
    const startTime = Date.now();

    // Helper function for detailed logging
    const logWithTiming = (message, details = {}) => {
        const elapsedTime = Date.now() - startTime;
        console.log(`[${elapsedTime}ms] ${message}`, {
            connectionId,
            ...details
        });
    };

    try {
        switch (event.requestContext.routeKey) {
            case '$connect': {
                logWithTiming('Processing $connect route');
                
                // Extract token from query parameters
                const token = event.queryStringParameters?.token;
                
                logWithTiming('Connection Token Details', {
                    tokenPresent: !!token,
                    tokenLength: token ? token.length : 'N/A',
                    tokenStart: token ? token.substring(0, 20) : 'N/A'
                });

                if (!token) {
                    logWithTiming('No token provided during connection');
                    return { 
                        statusCode: 401, 
                        body: JSON.stringify({ message: 'Authorization token required' }) 
                    };
                }

                try {
                    // Verify the token
                    const decoded = verifyToken(token);
                    logWithTiming('Token verified successfully', { userId: decoded.userId });

                    // Store the connection with the user ID from the token
                    const storeStartTime = Date.now();
                    await storeConnection(connectionId, decoded.userId);
                    const storeEndTime = Date.now();
                    
                    logWithTiming('Connection stored successfully', {
                        connectionId,
                        userId: decoded.userId,
                        storageTime: storeEndTime - storeStartTime
                    });

                    return { 
                        statusCode: 200, 
                        body: JSON.stringify({ 
                            message: 'Connected successfully',
                            userId: decoded.userId
                        }) 
                    };
                } catch (verificationError) {
                    logWithTiming('Token Verification Error', {
                        name: verificationError.name,
                        message: verificationError.message
                    });

                    return { 
                        statusCode: 401, 
                        body: JSON.stringify({ message: 'Invalid token' }) 
                    };
                }
            }

            case '$disconnect':
                logWithTiming('Processing $disconnect route');
                await removeConnection(connectionId);
                logWithTiming('Connection removed');
                return { 
                    statusCode: 200, 
                    body: JSON.stringify({ message: 'Disconnected successfully' }) 
                };

            case 'getWeather': {
                logWithTiming('Processing getWeather route');
                
                const messageData = JSON.parse(event.body);
                const { token, locationName } = messageData;

                logWithTiming('Get Weather Request', { locationName });

                // Token verification
                const decoded = verifyToken(token);
                logWithTiming('Token verified', {
                    userId: decoded.userId,
                    locationName
                });

                try {
                    // Update connection location
                    if (locationName) {
                        const updateStartTime = Date.now();
                        await updateConnectionLocation(connectionId, locationName);
                        const updateEndTime = Date.now();
                        logWithTiming('Connection location updated', {
                            updateTime: updateEndTime - updateStartTime
                        });
                    }

                    // Get locations
                    const locationsStartTime = Date.now();
                    const locations = locationName ? 
                        [{ name: locationName }] : 
                        await getLocationsForUser(decoded.userId);
                    const locationsEndTime = Date.now();
                    
                    logWithTiming('Locations retrieved', {
                        locationCount: locations.length,
                        retrievalTime: locationsEndTime - locationsStartTime
                    });

                    // Fetch weather data
                    const weatherStartTime = Date.now();
                    const weatherData = await getWeatherUpdates(locations);
                    const weatherEndTime = Date.now();
                    
                    logWithTiming('Weather data retrieved', {
                        dataPoints: weatherData.length,
                        retrievalTime: weatherEndTime - weatherStartTime
                    });

                    // Process weather data
                    const processStartTime = Date.now();
                    const processedData = await processWeatherData(weatherData);
                    const processEndTime = Date.now();
                    
                    logWithTiming('Weather data processed', {
                        processedDataPoints: processedData.length,
                        processingTime: processEndTime - processStartTime
                    });

                    // Send message to client
                    const sendStartTime = Date.now();
                    await sendMessageToClient(connectionId, {
                        type: 'weatherUpdate',
                        data: processedData,
                        timestamp: new Date().toISOString()
                    });
                    const sendEndTime = Date.now();
                    
                    logWithTiming('Message sent to client', {
                        sendTime: sendEndTime - sendStartTime
                    });

                    return { 
                        statusCode: 200, 
                        body: JSON.stringify({ message: 'Weather data sent' }) 
                    };
                } catch (error) {
                    logWithTiming('Error processing weather request', {
                        name: error.name,
                        message: error.message,
                        stack: error.stack
                    });
                    
                    try {
                        await sendMessageToClient(connectionId, {
                            type: 'error',
                            message: 'Error fetching weather data',
                            details: error.message
                        });
                    } catch (sendError) {
                        logWithTiming('Error sending error message', {
                            name: sendError.name,
                            message: sendError.message
                        });
                    }

                    return { 
                        statusCode: 500, 
                        body: JSON.stringify({ 
                            message: 'Internal server error',
                            error: error.message
                        }) 
                    };
                }
            }

            // Similar detailed logging can be added to subscribe and unsubscribe routes...

            default:
                logWithTiming('Unknown route');
                return { 
                    statusCode: 400, 
                    body: JSON.stringify({ message: 'Unknown route' }) 
                };
        }
    } catch (error) {
        logWithTiming('Unexpected Global Error', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });

        try {
            await sendMessageToClient(connectionId, {
                type: 'error',
                message: 'Unexpected internal error'
            });
        } catch (sendError) {
            logWithTiming('Error sending global error message', {
                name: sendError.name,
                message: sendError.message
            });
        }

        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: 'Internal server error' }) 
        };
    } finally {
        const totalExecutionTime = Date.now() - startTime;
        logWithTiming('Total Execution Time', { totalTime: totalExecutionTime });
    }
};