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
        keepAliveInitialDelay: 0
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
        keepAliveInitialDelay: 0
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
        const connection = await pool.getConnection();
        // Test the connection
        await connection.query('SELECT 1');
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
        const [rows] = await connection.execute(queries.getUserLocations, [userId]);
        
        // Parse any JSON weather data from cache
        return rows.map(row => ({
            ...row,
            weather_data: row.weather_data ? JSON.parse(row.weather_data) : null
        }));
    } catch (error) {
        console.error('Error getting user locations:', {
            error: error.message,
            userId
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
        
        await connection.execute(
            queries.updateWeatherCache,
            [city_name, country_code, JSON.stringify(weather_data)]
        );
    } catch (error) {
        console.error('Error updating weather cache:', {
            error: error.message,
            locationData
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
        
        // Check if location already exists for user
        const [existing] = await connection.execute(
            queries.checkLocationExists,
            [userId, city_name, country_code]
        );

        if (existing.length > 0) {
            throw new Error('Location already exists for user');
        }

        // Add location
        const [result] = await connection.execute(
            queries.addUserLocation,
            [userId, city_name, country_code, latitude, longitude]
        );

        await connection.commit();
        return result.insertId;
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error adding user location:', {
            error: error.message,
            userId,
            locationData
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
        await connection.execute(
            queries.removeUserLocation,
            [userId, locationId]
        );
    } catch (error) {
        console.error('Error removing user location:', {
            error: error.message,
            userId,
            locationId
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

        for (const { locationId, order } of locationOrders) {
            await connection.execute(
                queries.updateLocationOrder,
                [order, locationId, userId]
            );
        }

        await connection.commit();
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error updating location order:', {
            error: error.message,
            userId,
            locationOrders
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
        await Promise.all([
            connection.execute(queries.cleanupWeatherCache),
            connection.execute(queries.cleanupSubscriptions)
        ]);
    } catch (error) {
        console.error('Error cleaning up old data:', error);
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