const moment = require('moment');
const { tripLogger } = require('../common/helpers/logger');
const { getLengthBetweenPoints } = require('../common/helpers/helper');

/**
 * Calculate metrics for specified path points
 * @param {Object} trip - Trip object containing tripPath and pathPoints
 * @returns {boolean} - Success status
 */
function calculatePathMetrics(trip) {
    try {
        if (!trip.pathPoints || !trip.tripPath) {
            tripLogger(trip, `#FN:PathMetrics: Missing pathPoints or tripPath`);
            return false;
        }

        const { fromIndex, toIndex } = trip.pathPoints;
        const relevantPoints = trip.tripPath.slice(fromIndex, toIndex + 1);

        if (relevantPoints.length < 2) {
            return false;
        }

        let batchDistance = 0;
        let batchDuration = 0;
        let topSpeed = 0;
        let totalSpeed = 0;
        let movingPoints = 0;

        // Process consecutive points
        for (let i = 1; i < relevantPoints.length; i++) {
            const prevPoint = relevantPoints[i - 1];
            const currentPoint = relevantPoints[i];

            // Only calculate metrics if both points represent valid movement
            if (isValidMovement(prevPoint) && isValidMovement(currentPoint)) {
                // Calculate distance
                const p1 = {
                    latitude: prevPoint.coordinates[1],
                    longitude: prevPoint.coordinates[0]
                };
                const p2 = {
                    latitude: currentPoint.coordinates[1],
                    longitude: currentPoint.coordinates[0]
                };

                const segmentDistance = getLengthBetweenPoints(p1, p2);
                batchDistance += isNaN(segmentDistance) ? 0 : segmentDistance;

                // Calculate duration
                const duration = moment(currentPoint.dt_tracker)
                    .diff(moment(prevPoint.dt_tracker), 'minutes');
                batchDuration += isNaN(duration) ? 0 : duration;

                // Speed calculations
                const currentSpeed = currentPoint.gpsRecord.speed;
                if (!isNaN(currentSpeed)) {
                    topSpeed = Math.max(topSpeed, currentSpeed);
                    totalSpeed += currentSpeed;
                    movingPoints++;
                }
            }
        }

        // Convert distance to kilometers
        batchDistance = batchDistance / 1000;

        // Update trip metrics
        trip.truckRunDistance = (isNaN(trip.truckRunDistance) ? 0 : trip.truckRunDistance) + batchDistance;
        trip.runDuration = (isNaN(trip.runDuration) ? 0 : trip.runDuration) + batchDuration;

        // Update speed metrics
        if (movingPoints > 0) {
            // Ensure totalSpeed is a number
            totalSpeed = isNaN(totalSpeed) ? 0 : totalSpeed;
            const batchAverageSpeed = totalSpeed / movingPoints;

            // Calculate weighted average speed
            const previousDuration = Math.max(0, (trip.runDuration || 0) - batchDuration);
            const totalDuration = trip.runDuration || 0;

            if (totalDuration > 0) {
                const previousAvgSpeed = isNaN(trip.averageSpeed) ? 0 : trip.averageSpeed;
                const weightedAvg = (
                    (previousDuration * previousAvgSpeed + batchDuration * batchAverageSpeed)
                    / totalDuration
                );

                // Ensure the result is a valid number
                trip.averageSpeed = isNaN(weightedAvg) ? batchAverageSpeed : weightedAvg;
            } else {
                trip.averageSpeed = isNaN(batchAverageSpeed) ? 0 : batchAverageSpeed;
            }

            // Ensure topSpeed is a number
            topSpeed = isNaN(topSpeed) ? 0 : topSpeed;
            trip.topSpeed = Math.max(isNaN(trip.topSpeed) ? 0 : trip.topSpeed, topSpeed);
        }

        // Log metrics update
        tripLogger(trip, `#FN:PathMetrics: Updated - Distance: +${batchDistance.toFixed(2)}km, ` +
            `Duration: +${batchDuration}min, ` +
            `Avg Speed: ${(trip.averageSpeed || 0).toFixed(1)}km/h, ` +
            `Top Speed: ${trip.topSpeed || 0}km/h`);

        return true;

    } catch (error) {
        console.error('Error in calculatePathMetrics:', error);
        tripLogger(trip, `#FN:PathMetrics: Error calculating metrics: ${error.message}`);
        return false;
    }
}

/**
 * Check if a point represents valid movement
 * @param {Object} point - Path point to check
 * @returns {boolean} - True if point represents valid movement
 */
function isValidMovement(point) {
    return point && point.gpsRecord &&
        point.gpsRecord.acc === 1 &&
        !isNaN(point.gpsRecord.speed) &&
        point.gpsRecord.speed > 2;
}

module.exports = calculatePathMetrics; 