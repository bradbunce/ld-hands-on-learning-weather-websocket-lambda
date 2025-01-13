// index.js
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
    console.log('Received event:', {
        routeKey: event.requestContext.routeKey,
        connectionId: event.requestContext.connectionId,
        body: event.body
    });

    const connectionId = event.requestContext.connectionId;

    try {
        switch (event.requestContext.routeKey) {
            case '$connect': {
                // Token is passed as a query parameter during connection
                const token = event.queryStringParameters?.token;
                if (!token) {
                    return { statusCode: 401, body: 'Authorization token required' };
                }

                // Verify the token
                const decoded = verifyToken(token);
                if (!decoded) {
                    return { statusCode: 401, body: 'Invalid token' };
                }

                // Store the connection with the user ID from the token
                await storeConnection(connectionId, decoded.userId);
                return { statusCode: 200, body: 'Connected' };
            }

            case '$disconnect':
                await removeConnection(connectionId);
                return { statusCode: 200, body: 'Disconnected' };

            case 'getWeather': {
                const messageData = JSON.parse(event.body);
                const { token, locationName } = messageData;

                // Verify the token
                const decoded = verifyToken(token);
                if (!decoded) {
                    await sendMessageToClient(connectionId, {
                        type: 'error',
                        message: 'Unauthorized'
                    });
                    return { statusCode: 401 };
                }

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

                    return { statusCode: 200 };
                } catch (error) {
                    console.error('Error processing weather request:', error);
                    await sendMessageToClient(connectionId, {
                        type: 'error',
                        message: 'Error fetching weather data'
                    });
                    return { statusCode: 500 };
                }
            }

            case 'subscribe': {
                const messageData = JSON.parse(event.body);
                const { token, locationName } = messageData;

                if (!locationName) {
                    await sendMessageToClient(connectionId, {
                        type: 'error',
                        message: 'Location name is required'
                    });
                    return { statusCode: 400 };
                }

                // Verify the token
                const decoded = verifyToken(token);
                if (!decoded) {
                    await sendMessageToClient(connectionId, {
                        type: 'error',
                        message: 'Unauthorized'
                    });
                    return { statusCode: 401 };
                }

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

                return { statusCode: 200 };
            }

            case 'unsubscribe': {
                const messageData = JSON.parse(event.body);
                const { token } = messageData;

                // Verify the token
                const decoded = verifyToken(token);
                if (!decoded) {
                    await sendMessageToClient(connectionId, {
                        type: 'error',
                        message: 'Unauthorized'
                    });
                    return { statusCode: 401 };
                }

                // Remove location subscription
                await updateConnectionLocation(connectionId, null);
                return { statusCode: 200 };
            }

            default:
                console.warn('Unknown route:', event.requestContext.routeKey);
                return { statusCode: 400, body: 'Unknown route' };
        }
    } catch (error) {
        console.error('Error processing request:', error);
        // Try to notify the client of the error
        try {
            await sendMessageToClient(connectionId, {
                type: 'error',
                message: 'Internal server error'
            });
        } catch (sendError) {
            console.error('Error sending error message to client:', sendError);
        }
        return { statusCode: 500, body: 'Internal server error' };
    }
};