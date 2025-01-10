const queries = {
    getUserLocations: `
        SELECT 
            ul.location_id,
            ul.city_name,
            ul.country_code,
            ul.latitude,
            ul.longitude
        FROM user_locations ul
        WHERE ul.user_id = ?
        ORDER BY ul.created_at ASC
    `,
    
    updateWeatherCache: `
        INSERT INTO weather_cache 
            (city_name, country_code, weather_data, last_updated)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            weather_data = VALUES(weather_data),
            last_updated = NOW()
    `
};

module.exports = queries;