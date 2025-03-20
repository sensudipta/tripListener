/**
 * getLiveTripPath.js
 * Retrieves live path data from Redis and updates trip.tripPath
 */
const { redisClient } = require('../common/liveDB');
const { tripLogger } = require('../common/helpers/logger');
const { validatePoint } = require('../common/helpers/pointValidator');

async function getLiveTripPath(trip) {
    console.log(`#FN:TripPath: Starting getLiveTripPath for trip ${trip.tripId}`);
    try {
        const { deviceImei, tripStage } = trip;
        console.log(`#FN:TripPath: Getting path data ${trip.tripId} for device ${deviceImei} in trip stage ${tripStage}`);
        if (tripStage === 'Active') {
            // Get and clear rawTripPath data from redis
            const rawPathData = await redisClient.lRange(`${deviceImei}:rawTripPath`, 0, -1);
            await redisClient.del(`${deviceImei}:rawTripPath`);

            if (!rawPathData || rawPathData.length === 0) {
                tripLogger(trip, `#FN:TripPath: No path data for device ${deviceImei}`);
                return false;
            }

            // Parse, validate, and sort path points
            const validPathPoints = rawPathData
                .map(point => {
                    try {
                        return JSON.parse(point);
                    } catch (e) {
                        return null;
                    }
                })
                .filter(point => point !== null)
                .map(validatePoint)
                .filter(point => point !== null)
                .sort((a, b) => a.dt_tracker - b.dt_tracker);

            if (!validPathPoints.length) {
                tripLogger(trip, `#FN:TripPath: No valid points after validation for device ${deviceImei}`);
                return false;
            }

            // Initialize tripPath array if it doesn't exist
            if (!trip.tripPath) {
                trip.tripPath = [];
            }

            // Store starting index
            const fromIndex = trip.tripPath.length;

            // Add validated points to tripPath
            validPathPoints.forEach(point => {
                trip.tripPath.push(point);
            });

            // Store path points range
            trip.pathPoints = {
                fromIndex,
                toIndex: trip.tripPath.length - 1
            };
            trip.truckPoint = validPathPoints[validPathPoints.length - 1];
            tripLogger(trip, `#FN:TripPath: Added ${validPathPoints.length} valid points to tripPath [${fromIndex} - ${trip.pathPoints.toIndex}]`);
            if (rawPathData.length !== validPathPoints.length) {
                tripLogger(trip, `#FN:TripPath: Skipped ${rawPathData.length - validPathPoints.length} invalid points`);
            }
            return true;

        } else if (tripStage === 'Planned' || tripStage === 'Start Delayed') {
            // Get current location for planned/delayed trips
            console.log(`#FN:TripPath: Getting location data for planned trip ${deviceImei}`);
            const [lat, lng, dt_tracker] = await Promise.all([
                redisClient.get(`${deviceImei}:lat`),
                redisClient.get(`${deviceImei}:lng`),
                redisClient.get(`${deviceImei}:dt_tracker`)
            ]);

            if (!lat || !lng || !dt_tracker) {
                tripLogger(trip, `#FN:TripPath: Missing location data for planned trip ${deviceImei}`);
                console.log(`#FN:TripPath issue: lat: ${lat}, lng: ${lng}, dt_tracker: ${dt_tracker}`);
                return false;
            }

            // Validate the single point
            const validPoint = validatePoint({
                lat,
                lng,
                dt_tracker,
                speed: 0,
                heading: 0,
                acc: 0
            });

            if (!validPoint) {
                tripLogger(trip, `#FN:TripPath: Invalid location data for planned trip ${deviceImei}`);
                return false;
            }

            // Store single point for planned trips
            if (!trip.tripPath) trip.tripPath = [];

            const fromIndex = trip.tripPath.length;
            trip.tripPath.push(validPoint);

            trip.pathPoints = {
                fromIndex,
                toIndex: fromIndex
            };
            trip.truckPoint = validPoint;
            return true;
        }

        return false;

    } catch (err) {
        console.error('Error:', err);
        if (trip && trip.tripId) {
            tripLogger(trip, `#FN:TripPath: Error: ${err.message}`);
        } else {
            console.error('#FN:TripPath: Error:', err.message);
            processLogger(`TripPath Error: ${err.message}`);
        }
        return false;
    }
}

module.exports = getLiveTripPath;