const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const jwt = require('jsonwebtoken');
const CONFIG = require('./config');

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

const ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT;

if (!ENDPOINT) {
    throw new Error('WEBSOCKET_API_ENDPOINT environment variable is required');
}

// Initialize API Gateway client
const apiGateway = new ApiGatewayManagementApiClient({
    endpoint: ENDPOINT,
    maxAttempts: 3,
    requestTimeout: 30000,
    connectTimeout: 10000
});

// Helper function to calculate TTL
const calculateTTL = () => Math.floor(Date.now() / 1000) + (CONFIG.CONNECTION_TTL_HOURS * 60 * 60);

const storeConnection = async (connectionId, userId) => {
    // Explicitly convert userId to string
    const stringUserId = String(userId);
    
    console.log('Storing connection:', { connectionId, userId: stringUserId });
    
    const now = Date.now();
    const ttl = calculateTTL();
    
    try {
        await dynamo.send(new PutCommand({
            TableName: CONFIG.CONNECTIONS_TABLE,
            Item: {
                connectionId,
                userId: stringUserId,  // Ensure string type
                timestamp: now,
                ttl,
                expiresAt: new Date(ttl * 1000).toISOString(),
                serviceType: 'weather-updates',
                locationName: null
            }
        }));
        
        console.log('Connection stored successfully:', { 
            connectionId, 
            userId: stringUserId,
            ttl,
            expiresAt: new Date(ttl * 1000).toISOString()
        });
    } catch (error) {
        console.error('Failed to store connection:', {
            error: error.message,
            connectionId,
            userId: stringUserId
        });
        throw error;
    }
};

const removeConnection = async (connectionId) => {
    console.log('Removing connection:', { connectionId });
    
    try {
        await dynamo.send(new DeleteCommand({
            TableName: CONFIG.CONNECTIONS_TABLE,
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
    
    const now = Math.floor(Date.now() / 1000);
    
    try {
        const { Items } = await dynamo.send(new ScanCommand({
            TableName: CONFIG.CONNECTIONS_TABLE,
            FilterExpression: 'serviceType = :type AND ttl > :now',
            ExpressionAttributeValues: {
                ':type': 'weather-updates',
                ':now': now
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
        
        console.error('Error sending message:', {
            error: error.message,
            code: error.$metadata?.httpStatusCode,
            connectionId
        });
        throw error;
    }
};

const updateConnectionTTL = async (connectionId) => {
    console.log('Updating connection TTL:', { connectionId });
    
    const ttl = calculateTTL();
    
    try {
        await dynamo.send(new UpdateCommand({
            TableName: CONFIG.CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET #ttl = :ttl, expiresAt = :expiresAt',
            ExpressionAttributeNames: {
                '#ttl': 'ttl'
            },
            ExpressionAttributeValues: {
                ':ttl': ttl,
                ':expiresAt': new Date(ttl * 1000).toISOString()
            }
        }));
        
        console.log('TTL updated successfully:', { 
            connectionId,
            newTtl: ttl,
            expiresAt: new Date(ttl * 1000).toISOString()
        });
    } catch (error) {
        console.error('Failed to update TTL:', {
            error: error.message,
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
        
        // Explicitly convert userId to string
        const stringUserId = String(decoded.userId);
        
        console.log('Token verified:', { 
            userId: stringUserId,
            username: decoded.username
        });
        
        // Return decoded object with stringified userId
        return {
            ...decoded,
            userId: stringUserId
        };
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

const updateConnectionLocation = async (connectionId, locationId) => {
    console.log('Updating connection location:', { 
        connectionId,
        locationId
    });
    
    try {
        const ttl = calculateTTL();
        
        await dynamo.send(new UpdateCommand({
            TableName: CONFIG.CONNECTIONS_TABLE,
            Key: { connectionId },
            UpdateExpression: 'SET locationId = :locationId, #ttl = :ttl, expiresAt = :expiresAt',
            ExpressionAttributeNames: {
                '#ttl': 'ttl'
            },
            ExpressionAttributeValues: {
                ':locationId': locationId,
                ':ttl': ttl,
                ':expiresAt': new Date(ttl * 1000).toISOString()
            }
        }));
        
        console.log('Location and TTL updated successfully:', { 
            connectionId,
            locationId,
            newTtl: ttl,
            expiresAt: new Date(ttl * 1000).toISOString()
        });
    } catch (error) {
        console.error('Failed to update location:', {
            error: error.message,
            connectionId,
            locationId
        });
        throw error;
    }
};

const cleanupUserConnections = async (userId) => {
    // Explicitly convert userId to string
    const stringUserId = String(userId);
    
    console.log('Cleaning up connections for user:', { userId: stringUserId });
    
    try {
        // Query for all connections belonging to this user
        const { Items } = await dynamo.send(new ScanCommand({
            TableName: CONFIG.CONNECTIONS_TABLE,
            FilterExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': stringUserId
            }
        }));

        if (!Items?.length) {
            console.log('No connections found for user:', { userId: stringUserId });
            return;
        }

        console.log('Found connections to cleanup:', { 
            userId: stringUserId, 
            connectionCount: Items.length,
            connections: Items.map(item => item.connectionId)
        });

        // Remove each connection
        const deletePromises = Items.map(item => 
            dynamo.send(new DeleteCommand({
                TableName: CONFIG.CONNECTIONS_TABLE,
                Key: { connectionId: item.connectionId }
            }))
        );

        await Promise.all(deletePromises);

        console.log('Successfully cleaned up user connections:', {
            userId: stringUserId,
            cleanedCount: Items.length
        });
    } catch (error) {
        console.error('Error cleaning up user connections:', {
            error: error.message,
            userId: stringUserId
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
    updateConnectionLocation,
    updateConnectionTTL,
    cleanupUserConnections
};