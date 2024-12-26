const mongoose = require('mongoose');
const moment = require('moment');
const liveDB = require('../common/liveDB');
const { TRIPDB, redis } = liveDB;
const { Route, Trip } = require('../common/models');
const { getLengthBetweenPoints, findNearestPointIndex,
    calculatePathDistance, checkLocation } = require('../common/helper');
const getFuel = require('./getFuel');

// Define alert types and channels
const ALERT_TYPES = {
    TRIP_STAGE_CHANGE: 'tripStageChange',
    RULE_VIOLATION: 'ruleViolation',
    ACTIVE_STATUS_CHANGE: 'activeStatusChange',
    FUEL_EVENT: 'fuelEvent'
};

const ALERT_CHANNELS = {
    SMS: 'sms',
    EMAIL: 'email',
    PUSH: 'push',
    WEBHOOK: 'webhook'
};

// Global array to store trips
let allTrips = [];

// Add a logging utility
const logger = {
    info: (message, metadata = {}) => {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'INFO',
            message,
            ...metadata
        }));
    },
    error: (message, error, metadata = {}) => {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            message,
            error: error.message,
            stack: error.stack,
            ...metadata
        }));
    }
};

// 1. getTripPath function
async function getTripPath(deviceImei, tripStage) {
    try {
        if (tripStage === 'Active') {
            // Get and clear rawTripPath data from redis
            const rawPathData = await redis.lRange(`${deviceImei}:rawTripPath`, 0, -1);
            await redis.del(`${deviceImei}:rawTripPath`);

            // Parse and sort path points
            const pathPoints = rawPathData
                .map(point => JSON.parse(point))
                .sort((a, b) => new Date(a.dt_tracker) - new Date(b.dt_tracker));

            if (!pathPoints.length) return null;

            // Get last point as truck point
            const truckPoint = pathPoints[pathPoints.length - 1];

            // Evaluate drive status
            let driveStatus = 'Unknown';
            const isAllHalted = pathPoints.every(p => p.acc === 0 && p.speed < 2);
            const isAllDriving = pathPoints.every(p => p.acc === 1 && p.speed > 2);

            if (isAllHalted) driveStatus = 'Halted';
            else if (isAllDriving) driveStatus = 'Driving';

            // Compute metrics
            let topSpeed = 0;
            let totalValidSpeed = 0;
            let validSpeedPoints = 0;
            let totalDistance = 0;
            let runDuration = 0;

            for (let i = 1; i < pathPoints.length; i++) {
                const prevPoint = pathPoints[i - 1];
                const currentPoint = pathPoints[i];

                if (prevPoint.acc === 1 && currentPoint.acc === 1 &&
                    prevPoint.speed > 2 && currentPoint.speed > 2) {

                    topSpeed = Math.max(topSpeed, prevPoint.speed, currentPoint.speed);
                    totalValidSpeed += (prevPoint.speed + currentPoint.speed) / 2;
                    validSpeedPoints++;

                    const p1 = { latitude: prevPoint.lat, longitude: prevPoint.lng };
                    const p2 = { latitude: currentPoint.lat, longitude: currentPoint.lng };
                    totalDistance += getLengthBetweenPoints(p1, p2);
                    runDuration += (new Date(currentPoint.dt_tracker) - new Date(prevPoint.dt_tracker)) / 1000;
                }
            }

            const averageSpeed = validSpeedPoints > 0 ? totalValidSpeed / validSpeedPoints : 0;

            return {
                truckPoint,
                pathPoints,
                driveStatus,
                topSpeed: Math.round(topSpeed),
                averageSpeed: Math.round(averageSpeed),
                totalDistance,
                runDuration
            };

        } else if (tripStage === 'Planned' || tripStage === 'Start Delayed') {
            // Get current location for planned/delayed trips
            const [lat, lng, dt_tracker] = await Promise.all([
                redis.get(`${deviceImei}:lat`),
                redis.get(`${deviceImei}:lng`),
                redis.get(`${deviceImei}:dt_tracker`)
            ]);

            return {
                truckPoint: { lat, lng, dt_tracker }
            };
        }
    } catch (err) {
        console.error('Error in getTripPath:', err);
        return null;
    }
}

// 2. presenceInSignificantLocation function
async function presenceInSignificantLocation(currentSignificantLocation, startLocation, endLocation, viaLocations, truckPoint) {
    try {
        let previousSignificantLocation = null;
        let newSignificantLocation = null;

        // Check if truck is within any significant location
        if (checkLocation(startLocation, truckPoint)) {
            newSignificantLocation = { ...startLocation, locationType: 'startLocation' };
        } else if (checkLocation(endLocation, truckPoint)) {
            newSignificantLocation = { ...endLocation, locationType: 'endLocation' };
        } else {
            for (const viaLocation of viaLocations) {
                if (checkLocation(viaLocation, truckPoint)) {
                    newSignificantLocation = { ...viaLocation, locationType: 'viaLocation' };
                    break;
                }
            }
        }

        // Handle significant location changes
        if (newSignificantLocation) {
            if (!currentSignificantLocation) {
                // First entry into a significant location
                currentSignificantLocation = {
                    ...newSignificantLocation,
                    entryTime: truckPoint.dt_tracker
                };
            } else if (newSignificantLocation.locationName !== currentSignificantLocation.locationName) {
                // Truck has moved to a different significant location
                previousSignificantLocation = {
                    ...currentSignificantLocation,
                    exitTime: truckPoint.dt_tracker
                };
                currentSignificantLocation = {
                    ...newSignificantLocation,
                    entryTime: truckPoint.dt_tracker
                };
            }
            // If in same location, do nothing
        } else if (currentSignificantLocation) {
            // Truck has left the significant location
            previousSignificantLocation = {
                ...currentSignificantLocation,
                exitTime: truckPoint.dt_tracker
            };
            currentSignificantLocation = null;
        }

        return { currentSignificantLocation, previousSignificantLocation };
    } catch (err) {
        console.error('Error in presenceInSignificantLocation:', err);
        return { currentSignificantLocation, previousSignificantLocation: null };
    }
}

// 3. getRouteSituation function
async function getRouteSituation(truckPoint, pathPoints, routePath) {
    try {
        if (!truckPoint || !routePath) return null;

        // Convert truck point to GeoJSON format
        const truckGeoJSON = {
            type: 'Point',
            coordinates: [parseFloat(truckPoint.lng), parseFloat(truckPoint.lat)]
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
            distanceFromTruck: minDistance,
            cumulativeDistance,
            travelDirection,
            reverseTravelDistance
        };

    } catch (err) {
        console.error('Error in getRouteSituation:', err);
        return null;
    }
}

// 4. checkRules function
async function checkRules(rules, ruleStatus, pathPoints, truckPoint, currentHaltDuration,
    distanceFromTruck, reverseTravelDistance, currentSignificantLocation) {
    try {
        const updatedRuleStatus = {};
        const currentTime = moment(truckPoint.dt_tracker);

        // Check driving time rule
        if ('drivingStartTime' in rules && 'drivingEndTime' in rules) {
            const currentHour = currentTime.hour();
            if (currentHour < parseInt(rules.drivingStartTime) ||
                currentHour > parseInt(rules.drivingEndTime)) {
                if (ruleStatus.drivingTimeStatus !== 'Violated') {
                    updatedRuleStatus.drivingTimeStatus = 'Violated';
                }
            } else if (ruleStatus.drivingTimeStatus === 'Violated') {
                updatedRuleStatus.drivingTimeStatus = 'Good';
            }
        }

        // Check speed limit
        if ('speedLimit' in rules) {
            const currentSpeed = pathPoints?.[pathPoints.length - 1]?.speed || 0;
            if (currentSpeed > rules.speedLimit) {
                if (ruleStatus.speedStatus !== 'Violated') {
                    updatedRuleStatus.speedStatus = 'Violated';
                }
            } else if (ruleStatus.speedStatus === 'Violated') {
                updatedRuleStatus.speedStatus = 'Good';
            }
        }

        // Check halt time
        if ('maxHaltTime' in rules) {
            if (currentHaltDuration > rules.maxHaltTime) {
                if (ruleStatus.haltTimeStatus !== 'Violated') {
                    updatedRuleStatus.haltTimeStatus = 'Violated';
                }
            } else if (ruleStatus.haltTimeStatus === 'Violated') {
                updatedRuleStatus.haltTimeStatus = 'Good';
            }
        }

        // Check route violation
        if ('routeViolationThreshold' in rules) {
            if (distanceFromTruck > rules.routeViolationThreshold ||
                reverseTravelDistance > rules.routeViolationThreshold) {
                if (ruleStatus.routeViolationStatus !== 'Violated') {
                    updatedRuleStatus.routeViolationStatus = 'Violated';
                }
            } else if (ruleStatus.routeViolationStatus === 'Violated') {
                updatedRuleStatus.routeViolationStatus = 'Good';
            }
        }

        // Only return rules that changed status
        return Object.keys(updatedRuleStatus).length > 0 ? updatedRuleStatus : null;

    } catch (err) {
        console.error('Error in checkRules:', err);
        return null;
    }
}



async function sendAlerts({ trip, eventType, status, metadata = {} }) {
    try {
        // Validate inputs
        if (!trip || !eventType || !status) {
            throw new Error('Missing required alert parameters');
        }

        // Determine alert recipients and channels based on event type
        const alertConfig = await getAlertConfig(trip.alertPreferences);

        const alerts = [];

        // Format alert message
        const message = formatAlertMessage(eventType, status, metadata);

        // Send to each configured channel
        for (const channel of alertConfig.channels) {
            try {
                switch (channel) {
                    case ALERT_CHANNELS.SMS:
                        alerts.push(sendSMS(alertConfig.phoneNumbers, message));
                        break;
                    case ALERT_CHANNELS.EMAIL:
                        alerts.push(sendEmail(alertConfig.emails, message));
                        break;
                    case ALERT_CHANNELS.PUSH:
                        alerts.push(sendPushNotification(alertConfig.deviceTokens, message));
                        break;
                    case ALERT_CHANNELS.WEBHOOK:
                        alerts.push(sendWebhook(alertConfig.webhookUrls, {
                            tripId: trip._id,
                            eventType,
                            status,
                            message,
                            metadata
                        }));
                        break;
                }
            } catch (channelError) {
                logger.error(`Failed to send alert via ${channel}`, channelError);
                // Continue with other channels even if one fails
            }
        }

        // Wait for all alerts to be sent
        await Promise.allSettled(alerts);

        // Log alert history
        await saveAlertHistory(trip._id, {
            eventType,
            status,
            message,
            metadata,
            timestamp: new Date()
        });

        return true;
    } catch (err) {
        logger.error('Failed to send alerts', err);
        return false;
    }
}

// 7. updateTripRecord function
async function updateTripRecord(trip, updates) {
    try {
        // Validate inputs
        if (!trip?._id) {
            throw new Error('Invalid trip ID');
        }

        const updateQuery = {};
        let retryCount = 0;
        const MAX_RETRIES = 3;

        while (retryCount < MAX_RETRIES) {
            try {
                // Your existing update logic
                if (updates.significantEvents) {
                    if (!updateQuery.$push) updateQuery.$push = {};
                    updateQuery.$push.significantEvents = { $each: updates.significantEvents };
                    delete updates.significantEvents;
                }

                const result = await Trip.updateOne(
                    { _id: trip._id },
                    updateQuery,
                    { runValidators: true }  // Enable mongoose validation
                );

                if (result.modifiedCount === 0) {
                    throw new Error('Trip not found or no changes made');
                }

                return true;

            } catch (dbError) {
                retryCount++;
                if (retryCount === MAX_RETRIES) {
                    throw dbError;
                }
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
            }
        }
    } catch (err) {
        console.error(`Failed to update trip ${trip._id}:`, err);
        // You might want to log to a monitoring service here
        return false;
    }
}

// Add a validation helper
function validateTripData(trip) {
    const requiredFields = [
        'deviceImei',
        'tripName',
        'tripStage',
        'route',
        'rules'
    ];

    const missingFields = requiredFields.filter(field => !trip[field]);
    if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Validate specific field formats
    if (!/^\d{15}$/.test(trip.deviceImei)) {
        throw new Error('Invalid IMEI format');
    }

    if (!['Planned', 'Start Delayed', 'Active', 'Completed'].includes(trip.tripStage)) {
        throw new Error('Invalid trip stage');
    }

    // Validate route data
    if (!trip.route.startLocation || !trip.route.endLocation) {
        throw new Error('Missing route locations');
    }
}

// 8. main function
async function main() {
    try {
        allTrips = [];
        await mongoose.connect(TRIPDB);
        console.log("Connected to TripDB");

        const trips = await Trip.find({
            tripStage: { $in: ['Planned', 'Start Delayed', 'Active'] }
        });

        allTrips = trips;
        console.log(`Loaded ${allTrips.length} trips for processing`);

        mainLoop();
    } catch (err) {
        console.error('Error in main:', err);
        process.exit(1);
    }
}



// 9. mainLoop function
async function mainLoop() {
    try {
        if (allTrips.length === 0) {
            console.log("All trips processed");
            process.exit(0);
            return;
        }

        const trip = allTrips.shift();
        if (!trip) {
            console.log("No more trips to process");
            return;
        }

        validateTripData(trip);
        console.log(`Processing trip: ${trip.tripName} (${trip.tripStage})`);

        // Update last check time
        const currentTime = new Date();
        trip.lastCheckTime = currentTime;

        if (trip.tripStage === 'Planned' || trip.tripStage === 'Start Delayed') {
            // Process planned or delayed trips
            const tripPathData = await getTripPath(trip.deviceImei, trip.tripStage);
            if (!tripPathData) {
                console.log(`No path data for trip ${trip.tripName}`);
                mainLoop();
                return;
            }

            const { truckPoint } = tripPathData;
            const updatedLocation = await presenceInSignificantLocation(
                trip.currentSignificantLocation,
                trip.route.startLocation,
                trip.route.endLocation,
                trip.route.viaLocations,
                truckPoint
            );

            const { tripStage, activeStatus } = await tripStatusChecker(
                truckPoint,
                null,
                updatedLocation,
                trip.movementStatus,
                trip.tripStage,
                trip.activeStatus,
                trip.route
            );

            const updates = {
                tripStage,
                activeStatus,
                currentSignificantLocation: updatedLocation,
                lastCheckTime: currentTime
            };
            // Send alert if trip stage changed
            if (tripStage !== trip.tripStage) {
                await sendAlerts({ trip, eventType: 'tripStageChange', status: tripStage });

                // Set actual start time if new stage is Active
                if (tripStage === 'Active') {
                    updates.actualStartTime = truckPoint.dt_tracker;
                }
            }

            await updateTripRecord(trip, updates);

        } else if (trip.tripStage === 'Active') {
            // Process active trips
            const tripPathData = await getTripPath(trip.deviceImei, trip.tripStage);
            if (!tripPathData) {
                console.log(`No path data for trip ${trip.tripName}`);
                mainLoop();
                return;
            }

            const {
                truckPoint,
                pathPoints,
                driveStatus,
                topSpeed,
                averageSpeed,
                totalDistance,
                runDuration
            } = tripPathData;

            // Update movement status
            const movementStatus = trip.movementStatus === 'Unknown' ? driveStatus :
                driveStatus === 'Unknown' ? trip.movementStatus : driveStatus;

            // Update halt tracking
            let haltStartTime = trip.haltStartTime;
            let currentHaltDuration = trip.currentHaltDuration;
            if (movementStatus === 'Halted') {
                if (!haltStartTime) {
                    haltStartTime = truckPoint.dt_tracker;
                }
                currentHaltDuration = moment(currentTime).diff(moment(haltStartTime), 'minutes');
            } else {
                // Add current halt duration to total parked duration
                const parkedDuration = (trip.parkedDuration || 0) + currentHaltDuration;
                haltStartTime = null;
                currentHaltDuration = 0;
            }

            // Calculate weighted average speed based on run durations
            const existingRunDuration = trip.runDuration || 0;
            const totalRunDuration = existingRunDuration + runDuration;
            const weightedAverageSpeed = totalRunDuration > 0 ?
                ((existingRunDuration * (trip.averageSpeed || 0)) + (runDuration * averageSpeed)) / totalRunDuration :
                averageSpeed;

            // Get route situation
            const routeSituation = await getRouteSituation(truckPoint, pathPoints, trip.route.routePath);
            if (!routeSituation) {
                console.log(`Could not determine route situation for trip ${trip.tripName}`);
                mainLoop();
                return;
            }

            const {
                distanceFromTruck,
                cumulativeDistance,
                travelDirection,
                reverseTravelDistance
            } = routeSituation;

            // Update trip metrics
            const updates = {
                movementStatus,
                haltStartTime,
                currentHaltDuration,
                parkedDuration,
                runDuration: totalRunDuration,
                truckRunDistance: (trip.truckRunDistance || 0) + totalDistance,
                topSpeed: Math.max(trip.topSpeed || 0, topSpeed),
                averageSpeed: weightedAverageSpeed,
                distanceCovered: cumulativeDistance,
                distanceRemaining: trip.route.routeLength - cumulativeDistance,
                completionPercentage: (cumulativeDistance / trip.route.routeLength) * 100,
                lastCheckTime: currentTime
            };

            // Update reverse travel data if applicable
            if (travelDirection === 'reverse' && (reverseTravelDistance > 500 || trip.reverseTravelPath.length > 0)) {
                if (!trip.reverseTravelPath) {
                    updates.reverseTravelPath = {
                        type: 'LineString',
                        coordinates: pathPoints.map(p => [p.lng, p.lat])
                    };
                } else {
                    updates.reverseTravelPath = {
                        type: 'LineString',
                        coordinates: [
                            ...trip.reverseTravelPath.coordinates,
                            ...pathPoints.map(p => [p.lng, p.lat])
                        ]
                    };
                }
                updates.reverseTravelDistance = (trip.reverseTravelDistance || 0) + reverseTravelDistance;
            } else if (travelDirection === 'forward') {
                if (trip.reverseTravelPath && trip.reverseTravelPath.coordinates.length > 0) {
                    const firstPoint = trip.reverseTravelPath.coordinates[0];
                    const lastPoint = trip.reverseTravelPath.coordinates[trip.reverseTravelPath.coordinates.length - 1];

                    const eventStartTime = pathPoints[0].dt_tracker;
                    const eventEndTime = pathPoints[pathPoints.length - 1].dt_tracker;
                    const eventDuration = moment(eventEndTime).diff(moment(eventStartTime), 'minutes');

                    const reverseEvent = {
                        eventType: 'ruleViolation',
                        eventName: 'Reverse Travel',
                        eventPath: trip.reverseTravelPath,
                        eventTime: eventStartTime,
                        eventStartTime: eventStartTime,
                        eventEndTime: eventEndTime,
                        eventDuration: eventDuration,
                        eventDistance: trip.reverseTravelDistance,
                        eventLocation: {
                            type: 'Point',
                            coordinates: firstPoint
                        }
                    };

                    if (!updates.significantEvents) {
                        updates.significantEvents = [];
                    }
                    updates.significantEvents.push(reverseEvent);
                }
                updates.reverseTravelPath = null;
                updates.reverseTravelDistance = 0;
            }

            // Check significant locations
            const { currentSignificantLocation, previousSignificantLocation } =
                await presenceInSignificantLocation(
                    trip.currentSignificantLocation,
                    trip.route.startLocation,
                    trip.route.endLocation,
                    trip.route.viaLocations,
                    truckPoint
                );

            // Handle previous significant location
            if (previousSignificantLocation) {
                const dwellTime = moment(previousSignificantLocation.exitTime)
                    .diff(moment(previousSignificantLocation.entryTime), 'minutes');
                previousSignificantLocation.dwellTime = dwellTime;

                if (!updates.significantLocations) updates.significantLocations = [];
                updates.significantLocations.push(previousSignificantLocation);
            }

            // Handle current significant location with exitTime
            if (currentSignificantLocation?.exitTime) {
                const dwellTime = moment(currentSignificantLocation.exitTime)
                    .diff(moment(currentSignificantLocation.entryTime), 'minutes');
                currentSignificantLocation.dwellTime = dwellTime;

                if (!updates.significantLocations) updates.significantLocations = [];
                updates.significantLocations.push(currentSignificantLocation);
                updates.currentSignificantLocation = null;
            } else {
                // Update current significant location
                updates.currentSignificantLocation = currentSignificantLocation;
            }

            // Check trip status
            const { tripStage: newTripStage, activeStatus: newActiveStatus } = await tripStatusChecker(
                truckPoint,
                pathPoints,
                currentSignificantLocation,
                trip.movementStatus,
                trip.tripStage,
                trip.activeStatus,
                trip.route
            );

            // Handle trip stage changes
            if (newTripStage !== trip.tripStage) {
                updates.tripStage = newTripStage;
                const tripStageEvent = {
                    eventType: 'tripStageChange',
                    eventName: `Trip Stage Changed to ${newTripStage}`,
                    eventTime: currentTime,
                    eventLocation: {
                        type: 'Point',
                        coordinates: [truckPoint.lng, truckPoint.lat]
                    }
                };
                if (!updates.significantEvents) updates.significantEvents = [];
                updates.significantEvents.push(tripStageEvent);
                await sendAlerts({ trip, eventType: 'tripStageChange', status: newTripStage });
            }

            // Handle active status changes
            if (newActiveStatus !== trip.activeStatus) {
                updates.activeStatus = newActiveStatus;
                const activeStatusEvent = {
                    eventType: 'activeStatusChange',
                    eventName: `Active Status Changed to ${newActiveStatus}`,
                    eventTime: currentTime,
                    eventLocation: {
                        type: 'Point',
                        coordinates: [truckPoint.lng, truckPoint.lat]
                    }
                };
                if (!updates.significantEvents) updates.significantEvents = [];
                updates.significantEvents.push(activeStatusEvent);
                await sendAlerts({ trip, eventType: 'activeStatusChange', status: newActiveStatus });
            }

            // Set actual end time if trip is completed
            if (newTripStage === 'Completed') {
                updates.actualEndTime = truckPoint.dt_tracker;
            }


            // Check rules
            const ruleViolations = await checkRules(
                trip.rules,
                trip.ruleStatus,
                pathPoints,
                truckPoint,
                currentHaltDuration,
                distanceFromTruck,
                travelDirection,
                reverseTravelDistance,
                trip.currentSignificantLocation
            );

            if (ruleViolations) {
                updates.ruleStatus = { ...trip.ruleStatus, ...ruleViolations };
                // Process violations and create events
                for (const [rule, status] of Object.entries(ruleViolations)) {
                    if (status === 'Violated') {
                        const eventName = `${rule.replace('Status', '')} Violation`;
                        const newEvent = {
                            eventType: 'ruleViolation',
                            eventName,
                            eventTime: currentTime,
                            eventStartTime: currentTime,
                            eventDuration: 0,
                            eventDistance: 0,
                            eventLocation: {
                                type: 'Point',
                                coordinates: [truckPoint.lng, truckPoint.lat]
                            },
                            eventPath: {
                                type: 'LineString',
                                coordinates: pathPoints.map(p => [p.lng, p.lat])
                            }
                        };
                        if (!updates.significantEvents) updates.significantEvents = [];
                        updates.significantEvents.push(newEvent);
                        await sendAlerts({ trip, eventType: eventName, status: 'start' });
                    } else if (status === 'Good') {
                        // Find the corresponding violation event and update its end details
                        const violationEvent = updates.significantEvents?.find(event =>
                            event.eventType === 'ruleViolation' &&
                            event.eventName === `${rule.replace('Status', '')} Violation` &&
                            !event.eventEndTime
                        );

                        if (violationEvent) {
                            violationEvent.eventEndTime = truckPoint.dt_tracker;
                            violationEvent.eventDuration = moment(truckPoint.dt_tracker).diff(moment(violationEvent.eventStartTime), 'minutes');
                            violationEvent.eventDistance = calculatePathDistance(pathPoints.map(p => [p.lng, p.lat]));
                        }
                        await sendAlerts({ trip, eventType: `${rule.replace('Status', '')} Violation`, status: 'end' });
                    }
                }
            }
            // Handle ongoing violations not in ruleViolations
            for (const [rule, status] of Object.entries(trip.ruleStatus)) {
                if (status === 'Violated' && (!ruleViolations || !(rule in ruleViolations))) {
                    // Find the ongoing violation event
                    if (!updates.significantEvents) updates.significantEvents = [];
                    const violationEvent = updates.significantEvents.find(event =>
                        event.eventType === 'ruleViolation' &&
                        event.eventName === `${rule.replace('Status', '')} Violation` &&
                        !event.eventEndTime
                    );

                    if (violationEvent) {
                        // Add new path points to the event path
                        const newPoints = pathPoints.map(p => [p.lng, p.lat]);
                        violationEvent.eventPath.coordinates.push(...newPoints);
                    }
                }
            }

            // Check fuel status
            if (!trip.fuelStatusUpdateTime ||
                moment(currentTime).diff(moment(trip.fuelStatusUpdateTime), 'hours') >= 1) {
                try {
                    const fuelData = await getFuel({
                        timeFrom: trip.actualStartTime,
                        timeTo: currentTime,
                        imei: trip.deviceImei,
                        user_id: trip.iLogistekUserId
                    });
                    if (fuelData) {
                        // Transform and merge fuel events
                        const transformedEvents = fuelData.fuelEvents.map(event => ({
                            eventType: event.type === 'filling' ? 'Filling' : 'Theft',
                            eventTime: new Date(event.eventTime),
                            volume: event.volume,
                            location: {
                                type: 'Point',
                                coordinates: [event.lng, event.lat]
                            }
                        }));

                        // Add to fuelEvents array
                        if (!updates.fuelEvents) {
                            updates.fuelEvents = transformedEvents;
                        } else {
                            updates.fuelEvents = [...updates.fuelEvents, ...transformedEvents];
                        }

                        // Add to significantEvents array
                        const significantFuelEvents = fuelData.fuelEvents.map(event => ({
                            eventType: 'fuelEvent',
                            eventName: event.type === 'filling' ? 'Fuel Filling' : 'Fuel Theft',
                            eventTime: new Date(event.eventTime),
                            eventLocation: {
                                type: 'Point',
                                coordinates: [event.lng, event.lat]
                            },
                            eventPath: {
                                type: 'LineString',
                                coordinates: [[event.lng, event.lat]]
                            }
                        }));

                        if (!updates.significantEvents) {
                            updates.significantEvents = significantFuelEvents;
                        } else {
                            updates.significantEvents = [...updates.significantEvents, ...significantFuelEvents];
                            // Sort by eventTime ascending
                            updates.significantEvents.sort((a, b) => a.eventTime - b.eventTime);
                        }
                        updates.fuelConsumption = fuelData.consumption;
                        updates.fuelEfficiency = fuelData.mileage;
                        updates.fuelStatusUpdateTime = currentTime;
                        updates.currentFuelLevel = fuelData.endVol;
                    }
                } catch (err) {
                    console.error(`Error updating fuel data for trip ${trip.tripName}:`, err);
                }
            }



            // Update trip record
            await updateTripRecord(trip, updates);
        }

        // Process next trip
        mainLoop();

    } catch (err) {
        console.error('Error in mainLoop:', err);
        mainLoop(); // Continue with next trip despite error
    }
}

// Start the application
main();

module.exports = {
    getTripPath,
    presenceInSignificantLocation,
    getRouteSituation,
    checkRules,
    tripStatusChecker,
    sendAlerts,
    updateTripRecord
};
