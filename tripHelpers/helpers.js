function getLengthBetweenPoints(point1, point2) {
    const { latitude: lat1, longitude: lon1 } = point1;
    const { latitude: lat2, longitude: lon2 } = point2;
    // Parse coordinates to ensure they are numbers
    const lat1Parsed = parseFloat(lat1);
    const lon1Parsed = parseFloat(lon1);
    const lat2Parsed = parseFloat(lat2);
    const lon2Parsed = parseFloat(lon2);

    // Check for invalid coordinates
    if (isNaN(lat1Parsed) || isNaN(lon1Parsed) || isNaN(lat2Parsed) || isNaN(lon2Parsed)) {
        console.error('Invalid coordinates:', { lat1, lon1, lat2, lon2 });
        return 0;
    }
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2Parsed - lat1Parsed) * Math.PI / 180;
    const dLon = (lon2Parsed - lon1Parsed) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1Parsed * Math.PI / 180) * Math.cos(lat2Parsed * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
}

function isPointInPolygon(point, polygon) {
    let inside = false;
    const x = parseFloat(point.lng);
    const y = parseFloat(point.lat);

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = parseFloat(polygon[i][0]);
        const yi = parseFloat(polygon[i][1]);
        const xj = parseFloat(polygon[j][0]);
        const yj = parseFloat(polygon[j][1]);

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

function checkLocation(location, truckPoint, fallBackTriggerRadius = 100) {
    try {
        if (location.locationType === 'zone') {
            // First check if point is inside polygon
            let inside = isPointInPolygon(truckPoint, location.zoneCoordinates);

            // If not inside, check distance to all vertices
            if (!inside) {
                for (const vertex of location.zoneCoordinates) {
                    const vertexPoint = {
                        latitude: parseFloat(vertex[1]),
                        longitude: parseFloat(vertex[0])
                    };
                    const distance = getLengthBetweenPoints(
                        { latitude: parseFloat(truckPoint.lat), longitude: parseFloat(truckPoint.lng) },
                        vertexPoint
                    );
                    if (distance <= fallBackTriggerRadius) {
                        inside = true;
                        break;
                    }
                }
            }

            return inside;
        } else if (location.locationType === 'point') {
            // For point type, check if within trigger radius
            const locationPoint = {
                lat: parseFloat(location.location.coordinates[1]),
                lng: parseFloat(location.location.coordinates[0])
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

