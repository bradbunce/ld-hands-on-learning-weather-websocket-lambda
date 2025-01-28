const CONFIG = {
  // WebSocket connection settings
  CONNECTION_TTL_HOURS: 24,
  // DynamoDB table name still from environment as this can vary between environments
  CONNECTIONS_TABLE: process.env.CONNECTIONS_TABLE,
  // LaunchDarkly settings
  LOG_LEVEL_FLAG_KEY: process.env.LD_LOG_LEVEL_FLAG_KEY,
};

// Validate required environment variables
const requiredEnvVars = ['CONNECTIONS_TABLE', 'LD_LOG_LEVEL_FLAG_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

module.exports = CONFIG;