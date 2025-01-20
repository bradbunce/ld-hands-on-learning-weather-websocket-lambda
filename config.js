// config.js
const CONFIG = {
    // WebSocket connection settings
    CONNECTION_TTL_HOURS: 24,
    
    // DynamoDB table name still from environment as this can vary between environments
    CONNECTIONS_TABLE: process.env.CONNECTIONS_TABLE || 'brad-weather-app-websocket-connections',
  };
  
  module.exports = CONFIG;