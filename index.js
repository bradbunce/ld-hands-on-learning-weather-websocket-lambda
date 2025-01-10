const { storeConnection, removeConnection, getActiveConnections } = require('./websocket');
const { processWeatherData } = require('./dataProcessor');
const { getWeatherUpdates } = require('./weatherAPI');
const { getLocationsForUser } = require('./database');

exports.handler = async (event) => {
    try {
        const routeKey = event.requestContext.routeKey;
        const connectionId = event.requestContext.connectionId;
        
        switch (routeKey) {
            case '$connect':
                const clientId = event.queryStringParameters?.userId;
                if (!clientId) {
                    return { statusCode: 400, body: 'userId is required' };
                }
                await storeConnection(connectionId, clientId);
                return { statusCode: 200, body: 'Connected' };
                
            case '$disconnect':
                await removeConnection(connectionId);
                return { statusCode: 200, body: 'Disconnected' };
                
            case 'getWeather':
                const body = JSON.parse(event.body);
                const userId = body.userId;
                
                // Get user's saved locations
                const locations = await getLocationsForUser(userId);
                
                // Get weather data for all locations
                const weatherData = await getWeatherUpdates(locations);
                
                // Process the weather data
                const processedData = await processWeatherData(weatherData);
                
                // Send the data back through the WebSocket
                await sendMessageToClient(connectionId, {
                    type: 'weatherUpdate',
                    data: processedData
                });
                
                return { statusCode: 200 };
                
            default:
                return { statusCode: 400, body: 'Unknown route' };
        }
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, body: 'Internal server error' };
    }
};