const { findNearestPointIndex, calculatePathDistance, getLengthBetweenPoints } = require('./helpers');
const { tripLogger } = require('./logger');
async function getRouteSituation(truckPoint, pathPoints, trip) {
    try {
        const { route } = trip;
        const { routePath } = route;
        if (!truckPoint || !routePath) {
            tripLogger(trip, "#FN:RouteCHKr: No TruckPoint or RoutePath");
            return {};
        };

        // Find nearest point on route
        let nearestPointIndex = 0;
        let minDistance = Infinity;
        let nearestRoutePoint = null;

        routePath.coordinates.forEach((coord, index) => {
            const routePoint = {
                latitude: coord[1],
                longitude: coord[0]
            };
            const distance = getLengthBetweenPoints(
                { latitude: truckPoint.lat, longitude: truckPoint.lng },
                routePoint
            );
            if (!distance || isNaN(distance)) {
                tripLogger(trip, "#FN:RouteCHKr: Invalid Distance", distance, "for", truckPoint.lat, truckPoint.lng, "and", coord[1], coord[0]);
                return null;
            }
            if (distance < minDistance) {
                minDistance = distance;
                nearestPointIndex = index;
                nearestRoutePoint = { lat: coord[1], lng: coord[0] };
            }
        });

        // Calculate cumulative distance
        let cumulativeDistance = 0;
        for (let i = 0; i < nearestPointIndex; i++) {
            const point1 = {
                latitude: routePath.coordinates[i][1],
                longitude: routePath.coordinates[i][0]
            };
            const point2 = {
                latitude: routePath.coordinates[i + 1][1],
                longitude: routePath.coordinates[i + 1][0]
            };
            cumulativeDistance += getLengthBetweenPoints(point1, point2);
        }

        // Determine travel direction and reverse travel distance
        let travelDirection = 'forward';
        let reverseTravelDistance = 0;

        if (pathPoints && pathPoints.length >= 2) {
            const firstPoint = pathPoints[0];
            const lastPoint = pathPoints[pathPoints.length - 1];

            const firstIndex = findNearestPointIndex(firstPoint, routePath.coordinates);
            const lastIndex = findNearestPointIndex(lastPoint, routePath.coordinates);

            if (lastIndex < firstIndex) {
                travelDirection = 'reverse';
                // Calculate reverse travel distance
                reverseTravelDistance = calculatePathDistance(pathPoints);
            }
        }

        return {
            nearestRoutePoint,
            nearestPointIndex,
            distanceFromTruck: minDistance / 1000,
            cumulativeDistance: cumulativeDistance / 1000,
            travelDirection,
            reverseTravelDistance: reverseTravelDistance / 1000
        };

    } catch (err) {
        console.error('Error in getRouteSituation:', err);
        tripLogger(trip, '#FN:RouteCHKr:Error in getRouteSituation:', err);
        return {};
    }
}

module.exports = getRouteSituation;