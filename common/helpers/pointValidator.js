/**
 * GPS point validation utilities
 */

// India bounding box coordinates
const INDIA_BOUNDS = {
    north: 37.0,  // Northern limit (J&K)
    south: 6.5,   // Southern limit (Kanyakumari)
    east: 97.5,   // Eastern limit (Arunachal Pradesh)
    west: 68.0    // Western limit (Gujarat)
};

/**
 * Validate and sanitize a GPS point
 * @param {Object} point - Raw GPS point data
 * @returns {Object|null} - Validated point or null if invalid
 */
function validatePoint(point) {
    try {
        // Required fields check
        if (!point || !point.lat || !point.lng || !point.dt_tracker) {
            return null;
        }

        // Parse coordinates
        const lat = parseFloat(point.lat);
        const lng = parseFloat(point.lng);

        // Validate coordinates are within valid ranges
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return null;
        }

        // Check if point is within India's bounds
        if (lat < INDIA_BOUNDS.south || lat > INDIA_BOUNDS.north ||
            lng < INDIA_BOUNDS.west || lng > INDIA_BOUNDS.east) {
            return null;
        }

        // Check for common invalid coordinates
        if (lat === 0 && lng === 0) {  // Origin point (common default)
            return null;
        }

        // Validate timestamp
        let dt_tracker;
        try {
            dt_tracker = new Date(point.dt_tracker);
            if (isNaN(dt_tracker.getTime())) {
                return null;
            }
        } catch (e) {
            return null;
        }

        // Create validated point with fallback values for optional fields
        return {
            type: 'Point',
            coordinates: [lng, lat],
            dt_tracker: dt_tracker,
            gpsRecord: {
                speed: parseFloat(point.speed) || 0,
                heading: parseFloat(point.heading) || 0,
                acc: parseInt(point.acc) || 0
            },
            fuelLevel: point.fuelLevel !== undefined && !isNaN(parseFloat(point.fuelLevel))
                ? parseFloat(point.fuelLevel)
                : null
        };
    } catch (error) {
        console.error('Error validating point:', error);
        return null;
    }
}

module.exports = {
    validatePoint,
    INDIA_BOUNDS
}; 