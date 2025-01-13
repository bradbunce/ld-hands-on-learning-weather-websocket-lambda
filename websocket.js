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

// Helper function for retrying operations
const retryOperation = async (operation, maxRetries = 3, timeout = 10000) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
            );
            
            return await Promise.race([operation(), timeoutPromise]);
        } catch (error) {
            lastError = error;
            console.warn(`Attempt ${i + 1}/${maxRetries} failed:`, {
                error: error.message,
                code: error.code,
                statusCode: error.statusCode,
                attempt: i + 1,
                maxRetries
            });
            
            if (i < maxRetries - 1) {
                // Exponential backoff: 100ms, 200ms, 400ms...
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
            }
        }
    }
    throw lastError;
};

const storeConnection = async (connectionId, clientId) => {
    console.log('Attempting to store connection:', {
        connectionId,
        clientId,
        serviceType: SERVICE_TYPE,
        table: CONNECTIONS_TABLE,
        timestamp: new Date().toISOString()
    });

    try {
        // First try to get existing connection to see if it exists
        const existingConnection = await retryOperation(
            () => dynamoDB.get({
                TableName: CONNECTIONS_TABLE,
                Key: {
                    connectionID: connectionId
                }
            }).promise(),
            2,  // fewer retries for check
            5000 // shorter timeout for check
        );

        // Log the existing connection if found
        if (existingConnection.Item) {
            console.log('Found existing connection:', {
                connectionId,
                existingData: existingConnection.Item,
                timestamp: new Date().toISOString()
            });
        }

        // Store the connection
        await retryOperation(
            () => dynamoDB.put({
                TableName: CONNECTIONS_TABLE,
                Item: {
                    connectionID: connectionId,
                    clientId: clientId,
                    timestamp: Date.now(),
                    serviceType: SERVICE_TYPE
                }
            }).promise(),
            3,  // max retries
            15000 // 15 second timeout
        );

        console.log('Successfully stored connection:', {
            connectionId,
            clientId,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Failed to store connection after retries:', {
            error: error.message,
            code: error.code,
            statusCode: error.statusCode,
            connectionId,
            clientId,
            table: CONNECTIONS_TABLE,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
};

const removeConnection = async (connectionId) => {
    console.log('Attempting to remove connection:', {
        connectionId,
        table: CONNECTIONS_TABLE,
        timestamp: new Date().toISOString()
    });

    try {
        await retryOperation(
            () => dynamoDB.delete({
                TableName: CONNECTIONS_TABLE,
                Key: { 
                    connectionID: connectionId
                }
            }).promise(),
            3,  // max retries
            15000 // 15 second timeout
        );

        console.log('Successfully removed connection:', {
            connectionId,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Failed to remove connection after retries:', {
            error: error.message,
            code: error.code,
            statusCode: error.statusCode,
            connectionId,
            table: CONNECTIONS_TABLE,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
};

const getActiveConnections = async () => {
    console.log('Attempting to get active connections:', {
        table: CONNECTIONS_TABLE,
        serviceType: SERVICE_TYPE,
        timestamp: new Date().toISOString()
    });

    try {
        const { Items } = await retryOperation(
            () => dynamoDB.scan({
                TableName: CONNECTIONS_TABLE,
                FilterExpression: 'serviceType = :serviceType',
                ExpressionAttributeValues: {
                    ':serviceType': SERVICE_TYPE
                }
            }).promise(),
            3,  // max retries
            15000 // 15 second timeout
        );

        console.log('Successfully retrieved active connections:', {
            connectionCount: Items.length,
            timestamp: new Date().toISOString()
        });

        return Items;
    } catch (error) {
        console.error('Failed to get active connections after retries:', {
            error: error.message,
            code: error.code,
            statusCode: error.statusCode,
            table: CONNECTIONS_TABLE,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
};

const sendMessageToClient = async (connectionId, payload) => {
    console.log('Attempting to send message to client:', {
        connectionId,
        payloadType: payload.type,
        timestamp: new Date().toISOString()
    });

    try {
        await retryOperation(
            () => apiGatewayManagementApi.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify(payload)
            }).promise(),
            3,  // max retries
            15000 // 15 second timeout
        );

        console.log('Successfully sent message to client:', {
            connectionId,
            payloadType: payload.type,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        if (error.statusCode === 410) {
            console.log('Connection stale, removing:', {
                connectionId,
                timestamp: new Date().toISOString()
            });
            await removeConnection(connectionId);
        } else {
            console.error('Failed to send message to client after retries:', {
                error: error.message,
                code: error.code,
                statusCode: error.statusCode,
                connectionId,
                payloadType: payload.type,
                timestamp: new Date().toISOString()
            });
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
    console.log('Attempting to update connection location:', {
        connectionId,
        locationName,
        table: CONNECTIONS_TABLE,
        timestamp: new Date().toISOString()
    });

    try {
        await retryOperation(
            () => dynamoDB.update({
                TableName: CONNECTIONS_TABLE,
                Key: { 
                    connectionID: connectionId
                },
                UpdateExpression: 'SET locationName = :locationName',
                ExpressionAttributeValues: {
                    ':locationName': locationName
                }
            }).promise(),
            3,  // max retries
            15000 // 15 second timeout
        );

        console.log('Successfully updated connection location:', {
            connectionId,
            locationName,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Failed to update connection location after retries:', {
            error: error.message,
            code: error.code,
            statusCode: error.statusCode,
            connectionId,
            locationName,
            table: CONNECTIONS_TABLE,
            timestamp: new Date().toISOString()
        });
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
