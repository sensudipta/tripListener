const { checkLocation } = require('./helpers');
const { tripLogger } = require('./logger');

async function locationChecker(trip, truckPoint) {
    try {
        // Ensure we have valid input
        if (!trip || !trip.route || !truckPoint) {
            console.error('Invalid input to locationChecker');
            return { locationChanged: false };
        }

        // Extract locations from route
        const { startLocation, endLocation, viaLocations = [] } = trip.route;

        // Debug location checking
        console.log(`Checking location for point [${truckPoint.lat}, ${truckPoint.lng}]`);
        console.log(`Start location: ${startLocation?.locationName}`);
        console.log(`Via locations: ${viaLocations.map(loc => loc.locationName).join(', ')}`);
        console.log(`End location: ${endLocation?.locationName}`);

        // Combine all significant locations
        const allLocations = [];

        if (startLocation) {
            allLocations.push({
                ...startLocation,
                locationType: 'startLocation'
            });
        }

        if (endLocation && endLocation.locationId !== startLocation?.locationId) {
            allLocations.push({
                ...endLocation,
                locationType: 'endLocation'
            });
        }

        viaLocations.forEach(loc => {
            allLocations.push({
                ...loc,
                locationType: 'viaLocation'
            });
        });

        console.log(`Total significant locations to check: ${allLocations.length}`);

        // Check if truck is in any location
        let currentLocation = null;
        let locationChanged = false;
        let exitedLocation = null;
        let dwellTime = 0;

        for (const location of allLocations) {
            // Skip locations without coordinates
            if (!location.location || !location.location.coordinates) {
                console.warn(`Location ${location.locationName} has no coordinates`);
                continue;
            }

            // Check if truck is in this location
            const inLocation = checkLocation(location, truckPoint);

            if (inLocation) {
                console.log(`Truck is in location: ${location.locationName}`);
                currentLocation = location;
                break;
            }
        }

        // Check if location has changed
        if (trip.currentSignificantLocation?.locationId !== currentLocation?.locationId) {
            locationChanged = true;

            // If we left a location, record it
            if (trip.currentSignificantLocation && !currentLocation) {
                exitedLocation = trip.currentSignificantLocation;

                // Calculate dwell time if we have entry time
                const entryTime = trip.currentSignificantLocation.entryTime;
                if (entryTime) {
                    dwellTime = new Date(truckPoint.dt_tracker) - new Date(entryTime);
                }
            }
        }

        // Initialize or update significantLocations array
        let significantLocations = trip.significantLocations || [];

        if (locationChanged) {
            // If we entered a new location, add it to the array
            if (currentLocation) {
                const existingLocationIndex = significantLocations.findIndex(
                    loc => loc.locationId === currentLocation.locationId && !loc.exitTime
                );

                if (existingLocationIndex === -1) {
                    // Add new location entry
                    significantLocations.push({
                        ...currentLocation,
                        entryTime: new Date(truckPoint.dt_tracker),
                        exitTime: null
                    });

                    console.log(`Added ${currentLocation.locationName} to significant locations`);
                }
            }

            // If we exited a location, update its exit time
            if (exitedLocation) {
                const exitedLocationIndex = significantLocations.findIndex(
                    loc => loc.locationId === exitedLocation.locationId && !loc.exitTime
                );

                if (exitedLocationIndex !== -1) {
                    significantLocations[exitedLocationIndex].exitTime = new Date(truckPoint.dt_tracker);
                    console.log(`Updated exit time for ${exitedLocation.locationName}`);
                }
            }
        }

        return {
            locationChanged,
            currentSignificantLocation: currentLocation,
            exitedLocation,
            dwellTime,
            significantLocations
        };
    } catch (error) {
        console.error('Error in locationChecker:', error);
        return { locationChanged: false };
    }
}

module.exports = locationChecker;