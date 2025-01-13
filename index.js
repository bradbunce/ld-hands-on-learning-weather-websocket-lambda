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

                    try {
                        // Get user's locations
                        logWithTiming('Getting initial locations for user', {
                            userId: decoded.userId,
                            step: 'start'
                        });

                        const locations = await getLocationsForUser(decoded.userId);
                        
                        logWithTiming('Retrieved locations', { 
                            userId: decoded.userId,
                            locationCount: locations.length,
                            locations: locations.map(loc => ({
                                id: loc.location_id,
                                name: loc.city_name,
                                country: loc.country_code
                            }))
                        });

                        if (locations.length > 0) {
                            // Get weather data for locations
                            logWithTiming('Getting initial weather data', {
                                step: 'weather_fetch_start',
                                locationCount: locations.length
                            });

                            const weatherData = await getWeatherUpdates(locations);
                            
                            logWithTiming('Retrieved weather data', { 
                                step: 'weather_fetch_complete',
                                weatherDataCount: weatherData.length,
                                weatherData: weatherData.map(data => ({
                                    locationName: data.locationName,
                                    hasError: !!data.error,
                                    error: data.error
                                }))
                            });

                            // Process and send weather data
                            logWithTiming('Processing weather data', {
                                step: 'processing_start'
                            });

                            const processedData = await processWeatherData(weatherData);
                            
                            logWithTiming('Processed weather data', { 
                                step: 'processing_complete',
                                processedDataCount: processedData.length,
                                summary: processedData.map(data => ({
                                    locationName: data.name,
                                    hasError: !!data.error
                                }))
                            });

                            logWithTiming('Sending data to client', {
                                step: 'send_start',
                                dataSize: JSON.stringify(processedData).length
                            });

                            await sendMessageToClient(connectionId, {
                                type: 'weatherUpdate',
                                data: processedData,
                                timestamp: new Date().toISOString()
                            });

                            logWithTiming('Sent initial weather data to client', {
                                step: 'send_complete'
                            });
                        } else {
                            logWithTiming('No locations found for user', {
                                userId: decoded.userId
                            });

                            // Send empty state notification to client
                            await sendMessageToClient(connectionId, {
                                type: 'noLocations',
                                message: 'No locations found. Please add a location to get weather updates.',
                                timestamp: new Date().toISOString()
                            });
                        }
                    } catch (error) {
                        // Log detailed error but don't fail the connection
                        logWithTiming('Error sending initial weather data', {
                            error: error.message,
                            code: error.code,
                            type: error.constructor.name,
                            stack: error.stack,
                            userId: decoded.userId
                        });

                        // Notify client of the error
                        try {
                            await sendMessageToClient(connectionId, {
                                type: 'error',
                                message: 'Failed to fetch initial weather data. Please try refreshing.',
                                timestamp: new Date().toISOString()
                            });
                        } catch (sendError) {
                            logWithTiming('Failed to send error message to client', {
                                error: sendError.message,
                                originalError: error.message
                            });
                        }
                    }

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
                    console.log('CRITICAL: Entering getWeather route');
                    
                    const messageData = JSON.parse(event.body);
                    const { token, locationName } = messageData;
                
                    console.log('CRITICAL: Message Data Received', { 
                        locationNamePresent: !!locationName 
                    });
                
                    // Token verification
                    console.log('CRITICAL: About to verify token');
                    const decoded = verifyToken(token);
                    console.log('CRITICAL: Token verified successfully', {
                        userId: decoded.userId,
                        locationName
                    });
                
                    // IMMEDIATE next step logging
                    console.log('CRITICAL: Immediately after token verification');
                
                    try {
                        // Detailed logging for each subsequent step
                        console.log('CRITICAL: Preparing to update connection location');
                        if (locationName) {
                            console.log('CRITICAL: Updating connection location', { locationName });
                            await updateConnectionLocation(connectionId, locationName);
                            console.log('CRITICAL: Connection location updated');
                        }
                
                        console.log('CRITICAL: About to get locations');
                        const locations = locationName ? 
                            [{ name: locationName }] : 
                            await getLocationsForUser(decoded.userId);
                        
                        console.log('CRITICAL: Locations retrieved', { 
                            locationCount: locations.length 
                        });
                
                        console.log('CRITICAL: About to get weather updates');
                        const weatherData = await getWeatherUpdates(locations);
                        
                        console.log('CRITICAL: Weather data retrieved', { 
                            weatherDataLength: weatherData.length 
                        });
                
                        console.log('CRITICAL: About to process weather data');
                        const processedData = await processWeatherData(weatherData);
                        
                        console.log('CRITICAL: Weather data processed', { 
                            processedDataLength: processedData.length 
                        });
                
                        console.log('CRITICAL: About to send message to client');
                        await sendMessageToClient(connectionId, {
                            type: 'weatherUpdate',
                            data: processedData,
                            timestamp: new Date().toISOString()
                        });
                        
                        console.log('CRITICAL: Message sent to client successfully');
                
                        return { 
                            statusCode: 200, 
                            body: JSON.stringify({ message: 'Weather data sent' }) 
                        };
                    } catch (error) {
                        console.error('CRITICAL: Detailed Error in getWeather', {
                            name: error.name,
                            message: error.message,
                            stack: error.stack
                        });
                        
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
