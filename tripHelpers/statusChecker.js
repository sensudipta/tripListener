const moment = require('moment');
const { redisClient } = require('../common/liveDB');
const { tripLogger } = require('../common/helpers/logger');

const globalMaxDetentionTime = 600; // default 10 hours

/**
 * Process and update trip status
 * @param {Object} trip - Trip object to update
 * @returns {boolean} - Success status
 */
async function processStatus(trip) {
    try {
        const { 
            deviceImei,
            tripStage,
            activeStatus,
            route,
            plannedStartTime,
            currentSignificantLocation,
            movementStatus,
            ruleStatus
        } = trip;

        if (!route || !plannedStartTime) {
            return false;
        }

        // Initialize new status values
        let newTripStage = tripStage || 'Planned';
        let newActiveStatus = activeStatus || 'Inactive';

        // Get violations from rule status
        const violations = [];
        if (ruleStatus) {
            Object.entries(ruleStatus).forEach(([key, value]) => {
                if (value === 'Violated') violations.push(key);
            });
        }

        // Calculate location-based statuses
        const dwellTime = currentSignificantLocation?.entryTime ?
            moment(trip.tripPath[trip.pathPoints.toIndex].dt_tracker).diff(moment(currentSignificantLocation.entryTime), 'minutes') : 0;

        const locStatus = getLocationBasedStatus(
            currentSignificantLocation?.locationType,
            currentSignificantLocation?.locationName,
            route,
            dwellTime,
            trip
        );
        const runningStatus = getRunningStatus(violations, movementStatus);

        // Process status based on current stage
        if (tripStage === 'Planned') {
            if (currentSignificantLocation?.locationType === 'startLocation') {
                newTripStage = 'Active';
                newActiveStatus = 'Reached Start Location';

                // Set the actual start time if not already set
                if (!trip.actualStartTime) {
                    trip.actualStartTime = new Date(trip.tripPath[trip.pathPoints.toIndex].dt_tracker);
                    tripLogger(trip, `#FN:StatusChecker: Trip started. Start time set to ${trip.actualStartTime.toISOString()}`);
                }

                if (!trip.backDated) {
                    await redisClient.sAdd('activeTripImeis', deviceImei);
                }
            } else if (moment(trip.pathPoints.toIndex.dt_tracker).isAfter(moment(plannedStartTime))) {
                newTripStage = 'Start Delayed';
                newActiveStatus = 'Inactive';
            }
        }
        else if (tripStage === 'Start Delayed') {
            if (currentSignificantLocation?.locationType === 'startLocation') {
                newTripStage = 'Active';
                newActiveStatus = 'Reached Start Location';

                // Set the actual start time if not already set
                if (!trip.actualStartTime) {
                    trip.actualStartTime = new Date(trip.tripPath[trip.pathPoints.toIndex].dt_tracker);
                    tripLogger(trip, `#FN:StatusChecker: Trip started. Start time set to ${trip.actualStartTime.toISOString()}`);
                }

                if (!trip.backDated) {
                    await redisClient.sAdd('activeTripImeis', deviceImei);
                }
            }
        }
        else if (tripStage === 'Active') {
            const endLocationMaxDetention = route.endLocation.maxDetentionTime;

            if (trip.hasExitedEndLocation === true) {
                // Vehicle has exited the end location, complete the trip immediately
                newTripStage = 'Completed';
                newActiveStatus = 'Completed';

                // Set the actual end time
                trip.actualEndTime = new Date(trip.tripPath[trip.pathPoints.toIndex].dt_tracker);

                // Record the end location
                trip.endLocation = {
                    coordinates: trip.tripPath[trip.pathPoints.toIndex].coordinates,
                    address: trip.significantLocations.find(loc => loc.locationType === 'endLocation')?.locationName || 'Unknown'
                };

                tripLogger(trip, `#FN:StatusChecker: Trip completed after exiting end location. End time set to ${trip.actualEndTime.toISOString()}`);

                if (!trip.backDated) {
                    await redisClient.sRem('activeTripImeis', deviceImei);
                }
            } else if (currentSignificantLocation?.locationType === 'endLocation') {
                if (endLocationMaxDetention && endLocationMaxDetention > 0) {
                    // Still at end location - keep as active regardless of detention time
                    newTripStage = 'Active';
                    newActiveStatus = locStatus || 'Reached End Location';

                    tripLogger(trip, `#FN:StatusChecker: At end location with detention time requirement. Current dwell: ${dwellTime} minutes. Waiting for exit.`);
                } else {
                    // No detention time requirement, complete immediately
                    newTripStage = 'Completed';
                    newActiveStatus = 'Completed';

                    trip.actualEndTime = new Date(trip.tripPath[trip.pathPoints.toIndex].dt_tracker);
                    trip.endLocation = {
                        coordinates: trip.tripPath[trip.pathPoints.toIndex].coordinates,
                        address: currentSignificantLocation?.locationName || 'Unknown'
                    };

                    tripLogger(trip, `#FN:StatusChecker: Trip completed upon reaching end location. End time set to ${trip.actualEndTime.toISOString()}`);

                    if (!trip.backDated) {
                        await redisClient.sRem('activeTripImeis', deviceImei);
                    }
                }
            } else {
                // Vehicle is neither at end location nor has exited it yet
                newTripStage = 'Active';
                newActiveStatus = currentSignificantLocation ?
                    (locStatus || activeStatus) :
                    (runningStatus || activeStatus);

                tripLogger(trip, `#FN:StatusChecker: Vehicle not at end location and has not exited end location yet. Maintaining Active status.`);
            }
            tripLogger(trip, `#FN:StatusChecker: Active trip:${trip.tripName} New Stage:${newTripStage} New Active Status:${newActiveStatus}`);
        }

        if (newTripStage !== trip.tripStage) {
            tripLogger(trip, `#FN:StatusChecker: Trip Stage Changed: ${trip.tripStage} -> ${newTripStage}`);
        }
        if (newActiveStatus !== trip.activeStatus) {
            tripLogger(trip, `#FN:StatusChecker: Active Status Changed: ${trip.activeStatus} -> ${newActiveStatus}`);
        }
        // Update trip object directly
        trip.tripStage = newTripStage;
        trip.activeStatus = newActiveStatus;

        return true;

    } catch (error) {
        console.error('Error in processStatus:', error);
        tripLogger(trip, `#FN:StatusChecker: Error in processStatus: ${error}`);
        return false;
    }
}

// Helper functions remain the same but with updated parameter structure
function getLocationBasedStatus(locationType, locationName, route, dwellTime, trip) {
    if (locationType === 'viaLocation') {
        const viaDetentionTime = route.viaLocations.find(via => via.locationName === locationName)?.maxDetentionTime || globalMaxDetentionTime;
        if (dwellTime > viaDetentionTime) {
            return `Detained At Via Location (${locationName})`;
        } else {
            return `Reached Via Location (${locationName})`;
        }
    } else if (locationType === 'endLocation') {
        if (dwellTime > route.endLocation.maxDetentionTime) {
            return 'Detained At End Location';
        } else {
            return 'Reached End Location';
        }
    } else if (locationType === 'startLocation') {
        if (dwellTime > route.startLocation.maxDetentionTime) {
            return 'Detained At Start Location';
        } else {
            return 'Reached Start Location';
        }
    }
    return null;
}

function getRunningStatus(violations, movementStatus) {
    if (movementStatus === 'Driving') {
        if (violations.includes('routeViolationStatus')) {
            return 'Running & Route Violated';
        }
        return 'Running On Route';
    }
    if (violations.includes('routeViolationStatus')) {
        return 'Halted & Route Violated';
    }
    return 'Halted';
}

module.exports = processStatus;
