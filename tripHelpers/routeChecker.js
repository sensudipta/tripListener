const {
    findNearestPointIndex,
    calculatePathDistance,
    getLengthBetweenPoints,
    parseRouteType,
    splitRoundTripPath,
    determineActiveSegment,
    splitRouteIntoSegments,
    findActiveSegment,
    getCompletedSegmentsDistance,
    getOutboundPathLength
} = require('./helpers');
const { tripLogger } = require('./logger');

async function getRouteSituation(tripId, truckPoint, route, currentRouteSegment, significantLocations = []) {
    // Add defensive checks at the beginning
    if (!route) {
        console.error(`CRITICAL ERROR: Route is undefined in getRouteSituation for trip: ${tripId}`);
        return null;
    }
    if (!route.routePath || route.routePath.coordinates.length === 0) {
        console.error(`CRITICAL ERROR: Route path is undefined in getRouteSituation for trip: ${tripId}`);
        return null;
    }

    /* console.log(`Debug - getRouteSituation called with trip: ${tripId}`);
    console.log(`  - Route length: ${route.routeLength / 1000} km`);
    console.log(`  - Route path points: ${route.routePath?.coordinates?.length || 0}`);
    console.log(`  - Truck position: ${truckPoint.lat}, ${truckPoint.lng}`); */

    // Use the route type from trip object if available, otherwise parse it
    const routeType = parseRouteType(route);

    // Create result object with default values
    const result = {
        distanceFromTruck: 0,
        cumulativeDistance: 0,
        travelDirection: 'forward',
        reverseTravelDistance: 0,
        nearestRoutePoint: null,
        nearestPointIndex: 0,
        routeSegment: currentRouteSegment || null,
        routeType: routeType
    };

    // Handle different route types
    if (routeType.type === 'roundTrip') {
        const roundTripResult = await handleRoundTripRoute(truckPoint, route, significantLocations);
        return { ...result, ...roundTripResult };
    } else {
        const oneWayResult = await handleOneWayRoute(truckPoint, route, routeType.viaPointCount);
        return { ...result, ...oneWayResult };
    }
}

async function handleRoundTripRoute(truckPoint, route, significantLocations = []) {
    try {
        const { routePath, startLocation, endLocation, viaLocations } = route;

        if (!routePath || !Array.isArray(routePath.coordinates)) {
            console.error('Invalid routePath in handleRoundTripRoute');
            return {
                distanceFromTruck: 0,
                cumulativeDistance: 0,
                travelDirection: 'forward',
                reverseTravelDistance: 0,
                nearestRoutePoint: null,
                nearestPointIndex: 0,
                routeSegment: 'outbound'
            };
        }

        // Split the route into outbound and return segments using via locations
        const { outboundPath, returnPath } = splitRoundTripPath(routePath, startLocation, viaLocations, endLocation);

        // Log the split results
        //console.log(`  - Outbound path points: ${outboundPath.coordinates.length}`);
        //console.log(`  - Return path points: ${returnPath.coordinates.length}`);

        // Check if we have any significant locations before determining segment
        let segment = 'outbound'; // Default to outbound if no history

        if (significantLocations && significantLocations.length > 0) {
            //console.log(`  - Using ${significantLocations.length} significant locations to determine segment`);
            const { segment: determinedSegment } = determineActiveSegment(significantLocations);
            if (segment !== determinedSegment) {
                console.log(`  - Segment changed from ${segment} to ${determinedSegment}`);
            }
            segment = determinedSegment;
            //console.log(`  - Active segment determined from history: ${segment}`);
        }

        // Now that we know which segment we're on, find the nearest point on that segment
        let nearestRoutePoint, distanceFromTruck, nearestPointIndex;
        let activePath = segment === 'outbound' ? outboundPath : returnPath;

        // Convert active path coordinates to points array for finding nearest point
        const pathPoints = activePath.coordinates.map(coord => {
            if (Array.isArray(coord) && coord.length >= 2) {
                return { lat: coord[1], lng: coord[0] };
            } else {
                return null;
            }
        }).filter(point => point !== null);

        // Find nearest point on the active segment
        if (pathPoints.length > 0) {
            nearestPointIndex = findNearestPointIndex(truckPoint, pathPoints);
            const nearestPoint = pathPoints[nearestPointIndex];
            nearestRoutePoint = activePath.coordinates[nearestPointIndex];

            distanceFromTruck = getLengthBetweenPoints(
                { latitude: truckPoint.lat, longitude: truckPoint.lng },
                { latitude: nearestPoint.lat, longitude: nearestPoint.lng }
            );
        } else {
            nearestPointIndex = 0;
            distanceFromTruck = 0;
            nearestRoutePoint = null;
        }

        // Calculate cumulative distance based on segment
        let cumulativeDistance = 0;

        if (segment === 'outbound') {
            // For outbound, calculate distance from start to current point
            const pathToPoint = outboundPath.coordinates.slice(0, nearestPointIndex + 1);
            cumulativeDistance = calculatePathDistance(pathToPoint.map(coord => ({
                latitude: coord[1],
                longitude: coord[0]
            })));
        } else {
            // For return, calculate outbound distance + return distance
            const outboundDistance = calculatePathDistance(outboundPath.coordinates.map(coord => ({
                latitude: coord[1],
                longitude: coord[0]
            })));

            // Calculate distance from via point to current point on return path
            const returnPathToPoint = returnPath.coordinates.slice(0, nearestPointIndex + 1);
            const returnDistance = calculatePathDistance(returnPathToPoint.map(coord => ({
                latitude: coord[1],
                longitude: coord[0]
            })));

            cumulativeDistance = outboundDistance + returnDistance;
        }

        // Determine travel direction and reverse travel distance
        const travelDirection = 'forward'; // Simplified for now
        const reverseTravelDistance = 0; // Simplified for now

        // Ensure cumulativeDistance is defined
        if (typeof cumulativeDistance === 'undefined') {
            console.error('cumulativeDistance is undefined in handleRoundTripRoute');
            cumulativeDistance = 0; // Set a default value
        }

        return {
            distanceFromTruck,
            cumulativeDistance,
            travelDirection,
            reverseTravelDistance,
            nearestRoutePoint,
            nearestPointIndex,
            routeSegment: segment
        };
    } catch (error) {
        console.error('Error in handleRoundTripRoute:', error);
        return {
            distanceFromTruck: 0,
            cumulativeDistance: 0,
            travelDirection: 'forward',
            reverseTravelDistance: 0,
            nearestRoutePoint: null,
            nearestPointIndex: 0,
            routeSegment: 'outbound'
        };
    }
}

async function handleOneWayRoute(truckPoint, route, viaPointCount) {
    if (!route || !route.routePath) {
        console.error('Invalid route in handleOneWayRoute');
        return {
            distanceFromTruck: 0,
            cumulativeDistance: 0,
            travelDirection: 'forward',
            reverseTravelDistance: 0,
            nearestRoutePoint: null,
            nearestPointIndex: 0,
            routeSegment: 'segment_1_of_1'
        };
    }

    // Split route into segments between via points
    const segments = viaPointCount > 0 ?
        splitRouteIntoSegments(route.routePath, viaPointCount) :
        [route.routePath];

    // Determine active segment
    const activeSegment = findActiveSegment(truckPoint, segments);

    // Calculate metrics for current segment
    const segmentMetrics = calculateMetrics(truckPoint, activeSegment.path);

    // Calculate completed segments distance
    const completedDistance = getCompletedSegmentsDistance(segments, activeSegment.index);

    return {
        ...segmentMetrics,
        routeSegment: `segment_${activeSegment.index + 1}_of_${segments.length}`,
        // Adjust cumulative distance to include completed segments
        cumulativeDistance: completedDistance + segmentMetrics.cumulativeDistance,
        segmentCompletionPercentage: (segmentMetrics.cumulativeDistance / calculatePathDistance(
            activeSegment.path.coordinates.map(coord => ({ latitude: coord[1], longitude: coord[0] }))
        )) * 100,
        totalSegments: segments.length,
        currentSegmentIndex: activeSegment.index
    };
}

// Calculate metrics for a given path segment
function calculateMetrics(truckPoint, routePath) {
    const pathPoints = routePath.coordinates.map(coord => ({ lat: coord[1], lng: coord[0] }));
    const nearestPointIndex = findNearestPointIndex(truckPoint, pathPoints);

    // Calculate distance from truck to nearest point
    const nearestRoutePoint = {
        latitude: pathPoints[nearestPointIndex].lat,
        longitude: pathPoints[nearestPointIndex].lng
    };
    const distanceFromTruck = getLengthBetweenPoints(
        { latitude: truckPoint.lat, longitude: truckPoint.lng },
        nearestRoutePoint
    );

    // Calculate cumulative distance up to nearest point
    const cumulativeDistance = calculatePathDistance(
        pathPoints.slice(0, nearestPointIndex + 1).map(p => ({ latitude: p.lat, longitude: p.lng }))
    );

    // Determine travel direction
    const travelDirection = determineTravelDirection(truckPoint, pathPoints, nearestPointIndex);

    // Calculate reverse travel distance if applicable
    const reverseTravelDistance = travelDirection === 'reverse' ?
        calculateReverseTravelDistance(truckPoint, pathPoints, nearestPointIndex) : 0;

    return {
        distanceFromTruck,
        cumulativeDistance,
        travelDirection,
        reverseTravelDistance,
        nearestRoutePoint,
        nearestPointIndex
    };
}

// Helper function to determine travel direction
function determineTravelDirection(truckPoint, pathPoints, nearestPointIndex) {
    if (nearestPointIndex === 0 || nearestPointIndex === pathPoints.length - 1) {
        return 'forward';
    }

    const prevPoint = {
        latitude: pathPoints[nearestPointIndex - 1].lat,
        longitude: pathPoints[nearestPointIndex - 1].lng
    };
    const nextPoint = {
        latitude: pathPoints[nearestPointIndex + 1].lat,
        longitude: pathPoints[nearestPointIndex + 1].lng
    };
    const currentPoint = {
        latitude: truckPoint.lat,
        longitude: truckPoint.lng
    };

    const distToPrev = getLengthBetweenPoints(currentPoint, prevPoint);
    const distToNext = getLengthBetweenPoints(currentPoint, nextPoint);

    return distToPrev < distToNext ? 'reverse' : 'forward';
}

// Calculate reverse travel distance
function calculateReverseTravelDistance(truckPoint, pathPoints, nearestPointIndex) {
    if (nearestPointIndex === 0) return 0;

    return calculatePathDistance(
        pathPoints
            .slice(Math.max(0, nearestPointIndex - 5), nearestPointIndex + 1)
            .map(p => ({ latitude: p.lat, longitude: p.lng }))
    );
}


module.exports = getRouteSituation;