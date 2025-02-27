const moment = require('moment');
const { redisClient } = require('../common/liveDB');
const { tripLogger } = require('./logger');


const gloalMaxDetentionTime = 600; // default 10 hours

async function tripStatusChecker({ trip, currentSignificantLocation = null, movementStatus, complianceStatus = {} }) {
    try {
        const { newViolations = [], runningViolations = [] } = complianceStatus;
        const violations = [...newViolations, ...runningViolations];
        const {
            deviceImei, tripStage, activeStatus,
            route, plannedStartTime
        } = trip;
        let tripStageResult = tripStage || 'Planned';
        let activeStatusResult = activeStatus || 'Inactive';
        const currentTime = new Date().toUTCString();
        const { locationType = null, locationName = null } = currentSignificantLocation || {};

        // Calculate dwell time if truck is in a significant location
        const dwellTime = currentSignificantLocation ? currentSignificantLocation.entryTime ?
            moment().diff(moment(currentSignificantLocation.entryTime), 'minutes') : 0 : 0;

        //Get location & running based status
        const locStatus = getLocationBasedStatus(locationType, locationName, route, dwellTime, trip);
        const runningStatus = getRunningStatus(violations, movementStatus);
        tripLogger(trip, `#FN:StaCHK: currLoc: ${currentSignificantLocation?.locationName} TripStage: ${trip.tripStage} ActiveStatus: ${trip.activeStatus}`);
        //Handle planned trips
        if (tripStage === 'Planned') {
            if (locationType === 'startLocation') {
                await redisClient.sAdd('activeTripImeis', deviceImei);
                tripLogger(trip, `#FN:Status CHK: Planned trip reached start location:${trip.tripName}`);
                tripStageResult = 'Active';
                activeStatusResult = 'Reached Start Location';
            } else {
                //todo: handle cases where the truck has jumped on the route and skipped the start location
                if (moment(currentTime).isAfter(moment(plannedStartTime))) {
                    tripLogger(trip, `#FN:Status CHK: Planned trip start delayed:${trip.tripName}`);
                    tripStageResult = 'Start Delayed';
                    activeStatusResult = 'Inactive';
                }
            }
        }
        // Handle Start Delayed trips
        else if (tripStage === 'Start Delayed') {
            if (locationType === 'startLocation') {
                await redisClient.sAdd('activeTripImeis', deviceImei);
                tripLogger(trip, `#FN:Status CHK: Start Delayed trip still at start location:${trip.tripName}`);
                tripStageResult = 'Active';
                activeStatusResult = 'Reached Start Location';
            } else {
                //todo: handle cases where the truck has jumped on the route and skipped the start location
                if (moment(currentTime).isAfter(moment(plannedStartTime))) {
                    tripLogger(trip, `#FN:Status CHK: Start Delayed trip still delayed:${trip.tripName}`);
                    tripStageResult = 'Start Delayed';
                    activeStatusResult = 'Inactive';
                }
            }
        }
        // Handle Active trips
        else if (tripStage === 'Active') {
            // Check if truck is at end location and has left
            if (locationType === 'endLocation') {
                tripStageResult = 'Completed';
                activeStatusResult = 'Completed';
                // Remove deviceIMEI from activeTrips set in redis
                await redisClient.sRem('activeTripImeis', trip.deviceImei);
            } else {
                tripStageResult = 'Active';
                if (locationName && locationType) {
                    activeStatusResult = locStatus || activeStatusResult;
                } else {
                    activeStatusResult = runningStatus || activeStatusResult;
                }
            }
            tripLogger(trip, `#FN:Status CHK: Active trip:${trip.tripName} New Stage:${tripStageResult} New Active Status:${activeStatusResult}`);

        }
        else {
            tripLogger(trip, `#FN:Status CHK: Status is not checked:${trip.tripName} Current Stage:${tripStage} Current Active Status:${activeStatus}`);
        }
        return { tripStage: tripStageResult, activeStatus: activeStatusResult };

    } catch (error) {
        console.error('Error in tripStatusChecker:', error);
        tripLogger(trip, `#FN:Status CHK: Error in tripStatusChecker:${error}`);
        return { tripStage: null, activeStatus: null };
    }
}

module.exports = tripStatusChecker;


function getLocationBasedStatus(locationType, locationName, route, dwellTime, trip) {
    if (locationType === 'viaLocation') {
        const viaDetentionTime = route.viaLocations.find(via => via.locationName === locationName)?.maxDetentionTime || gloalMaxDetentionTime;
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
    } else {
        return null;
    }
}

function getRunningStatus(violations, movementStatus) {
    if (movementStatus === 'Driving') {
        if (violations.includes('routeViolationStatus')) {
            return 'Running & Route Violated';
        } else {
            return 'Running On Route';
        }
    } else {
        if (violations.includes('routeViolationStatus')) {
            return 'Halted & Route Violated';
        } else {
            return 'Halted';
        }
    }
}
