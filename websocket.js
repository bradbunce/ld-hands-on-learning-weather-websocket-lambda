const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const jwt = require('jsonwebtoken');

// Initialize DynamoDB client
const client = new DynamoDBClient({
    maxAttempts: 3,
    requestTimeout: 5000
});
const dynamo = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
        removeUndefinedValues: true,
    }
});

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'brad-weather-app-websocket-connections';
const ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT;

if (!ENDPOINT) {
    throw new Error('WEBSOCKET_API_ENDPOINT environment variable is required');
}

// Initialize API Gateway client
const apiGateway = new ApiGatewayManagementApiClient({
    endpoint: ENDPOINT,
    maxAttempts: 3,
    requestTimeout: 30000,  // Increase to 30 seconds
    connectTimeout: 10000   // Add explicit connect timeout
});

const storeConnection = async (connectionId, userId) => {
    console.log('Storing connection:', { connectionId, userId });
    
    try {
        await dynamo.send(new PutCommand({
            TableName: CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userId,
                timestamp: Date.now(),
                ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hour TTL
                serviceType: 'weather-updates'
            }
        }));
        
        console.log('Connection stored successfully:', { connectionId, userId });
    } catch (error) {
        console.error('Failed to store connection:', {
            error: error.message,
            connectionId,
            userId
        });
        throw error;
    }
};

const removeConnection = async (connectionId) => {
    console.log('Removing connection:', { connectionId });
    
    try {
        await dynamo.send(new DeleteCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId }
        }));
        
        console.log('Connection removed successfully:', { connectionId });
    } catch (error) {
        console.error('Failed to remove connection:', {
            error: error.message,
            connectionId
        });
        throw error;
    }
};

const getActiveConnections = async () => {
    console.log('Getting active connections');
    
    try {
        const { Items } = await dynamo.send(new ScanCommand({
            TableName: CONNECTIONS_TABLE,
            FilterExpression: 'serviceType = :type',
            ExpressionAttributeValues: {
                ':type': 'weather-updates'
            }
        }));
        
        console.log('Retrieved active connections:', { count: Items?.length || 0 });
        return Items || [];
    } catch (error) {
        console.error('Failed to get active connections:', error.message);
        throw error;
    }
};

const sendMessageToClient = async (connectionId, payload) => {
    try {
        console.log('Starting message send to client:', { 
            connectionId, 
            payloadType: payload.type 
        });
        
        await apiGateway.send(
            new PostToConnectionCommand({
                ConnectionId: connectionId,
                Data: JSON.stringify(payload)
            })
        );
        
        console.log('Message sent successfully');
        return true;
    } catch (error) {
        // Only mark as stale if we get a 410 GONE status
        if (error.$metadata?.httpStatusCode === 410) {
            console.log('Connection gone, removing:', { connectionId });
            await removeConnection(connectionId);
            return false;
        }
        
        // For other errors, log but don't mark as stale
        console.error('Error sending message:', {
            error: error.message,
            code: error.$metadata?.httpStatusCode,
            connectionId
        });
        throw error;
    }
};

const verifyToken = (token) => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Token verified:', { 
            userId: decoded.userId,
            username: decoded.username
        });
        return decoded;
    } catch (error) {
        console.error('Token verification failed:', { 
            error: error.message,
            errorType: error.name 
        });
        
        if (error.name === 'TokenExpiredError') {
            throw new Error('Token has expired');
        }
        throw new Error('Invalid token');
    }
};

const updateConnectionLocation = async (connectionId, locationName) => {
    console.log('Updating connection location:', { 
        connectionId,
        locationName
    });
    
    try {
        await dynamo.send(new UpdateCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET locationName = :locationName',
            ExpressionAttributeValues: {
                ':locationName': locationName
            }
        }));
        
        console.log('Location updated successfully:', { 
            connectionId,
            locationName
        });
    } catch (error) {
        console.error('Failed to update location:', {
            error: error.message,
            connectionId,
            locationName
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