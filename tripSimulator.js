const mongoose = require('mongoose');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { Trip } = require('./models');
const getRouteSituation = require('./tripHelpers/routeChecker');
const tripStatusChecker = require('./tripHelpers/statusChecker');
const checkRules = require('./tripHelpers/checkRules');
const locationChecker = require('./tripHelpers/locationCheker');
const { formatToIST, consoleDate, shortDate } = require('./tripHelpers/dateFormatter');
const { calculatePathDistance, parseRouteType } = require('./tripHelpers/helpers');
const { TRIPDB, redisClient } = require('./common/liveDB');
const { processLogger } = require('./tripHelpers/logger');

async function simulateTrip(originalTripId, options = {}) {
    try {
        // 1. Load original trip
        const originalTrip = await Trip.findById(originalTripId).populate('route');
        if (!originalTrip) {
            throw new Error(`Trip ${originalTripId} not found`);
        }
        const { batchSize = 10, batchDelay = 0 } = options;
        console.log('Starting simulation of trip ' + originalTrip.tripName);

        // Use tripPath instead of truckPoints
        const pointsCount = originalTrip.tripPath ? originalTrip.tripPath.length : 0;
        console.log('Original points to process: ' + pointsCount);

        // Validate the entire tripPath array for null coordinates
        if (originalTrip.tripPath && originalTrip.tripPath.length > 0) {
            console.log("Validating tripPath coordinates...");
            const invalidPoints = originalTrip.tripPath.filter(point => {
                if (!point.coordinates || !Array.isArray(point.coordinates) || point.coordinates.length < 2) {
                    return true;
                }
                const lat = parseFloat(point.coordinates[1]);
                const lng = parseFloat(point.coordinates[0]);
                return isNaN(lat) || isNaN(lng) || lat === null || lng === null;
            });

            if (invalidPoints.length > 0) {
                console.error(`CRITICAL ERROR: Found ${invalidPoints.length} points with invalid coordinates out of ${pointsCount} total points`);
                console.error("First 3 invalid points:", JSON.stringify(invalidPoints.slice(0, 3), null, 2));
                process.exit(1);
            } else {
                console.log("All tripPath coordinates are valid.");
            }
        }

        console.log(`Route: ${originalTrip.route.routeName}`);
        console.log(`Route Length: ${(originalTrip.route.routeLength / 1000).toFixed(2)} km`);
        console.log(`Route Duration: ${originalTrip.route.routeDuration} minutes`);
        console.log(`Start Location: ${originalTrip.route.startLocation?.locationName || 'Unknown'}`);
        console.log(`End Location: ${originalTrip.route.endLocation?.locationName || 'Unknown'}`);
        console.log(`Via Locations: ${originalTrip.route.viaLocations?.map(loc => loc.locationName).join(', ') || 'None'}`);

        // Add check for routePath points
        const routePathPointsCount = originalTrip.route.routePath?.coordinates?.length || 0;
        console.log(`Route Path Points: ${routePathPointsCount}`);

        if (routePathPointsCount === 0) {
            console.error("CRITICAL ERROR: Route path has zero points. Cannot proceed with simulation.");
            process.exit(1);
        }

        // Parse route type
        const routeType = parseRouteType(originalTrip.route);
        console.log(`Route type determined: ${routeType.type}, Via points: ${routeType.viaPoints}`);


        // Create a new trip object for simulation by copying essential fields from original trip
        let simulatedTrip = {
            // Core identification
            _id: new mongoose.Types.ObjectId(),
            tripName: `SIM_${originalTrip.tripName}`,
            tripId: `SIM_${originalTrip.tripId || new Date().getTime()}`,

            // Vehicle and driver info
            truckRegistrationNumber: originalTrip.truckRegistrationNumber,
            deviceImei: originalTrip.deviceImei,
            driverName: originalTrip.driverName,
            driverPhoneNumber: originalTrip.driverPhoneNumber,

            // User and customer info
            iLogistekUserId: originalTrip.iLogistekUserId,
            customer: originalTrip.customer,
            goodsName: originalTrip.goodsName,
            goodsDescription: originalTrip.goodsDescription,

            // Route and timing
            route: originalTrip.route,
            plannedStartTime: originalTrip.plannedStartTime,

            // Rules and notifications
            rules: originalTrip.rules || {},
            ruleStatus: {},
            notifications: originalTrip.notifications || {},

            // Trip status
            tripPath: [],
            tripStage: 'Planned',
            activeStatus: 'Not Started',
            routeType: routeType.type,
            currentSignificantLocation: null,
            significantEvents: [],
            significantLocations: [],

            // Trip metrics - explicitly reset
            distanceCovered: 0,
            distanceRemaining: originalTrip.route.routeLength / 1000,
            completionPercentage: 0,
            truckRunDistance: 0,
            currentRouteSegment: 'None',

            // Movement metrics
            movementStatus: 'Halted',
            parkedDuration: 0,
            runDuration: 0,
            averageSpeed: 0,
            topSpeed: 0,
            haltStartTime: null,
            currentHaltDuration: 0,

            // Violation counts
            reverseDrivingCount: 0,
            overSpeedCount: 0,
            nightDrivingCount: 0,
            routeViolationCount: 0,
            maxHaltViolationCount: 0
        };

        // Get points from tripPath and ensure they're valid
        const points = originalTrip.tripPath ?
            originalTrip.tripPath.filter(point => {
                if (!point.coordinates || !Array.isArray(point.coordinates) || point.coordinates.length < 2) {
                    return false;
                }
                const lat = parseFloat(point.coordinates[1]);
                const lng = parseFloat(point.coordinates[0]);
                return !isNaN(lat) && !isNaN(lng) && lat !== null && lng !== null;
            }) : [];

        if (points.length === 0) {
            console.error('No valid points found in the trip object');
            throw new Error('No valid points found in the trip object');
        }

        console.log(`Filtered to ${points.length} valid points for processing`);

        const totalPoints = points.length;
        let processedPoints = 0;
        let processingStoppedReason = 'All data processed';

        // Run the simulation

        for (let i = 0; i < totalPoints; i += batchSize) {
            const batch = points.slice(i, i + batchSize);
            simulatedTrip = await processPointBatch(batch, simulatedTrip);
            processedPoints += batch.length;

            // Check if trip is completed
            if (simulatedTrip.tripStage === 'Completed') {
                console.log(`\n[${shortDate(new Date())}] Trip completed - stopping simulation early`);
                processingStoppedReason = 'Trip completed - stopping simulation early';
                break;
            }

            // Add delay between batches if specified
            if (batchDelay > 0) {
                await new Promise(r => setTimeout(r, batchDelay));
            }
        }
        console.log(`Sim Loop done:Processed ${processedPoints} points`);
        // Calculate trip duration
        let tripDuration = 0;
        let tripStartTime = null;
        let tripEndTime = null;

        // Find trip start and end times from significant events
        const activationEvent = simulatedTrip.significantEvents.find(e => e.eventType === 'Trip Activated');
        const completionEvent = simulatedTrip.significantEvents.find(e => e.eventType === 'Trip Completed');

        if (activationEvent) {
            tripStartTime = activationEvent.timestamp;
        }

        if (completionEvent) {
            tripEndTime = completionEvent.timestamp;
        }

        if (tripStartTime && tripEndTime) {
            tripDuration = Math.round((tripEndTime - tripStartTime) / (1000 * 60)); // in minutes
        }

        // Log simulation results
        console.log('\n=== SIMULATION COMPLETED ===');
        console.log(`Processing stopped reason: ${processingStoppedReason}`);
        console.log(`Trip: ${simulatedTrip.tripName}`);
        console.log(`Final Stage: ${simulatedTrip.tripStage}`);
        console.log(`Final Status: ${simulatedTrip.activeStatus}`);
        console.log(`Start Time: ${tripStartTime ? shortDate(tripStartTime) : 'N/A'}`);
        console.log(`End Time: ${tripEndTime ? shortDate(tripEndTime) : 'N/A'}`);
        console.log(`Trip Duration: ${tripDuration} minutes (${tripDuration > 0 && simulatedTrip.route.routeDuration > 0 ? Math.round((tripDuration / simulatedTrip.route.routeDuration) * 100) : 0}% of route duration)`);
        console.log(`Points Processed: ${processedPoints}`);
        console.log(`Distance Covered: ${simulatedTrip.distanceCovered.toFixed(2)} km (${Math.round((simulatedTrip.distanceCovered * 1000 / simulatedTrip.route.routeLength) * 100)}% of route length)`);
        console.log(`Completion Percentage: ${simulatedTrip.completionPercentage.toFixed(2)}%`);
        console.log(`Route Type: ${simulatedTrip.routeType}`);
        console.log(`Current Route Segment: ${simulatedTrip.currentRouteSegment}`);
        console.log(`Significant Events: ${simulatedTrip.significantEvents.length}`);
        console.log(`Significant Locations: ${simulatedTrip.significantLocations?.length || 0}`);

        // Log significant events
        console.log('\n=== SIGNIFICANT EVENTS ===');
        simulatedTrip.significantEvents.forEach((event, index) => {
            console.log(`${index + 1}. ${event.eventType} - ${shortDate(event.timestamp)}`);
        });

        // Save trip object to JSON file
        /*const timestamp = moment().format('YYYYMMDD_HHmmss');
        const filename = `trip_simulation_${originalTripId}_${timestamp}.json`;
        const filePath = path.join(__dirname, filename);

        fs.writeFileSync(filePath, JSON.stringify(simulatedTrip, null, 2));
        console.log(`\nFinal trip object saved to: ${filePath}`);*/

        return simulatedTrip;
    } catch (error) {
        console.error('Error in trip simulation:', error);
        throw error;
    }
}

// The single implementation of processPointBatch
async function processPointBatch(batch, trip) {
    let updatedTrip = { ...trip };
    const pathPoints = [];

    // Debug the first batch to see what's in the raw data
    if (trip.tripPath.length === 0) {
        batch.slice(0, 3).forEach((point, index) => {
            console.log(`Point ${index}:`, JSON.stringify({
                coordinates: point.coordinates,
                dtTracker: point.dtTracker,
                gpsRecord: point.gpsRecord,
                type: point.type
            }));
        });
    }

    for (const point of batch) {
        // Strict validation of point coordinates
        if (!point || !point.coordinates || !Array.isArray(point.coordinates) ||
            point.coordinates.length < 2 ||
            point.coordinates[0] === null || point.coordinates[1] === null) {
            console.warn('Invalid point structure:', JSON.stringify(point));
            continue; // Skip invalid points
        }

        // Extract data with strict validation
        const lat = parseFloat(point.coordinates[1]);
        const lng = parseFloat(point.coordinates[0]);

        if (isNaN(lat) || isNaN(lng)) {
            console.warn('Invalid coordinates in point:', JSON.stringify({
                original: point.coordinates,
                parsed: { lat, lng }
            }));
            continue; // Skip points with invalid coordinates
        }

        // Create truck point with validated coordinates and preserve original timestamp
        const truckPoint = {
            dt_tracker: point.dtTracker || point.dt_tracker || new Date(),
            lat: lat,
            lng: lng,
            speed: point.gpsRecord?.speed || 0,
            heading: point.gpsRecord?.heading || 0,
            acc: point.gpsRecord?.acc || 0
        };

        // Add point to path only if it has valid coordinates
        pathPoints.push({
            lat: truckPoint.lat,
            lng: truckPoint.lng,
            dt: new Date(truckPoint.dt_tracker)
        });

        // Update trip with the current point
        updatedTrip.currentPoint = truckPoint;
    }

    // Check if we have enough valid points to proceed
    if (pathPoints.length < 1) {
        console.error('No valid points found in batch');
        return updatedTrip;
    }

    // Calculate distance for this batch with additional validation
    let totalDistance = 0;
    if (pathPoints.length >= 2) {
        // Ensure all points have valid coordinates before calculating distance
        const validPoints = pathPoints.filter(p =>
            p.lat !== null && p.lng !== null &&
            !isNaN(p.lat) && !isNaN(p.lng)
        );

        if (validPoints.length >= 2) {
            totalDistance = calculatePathDistance(validPoints.map(p => ({
                latitude: p.lat,
                longitude: p.lng
            })));
        } else {
            console.warn(`Not enough valid points for distance calculation: ${validPoints.length} out of ${pathPoints.length}`);
        }
    }

    // Update trip metrics
    updatedTrip.truckRunDistance = (updatedTrip.truckRunDistance || 0) + totalDistance;

    // Add points to trip path with validation
    const validPathPoints = pathPoints.filter(p =>
        p.lat !== null && p.lng !== null &&
        !isNaN(p.lat) && !isNaN(p.lng)
    );

    updatedTrip.tripPath = [...(updatedTrip.tripPath || []), ...validPathPoints];

    // Get route situation with additional validation
    const lastPoint = pathPoints[pathPoints.length - 1];
    if (lastPoint && lastPoint.lat !== null && lastPoint.lng !== null &&
        !isNaN(lastPoint.lat) && !isNaN(lastPoint.lng)) {
        try {
            // Use the actual point timestamp for logging
            const pointTimestamp = lastPoint.dt || new Date();

            const routeSituation = await getRouteSituation(
                updatedTrip._id.toString(),
                {
                    lat: parseFloat(lastPoint.lat),
                    lng: parseFloat(lastPoint.lng)
                },
                updatedTrip.route,
                updatedTrip.currentRouteSegment || 'None',
                updatedTrip.significantLocations || []
            );

            if (routeSituation) {
                // Update route metrics
                updatedTrip.distanceFromTruck = routeSituation.distanceFromTruck || 0;
                updatedTrip.travelDirection = routeSituation.travelDirection || 'forward';
                updatedTrip.reverseTravelDistance = routeSituation.reverseTravelDistance || 0;
                updatedTrip.nearestRoutePoint = routeSituation.nearestRoutePoint || null;
                updatedTrip.nearestPointIndex = routeSituation.nearestPointIndex || 0;

                // Update distance metrics
                updatedTrip.distanceCovered = routeSituation.cumulativeDistance || 0;
                updatedTrip.distanceRemaining = (updatedTrip.route.routeLength / 1000) - (routeSituation.cumulativeDistance || 0);
                updatedTrip.completionPercentage = ((routeSituation.cumulativeDistance || 0) * 1000 / updatedTrip.route.routeLength) * 100;

                // Check if route segment changed
                if (routeSituation.routeSegment && routeSituation.routeSegment !== updatedTrip.currentRouteSegment) {
                    console.log(`\n[${shortDate(pointTimestamp)}] Route segment changed: ${updatedTrip.currentRouteSegment} -> ${routeSituation.routeSegment}`);
                    updatedTrip.currentRouteSegment = routeSituation.routeSegment;
                }
            } else {
                // Fallback: Update distance based on points processed
                const totalDistanceCovered = updatedTrip.truckRunDistance || 0;
                updatedTrip.distanceCovered = totalDistanceCovered;
                updatedTrip.distanceRemaining = (updatedTrip.route.routeLength / 1000) - totalDistanceCovered;
                updatedTrip.completionPercentage = (totalDistanceCovered * 1000 / updatedTrip.route.routeLength) * 100;
            }
        } catch (error) {
            console.error('Error getting route situation:', error);
        }
    }

    // Check for location changes
    const lastPointTimestamp = lastPoint.dt || new Date();
    const locationUpdate = await locationChecker(updatedTrip, lastPoint);

    // Debug location checking
    //console.log(`Processing point at ${shortDate(lastPointTimestamp)}, coordinates: [${lastPoint.lat}, ${lastPoint.lng}]`);

    if (locationUpdate.locationChanged) {
        console.log(`\n[${shortDate(lastPointTimestamp)}] Location changed: ${updatedTrip.currentSignificantLocation?.locationName || 'None'} -> ${locationUpdate.currentSignificantLocation?.locationName || 'None'}`);

        if (locationUpdate.exitedLocation) {
            const dwellTime = locationUpdate.dwellTime ? Math.round(locationUpdate.dwellTime / 60000) : 0;
            console.log(`[${shortDate(lastPointTimestamp)}] Left location: ${locationUpdate.exitedLocation.locationName}, Dwell time: ${dwellTime} min`);
        }

        // Debug significant locations
        console.log(`  - Significant locations before update: ${updatedTrip.significantLocations?.length || 0}`);
        console.log(`  - Location update contains significantLocations: ${locationUpdate.significantLocations ? 'Yes' : 'No'}`);
        if (locationUpdate.significantLocations) {
            console.log(`  - Location update significantLocations length: ${locationUpdate.significantLocations.length}`);
        }

        // Ensure significantLocations is initialized if not present
        if (!updatedTrip.significantLocations) {
            updatedTrip.significantLocations = [];
        }

        // If locationUpdate doesn't contain significantLocations, create it
        if (!locationUpdate.significantLocations) {
            locationUpdate.significantLocations = [...updatedTrip.significantLocations];

            // Add the current location if it's not already in the array
            if (locationUpdate.currentSignificantLocation) {
                const locExists = locationUpdate.significantLocations.some(
                    loc => loc.locationId === locationUpdate.currentSignificantLocation.locationId
                );

                if (!locExists) {
                    locationUpdate.significantLocations.push({
                        ...locationUpdate.currentSignificantLocation,
                        entryTime: lastPointTimestamp,
                        exitTime: null
                    });
                    console.log(`  - Added ${locationUpdate.currentSignificantLocation.locationName} to significant locations`);
                }
            }
        }

        updatedTrip = { ...updatedTrip, ...locationUpdate };

        // Debug after update
        console.log(`  - Significant locations after update: ${updatedTrip.significantLocations?.length || 0}`);
        if (updatedTrip.significantLocations?.length > 0) {
            console.log(`  - Locations: ${updatedTrip.significantLocations.map(l => l.locationName).join(', ')}`);
        }
    }

    // Check trip status
    const statusUpdate = await tripStatusChecker({
        trip: updatedTrip,
        currentSignificantLocation: updatedTrip.currentSignificantLocation,
        movementStatus: updatedTrip.movementStatus || 'Halted',
        complianceStatus: { newViolations: [], runningViolations: [] }
    });

    // Log status changes
    if (statusUpdate.tripStage !== updatedTrip.tripStage) {
        console.log(`\n[${shortDate(lastPointTimestamp)}] Trip Stage changed: ${updatedTrip.tripStage} -> ${statusUpdate.tripStage}`);
    }

    if (statusUpdate.activeStatus !== updatedTrip.activeStatus) {
        console.log(`\n[${shortDate(lastPointTimestamp)}] Active Status changed: ${updatedTrip.activeStatus} -> ${statusUpdate.activeStatus}`);

        // Log progress when status changes
        console.log(`  Progress: ${updatedTrip.completionPercentage.toFixed(1)}%, Distance: ${updatedTrip.distanceCovered.toFixed(1)} km`);
        if (updatedTrip.currentRouteSegment && updatedTrip.currentRouteSegment !== 'None') {
            console.log(`  Route Segment: ${updatedTrip.currentRouteSegment}`);
        }
    }

    // Add significant events
    if (statusUpdate.significantEvents && statusUpdate.significantEvents.length > 0) {
        for (const event of statusUpdate.significantEvents) {
            if (!updatedTrip.significantEvents.some(e => e.eventType === event.eventType && e.timestamp.getTime() === event.timestamp.getTime())) {
                updatedTrip.significantEvents.push(event);
                console.log(`\n[${shortDate(event.timestamp)}] New significant event: ${event.eventType}`);
            }
        }
    }

    // Update trip with status changes
    updatedTrip = { ...updatedTrip, ...statusUpdate };

    return updatedTrip;
}

// Utility function to run simulation
async function runSimulation(tripId, options = {}) {
    try {
        console.log('Starting trip simulation...');
        const simulatedTrip = await simulateTrip(tripId, options);
        console.log('Simulation completed successfully');
        return simulatedTrip;
    } catch (error) {
        console.error('Simulation failed:', error);
        throw error;
    }
}

async function testSimulation() {
    try {
        // Connect to MongoDB
        await mongoose.connect(TRIPDB);
        processLogger("\nConnected to Mongo Database: tripDB");

        // Connect to Redis
        try {
            await redisClient.connect();
            processLogger("Connected to Redis");
            const pong = await redisClient.ping();
            processLogger("Redis ping response:", pong);
        } catch (error) {
            processLogger("Error in Redis Connection:", error);
            process.exit(1);
        }

        // Run simulation with original trip ID
        await runSimulation('6797213094afb8b09511836c', {
            batchSize: 10,     // Number of points to process in each batch
            batchDelay: 0      // Delay between batches (ms)
        });

        // Disconnect from database and Redis
        await redisClient.disconnect();
        processLogger("Disconnected from Redis");

        await mongoose.disconnect();
        processLogger("Disconnected from MongoDB");

    } catch (error) {
        console.error('Test failed:', error);

        // Ensure connections are closed even if there's an error
        try {
            if (redisClient.isOpen) {
                await redisClient.disconnect();
            }
        } catch (e) {
            console.error('Error disconnecting from Redis:', e);
        }

        try {
            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
            }
        } catch (e) {
            console.error('Error disconnecting from MongoDB:', e);
        }
    }
}

testSimulation();

module.exports = {
    simulateTrip,
    runSimulation
};
