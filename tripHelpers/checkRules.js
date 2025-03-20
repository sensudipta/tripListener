const moment = require('moment');
const { tripLogger } = require('../common/helpers/logger');
const alertSender = require('./alertSender');
const { calculatePathDistance } = require('../common/helpers/helper');

/**
 * Process rules and update trip object with violations
 * @param {Object} trip - Trip object to update
 * @returns {boolean} - Success status
 */
function processRules(trip) {
    try {
        if (!trip.pathPoints || !trip.tripPath) {
            return false;
        }

        const { fromIndex, toIndex } = trip.pathPoints;
        const truckPoint = trip.tripPath[toIndex];

        if (!truckPoint || !trip.rules || !trip.ruleStatus) {
            return false;
        }

        // Initialize violation tracking
        const newViolations = [];
        const runningViolations = [];
        const newGoods = [];
        const updatedRuleStatus = {};

        // Process each rule type
        processDrivingTimeRule(trip, truckPoint, fromIndex, toIndex, {
            newViolations, runningViolations, newGoods, updatedRuleStatus
        });

        processSpeedRule(trip, truckPoint, fromIndex, toIndex, {
            newViolations, runningViolations, newGoods, updatedRuleStatus
        });

        processHaltTimeRule(trip, truckPoint, fromIndex, toIndex, {
            newViolations, runningViolations, newGoods, updatedRuleStatus
        });

        processRouteViolationRule(trip, truckPoint, fromIndex, toIndex, {
            newViolations, runningViolations, newGoods, updatedRuleStatus
        });

        // Update trip's rule status
        if (Object.keys(updatedRuleStatus).length > 0) {
            trip.ruleStatus = { ...trip.ruleStatus, ...updatedRuleStatus };
        }

        // Log rule check results
        if (newViolations.length > 0) {
            tripLogger(trip, `#FN:Rules: New violations: ${newViolations.join(', ')}`);
        }
        if (runningViolations.length > 0) {
            tripLogger(trip, `#FN:Rules: Running violations: ${runningViolations.join(', ')}`);
        }
        if (newGoods.length > 0) {
            tripLogger(trip, `#FN:Rules: Resolved violations: ${newGoods.join(', ')}`);
        }

        return true;

    } catch (err) {
        console.error('Error in processRules:', err);
        tripLogger(trip, '#FN:Rules: Error processing rules:', err);
        return false;
    }
}

/**
 * Process driving time rule
 */
function processDrivingTimeRule(trip, truckPoint, fromIndex, toIndex, trackers) {
    const { rules, ruleStatus, movementStatus } = trip;
    if (!('drivingStartTime' in rules) || !('drivingEndTime' in rules)) {
        return;
    }

    const currentTime = moment(truckPoint.dt_tracker);
    const [startHour, startMinute] = rules.drivingStartTime.split(':').map(Number);
    const [endHour, endMinute] = rules.drivingEndTime.split(':').map(Number);

    // Create moment objects for start and end times
    const startTime = moment(truckPoint.dt_tracker)
        .hour(startHour)
        .minute(startMinute)
        .second(0);
    const endTime = moment(truckPoint.dt_tracker)
        .hour(endHour)
        .minute(endMinute)
        .second(0);

    // Handle case where end time is on next day
    if (endTime.isBefore(startTime)) {
        endTime.add(1, 'day');
    }

    const isOutsideTimeWindow = !currentTime.isBetween(startTime, endTime, undefined, '[]');
    if (isOutsideTimeWindow && movementStatus === 'Driving') {
        if (ruleStatus.drivingTimeStatus !== 'Violated') {
            trackers.updatedRuleStatus.drivingTimeStatus = 'Violated';
            trackers.newViolations.push('drivingTimeStatus');
            createViolationEvent(trip, 'Driving Time Violation', fromIndex, toIndex);
        } else {
            trackers.runningViolations.push('drivingTimeStatus');
            updateOngoingViolationEvent(trip, 'Driving Time Violation', toIndex);
        }
    } else if (ruleStatus.drivingTimeStatus === 'Violated') {
        trackers.updatedRuleStatus.drivingTimeStatus = 'Good';
        trackers.newGoods.push('drivingTimeStatus');
        closeViolationEvent(trip, 'Driving Time Violation', toIndex);
    }
}

/**
 * Process speed rule
 */
function processSpeedRule(trip, truckPoint, fromIndex, toIndex, trackers) {
    const { rules, ruleStatus } = trip;
    if (!('speedLimit' in rules)) {
        return;
    }

    const currentSpeed = truckPoint.gpsRecord.speed;
    if (currentSpeed > rules.speedLimit) {
        if (ruleStatus.speedStatus !== 'Violated') {
            trackers.updatedRuleStatus.speedStatus = 'Violated';
            trackers.newViolations.push('speedStatus');
            createViolationEvent(trip, 'Speed Violation', fromIndex, toIndex);
        } else {
            trackers.runningViolations.push('speedStatus');
            updateOngoingViolationEvent(trip, 'Speed Violation', toIndex);
        }
    } else if (ruleStatus.speedStatus === 'Violated') {
        trackers.updatedRuleStatus.speedStatus = 'Good';
        trackers.newGoods.push('speedStatus');
        closeViolationEvent(trip, 'Speed Violation', toIndex);
    }
}

/**
 * Process halt time rule
 */
function processHaltTimeRule(trip, truckPoint, fromIndex, toIndex, trackers) {
    const { rules, ruleStatus, currentHaltDuration } = trip;
    if (!('maxHaltTime' in rules)) {
        return;
    }

    const haltDurationHours = (currentHaltDuration || 0) / 60; // Convert minutes to hours
    if (haltDurationHours > rules.maxHaltTime) {
        if (ruleStatus.haltTimeStatus !== 'Violated') {
            trackers.updatedRuleStatus.haltTimeStatus = 'Violated';
            trackers.newViolations.push('haltTimeStatus');
            createViolationEvent(trip, 'Halt Time Violation', fromIndex, toIndex);
        } else {
            trackers.runningViolations.push('haltTimeStatus');
            updateOngoingViolationEvent(trip, 'Halt Time Violation', toIndex);
        }
    } else if (ruleStatus.haltTimeStatus === 'Violated') {
        trackers.updatedRuleStatus.haltTimeStatus = 'Good';
        trackers.newGoods.push('haltTimeStatus');
        closeViolationEvent(trip, 'Halt Time Violation', toIndex);
    }
}

/**
 * Process route violation rule
 */
function processRouteViolationRule(trip, truckPoint, fromIndex, toIndex, trackers) {
    const { rules, ruleStatus, distanceFromTruck, travelDirection, reverseTravelDistance } = trip;
    if (!('routeViolationThreshold' in rules)) {
        return;
    }

    if (distanceFromTruck > rules.routeViolationThreshold ||
        (travelDirection === 'reverse' && reverseTravelDistance > rules.routeViolationThreshold)) {
        if (ruleStatus.routeViolationStatus !== 'Violated') {
            trackers.updatedRuleStatus.routeViolationStatus = 'Violated';
            trackers.newViolations.push('routeViolationStatus');
            createViolationEvent(trip, 'Route Violation', fromIndex, toIndex);
        } else {
            trackers.runningViolations.push('routeViolationStatus');
            updateOngoingViolationEvent(trip, 'Route Violation', toIndex);
        }
    } else if (ruleStatus.routeViolationStatus === 'Violated') {
        trackers.updatedRuleStatus.routeViolationStatus = 'Good';
        trackers.newGoods.push('routeViolationStatus');
        closeViolationEvent(trip, 'Route Violation', toIndex);
    }
}

/**
 * Create a new violation event
 */
function createViolationEvent(trip, eventName, fromIndex, toIndex) {
    if (!trip.significantEvents) {
        trip.significantEvents = [];
    }

    const newEvent = {
        eventType: 'ruleViolation',
        eventName,
        eventTime: new Date(trip.tripPath[toIndex].dt_tracker),
        eventStartTime: new Date(trip.tripPath[toIndex].dt_tracker),
        eventStartTripPathIndex: fromIndex,
        eventEndTripPathIndex: toIndex,
        eventLocation: {
            type: 'Point',
            coordinates: trip.tripPath[toIndex].coordinates
        }
    };

    trip.significantEvents.push(newEvent);
    tripLogger(trip, `#FN:Rules: Created new ${eventName} event`);

    // Send alert for the violation
    const alertEvent = {
        eventType: 'Rule Violation',
        eventText: eventName,
        eventTime: trip.tripPath[toIndex].dt_tracker
    };

    // We'll use setTimeout to make this non-blocking
    setTimeout(async () => {
        try {
            await alertSender(trip, alertEvent, 'ruleViolation');
            tripLogger(trip, `#FN:Rules: Sent alert for ${eventName}`);
        } catch (error) {
            tripLogger(trip, `#FN:Rules: Error sending alert for ${eventName}: ${error.message}`);
        }
    }, 0);
}

/**
 * Update an ongoing violation event
 */
function updateOngoingViolationEvent(trip, eventName, toIndex) {
    const ongoingEvent = trip.significantEvents?.find(event =>
        event.eventType === 'ruleViolation' &&
        event.eventName === eventName &&
        !event.eventEndTime
    );

    if (ongoingEvent) {
        ongoingEvent.eventEndTripPathIndex = toIndex;
    }
}

/**
 * Close a violation event
 */
function closeViolationEvent(trip, eventName, toIndex) {
    const ongoingEvent = trip.significantEvents?.find(event =>
        event.eventType === 'ruleViolation' &&
        event.eventName === eventName &&
        !event.eventEndTime
    );

    if (ongoingEvent) {
        // Get start and end indices
        const fromIndex = ongoingEvent.eventStartTripPathIndex;

        ongoingEvent.eventEndTime = new Date(trip.tripPath[toIndex].dt_tracker);
        ongoingEvent.eventEndTripPathIndex = toIndex;
        ongoingEvent.eventDuration = Math.floor((new Date(trip.tripPath[toIndex].dt_tracker).getTime() - new Date(trip.tripPath[fromIndex].dt_tracker).getTime()) / 60000);

        // Calculate event distance using path points between start and end indices
        const eventPathPoints = [];
        for (let i = fromIndex; i <= toIndex; i++) {
            if (trip.tripPath[i]) {
                eventPathPoints.push({
                    lat: parseFloat(trip.tripPath[i].coordinates[1]),
                    lng: parseFloat(trip.tripPath[i].coordinates[0])
                });
            }
        }

        // Calculate distance if we have at least 2 points
        if (eventPathPoints.length >= 2) {
            // Use the calculatePathDistance function from helper.js
            const distanceInMeters = calculatePathDistance(eventPathPoints);
            // Convert to kilometers and round to 2 decimal places
            ongoingEvent.eventDistance = parseFloat((distanceInMeters / 1000).toFixed(2));
            tripLogger(trip, `#FN:Rules: Calculated event distance: ${ongoingEvent.eventDistance} km`);
        } else {
            ongoingEvent.eventDistance = 0;
            tripLogger(trip, `#FN:Rules: Not enough points to calculate event distance`);
        }

        tripLogger(trip, `#FN:Rules: Closed ${eventName} event. Duration: ${ongoingEvent.eventDuration} minutes`);

        // Send alert for the resolution
        const alertEvent = {
            eventType: 'Rule Resolution',
            eventText: `${eventName} Resolved`,
            eventTime: trip.tripPath[toIndex].dt_tracker
        };

        // We'll use setTimeout to make this non-blocking
        setTimeout(async () => {
            try {
                await alertSender(trip, alertEvent, 'ruleViolation');
                tripLogger(trip, `#FN:Rules: Sent alert for ${eventName} resolution`);
            } catch (error) {
                tripLogger(trip, `#FN:Rules: Error sending alert for ${eventName} resolution: ${error.message}`);
            }
        }, 0);
    }
}

// Placeholder for future rule implementations
/*
function processGeneratorHoursRule(trip, truckPoint, fromIndex, toIndex, trackers) {
    // TODO: Implement generator hours rule
}

function processGeneratorDistanceRule(trip, truckPoint, fromIndex, toIndex, trackers) {
    // TODO: Implement generator distance rule
}

function processTemperatureRule(trip, truckPoint, fromIndex, toIndex, trackers) {
    // TODO: Implement temperature rule
}

function processFuelConsumptionRule(trip, truckPoint, fromIndex, toIndex, trackers) {
    // TODO: Implement fuel consumption rule
}

function processFuelEfficiencyRule(trip, truckPoint, fromIndex, toIndex, trackers) {
    // TODO: Implement fuel efficiency rule
}
*/

module.exports = processRules;