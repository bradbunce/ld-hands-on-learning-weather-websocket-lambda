const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const CONNECTIONS_TABLE = 'brad-weather-app-websocket-connections';
const ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT;
const JWT_SECRET = process.env.JWT_SECRET;

if (!ENDPOINT) {
    throw new Error('WEBSOCKET_API_ENDPOINT environment variable is required');
}

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

const apiGatewayManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: ENDPOINT
});

const SERVICE_TYPE = 'weather-updates';

const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        console.error('Token verification failed:', error);
        return null;
    }
};

const storeConnection = async (connectionId, clientId, locationName = null) => {
    try {
        const item = {
            connectionId,
            serviceType: SERVICE_TYPE,
            clientId,
            timestamp: Date.now()
        };

        if (locationName) {
            item.locationName = locationName;
        }

        await dynamoDB.put({
            TableName: CONNECTIONS_TABLE,
            Item: item
        }).promise();

        console.log('Stored connection:', item);
    } catch (error) {
        console.error('Error storing connection in DynamoDB:', error);
        throw error;
    }
};

const updateConnectionLocation = async (connectionId, locationName) => {
    try {
        await dynamoDB.update({
            TableName: CONNECTIONS_TABLE,
            Key: {
                connectionId,
                serviceType: SERVICE_TYPE
            },
            UpdateExpression: 'set locationName = :locationName',
            ExpressionAttributeValues: {
                ':locationName': locationName
            }
        }).promise();

        console.log('Updated connection location:', { connectionId, locationName });
    } catch (error) {
        console.error('Error updating connection location:', error);
        throw error;
    }
};

const removeConnection = async (connectionId) => {
    try {
        await dynamoDB.delete({
            TableName: CONNECTIONS_TABLE,
            Key: {
                connectionId,
                serviceType: SERVICE_TYPE
            }
        }).promise();

        console.log('Removed connection:', connectionId);
    } catch (error) {
        console.error('Error removing connection from DynamoDB:', error);
        throw error;
    }
};

const getActiveConnections = async (locationName = null) => {
    try {
        let params = {
            TableName: CONNECTIONS_TABLE,
            KeyConditionExpression: 'serviceType = :serviceType',
            ExpressionAttributeValues: {
                ':serviceType': SERVICE_TYPE
            }
        };

        if (locationName) {
            params.FilterExpression = 'locationName = :locationName';
            params.ExpressionAttributeValues[':locationName'] = locationName;
        }

        const { Items } = await dynamoDB.query(params).promise();
        return Items;
    } catch (error) {
        console.error('Error getting active connections from DynamoDB:', error);
        throw error;
    }
};

const sendMessageToClient = async (connectionId, payload) => {
    try {
        await apiGatewayManagementApi.postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify(payload)
        }).promise();

        console.log('Sent message to client:', { connectionId, payload });
    } catch (error) {
        if (error.statusCode === 410) {
            console.log('Connection stale, removing:', connectionId);
            await removeConnection(connectionId);
        } else {
            console.error('Error sending message to client:', error);
            throw error;
        }
    }
};

const broadcastToLocation = async (locationName, payload) => {
    const connections = await getActiveConnections(locationName);
    console.log(`Broadcasting to ${connections.length} clients for location:`, locationName);

    const sendPromises = connections.map(connection => 
        sendMessageToClient(connection.connectionId, {
            ...payload,
            locationName
        })
    );

    await Promise.allSettled(sendPromises);
};

const handleWebSocketMessage = async (connectionId, message) => {
    try {
        const data = JSON.parse(message);
        const { action, token, locationName } = data;

        // Verify token for all actions except connection
        if (action !== 'connect') {
            const decoded = verifyToken(token);
            if (!decoded) {
                await sendMessageToClient(connectionId, {
                    error: 'Unauthorized'
                });
                return;
            }
        }

        switch (action) {
            case 'subscribe':
                await updateConnectionLocation(connectionId, locationName);
                // Send initial weather data
                // TODO: Implement weather data fetching
                break;

            case 'unsubscribe':
                await updateConnectionLocation(connectionId, null);
                break;

            case 'getData':
                // TODO: Implement weather data fetching
                break;

            default:
                console.warn('Unknown action:', action);
                await sendMessageToClient(connectionId, {
                    error: 'Invalid action'
                });
        }
    } catch (error) {
        console.error('Error handling WebSocket message:', error);
        await sendMessageToClient(connectionId, {
            error: 'Internal server error'
        });
    }
};

module.exports = {
    storeConnection,
    removeConnection,
    getActiveConnections,
    sendMessageToClient,
    broadcastToLocation,
    handleWebSocketMessage,
    verifyToken
};