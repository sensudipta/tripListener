const { tripLogger } = require('../common/helpers/logger');
const routeChecker = require('./routeChecker');

/**
 * Process segment progress and updates trip object
 * @param {Object} trip - Trip object to update
 * @returns {boolean} - Success status
 */
function processSegment(trip) {
    try {
        if (!trip.pathPoints || !trip.tripPath) {
            return false;
        }

        // Get the latest point
        const { toIndex } = trip.pathPoints;
        const truckPoint = trip.tripPath[toIndex];

        if (!truckPoint) {
            return false;
        }

        const segments = trip?.route?.segments;
        if (!segments) {
            //No segments found, route is bad.
            return false;
        }

        const currLoc = trip?.currentSignificantLocation?.locationName ?? null;
        const currSegStartLoc = trip?.currentlyActiveSegment?.startLocation?.locationName ?? null;
        const currSegEndLoc = trip?.currentlyActiveSegment?.endLocation?.locationName ?? null;
        const currSegIndex = trip?.currentlyActiveSegmentIndex ?? -1;
        const nextSegStartLoc = segments[currSegIndex + 1]?.startLocation?.locationName ?? null;

        // Check if we've completed all segments in the route
        const allSegmentsCompleted = trip.segmentHistory &&
            trip.segmentHistory.length === trip.route.segments.length &&
            trip.segmentHistory.every(seg => seg.status === 'completed');

        if (currSegIndex === -1 && !allSegmentsCompleted) {
            // No active segment and not all segments completed, start the first one
            startSegment(trip, 0);
        } else {
            // There is an active segment or all segments are completed
            if (currLoc) {
                if (currLoc === currSegStartLoc) {
                    // Vehicle is at segment start
                    updateSegment(trip);
                }
                // Vehicle is at a segment end
                if (currLoc === currSegEndLoc) {
                    // Vehicle is not at segment start, it is at segment end
                    finishSegment(trip);
                }
                // Vehicle is at the start of the next segment
                if (nextSegStartLoc && currLoc === nextSegStartLoc && !allSegmentsCompleted) {
                    // Only start next segment if we haven't completed all segments
                    startSegment(trip, currSegIndex + 1);
                }
            } else {
                // Vehicle is not at a segment terminus, update current segment
                updateSegment(trip);
            }
        }
        return true;
    } catch (err) {
        console.error('Error in processSegment:', err);
        tripLogger(trip, '#FN:SEGCHK: Error processing segment:', err);
        return false;
    }
}

function startSegment(trip, segmentIndex) {
    if (!trip?.route?.segments || !trip?.route?.segments[segmentIndex]) {
        tripLogger(trip, `#FN:SEGCHK: Cannot start segment ${segmentIndex}: segment not found`);
        return;
    }

    const segment = trip.route.segments[segmentIndex];
    const { toIndex } = trip.pathPoints;

    const segmentObj = {
        segmentIndex,
        name: segment.name,
        direction: segment.direction,
        loadType: segment.loadType,
        startTime: new Date(trip.tripPath[toIndex].dt_tracker),
        status: 'running',
        distanceCovered: 0,
        distanceRemaining: segment.segmentLength,
        completionPercentage: 0,
        estimatedTimeOfArrival: null,
        nearestPointIndex: 0,
        segmentStartTripPathIndex: toIndex,
        startLocation: {
            locationName: segment.startLocation.locationName,
            arrivalTime: new Date(trip.tripPath[toIndex].dt_tracker),
            departureTime: null,
            dwellTime: 0,
            tripPathIndex: toIndex
        },
        endLocation: {
            locationName: segment.endLocation.locationName,
            arrivalTime: null,
        },
    };

    trip.currentlyActiveSegmentIndex = segmentIndex;
    trip.currentlyActiveSegment = segmentObj;

    if (!trip.segmentHistory) {
        trip.segmentHistory = [];
    }
    trip.segmentHistory.push(segmentObj);

    tripLogger(trip, `#FN:SEGCHK: Started segment ${segmentIndex}: ${segment.name}`);
}

function finishSegment(trip) {
    if (trip.currentlyActiveSegmentIndex === -1 || !trip.currentlyActiveSegment) {
        return;
    }

    const { toIndex } = trip.pathPoints;
    const segmentIndex = trip.currentlyActiveSegmentIndex;

    if (trip.segmentHistory?.length > 0) {
        const lastSegmentIndex = trip.segmentHistory.length - 1;
        if (trip.segmentHistory[lastSegmentIndex].segmentIndex === segmentIndex) {
            trip.segmentHistory[lastSegmentIndex] = {
                ...trip.segmentHistory[lastSegmentIndex],
                status: 'completed',
                endTime: new Date(trip.tripPath[toIndex].dt_tracker),
                completionPercentage: 100,
                distanceRemaining: 0,
                estimatedTimeOfArrival: null,
                segmentEndTripPathIndex: toIndex,
                endLocation: {
                    locationName: trip.route.segments[segmentIndex].endLocation.locationName,
                    arrivalTime: new Date(trip.tripPath[toIndex].dt_tracker),
                    departureTime: null,
                    dwellTime: 0,
                    tripPathIndex: toIndex
                }
            };
        }
    }

    // Check if this was the last segment in the route
    const isLastSegment = segmentIndex === trip.route.segments.length - 1;

    // Log completion of the last segment
    if (isLastSegment) {
        tripLogger(trip, `#FN:SEGCHK: Finished final segment ${segmentIndex}. All segments completed.`);
    }

    trip.currentlyActiveSegment = null;
    trip.currentlyActiveSegmentIndex = -1;

    tripLogger(trip, `#FN:SEGCHK: Finished segment ${segmentIndex}`);
}

/**
 * Update current segment progress
 * @param {Object} trip - Trip object to update
 */
function updateSegment(trip) {
    if (trip.currentlyActiveSegmentIndex === -1 || !trip.currentlyActiveSegment) {
        return;
    }

    const { toIndex } = trip.pathPoints;
    if (!toIndex) {
        tripLogger(trip, `#FN:SEGCHK: No toIndex found`);
        console.log("PathPoints not set proeprly", trip.pathPoints);
        return false;
    }
    const truckPoint = trip.tripPath[toIndex];
    if (!truckPoint?.dt_tracker) {
        tripLogger(trip, `#FN:SEGCHK: No truckPoint found`);
        console.log("TruckPoint not set proeprly", truckPoint, new Date(truckPoint.dt_tracker).getTime());
        return false;
    }

    const segmentIndex = trip.currentlyActiveSegmentIndex;
    const segment = trip.route.segments[segmentIndex];
    const { segmentPath } = segment;

    // Get segment progress using routeChecker
    const routeProgress = routeChecker(truckPoint, segmentPath);

    // Update current segment
    trip.currentlyActiveSegment = {
        ...trip.currentlyActiveSegment,
        status: 'running',
        nearestPointIndex: routeProgress.nearestPointIndex,
        distanceCovered: routeProgress.distanceCovered,
        distanceRemaining: routeProgress.distanceRemaining,
        completionPercentage: routeProgress.completionPercentage,
        estimatedTimeOfArrival: calculateETA(trip),
    };

    if (!trip.currentlyActiveSegment.startLocation.departureTime) {
        trip.currentlyActiveSegment.startLocation.departureTime = trip.tripPath[toIndex].dt_tracker;
        trip.currentlyActiveSegment.startLocation.dwellTime = Math.floor((new Date(truckPoint.dt_tracker).getTime() - new Date(trip.currentlyActiveSegment.startLocation.arrivalTime).getTime()) / 60000);
    }

    // Update segment history
    if (trip.segmentHistory?.length > 0) {
        const lastSegmentIndex = trip.segmentHistory.length - 1;
        if (trip.segmentHistory[lastSegmentIndex].segmentIndex === segmentIndex) {
            trip.segmentHistory[lastSegmentIndex] = {
                ...trip.segmentHistory[lastSegmentIndex],
                ...trip.currentlyActiveSegment
            };
        }
    }

    updateTripLevelMetrics(trip);
}

function calculateETA(trip) {
    // Check if we have valid inputs
    if (!trip ||
        isNaN(trip.distanceRemaining) ||
        trip.distanceRemaining <= 0 ||
        isNaN(trip.averageSpeed) ||
        trip.averageSpeed <= 0) {
        return null;
    }

    const averageSpeed = trip.averageSpeed || 40; // Default to 40 km/h
    const timeToReach = (trip.distanceRemaining / averageSpeed) * 60; // minutes

    // Final check to ensure we have a valid calculation
    if (isNaN(timeToReach) || timeToReach <= 0) {
        return null;
    }

    return new Date(Date.now() + timeToReach * 60000);
}

function updateTripLevelMetrics(trip) {
    let totalDistanceCovered = 0;

    // Sum all segments, completed and active
    if (trip.segmentHistory) {
        trip.segmentHistory.forEach(segment => {
            // Ensure we're adding valid numbers
            if (!isNaN(segment.distanceCovered)) {
                totalDistanceCovered += segment.distanceCovered;
            }
        });
    }

    // Update trip metrics with safe values
    trip.distanceCovered = totalDistanceCovered;

    // Calculate remaining distance safely
    if (trip.route && !isNaN(trip.route.routeLength) && trip.route.routeLength > 0) {
        trip.distanceRemaining = Math.max(0, trip.route.routeLength - totalDistanceCovered);

        // Calculate completion percentage safely
        trip.completionPercentage = (totalDistanceCovered / trip.route.routeLength) * 100;
        // Ensure it's between 0 and 100
        trip.completionPercentage = Math.max(0, Math.min(100, trip.completionPercentage));
    } else {
        trip.distanceRemaining = 0;
        trip.completionPercentage = 0;
    }

    // Use the ETA calculation which now uses the averageSpeed from pathMetricsCalculator
    trip.estimatedTimeOfArrival = calculateETA(trip);
}

module.exports = processSegment;