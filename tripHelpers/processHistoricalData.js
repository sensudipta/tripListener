/**
 * processHistoricalData.js
 * 
 * This module handles processing of historical trip data in chunks.
 * It retrieves historical path data, splits it into manageable chunks,
 * and processes each chunk sequentially while maintaining state.
 */

const axios = require('axios');
const moment = require('moment');
const config = require('../config');
const { tripLogger } = require('./logger');
const { getDistance } = require('./distanceCalculator');

/**
 * Process historical trip data in chunks
 * 
 * @param {Object} trip - The trip object
 * @param {Date} startTime - The start time for historical data
 * @param {Date} endTime - The end time for historical data (defaults to current time)
 * @param {Number} chunkSizeMinutes - Size of each chunk in minutes (default: 5)
 * @returns {Object} - Updated trip object with processed historical data
 */
async function processHistoricalData(trip, startTime, endTime = new Date(), chunkSizeMinutes = 5) {
    try {
        tripLogger(trip, `#FN:HistProc: Starting historical data processing from ${startTime} to ${endTime}`);

        // Retrieve historical path data
        const pathData = await retrieveHistoricalPathData(trip.deviceImei, startTime, endTime);

        if (!pathData || pathData.length === 0) {
            tripLogger(trip, `#FN:HistProc: No historical data found for the specified period`);
            return trip;
        }

        tripLogger(trip, `#FN:HistProc: Retrieved ${pathData.length} historical points`);

        // Split data into chunks
        const chunks = splitDataIntoChunks(pathData, chunkSizeMinutes);

        tripLogger(trip, `#FN:HistProc: Split data into ${chunks.length} chunks`);

        // Initialize accumulators for events and metrics
        const accumulatedEvents = {
            significantEvents: [],
            significantLocations: [],
            fuelEvents: []
        };

        let updatedTrip = { ...trip };

        // Process each chunk sequentially
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            if (chunk.length === 0) continue;

            tripLogger(trip, `#FN:HistProc: Processing chunk ${i + 1}/${chunks.length} with ${chunk.length} points`);

            // Set the "current time" to the timestamp of the last point in the chunk
            const chunkEndTime = new Date(chunk[chunk.length - 1].dt_tracker);

            // Process the chunk
            updatedTrip = await processChunk(updatedTrip, chunk, chunkEndTime, accumulatedEvents);

            tripLogger(trip, `#FN:HistProc: Completed chunk ${i + 1}/${chunks.length}`);
        }

        // Update trip path with all historical points
        updatedTrip.tripPath = pathData.map(point => ({
            type: 'Point',
            coordinates: [point.longitude, point.latitude],
            dt_tracker: new Date(point.dt_tracker),
            gpsRecord: {
                speed: point.speed,
                heading: point.heading || 0,
                acc: point.acc || 0
            }
        }));

        // Calculate final trip metrics
        updatedTrip = calculateFinalTripMetrics(updatedTrip);

        tripLogger(trip, `#FN:HistProc: Historical data processing complete`);

        return updatedTrip;
    } catch (error) {
        tripLogger(trip, `#FN:HistProc: Error processing historical data: ${error.message}`);
        console.error('Error processing historical data:', error);
        return trip;
    }
}

/**
 * Retrieve historical path data from the API
 * 
 * @param {String} deviceImei - The device IMEI
 * @param {Date} startTime - The start time
 * @param {Date} endTime - The end time
 * @returns {Array} - Array of path points
 */
async function retrieveHistoricalPathData(deviceImei, startTime, endTime) {
    try {
        const startTimeStr = moment(startTime).format('YYYY-MM-DD HH:mm:ss');
        const endTimeStr = moment(endTime).format('YYYY-MM-DD HH:mm:ss');

        const response = await axios.get(`${config.apiBaseUrl}/routeRaw`, {
            params: {
                deviceImei,
                startTime: startTimeStr,
                endTime: endTimeStr
            }
        });

        if (response.data && response.data.success && response.data.routeArray) {
            return response.data.routeArray;
        }

        return [];
    } catch (error) {
        console.error('Error retrieving historical path data:', error);
        return [];
    }
}

/**
 * Split data into chunks based on time intervals
 * 
 * @param {Array} data - Array of path points
 * @param {Number} chunkSizeMinutes - Size of each chunk in minutes
 * @returns {Array} - Array of chunks, each containing path points
 */
function splitDataIntoChunks(data, chunkSizeMinutes) {
    if (!data || data.length === 0) return [];

    const chunks = [];
    let currentChunk = [];
    let chunkStartTime = new Date(data[0].dt_tracker);

    for (const point of data) {
        const pointTime = new Date(point.dt_tracker);

        // If point is within the current chunk time window, add it to the chunk
        if (moment(pointTime).diff(moment(chunkStartTime), 'minutes') < chunkSizeMinutes) {
            currentChunk.push(point);
        }
        // Otherwise, start a new chunk
        else {
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
            }
            currentChunk = [point];
            chunkStartTime = pointTime;
        }
    }

    // Add the last chunk if it has points
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}

/**
 * Process a single chunk of historical data
 * 
 * @param {Object} trip - The trip object
 * @param {Array} chunk - Array of path points in the chunk
 * @param {Date} chunkEndTime - The end time of the chunk (used as "current time")
 * @param {Object} accumulatedEvents - Accumulated events from previous chunks
 * @returns {Object} - Updated trip object
 */
async function processChunk(trip, chunk, chunkEndTime, accumulatedEvents) {
    // Convert chunk data to the format expected by tripMaster
    const tripPathChunk = chunk.map(point => ({
        type: 'Point',
        coordinates: [point.longitude, point.latitude],
        dt_tracker: new Date(point.dt_tracker),
        gpsRecord: {
            speed: point.speed,
            heading: point.heading || 0,
            acc: point.acc || 0
        }
    }));

    // Create a copy of the trip with only the current chunk in tripPath
    const chunkTrip = {
        ...trip,
        tripPath: tripPathChunk,
        // Use accumulated events from previous chunks
        significantEvents: [...accumulatedEvents.significantEvents],
        significantLocations: [...accumulatedEvents.significantLocations],
        fuelEvents: [...accumulatedEvents.fuelEvents]
    };

    // Import the processing functions
    const movementChecker = require('./movementChecker');
    const routeChecker = require('./routeChecker');
    const locationChecker = require('./locationChecker');
    const segmentChecker = require('./segmentChecker');
    const statusChecker = require('./statusChecker');
    const ruleChecker = require('./ruleChecker');
    const fuelChecker = require('./fuelChecker');

    // Get the last point in the chunk to use as the "current point"
    const lastPoint = tripPathChunk[tripPathChunk.length - 1];
    const truckPoint = {
        lat: lastPoint.coordinates[1],
        lng: lastPoint.coordinates[0],
        dt_tracker: lastPoint.dt_tracker,
        speed: lastPoint.gpsRecord.speed,
        heading: lastPoint.gpsRecord.heading
    };

    // Process the chunk with each checker, using chunkEndTime as the "current time"

    // 1. Movement Status Processing
    const movementStatus = movementChecker.checkMovementStatus(chunkTrip, truckPoint, chunkEndTime);
    chunkTrip.movementStatus = movementStatus.movementStatus;
    chunkTrip.currentHaltDuration = movementStatus.currentHaltDuration;
    chunkTrip.haltStartTime = movementStatus.haltStartTime;

    // 2. Route and Segment Processing
    const route = await trip.route;

    // If segments are available, use segment checker
    if (route.segments && route.segments.length > 0) {
        chunkTrip = segmentChecker.processSegmentChanges(chunkTrip, truckPoint, route);
    }
    // Otherwise, fall back to route checker
    else {
        const routeProgress = routeChecker.checkRoute(truckPoint, route.routePath);
        chunkTrip.nearestPointIndex = routeProgress.nearestPointIndex;
        chunkTrip.distanceCovered = routeProgress.distanceCovered;
        chunkTrip.distanceRemaining = routeProgress.distanceRemaining;
        chunkTrip.completionPercentage = routeProgress.completionPercentage;
        chunkTrip.estimatedTimeOfArrival = routeProgress.estimatedTimeOfArrival;
    }

    // 3. Location Processing
    const locationResult = locationChecker.checkLocations(chunkTrip, truckPoint, route);
    if (locationResult.locEntry || locationResult.locExit) {
        // Update significant locations
        if (locationResult.locEntry) {
            chunkTrip.currentSignificantLocation = locationResult.locEntry;
            chunkTrip.significantLocations.push(locationResult.locEntry);
        }
        if (locationResult.locExit) {
            chunkTrip.currentSignificantLocation = null;
            // Update the exit time in the last matching location
            const lastIndex = chunkTrip.significantLocations.length - 1;
            if (lastIndex >= 0 &&
                chunkTrip.significantLocations[lastIndex].locationName === locationResult.locExit.locationName) {
                chunkTrip.significantLocations[lastIndex].exitTime = locationResult.locExit.exitTime;
                chunkTrip.significantLocations[lastIndex].dwellTime = locationResult.locExit.dwellTime;
            }
        }
    }

    // 4. Rule Compliance Processing
    const complianceStatus = ruleChecker.checkRules(chunkTrip, truckPoint, route, chunkEndTime);

    // 5. Trip Status Update
    const statusResult = await statusChecker({
        trip: chunkTrip,
        currentSignificantLocation: chunkTrip.currentSignificantLocation,
        movementStatus: chunkTrip.movementStatus,
        complianceStatus
    });

    chunkTrip.tripStage = statusResult.tripStage;
    chunkTrip.activeStatus = statusResult.activeStatus;

    // 6. Fuel Status Update
    const fuelResult = await fuelChecker.checkFuel(chunkTrip, truckPoint, chunk[0].dt_tracker, chunkEndTime);
    if (fuelResult) {
        chunkTrip.currentFuelLevel = fuelResult.currentFuelLevel;
        chunkTrip.fuelConsumption = fuelResult.fuelConsumption;
        chunkTrip.fuelEfficiency = fuelResult.fuelEfficiency;
        chunkTrip.fuelStatusUpdateTime = fuelResult.fuelStatusUpdateTime;

        // Add any new fuel events
        if (fuelResult.newFuelEvents && fuelResult.newFuelEvents.length > 0) {
            chunkTrip.fuelEvents = [...chunkTrip.fuelEvents, ...fuelResult.newFuelEvents];
        }
    }

    // Update accumulated events
    accumulatedEvents.significantEvents = chunkTrip.significantEvents;
    accumulatedEvents.significantLocations = chunkTrip.significantLocations;
    accumulatedEvents.fuelEvents = chunkTrip.fuelEvents;

    return chunkTrip;
}

/**
 * Calculate final trip metrics after processing all chunks
 * 
 * @param {Object} trip - The trip object with processed data
 * @returns {Object} - Trip object with updated metrics
 */
function calculateFinalTripMetrics(trip) {
    // Calculate total distance covered
    let totalDistance = 0;
    const path = trip.tripPath;

    for (let i = 1; i < path.length; i++) {
        const prevPoint = path[i - 1];
        const currPoint = path[i];

        const distance = getDistance(
            prevPoint.coordinates[1], prevPoint.coordinates[0],
            currPoint.coordinates[1], currPoint.coordinates[0]
        );

        totalDistance += distance;
    }

    // Calculate average speed
    const startTime = trip.actualStartTime || trip.tripPath[0].dt_tracker;
    const endTime = trip.actualEndTime || trip.tripPath[trip.tripPath.length - 1].dt_tracker;
    const tripDurationHours = moment(endTime).diff(moment(startTime), 'hours', true);

    const averageSpeed = tripDurationHours > 0 ? totalDistance / tripDurationHours : 0;

    // Find top speed
    const topSpeed = Math.max(...path.map(p => p.gpsRecord.speed));

    // Update trip metrics
    trip.truckRunDistance = totalDistance;
    trip.averageSpeed = averageSpeed;
    trip.topSpeed = topSpeed;
    trip.runDuration = moment(endTime).diff(moment(startTime), 'minutes');

    return trip;
}

module.exports = {
    processHistoricalData,
    retrieveHistoricalPathData,
    splitDataIntoChunks
}; 