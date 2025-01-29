const LogLevel = {
  FATAL: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
  TRACE: 5
};

// Mock LaunchDarkly client
const mockLDClient = {
  waitForInitialization: jest.fn().mockResolvedValue(),
  on: jest.fn(),
  variation: jest.fn(),
  close: jest.fn().mockResolvedValue(),
  flush: jest.fn().mockResolvedValue()
};

// Mock logger
const mockLogger = {
  initialize: jest.fn().mockResolvedValue(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
  close: jest.fn().mockResolvedValue(),
  shouldLog: jest.fn().mockImplementation(async (level) => {
    const currentLevel = await mockLDClient.variation(process.env.LD_LOG_LEVEL_FLAG_KEY, null, LogLevel.INFO);
    // Always allow error logs regardless of level
    if (level === LogLevel.ERROR) return true;
    return level <= currentLevel;
  }),
  getCurrentLogLevel: jest.fn().mockImplementation(async () => {
    return await mockLDClient.variation(process.env.LD_LOG_LEVEL_FLAG_KEY, null, LogLevel.INFO);
  })
};

// Mock all dependencies before requiring any modules
jest.mock('./config', () => ({
  CONNECTIONS_TABLE: 'test-connections-table'
}));

jest.mock('@bradbunce/launchdarkly-lambda-logger', () => ({
  logger: mockLogger,
  LogLevel
}));

jest.mock('@launchdarkly/node-server-sdk', () => ({
  init: jest.fn().mockReturnValue(mockLDClient),
  basicLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

// Mock LaunchDarkly module functions
const mockInitializeLDClient = jest.fn().mockImplementation(() => {
  return LaunchDarkly.init(process.env.LD_SDK_KEY, {
    logger: LaunchDarkly.basicLogger({
      level: 'debug'
    })
  });
});

const mockInitializeLogger = jest.fn().mockImplementation(async (client, token, verifyToken) => {
  let userContext;
  if (token) {
    try {
      const decoded = verifyToken(token);
      userContext = {
        kind: 'user',
        key: decoded.username || String(decoded.userId),
        name: decoded.name,
        userId: decoded.userId,
        anonymous: false
      };
    } catch (error) {
      userContext = {
        kind: 'user',
        key: 'anonymous',
        anonymous: true
      };
    }
  } else {
    userContext = {
      kind: 'user',
      key: 'anonymous',
      anonymous: true
    };
  }

  const multiContext = {
    kind: 'multi',
    user: userContext,
    service: {
      kind: 'service',
      key: 'weather-app-websocket-lambda',
      name: 'Weather App WebSocket Lambda',
      environment: 'test'
    }
  };

  // Set up event listeners
  client.on('update', () => {});
  client.on('change', () => {});

  // Initialize logger with context
  await logger.initialize(client, multiContext, {
    logLevelFlagKey: process.env.LD_LOG_LEVEL_FLAG_KEY
  });

  // Evaluate log level flag
  await client.variation(process.env.LD_LOG_LEVEL_FLAG_KEY, multiContext, 'info');

  return multiContext;
});

const mockCleanup = jest.fn().mockImplementation(async (client) => {
  await client.flush();
  await Promise.all([
    logger.close(),
    client.close()
  ]);
});

jest.mock('./launchDarkly', () => ({
  initializeLDClient: mockInitializeLDClient,
  initializeLogger: mockInitializeLogger,
  cleanup: mockCleanup
}));

// Now require the modules after all mocks are set up
const { handler } = require('./index');
const LaunchDarkly = require('@launchdarkly/node-server-sdk');
const { logger } = require('@bradbunce/launchdarkly-lambda-logger');

jest.mock('./websocket', () => ({
  storeConnection: jest.fn().mockResolvedValue(),
  removeConnection: jest.fn().mockResolvedValue(),
  sendMessageToClient: jest.fn().mockResolvedValue(),
  verifyToken: jest.fn().mockReturnValue({ 
    userId: '123', 
    username: 'testuser',
    name: 'Test User'
  }),
  updateConnectionLocations: jest.fn().mockResolvedValue(),
  updateConnectionTTL: jest.fn().mockResolvedValue(),
  cleanupUserConnections: jest.fn().mockResolvedValue()
}));

jest.mock('./database', () => ({
  getLocationsForUser: jest.fn().mockResolvedValue([])
}));

jest.mock('./dataProcessor', () => ({
  processWeatherData: jest.fn().mockResolvedValue([])
}));


describe('WebSocket Lambda Handler', () => {
  const mockEvent = {
    requestContext: {
      connectionId: 'test-connection-id',
      routeKey: '$connect'
    },
    queryStringParameters: {
      token: 'valid-token',
      userId: '123'
    }
  };

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Set up required environment variables
    process.env.LD_SDK_KEY = 'mock-sdk-key';
    process.env.LD_LOG_LEVEL_FLAG_KEY = 'lambda-console-logging';
    process.env.CONNECTIONS_TABLE = 'test-connections-table';
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.WEBSOCKET_API_ENDPOINT = 'test-api-endpoint';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.LD_SDK_KEY;
    delete process.env.LD_LOG_LEVEL_FLAG_KEY;
    delete process.env.CONNECTIONS_TABLE;
    delete process.env.JWT_SECRET;
    delete process.env.WEBSOCKET_API_ENDPOINT;
    delete process.env.NODE_ENV;
  });

  describe('LaunchDarkly Integration', () => {
    // Set timeout for all tests in this describe block
    jest.setTimeout(10000);

    beforeEach(() => {
      // Set up default flag evaluation behavior
      mockLDClient.variation.mockImplementation((flagKey, context, defaultValue) => {
        if (flagKey === process.env.LD_LOG_LEVEL_FLAG_KEY) {
          return Promise.resolve(LogLevel.INFO); // Default to INFO level
        }
        return Promise.resolve(defaultValue);
      });
    });

    it('should initialize LaunchDarkly client with correct multi-context', async () => {
      const mockToken = 'valid-token';
      const mockDecodedToken = { 
        userId: '123', 
        username: 'testuser',
        name: 'Test User'
      };
      
      const mockWebsocket = require('./websocket');
      mockWebsocket.verifyToken.mockReturnValueOnce(mockDecodedToken);

      await handler({
        ...mockEvent,
        queryStringParameters: {
          ...mockEvent.queryStringParameters,
          token: mockToken
        }
      });

      // Verify client initialization
      expect(LaunchDarkly.init).toHaveBeenCalledWith('mock-sdk-key', expect.any(Object));
      expect(mockLDClient.waitForInitialization).toHaveBeenCalled();

      // Verify logger initialization with multi-context
      expect(logger.initialize).toHaveBeenCalledWith(
        mockLDClient,
        {
          kind: 'multi',
          user: {
            kind: 'user',
            key: 'testuser',
            name: 'Test User',
            userId: '123',
            anonymous: false
          },
          service: {
            kind: 'service',
            key: 'weather-app-websocket-lambda',
            name: 'Weather App WebSocket Lambda',
            environment: 'test'
          }
        },
        expect.objectContaining({
          logLevelFlagKey: process.env.LD_LOG_LEVEL_FLAG_KEY
        })
      );
    });

    it('should use anonymous user context when no token is provided', async () => {
      await handler({
        ...mockEvent,
        queryStringParameters: {}
      });

      expect(logger.initialize).toHaveBeenCalledWith(
        mockLDClient,
        {
          kind: 'multi',
          user: {
            kind: 'user',
            key: 'anonymous',
            anonymous: true
          },
          service: expect.any(Object)
        },
        expect.any(Object)
      );
    });

    it('should use anonymous user context when token verification fails', async () => {
      const mockWebsocket = require('./websocket');
      mockWebsocket.verifyToken.mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });

      await handler({
        ...mockEvent,
        queryStringParameters: {
          token: 'invalid-token'
        }
      });

      expect(logger.initialize).toHaveBeenCalledWith(
        mockLDClient,
        {
          kind: 'multi',
          user: {
            kind: 'user',
            key: 'anonymous',
            anonymous: true
          },
          service: expect.any(Object)
        },
        expect.any(Object)
      );
    });

    it('should set up flag change listeners', async () => {
      await handler(mockEvent);

      // Verify event listeners were set up
      expect(mockLDClient.on).toHaveBeenCalledWith('update', expect.any(Function));
      expect(mockLDClient.on).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should properly clean up resources', async () => {
      await handler(mockEvent);

      // Verify both logger and client were closed
      expect(logger.close).toHaveBeenCalled();
      expect(mockLDClient.close).toHaveBeenCalled();
    });

    it('should log at different levels based on context', async () => {
      await handler(mockEvent);

      // Verify different log levels were used
      expect(logger.trace).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it('should evaluate log level flag for each log operation', async () => {
      await handler(mockEvent);

      // The flag should be evaluated multiple times for different log levels
      expect(mockLDClient.variation).toHaveBeenCalledWith(
        process.env.LD_LOG_LEVEL_FLAG_KEY,
        expect.any(Object),
        expect.any(String)
      );
    });

    it('should respect different log levels based on flag value', async () => {
      // First test with DEBUG level
      mockLDClient.variation.mockImplementation((flagKey, context, defaultValue) => {
        // Verify multi-context structure
        expect(context).toEqual({
          kind: 'multi',
          user: {
            kind: 'user',
            key: 'testuser',
            name: 'Test User',
            userId: '123',
            anonymous: false
          },
          service: {
            kind: 'service',
            key: 'weather-app-websocket-lambda',
            name: 'Weather App WebSocket Lambda',
            environment: 'test'
          }
        });

        if (flagKey === process.env.LD_LOG_LEVEL_FLAG_KEY) {
          return Promise.resolve(LogLevel.DEBUG);
        }
        return Promise.resolve(defaultValue);
      });
      mockLogger.shouldLog.mockImplementation(async (level) => {
        return level <= LogLevel.DEBUG;
      });
      await handler(mockEvent);
      expect(logger.debug).toHaveBeenCalled();

      // Then test with ERROR level only
      jest.clearAllMocks();
      mockLDClient.variation.mockImplementation((flagKey, context, defaultValue) => {
        // Verify multi-context structure for anonymous user
        expect(context).toEqual({
          kind: 'multi',
          user: {
            kind: 'user',
            key: 'anonymous',
            anonymous: true
          },
          service: {
            kind: 'service',
            key: 'weather-app-websocket-lambda',
            name: 'Weather App WebSocket Lambda',
            environment: 'test'
          }
        });

        if (flagKey === process.env.LD_LOG_LEVEL_FLAG_KEY) {
          return Promise.resolve(LogLevel.ERROR);
        }
        return Promise.resolve(defaultValue);
      });
      mockLogger.shouldLog.mockImplementation(async (level) => {
        return level <= LogLevel.ERROR;
      });

      // Mock verifyToken to throw an error
      const mockWebsocket = require('./websocket');
      mockWebsocket.verifyToken.mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });

      // Create event with missing token and userId
      const eventWithMissingParams = {
        requestContext: {
          connectionId: 'test-connection-id',
          routeKey: '$connect'
        },
        queryStringParameters: {}
      };

      // Initialize logger and LaunchDarkly client
      await mockLDClient.waitForInitialization();
      await logger.initialize(mockLDClient, {
        kind: 'multi',
        user: {
          kind: 'user',
          key: 'anonymous',
          anonymous: true
        },
        service: {
          kind: 'service',
          key: 'weather-app-websocket-lambda',
          name: 'Weather App WebSocket Lambda',
          environment: 'test'
        }
      }, {
        logLevelFlagKey: process.env.LD_LOG_LEVEL_FLAG_KEY
      });

      // Call handler and expect 401 response
      const response = await handler(eventWithMissingParams);
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).message).toBe('Authorization token and userId required');

      // Verify warning was logged
      expect(logger.warn).toHaveBeenCalledWith("Missing token or userId", {
        hasToken: false,
        hasUserId: false
      });
    });

    it('should handle LaunchDarkly initialization failure', async () => {
      // Mock logger before initialization fails
      mockLDClient.waitForInitialization.mockRejectedValueOnce(new Error('Init failed'));
      
      try {
        await handler(mockEvent);
      } catch (error) {
        expect(error.message).toBe('Init failed');
      }

      // Verify error was logged
      expect(logger.error).toHaveBeenCalledWith('LaunchDarkly initialization failed:', {
        error: 'Init failed'
      });
    });
  });
});
