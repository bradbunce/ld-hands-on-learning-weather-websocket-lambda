const queries = {
    // User Location Queries
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
            ufl.display_order,
            ufl.created_at,
            w.temp_f as temperature,
            w.condition_text as \`condition\`,
            w.humidity,
            w.wind_mph as wind_speed,
            w.feelslike_f as feels_like,
            w.is_day,
            w.condition_code,
            w.condition_icon,
            w.wind_kph,
            w.wind_degree,
            w.wind_dir,
            w.pressure_mb,
            w.pressure_in,
            w.precip_mm,
            w.precip_in,
            w.cloud,
            w.vis_km,
            w.vis_miles,
            w.uv,
            w.gust_mph,
            w.gust_kph,
            w.last_updated
        FROM locations l
        JOIN user_favorite_locations ufl ON l.location_id = ufl.location_id
        LEFT JOIN weather_cache w ON l.location_id = w.location_id
        WHERE ufl.user_id = ?
        ORDER BY ufl.display_order ASC, ufl.created_at ASC
    `,

    addUserFavoriteLocation: `
        INSERT INTO user_favorite_locations
        (user_id, location_id, display_order)
        VALUES (?, ?, (
            SELECT COALESCE(MAX(display_order), -1) + 1
            FROM user_favorite_locations
            WHERE user_id = ?
        ))
    `,

    removeUserLocation: `
        DELETE FROM user_favorite_locations
        WHERE user_id = ? AND location_id = ?
    `,

    updateLocationOrder: `
        UPDATE user_favorite_locations
        SET display_order = ?
        WHERE user_id = ? AND location_id = ?
    `,

    // Weather Queries
    getLocationWeather: `
        SELECT 
            l.location_id,
            l.name,
            l.region,
            l.country,
            l.country_code,
            l.latitude,
            l.longitude,
            l.timezone,
            w.temp_f as temperature,
            w.condition_text as \`condition\`,
            w.humidity,
            w.wind_mph as wind_speed,
            w.feelslike_f as feels_like,
            w.is_day,
            w.condition_code,
            w.condition_icon,
            w.wind_kph,
            w.wind_degree,
            w.wind_dir,
            w.pressure_mb,
            w.pressure_in,
            w.precip_mm,
            w.precip_in,
            w.cloud,
            w.vis_km,
            w.vis_miles,
            w.uv,
            w.gust_mph,
            w.gust_kph,
            w.last_updated
        FROM locations l
        LEFT JOIN weather_cache w ON l.location_id = w.location_id
        WHERE l.location_id = ?
    `,

    // WebSocket Subscription Queries
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

    cleanupSubscriptions: `
        DELETE FROM websocket_subscriptions
        WHERE last_active < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    `,

    checkLocationExists: `
        SELECT location_id
        FROM user_favorite_locations
        WHERE user_id = ?
            AND location_id = ?
    `
};

module.exports = {
    queries
};