const mysql = require('mysql2/promise');
const queries = require('./queries');

// Validate required environment variables
const requiredEnvVars = [
    'DB_PRIMARY_HOST',
    'DB_READ_REPLICA_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
];

requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
        throw new Error(`Required environment variable ${varName} is not set`);
    }
});

// Add timeouts to prevent hanging connections
const dbConfig = {
    primary: {
        host: process.env.DB_PRIMARY_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        // Connection pool settings
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        // Keep alive settings
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        // Connection timeout
        connectTimeout: 20000, // Connection timeout in milliseconds
    },
    replica: {
        host: process.env.DB_READ_REPLICA_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        // Connection pool settings
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        // Keep alive settings
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        // Connection timeout
        connectTimeout: 20000, // Connection timeout in milliseconds
    }
};

// Create connection pools instead of single connections
const pools = {
    primary: mysql.createPool(dbConfig.primary),
    replica: mysql.createPool(dbConfig.replica)
};

// Helper function for retrying operations with timeout
const retryOperation = async (operation, maxRetries = 3, timeout = 10000) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
            );
            
            return await Promise.race([operation(), timeoutPromise]);
        } catch (error) {
            lastError = error;
            console.warn(`Database operation attempt ${i + 1}/${maxRetries} failed:`, {
                error: error.message,
                code: error.code,
                attempt: i + 1,
                maxRetries,
                timestamp: new Date().toISOString()
            });
            
            if (i < maxRetries - 1) {
                // Exponential backoff: 100ms, 200ms, 400ms...
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
            }
        }
    }
    throw lastError;
};

// Validate table existence
const validateTables = async (connection) => {
    console.log('Validating database tables...');
    
    try {
        // Check if tables exist
        const [rows] = await connection.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = ? 
            AND table_name IN ('user_locations', 'weather_cache', 'websocket_subscriptions')
        `, [process.env.DB_NAME]);

        const existingTables = rows.map(row => row.table_name.toLowerCase());
        console.log('Existing tables:', existingTables);

        // Create missing tables if needed
        if (!existingTables.includes('user_locations')) {
            console.log('Creating user_locations table...');
            await connection.query(tableQueries.createUserLocationsTable);
        }
        if (!existingTables.includes('weather_cache')) {
            console.log('Creating weather_cache table...');
            await connection.query(tableQueries.createWeatherCacheTable);
        }
        if (!existingTables.includes('websocket_subscriptions')) {
            console.log('Creating websocket_subscriptions table...');
            await connection.query(tableQueries.createWebSocketSubscriptionsTable);
        }
    } catch (error) {
        console.error('Error validating tables:', error);
        throw error;
    }
};

const getConnection = async (operation = 'read') => {
    const pool = operation === 'read' ? pools.replica : pools.primary;
    try {
        console.log('Attempting to get database connection:', {
            operation,
            host: operation === 'read' ? process.env.DB_READ_REPLICA_HOST : process.env.DB_PRIMARY_HOST,
            database: process.env.DB_NAME,
            timestamp: new Date().toISOString()
        });

        const connection = await retryOperation(
            () => pool.getConnection(),
            3,  // max retries
            20000 // 20 second timeout
        );

        // Test the connection and validate tables
        await retryOperation(
            async () => {
                await connection.query('SELECT 1');
                if (operation === 'write') {  // Only validate on write connections
                    await validateTables(connection);
                }
            },
            2,  // fewer retries for test
            10000 // 10 second timeout
        );

        console.log('Successfully established database connection:', {
            operation,
            timestamp: new Date().toISOString()
        });

        return connection;
    } catch (error) {
        console.error('Database connection error:', {
            error: error.message,
            code: error.code,
            operation,
            config: {
                host: operation === 'read' ? dbConfig.replica.host : dbConfig.primary.host,
                user: dbConfig.primary.user,
                database: dbConfig.primary.database
            }
        });
        throw error;
    }
};

const getLocationsForUser = async (userId) => {
    let connection;
    try {
        console.log('Attempting to get locations for user:', {
            userId,
            timestamp: new Date().toISOString()
        });

        connection = await getConnection('read');
        
        // Log the query and parameters
        console.log('Executing getUserLocations query:', {
            query: queries.getUserLocations,
            params: [userId],
            timestamp: new Date().toISOString()
        });

        const [rows] = await retryOperation(
            () => connection.execute(queries.getUserLocations, [userId]),
            3,  // max retries
            20000 // 20 second timeout
        );
        
        console.log('Successfully retrieved user locations:', {
            userId,
            locationCount: rows.length,
            timestamp: new Date().toISOString()
        });

        // Parse any JSON weather data from cache
        return rows.map(row => ({
            ...row,
            weather_data: row.weather_data ? JSON.parse(row.weather_data) : null
        }));
    } catch (error) {
        console.error('Error getting user locations:', {
            error: error.message,
            userId,
            timestamp: new Date().toISOString()
        });
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

const updateWeatherCache = async (locationData) => {
    let connection;
    try {
        const { city_name, country_code, weather_data } = locationData;
        
        console.log('Attempting to update weather cache:', {
            city: city_name,
            country: country_code,
            timestamp: new Date().toISOString()
        });

        connection = await getConnection('write');
        
        await retryOperation(
            () => connection.execute(
                queries.updateWeatherCache,
                [city_name, country_code, JSON.stringify(weather_data)]
            ),
            3,  // max retries
            10000 // 10 second timeout
        );

        console.log('Successfully updated weather cache:', {
            city: city_name,
            country: country_code,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error updating weather cache:', {
            error: error.message,
            locationData,
            timestamp: new Date().toISOString()
        });
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

const addUserLocation = async (userId, locationData) => {
    let connection;
    try {
        const { city_name, country_code, latitude, longitude } = locationData;
        
        console.log('Attempting to add user location:', {
            userId,
            city: city_name,
            country: country_code,
            timestamp: new Date().toISOString()
        });

        connection = await getConnection('write');
        await connection.beginTransaction();

        // Check if location already exists for user
        const [existing] = await retryOperation(
            () => connection.execute(
                queries.checkLocationExists,
                [userId, city_name, country_code]
            ),
            2,  // fewer retries for check
            5000 // shorter timeout for check
        );

        if (existing.length > 0) {
            throw new Error('Location already exists for user');
        }

        // Add location
        const [result] = await retryOperation(
            () => connection.execute(
                queries.addUserLocation,
                [userId, city_name, country_code, latitude, longitude]
            ),
            3,  // max retries
            10000 // 10 second timeout
        );

        await connection.commit();

        console.log('Successfully added user location:', {
            userId,
            city: city_name,
            country: country_code,
            locationId: result.insertId,
            timestamp: new Date().toISOString()
        });

        return result.insertId;
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error adding user location:', {
            error: error.message,
            userId,
            locationData,
            timestamp: new Date().toISOString()
        });
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

const removeUserLocation = async (userId, locationId) => {
    let connection;
    try {
        console.log('Attempting to remove user location:', {
            userId,
            locationId,
            timestamp: new Date().toISOString()
        });

        connection = await getConnection('write');
        
        await retryOperation(
            () => connection.execute(
                queries.removeUserLocation,
                [userId, locationId]
            ),
            3,  // max retries
            10000 // 10 second timeout
        );

        console.log('Successfully removed user location:', {
            userId,
            locationId,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error removing user location:', {
            error: error.message,
            userId,
            locationId,
            timestamp: new Date().toISOString()
        });
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

const updateLocationOrder = async (userId, locationOrders) => {
    let connection;
    try {
        console.log('Attempting to update location order:', {
            userId,
            locationCount: locationOrders.length,
            timestamp: new Date().toISOString()

// Cleanup function to be run periodically
const cleanupOldData = async () => {
    let connection;
    try {
        console.log('Starting database cleanup:', {
            timestamp: new Date().toISOString()
        });

        connection = await getConnection('write');
        
        await retryOperation(
            async () => {
                await connection.execute(queries.cleanupWeatherCache);
                await connection.execute(queries.cleanupSubscriptions);
            },
            3,  // max retries
            20000 // longer timeout for cleanup
        );

        console.log('Successfully completed database cleanup:', {
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error cleaning up old data:', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

module.exports = {
    getConnection,
    getLocationsForUser,
    updateWeatherCache,
    addUserLocation,
    removeUserLocation,
    updateLocationOrder,
    cleanupOldData
};
