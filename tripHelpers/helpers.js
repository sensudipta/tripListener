// Global counter to limit warnings
let warningCounter = 0;
const MAX_WARNINGS = 10;

function getLengthBetweenPoints(point1, point2) {
    // Check if points are valid objects
    if (!point1 || !point2) {
        console.error('CRITICAL ERROR: Missing point objects in getLengthBetweenPoints');
        console.error('Call stack:', new Error().stack);
        console.error('point1:', JSON.stringify(point1));
        console.error('point2:', JSON.stringify(point2));
        process.exit(1);
    }

    const { latitude: lat1 = null, longitude: lon1 = null } = point1;
    const { latitude: lat2 = null, longitude: lon2 = null } = point2;

    // Parse coordinates to ensure they are numbers
    const lat1Parsed = parseFloat(lat1);
    const lon1Parsed = parseFloat(lon1);
    const lat2Parsed = parseFloat(lat2);
    const lon2Parsed = parseFloat(lon2);

    // Check for invalid coordinates
    if (isNaN(lat1Parsed) || isNaN(lon1Parsed) || isNaN(lat2Parsed) || isNaN(lon2Parsed)) {
        console.error('CRITICAL ERROR: Invalid coordinates in getLengthBetweenPoints');
        console.error('Raw coordinates:', { lat1, lon1, lat2, lon2 });
        console.error('point1:', JSON.stringify(point1));
        console.error('point2:', JSON.stringify(point2));
        //process.exit(1);
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
    if (!point || !routeCoordinates || routeCoordinates.length === 0) {
        console.error('Invalid inputs to findNearestPointIndex:');
        console.error('point:', JSON.stringify(point));
        console.error('routeCoordinates length:', routeCoordinates?.length);
        return 0;
    }

    let minDistance = Infinity;
    let nearestIndex = 0;

    routeCoordinates.forEach((coord, index) => {
        // Check if coord is an array (standard GeoJSON format) or an object
        let routePoint;

        if (Array.isArray(coord) && coord.length >= 2) {
            // If it's an array [lng, lat], convert to {latitude, longitude}
            routePoint = {
                latitude: coord[1],
                longitude: coord[0]
            };
        } else if (typeof coord === 'object' && coord !== null) {
            // If it's already an object with lat/lng properties
            routePoint = {
                latitude: coord.lat || coord.latitude,
                longitude: coord.lng || coord.longitude
            };
        } else {
            return; // Skip this coordinate
        }

        // Validate the route point has valid coordinates
        if (!routePoint.latitude || !routePoint.longitude ||
            isNaN(parseFloat(routePoint.latitude)) || isNaN(parseFloat(routePoint.longitude))) {
            return; // Skip this coordinate
        }

        // Validate the input point has valid coordinates
        const inputPoint = {
            latitude: point.lat || point.latitude,
            longitude: point.lng || point.longitude
        };

        if (!inputPoint.latitude || !inputPoint.longitude ||
            isNaN(parseFloat(inputPoint.latitude)) || isNaN(parseFloat(inputPoint.longitude))) {
            return; // Skip this calculation
        }

        // Now calculate distance with validated points
        try {
            const distance = getLengthBetweenPoints(inputPoint, routePoint);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = index;
            }
        } catch (error) {
            console.error(`Error calculating distance for point ${index}:`, error);
        }
    });

    return nearestIndex;
}

function calculatePathDistance(pathPoints) {
    if (!pathPoints || pathPoints.length < 2) {
        return 0;
    }

    let distance = 0;
    for (let i = 1; i < pathPoints.length; i++) {
        // Make sure we have valid lat/lng properties
        const p1 = {
            latitude: pathPoints[i - 1].lat || pathPoints[i - 1].latitude,
            longitude: pathPoints[i - 1].lng || pathPoints[i - 1].longitude
        };
        const p2 = {
            latitude: pathPoints[i].lat || pathPoints[i].latitude,
            longitude: pathPoints[i].lng || pathPoints[i].longitude
        };

        // Only calculate if both points have valid coordinates
        if (p1.latitude && p1.longitude && p2.latitude && p2.longitude) {
            distance += getLengthBetweenPoints(p1, p2);
        } else {
            console.error('Invalid point detected in calculatePathDistance:');
            console.error('p1:', JSON.stringify(p1));
            console.error('p2:', JSON.stringify(p2));
            process.exit(1);
        }
    }
    return distance / 1000; // Convert to kilometers
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

// Parse route type from route name
function parseRouteType(route) {
    try {
        // Check if route has a name that indicates round trip
        const routeName = route.routeName || '';
        const isRoundTripByName = routeName.toLowerCase().includes('round') ||
            routeName.toLowerCase().includes('return');

        // Check if start and end locations are the same
        const startCoords = route.startLocation?.location?.coordinates;
        const endCoords = route.endLocation?.location?.coordinates;

        const sameStartEnd = startCoords && endCoords &&
            startCoords[0] === endCoords[0] &&
            startCoords[1] === endCoords[1];

        // Check if there are via locations
        const hasViaPoints = route.viaLocations && route.viaLocations.length > 0;

        // Determine route type
        let routeType = 'oneWay';
        if (isRoundTripByName || sameStartEnd) {
            routeType = 'roundTrip';
        }

        return {
            type: routeType,
            viaPoints: hasViaPoints ? route.viaLocations.length : 0,
            sameStartEnd
        };
    } catch (error) {
        console.error('Error parsing route type:', error);
        return { type: 'oneWay', viaPoints: 0, sameStartEnd: false };
    }
}

// Updated splitRoundTripPath function with no fallbacks
function splitRoundTripPath(routePath, startLocation, viaLocations, endLocation) {
    if (!routePath || !routePath.coordinates || !Array.isArray(routePath.coordinates)) {
        console.error('Invalid routePath in splitRoundTripPath:', routePath);
        return {
            outboundPath: { type: 'LineString', coordinates: routePath?.coordinates || [] },
            returnPath: { type: 'LineString', coordinates: [] }
        };
    }

    if (!viaLocations || viaLocations.length === 0) {
        console.error('Missing via locations for route segmentation');
        return {
            outboundPath: { type: 'LineString', coordinates: routePath.coordinates },
            returnPath: { type: 'LineString', coordinates: [] }
        };
    }

    const coordinates = routePath.coordinates;

    // Find the index of the coordinate closest to the via location
    // We'll use the first via location for simplicity in this implementation
    const viaLocation = viaLocations[0];
    let viaPointIndex = -1;
    let minDistance = Infinity;

    // Get via location coordinates
    const viaCoords = viaLocation.location?.coordinates;
    if (!viaCoords || viaCoords.length < 2) {
        console.error('Invalid via location coordinates');
        return {
            outboundPath: { type: 'LineString', coordinates: routePath.coordinates },
            returnPath: { type: 'LineString', coordinates: [] }
        };
    }

    // Find the point in the route path closest to the via location
    for (let i = 0; i < coordinates.length; i++) {
        const coord = coordinates[i];
        if (Array.isArray(coord) && coord.length >= 2) {
            const distance = Math.sqrt(
                Math.pow(coord[0] - viaCoords[0], 2) +
                Math.pow(coord[1] - viaCoords[1], 2)
            );

            if (distance < minDistance) {
                minDistance = distance;
                viaPointIndex = i;
            }
        }
    }

    // If we couldn't find a via point, return only outbound path
    if (viaPointIndex === -1) {
        console.error('Could not find via location in route path. Route segmentation failed.');
        return {
            outboundPath: { type: 'LineString', coordinates: routePath.coordinates },
            returnPath: { type: 'LineString', coordinates: [] }
        };
    }

    // Split the route at the via point
    return {
        outboundPath: {
            type: 'LineString',
            coordinates: coordinates.slice(0, viaPointIndex + 1)
        },
        returnPath: {
            type: 'LineString',
            coordinates: coordinates.slice(viaPointIndex)
        }
    };
}

// Update the determineActiveSegment function to better detect via location visits
function determineActiveSegment(significantLocations) {
    if (!significantLocations || !Array.isArray(significantLocations) || significantLocations.length === 0) {
        console.warn('No significant locations history available');
        return { segment: 'outbound' };
    }

    // Log all significant locations for debugging
    console.log('Significant locations for segment determination:');
    significantLocations.forEach((loc, index) => {
        console.log(`  ${index + 1}. ${loc.locationName} (${loc.locationType})`);
    });

    // Check if we've visited a via location
    const hasVisitedVia = significantLocations.some(loc =>
        loc.locationType === 'viaLocation'
    );

    // If we've visited a via location, we're on the return segment
    if (hasVisitedVia) {
        console.log('Via location visited, setting segment to return');
        return { segment: 'return' };
    }

    // Otherwise, we're still on the outbound segment
    console.log('No via location visited yet, segment remains outbound');
    return { segment: 'outbound' };
}

// Split route into segments between via points
function splitRouteIntoSegments(routePath, viaPointCount) {
    const coordinates = routePath.coordinates;
    const segmentLength = Math.floor(coordinates.length / (viaPointCount + 1));
    const segments = [];

    for (let i = 0; i <= viaPointCount; i++) {
        const start = i * segmentLength;
        const end = i === viaPointCount ? coordinates.length : (i + 1) * segmentLength;
        segments.push({
            type: 'LineString',
            coordinates: coordinates.slice(start, end)
        });
    }

    return segments;
}

// Find which segment the truck is currently on
function findActiveSegment(truckPoint, segments) {
    let minDistance = Infinity;
    let activeSegment = { path: segments[0], index: 0 };

    segments.forEach((segment, index) => {
        const nearestIdx = findNearestPointIndex(
            truckPoint,
            segment.coordinates.map(coord => ({ lat: coord[1], lng: coord[0] }))
        );

        const distance = getLengthBetweenPoints(
            { latitude: truckPoint.lat, longitude: truckPoint.lng },
            {
                latitude: segment.coordinates[nearestIdx][1],
                longitude: segment.coordinates[nearestIdx][0]
            }
        );

        if (distance < minDistance) {
            minDistance = distance;
            activeSegment = { path: segment, index, nearestIdx, distance };
        }
    });

    return activeSegment;
}

// Calculate total distance of completed segments
function getCompletedSegmentsDistance(segments, currentSegmentIndex) {
    let distance = 0;

    for (let i = 0; i < currentSegmentIndex; i++) {
        distance += calculatePathDistance(
            segments[i].coordinates.map(coord => ({ latitude: coord[1], longitude: coord[0] }))
        );
    }

    return distance;
}

// Get length of outbound path
function getOutboundPathLength(outboundPath) {
    return calculatePathDistance(
        outboundPath.coordinates.map(coord => ({ latitude: coord[1], longitude: coord[0] }))
    );
}

module.exports = {
    getLengthBetweenPoints,
    isPointInPolygon,
    findNearestPointIndex,
    calculatePathDistance,
    checkLocation,
    determineMovingStatus,
    parseRouteType,
    splitRoundTripPath,
    determineActiveSegment,
    splitRouteIntoSegments,
    findActiveSegment,
    getCompletedSegmentsDistance,
    getOutboundPathLength
}

