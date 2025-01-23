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
    console.log('Storing connection:', { connectionId, userId });
    
    const now = Date.now();
    const ttl = calculateTTL();
    
    try {
        // Store the new connection
        await dynamo.send(new PutCommand({
            TableName: CONFIG.CONNECTIONS_TABLE,
            Item: {
                connectionId: connectionId,
                userId: String(userId),
                timestamp: now,
                ttl: ttl,
                locationIds: [], // Initialize with empty list
                status: 'CONNECTED'
            },
            // Prevent overwriting an existing connection with the same connectionId
            ConditionExpression: 'attribute_not_exists(connectionId)'
        }));
        
        console.log('Connection stored successfully:', { 
            connectionId, 
            userId,
            ttl,
            timestamp: now
        });
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            console.warn('Connection already exists', { connectionId });
        } else {
            console.error('Failed to store connection:', {
                error: error.message,
                connectionId,
                userId,
                detailedError: error
            });
            throw error;
        }
    }
};

const removeConnection = async (connectionId) => {
    console.log('Removing connection:', { connectionId });
    
    try {
        const scanParams = {
            TableName: CONFIG.CONNECTIONS_TABLE,
            FilterExpression: 'connectionId = :connectionId',
            ExpressionAttributeValues: {
                ':connectionId': connectionId
            }
        };

        // First, find the connection to get the userId
        const { Items } = await dynamo.send(new ScanCommand(scanParams));

        if (Items && Items.length > 0) {
            const connection = Items[0];
            await dynamo.send(new DeleteCommand({
                TableName: CONFIG.CONNECTIONS_TABLE,
                Key: { 
                    connectionId: connectionId,
                    userId: connection.userId
                }
            }));
        }
        
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

const updateConnectionTTL = async (connectionId, userId) => {
    console.log('Updating connection TTL:', { connectionId, userId });
    
    const ttl = calculateTTL();
    
    try {
        await dynamo.send(new UpdateCommand({
            TableName: CONFIG.CONNECTIONS_TABLE,
            Key: { 
                connectionId: connectionId,
                userId: String(userId)
            },
            UpdateExpression: 'SET #ttlAttribute = :ttl, #statusAttribute = :status',
            ExpressionAttributeNames: {
                '#ttlAttribute': 'ttl',
                '#statusAttribute': 'status'
            },
            ExpressionAttributeValues: {
                ':ttl': ttl,
                ':status': 'CONNECTED'
            }
        }));
        
        console.log('TTL updated successfully:', { 
            connectionId,
            userId,
            newTtl: ttl
        });
    } catch (error) {
        console.error('Failed to update TTL:', {
            error: error.message,
            connectionId,
            userId,
            detailedError: error
        });
        throw error;
    }
};

const verifyToken = (token) => {
    // Validate environment setup
    if (!process.env.JWT_SECRET) {
        console.error('JWT Configuration Error: JWT_SECRET environment variable is not set');
        throw new Error('JWT configuration error');
    }

    // Validate token input
    if (!token) {
        console.error('Token Verification Failed: No token provided');
        throw new Error('No token provided');
    }

    try {
        // Log basic token details for debugging
        console.log('Token Verification Attempt', {
            tokenLength: token.length,
            tokenStart: token.substring(0, 20)
        });

        // Verify and decode the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Ensure critical fields exist
        if (!decoded.userId || !decoded.username) {
            console.error('Invalid Token: Missing required fields', {
                missingUserId: !decoded.userId,
                missingUsername: !decoded.username
            });
            throw new Error('Invalid token payload');
        }

        // Convert userId to string and prepare return object
        const verifiedPayload = {
            userId: String(decoded.userId),
            username: decoded.username,
            // Preserve other original claims
            iat: decoded.iat,
            exp: decoded.exp
        };

        // Log successful verification details
        console.log('Token Verified Successfully', {
            userId: verifiedPayload.userId,
            username: verifiedPayload.username,
            expiresAt: new Date(decoded.exp * 1000).toISOString()
        });

        return verifiedPayload;

    } catch (error) {
        // Detailed error logging
        console.error('Token Verification Failed', {
            name: error.name,
            message: error.message
        });

        // Specific error handling
        switch (error.name) {
            case 'TokenExpiredError':
                console.warn('Token Expired', {
                    message: 'The token has expired'
                });
                throw new Error('Token has expired');

            case 'JsonWebTokenError':
                console.warn('Invalid Token', {
                    message: 'The token signature is invalid'
                });
                throw new Error('Invalid token signature');

            case 'NotBeforeError':
                console.warn('Token Not Active', {
                    message: 'The token is not yet active'
                });
                throw new Error('Token is not yet active');

            default:
                console.error('Unhandled Token Verification Error', {
                    errorDetails: error
                });
                throw new Error('Token verification failed');
        }
    }
};

const updateConnectionLocations = async (connectionId, locationIds) => {
    console.log('Updating connection locations:', { 
        connectionId,
        locationIds
    });
    
    const ttl = calculateTTL();
    
    try {
        await dynamo.send(new UpdateCommand({
            TableName: CONFIG.CONNECTIONS_TABLE,
            Key: { 
                connectionId: connectionId
            },
            UpdateExpression: 'SET locationIds = :locationIds, #ttlAttribute = :ttl, #statusAttribute = :status',
            ExpressionAttributeNames: {
                '#ttlAttribute': 'ttl',
                '#statusAttribute': 'status'
            },
            ExpressionAttributeValues: {
                ':locationIds': locationIds,
                ':ttl': ttl,
                ':status': 'CONNECTED'
            }
        }));
        
        console.log('Locations updated successfully:', { 
            connectionId,
            locationIds,
            newTtl: ttl
        });
    } catch (error) {
        console.error('Failed to update locations:', {
            error: error.message,
            connectionId,
            locationIds,
            detailedError: error
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
    updateConnectionLocations,
    updateConnectionTTL,
    cleanupUserConnections
};