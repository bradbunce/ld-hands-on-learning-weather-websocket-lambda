const queries = {
    // Location queries
    getUserLocations: `
        SELECT
            ul.location_id,
            ul.city_name,
            ul.country_code,
            ul.latitude,
            ul.longitude,
            ul.created_at,
            COALESCE(wc.weather_data, '{}') as weather_data,
            wc.last_updated as weather_last_updated
        FROM user_locations ul
        LEFT JOIN weather_cache wc 
            ON ul.city_name = wc.city_name 
            AND ul.country_code = wc.country_code
        WHERE ul.user_id = ?
        ORDER BY ul.created_at ASC
    `,

    addUserLocation: `
        INSERT INTO user_locations
        (user_id, city_name, country_code, latitude, longitude)
        VALUES (?, ?, ?, ?, ?)
    `,

    removeUserLocation: `
        DELETE FROM user_locations
        WHERE user_id = ? AND location_id = ?
    `,

    // Weather cache queries
    getWeatherCache: `
        SELECT 
            weather_data,
            last_updated
        FROM weather_cache
        WHERE city_name = ?
            AND country_code = ?
            AND last_updated > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    `,

    updateWeatherCache: `
        INSERT INTO weather_cache
        (city_name, country_code, weather_data, last_updated)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            weather_data = VALUES(weather_data),
            last_updated = NOW()
    `,

    // Cleanup old cache entries
    cleanupWeatherCache: `
        DELETE FROM weather_cache
        WHERE last_updated < DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `,

    // WebSocket connection queries
    getActiveSubscriptions: `
        SELECT 
            ws.connection_id,
            ul.city_name,
            ul.country_code,
            ul.latitude,
            ul.longitude
        FROM websocket_subscriptions ws
        JOIN user_locations ul ON ws.location_id = ul.location_id
        WHERE ws.last_active > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    `,

    updateSubscription: `
        INSERT INTO websocket_subscriptions
        (connection_id, location_id, last_active)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            last_active = NOW()
    `,

    removeSubscription: `
        DELETE FROM websocket_subscriptions
        WHERE connection_id = ?
    `,

    // Cleanup inactive subscriptions
    cleanupSubscriptions: `
        DELETE FROM websocket_subscriptions
        WHERE last_active < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    `,

    // Check if location exists
    checkLocationExists: `
        SELECT location_id
        FROM user_locations
        WHERE user_id = ? 
            AND city_name = ? 
            AND country_code = ?
    `,

    // Update location order
    updateLocationOrder: `
        UPDATE user_locations
        SET display_order = ?
        WHERE location_id = ?
            AND user_id = ?
    `
};

// Table creation queries (for reference)
const tableQueries = {
    createUserLocationsTable: `
        CREATE TABLE IF NOT EXISTS user_locations (
            location_id BIGINT PRIMARY KEY AUTO_INCREMENT,
            user_id BIGINT NOT NULL,
            city_name VARCHAR(100) NOT NULL,
            country_code CHAR(2) NOT NULL,
            latitude DECIMAL(10,8) NOT NULL,
            longitude DECIMAL(11,8) NOT NULL,
            display_order INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_locations (user_id, created_at),
            INDEX idx_location_coords (latitude, longitude)
        )
    `,

    createWeatherCacheTable: `
        CREATE TABLE IF NOT EXISTS weather_cache (
            cache_id BIGINT PRIMARY KEY AUTO_INCREMENT,
            city_name VARCHAR(100) NOT NULL,
            country_code CHAR(2) NOT NULL,
            weather_data JSON NOT NULL,
            last_updated TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE INDEX idx_location (city_name, country_code),
            INDEX idx_last_updated (last_updated)
        )
    `,

    createWebSocketSubscriptionsTable: `
        CREATE TABLE IF NOT EXISTS websocket_subscriptions (
            subscription_id BIGINT PRIMARY KEY AUTO_INCREMENT,
            connection_id VARCHAR(128) NOT NULL,
            location_id BIGINT NOT NULL,
            last_active TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE INDEX idx_connection_location (connection_id, location_id),
            INDEX idx_last_active (last_active),
            FOREIGN KEY (location_id) REFERENCES user_locations(location_id)
                ON DELETE CASCADE
        )
    `
};

module.exports = {
    queries,
    tableQueries
};