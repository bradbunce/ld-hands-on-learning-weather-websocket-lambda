const mysql = require('mysql2/promise');

const dbConfig = {
    primary: {
        host: process.env.DB_PRIMARY_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    },
    replica: {
        host: process.env.DB_REPLICA_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    }
};

const createConnection = async (operation = 'read') => {
    const config = operation === 'read' ? dbConfig.replica : dbConfig.primary;
    return await mysql.createConnection(config);
};

const getLocationsForUser = async (userId) => {
    const connection = await createConnection('read');
    try {
        const [rows] = await connection.execute(queries.getUserLocations, [userId]);
        return rows;
    } finally {
        await connection.end();
    }
};

module.exports = {
    createConnection,
    getLocationsForUser
};