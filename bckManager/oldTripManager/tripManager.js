const mongoose = require('mongoose');
const moment = require('moment');
const liveDB = require('./common/liveDB');
const { TRIPDB, redis } = liveDB;
const { Route, Trip } = require('./models');
const { getLengthBetweenPoints, findNearestPointIndex,
    calculatePathDistance, checkLocation } = require('./common/helper');
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

const gloalMaxDetentionTime = 600; // default 10 hours

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
async function getTripPath(trip) {
    const { deviceImei, tripStage, tripPath, truckRegistrationNumber } = trip;
    try {
        if (tripStage === 'Active') {
            // Get and clear rawTripPath data from redis
            const rawPathData = await redis.lRange(`${deviceImei}:rawTripPath`, 0, -1);
            await redis.del(`${deviceImei}:rawTripPath`);
            console.log("TripPath raw points", deviceImei, "Stage:", tripStage, "Points:", rawPathData.length);
            // Parse and sort path points
            const pathPoints = rawPathData
                .map(point => JSON.parse(point))
                .sort((a, b) => new Date(a.dt_tracker) - new Date(b.dt_tracker));

            if (!pathPoints.length) {
                const [lat, lng, dt_tracker, speed, acc] = await Promise.all([
                    redis.get(`${deviceImei}:lat`),
                    redis.get(`${deviceImei}:lng`),
                    redis.get(`${deviceImei}:dt_tracker`),
                    redis.get(`${deviceImei}:speed`),
                    redis.get(`${deviceImei}:acc`)
                ]);

                return {
                    truckPoint: { lat, lng, dt_tracker, speed, acc },
                    pathPoints: [{ lat, lng, dt_tracker, speed, acc }],
                    driveStatus: speed > 2 && acc === 1 ? 'Driving' : 'Halted',
                    topSpeed: 0,
                    averageSpeed: 0,
                    totalDistance: 0,
                    runDuration: 0
                };
            } else {
                const truckPoint = pathPoints[pathPoints.length - 1];
                let startPoint = pathPoints[0];
                if (tripPath && tripPath.length > 0) {
                    startPoint = {
                        lat: tripPath[tripPath.length - 1].coordinates[1],
                        lng: tripPath[tripPath.length - 1].coordinates[0],
                        dt_tracker: tripPath[tripPath.length - 1].dtTracker
                    };
                }
                const displacement = startPoint ? getLengthBetweenPoints(
                    { latitude: startPoint.lat, longitude: startPoint.lng },
                    { latitude: truckPoint.lat, longitude: truckPoint.lng }
                ) : 0;
                const timeElapsed = startPoint ? (new Date(truckPoint.dt_tracker) - new Date(startPoint.dt_tracker)) / 1000 / 3600 : 0;
                const velocity = (displacement && timeElapsed && !isNaN(displacement) && !isNaN(timeElapsed)) ? displacement / timeElapsed : 0;
                if (velocity > 5) {
                    driveStatus = 'Driving';
                } else {
                    driveStatus = 'Halted';
                }
                console.log("####  ST04b DriveStatus", truckRegistrationNumber, "Status", driveStatus, "Velocity", velocity, "Displacement", displacement, "TimeElapsed", timeElapsed);
                // Compute metrics
                let topSpeed = 0;
                let totalValidSpeed = 0;
                let validSpeedPoints = 0;
                let totalDistance = 0;
                let runDuration = 0;

                for (let i = 1; i < pathPoints.length; i++) {
                    const prevPoint = pathPoints[i - 1];
                    const currentPoint = pathPoints[i];

                    if (prevPoint.acc == 1 && currentPoint.acc == 1 &&
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
                    totalDistance: totalDistance / 1000,
                    runDuration
                };
            }

            // Get last point as truck point


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
async function presenceInSignificantLocation(trip, truckPoint) {

    try {
        const { route } = trip;
        const { startLocation, endLocation, viaLocations } = route;
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
            console.log("####  ST09b NewLoc", newSignificantLocation.locationName, "Type", newSignificantLocation.locationType);
            if (!currentSignificantLocation) {
                // First entry into a significant location
                currentSignificantLocation = {
                    ...newSignificantLocation,
                    entryTime: truckPoint.dt_tracker
                };
                console.log("####  ST09b Entry  Into CurrentSignificantLocation", currentSignificantLocation.locationName, "Type", currentSignificantLocation.locationType);
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
                console.log("####  ST09b !!HOP  CurrentSignificantLocation", currentSignificantLocation.locationName, "Type", currentSignificantLocation.locationType, "PreviousSignificantLocation", previousSignificantLocation.locationName, "Type", previousSignificantLocation.locationType);
            }
            // If in same location, do nothing
        } else if (currentSignificantLocation) {
            // Truck has left the significant location
            previousSignificantLocation = {
                ...currentSignificantLocation,
                exitTime: truckPoint.dt_tracker
            };
            currentSignificantLocation = null;
            console.log("####  ST09b Exit  From PreviousSignificantLocation", previousSignificantLocation.locationName, "Type", previousSignificantLocation.locationType);
        }

        let locationChange = {
            entry: null,
            exit: null,
            viaSwitch: null
        };

        // Handle exit cases
        if (previousSignificantLocation) {
            if (previousSignificantLocation.locationType === 'startLocation') {
                locationChange.exit = 'startLocation';
            } else if (previousSignificantLocation.locationType === 'endLocation') {
                locationChange.exit = 'endLocation';
            } else if (previousSignificantLocation.locationType === 'viaLocation') {
                locationChange.exit = `viaLocation ${previousSignificantLocation.locationName}`;
            }
        }

        // Handle entry cases 
        if (currentSignificantLocation) {
            if (currentSignificantLocation.locationType === 'startLocation') {
                locationChange.entry = 'startLocation';
            } else if (currentSignificantLocation.locationType === 'endLocation') {
                locationChange.entry = 'endLocation';
            } else if (currentSignificantLocation.locationType === 'viaLocation') {
                locationChange.entry = `viaLocation ${currentSignificantLocation.locationName}`;
            }
        }

        // Check for via location switch
        if (previousSignificantLocation?.locationType === 'viaLocation' &&
            currentSignificantLocation?.locationType === 'viaLocation' &&
            previousSignificantLocation.locationName !== currentSignificantLocation.locationName) {
            locationChange.viaSwitch = `${previousSignificantLocation.locationName} to ${currentSignificantLocation.locationName}`;
        }
        // If no locations, no change strings needed
        return { currentSignificantLocation, previousSignificantLocation, changeString };
    } catch (err) {
        console.error('Error in presenceInSignificantLocation:', err);
        return { currentSignificantLocation, previousSignificantLocation: null, changeString: null };
    }
}

// 3. getRouteSituation function
async function getRouteSituation(truckPoint, pathPoints, routePath) {
    try {
        if (!truckPoint || !routePath) {
            console.log("####  ST09b No TruckPoint or RoutePath");
            return {};
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
            if (!distance || isNaN(distance)) {
                console.log("####  ST09b Invalid Distance", distance, "for", truckPoint.lat, truckPoint.lng, "and", coord[1], coord[0]);
                return null;
            }
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
            distanceFromTruck: minDistance / 1000,
            cumulativeDistance: cumulativeDistance / 1000,
            travelDirection,
            reverseTravelDistance: reverseTravelDistance / 1000
        };

    } catch (err) {
        console.error('Error in getRouteSituation:', err);
        return {};
    }
}

// 4. checkRules function
async function checkRules(rules, ruleStatus, pathPoints, truckPoint, currentHaltDuration,
    distanceFromTruck, travelDirection, reverseTravelDistance, currentSignificantLocation) {
    //console.log("In checkRules: rule:", rules, "ruleStatus:", ruleStatus, "truckPoint:", truckPoint, "currentHaltDuration:", currentHaltDuration,
    //    "distanceFromTruck:", distanceFromTruck, "reverseTravelDistance:", reverseTravelDistance, "currentSignificantLocation:", currentSignificantLocation);
    try {
        const updatedRuleStatus = {};
        const currentTime = moment(truckPoint.dt_tracker);

        const newViolations = [];
        const runningViolations = [];
        const newGoods = [];
        // Check driving time rule
        if ('drivingStartTime' in rules && 'drivingEndTime' in rules) {
            const currentHour = currentTime.hour();
            if (currentHour < parseInt(rules.drivingStartTime) ||
                currentHour > parseInt(rules.drivingEndTime)) {
                if (ruleStatus.drivingTimeStatus !== 'Violated') {
                    updatedRuleStatus.drivingTimeStatus = 'Violated';
                    newViolations.push('drivingTimeStatus');
                } else {
                    runningViolations.push('drivingTimeStatus');
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
            if (currentHaltDuration > rules.maxHaltTime) {
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
        //console.log("Updated rules:", updatedRuleStatus);
        // Only return rules that changed status
        return { updatedRuleStatus, newViolations, runningViolations, newGoods };
        //return Object.keys(result).length > 0 ? result : null;

    } catch (err) {
        console.error('Error in checkRules:', err);
        return null;
    }
}

async function sendAlerts({ trip, eventType, status, metadata = {} }) {
    try {
        // Validate inputs
        console.log("Sending alerts for trip:", trip.tripName, eventType, status);
        // Determine alert recipients and channels based on event type
        if (!trip || !eventType || !status) {
            if (!trip) console.log('Missing trip parameter');
            if (!eventType) console.log('Missing eventType parameter');
            if (!status) console.log('Missing status parameter');
            //throw new Error('Missing required alert parameters');
            return false;
        }
        else {
            console.log("Can send alerts");
            return true;
        }
        /*const alertConfig = await getAlertConfig(trip.route.notifications);

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
        */
    } catch (err) {
        logger.error('Failed to send alerts', err);
        return false;
    }
}

// 7. updateTripRecord function
async function updateTripRecord(trip, updates) {
    //console.log("In updateTripRecord", updates);
    // Create object to store only changed fields
    const finalUpdates = {};

    // Helper function to check deep equality of values
    const isEqual = (val1, val2) => {
        // Handle null/undefined cases
        if (val1 === val2) return true;
        if (!val1 || !val2) return false;

        // Handle Date objects
        if (val1 instanceof Date && val2 instanceof Date) {
            return val1.getTime() === val2.getTime();
        }

        // Handle arrays
        if (Array.isArray(val1) && Array.isArray(val2)) {
            if (val1.length !== val2.length) return false;
            return val1.every((item, index) => isEqual(item, val2[index]));
        }

        // Handle objects
        if (typeof val1 === 'object' && typeof val2 === 'object') {
            const keys1 = Object.keys(val1);
            const keys2 = Object.keys(val2);

            if (keys1.length !== keys2.length) return false;

            return keys1.every(key =>
                keys2.includes(key) && isEqual(val1[key], val2[key])
            );
        }

        // Handle primitive values
        return val1 === val2;
    };

    // Compare each field and only include changed values
    Object.entries(updates).forEach(([key, newValue]) => {
        const oldValue = trip[key];

        if (!isEqual(oldValue, newValue)) {
            finalUpdates[key] = newValue;
        }
    });

    // If no changes detected, return early
    if (Object.keys(finalUpdates).length === 0) {
        console.log("No changes detected for trip", trip._id);
        return true;
    }

    // Log detected changes
    //console.log("Detected changes for trip", trip.tripName, "UPDKEYS", Object.keys(finalUpdates).length);
    /* Object.entries(finalUpdates).forEach(([key, value]) => {
        console.log(`${key}:`, {
            old: trip[key],
            new: value
        });
    }); */

    // Replace updates with finalUpdates containing only changed fields
    updates = finalUpdates;
    try {
        // Validate inputs
        if (!trip?._id) {
            throw new Error('Invalid trip ID');
        }

        let retryCount = 0;
        const MAX_RETRIES = 3;

        while (retryCount < MAX_RETRIES) {
            try {
                // Construct update query
                const updateQuery = { $set: {} };

                // Handle array fields separately using $push
                if (updates.significantEvents) {
                    if (!updateQuery.$push) updateQuery.$push = {};
                    updateQuery.$push.significantEvents = { $each: updates.significantEvents };
                    delete updates.significantEvents;
                }
                if (updates.tripPath) {
                    if (!updateQuery.$push) updateQuery.$push = {};
                    updateQuery.$push.tripPath = { $each: updates.tripPath };
                    delete updates.tripPath;
                }
                if (updates.significantLocations) {
                    if (!updateQuery.$push) updateQuery.$push = {};
                    updateQuery.$push.significantLocations = { $each: updates.significantLocations };
                    delete updates.significantLocations;
                }

                // Add all other updates to $set
                Object.keys(updates).forEach(key => {
                    updateQuery.$set[key] = updates[key];
                });

                const result = await Trip.findOneAndUpdate(
                    { _id: trip._id },
                    updateQuery,
                    {
                        new: true, // Return updated document
                        runValidators: true
                    }
                );

                if (!result) {
                    throw new Error('Trip not found or no changes made');
                }


                /*Object.keys(updates).forEach(key => {
                    if (key !== 'tripPath') {
                        //console.log(`Updated tripDB: ${trip.truckRegistrationNumber} - ${key} - ${result[key]}`);
                    } else {
                        //console.log(`Updated tripDB: ${trip.tripName} - ${key} - ${result[key].length} points - Last point: ${result[key].length > 0 ? JSON.stringify(result[key][result[key].length - 1]) : 'none'}`);
                    }
                });*/
                //console.log("Trip updated successfully");
                console.log("_________________________________________________________");

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
        return false;
    }
}

// Add a validation helper
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

// 8. main function
async function main() {
    try {
        allTrips = [];
        await mongoose.connect(TRIPDB);
        console.log("Connected to TripDB");
        await redis.connect();
        console.log("Connected to Redis");
        const pong = await redis.ping();
        console.log("Redis ping:", pong);

        const trips = await Trip.find({
            tripStage: { $in: ['Planned', 'Start Delayed', 'Active'] }
        }).populate('route');

        allTrips = trips.map(trip => trip.toObject());
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
        }

        const trip = allTrips.shift();
        if (!trip) {
            console.log("No more trips to process");
            process.exit(0);
        }

        //console.log('Trip data:', JSON.stringify(trip.route, null, 2));
        validateTripData(trip);
        console.log("_________________________________________________________");
        console.log(`Processing trip: ${trip.tripName} (${trip.tripStage})`);

        // Update last check time
        const currentTime = new Date();
        trip.lastCheckTime = currentTime;
        console.log("Last check time updated to:", currentTime);
        if (trip.tripStage === 'Planned' || trip.tripStage === 'Start Delayed') {

            // get trip path data
            const tripPathData = await getTripPath(trip);
            if (!tripPathData) {
                console.log(`No path data for trip ${trip.tripName}`);
                mainLoop();
                return;
            }
            const { truckPoint } = tripPathData;
            console.log("#ST01 Truck point:-", trip.tripName, truckPoint.dt_tracker);

            //Significant location
            const updatedLocation = await presenceInSignificantLocation(
                trip,
                truckPoint
            );
            console.log("#ST02 Significant location:-", trip.tripName, updatedLocation?.currentSignificantLocation?.locationName);

            //trip status checker
            const { tripStage, activeStatus } = await tripStatusChecker({ ...trip, currentSignificantLocation: updatedLocation?.currentSignificantLocation });
            console.log("#ST03 Trip status:-", trip.tripName, tripStage, activeStatus);
            const updates = {
                tripStage,
                activeStatus,
                currentSignificantLocation: updatedLocation.currentSignificantLocation,
                lastCheckTime: currentTime
            };
            //console.log("Updates:-", trip.tripName, updates);
            // Send alert if trip stage changed
            if (tripStage !== trip.tripStage) {
                await sendAlerts({ trip, eventType: 'tripStageChange', status: tripStage });

                // Set actual start time if new stage is Active
                if (tripStage === 'Active') {
                    updates.actualStartTime = truckPoint.dt_tracker;
                }
            }
            console.log("Updates after trip status change:");
            // Log all updates
            Object.entries(updates).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    console.log(`Update key ${key} - Size: ${value.length}`);
                } else {
                    console.log(`Update key ${key} - ${value}`);
                }
            });
            await updateTripRecord(trip, updates);

        } else if (trip.tripStage === 'Active') {
            // Process active trips
            const tripPathData = await getTripPath(trip);
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
            let movementStatus;
            if (trip.movementStatus === 'Unknown') {
                movementStatus = driveStatus;
            } else if (trip.movementStatus !== driveStatus) {
                movementStatus = 'Unknown';
            } else {
                movementStatus = driveStatus;
            }
            console.log("ST04: tripPath:", trip.truckRegistrationNumber, formatToIST(truckPoint.dt_tracker), "driveStatus", driveStatus, "mvStatus", movementStatus, "topSpeed", topSpeed, "avgSpeed", averageSpeed, "totalDist", totalDistance?.toFixed(1), "runDur", runDuration);

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
            console.log("ST06: Halt start time:", formatToIST(haltStartTime), "currHaltDur", currentHaltDuration, "wavgSpeed", weightedAverageSpeed.toFixed(1));

            // Get route situation
            const routeSituation = await getRouteSituation(truckPoint, pathPoints, trip.route.routePath);
            if (!routeSituation) {
                console.log(`Could not determine route situation for trip ${trip.tripName}`);
                mainLoop();
            }

            const {
                distanceFromTruck,
                cumulativeDistance,
                travelDirection,
                reverseTravelDistance,
                nearestRoutePoint,
                nearestPointIndex
            } = routeSituation;
            console.log("ST07: RouteSituation: truckDist", distanceFromTruck.toFixed(1), "cumDist", cumulativeDistance.toFixed(1), "travelDir", travelDirection, "revTravelDist", reverseTravelDistance.toFixed(1), "npIdx", nearestPointIndex);

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
                distanceRemaining: trip.route.routeLength / 1000 - cumulativeDistance,
                completionPercentage: (cumulativeDistance * 1000 / trip.route.routeLength) * 100,
                lastCheckTime: currentTime,
                nearestRoutePoint,
                nearestPointIndex,

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
            //console.log("ST02: Updates:", Object.keys(updates).length);

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
                //console.log("ST02: Reverse travel distance updated:", updates.reverseTravelDistance);
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
            console.log("ST08: Reverse travel path length:", updates.reverseTravelPath?.coordinates?.length, "Reverse travel distance:", updates.reverseTravelDistance);

            // Check significant locations
            const { currentSignificantLocation, previousSignificantLocation, locationChange } =
                await presenceInSignificantLocation(
                    trip,
                    truckPoint
                );
            console.log("ST09: SIGNILOC: Change", locationChange, "Curr:", currentSignificantLocation?.locationName, "Prev:", previousSignificantLocation?.locationName);
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

            // Check rules
            const { updatedRuleStatus, newViolations, runningViolations, newGoods } = await checkRules(
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
            console.log("ST10: ruleViolations:", [...newViolations, ...runningViolations]);
            console.log("ST11: newGoods:", newGoods);
            const ruleViolations = updatedRuleStatus;

            //update trip ruleStatus for Rule violations
            if (ruleViolations) {
                //console.log("ST05: ruleViolations:", Object.keys(ruleViolations).length, "Keys-", Object.keys(ruleViolations));
                Object.keys(ruleViolations).forEach(rule => {
                    console.log("ST12: Rule:", rule, "status:", ruleViolations[rule]);
                });
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

            // Check trip status
            const { tripStage: newTripStage, activeStatus: newActiveStatus }
                = await tripStatusChecker({ ...trip }, locationChange, { newViolations, runningViolations, newGoods });
            console.log("ST13: Trip Status Checker:", trip.tripStage, "->", newTripStage, "New active status:", trip.activeStatus, "->", newActiveStatus);
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
                //perform other trip completion tasks
            }

            // Check fuel status
            console.log("ST14: Fuel status update time:", trip.fuelStatusUpdateTime, "TYP time:", truckPoint.dt_tracker, "TP Level:", truckPoint.fuelLevel, "New Trip Stage:", newTripStage);
            if (truckPoint.fuelLevel && (!trip.fuelStatusUpdateTime ||
                moment(currentTime).diff(moment(trip.fuelStatusUpdateTime), 'hours') >= 1 || newTripStage === 'Completed')) {
                try {
                    const fuelData = await getFuel({
                        timeFrom: trip.actualStartTime,
                        timeTo: currentTime,
                        imei: trip.deviceImei,
                        user_id: trip.iLogistekUserId
                    });
                    console.log("ST15: Fuel data:", Object.keys(fuelData).length, "Keys-", Object.keys(fuelData));
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
                        updates.currentFuelLevel = truckPoint.fuelLevel;//fuelData.endVol;
                    }
                } catch (err) {
                    console.error(`Error updating fuel data for trip ${trip.tripName}:`, err);
                }
            }

            // Update trip record
            console.log("ST16: Going to update trip record", trip.tripName);
            await updateTripRecord(trip, updates);
        }

        // Process next trip
        mainLoop();

    } catch (err) {
        console.error('Error in mainLoop:', err);
        mainLoop(); // Continue with next trip despite error
    }
}

async function tripStatusChecker(trip, locationChange = {}, complianceStatus = {}) {
    try {
        const { newViolations = [], runningViolations = [] } = complianceStatus;
        const violations = [...newViolations, ...runningViolations];
        const {
            deviceImei, tripStage = 'Planned', activeStatus = 'Inactive',
            route, plannedStartTime, currentSignificantLocation, movementStatus
        } = trip;
        let tripStageResult = tripStage;
        let activeStatusResult = activeStatus;
        const currentTime = new Date().toUTCString();
        const { entry, exit, viaSwitch } = locationChange;
        // Get current location type and name
        const locationType = currentSignificantLocation?.locationType;
        const locationName = currentSignificantLocation?.locationName;

        // Calculate dwell time if truck is in a significant location
        const dwellTime = currentSignificantLocation ? currentSignificantLocation.entryTime ?
            moment().diff(moment(currentSignificantLocation.entryTime), 'minutes') : 0 : 0;

        //Get location & running based status
        const locStatus = getLocationBasedStatus(locationType, locationName, route, dwellTime, locationChange);
        const runningStatus = getRunningStatus(violations, movementStatus, locationChange);
        console.log("ST13a: Trip Status Checker: Current tripStage:", tripStage, "CurrentactiveStatus:", activeStatus);
        if (locationType) {
            console.log("ST13a: Trip Status Checker: locationType:", locationType, "Name:", locationName, "dwellTime:", dwellTime);
        }
        console.log("ST13a: Trip Status Checker: locStatus:", locStatus, "runningStatus:", runningStatus);
        //Handle planned trips
        if (tripStage === 'Planned') {
            if (entry === 'startLocation') {
                await redis.sAdd('activeTripImeis', deviceImei);
                console.log("ST13b: Trip Status Checker: Planned trip reached start location", trip.tripName);
                tripStageResult = 'Active';
                activeStatusResult = 'Reached Start Location';
            } else {
                //todo: handle cases where the truck has jumped on the route and skipped the start location
                if (currentTime > new Date(plannedStartTime)) {
                    console.log("ST13b: Trip Status Checker: Planned trip start delayed", trip.tripName);
                    tripStageResult = 'Start Delayed';
                    activeStatusResult = 'Inactive';
                }
            }
        }
        // Handle Start Delayed trips
        else if (tripStage === 'Start Delayed') {
            if (entry === 'startLocation') {
                await redis.sAdd('activeTripImeis', deviceImei);
                console.log("ST13c: Trip Status Checker: Start Delayed trip still at start location", trip.tripName);
                tripStageResult = 'Active';
                activeStatusResult = 'Reached Start Location';
            } else {
                //todo: handle cases where the truck has jumped on the route and skipped the start location
                if (currentTime > new Date(plannedStartTime)) {
                    console.log("ST13c: Trip Status Checker: Start Delayed trip still delayed", trip.tripName);
                    tripStageResult = 'Start Delayed';
                    activeStatusResult = 'Inactive';
                }
            }
        }
        // Handle Active trips
        else if (tripStage === 'Active') {
            // Check if truck is at end location and has left
            if (exit === 'endLocation') {
                tripStageResult = 'Completed';
                activeStatusResult = 'Completed';
                // Remove deviceIMEI from activeTrips set in Redis
                await redis.sRem('activeTripImeis', trip.deviceImei);
            } else {
                tripStageResult = 'Active';
                if (locationName && locationType) {
                    activeStatusResult = locStatus;
                } else {
                    activeStatusResult = runningStatus;
                }
            }
            console.log("ST13d: Trip Status Checker: Active trip", trip.tripName, "New Stage:", tripStageResult, "New Active Status:", activeStatusResult);

        }
        else {
            console.log("ST13e: Trip Status Checker: Status is not checked", trip.tripName, "Current Stage:", tripStage, "Current Active Status:", activeStatus);
        }
        return { tripStage: tripStageResult, activeStatus: activeStatusResult };

    } catch (error) {
        console.error('Error in tripStatusChecker:', error);
        return { tripStage: tripStage, activeStatus: activeStatus };
    }
}

function getLocationBasedStatus(locationType, locationName, route, dwellTime) {
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

function getRunningStatus(violations, movementStatus, locationChange) {
    const { entry } = locationChange;
    if (movementStatus === 'Halted') {
        if (entry) {
            return `Halted At ${entry === 'startLocation' ? 'Start Location' :
                entry === 'endLocation' ? 'End Location' :
                    entry.startsWith('viaLocation') ? `Stop: ${entry.replace('viaLocation ', '')}` : entry}`;
        } else {
            return 'Halted';
        }
    } else if (violations.includes('routeViolationStatus')) {
        return 'Running & Route Violated';
    } else if (entry) {
        return `Movement Inside ${entry === 'startLocation' ? 'Start Location' :
            entry === 'endLocation' ? 'End Location' :
                entry.startsWith('viaLocation') ? `Stop: ${entry.replace('viaLocation ', '')}` : entry}`;
    } else {
        return 'Running On Route';
    }
}

// Start the application
main();

// Helper function to format datetime to IST with specific format
function formatToIST(datetime) {
    return moment(datetime)
        .utcOffset('+05:30')
        .format('DDMMM HH:mm');
}

/*
async function tripStatusChecker(trip, locationChange = {}, complianceStatus = {}) {
    try {
        const { newViolations = [], runningViolations = [] } = complianceStatus;
        const violations = [...newViolations, ...runningViolations];
        const {
            deviceImei, tripStage = 'Planned', activeStatus = 'Inactive',
            route, plannedStartTime, currentSignificantLocation, movementStatus
        } = trip;
        let tripStageResult = tripStage;
        let activeStatusResult = activeStatus;
        const currentTime = new Date().toUTCString();
        const { entry, exit, viaSwitch } = locationChange;
        // Get current location type and name
        const locationType = currentSignificantLocation?.locationType;
        const locationName = currentSignificantLocation?.locationName;

        // Calculate dwell time if truck is in a significant location
        const dwellTime = currentSignificantLocation ? currentSignificantLocation.entryTime ?
            moment().diff(moment(currentSignificantLocation.entryTime), 'minutes') : 0 : 0;

        //Get location & running based status
        const locStatus = getLocationBasedStatus(locationType, locationName, route, dwellTime);
        const runningStatus = getRunningStatus(violations, movementStatus);
        console.log("ST13a: Trip Status Checker: Current tripStage:", tripStage, "CurrentactiveStatus:", activeStatus);
        if (locationType) {
            console.log("ST13a: Trip Status Checker: locationType:", locationType, "Name:", locationName, "dwellTime:", dwellTime);
        }
        console.log("ST13a: Trip Status Checker: locStatus:", locStatus, "runningStatus:", runningStatus);
        //Handle planned trips
        if (tripStage === 'Planned') {
            if (locationName && locationType && locationName === route.startLocation.locationName) {
                await redis.sAdd('activeTripImeis', deviceImei);
                console.log("ST13b: Trip Status Checker: Planned trip reached start location", trip.tripName);
                tripStageResult = 'Active';
                activeStatusResult = 'Reached Start Location';
            } else {
                //todo: handle cases where the truck has jumped on the route and skipped the start location
                if (currentTime > new Date(plannedStartTime)) {
                    console.log("ST13b: Trip Status Checker: Planned trip start delayed", trip.tripName);
                    tripStageResult = 'Start Delayed';
                    activeStatusResult = 'Inactive';
                }
            }
        }
        // Handle Start Delayed trips
        else if (tripStage === 'Start Delayed') {
            if (locationName && locationType && locationName === route.startLocation.locationName) {
                await redis.sAdd('activeTripImeis', deviceImei);
                console.log("ST13c: Trip Status Checker: Start Delayed trip still at start location", trip.tripName);
                tripStageResult = 'Active';
                activeStatusResult = 'Reached Start Location';
            } else {
                //todo: handle cases where the truck has jumped on the route and skipped the start location
                if (currentTime > new Date(plannedStartTime)) {
                    console.log("ST13c: Trip Status Checker: Start Delayed trip still delayed", trip.tripName);
                    tripStageResult = 'Start Delayed';
                    activeStatusResult = 'Inactive';
                }
            }
        }
        // Handle Active trips
        else if (tripStage === 'Active') {
            // Check if truck is at end location and has left
            if (activeStatus.includes('End Location') && !currentSignificantLocation?.locationName === route.endLocation.locationName) {
                tripStageResult = 'Completed';
                activeStatusResult = 'Completed';
                // Remove deviceIMEI from activeTrips set in Redis
                await redis.sRem('activeTripImeis', trip.deviceImei);
            } else {
                tripStageResult = 'Active';
                if (locationName && locationType) {
                    activeStatusResult = locStatus;
                } else {
                    activeStatusResult = runningStatus;
                }
            }
            console.log("ST13d: Trip Status Checker: Active trip", trip.tripName, "New Stage:", tripStageResult, "New Active Status:", activeStatusResult);

        }
        else {
            console.log("ST13e: Trip Status Checker: Status is not checked", trip.tripName, "Current Stage:", tripStage, "Current Active Status:", activeStatus);
        }
        return { tripStage: tripStageResult, activeStatus: activeStatusResult };

    } catch (error) {
        console.error('Error in tripStatusChecker:', error);
        return { tripStage: tripStage, activeStatus: activeStatus };
    }
}
*/