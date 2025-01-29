const LaunchDarkly = require('@launchdarkly/node-server-sdk');
const { logger } = require('@bradbunce/launchdarkly-lambda-logger');

// Create service context
const createServiceContext = () => ({
  kind: 'service',
  key: 'weather-app-websocket-lambda',
  name: 'Weather App WebSocket Lambda',
  environment: process.env.NODE_ENV || 'development'
});

// Create user context from token
const createUserContext = (token, verifyToken) => {
  if (!token) {
    return {
      kind: 'user',
      key: 'anonymous',
      anonymous: true
    };
  }

  try {
    const decoded = verifyToken(token);
    return {
      kind: 'user',
      key: decoded.username || String(decoded.userId),
      name: decoded.name,
      userId: decoded.userId,
      anonymous: false
    };
  } catch (error) {
    return {
      kind: 'user',
      key: 'anonymous',
      anonymous: true
    };
  }
};

// Create multi-context
const createMultiContext = (token, verifyToken) => ({
  kind: 'multi',
  user: createUserContext(token, verifyToken),
  service: createServiceContext()
});

// Initialize LaunchDarkly client
const initializeLDClient = () => {
  const client = LaunchDarkly.init(process.env.LD_SDK_KEY, {
    logger: LaunchDarkly.basicLogger({
      level: 'debug',
      destination: (level, message) => {
        console.debug(`[LaunchDarkly SDK ${level}] ${message}`);
      }
    })
  });

  // Set up flag change listeners for debugging
  client.on('update', () => {
    logger.debug('LaunchDarkly flag update received');
  });

  client.on('change', (settings) => {
    logger.debug('LaunchDarkly flag change detected:', { settings });
  });

  return client;
};

// Initialize logger with LaunchDarkly client and context
const initializeLogger = async (ldClient, token, verifyToken) => {
  const multiContext = createMultiContext(token, verifyToken);
  await logger.initialize(ldClient, multiContext, {
    logLevelFlagKey: process.env.LD_LOG_LEVEL_FLAG_KEY
  });

  // Log current configuration for debugging
  const currentLogLevel = await ldClient.variation(
    process.env.LD_LOG_LEVEL_FLAG_KEY,
    multiContext,
    'info'
  );
  logger.debug('Current log level configuration:', {
    level: currentLogLevel,
    context: multiContext,
    flagKey: process.env.LD_LOG_LEVEL_FLAG_KEY
  });

  return multiContext;
};

// Clean up LaunchDarkly resources
const cleanup = async (ldClient) => {
  await ldClient.flush();
  await Promise.all([logger.close(), ldClient.close()]);
};

module.exports = {
  createServiceContext,
  createUserContext,
  createMultiContext,
  initializeLDClient,
  initializeLogger,
  cleanup
};
