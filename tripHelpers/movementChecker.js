const moment = require('moment');
const { tripLogger } = require('../common/helpers/logger');

// Constants
const SPEED_THRESHOLD = 3; // km/h - below this speed, vehicle is considered halted
const MIN_HALT_DURATION = 1; // minutes - minimum time to consider a vehicle halted



function processMovementStatus(trip) {
    try {

        if (!trip.pathPoints || !trip.tripPath) {
            tripLogger(trip, "MovementChecker failed: missing pathPoints or tripPath");
            return false;
        }

        const { fromIndex, toIndex } = trip.pathPoints;

        if (fromIndex === undefined || toIndex === undefined) {
            tripLogger(trip, "MovementChecker failed: pathPoints missing fromIndex or toIndex");
            return false;
        }

        if (!Array.isArray(trip.tripPath)) {
            tripLogger(trip, "MovementChecker failed: tripPath is not an array");
            return false;
        }

        if (fromIndex < 0 || toIndex >= trip.tripPath.length || fromIndex > toIndex) {
            tripLogger(trip, `MovementChecker failed: invalid indices - fromIndex=${fromIndex}, toIndex=${toIndex}, tripPath.length=${trip.tripPath.length}`);
            return false;
        }

        const relevantPoints = trip.tripPath.slice(fromIndex, toIndex + 1);

        if (relevantPoints.length === 0) {
            tripLogger(trip, "MovementChecker failed: no relevant points after slicing");
            return false;
        }

        const currentPoint = relevantPoints[relevantPoints.length - 1];
        const currentTime = moment(currentPoint.dt_tracker);
        const { movementStatus: currentMovementStatus, haltStartTime } = trip;

        // Determine current state
        const isCurrentlyHalted = isHaltedPoint(currentPoint);

        // If we have batch points, check batch status
        let batchStatus = 'Unknown';
        if (relevantPoints.length > 1) {
            const isAllHalted = relevantPoints.every(isHaltedPoint);
            const isAllDriving = relevantPoints.every(isDrivingPoint);
            batchStatus = isAllHalted ? 'Halted' : (isAllDriving ? 'Driving' : 'Unknown');
        }

        // Determine new movement status (prefer batch status if available)
        const newMovementStatus = relevantPoints.length > 1 ?
            batchStatus :
            (isCurrentlyHalted ? 'Halted' : (isDrivingPoint(currentPoint) ? 'Driving' : 'Unknown'));

        // Process status change
        if (newMovementStatus !== currentMovementStatus) {
            if (newMovementStatus === 'Halted') {
                // Vehicle just halted
                tripLogger(trip, `#FN:MovCHK: Vehicle halted at ${currentTime.format('YYYY-MM-DD HH:mm:ss')}`);
                trip.movementStatus = 'Halted';
                trip.haltStartTime = currentPoint.dt_tracker;
                trip.currentHaltDuration = 0;
                trip.parkedDuration = trip.parkedDuration || 0;
            } else if (currentMovementStatus === 'Halted' && haltStartTime) {
                // Vehicle was halted and is now moving
                const haltDuration = moment(currentTime).diff(moment(haltStartTime), 'minutes');
                if (haltDuration >= MIN_HALT_DURATION) {
                    const newParkedDuration = (trip.parkedDuration || 0) + haltDuration;
                    tripLogger(trip, `#FN:MovCHK: Vehicle started moving after halt of ${haltDuration} minutes`);
                    trip.movementStatus = newMovementStatus;
                    trip.haltStartTime = null;
                    trip.currentHaltDuration = 0;
                    trip.parkedDuration = newParkedDuration;
                }
            }
        } else if (newMovementStatus === 'Halted' && haltStartTime) {
            // Update ongoing halt duration
            const haltDuration = moment(currentTime).diff(moment(haltStartTime), 'minutes');
            if (haltDuration >= MIN_HALT_DURATION) {
                trip.movementStatus = 'Halted';
                trip.haltStartTime = haltStartTime;
                trip.currentHaltDuration = haltDuration;
                trip.parkedDuration = trip.parkedDuration || 0;
            }
        }

        return true;
    } catch (error) {
        console.error('Error in processMovementStatus:', error);
        tripLogger(trip, `#FN:MovCHK: Error processing movement status: ${error.message}`);
        return false;
    }
}

function isHaltedPoint(point) {
    const speed = parseFloat(point.speed);
    const acc = parseInt(point.acc);
    return acc === 0 && speed <= SPEED_THRESHOLD;
}

function isDrivingPoint(point) {
    const speed = parseFloat(point.speed);
    const acc = parseInt(point.acc);
    return acc === 1 && speed > SPEED_THRESHOLD;
}

// Export the main function as the default export
module.exports = processMovementStatus;