const { checkLocation } = require('./helpers');
const { tripLogger } = require('./logger');

async function locationChecker(trip, truckPoint) {
    try {
        const { route } = trip;
        const { startLocation, endLocation, viaLocations } = route;
        let { currentSignificantLocation } = trip;

        let previousSignificantLocation = null;
        let newSignificantLocation = null;
        let locationChange = {
            entry: null,
            exit: null,
            viaSwitch: null
        };

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
                tripLogger(trip, `#FN:LOCCHK -> ENTRY ${currentSignificantLocation.locationName} (${currentSignificantLocation.locationType})`);
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
                tripLogger(trip, `#FN:LOCCHK -> JUMPED  OldLoc: ${previousSignificantLocation.locationName} (${previousSignificantLocation.locationType}) -> NewLoc: ${currentSignificantLocation.locationName} (${currentSignificantLocation.locationType})`);
            }
            // If in same location, do nothing
        } else if (currentSignificantLocation) {
            // Truck has left the significant location
            previousSignificantLocation = {
                ...currentSignificantLocation,
                exitTime: truckPoint.dt_tracker
            };
            currentSignificantLocation = null;
            tripLogger(trip, `#FN:LOCCHK -> EXIT from ${previousSignificantLocation.locationName} (${previousSignificantLocation.locationType})`);
        }



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
        return { currentSignificantLocation, previousSignificantLocation, locationChange };
    } catch (err) {
        console.error('Error in locationChecker:', err);
        tripLogger(trip, 'Error in presenceInSignificantLocation:', err);
        return { currentSignificantLocation: null, previousSignificantLocation: null, locationChange: null };
    }
}

module.exports = locationChecker;