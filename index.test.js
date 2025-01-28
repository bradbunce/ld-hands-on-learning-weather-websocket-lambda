// Mock all dependencies before requiring any modules
jest.mock('./config', () => ({
  CONNECTIONS_TABLE: 'test-connections-table'
}));

// Mock LaunchDarkly SDK first
const mockLDClient = {
  waitForInitialization: jest.fn().mockResolvedValue(),
  on: jest.fn(),
  variation: jest.fn(),
  close: jest.fn().mockResolvedValue()
};

jest.mock('@launchdarkly/node-server-sdk', () => ({
  init: jest.fn().mockReturnValue(mockLDClient),
  basicLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

// Mock logger before requiring handler
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
    return level <= currentLevel;
  }),
  getCurrentLogLevel: jest.fn().mockImplementation(async () => {
    return await mockLDClient.variation(process.env.LD_LOG_LEVEL_FLAG_KEY, null, LogLevel.INFO);
  })
};

const LogLevel = {
  FATAL: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
  TRACE: 5
};

jest.mock('@bradbunce/launchdarkly-lambda-logger', () => ({
  logger: mockLogger,
  LogLevel
}));

jest.mock('./websocket', () => ({
  storeConnection: jest.fn().mockResolvedValue(),
  removeConnection: jest.fn().mockResolvedValue(),
  sendMessageToClient: jest.fn().mockResolvedValue(),
  verifyToken: jest.fn().mockReturnValue({ userId: '123', username: 'testuser' }),
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

// Now require the modules after all mocks are set up
const { handler } = require('./index');
const LaunchDarkly = require('@launchdarkly/node-server-sdk');
const { logger } = require('@bradbunce/launchdarkly-lambda-logger');

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
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.LD_SDK_KEY;
    delete process.env.LD_LOG_LEVEL_FLAG_KEY;
    delete process.env.CONNECTIONS_TABLE;
    delete process.env.JWT_SECRET;
    delete process.env.WEBSOCKET_API_ENDPOINT;
  });

  describe('LaunchDarkly Integration', () => {
    beforeEach(() => {
      // Set up default flag evaluation behavior
      mockLDClient.variation.mockImplementation((flagKey, context, defaultValue) => {
        if (flagKey === process.env.LD_LOG_LEVEL_FLAG_KEY) {
          return Promise.resolve(LogLevel.INFO); // Default to INFO level
        }
        return Promise.resolve(defaultValue);
      });
    });

    it('should initialize LaunchDarkly client with correct context', async () => {
      await handler(mockEvent);

      // Verify client initialization
      expect(LaunchDarkly.init).toHaveBeenCalledWith('mock-sdk-key', expect.any(Object));
      expect(mockLDClient.waitForInitialization).toHaveBeenCalled();

      // Verify logger initialization with client and context
      expect(logger.initialize).toHaveBeenCalledWith(
        mockLDClient,
        {
          kind: 'service',
          key: 'weather-app-websocket-lambda',
          name: 'Weather App WebSocket Lambda'
        },
        expect.objectContaining({
          logLevelFlagKey: process.env.LD_LOG_LEVEL_FLAG_KEY
        })
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

      await handler({
        ...mockEvent,
        queryStringParameters: {
          ...mockEvent.queryStringParameters,
          token: 'invalid-token'
        }
      });
      
      // Skip checking debug calls since initial setup logs are at debug level
      const debugCalls = logger.debug.mock.calls.filter(call => 
        !call[0].includes('Current log level configuration') &&
        !call[0].includes('Debug level connection info')
      );
      expect(debugCalls.length).toBe(0);
      expect(logger.error).toHaveBeenCalledWith('Token verification failed', {
        error: 'Invalid token',
        connectionId: 'test-connection-id'
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
