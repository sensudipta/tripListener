const mongoose = require('mongoose');
const moment = require('moment');
const liveDB = require('./common/liveDB');
const { TRIPDB, redisClient } = liveDB;
const { tripLogger, processLogger } = require('./tripHelpers/logger');
const { Trip } = require('./models');

const sendAlerts = require('./tripHelpers/alertSender');
const getTripPath = require('./tripHelpers/getTripPath');
const presenceInSignificantLocation = require('./tripHelpers/locationCheker');
const tripStatusChecker = require('./tripHelpers/statusChecker');
const getRouteSituation = require('./tripHelpers/routeChecker');
const checkRules = require('./tripHelpers/checkRules');
const updateTripRecord = require('./tripHelpers/dbUpdater');

const { formatToIST, consoleDate, shortDate } = require('./tripHelpers/dateFormatter');


// default 10 hours

// Global array to store trips
let allTrips = [];

async function main() {
    try {
        allTrips = [];
        await mongoose.connect(TRIPDB);
        processLogger("\nConnected to Mongo Dabatbase: tripDB");
        try {
            await redisClient.connect();
            processLogger("Connected to Redis");
            const pong = await redisClient.ping();
            processLogger("Redis ping response:", pong);
        } catch (error) {
            processLogger("Error in Redis Connection:", error);
            process.exit(1);
        }


        const trips = await Trip.find({
            tripStage: { $in: ['Planned', 'Start Delayed', 'Active'] }
        }).populate('route');

        allTrips = trips.map(trip => trip.toObject());
        processLogger(`Loaded ${allTrips.length} trips for processing`);

        mainLoop();
    } catch (err) {
        processLogger('Error in main:', err);
        process.exit(1);
    }
}

// Start the application
main();

async function mainLoop() {
    try {
        if (allTrips.length === 0) {
            processLogger("All trips processed");
            process.exit(0);
        }

        const trip = allTrips.shift();
        if (!trip) {
            processLogger("No more trips to process");
            process.exit(0);
        }

        //console.log('Trip data:', JSON.stringify(trip.route, null, 2));
        validateTripData(trip);
        processLogger(`Processing trip: ${trip.truckRegistrationNumber} ${trip.tripName} (${trip.tripStage})`);
        tripLogger(trip, `@MAIN: Trip Check Started ${trip.truckRegistrationNumber}`);
        tripLogger(trip, `@MAIN: Trip Name -> ${trip.tripName} | Stage: ${trip.tripStage}`);

        // Update last check time
        const currentTime = new Date();
        trip.lastCheckTime = currentTime;
        //tripLogger(trip, `@MAIN: Last check time updated to: ${shortDate(currentTime)}`);

        if (trip.tripStage === 'Planned' || trip.tripStage === 'Start Delayed') {

            // get trip path data
            const tripPathData = await getTripPath(trip);
            if (!tripPathData) {
                tripLogger(trip, `@MAIN: No path data for ${trip.tripStage} trip -> ${trip.tripName}`);
                tripLogger(trip, `@MAIN: Trip Check Killed\n`);
                mainLoop();
                return;
            }
            const { truckPoint } = tripPathData;
            tripLogger(trip, `@MAIN: Truck point:- ${shortDate(truckPoint.dt_tracker)}`);

            //Significant location
            const updatedLocation = await presenceInSignificantLocation(
                trip,
                truckPoint
            );
            tripLogger(trip, `@MAIN: Location Cheker -> ${updatedLocation?.currentSignificantLocation?.locationName}`);

            //trip status checker
            const { tripStage, activeStatus } = await tripStatusChecker({
                trip: { ...trip },
                currentSignificantLocation: updatedLocation.currentSignificantLocation,
                movementStatus: "Unknown",
                complianceStatus: { newViolations: [], runningViolations: [] }
            });
            tripLogger(trip, `@MAIN: Status Checker -> ${tripStage} ${activeStatus}`);


            const updates = {
                tripStage,
                activeStatus,
                currentSignificantLocation: updatedLocation.currentSignificantLocation,
                lastCheckTime: currentTime
            };
            if (tripStage === 'Active' && tripStage !== trip.tripStage) {
                updates.actualStartTime = truckPoint.dt_tracker;
                const alertEvent = {
                    eventType: 'Status Update',
                    eventText: 'Trip Activated',
                    eventTime: truckPoint.dt_tracker
                };
                const alertTripPayload = {
                    ...trip, tripStage, activeStatus,
                    actualStartTime: updates.actualStartTime,
                }
                sendAlerts(alertTripPayload, alertEvent);
            }

            tripLogger(trip, "Trip data items for Database Update ->");
            // Log all updates
            Object.entries(updates).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    tripLogger(trip, `@MAIN: Update: Array ${key} - Size: ${value.length}`);
                } else {
                    tripLogger(trip, `@MAIN: Update: ${key} - ${value}`);
                }
            });
            await updateTripRecord(trip, updates);

        } else if (trip.tripStage === 'Active') {

            // Process active trips
            const tripPathData = await getTripPath(trip);
            if (!tripPathData) {
                tripLogger(trip, `@MAIN: No path data for ${trip.tripStage} trip -> ${trip.tripName}`);
                tripLogger(trip, `@MAIN: Trip Check Killed\n`);
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
            let movementStatus;
            if (driveStatus !== 'Unknown') {
                movementStatus = driveStatus;
            } else {
                movementStatus = trip.movementStatus;
            }
            /* if (trip.movementStatus === 'Unknown') {
                if (driveStatus !== 'Unknown') {
                    movementStatus = driveStatus;
                }
            } else if (trip.movementStatus !== driveStatus) {
                movementStatus = 'Unknown';
            } else {
                movementStatus = driveStatus;
            } */

            // Update halt tracking
            let haltStartTime = trip.haltStartTime;
            let currentHaltDuration = trip.currentHaltDuration;
            let parkedDuration = trip.parkedDuration;
            if (movementStatus === 'Halted') {
                if (!haltStartTime) {
                    haltStartTime = truckPoint.dt_tracker;
                }
                currentHaltDuration = moment(currentTime).diff(moment(haltStartTime), 'minutes');

            } else {
                // Add current halt duration to total parked duration
                parkedDuration = (trip.parkedDuration || 0) + currentHaltDuration;
                haltStartTime = null;
                currentHaltDuration = 0;
            }

            // Calculate weighted average speed based on run durations
            const existingRunDuration = trip.runDuration || 0;
            const totalRunDuration = existingRunDuration + runDuration;
            const weightedAverageSpeed = totalRunDuration > 0 ?
                ((existingRunDuration * (trip.averageSpeed || 0)) + (runDuration * averageSpeed)) / totalRunDuration :
                averageSpeed;
            tripLogger(trip, `@MAIN: tripPathData: truckPoint: ${shortDate(truckPoint.dt_tracker)} driveStatus: ${driveStatus} mvStatus: ${movementStatus}`);
            tripLogger(trip, `@MAIN: tripPathData: topSpeed: ${topSpeed} avgSpeed: ${averageSpeed.toFixed(1)} wavgSpeed: ${weightedAverageSpeed.toFixed(1)} totalDist: ${totalDistance?.toFixed(1)}`);
            tripLogger(trip, `@MAIN: Halt Start: ${shortDate(haltStartTime)} Halt Dur: ${currentHaltDuration} minutes`);
            tripLogger(trip, `@MAIN: Run Dur: existing: ${existingRunDuration} new: ${runDuration} total: ${totalRunDuration} `);

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
                lastCheckTime: currentTime,
            };
            if (pathPoints.length > 0) {
                updates.tripPath = pathPoints.map(point => ({
                    type: 'Point',
                    coordinates: [point.lng, point.lat],
                    dtTracker: point.dt_tracker,
                    gpsRecord: {
                        speed: point.speed,
                        heading: point.heading,
                        acc: point.acc
                    }
                }))
            }

            // Get route situation
            const routeSituation = await getRouteSituation(truckPoint, pathPoints, trip);
            if (!routeSituation) {
                tripLogger(trip, `@MAIN: Could not determine route situation for ${trip.tripStage} trip -> ${trip.tripName}`);
                tripLogger(trip, `@MAIN: Trip Check Killed\n`);
                mainLoop();
                return;
            }

            const {
                distanceFromTruck,
                cumulativeDistance,
                travelDirection,
                reverseTravelDistance,
                nearestRoutePoint,
                nearestPointIndex
            } = routeSituation;
            tripLogger(trip, `@MAIN: RouteSituation: truckDist: ${distanceFromTruck.toFixed(1)} cumDist: ${cumulativeDistance.toFixed(1)} npIdx: ${nearestPointIndex}`);
            tripLogger(trip, `@MAIN: RouteSituation: travelDir: ${travelDirection} reverseTravel: ${reverseTravelDistance?.toFixed(1)}`);

            updates.distanceFromTruck = distanceFromTruck;
            updates.travelDirection = travelDirection;
            updates.reverseTravelDistance = reverseTravelDistance;
            updates.nearestRoutePoint = nearestRoutePoint;
            updates.nearestPointIndex = nearestPointIndex;

            updates.distanceCovered = cumulativeDistance;
            updates.distanceRemaining = trip.route.routeLength / 1000 - cumulativeDistance;
            updates.completionPercentage = (cumulativeDistance * 1000 / trip.route.routeLength) * 100;

            // Add ETA calculation
            if (weightedAverageSpeed > 0 && updates.distanceRemaining > 0 &&
                updates.distanceCovered > 0 && movementStatus === 'Driving' && trip.tripStage === 'Active') {
                const hoursRemaining = updates.distanceRemaining / weightedAverageSpeed;
                updates.estimatedTimeOfArrival = moment().add(hoursRemaining, 'hours').toDate();
                tripLogger(trip, `@MAIN: ETA calculated: ${shortDate(updates.estimatedTimeOfArrival)}`);
            } else {
                tripLogger(trip, `@MAIN: ETA not calculated`);
                if (weightedAverageSpeed <= 0) {
                    tripLogger(trip, `@MAIN: ETA not calculated - Average speed is zero or negative: ${weightedAverageSpeed}`);
                } else if (updates.distanceRemaining <= 0) {
                    tripLogger(trip, `@MAIN: ETA not calculated - No remaining distance: ${updates.distanceRemaining}`);
                } else if (updates.distanceCovered <= 0) {
                    tripLogger(trip, `@MAIN: ETA not calculated - No distance covered: ${updates.distanceCovered}`);
                } else if (movementStatus !== 'Driving') {
                    tripLogger(trip, `@MAIN: ETA not calculated - Truck not driving: ${movementStatus}`);
                } else if (trip.tripStage !== 'Active') {
                    tripLogger(trip, `@MAIN: ETA not calculated - Trip not active: ${trip.tripStage}`);
                }
            }

            // Update reverse travel data if applicable
            if (travelDirection === 'reverse' && (reverseTravelDistance > 500 || trip.reverseTravelPath?.coordinates?.length > 0)) {
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
                    tripLogger(trip, `@MAIN: Reverse travel event: ${reverseEvent.eventName} at ${shortDate(reverseEvent.eventTime)}`);
                    if (!updates.significantEvents) {
                        updates.significantEvents = [];
                    }
                    updates.significantEvents.push(reverseEvent);
                }
                updates.reverseTravelPath = null;
                updates.reverseTravelDistance = 0;
            }
            updates.reverseTravelPath && tripLogger(trip, `@MAIN: Reverse travel path length: ${updates.reverseTravelPath?.coordinates?.length} Reverse travel distance: ${updates.reverseTravelDistance}`);

            // Check significant locations
            const { currentSignificantLocation, previousSignificantLocation, locationChange } =
                await presenceInSignificantLocation(
                    trip,
                    truckPoint
                );
            tripLogger(trip, `@MAIN: LocationChecker: Curr: ${currentSignificantLocation ? currentSignificantLocation?.locationName : 'NO'} Prev: ${previousSignificantLocation ? previousSignificantLocation?.locationName : 'NO'}`);
            if (previousSignificantLocation) {
                const dwellTime = moment(previousSignificantLocation.exitTime)
                    .diff(moment(previousSignificantLocation.entryTime), 'minutes');
                previousSignificantLocation.dwellTime = dwellTime;

                if (!updates.significantLocations) updates.significantLocations = [];
                updates.significantLocations.push(previousSignificantLocation);
                tripLogger(trip, `@MAIN: SigniLoc (prev) Closed: ${previousSignificantLocation.locationName} Dwell Time: ${previousSignificantLocation.dwellTime} minutes`);
            }
            // Handle current significant location with exitTime

            if (currentSignificantLocation) {
                tripLogger(trip, `@MAIN: currentSignificantLocation: ${currentSignificantLocation.locationName} Entry Time: ${shortDate(currentSignificantLocation.entryTime)} Exit Time: ${shortDate(currentSignificantLocation.exitTime)}`);
                // Update current significant location
                if (currentSignificantLocation?.exitTime) {
                    const dwellTime = moment(currentSignificantLocation.exitTime)
                        .diff(moment(currentSignificantLocation.entryTime), 'minutes');
                    currentSignificantLocation.dwellTime = dwellTime;

                    if (!updates.significantLocations) updates.significantLocations = [];
                    updates.significantLocations.push(currentSignificantLocation);
                    tripLogger(trip, `@MAIN: SigniLoc (curr) Closed: ${currentSignificantLocation.locationName} Dwell Time: ${currentSignificantLocation.dwellTime} minutes`);
                    updates.currentSignificantLocation = null;
                } else {
                    updates.currentSignificantLocation = currentSignificantLocation;
                    tripLogger(trip, `@MAIN: SigniLoc (curr) Open: ${currentSignificantLocation.locationName} Dwell Time: ${currentSignificantLocation.dwellTime} minutes`);
                }
            } else {
                tripLogger(trip, `@MAIN: currentSignificantLocation is null`);
                updates.currentSignificantLocation = null;
            }

            // Check rules
            const { updatedRuleStatus, newViolations, runningViolations, newGoods } = await checkRules(
                trip.rules,
                trip.ruleStatus,
                truckPoint,
                currentHaltDuration,
                movementStatus,
                averageSpeed,
                distanceFromTruck,
                travelDirection,
                reverseTravelDistance,
            );
            runningViolations.length > 0 && tripLogger(trip, `@MAIN: Running Violations: ${runningViolations}`);
            newGoods.length > 0 && tripLogger(trip, `@MAIN: Became Good: ${newGoods}`);
            const ruleViolations = updatedRuleStatus;

            //update trip ruleStatus for Rule violations
            if (ruleViolations) {
                Object.keys(ruleViolations).forEach(rule => {
                    tripLogger(trip, `@MAIN: New Violation: ${rule} status: ${ruleViolations[rule]}`);
                });
                updates.ruleStatus = { ...trip.ruleStatus, ...ruleViolations };
                // Process violations and create events
                for (const [rule, status] of Object.entries(ruleViolations)) {
                    const trimmedRule = rule.replace('Status', '');
                    let eventName;
                    if (trimmedRule === 'routeViolation') {
                        eventName = 'Route Violation';
                    } else {
                        // Convert camelCase to space-separated words with first letters capitalized
                        eventName = `${trimmedRule.replace(/([A-Z])/g, ' $1')
                            .replace(/^./, str => str.toUpperCase())} Violation`;
                    }
                    if (status === 'Violated') {
                        const newEvent = {
                            eventType: 'ruleViolation',
                            eventName,
                            eventTime: truckPoint.dt_tracker,
                            eventStartTime: truckPoint.dt_tracker,
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
                        const alertTripPayload = {
                            ...trip,
                            ...updates
                        };
                        const alertEvent = {
                            eventType: 'Rule Violation',
                            eventText: eventName,
                            eventTime: truckPoint.dt_tracker,
                        };
                        sendAlerts(alertTripPayload, alertEvent);
                    } else if (status === 'Good') {
                        // Find the corresponding violation event and update its end details
                        const violationEvent = updates.significantEvents?.find(event =>
                            event.eventType === 'ruleViolation' &&
                            event.eventName === eventName &&
                            !event.eventEndTime
                        );

                        if (violationEvent) {
                            violationEvent.eventEndTime = truckPoint.dt_tracker;
                            violationEvent.eventDuration = moment(truckPoint.dt_tracker).diff(moment(violationEvent.eventStartTime), 'minutes');
                            violationEvent.eventDistance = calculatePathDistance(pathPoints.map(p => [p.lng, p.lat]));
                        }
                        const alertTripPayload = {
                            ...trip,
                            ...updates
                        };
                        const alertEvent = {
                            eventType: `Compliance Good`,
                            eventText: `${rule.replace('Status', '')} is Good`,
                            eventTime: truckPoint.dt_tracker,
                        };
                        sendAlerts(alertTripPayload, alertEvent);
                    }
                }
            }

            // Handle ongoing violations not in ruleViolations
            for (const [rule, status] of Object.entries(trip.ruleStatus)) {
                if (status === 'Violated' && (!ruleViolations || !(rule in ruleViolations))) {
                    const trimmedRule = rule.replace('Status', '');
                    let eventName;
                    if (trimmedRule === 'routeViolation') {
                        eventName = 'Route Violation';
                    } else {
                        eventName = `${trimmedRule.replace(/([A-Z])/g, ' $1')
                            .replace(/^./, str => str.toUpperCase())} Violation`;
                    }
                    // Find the ongoing violation event
                    if (!updates.significantEvents) updates.significantEvents = [];
                    const violationEvent = updates.significantEvents.find(event =>
                        event.eventType === 'ruleViolation' &&
                        event.eventName === eventName &&
                        !event.eventEndTime
                    );

                    if (violationEvent) {
                        // Add new path points to the event path
                        const newPoints = pathPoints.map(p => [p.lng, p.lat]);
                        violationEvent.eventPath.coordinates.push(...newPoints);
                    }
                }
            }

            // Check trip status
            const { tripStage: newTripStage, activeStatus: newActiveStatus }
                = await tripStatusChecker({
                    trip: { ...trip },
                    currentSignificantLocation,
                    movementStatus,
                    complianceStatus: { newViolations, runningViolations, newGoods }
                });
            if (newTripStage === null || newActiveStatus === null) {
                tripLogger(trip, `@MAIN: Trip Status Checker returned null values for tripStage: ${newTripStage} and activeStatus: ${newActiveStatus}`);
                tripLogger(trip, `@MAIN: Trip Check Killed\n`);
                mainLoop();
                return;
            }
            tripLogger(trip, `@MAIN: StatusChecker Stage: ${trip.tripStage} -> ${newTripStage} | Active Status: ${trip.activeStatus} -> ${newActiveStatus}`);
            // Handle trip stage changes
            if (newTripStage !== trip.tripStage) {
                updates.tripStage = newTripStage;
                const tripStageEvent = {
                    eventType: 'tripStageChange',
                    eventName: `Trip Stage Changed to ${newTripStage}`,
                    eventTime: truckPoint.dt_tracker,
                    eventLocation: {
                        type: 'Point',
                        coordinates: [truckPoint.lng, truckPoint.lat]
                    }
                };
                if (!updates.significantEvents) updates.significantEvents = [];
                updates.significantEvents.push(tripStageEvent);
                const alertTripPayload = {
                    ...trip,
                    ...updates
                };
                const alertEvent = {
                    eventType: 'Status Update',
                    eventText: `Trip is ${newTripStage}`,
                    eventTime: truckPoint.dt_tracker,
                };
                sendAlerts(alertTripPayload, alertEvent);
            }

            // Handle active status changes
            if (newActiveStatus !== trip.activeStatus) {
                updates.activeStatus = newActiveStatus;
                const activeStatusEvent = {
                    eventType: 'activeStatusChange',
                    eventName: `Active Status Changed to ${newActiveStatus}`,
                    eventTime: truckPoint.dt_tracker,
                    eventLocation: {
                        type: 'Point',
                        coordinates: [truckPoint.lng, truckPoint.lat]
                    }
                };
                if (!updates.significantEvents) updates.significantEvents = [];
                updates.significantEvents.push(activeStatusEvent);
                const alertTripPayload = {
                    ...trip,
                    ...updates
                };
                const alertEvent = {
                    eventType: 'Activity Update',
                    eventText: `Truck ${newActiveStatus}`,
                    eventTime: truckPoint.dt_tracker,
                };
                tripLogger(trip, `@MAIN: Sending Alert Event: ${alertEvent.eventText} at ${consoleDate(alertEvent.eventTime)}`);
                sendAlerts(alertTripPayload, alertEvent);
            }

            // Set actual end time if trip is completed
            if (newTripStage === 'Completed') {
                updates.actualEndTime = truckPoint.dt_tracker;
                //perform other trip completion tasks
            }

            // Check fuel status
            tripLogger(trip, `@MAIN: Fuel status update time: ${consoleDate(trip.fuelStatusUpdateTime)} TYP time: ${consoleDate(truckPoint.dt_tracker)} TP Level: ${truckPoint.fuelLevel} New Trip Stage: ${newTripStage}`);
            if (truckPoint.fuelLevel && (!trip.fuelStatusUpdateTime ||
                moment(currentTime).diff(moment(trip.fuelStatusUpdateTime), 'hours') >= 1 || newTripStage === 'Completed')) {
                try {
                    const fuelData = await getFuel({
                        timeFrom: trip.actualStartTime,
                        timeTo: currentTime,
                        imei: trip.deviceImei,
                        user_id: trip.iLogistekUserId
                    });
                    Object.entries(fuelData).forEach(([key, value]) => {
                        tripLogger(trip, `@MAIN: Fuel Data: ${key} - ${value}`);
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
                        updates.fuelConsumption = (trip.fuelConsumption || 0) + fuelData.consumption;
                        updates.fuelEfficiency = (updates.truckRunDistance && updates.fuelConsumption && !isNaN(updates.truckRunDistance / updates.fuelConsumption)) ?
                            updates.truckRunDistance / updates.fuelConsumption :
                            fuelData.mileage;
                        updates.fuelStatusUpdateTime = currentTime;
                        updates.currentFuelLevel = truckPoint.fuelLevel;//fuelData.endVol;
                        tripLogger(trip, `@MAIN: Fuel Consumption: ${updates.fuelConsumption} Fuel Efficiency: ${updates.fuelEfficiency} Fuel Status Update Time: ${updates.fuelStatusUpdateTime} Current Fuel Level: ${updates.currentFuelLevel}`);
                    }
                } catch (err) {
                    tripLogger(trip, `@MAIN: Error updating fuel data for trip ${trip.tripName}: ${err}`);
                    console.error(`Error updating fuel data for trip ${trip.tripName}:`, err);
                }
            }

            // Update trip record
            tripLogger(trip, "@MAIN: Going to update trip record");
            await updateTripRecord(trip, updates);
        }

        // Process next trip
        //tripLogger(trip, `@MAIN: DONE DONE DONE\n`);
        mainLoop();

    } catch (err) {
        console.error('Error in mainLoop:', err);
        processLogger(`Error in mainLoop: ${err}`);
        mainLoop(); // Continue with next trip despite error
    }
}


function validateTripData(trip) {
    const requiredFields = [
        'deviceImei',
        'tripName',
        'tripStage',
        'plannedStartTime',
        'route',
        'rules',
    ];

    const missingFields = requiredFields.filter(field => !trip[field]);
    if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Add route validation with more specific error message
    if (!trip.route) {
        throw new Error('Route object is missing');
    }

    if (!trip.route.startLocation) {
        throw new Error('Start location is missing in route');
    }

    if (!trip.route.endLocation) {
        throw new Error('End location is missing in route');
    }

    // Validate specific field formats
    if (!/^\d{15}$/.test(trip.deviceImei)) {
        throw new Error('Invalid IMEI format');
    }

    if (!['Planned', 'Start Delayed', 'Active', 'Completed'].includes(trip.tripStage)) {
        throw new Error('Invalid trip stage');
    }
}