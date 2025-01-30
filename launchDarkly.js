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
const initializeLDClient = async () => {
  // Create a temporary client to evaluate the SDK log level flag
  const tempClient = LaunchDarkly.init(process.env.LD_SDK_KEY, {
    logger: LaunchDarkly.basicLogger({ level: 'error' })
  });
  await tempClient.waitForInitialization({timeoutSeconds: 2});

  // Get SDK log level from flag using service context
  const sdkLogLevel = await tempClient.variation(
    process.env.LD_SDK_LOG_LEVEL_FLAG_KEY,
    createServiceContext(),
    'info' // Default to info if flag is not set
  );

  // Clean up temporary client
  await tempClient.close();

  // Create the real client with the configured log level
  const client = LaunchDarkly.init(process.env.LD_SDK_KEY, {
    logger: LaunchDarkly.basicLogger({
      level: sdkLogLevel,
      destination: (level, message) => {
        console.debug(`[LaunchDarkly SDK ${level}] ${message}`);
      }
    })
  });

  // Set up flag change listeners for debugging
  client.on('update', () => {
    logger.debug('LaunchDarkly flag update received');
  });

  // Monitor both log level flags for changes
  client.on('change', async (settings) => {
    if (settings.key === process.env.LD_LOG_LEVEL_FLAG_KEY || 
        settings.key === process.env.LD_SDK_LOG_LEVEL_FLAG_KEY) {
      const [appLogLevel, sdkLogLevel] = await Promise.all([
        client.variation(process.env.LD_LOG_LEVEL_FLAG_KEY, createServiceContext(), 'info'),
        client.variation(process.env.LD_SDK_LOG_LEVEL_FLAG_KEY, createServiceContext(), 'info')
      ]);
      logger.debug('Log level configuration changed:', {
        appLevel: appLogLevel,
        sdkLevel: sdkLogLevel,
        changedFlag: settings.key,
        oldValue: settings.oldValue,
        newValue: settings.newValue
      });
    } else {
      logger.debug('LaunchDarkly flag change detected:', { settings });
    }
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
  const [appLogLevel, sdkLogLevel] = await Promise.all([
    ldClient.variation(process.env.LD_LOG_LEVEL_FLAG_KEY, multiContext, 'info'),
    ldClient.variation(process.env.LD_SDK_LOG_LEVEL_FLAG_KEY, multiContext, 'info')
  ]);

  logger.debug('Current log level configuration:', {
    appLevel: appLogLevel,
    sdkLevel: sdkLogLevel,
    context: multiContext,
    appFlagKey: process.env.LD_LOG_LEVEL_FLAG_KEY,
    sdkFlagKey: process.env.LD_SDK_LOG_LEVEL_FLAG_KEY
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
