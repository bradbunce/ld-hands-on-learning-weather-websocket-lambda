const queries = {
    // Location queries
    getUserLocations: `
        SELECT
            l.location_id,
            l.name,
            l.region,
            l.country,
            l.country_code,
            l.latitude,
            l.longitude,
            l.timezone,
            ufl.created_at,
            ufl.display_order
        FROM locations l
        JOIN user_favorite_locations ufl ON l.location_id = ufl.location_id
        WHERE ufl.user_id = ?
        ORDER BY ufl.display_order ASC, ufl.created_at ASC
    `,

    addUserLocation: `
        INSERT INTO user_favorite_locations
        (user_id, location_id, display_order)
        VALUES (?, ?, (
            SELECT COALESCE(MAX(display_order), 0) + 1 
            FROM user_favorite_locations 
            WHERE user_id = ?
        ))
    `,

    removeUserLocation: `
        DELETE FROM user_favorite_locations
        WHERE user_id = ? AND location_id = ?
    `,

    // Weather cache queries
    getWeatherCache: `
        SELECT *
        FROM weather_cache
        WHERE location_id = ?
        AND last_updated > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    `,

    // WebSocket connection queries
    getActiveSubscriptions: `
        SELECT 
            ws.connection_id,
            ws.location_id,
            l.name,
            l.region,
            l.country,
            l.country_code,
            l.latitude,
            l.longitude,
            l.timezone
        FROM websocket_subscriptions ws
        JOIN locations l ON ws.location_id = l.location_id
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

    // Cleanup queries
    cleanupWeatherCache: `
        DELETE FROM weather_cache
        WHERE last_updated < DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `,

    cleanupSubscriptions: `
        DELETE FROM websocket_subscriptions
        WHERE last_active < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    `,

    // Check if location exists
    checkLocationExists: `
        SELECT location_id
        FROM user_favorite_locations
        WHERE user_id = ? 
            AND location_id = ?
    `,

    // Update location order
    updateLocationOrder: `
        UPDATE user_favorite_locations
        SET display_order = ?
        WHERE user_id = ?
            AND location_id = ?
    `
};

// Table creation queries (for reference)
const tableQueries = {
    createWebSocketSubscriptionsTable: `
        CREATE TABLE IF NOT EXISTS websocket_subscriptions (
            subscription_id BIGINT PRIMARY KEY AUTO_INCREMENT,
            connection_id VARCHAR(128) NOT NULL,
            location_id INT NOT NULL,
            last_active TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE INDEX idx_connection_location (connection_id, location_id),
            INDEX idx_last_active (last_active),
            FOREIGN KEY (location_id) REFERENCES locations(location_id)
                ON DELETE CASCADE
        )
    `
};

module.exports = {
    queries,
    tableQueries
};