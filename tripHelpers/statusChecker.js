const moment = require('moment');
const { redisClient } = require('../common/liveDB');
const { tripLogger } = require('./logger');

const globalMaxDetentionTime = 600; // default 10 hours

async function tripStatusChecker({ trip, currentSignificantLocation = null, movementStatus, complianceStatus = {} }) {
    try {
        const { newViolations = [], runningViolations = [] } = complianceStatus;
        const violations = [...newViolations, ...runningViolations];
        const {
            deviceImei, tripStage, activeStatus,
            route, plannedStartTime, routeType, routeSituation
        } = trip;

        // Get route type and segment information
        const isRoundTrip = routeType?.type === 'roundTrip' || false;
        const routeSegment = routeSituation?.routeSegment || trip.currentRouteSegment || null;
        const completionPercentage = trip.completionPercentage || 0;

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
        tripLogger(trip, `#FN:StaCHK: isRoundTrip: ${isRoundTrip}, routeSegment: ${routeSegment}, completion: ${completionPercentage.toFixed(1)}%`);

        // Add this debug log at the beginning of the function
        //console.log(`Debug - Status check: stage=${trip.tripStage}, status=${trip.activeStatus}, location=${currentSignificantLocation?.locationName || 'None'}, locationType=${currentSignificantLocation?.locationType || 'None'}`);

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
            //console.log(`Debug - Start Delayed check: locationName=${locationName}, locationType=${locationType}, previousLocation=${trip.previousSignificantLocation?.locationName || 'None'}`);

            if (locationType === 'startLocation') {
                await redisClient.sAdd('activeTripImeis', deviceImei);
                tripLogger(trip, `#FN:Status CHK: Start Delayed trip still at start location:${trip.tripName}`);
                tripStageResult = 'Active';
                activeStatusResult = 'Reached Start Location';
            } else if (trip.previousSignificantLocation?.locationType === 'startLocation' && !currentSignificantLocation) {
                //console.log(`Debug - Vehicle has left start location, activating trip`);
                await redisClient.sAdd('activeTripImeis', deviceImei);
                tripStageResult = 'Active';
                activeStatusResult = 'Running On Route';
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
            // Check for trip completion based on route type and segment
            let isCompleted = false;

            // For round trips, check if we're at the end location and on the return segment with high completion
            if (isRoundTrip) {
                //console.log(`Debug - Round trip check: locationType=${locationType}, locationName=${locationName}, routeSegment=${routeSegment}, completion=${completionPercentage.toFixed(1)}%`);

                // Check if we're back at the start/end location after visiting the via location
                if ((locationType === 'endLocation' || locationType === 'startLocation') &&
                    trip.significantLocations?.some(loc => loc.locationType === 'viaLocation')) {

                    //console.log(`Debug - Round trip completion condition met: at start/end after visiting via`);
                    isCompleted = true;
                }
                // Also check if we have high completion percentage
                else if (completionPercentage >= 90 &&
                    (locationType === 'endLocation' || locationType === 'startLocation')) {

                    //console.log(`Debug - Round trip completion condition met: high completion at start/end`);
                    isCompleted = true;
                }
            }
            // For one-way trips, check if we're at the end location
            else if (locationType === 'endLocation') {
                isCompleted = true;
                tripLogger(trip, `#FN:Status CHK: One-way trip completed: ${trip.tripName}`);
            }

            if (isCompleted) {
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
        const viaLocation = route.viaLocations.find(via => via.locationName === locationName);
        const viaDetentionTime = viaLocation?.maxDetentionTime || globalMaxDetentionTime;
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

// Add or update this function to generate significant events
function generateSignificantEvents(trip, newStatus) {
    const events = [];
    const now = new Date();

    // Generate events based on status changes
    if (trip.tripStage === 'Planned' && newStatus.tripStage === 'Active') {
        events.push({
            eventType: 'Trip Activated',
            timestamp: now,
            details: 'Trip has been activated'
        });
    }

    if (trip.tripStage === 'Active' && newStatus.tripStage === 'Completed') {
        events.push({
            eventType: 'Trip Completed',
            timestamp: now,
            details: 'Trip has been completed'
        });
    }

    // Generate events for significant location changes
    if (trip.currentSignificantLocation?.locationId !== newStatus.currentSignificantLocation?.locationId) {
        if (newStatus.currentSignificantLocation) {
            events.push({
                eventType: `Entered ${newStatus.currentSignificantLocation.locationName}`,
                timestamp: now,
                details: `Truck entered ${newStatus.currentSignificantLocation.locationName}`
            });
        }

        if (trip.currentSignificantLocation) {
            events.push({
                eventType: `Exited ${trip.currentSignificantLocation.locationName}`,
                timestamp: now,
                details: `Truck exited ${trip.currentSignificantLocation.locationName}`
            });
        }
    }

    // Generate events for route segment changes
    if (trip.currentRouteSegment !== newStatus.currentRouteSegment) {
        events.push({
            eventType: `Route Segment Changed to ${newStatus.currentRouteSegment}`,
            timestamp: now,
            details: `Route segment changed from ${trip.currentRouteSegment || 'None'} to ${newStatus.currentRouteSegment}`
        });
    }

    return events;
}

function checkTripCompletion(trip) {
    // Check if we've returned to the start location after visiting all via locations
    const { significantLocations = [] } = trip;

    // Get all location types that have been visited
    const visitedLocationTypes = new Set(significantLocations.map(loc => loc.locationType));

    // For a round trip to be complete:
    // 1. We must have visited all via locations
    // 2. We must have returned to the start location

    // Check if we've visited all via locations
    const viaLocationsCount = trip.route.viaLocations?.length || 0;
    const visitedViaLocations = significantLocations.filter(loc => loc.locationType === 'viaLocation').length;

    const allViaLocationsVisited = visitedViaLocations >= viaLocationsCount;

    // Check if we've returned to the start location after visiting via locations
    let returnedToStart = false;

    if (allViaLocationsVisited) {
        // Find the last via location visit
        const lastViaLocationIndex = significantLocations
            .map((loc, index) => ({ index, loc }))
            .filter(item => item.loc.locationType === 'viaLocation')
            .sort((a, b) => new Date(b.loc.entryTime) - new Date(a.loc.entryTime))[0]?.index || -1;

        // Check if we've visited the start location after the last via location
        if (lastViaLocationIndex !== -1) {
            returnedToStart = significantLocations
                .slice(lastViaLocationIndex + 1)
                .some(loc => loc.locationType === 'startLocation');
        }
    }

    // For one-way trips, completion is based on reaching the end location
    const isRoundTrip = trip.routeType === 'roundTrip';
    const reachedEndLocation = significantLocations.some(loc => loc.locationType === 'endLocation');

    // Determine if trip is complete
    const isComplete = isRoundTrip
        ? (allViaLocationsVisited && returnedToStart)
        : reachedEndLocation;

    return isComplete;
}
