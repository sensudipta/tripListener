const mongoose = require('mongoose');
const moment = require('moment');
const { TRIPDB, redisClient } = require('./common/liveDB');
const { Trip } = require('./models');
const { tripLogger, processLogger } = require('./common/helpers/logger');
const { initializeConnections, cleanup } = require('./common/helpers/dbConnector');

// Import all helper functions
const getTripPath = require('./tripHelpers/getLiveTripPath');
const getBackdatedTripPath = require('./tripHelpers/getBackdatedTripPath');
const movementChecker = require('./tripHelpers/movementChecker');
const pathMetricsCalculator = require('./tripHelpers/pathMetricsCalculator');
const locationChecker = require('./tripHelpers/locationChecker');
const segmentChecker = require('./tripHelpers/segmentChecker');
const fuelChecker = require('./tripHelpers/fuelChecker');
const checkRules = require('./tripHelpers/checkRules');
const statusChecker = require('./tripHelpers/statusChecker');
const alertSender = require('./tripHelpers/alertSender');
const updateTripRecord = require('./tripHelpers/dbUpdater');
const finishTrip = require('./tripHelpers/finishTrip');

// Get trip ID from environment variable
const tripId = process.env.TRIP_ID;
if (!tripId) {
    processLogger("No trip ID provided. Exiting.");
    process.exit(1);
}

// Main process function
async function main() {
    try {
        // Initialize connections - CHANGE THIS LINE to create new connections
        await initializeConnections(true);

        // Get trip from database - exclude backdated trips
        const trip = await Trip.findById(tripId).populate('route');
        if (!trip) {
            processLogger(`Trip ${tripId} not found. Exiting.`);
            process.exit(1);
        }

        // Skip if trip is backdated
        if (trip.backDated === true) {
            processLogger(`Trip ${tripId} is marked as backdated. Skipping processing.`);
            process.exit(0);
        }

        // Process based on trip stage
        if (['Planned', 'Start Delayed'].includes(trip.tripStage)) {
            await processPlannedTrip(trip);
        } else if (trip.tripStage === 'Active') {
            await processActiveTrip(trip);
        }

        // Update Redis state
        await updateRedisState(trip, trip.tripStage === 'Active');

        // Cleanup and exit
        await cleanup(false);
        processLogger(`Trip ${tripId} processing completed. Exiting.`);
        process.exit(0);

    } catch (error) {
        processLogger(`Error processing trip ${tripId}:`, error);
        process.exit(1);
    }
}

// Process planned or start delayed trips
async function processPlannedTrip(trip) {
    try {
        // Check if planned start time has elapsed
        if (moment().isBefore(trip.plannedStartTime)) {
            tripLogger(trip, "Planned start time not reached yet");
            return;
        }

        // Get trip path data
        await getTripPath(trip);
        if (!trip.truckPoint) {
            tripLogger(trip, "No path data available");
            return;
        }

        const { truckPoint } = trip;

        // Add an additional check here for dt_tracker
        if (!truckPoint.dt_tracker) {
            tripLogger(trip, `Truck point data is incomplete (missing dt_tracker). Truck point details: ${JSON.stringify(truckPoint)}`);
            return;
        }

        tripLogger(trip, `Processing planned trip. Truck point: ${moment(truckPoint.dt_tracker).format()}`);

        // Check location
        const location = await locationChecker(trip, truckPoint);
        tripLogger(trip, `Location Check: ${location?.currentSignificantLocation?.locationName || 'None'}`);

        // Store original values for comparison
        const originalTripStage = trip.tripStage;
        const originalActiveStatus = trip.activeStatus;

        // Determine trip stage based on location
        const updates = {
            lastCheckTime: new Date()
        };

        if (location.currentSignificantLocation?.locationId === trip.route.startLocation._id) {
            updates.tripStage = 'Active';
            updates.actualStartTime = truckPoint.dt_tracker;
            updates.activeStatus = 'Active';

            // Send activation alert
            const alertEvent = {
                eventType: 'Trip Activation',
                eventText: 'Trip Activated',
                eventTime: truckPoint.dt_tracker
            };
            await alertSender({ ...trip, ...updates }, alertEvent, 'tripStage');
        } else {
            updates.tripStage = 'Start Delayed';
            updates.activeStatus = 'Delayed';

            // Send delay alert if status changed
            if (originalTripStage !== 'Start Delayed') {
                const alertEvent = {
                    eventType: 'Trip Delay',
                    eventText: 'Trip Start Delayed',
                    eventTime: new Date()
                };
                await alertSender({ ...trip, ...updates }, alertEvent, 'tripStage');
            }
        }

        // Update trip record
        await updateTripRecord(trip, updates);
        tripLogger(trip, `Planned trip processing completed. New stage: ${updates.tripStage}`);

    } catch (error) {
        tripLogger(trip, `Error processing planned trip: ${error}`);
        throw error;
    }
}

// Process active trips
async function processActiveTrip(trip) {
    try {
        // Define processing steps
        const steps = [
            { name: 'getTripPath', func: getTripPath },
            { name: 'getBackdatedTripPath', func: getBackdatedTripPath },
            { name: 'movementChecker', func: movementChecker },
            { name: 'pathMetricsCalculator', func: pathMetricsCalculator },
            { name: 'locationChecker', func: locationChecker },
            { name: 'segmentChecker', func: segmentChecker },
            { name: 'fuelChecker', func: fuelChecker },
            { name: 'checkRules', func: checkRules },
            { name: 'statusChecker', func: statusChecker },
            { name: 'alertSender', func: alertSender },
            { name: 'dbUpdater', func: updateTripRecord }
        ];

        let tripData = { ...trip };

        // Execute each step sequentially
        for (const step of steps) {
            try {
                tripLogger(trip, `Starting ${step.name}`);
                tripData = await executeStep(step, tripData);
                tripLogger(trip, `Completed ${step.name}`);
            } catch (error) {
                tripLogger(trip, `Error in ${step.name}: ${error}`);
                throw error;
            }
        }

        // Check if trip needs to be finished
        if (tripData.tripStage === 'Completed') {
            await finishTrip(tripData);
        }

    } catch (error) {
        tripLogger(trip, `Error processing active trip: ${error}`);
        throw error;
    }
}

// Execute a single processing step
async function executeStep(step, tripData) {
    try {
        // Store original values for comparison
        const originalTripStage = tripData.tripStage;
        const originalActiveStatus = tripData.activeStatus;
        const originalRuleStatus = tripData.ruleStatus ? { ...tripData.ruleStatus } : {};

        // Execute the step
        if (step.name === 'alertSender') {
            // Skip the generic alertSender step - we'll handle alerts specifically
            tripLogger(tripData, `Skipping generic alertSender step`);
        } else {
            // Most helper functions modify the tripData object directly and return true/false
            const success = await step.func(tripData);

            if (success === false) {
                tripLogger(tripData, `Warning: ${step.name} returned false, indicating possible failure`);
                // We continue processing despite the warning
            }
        }

        // Send alerts for changes (except after alertSender to avoid duplicates)
        if (step.name !== 'alertSender' && step.name !== 'dbUpdater') {
            await sendAlertsForChanges(
                tripData,
                originalTripStage,
                originalActiveStatus,
                originalRuleStatus
            );
        }

        return tripData;
    } catch (error) {
        tripLogger(tripData, `Error in ${step.name}: ${error}`);
        throw error;
    }
}

/**
 * Send alerts for changes in trip status
 */
async function sendAlertsForChanges(tripData, originalTripStage, originalActiveStatus, originalRuleStatus) {
    const currentTime = new Date();

    // 1. Alert for tripStage changes
    if (originalTripStage !== tripData.tripStage) {
        const event = {
            eventType: 'Trip Stage Update',
            eventText: `Trip stage changed from ${originalTripStage} to ${tripData.tripStage}`,
            eventTime: currentTime
        };
        await alertSender(tripData, event, 'tripStage');
        tripLogger(tripData, `#FN:Alert: Sent alert for trip stage change to ${tripData.tripStage}`);
    }

    // 2. Alert for activeStatus changes
    if (originalActiveStatus !== tripData.activeStatus) {
        const event = {
            eventType: 'Status Update',
            eventText: `Status changed from ${originalActiveStatus} to ${tripData.activeStatus}`,
            eventTime: currentTime
        };
        await alertSender(tripData, event, 'activeStatus');
        tripLogger(tripData, `#FN:Alert: Sent alert for active status change to ${tripData.activeStatus}`);
    }

    // 3 & 4. Alert for rule violations and resolutions
    if (tripData.ruleStatus && originalRuleStatus) {
        for (const [key, value] of Object.entries(tripData.ruleStatus)) {
            // Rule violation
            if (originalRuleStatus[key] !== 'Violated' && value === 'Violated') {
                const event = {
                    eventType: 'Rule Violation',
                    eventText: `${key.replace('Status', '')} rule violated`,
                    eventTime: currentTime
                };
                await alertSender(tripData, event, 'ruleViolation');
                tripLogger(tripData, `#FN:Alert: Sent alert for rule violation: ${key}`);
            }
            // Rule resolution
            else if (originalRuleStatus[key] === 'Violated' && value !== 'Violated') {
                const event = {
                    eventType: 'Rule Resolution',
                    eventText: `${key.replace('Status', '')} rule violation resolved`,
                    eventTime: currentTime
                };
                await alertSender(tripData, event, 'ruleViolation');
                tripLogger(tripData, `#FN:Alert: Sent alert for rule resolution: ${key}`);
            }
        }
    }

    // 5. Alert for trip completion
    if (originalTripStage !== 'Completed' && tripData.tripStage === 'Completed') {
        const event = {
            eventType: 'Trip Completed',
            eventText: `Trip ${tripData.tripId} completed successfully`,
            eventTime: currentTime
        };
        await alertSender(tripData, event, 'tripStage');
        tripLogger(tripData, `#FN:Alert: Sent alert for trip completion`);
    }
}

// Update Redis state for active trips
async function updateRedisState(trip, isActive) {
    try {
        if (isActive) {
            await redisClient.sAdd('activeTripImeis', trip.deviceImei);
            tripLogger(trip, "Added to active trips in Redis");
        } else {
            await redisClient.sRem('activeTripImeis', trip.deviceImei);
            tripLogger(trip, "Removed from active trips in Redis");
        }
    } catch (error) {
        tripLogger(trip, `Error updating Redis state: ${error}`);
        throw error;
    }
}

// Handle process termination
process.on('SIGTERM', () => {
    processLogger("Received SIGTERM, initiating cleanup...");
    cleanup().then(() => process.exit(0));
});

process.on('SIGINT', () => {
    processLogger("Received SIGINT, initiating cleanup...");
    cleanup().then(() => process.exit(0));
});

// Start the process
main();