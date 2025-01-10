const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const CONNECTIONS_TABLE = 'weather-app-websocket-connections';
const SERVICE_TYPE = 'weather-updates';

const storeConnection = async (connectionId, clientId) => {
    try {
        await dynamoDB.put({
            TableName: CONNECTIONS_TABLE,
            Item: {
                connectionId: connectionId,
                serviceType: SERVICE_TYPE,
                clientId: clientId,
                timestamp: Date.now()
            }
        }).promise();
    } catch (error) {
        console.error('Error storing connection in DynamoDB:', error);
        throw error;
    }
};

const removeConnection = async (connectionId) => {
    try {
        await dynamoDB.delete({
            TableName: CONNECTIONS_TABLE,
            Key: { 
                connectionId: connectionId,
                serviceType: SERVICE_TYPE
            }
        }).promise();
    } catch (error) {
        console.error('Error removing connection from DynamoDB:', error);
        throw error;
    }
};

const getActiveConnections = async () => {
    try {
        const { Items } = await dynamoDB.query({
            TableName: CONNECTIONS_TABLE,
            KeyConditionExpression: 'serviceType = :serviceType',
            ExpressionAttributeValues: {
                ':serviceType': SERVICE_TYPE
            }
        }).promise();
        return Items;
    } catch (error) {
        console.error('Error getting active connections from DynamoDB:', error);
        throw error;
    }
};

module.exports = {
    storeConnection,
    removeConnection,
    getActiveConnections
};
