const axios = require('axios');
const { tripLogger } = require('../common/helpers/logger');
const { validatePoint } = require('../common/helpers/pointValidator');

/**
 * Fetch and format historical path data
 * @param {string} deviceImei - Device IMEI
 * @param {string} timeFrom - Start time
 * @param {string} timeTo - End time
 * @returns {Array|null} - Array of formatted path points or null on error
 */
async function getBackdatedTripPath(trip, timeFrom, timeTo) {
    try {
        // Call backend API
        const response = await axios.post('http://172.31.18.33:11002/routeFuelRaw', {
            imei: trip.deviceImei,
            timeFrom,
            timeTo
        });

        if (!response.data?.data || !Array.isArray(response.data.data)) {
            console.error('Invalid response from routeFuelRaw API');
            return null;
        }

        // Validate and format points
        const totalPoints = response.data.data.length;
        const validPoints = response.data.data
            .map(validatePoint)
            .filter(point => point !== null);

        if (!validPoints.length) {
            console.error('No valid points found in historical data');
            return null;
        }

        const invalidCount = totalPoints - validPoints.length;
        if (invalidCount > 0) {
            tripLogger(trip, `#FN:getBackdatedTripPath: Skipped ${invalidCount} invalid points`);
        }

        tripLogger(trip, `#FN:getBackdatedTripPath: Added ${validPoints.length} valid points to tripPath`);
        return validPoints;

    } catch (error) {
        console.error('Error in getBackdatedTripPath:', error);
        return null;
    }
}

module.exports = getBackdatedTripPath; 