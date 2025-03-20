const { checkLocation } = require('../common/helpers/helper');
const { tripLogger } = require('../common/helpers/logger');

/**
 * Check and update significant location status for the trip
 * @param {Object} trip - Trip object to update
 * @returns {boolean} - Success status
 */
function processLocation(trip) {
    try {
        if (!trip.pathPoints || !trip.tripPath) {
            return false;
        }

        // Get the latest point from pathPoints
        const { toIndex } = trip.pathPoints;
        const truckPoint = trip.tripPath[toIndex];

        if (!truckPoint) {
            return false;
        }

        const { route } = trip;
        const { startLocation, endLocation, viaLocations } = route;

        // Check all locations and store matches
        const matchingLocations = [];

        // Check start location
        if (checkLocation(startLocation, {
            lat: truckPoint.coordinates[1],
            lng: truckPoint.coordinates[0]
        })) {
            matchingLocations.push({ ...startLocation, locationType: 'startLocation' });
        }

        // Check end location
        if (checkLocation(endLocation, {
            lat: truckPoint.coordinates[1],
            lng: truckPoint.coordinates[0]
        })) {
            matchingLocations.push({ ...endLocation, locationType: 'endLocation' });
        }

        // Check via locations
        for (const viaLocation of viaLocations) {
            if (checkLocation(viaLocation, {
                lat: truckPoint.coordinates[1],
                lng: truckPoint.coordinates[0]
            })) {
                matchingLocations.push({ ...viaLocation, locationType: 'viaLocation' });
            }
        }

        // Determine the most appropriate location based on trip context
        let newSignificantLocation = null;

        if (matchingLocations.length > 0) {
            // If we have multiple matching locations (e.g., same physical location for start and end)
            if (matchingLocations.length > 1) {
                // Check if this could be the end location
                const isInLastSegment = trip.currentlyActiveSegmentIndex === trip.route.segments.length - 1;
                const lastSegmentEndLocation = trip.route.segments[trip.route.segments.length - 1]?.endLocation;
                const isAtLastSegmentEndLocation = lastSegmentEndLocation &&
                    lastSegmentEndLocation.locationName === matchingLocations.find(
                        loc => loc.locationType === 'endLocation'
                    )?.locationName;
                const hasLeftStartLocation = trip.significantLocations.some(loc =>
                    loc.locationType === 'startLocation' && loc.exitTime
                );

                // If we're in the last segment and at its end location, and we've left the start location before
                if (isInLastSegment && isAtLastSegmentEndLocation && hasLeftStartLocation) {
                    // This is very likely the end location
                    newSignificantLocation = matchingLocations.find(loc => loc.locationType === 'endLocation');
                    tripLogger(trip, `#FN:LOCCHK -> Multiple locations matched, selecting end location based on segment context`);
                } else if (hasLeftStartLocation) {
                    // We've already recorded leaving the start location, so this is likely a via or end location
                    const nonStartLocation = matchingLocations.find(loc => loc.locationType !== 'startLocation');
                    if (nonStartLocation) {
                        newSignificantLocation = nonStartLocation;
                        tripLogger(trip, `#FN:LOCCHK -> Multiple locations matched, selecting ${nonStartLocation.locationType} based on trip history`);
                    }
                } else {
                    // Default to start location if we're early in the trip
                    newSignificantLocation = matchingLocations.find(loc => loc.locationType === 'startLocation');
                    tripLogger(trip, `#FN:LOCCHK -> Multiple locations matched, selecting start location based on trip stage`);
                }
            } else {
                // Only one location matched, use it
                newSignificantLocation = matchingLocations[0];
            }
        }

        // Initialize significantLocations array if it doesn't exist
        if (!trip.significantLocations) {
            trip.significantLocations = [];
        }

        // Handle significant location changes
        if (newSignificantLocation) {
            if (!trip?.currentSignificantLocation?.locationName) {
                // First entry into a significant location
                trip.currentSignificantLocation = {
                    ...newSignificantLocation,
                    entryTime: truckPoint.dt_tracker
                };
                tripLogger(trip, `#FN:LOCCHK -> ENTRY ${trip.currentSignificantLocation.locationName} (${trip.currentSignificantLocation.locationType})`);
            } else if (newSignificantLocation.locationName !== trip.currentSignificantLocation.locationName) {
                // Close current location and add to significantLocations
                const exitingLocation = {
                    ...trip.currentSignificantLocation,
                    exitTime: new Date(truckPoint.dt_tracker),
                    dwellTime: Math.floor((new Date(truckPoint.dt_tracker).getTime() - new Date(trip.currentSignificantLocation.entryTime).getTime()) / 60000)
                };
                trip.significantLocations.push(exitingLocation);
                tripLogger(trip, `#FN:LOCCHK -> EXIT ${exitingLocation.locationName} with dwell time ${exitingLocation.dwellTime} minutes`);

                // Start tracking new location
                trip.currentSignificantLocation = {
                    ...newSignificantLocation,
                    entryTime: new Date(truckPoint.dt_tracker)
                };
                tripLogger(trip, `#FN:LOCCHK -> SWITCHED to ${trip.currentSignificantLocation.locationName}`);
            }
            // If in same location, do nothing
        } else if (trip?.currentSignificantLocation?.locationName) {
            // Vehicle has exited a significant location

            // For end locations with detention time, we need to handle exit specially
            if (trip.currentSignificantLocation.locationType === 'endLocation') {

                // Record the exit in significantLocations
                const exitingLocation = {
                    ...trip.currentSignificantLocation,
                    exitTime: new Date(truckPoint.dt_tracker),
                    dwellTime: Math.floor((new Date(truckPoint.dt_tracker).getTime() - new Date(trip.currentSignificantLocation.entryTime).getTime()) / 60000)
                };

                // Check if this location is already in significantLocations to avoid duplicates
                const isDuplicate = trip.significantLocations.some(loc =>
                    loc.locationName === exitingLocation.locationName &&
                    loc.locationType === 'endLocation' &&
                    loc.exitTime // Only consider records with exitTime as duplicates
                );

                if (!isDuplicate) {
                    trip.significantLocations.push(exitingLocation);

                    // Set a flag to indicate the vehicle has exited the end location
                    trip.hasExitedEndLocation = true;
                    tripLogger(trip, `#FN:LOCCHK -> EXIT END LOCATION ${exitingLocation.locationName} with dwell time ${exitingLocation.dwellTime} minutes`);
                    tripLogger(trip, `#FN:LOCCHK -> Set hasExitedEndLocation flag to true`);

                    // Clear current significant location upon exit
                    trip.currentSignificantLocation = null;
                    tripLogger(trip, `#FN:LOCCHK -> Cleared currentSignificantLocation upon exiting end location`);
                }
            }
            // For other locations, handle as before
            else if (trip.currentSignificantLocation.locationType !== 'endLocation') {
                const exitingLocation = {
                    ...trip.currentSignificantLocation,
                    exitTime: new Date(truckPoint.dt_tracker),
                    dwellTime: Math.floor((new Date(truckPoint.dt_tracker).getTime() - new Date(trip.currentSignificantLocation.entryTime).getTime()) / 60000)
                };
                trip.significantLocations.push(exitingLocation);
                trip.currentSignificantLocation = null;
                tripLogger(trip, `#FN:LOCCHK -> EXIT ${exitingLocation.locationName} with dwell time ${exitingLocation.dwellTime} minutes`);
            }
        }

        // CRITICAL FIX: Check if trip is about to be completed and we're in the end location
        // This ensures the end location is added to significantLocations before the trip is completed
        if (trip.tripStage === 'Active' &&
            trip.currentSignificantLocation?.locationType === 'endLocation' &&
            trip.currentlyActiveSegmentIndex !== -1 &&
            trip.currentlyActiveSegment?.completionPercentage >= 95) {

            // For end location, we record entry but leave exitTime null
            // This indicates the vehicle is still at the end location when the trip completed
            const endLocationRecord = {
                ...trip.currentSignificantLocation,
                // No exitTime for end location
                dwellTime: Math.floor((new Date(truckPoint.dt_tracker).getTime() - new Date(trip.currentSignificantLocation.entryTime).getTime()) / 60000)
            };

            // Check if this location is already in significantLocations to avoid duplicates
            const isDuplicate = trip.significantLocations.some(loc =>
                loc.locationName === endLocationRecord.locationName &&
                loc.locationType === 'endLocation'
            );

            if (!isDuplicate) {
                trip.significantLocations.push(endLocationRecord);
                tripLogger(trip, `#FN:LOCCHK -> RECORDED END LOCATION ${endLocationRecord.locationName} with current dwell time ${endLocationRecord.dwellTime} minutes`);
            }

            // We don't clear currentSignificantLocation for end location
            // This allows the trip to complete while still at the end location
        }

        return true;

    } catch (err) {
        console.error('Error in processLocation:', err);
        tripLogger(trip, '#FN:LOCCHK: Error processing location:', err);
        return false;
    }
}

module.exports = processLocation; 