const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const CONNECTIONS_TABLE = 'brad-weather-app-websocket-connections';
const ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT;

if (!ENDPOINT) {
    throw new Error('WEBSOCKET_API_ENDPOINT environment variable is required');
}

const apiGatewayManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: ENDPOINT
});

const SERVICE_TYPE = 'weather-updates';

const storeConnection = async (connectionId, clientId) => {
    try {
        // Add timeout to DynamoDB operation
        await Promise.race([
            dynamoDB.put({
                TableName: CONNECTIONS_TABLE,
                Item: {
                    connectionId: connectionId,
                    serviceType: SERVICE_TYPE,
                    clientId: clientId,
                    timestamp: Date.now()
                }
            }).promise(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('DynamoDB put timeout')), 5000)
            )
        ]);
    } catch (error) {
        console.error('Error storing connection in DynamoDB:', error);
        throw error;
    }
};

const removeConnection = async (connectionId) => {
    try {
        // Add timeout to DynamoDB operation
        await Promise.race([
            dynamoDB.delete({
                TableName: CONNECTIONS_TABLE,
                Key: { 
                    connectionId: connectionId,
                    serviceType: SERVICE_TYPE
                }
            }).promise(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('DynamoDB delete timeout')), 5000)
            )
        ]);
    } catch (error) {
        console.error('Error removing connection from DynamoDB:', error);
        throw error;
    }
};

const getActiveConnections = async () => {
    try {
        // Add timeout to DynamoDB operation
        const { Items } = await Promise.race([
            dynamoDB.query({
                TableName: CONNECTIONS_TABLE,
                KeyConditionExpression: 'serviceType = :serviceType',
                ExpressionAttributeValues: {
                    ':serviceType': SERVICE_TYPE
                }
            }).promise(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('DynamoDB query timeout')), 5000)
            )
        ]);
        return Items;
    } catch (error) {
        console.error('Error getting active connections from DynamoDB:', error);
        throw error;
    }
};

const sendMessageToClient = async (connectionId, payload) => {
    try {
        // Add timeout to WebSocket API call
        await Promise.race([
            apiGatewayManagementApi.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify(payload)
            }).promise(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('WebSocket API timeout')), 5000)
            )
        ]);
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

const verifyToken = (token) => {
    console.log('Token Verification Attempt:', {
        tokenLength: token.length,
        tokenStart: token.substring(0, 20)
    });

    // Check environment variable
    if (!process.env.JWT_SECRET) {
        console.error('JWT_SECRET environment variable is not set');
        throw new Error('JWT_SECRET is not configured');
    }

    try {
        // Verify the token directly
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        console.log('Token Decoded Successfully:', {
            userId: decoded.userId,
            username: decoded.username
        });

        return decoded;
    } catch (error) {
        console.error('Token Verification Failed:', {
            name: error.name,
            message: error.message
        });

        if (error.name === 'TokenExpiredError') {
            throw new Error('Token has expired');
        }

        throw new Error('Invalid token');
    }
};

const updateConnectionLocation = async (connectionId, locationName) => {
    try {
        // Add timeout to DynamoDB operation
        await Promise.race([
            dynamoDB.update({
                TableName: CONNECTIONS_TABLE,
                Key: { 
                    connectionId: connectionId,
                    serviceType: SERVICE_TYPE
                },
                UpdateExpression: 'SET locationName = :locationName',
                ExpressionAttributeValues: {
                    ':locationName': locationName
                }
            }).promise(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('DynamoDB update timeout')), 5000)
            )
        ]);
    } catch (error) {
        console.error('Error updating connection location:', error);
        throw error;
    }
};

module.exports = {
    storeConnection,
    removeConnection,
    getActiveConnections,
    sendMessageToClient,
    verifyToken,
    updateConnectionLocation
};
