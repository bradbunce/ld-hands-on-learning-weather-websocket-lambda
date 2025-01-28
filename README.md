# Weather App WebSocket Lambda

A serverless WebSocket handler for real-time weather updates, built on AWS Lambda and API Gateway.

## Overview

This Lambda function manages WebSocket connections for a real-time weather update service. It provides:

- Real-time weather updates for user-selected locations
- Secure WebSocket connections with JWT authentication
- Connection management using DynamoDB
- Weather data persistence using MySQL
- Automatic connection cleanup and data caching

## Architecture

The service is built using several key components:

- **AWS Lambda**: Handles WebSocket events and business logic
- **API Gateway**: Manages WebSocket connections
- **DynamoDB**: Stores active WebSocket connections
- **MySQL**: Stores weather data and user preferences
  - Primary/Replica setup for read/write operations
  - Connection pooling for optimal performance

### Key Components

1. **WebSocket Handler** (`index.js`)
   - Manages WebSocket lifecycle events (connect/disconnect)
   - Routes incoming messages
   - Handles authentication and authorization

2. **Connection Management** (`websocket.js`)
   - Stores and manages active connections in DynamoDB
   - Handles message broadcasting
   - Implements connection TTL and cleanup

3. **Data Processing** (`dataProcessor.js`)
   - Transforms weather data from various sources
   - Validates data integrity
   - Standardizes data format

4. **Database Operations** (`database.js`)
   - Manages MySQL connections with pooling
   - Implements retry mechanisms
   - Handles data persistence and caching

## Setup

### Prerequisites

- AWS Account with Lambda and API Gateway access
- MySQL database (Primary and Read Replica)
- Node.js 22 or later

### Environment Variables

```bash
# AWS Configuration
WEBSOCKET_API_ENDPOINT=       # API Gateway WebSocket endpoint
AWS_REGION=                   # AWS region for services
AWS_PROFILE=                  # AWS credentials profile (for local development)

# DynamoDB Configuration
CONNECTIONS_TABLE=            # DynamoDB table for storing WebSocket connections

# Database Configuration
DB_PRIMARY_HOST=             # MySQL primary host
DB_READ_REPLICA_HOST=        # MySQL read replica host
DB_USER=                     # Database username
DB_PASSWORD=                 # Database password
DB_NAME=                     # Database name

# Authentication
JWT_SECRET=                  # Secret for JWT verification

# LaunchDarkly Configuration
LD_SDK_KEY=                  # LaunchDarkly SDK key
LD_SDK_LOG_LEVEL=            # LaunchDarkly SDK log level (error, warn, info, debug)
LD_LOG_LEVEL_FLAG_KEY=       # LaunchDarkly flag key for dynamic log level control
```

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
   Note: Some development dependencies (Jest) may show deprecation warnings. These are handled via package overrides and do not affect production functionality.
3. Configure environment variables (see .env.example)
4. Deploy to AWS Lambda

## WebSocket API

### Connection

Connect with authentication:
```
wss://[your-api-endpoint]?token=[jwt-token]&userId=[user-id]
```

### Message Types

1. **getWeather**
   ```json
   {
     "token": "jwt-token",
     "locations": ["location-id-1", "location-id-2"]
   }
   ```

2. **locationUpdate**
   ```json
   {
     "token": "jwt-token",
     "locationId": "location-id"
   }
   ```

3. **subscribe/unsubscribe**
   ```json
   {
     "action": "subscribe",
     "token": "jwt-token",
     "locationId": "location-id"
   }
   ```

### Response Format

Success Response:
```json
{
  "type": "weatherUpdate",
  "data": [
    {
      "id": "location-id",
      "name": "Location Name",
      "weather": {
        "temperature": 20,
        "condition": "Sunny",
        "humidity": 65,
        "windSpeed": 10,
        "feelsLike": 22,
        "lastUpdated": "2024-01-27T10:00:00Z"
      }
    }
  ],
  "timestamp": "2024-01-27T10:00:00Z"
}
```

Error Response:
```json
{
  "type": "error",
  "message": "Error description",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-27T10:00:00Z"
}
```

## Error Handling

The service implements comprehensive error handling:
- Connection validation
- Token verification
- Data validation
- Database operation retries
- Graceful degradation

## Monitoring

### LaunchDarkly Integration

The service uses LaunchDarkly for both dynamic logging control and feature flag management. The implementation is optimized for AWS Lambda's execution environment:

#### Lambda-Optimized Implementation
- Creates a single LaunchDarkly client per Lambda invocation
- Passes the client to the logger utility to avoid duplicate connections
- Properly handles initialization and cleanup within Lambda's lifecycle
- Monitors flag changes during the Lambda execution

#### Client Setup
   ```javascript
   const ldClient = LaunchDarkly.init(process.env.LD_SDK_KEY);
   await ldClient.waitForInitialization();
   
   // Pass client to logger utility
   await logger.initialize(ldClient, {
     kind: 'service',
     key: 'weather-app-websocket-lambda',
     name: 'Weather App WebSocket Lambda'
   }, {
     logLevelFlagKey: process.env.LD_LOG_LEVEL_FLAG_KEY
   });
   ```

#### Dynamic Log Levels
   - Controlled by flag specified in LD_LOG_LEVEL_FLAG_KEY environment variable
   - Flag is evaluated on every log call to determine if that level should be logged
   - Log levels (increasing verbosity):
     * 0: FATAL (💀) - Unrecoverable errors
     * 1: ERROR (🔴) - Severe but non-fatal errors
     * 2: WARN (🟡) - Potentially harmful situations
     * 3: INFO (🔵) - General operational messages
     * 4: DEBUG (⚪) - Detailed debugging information
     * 5: TRACE (🟣) - Very detailed debugging information
   - Each level includes all levels above it (e.g., INFO includes FATAL, ERROR, and WARN)
   - Flag value determines maximum log level (e.g., value of 3 enables INFO and below)

#### Flag Monitoring
   ```javascript
   // Monitor flag updates
   ldClient.on('update', () => {
     logger.debug('LaunchDarkly flag update received');
   });

   ldClient.on('change', (settings) => {
     logger.debug('LaunchDarkly flag change detected:', { settings });
   });
   ```

   The logger evaluates the flag specified by LD_LOG_LEVEL_FLAG_KEY before each log operation:
   ```javascript
   async getCurrentLogLevel() {
     if (!this.ldClient) return LogLevel.ERROR;
     return await this.ldClient.variation(this.FLAG_KEY, this.context, LogLevel.ERROR);
   }

   async shouldLog(level) {
     const currentLevel = await this.getCurrentLogLevel();
     return level <= currentLevel;
   }
   ```

   This allows for real-time log level adjustments without redeploying the Lambda function.

#### Resource Cleanup
   ```javascript
   // Properly close both logger and client
   await Promise.all([
     logger.close(),
     ldClient.close()
   ]);
   ```

#### Benefits
- Single connection to LaunchDarkly per Lambda invocation
- Efficient resource usage
- Real-time flag updates during execution
- Proper cleanup to prevent resource leaks
- Ability to monitor flag changes for debugging

### Additional Monitoring
- Performance metrics for database operations
- Connection lifecycle tracking
- Error tracking and reporting

## Security

- JWT-based authentication
- Connection TTL management
- Automatic stale connection cleanup
- Input validation and sanitization

## Performance Considerations

- Connection pooling for database operations
- Read/Write splitting with MySQL replica
- Retry mechanisms with exponential backoff
- Efficient data caching
- Optimized database queries

## Development

To run locally for development:

1. Set up environment variables
2. Install dependencies:
   ```bash
   npm install
   ```
3. Use AWS SAM or similar tools for local testing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
