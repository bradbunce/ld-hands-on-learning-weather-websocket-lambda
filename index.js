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

    try {
        switch (event.requestContext.routeKey) {
            case '$connect': {
                // Extract token from query parameters
                const token = event.queryStringParameters?.token;
                
                console.log('Connection Token Details:', {
                    tokenPresent: !!token,
                    tokenLength: token ? token.length : 'N/A',
                    tokenStart: token ? token.substring(0, 20) : 'N/A'
                });

                if (!token) {
                    console.log('No token provided during connection');
                    return { 
                        statusCode: 401, 
                        body: JSON.stringify({ message: 'Authorization token required' }) 
                    };
                }

                try {
                    // Verify the token
                    const decoded = verifyToken(token);

                    // Store the connection with the user ID from the token
                    await storeConnection(connectionId, decoded.userId);
                    
                    console.log('Connection stored successfully', {
                        connectionId,
                        userId: decoded.userId
                    });

                    return { 
                        statusCode: 200, 
                        body: JSON.stringify({ 
                            message: 'Connected successfully',
                            userId: decoded.userId
                        }) 
                    };
                } catch (verificationError) {
                    console.error('Token Verification Error:', {
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
                console.log('Removing connection:', connectionId);
                await removeConnection(connectionId);
                return { 
                    statusCode: 200, 
                    body: JSON.stringify({ message: 'Disconnected successfully' }) 
                };

            case 'getWeather': {
                const messageData = JSON.parse(event.body);
                const { token, locationName } = messageData;

                console.log('Get Weather Request:', { locationName });

                // Verify the token
                const decoded = verifyToken(token);

                console.log('Fetching weather for:', {
                    userId: decoded.userId,
                    locationName
                });

                try {
                    // Update connection with the requested location
                    if (locationName) {
                        await updateConnectionLocation(connectionId, locationName);
                    }

                    // Get weather data for the location
                    const locations = locationName ? 
                        [{ name: locationName }] : 
                        await getLocationsForUser(decoded.userId);

                    console.log('Fetching weather for locations:', locations);

                    const weatherData = await getWeatherUpdates(locations);
                    const processedData = await processWeatherData(weatherData);

                    await sendMessageToClient(connectionId, {
                        type: 'weatherUpdate',
                        data: processedData,
                        timestamp: new Date().toISOString()
                    });

                    return { 
                        statusCode: 200, 
                        body: JSON.stringify({ message: 'Weather data sent' }) 
                    };
                } catch (error) {
                    console.error('Error processing weather request:', error);
                    
                    await sendMessageToClient(connectionId, {
                        type: 'error',
                        message: 'Error fetching weather data'
                    });

                    return { 
                        statusCode: 500, 
                        body: JSON.stringify({ message: 'Internal server error' }) 
                    };
                }
            }

            case 'subscribe': {
                const messageData = JSON.parse(event.body);
                const { token, locationName } = messageData;

                console.log('Subscribe Request:', { locationName });

                if (!locationName) {
                    await sendMessageToClient(connectionId, {
                        type: 'error',
                        message: 'Location name is required'
                    });
                    return { 
                        statusCode: 400, 
                        body: JSON.stringify({ message: 'Location name is required' }) 
                    };
                }

                // Verify the token
                const decoded = verifyToken(token);

                // Update the connection with the new location
                await updateConnectionLocation(connectionId, locationName);

                // Send initial weather data
                const weatherData = await getWeatherUpdates([{ name: locationName }]);
                const processedData = await processWeatherData(weatherData);

                await sendMessageToClient(connectionId, {
                    type: 'weatherUpdate',
                    data: processedData,
                    timestamp: new Date().toISOString()
                });

                return { 
                    statusCode: 200, 
                    body: JSON.stringify({ message: 'Subscribed successfully' }) 
                };
            }

            case 'unsubscribe': {
                const messageData = JSON.parse(event.body);
                const { token } = messageData;

                console.log('Unsubscribe Request');

                // Verify the token
                const decoded = verifyToken(token);

                // Remove location subscription
                await updateConnectionLocation(connectionId, null);
                
                return { 
                    statusCode: 200, 
                    body: JSON.stringify({ message: 'Unsubscribed successfully' }) 
                };
            }

            default:
                console.warn('Unknown route:', event.requestContext.routeKey);
                return { 
                    statusCode: 400, 
                    body: JSON.stringify({ message: 'Unknown route' }) 
                };
        }
    } catch (error) {
        console.error('Unexpected Error:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });

        try {
            await sendMessageToClient(connectionId, {
                type: 'error',
                message: 'Internal server error'
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }

        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: 'Internal server error' }) 
        };
    }
};