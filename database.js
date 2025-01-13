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
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        // Add timeouts
        connectTimeout: 10000, // 10 seconds
        acquireTimeout: 10000, // 10 seconds
        timeout: 10000 // 10 seconds query timeout
    },
    replica: {
        host: process.env.DB_READ_REPLICA_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        // Add timeouts
        connectTimeout: 10000, // 10 seconds
        acquireTimeout: 10000, // 10 seconds
        timeout: 10000 // 10 seconds query timeout
    }
};

// Create connection pools instead of single connections
const pools = {
    primary: mysql.createPool(dbConfig.primary),
    replica: mysql.createPool(dbConfig.replica)
};

const getConnection = async (operation = 'read') => {
    const pool = operation === 'read' ? pools.replica : pools.primary;
    try {
        // Add timeout to getConnection
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database connection timeout')), 10000);
        });

        const connection = await Promise.race([
            pool.getConnection(),
            timeoutPromise
        ]);

        // Test the connection with timeout
        await Promise.race([
            connection.query('SELECT 1'),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Database test query timeout')), 5000);
            })
        ]);

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
        connection = await getConnection('read');
        
        // Add timeout to the query execution
        const queryPromise = connection.execute(queries.getUserLocations, [userId]);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database query timeout')), 10000);
        });

        const [rows] = await Promise.race([queryPromise, timeoutPromise]);
        
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
        connection = await getConnection('write');
        const { city_name, country_code, weather_data } = locationData;
        
        // Add timeout to the query execution
        const queryPromise = connection.execute(
            queries.updateWeatherCache,
            [city_name, country_code, JSON.stringify(weather_data)]
        );
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database query timeout')), 10000);
        });

        await Promise.race([queryPromise, timeoutPromise]);
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
        connection = await getConnection('write');
        
        // Start transaction
        await connection.beginTransaction();

        const { city_name, country_code, latitude, longitude } = locationData;
        
        // Add timeout to the transaction operations
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database transaction timeout')), 15000);
        });

        // Check if location already exists for user
        const [existing] = await Promise.race([
            connection.execute(
                queries.checkLocationExists,
                [userId, city_name, country_code]
            ),
            timeoutPromise
        ]);

        if (existing.length > 0) {
            throw new Error('Location already exists for user');
        }

        // Add location
        const [result] = await Promise.race([
            connection.execute(
                queries.addUserLocation,
                [userId, city_name, country_code, latitude, longitude]
            ),
            timeoutPromise
        ]);

        await connection.commit();
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
        connection = await getConnection('write');
        
        // Add timeout to the query execution
        const queryPromise = connection.execute(
            queries.removeUserLocation,
            [userId, locationId]
        );
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database query timeout')), 10000);
        });

        await Promise.race([queryPromise, timeoutPromise]);
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
        connection = await getConnection('write');
        await connection.beginTransaction();

        // Add timeout for the entire transaction
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database transaction timeout')), 15000);
        });

        const updatePromise = (async () => {
            for (const { locationId, order } of locationOrders) {
                await connection.execute(
                    queries.updateLocationOrder,
                    [order, locationId, userId]
                );
            }
            await connection.commit();
        })();

        await Promise.race([updatePromise, timeoutPromise]);
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error updating location order:', {
            error: error.message,
            userId,
            locationOrders,
            timestamp: new Date().toISOString()
        });
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Cleanup function to be run periodically
const cleanupOldData = async () => {
    let connection;
    try {
        connection = await getConnection('write');
        
        // Add timeout to cleanup operations
        const cleanupPromise = Promise.all([
            connection.execute(queries.cleanupWeatherCache),
            connection.execute(queries.cleanupSubscriptions)
        ]);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database cleanup timeout')), 20000);
        });

        await Promise.race([cleanupPromise, timeoutPromise]);
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
