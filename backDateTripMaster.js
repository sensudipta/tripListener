const mongoose = require('mongoose');
const axios = require('axios');
const moment = require('moment');
const { Trip } = require('./models');
const { tripLogger, processLogger } = require('./common/helpers/logger');

const { initializeConnections, cleanup } = require('./common/helpers/dbConnector');

// Import all helper functions
const getBackdatedTripPath = require('./tripHelpers/getBackdatedTripPath');
const movementChecker = require('./tripHelpers/movementChecker');
const pathMetricsCalculator = require('./tripHelpers/pathMetricsCalculator');
const locationChecker = require('./tripHelpers/locationChecker');
const segmentChecker = require('./tripHelpers/segmentChecker');
const checkRules = require('./tripHelpers/checkRules');
const statusChecker = require('./tripHelpers/statusChecker');
const fuelChecker = require('./tripHelpers/fuelChecker');
const finishTrip = require('./tripHelpers/finishTrip');
const processAlerts = require('./tripHelpers/alertSender');
const updateTripRecord = require('./tripHelpers/dbUpdater');
// Maximum number of days to process for a very old backdated trip
const MAX_DAYS = 5;

// Maximum number of retries for processing a backdated trip
const MAX_RETRIES = 3;

// Get trip ID from environment variable
const tripId = process.env.TRIP_ID || process.argv[2];
if (!tripId) {
    processLogger("No trip ID provided. Exiting.");
    process.exit(1);
}

const CHUNK_SIZE = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Main function to process a backdated trip
 */
async function main() {
    let retryCount = 0;

    while (retryCount < MAX_RETRIES) {
        try {
            // Initialize connections - create new ones if needed
            await initializeConnections(true);

            // Get trip from database
            const trip = await Trip.findById(tripId).populate('route');
            if (!trip) {
                processLogger(`Trip ${tripId} not found. Exiting.`);
                process.exit(1);
            }

            // Process the backdated trip
            await processBackdatedTrip(trip);

            // Cleanup and exit - pass process.env.KEEP_CONNECTION
            await cleanup(!process.env.KEEP_CONNECTION);
            processLogger(`Trip ${tripId} - ${trip.truckRegistrationNumber} backdated processing completed. Exiting.`);
            process.exit(0);

        } catch (error) {
            retryCount++;
            processLogger(`Error processing backdated trip ${tripId} (attempt ${retryCount}/${MAX_RETRIES}): ${error.message}`);

            if (retryCount >= MAX_RETRIES) {
                processLogger(`Max retries reached for trip ${tripId}. Exiting.`);
                process.exit(1);
            }

            // Wait before retrying (exponential backoff)
            const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
            processLogger(`Waiting ${waitTime / 1000}s before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

/**
 * Process a backdated trip
 * @param {Object} trip - The trip object
 */
async function processBackdatedTrip(trip) {
    try {
        // Set a flag to indicate this is a backdated trip
        trip.isBackdatedProcessing = true;

        // Determine time range for GPS data
        const startTime = trip.plannedStartTime || trip.createdAt;
        let endTime = new Date();

        // Calculate maximum allowed end time (start time + MAX_DAYS)
        const maxEndTime = new Date(startTime);
        maxEndTime.setDate(maxEndTime.getDate() + MAX_DAYS);

        // If current time exceeds max allowed time, use max allowed time
        if (endTime > maxEndTime) {
            tripLogger(trip, `End time exceeds maximum allowed range of ${MAX_DAYS} days. Limiting to ${moment(maxEndTime).format()}`);
            endTime = maxEndTime;
        }

        tripLogger(trip, `Processing backdated trip from ${moment(startTime).format()} to ${moment(endTime).format()}`);

        // Fetch all GPS data for the trip
        const gpsData = await getBackdatedTripPath(trip, startTime, endTime);
        if (!gpsData || gpsData.length === 0) {
            tripLogger(trip, "No GPS data available for backdated processing");
            return;
        }

        tripLogger(trip, `Retrieved ${gpsData.length} GPS points for backdated processing`);

        // Split data into 5-minute chunks with minimum point requirements
        const chunks = splitIntoChunks(gpsData, CHUNK_SIZE);
        tripLogger(trip, `Split data into ${chunks.length} chunks for processing`);
        if (chunks.length === 0) {
            tripLogger(trip, "No chunks to process backdated trip. Making it a live trip.");
            await convertToLiveTrip(trip);
            return;
        }

        // Process each chunk sequentially
        let currentTripData = { ...trip.toObject() };
        let isCompleted = false;
        let lastProcessedChunk = null;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            tripLogger(trip, `Processing chunk ${i + 1}/${chunks.length} with ${chunk.length} points`);

            lastProcessedChunk = chunk;

            // Process the chunk
            currentTripData = await processChunk(currentTripData, chunk);

            // Log the state after processing
            logTripState(currentTripData, i + 1, chunks.length);

            // NOW perform the error check after the chunk is fully processed
            if (currentTripData.hasExitedEndLocation === true && currentTripData.tripStage !== 'Completed') {
                tripLogger(currentTripData, `#ERROR: Vehicle exited end location but tripStage is not 'Completed'. Investigate immediately.`);
                throw new Error(`Inconsistent state detected: Vehicle exited end location but tripStage is '${currentTripData.tripStage}'.`);
            }

            // If trip is completed, break the loop
            if (currentTripData.tripStage === 'Completed') {
                tripLogger(currentTripData, `Trip marked as completed during backdated processing at chunk ${i + 1}/${chunks.length}`);
                break;
            }
        }

        // Get the last truck point for fuel processing
        const lastTruckPoint = lastProcessedChunk ? lastProcessedChunk.truckPoint : null;

        if (lastTruckPoint) {
            tripLogger(trip, `Running fuel checker with last truck point from ${moment(lastTruckPoint.dt_tracker).format()}`);
            await fuelChecker(currentTripData, lastTruckPoint);
        } else {
            tripLogger(trip, "No truck point available for fuel checking");
        }

        // Final DB update - this will set backDated to false
        await updateTripRecord(trip, currentTripData);

        // If completed, run final steps
        if (isCompleted) {
            tripLogger(trip, "Running final steps for completed trip");

            // For the final alert, we can use the actual processAlerts function
            // Create a completion event
            const completionEvent = {
                eventType: 'TripCompleted',
                eventText: `Trip completed during backdated processing`,
                eventTime: new Date()
            };

            // Send the final alert using the actual processAlerts function
            try {
                await processAlerts(currentTripData, completionEvent, 'finalReport');
                tripLogger(trip, "Final alert sent for backdated trip");
            } catch (alertError) {
                tripLogger(trip, `Error sending final alert: ${alertError}`);
            }

            await finishTrip(currentTripData);
        }

        tripLogger(trip, "Backdated trip processing completed");

        return currentTripData;
    } catch (error) {
        tripLogger(trip, `Error processing backdated trip: ${error}`);
        throw error;
    }
}

/**
 * Split GPS data into chunks
 * @param {Array} gpsData - Array of GPS points
 * @param {Number} chunkSize - Size of each chunk in milliseconds
 * @returns {Array} - Array of chunks
 */
function splitIntoChunks(gpsData, chunkSize) {
    const chunks = [];
    if (gpsData.length < 4) {
        return chunks;
    }
    let currentChunk = [];
    let chunkStartTime = null;

    for (const point of gpsData) {
        const pointTime = new Date(point.dt_tracker);
        if (!chunkStartTime) {
            chunkStartTime = pointTime;
            currentChunk.push(point);
        } else if (pointTime.getTime() - chunkStartTime.getTime() > chunkSize && currentChunk.length > 1) {
            chunks.push(currentChunk);
            currentChunk = [point];
            chunkStartTime = pointTime;
        } else {
            currentChunk.push(point);
        }
    }

    const lastChunk = currentChunk;
    let lastButOneChunk = chunks && chunks.length > 0 ? chunks[chunks.length - 1] : null;

    //remove the last chunk. we will check and push it back or merge with the previous chunk
    chunks.pop();

    if (lastChunk.length > 0) {
        if (lastChunk.length < 2) {
            //merge with the previous chunk
            lastButOneChunk = [...lastButOneChunk, ...lastChunk];
            chunks.pop();
            chunks.push(lastButOneChunk);
        } else {
            //last chunk has adequate size, push it back
            chunks.push(lastChunk);
        }
    }
    return chunks;
}

/**
 * Process a single chunk of GPS data
 * @param {Object} tripData - Current trip data
 * @param {Object} formattedChunk - Formatted chunk data
 * @returns {Object} - Updated trip data
 */
async function processChunk(tripData, chunkData) {
    if (!chunkData) return tripData;

    try {
        // Initialize tripPath if it doesn't exist
        if (!tripData.tripPath) {
            tripData.tripPath = [];
        }

        // Get the current length of tripPath (this will be our fromIndex)
        const fromIndex = tripData.tripPath.length;

        // Add the new path points to tripPath
        chunkData.forEach(point => {
            tripData.tripPath.push(point);
        });

        // Set the toIndex to the new end of tripPath
        const toIndex = tripData.tripPath.length - 1;

        // Create the pathPoints object with fromIndex and toIndex
        tripData.pathPoints = { fromIndex, toIndex };

        // Define processing steps
        const steps = [
            { name: 'movementChecker', func: movementChecker },
            { name: 'pathMetricsCalculator', func: pathMetricsCalculator },
            { name: 'locationChecker', func: locationChecker },
            { name: 'segmentChecker', func: segmentChecker },
            { name: 'checkRules', func: checkRules },
            { name: 'statusChecker', func: statusChecker }
        ];

        // Execute each step
        for (const step of steps) {
            try {
                // Call the function and check its return value
                const success = await step.func(tripData);

                // If the function returns false, it failed to process
                if (success === false) {
                    throw new Error(`${step.name} processing failed`);
                }
            } catch (error) {
                tripLogger(tripData, `Error in ${step.name}: ${error}`);
                console.error(`Error in ${step.name}:`, error);
                // Kill the process if a step fails
                process.exit(1);
            }
        }

        return tripData;
    } catch (error) {
        tripLogger(tripData, `Error processing chunk: ${error}`);
        console.error(`Error processing chunk:`, error);
        throw error; // Re-throw to stop processing this trip
    }
}

async function convertToLiveTrip(trip) {
    tripLogger(trip, "Converting backdated trip to live trip");
    //first set the trip parameter backDated to false
    trip.backDated = false;
    // Final DB update - this will set backDated to false
    await updateTripRecord(trip, trip);
}


function logTripState(tripData, chunkIndex, totalChunks) {
    const {
        tripStage,
        activeStatus,
        hasExitedEndLocation,
        currentSignificantLocation
    } = tripData;

    tripLogger(tripData, `TRIP STATE after chunk ${chunkIndex}/${totalChunks}:`);
    tripLogger(tripData, `  - tripStage: ${tripStage}`);
    tripLogger(tripData, `  - activeStatus: ${activeStatus}`);
    tripLogger(tripData, `  - hasExitedEndLocation: ${hasExitedEndLocation}`);
    tripLogger(tripData, `  - currentSignificantLocation: ${currentSignificantLocation ? currentSignificantLocation.locationName : 'null'}`);
}

function handleBackdatedAlerts(trip, event, category) {
    // For backdated trips, we only log the alert but don't actually send it
    // except for the final alert which is handled in finishTrip
    tripLogger(trip, `#FN:BackdatedAlerts: Would send ${category} alert for ${event.eventType}: ${event.eventText}`);

    // Return true to indicate "success" without actually sending the alert
    return true;
}

// Replace alertSender with our wrapper in the global scope
// This ensures any code that tries to call alertSender will use our wrapper instead
global.alertSender = handleBackdatedAlerts;

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
