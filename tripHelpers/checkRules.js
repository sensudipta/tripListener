const moment = require('moment');
const { tripLogger } = require('./logger');

async function checkRules(
    rules, ruleStatus, truckPoint, currentHaltDuration,
    movementStatus, averageSpeed,
    distanceFromTruck, travelDirection, reverseTravelDistance
) {

    const updatedRuleStatus = {};
    const newViolations = [];
    const runningViolations = [];
    const newGoods = [];
    try {
        const currentTime = moment(truckPoint.dt_tracker);
        // Check driving time rule
        if ('drivingStartTime' in rules && 'drivingEndTime' in rules) {
            // Convert driving start/end times to moment objects for comparison
            const [startHour, startMinute] = rules.drivingStartTime.split(':').map(Number);
            const [endHour, endMinute] = rules.drivingEndTime.split(':').map(Number);

            // Create moment objects for start and end times on same day as truck point
            const startTime = moment(truckPoint.dt_tracker)
                .hour(startHour)
                .minute(startMinute)
                .second(0);

            const endTime = moment(truckPoint.dt_tracker)
                .hour(endHour)
                .minute(endMinute)
                .second(0);

            // Handle case where end time is on next day (e.g. 22:00 to 05:00)
            if (endTime.isBefore(startTime)) {
                endTime.add(1, 'day');
            }

            // Check if current time is outside allowed window
            const isOutsideTimeWindow = !currentTime.isBetween(startTime, endTime, undefined, '[]');
            if (isOutsideTimeWindow && movementStatus === 'Driving') {
                if (ruleStatus.drivingTimeStatus !== 'Violated') {
                    updatedRuleStatus.drivingTimeStatus = 'Violated';
                    newViolations.push('drivingTimeStatus');
                } else {
                    runningViolations.push('drivingTimeStatus');
                }
            } else if (ruleStatus.drivingTimeStatus === 'Violated') {
                updatedRuleStatus.drivingTimeStatus = 'Good';
                newGoods.push('drivingTimeStatus');
            }
        }

        // Check speed limit
        if ('speedLimit' in rules) {
            if (!isNaN(parseFloat(averageSpeed)) && isFinite(averageSpeed) && parseFloat(averageSpeed) > rules.speedLimit) {
                if (ruleStatus.speedStatus !== 'Violated') {
                    updatedRuleStatus.speedStatus = 'Violated';
                    newViolations.push('speedStatus');
                } else {
                    runningViolations.push('speedStatus');
                }
            } else if (ruleStatus.speedStatus === 'Violated') {
                updatedRuleStatus.speedStatus = 'Good';
                newGoods.push('speedStatus');
            }
        }

        // Check halt time
        if ('maxHaltTime' in rules) {
            const currHalt = currentHaltDuration && !isNaN(currentHaltDuration) ? currentHaltDuration / 60 : 0;
            if (currHalt > rules.maxHaltTime) {
                if (ruleStatus.haltTimeStatus !== 'Violated') {
                    updatedRuleStatus.haltTimeStatus = 'Violated';
                    newViolations.push('haltTimeStatus');
                } else {
                    runningViolations.push('haltTimeStatus');
                }
            } else if (ruleStatus.haltTimeStatus === 'Violated') {
                updatedRuleStatus.haltTimeStatus = 'Good';
                newGoods.push('haltTimeStatus');
            }
        }

        // Check route violation

        if ('routeViolationThreshold' in rules) {
            //console.log("DistanceFromTruck", distanceFromTruck, "ReverseTravelDistance", reverseTravelDistance, "RouteViolationThreshold", rules.routeViolationThreshold);
            if (distanceFromTruck > rules.routeViolationThreshold ||
                (travelDirection === 'reverse' && reverseTravelDistance > rules.routeViolationThreshold)) {
                if (ruleStatus.routeViolationStatus !== 'Violated') {
                    updatedRuleStatus.routeViolationStatus = 'Violated';
                    newViolations.push('routeViolationStatus');
                } else {
                    runningViolations.push('routeViolationStatus');
                }
            } else if (ruleStatus.routeViolationStatus === 'Violated') {
                updatedRuleStatus.routeViolationStatus = 'Good';
                newGoods.push('routeViolationStatus');
            }
        }

        return { updatedRuleStatus, newViolations, runningViolations, newGoods };
    } catch (err) {
        console.error('Error in checkRules:', err);
        tripLogger(trip, '#FN:checkRules: Error in checkRules:', err);
        return { updatedRuleStatus, newViolations, runningViolations, newGoods };
    }
}

module.exports = checkRules;