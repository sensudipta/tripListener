const mongoose = require('mongoose');
const moment = require('moment');
const liveDB = require('../../common/liveDB');
const { TRIPDB, redis } = liveDB;
const { Route, Trip } = require('../common/models');
const { getLengthBetweenPoints, isPointInPolygon } = require('../../common/helper');

let tripsToProcess = [];
const runTime = moment().format('YYYY-MM-DD HH:mm:ss');
const reverseDrivingConfidenceThreshold = 70;


mongoose.connect(TRIPDB).then(async () => {
    console.log("Connected to TripDB");
    tripsToProcess = await Trip.find({
        tripStage: { $nin: ['Completed', 'Aborted', 'Cancelled'] }
    });
    console.log("Trips to Process", tripsToProcess.length);
    mainLoop();
}).catch((err) => {
    console.log("Error connecting to TripDB", err);
});

async function mainLoop() {
    if (tripsToProcess.length === 0) {
        console.log("all trips processed");
        process.exit(0);
    } else {
        console.log("Pending trips to process", tripsToProcess.length);
        const trip = tripsToProcess.shift();
        const { tripStage } = trip;
        if (tripStage === 'Planned' || tripStage === 'Start Delayed') {
            console.log("Planned trip found, checking start conditions");
            // Check if planned start time has elapsed
            const now = moment();
            const startTime = moment(plannedStartTime);

            if (now.isBefore(startTime)) {
                console.log("Planned start time has not elapsed yet");
                mainLoop();
            } else {
                checkTripStart(trip);
            }
        } else {
            console.log("trip is active, full check");
            fullCheck(trip);
        }
    }
}

async function checkTripStart(trip) {
    const { route, plannedStartTime, tripName, truckRegistrationNumber, deviceImei } = trip;
    const lat = await redis.get(`${deviceImei}:lat`);
    const lng = await redis.get(`${deviceImei}:lng`);
    const fuelLevel = await redis.get(`${deviceImei}:tank_1`);
    const dt_tracker = await redis.get(`${deviceImei}:dt_tracker`);
    const truckPoint = { lat, lng };
    const { startLocation } = route;
    const isInside = checkLocation(startLocation, truckPoint);
    console.log("checking trip start", tripName, truckRegistrationNumber, startLocation.locationName, plannedStartTime);
    if (isInside) {
        console.log("truck is within the location boundary, starting trip");
        startTrip(trip, fuelLevel, truckPoint, dt_tracker);
    } else {
        console.log("truck is outside the location boundary, not starting trip");
        // If trip is already marked as Start Delayed, continue to next trip
        if (trip.tripStage === 'Start Delayed') {
            console.log("Trip already marked as Start Delayed");
            mainLoop();
        } else {
            // Update trip stage to Start Delayed
            console.log("Updating trip stage to Start Delayed", tripName, truckRegistrationNumber);
            await Trip.updateOne(
                { _id: trip._id },
                {
                    $set: {
                        tripStage: 'Start Delayed',
                        lastCheckTime: runTime
                    }
                }
            );
            mainLoop();
        }
    }
}

function checkLocation(location, truckPoint) {
    const { location: coords, locationType, zoneCoordinates, triggerRadius } = location;

    if (locationType === 'Point') {
        const point = {
            lat: coords.coordinates[1],
            lon: coords.coordinates[0]
        };
        const distance = getLengthBetweenPoints(truckPoint, point);
        return distance <= triggerRadius;
    } else {
        return isPointInPolygon(truckPoint, zoneCoordinates);
    }
}

async function startTrip(trip, fuelLevel, truckPoint, dt_tracker) {
    console.log("starting trip", trip.tripName, trip.truckRegistrationNumber);
    try {
        // Add deviceImei to redis active trips set
        await redis.sadd('activeTrips', trip.deviceImei);

        // Get start location details from trip
        const { startLocation } = trip.route;

        // Prepare the update object for MongoDB
        const updateData = {
            $set: {
                actualStartTime: dt_tracker,
                tripStage: 'Active',
                activeStatus: 'Reached Origin',
                lastCheckTime: runTime
            },
            $push: {
                significantLocations: {
                    location: startLocation.location,
                    locationName: startLocation.locationName,
                    locationType: 'startLocation',
                    entryTime: dt_tracker
                },
                significantEvents: {
                    eventType: 'Activated',
                    eventTime: dt_tracker,
                    eventLocation: startLocation.location,
                    locationType: 'startLocation',
                    locationName: startLocation.locationName
                },
                fuelLevels: {
                    level: parseFloat(fuelLevel),
                    type: 'Start',
                    levelRecordTime: dt_tracker,
                    location: {
                        type: 'Point',
                        coordinates: [parseFloat(truckPoint.lng), parseFloat(truckPoint.lat)]
                    }
                }
            }
        };

        // Update the trip document
        await Trip.updateOne(
            { _id: trip._id },
            updateData
        );

        // Continue processing other trips
        mainLoop();
    } catch (err) {
        console.log("Error starting trip", err);
        mainLoop();
    }
}

async function fullCheck(trip) {
    const { route, deviceImei } = trip;
    const lat = await redis.get(`${deviceImei}:lat`);
    const lng = await redis.get(`${deviceImei}:lng`);
    const fuelLevel = await redis.get(`${deviceImei}:tank_1`);
    const dt_tracker = await redis.get(`${deviceImei}:dt_tracker`);
    const truckPoint = { lat, lng, fuelLevel, dt_tracker };
    const updatedTrip = { ...trip };

    const { tripPath, totalDistance, topSpeed, averageSpeed, runDuration, driveStatus } = await getTripPath(trip);
    const movementStatus = trip.movementStatus === 'unknown' ? driveStatus :
        driveStatus === 'unknown' ? trip.movementStatus :
            driveStatus;

    const events = await getDeviceEvents(deviceImei);
    const { nearestPoint, distanceFromTruck, cumulativeDistance, pointIndex } = await getRouteSituation(truckPoint, tripPath, route._id, route.routePath.coordinates);
    const locationStatus = await getImportantLocationEntryExit(trip, route, truckPoint);
    //const { travelDirection, travelDirectionConfidence } = await getTravelDirection(tripPath, route);
    const ruleViolations = await checkRules(trip, speed, distanceFromTruck, movementStatus);
    const detentionStatus = await checkDetentionTime(trip, route, truckPoint);

    // Update trip metrics by combining current values with new data
    updatedTrip.distanceCovered = cumulativeDistance;

    // Calculate new parked duration and actual run time
    let newParkedDuration = trip.parkedDuration || 0;
    if (movementStatus === 'Halted' && pathPoints.length >= 2) {
        // Add time difference between first and last points to parked duration
        const startTime = new Date(pathPoints[0].dt_tracker);
        const endTime = new Date(pathPoints[pathPoints.length - 1].dt_tracker);
        const haltDuration = (endTime - startTime) / (1000 * 60); // Convert to minutes
        newParkedDuration += haltDuration;
    }

    const newActualRunTime = (trip.actualRunTime || 0) + runDuration;
    updatedTrip.parkedDuration = newParkedDuration;
    updatedTrip.actualRunTime = newActualRunTime;

    // Update average speed as weighted average of old and new values
    const oldWeight = trip.actualRunTime || 0;
    const newWeight = runDuration;
    const oldAvgSpeed = trip.averageSpeed || 0;
    updatedTrip.averageSpeed = (oldWeight * oldAvgSpeed + newWeight * averageSpeed) / (oldWeight + newWeight);

    // Update top speed if new value is higher
    updatedTrip.topSpeed = Math.max(trip.topSpeed || 0, topSpeed);

    // Calculate remaining distance and completion percentage
    const distanceRemaining = trip.route.routeLength - updatedTrip.distanceCovered;
    updatedTrip.distanceRemaining = Math.max(0, distanceRemaining); // Ensure it doesn't go negative
    updatedTrip.completionPercentage = Math.min(100, (updatedTrip.distanceCovered / trip.route.routeLength) * 100);

    // Calculate estimated time of arrival based on average speed and remaining distance
    let estimatedTimeOfArrival = null;
    if (updatedTrip.averageSpeed > 0) {
        // Convert remaining distance from meters to kilometers and speed from km/h
        const remainingHours = (updatedTrip.distanceRemaining / 1000) / updatedTrip.averageSpeed;
        estimatedTimeOfArrival = moment().add(remainingHours, 'hours');
        updatedTrip.estimatedTimeOfArrival = estimatedTimeOfArrival.toISOString();
    }

    // Update halt time tracking
    if (movementStatus === 'Halted') {
        if (!trip.haltStartTime) {
            // Set halt start time to first point's timestamp if not already set
            updatedTrip.haltStartTime = pathPoints[0].dt_tracker;
        }
        // Calculate current halt duration in minutes
        updatedTrip.currentHaltDuration = moment().diff(moment(trip.haltStartTime || pathPoints[0].dt_tracker), 'minutes');
    }

    // Handle rule violations and significant events
    if (ruleViolations) {
        const lastPoint = pathPoints[pathPoints.length - 1];
        const eventLocation = {
            type: 'Point',
            coordinates: [lastPoint.lng, lastPoint.lat]
        };
        const eventTime = lastPoint.dt_tracker;

        // Check each rule violation
        Object.entries(ruleViolations).forEach(([rule, status]) => {
            // Convert rule name to event type (e.g. speedStatus -> OverSpeed)
            let eventType;
            switch (rule) {
                case 'speedStatus':
                    eventType = 'OverSpeed';
                    break;
                case 'drivingTimeStatus':
                    eventType = 'Night Driving';
                    break;
                case 'routeViolationStatus':
                    eventType = 'Route Violation';
                    break;
                case 'reverseDrivingStatus':
                    eventType = 'Reverse Driving';
                    break;
                case 'haltTimeStatus':
                    eventType = 'Extended Halt';
                    break;
                default:
                    return; // Skip if not a tracked event type
            }
            // Get event time and location from last point in path
            const lastPoint = pathPoints[pathPoints.length - 1];
            const eventLocation = {
                type: 'Point',
                coordinates: [lastPoint.lng, lastPoint.lat]
            };
            const eventTime = lastPoint.dt_tracker;
            if (status === 'Violated') {
                // Add new violation event
                if (!updatedTrip.significantEvents) {
                    updatedTrip.significantEvents = [];
                }

                updatedTrip.significantEvents.push({
                    eventType,
                    eventTime,
                    eventStartTime: eventTime,
                    eventLocation,
                });

            } else if (status === 'Good') {
                // Find and update existing violation event
                const existingEventIndex = trip.significantEvents?.findIndex(event =>
                    event.eventType === eventType && !event.eventEndTime
                );

                if (existingEventIndex >= 0) {
                    const existingEvent = trip.significantEvents[existingEventIndex];
                    const startTime = new Date(existingEvent.eventStartTime);
                    const endTime = new Date(eventTime);
                    const durationSeconds = Math.floor((endTime - startTime) / 1000);

                    if (!updatedTrip.significantEvents) {
                        updatedTrip.significantEvents = [...trip.significantEvents];
                    }

                    updatedTrip.significantEvents[existingEventIndex] = {
                        ...existingEvent,
                        eventEndTime: eventTime,
                        eventDuration: durationSeconds
                    };
                }
            }
        });
    }

    // Check important location entry/exit status

    if (!updatedTrip.significantLocations) {
        updatedTrip.significantLocations = trip.significantLocations || [];
    }

    // Check start location
    if (locationStatus.startLocation === 'inside') {
        const hasStartLocation = updatedTrip.significantLocations.some(loc =>
            loc.locationType === 'startLocation'
        );

        if (!hasStartLocation) {
            updatedTrip.significantLocations.push({
                location: {
                    type: 'Point',
                    coordinates: [truckPoint.lng, truckPoint.lat]
                },
                locationName: route.startLocation.locationName,
                locationType: 'startLocation',
                entryTime: truckPoint.dt_tracker,
                dwellTime: 0
            });
        }
    }

    // Check end location 
    if (locationStatus.endLocation === 'inside') {
        const hasEndLocation = updatedTrip.significantLocations.some(loc =>
            loc.locationType === 'endLocation'
        );

        if (!hasEndLocation) {
            updatedTrip.significantLocations.push({
                location: {
                    type: 'Point',
                    coordinates: [truckPoint.lng, truckPoint.lat]
                },
                locationName: route.endLocation.locationName,
                locationType: 'endLocation',
                entryTime: truckPoint.dt_tracker,
                dwellTime: 0
            });
        }
    }

    // Check via locations
    locationStatus.viaLocations.forEach(via => {
        if (via.status === 'inside') {
            const hasViaLocation = updatedTrip.significantLocations.some(loc =>
                loc.locationType === 'viaLocation' &&
                loc.locationName === via.locationName
            );

            if (!hasViaLocation) {
                updatedTrip.significantLocations.push({
                    location: {
                        type: 'Point',
                        coordinates: [truckPoint.lng, truckPoint.lat]
                    },
                    locationName: via.locationName,
                    locationType: 'viaLocation',
                    entryTime: truckPoint.dt_tracker,
                    dwellTime: 0
                });
            }
        }
    });
    // Check for exit from start location
    if (locationStatus.startLocation === 'outside') {
        const startLocationIndex = updatedTrip.significantLocations.findIndex(loc =>
            loc.locationType === 'startLocation' &&
            loc.entryTime &&
            !loc.exitTime
        );

        if (startLocationIndex !== -1) {
            const entryTime = new Date(updatedTrip.significantLocations[startLocationIndex].entryTime);
            const exitTime = new Date(truckPoint.dt_tracker);
            updatedTrip.significantLocations[startLocationIndex].exitTime = truckPoint.dt_tracker;
            updatedTrip.significantLocations[startLocationIndex].dwellTime = Math.floor((exitTime - entryTime) / 1000);
        }
    }

    // Check for exit from end location
    if (locationStatus.endLocation === 'outside') {
        const endLocationIndex = updatedTrip.significantLocations.findIndex(loc =>
            loc.locationType === 'endLocation' &&
            loc.entryTime &&
            !loc.exitTime
        );

        if (endLocationIndex !== -1) {
            const entryTime = new Date(updatedTrip.significantLocations[endLocationIndex].entryTime);
            const exitTime = new Date(truckPoint.dt_tracker);
            updatedTrip.significantLocations[endLocationIndex].exitTime = truckPoint.dt_tracker;
            updatedTrip.significantLocations[endLocationIndex].dwellTime = Math.floor((exitTime - entryTime) / 1000);
        }
    }

    // Check for exit from via locations
    locationStatus.viaLocations.forEach(via => {
        if (via.status === 'outside') {
            const viaLocationIndex = updatedTrip.significantLocations.findIndex(loc =>
                loc.locationType === 'viaLocation' &&
                loc.locationName === via.locationName &&
                loc.entryTime &&
                !loc.exitTime
            );

            if (viaLocationIndex !== -1) {
                const entryTime = new Date(updatedTrip.significantLocations[viaLocationIndex].entryTime);
                const exitTime = new Date(truckPoint.dt_tracker);
                updatedTrip.significantLocations[viaLocationIndex].exitTime = truckPoint.dt_tracker;
                updatedTrip.significantLocations[viaLocationIndex].dwellTime = Math.floor((exitTime - entryTime) / 1000);
            }
        }
    });

}


async function getTripPath(trip) {
    const { deviceImei } = trip;

    try {
        // Get all records from the Redis list
        const rawPathData = await redis.lrange(`${deviceImei}:rawTripPath`, 0, -1);

        // Clear the list after reading
        await redis.del(`${deviceImei}:rawTripPath`);

        // Parse the JSON strings into objects
        const pathPoints = rawPathData?.length ? rawPathData.map(point => JSON.parse(point))
            .sort((a, b) => new Date(a.dt_tracker) - new Date(b.dt_tracker)) : [];
        // Calculate total distance covered from path points

        // Calculate speed metrics
        let topSpeed = 0;
        let totalValidSpeed = 0;
        let validSpeedPoints = 0;
        let totalDistance = 0;
        let runDuration = 0;
        // Calculate speeds only between valid points (acc=1 and speed>2)
        for (let i = 1; i < pathPoints.length; i++) {
            const prevPoint = pathPoints[i - 1];
            const currentPoint = pathPoints[i];

            if (prevPoint.acc === 1 && currentPoint.acc === 1 &&
                prevPoint.speed > 2 && currentPoint.speed > 2) {

                // Track top speed
                topSpeed = Math.max(topSpeed, prevPoint.speed, currentPoint.speed);

                // Add to average calculation
                totalValidSpeed += (prevPoint.speed + currentPoint.speed) / 2;
                validSpeedPoints++;

                // Calculate distance between points
                const p1 = {
                    latitude: prevPoint.lat,
                    longitude: prevPoint.lng
                };
                const p2 = {
                    latitude: currentPoint.lat,
                    longitude: currentPoint.lng
                };
                totalDistance += getLengthBetweenPoints(p1, p2);
                runDuration += (new Date(currentPoint.dt_tracker) - new Date(prevPoint.dt_tracker)) / 1000;
            }
        }

        // Calculate average speed
        const averageSpeed = validSpeedPoints > 0 ? totalValidSpeed / validSpeedPoints : 0;

        // Add speed metrics to pathPoints object
        topSpeed = Math.round(topSpeed);
        averageSpeed = Math.round(averageSpeed);
        totalDistance = totalDistance;
        runDuration = runDuration;

        // Detect halted or driving status
        let driveStatus = 'Unknown';
        const firstPoint = pathPoints[0];
        const lastPoint = pathPoints[pathPoints.length - 1];

        if (firstPoint && lastPoint) {
            const allPointsHighSpeed = pathPoints.every(point => point.speed > 2);

            if (firstPoint.acc === 0 && lastPoint.acc === 0 && !allPointsHighSpeed) {
                driveStatus = 'Halted';
            } else if (firstPoint.acc === 1 && lastPoint.acc === 1 && allPointsHighSpeed) {
                driveStatus = 'Driving';
            }
        }

        return { tripPath: pathPoints, totalDistance, topSpeed, averageSpeed, runDuration, driveStatus };
    } catch (err) {
        console.log("Error getting trip path", err);
        return { tripPath: [], totalDistance: 0, topSpeed: 0, averageSpeed: 0, runDuration: 0, driveStatus: 'Unknown' };
    }
}

async function getDeviceEvents(deviceImei) {
    try {
        const events = await redis.lrange(`${deviceImei}:events`, 0, -1);
        return events?.length ? events : [];
    } catch (err) {
        console.log("Error getting device events", err);
        return [];
    }
}

async function getRouteSituation(truckPoint, tripPath, routeid, routePath) {
    try {
        // Convert truck point to GeoJSON format
        const truckGeoJSON = {
            type: 'Point',
            coordinates: [parseFloat(truckPoint.lng), parseFloat(truckPoint.lat)]
        };

        // Get nearest point, its distance, and find its position in route coordinates
        const result = await TRIPDB.collection('routes').aggregate([
            {
                $match: { _id: routeid }
            },
            {
                $project: {
                    routePath: 1,
                    nearestPointData: {
                        $nearestPoint: {
                            point: truckGeoJSON,
                            line: "$routePath",
                            distanceField: "distance"
                        }
                    }
                }
            },
            {
                $addFields: {
                    pointIndex: {
                        $indexOfArray: ["$routePath.coordinates", "$nearestPointData.coordinates"]
                    }
                }
            }
        ]).toArray();

        if (!result.length) {
            throw new Error('Route not found');
        }

        const { coordinates, distance, pointIndex } = result[0].nearestPointData;

        // Calculate cumulative distance up to nearest point
        let cumulativeDistance = 0;

        // Sum distances between consecutive points up to the nearest point
        for (let i = 0; i < pointIndex; i++) {
            const point1 = {
                lat: routePath[i][1],
                lng: routePath[i][0]
            };
            const point2 = {
                lat: routePath[i + 1][1],
                lng: routePath[i + 1][0]
            };
            cumulativeDistance += getLengthBetweenPoints(point1, point2);
        }
        // Calculate average deviation from route
        let totalDeviation = 0;
        let pointCount = 0;

        // For each point in tripPath, find nearest point on routePath
        for (const pathPoint of tripPath) {
            let minDistance = Infinity;

            // Compare with each point in routePath
            for (let i = 0; i < routePath.length; i++) {
                const routePoint = {
                    lat: routePath[i][1],
                    lng: routePath[i][0]
                };
                const tripPoint = {
                    lat: pathPoint.lat,
                    lng: pathPoint.lng
                };

                const distance = getLengthBetweenPoints(tripPoint, routePoint);
                minDistance = Math.min(minDistance, distance);
            }

            totalDeviation += minDistance;
            pointCount++;
        }

        const averageDeviation = pointCount > 0 ? totalDeviation / pointCount : 0;
        return {
            nearestPoint: {
                lat: coordinates[1],
                lng: coordinates[0]
            },
            distanceFromTruck: averageDeviation,
            cumulativeDistance,
            pointIndex  // Including this might be useful for debugging or other purposes
        };

    } catch (err) {
        console.log("Error getting route situation:", err);
        return null;
    }
}

async function getImportantLocationEntryExit(trip, route, truckPoint) {
    const { deviceImei } = trip;
    const { startLocation, endLocation, viaLocations } = route;

    // Helper function to check location status
    const checkLocation = (location) => {
        const { location: coords, locationType, zoneCoordinates, triggerRadius } = location;

        if (locationType === 'Point') {
            const point = {
                lat: coords.coordinates[1],
                lon: coords.coordinates[0]
            };
            const distance = getLengthBetweenPoints(truckPoint, point);
            return distance <= triggerRadius ? 'inside' : 'outside';
        } else {
            return isPointInPolygon(truckPoint, zoneCoordinates) ? 'inside' : 'outside';
        }
    };

    // Check start and end locations
    const result = {
        startLocation: checkLocation(startLocation),
        endLocation: checkLocation(endLocation),
        viaLocations: []
    };

    // Check each via location
    if (viaLocations && viaLocations.length > 0) {
        result.viaLocations = viaLocations.map(via => ({
            locationName: via.locationName,
            status: checkLocation(via)
        }));
    }

    return result;
}

async function getTravelDirection(pathPoints, route) {
    try {
        if (!pathPoints || pathPoints.length < 2) {
            return { travelDirection: 'unknown', travelDirectionConfidence: 0 };
        }

        if (!route?.routePath?.coordinates) {
            return { travelDirection: 'unknown', travelDirectionConfidence: 0 };
        }

        // Function to find nearest point index in route
        const findNearestPointIndex = (point, routeCoords) => {
            let minDistance = Infinity;
            let nearestIndex = 0;

            for (let i = 0; i < routeCoords.length; i++) {
                const routePoint = {
                    lat: routeCoords[i][1],
                    lng: routeCoords[i][0]
                };
                const distance = getLengthBetweenPoints(point, routePoint);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestIndex = i;
                }
            }
            return nearestIndex;
        };

        // Get indices for first and last points
        const firstPoint = { lat: pathPoints[0].lat, lng: pathPoints[0].lng };
        const lastPoint = { lat: pathPoints[pathPoints.length - 1].lat, lng: pathPoints[pathPoints.length - 1].lng };

        const firstIndex = findNearestPointIndex(firstPoint, route.routePath.coordinates);
        const lastIndex = findNearestPointIndex(lastPoint, route.routePath.coordinates);
        const indexDifference = lastIndex - firstIndex;

        // Calculate confidence by checking points in between
        let consistentPoints = 0;
        let previousIndex = firstIndex;

        // Check every third point to reduce computation while maintaining accuracy
        for (let i = 1; i < pathPoints.length - 1; i += 3) {
            const point = {
                lat: pathPoints[i].lat,
                lng: pathPoints[i].lng
            };
            const currentIndex = findNearestPointIndex(point, route.routePath.coordinates);

            if ((indexDifference > 0 && currentIndex > previousIndex) ||
                (indexDifference < 0 && currentIndex < previousIndex)) {
                consistentPoints++;
            }
            previousIndex = currentIndex;
        }

        const pointsChecked = Math.floor((pathPoints.length - 2) / 3) + 1;
        const confidence = (consistentPoints / pointsChecked) * 100;

        return {
            travelDirection: indexDifference > 0 ? 'forward' : indexDifference < 0 ? 'reverse' : 'stationary',
            travelDirectionConfidence: Math.round(confidence)
        };
    } catch (err) {
        console.log("Error determining travel direction:", err);
        return { travelDirection: 'unknown', travelDirectionConfidence: 0 };
    }
}

async function checkRules(trip, speed, distanceFromTruck, movementStatus) {
    const { rules } = trip;
    const { drivingStartTime, drivingEndTime, speedLimit, maxHaltTime, routeViolationThreshold, reverseDrivingThreshold } = rules;
    const { drivingTimeStatus, speedStatus, haltTimeStatus, routeViolationStatus, reverseDrivingStatus } = rules;



    // Initialize status object to hold any changes
    const statusUpdates = {};

    // Check driving time rules
    const currentHour = moment().hour();
    if (currentHour < drivingStartTime || currentHour > drivingEndTime) {
        if (movementStatus === 'Driving' && drivingTimeStatus !== 'Violated') {
            statusUpdates.drivingTimeStatus = 'Violated';
        }
    } else if (drivingTimeStatus === 'Violated') {
        statusUpdates.drivingTimeStatus = 'Good';
    }

    // Check speed rules
    if (speed > speedLimit) {
        if (speedStatus !== 'Violated') {
            statusUpdates.speedStatus = 'Violated';
        }
    } else if (speedStatus === 'Violated') {
        statusUpdates.speedStatus = 'Good';
    }

    // Check halt time rules
    if (movementStatus === 'Halted') {
        const lastMovement = trip.haltStartTime ? moment(trip.haltStartTime) : moment();
        const haltDuration = moment().diff(lastMovement, 'minutes');

        if (haltDuration > maxHaltTime && haltTimeStatus !== 'Violated') {
            statusUpdates.haltTimeStatus = 'Violated';
        }
    } else if (haltTimeStatus === 'Violated') {
        statusUpdates.haltTimeStatus = 'Good';
    }

    // Check route violation rules
    if (distanceFromTruck > routeViolationThreshold) {
        if (routeViolationStatus !== 'Violated') {
            statusUpdates.routeViolationStatus = 'Violated';
        }
    } else if (routeViolationStatus === 'Violated') {
        statusUpdates.routeViolationStatus = 'Good';
    }

    // Check reverse driving rules - add code to check if the reverse driving distance is greater than the reverse driving threshold
    if (trip.travelDirection === 'reverse' &&
        trip.travelDirectionConfidence > reverseDrivingConfidenceThreshold) {
        if (reverseDrivingStatus !== 'Violated') {
            statusUpdates.reverseDrivingStatus = 'Violated';
        }
    } else if (reverseDrivingStatus === 'Violated') {
        statusUpdates.reverseDrivingStatus = 'Good';
    }

    return Object.keys(statusUpdates).length ? statusUpdates : null;
}

async function checkDetentionTime(trip, route, truckPoint) {

    // Initialize status object for detention violations
    const detentionStatus = {
        violations: [],
        updates: []
    };

    // Check each significant location
    trip.significantLocations.forEach((sigLoc, index) => {
        let routeLoc;
        switch (sigLoc.locationType) {
            case 'startLocation':
                routeLoc = route.startLocation;
                break;
            case 'endLocation':
                routeLoc = route.endLocation;
                break;
            case 'viaLocation':
                routeLoc = route.viaLocations.find(via => via.locationName === sigLoc.locationName);
                break;
        }

        if (routeLoc) {
            const result = checkLocationDetention(sigLoc, routeLoc, truckPoint);
            if (result) {
                if (result.violation) {
                    detentionStatus.violations.push(result.violation);
                }
                if (result.update) {
                    detentionStatus.updates.push({
                        index,
                        ...result.update
                    });
                }
            }
        }
    });

    return detentionStatus;
}

// Helper function to check detention time for a location
const checkLocationDetention = (significantLoc, routeLoc, truckPoint) => {
    if (!significantLoc.entryTime) return null;

    const currentDwellTime = significantLoc.dwellTime || 0;
    const isInside = checkLocation(routeLoc, truckPoint);

    if (isInside === 'inside') {
        // Calculate new dwell time in minutes
        const newDwellTime = Math.floor(
            (Date.now() - new Date(significantLoc.entryTime).getTime()) / (1000 * 60)
        );

        // Check if max detention time is exceeded
        if (newDwellTime > routeLoc.maxDetentionTime) {
            return {
                violation: {
                    locationName: routeLoc.locationName,
                    locationType: significantLoc.locationType,
                    maxDetentionTime: routeLoc.maxDetentionTime,
                    currentDwellTime: newDwellTime
                },
                update: {
                    dwellTime: newDwellTime
                }
            };
        }

        // Just update dwell time if changed
        if (newDwellTime !== currentDwellTime) {
            return {
                update: {
                    dwellTime: newDwellTime
                }
            };
        }
    }

    return null;
};