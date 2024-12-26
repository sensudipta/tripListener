function getLengthBetweenPoints(point1, point2) {
    const { latitude: lat1, longitude: lon1 } = point1;
    const { latitude: lat2, longitude: lon2 } = point2;
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
}

function isPointInPolygon(point, polygon) {
    let inside = false;
    const x = point.lng;
    const y = point.lat;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0];
        const yi = polygon[i][1];
        const xj = polygon[j][0];
        const yj = polygon[j][1];

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}

// Helper functions
function findNearestPointIndex(point, routeCoordinates) {
    let minDistance = Infinity;
    let nearestIndex = 0;

    routeCoordinates.forEach((coord, index) => {
        const distance = getLengthBetweenPoints(
            { latitude: point.lat, longitude: point.lng },
            { latitude: coord[1], longitude: coord[0] }
        );
        if (distance < minDistance) {
            minDistance = distance;
            nearestIndex = index;
        }
    });

    return nearestIndex;
}

function calculatePathDistance(pathPoints) {
    let distance = 0;
    for (let i = 1; i < pathPoints.length; i++) {
        const p1 = { latitude: pathPoints[i - 1].lat, longitude: pathPoints[i - 1].lng };
        const p2 = { latitude: pathPoints[i].lat, longitude: pathPoints[i].lng };
        distance += getLengthBetweenPoints(p1, p2);
    }
    return distance;
}

function checkLocation(location, truckPoint) {
    try {
        if (location.locationType === 'zone') {
            // For zone type, check if point is inside polygon
            return isPointInPolygon(truckPoint, location.zoneCoordinates);
        } else if (location.locationType === 'point') {
            // For point type, check if within trigger radius
            const locationPoint = {
                lat: location.location.coordinates[1],
                lng: location.location.coordinates[0]
            };
            const distance = getLengthBetweenPoints(truckPoint, locationPoint);
            return distance <= location.triggerRadius;
        }
        return false;
    } catch (err) {
        console.error('Error in checkLocation:', err);
        return false;
    }
}

// Helper function for tripStatusChecker
function determineMovingStatus(movementStatus, routeViolationStatus) {
    if (movementStatus === 'Halted') return 'Halted';
    if (movementStatus === 'Moving') {
        return routeViolationStatus === 'Violated' ? 'Route Violated' : 'Running On Route';
    }
    return 'Unknown';
}

module.exports = {
    getLengthBetweenPoints,
    isPointInPolygon,
    findNearestPointIndex,
    calculatePathDistance,
    checkLocation,
    determineMovingStatus
}

