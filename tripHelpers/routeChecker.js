const { getLengthBetweenPoints } = require('../common/helpers/helper');
const { tripLogger } = require('../common/helpers/logger');


/**
 * Calculate route progress metrics
 * @param {Object} truckPoint - Current truck position
 * @param {Object} segmentPath - Path object with coordinates
 * @returns {Object} Route progress metrics
 */
function calculateRouteProgress(truckPoint, segmentPath) {
    try {
        if (!truckPoint || !segmentPath?.coordinates) {
            return null;
        }

        // Find nearest point on route
        let nearestPointIndex = 0;
        let minDistance = Infinity;
        let nearestRoutePoint = null;

        segmentPath.coordinates.forEach((coord, index) => {
            const routePoint = {
                latitude: coord[1],
                longitude: coord[0]
            };
            const distance = getLengthBetweenPoints(
                { latitude: truckPoint.lat, longitude: truckPoint.lng },
                routePoint
            );

            if (!distance || isNaN(distance)) {
                return;
            }

            if (distance < minDistance) {
                minDistance = distance;
                nearestPointIndex = index;
                nearestRoutePoint = { lat: coord[1], lng: coord[0] };
            }
        });

        // Calculate cumulative distance
        let distanceCovered = 0;
        for (let i = 0; i < nearestPointIndex; i++) {
            const point1 = {
                latitude: segmentPath.coordinates[i][1],
                longitude: segmentPath.coordinates[i][0]
            };
            const point2 = {
                latitude: segmentPath.coordinates[i + 1][1],
                longitude: segmentPath.coordinates[i + 1][0]
            };
            distanceCovered += getLengthBetweenPoints(point1, point2);
        }

        const totalLength = segmentPath.length || 0;
        const distanceRemaining = totalLength - distanceCovered;
        const completionPercentage = (distanceCovered / totalLength) * 100;

        return {
            nearestPointIndex,
            distanceFromTruck: minDistance / 1000, // Convert to km
            distanceCovered: distanceCovered / 1000,
            distanceRemaining: distanceRemaining / 1000,
            completionPercentage
        };

    } catch (err) {
        console.error('Error in calculateRouteProgress:', err);
        return null;
    }
}

/**
 * Check truck position against route and calculate progress
 * @param {Object} truckPoint - Current truck GPS point
 * @param {Array} routePath - Array of route points
 * @returns {Object} - Route progress information
 */
function routeChecker(truckPoint, routePath) {
    try {
        if (!truckPoint || !routePath || !Array.isArray(routePath) || routePath.length === 0) {
            return {
                onRoute: false,
                nearestPointIndex: 0,
                distanceToRoute: 0,
                distanceCovered: 0,
                distanceRemaining: 0,
                completionPercentage: 0
            };
        }

        // Find nearest point on route
        const { index: nearestPointIndex, distance: distanceToRoute } = findNearestPoint(
            truckPoint.lat, truckPoint.lng, routePath
        );

        // Calculate distance covered (from start to nearest point)
        let distanceCovered = 0;
        for (let i = 0; i < nearestPointIndex; i++) {
            distanceCovered += calculateDistance(
                routePath[i].lat, routePath[i].lng,
                routePath[i + 1].lat, routePath[i + 1].lng
            );
        }

        // Calculate total route length
        let totalRouteLength = 0;
        for (let i = 0; i < routePath.length - 1; i++) {
            totalRouteLength += calculateDistance(
                routePath[i].lat, routePath[i].lng,
                routePath[i + 1].lat, routePath[i + 1].lng
            );
        }

        // Calculate distance remaining
        const distanceRemaining = Math.max(0, totalRouteLength - distanceCovered);

        // Calculate completion percentage safely
        let completionPercentage = 0;
        if (totalRouteLength > 0) {
            completionPercentage = (distanceCovered / totalRouteLength) * 100;
            // Ensure it's a valid number between 0 and 100
            completionPercentage = Math.max(0, Math.min(100, completionPercentage));
            // Ensure it's not NaN
            if (isNaN(completionPercentage)) {
                completionPercentage = 0;
            }
        }

        // Determine if truck is on route (within threshold)
        const onRoute = distanceToRoute <= 100; // 100 meters threshold

        return {
            onRoute,
            nearestPointIndex,
            distanceToRoute,
            distanceCovered,
            distanceRemaining,
            completionPercentage,
            totalRouteLength
        };
    } catch (error) {
        console.error('Error in routeChecker:', error);
        // Return safe default values in case of error
        return {
            onRoute: false,
            nearestPointIndex: 0,
            distanceToRoute: 0,
            distanceCovered: 0,
            distanceRemaining: 0,
            completionPercentage: 0,
            totalRouteLength: 0
        };
    }
}

/**
 * Find nearest point on route to truck position
 * @param {number} lat - Truck latitude
 * @param {number} lng - Truck longitude
 * @param {Array} routePath - Array of route points
 * @returns {Object} - Nearest point index and distance
 */
function findNearestPoint(lat, lng, routePath) {
    let minDistance = Infinity;
    let nearestIndex = 0;

    for (let i = 0; i < routePath.length; i++) {
        const distance = calculateDistance(lat, lng, routePath[i].lat, routePath[i].lng);
        if (distance < minDistance) {
            minDistance = distance;
            nearestIndex = i;
        }
    }

    return { index: nearestIndex, distance: minDistance };
}

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Point 1 latitude
 * @param {number} lng1 - Point 1 longitude
 * @param {number} lat2 - Point 2 latitude
 * @param {number} lng2 - Point 2 longitude
 * @returns {number} - Distance in meters
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
    // Validate inputs to prevent NaN
    if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) {
        return 0;
    }

    const R = 6371000; // Earth radius in meters
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    // Ensure we return a valid number
    return isNaN(distance) ? 0 : distance;
}

/**
 * Convert degrees to radians
 * @param {number} degrees - Angle in degrees
 * @returns {number} - Angle in radians
 */
function toRadians(degrees) {
    // Validate input to prevent NaN
    if (isNaN(degrees)) {
        return 0;
    }
    return degrees * (Math.PI / 180);
}

module.exports = routeChecker;