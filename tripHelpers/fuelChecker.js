const { tripLogger } = require('../common/helpers/logger');
const getFuel = require('../common/helpers/getFuel');

/**
 * Process fuel data and update trip object
 * @param {Object} trip - Trip object to update
 * @param {Object} truckPoint - Current truck position
 * @returns {boolean} - Success status
 */
async function processFuel(trip, truckPoint) {
    try {
        //check if this vehiclle has fuelLevel in the tripPath, check only last 20 points
        const last20Points = trip.tripPath.slice(-20);
        const hasFuelLevel = last20Points.some(point => point.fuelLevel !== null);
        if (!hasFuelLevel) {
            return false;
        }

        // Check if fuel update is needed
        if (trip.fuelStatusUpdateTime) {
            const hoursSinceLastUpdate =
                (new Date(truckPoint.dt_tracker) - new Date(trip.fuelStatusUpdateTime)) / (1000 * 60 * 60);
            if (hoursSinceLastUpdate < 1) {
                return true;
            }
        }

        const fuelData = await getFuel({
            timeFrom: trip.actualStartTime,
            timeTo: truckPoint.dt_tracker,
            imei: trip.deviceImei,
            user_id: trip.iLogistekUserId
        });

        if (!fuelData) {
            return false;
        }

        // Update trip fuel metrics
        const { consumption, mileage, endVol, fuelEvents } = fuelData;
        trip.fuelConsumption = consumption || 0;
        trip.fuelEfficiency = mileage || 0;
        trip.currentFuelLevel = endVol || 0;
        trip.fuelEvents = fuelEvents || [];
        trip.fuelStatusUpdateTime = truckPoint.dt_tracker;

        tripLogger(trip, `#FN:FuelCHK: Fuel level: ${endVol}L, Consumption: ${consumption}L, Efficiency: ${mileage} km/L`);
        return true;

    } catch (error) {
        console.error('Error in processFuel:', error);
        tripLogger(trip, `#FN:FuelCHK: Error processing fuel data: ${error.message}`);
        return false;
    }
}

module.exports = processFuel;