const { Trip } = require('../models');
const { tripLogger } = require('../common/helpers/logger');

// Fields that should never be updated
const STATIC_FIELDS = [
    '_id', '__v', 'iLogistekUserId', 'tripName', 'tripId', 'erpSystemId',
    'truckRegistrationNumber', 'deviceImei', 'driverName', 'driverPhoneNumber',
    'route', 'customer', 'goodsName', 'goodsDescription',
    'plannedStartTime', 'rules', 'notifications'
];

// Array fields that need special handling
const ARRAY_FIELDS = [
    'tripPath', 'significantEvents', 'sentNotifications',
    'segmentHistory', 'significantLocations', 'fuelEvents'
];

/**
 * Update trip record in database efficiently
 * @param {Object} originalTrip - Original trip document from database
 * @param {Object} updatedTrip - Updated trip object with changes
 * @returns {Promise<boolean>} - Success status
 */
async function updateTripRecord(originalTrip, updatedTrip) {
    try {
        // Handle Mongoose documents
        if (!updatedTrip) {
            updatedTrip = originalTrip;
            if (typeof originalTrip.toObject === 'function') {
                originalTrip = originalTrip.toObject();
            }
        } else if (typeof originalTrip.toObject === 'function') {
            originalTrip = originalTrip.toObject();
        }

        if (!updatedTrip?._id) {
            tripLogger(updatedTrip, 'DB Update Error: Invalid trip or missing _id');
            return false;
        }

        // Prepare update operations
        const updateOperations = {};
        const setOperations = {};
        const pushOperations = {};
        const updatedFields = [];

        // Handle backdated trips specially
        const isBackdatedTrip = updatedTrip.backDated === true;

        // 1. Process regular fields (non-array fields)
        for (const [key, value] of Object.entries(updatedTrip)) {
            // Skip static fields and array fields (handled separately)
            if (STATIC_FIELDS.includes(key) || ARRAY_FIELDS.includes(key)) {
                continue;
            }

            // Skip null or undefined values
            if (value === null || value === undefined) {
                continue;
            }

            // For backDated field, set it to false if it was true
            if (key === 'backDated' && isBackdatedTrip) {
                setOperations[key] = false;
                updatedFields.push(`${key}=false`);
                continue;
            }

            // Check if the field has changed
            try {
                if (originalTrip[key] === undefined || JSON.stringify(originalTrip[key]) !== JSON.stringify(value)) {
                    setOperations[key] = value;
                    updatedFields.push(key);
                }
            } catch (e) {
                // If JSON.stringify fails, just set the value
                setOperations[key] = value;
                updatedFields.push(key);
            }
        }

        // 2. Handle array fields

        // 2.1 Handle tripPath
        if (updatedTrip.tripPath && Array.isArray(updatedTrip.tripPath)) {
            if (isBackdatedTrip) {
                // For backdated trips, set the entire tripPath
                setOperations.tripPath = updatedTrip.tripPath;
                updatedFields.push(`tripPath(${updatedTrip.tripPath.length})`);
            } else if (updatedTrip.pathPoints?.fromIndex !== undefined &&
                updatedTrip.pathPoints?.toIndex !== undefined) {
                // For live trips, push only the new points
                const newPoints = updatedTrip.tripPath.slice(
                    updatedTrip.pathPoints.fromIndex,
                    updatedTrip.pathPoints.toIndex + 1
                );

                if (newPoints.length > 0) {
                    pushOperations.tripPath = { $each: newPoints };
                    updatedFields.push(`tripPath+${newPoints.length}`);
                }
            }
        }

        // 2.2 Handle significantEvents
        if (updatedTrip.significantEvents && Array.isArray(updatedTrip.significantEvents)) {
            setOperations.significantEvents = updatedTrip.significantEvents;
            updatedFields.push(`significantEvents(${updatedTrip.significantEvents.length})`);
        }

        // 2.3 Handle sentNotifications
        if (updatedTrip.sentNotifications && Array.isArray(updatedTrip.sentNotifications)) {
            // Get only new notifications
            const lastUpdateTime = originalTrip.updatedAt ? new Date(originalTrip.updatedAt) : new Date(0);

            const newNotifications = updatedTrip.sentNotifications.filter(notification => {
                if (!notification.sentTime) return false;
                const notifTime = new Date(notification.sentTime);
                return notifTime > lastUpdateTime;
            });

            if (newNotifications.length > 0) {
                pushOperations.sentNotifications = { $each: newNotifications };
                updatedFields.push(`sentNotifications+${newNotifications.length}`);
            }
        }

        // 2.4 Handle segmentHistory
        if (updatedTrip.segmentHistory && Array.isArray(updatedTrip.segmentHistory)) {
            setOperations.segmentHistory = updatedTrip.segmentHistory;
            updatedFields.push(`segmentHistory(${updatedTrip.segmentHistory.length})`);
        }

        // 2.5 Handle significantLocations
        if (updatedTrip.significantLocations && Array.isArray(updatedTrip.significantLocations)) {
            setOperations.significantLocations = updatedTrip.significantLocations;
            updatedFields.push(`significantLocations(${updatedTrip.significantLocations.length})`);
        }

        // 2.6 Handle fuelEvents
        if (updatedTrip.fuelEvents && Array.isArray(updatedTrip.fuelEvents)) {
            setOperations.fuelEvents = updatedTrip.fuelEvents;
            updatedFields.push(`fuelEvents(${updatedTrip.fuelEvents.length})`);
        }

        // Build the final update operation
        if (Object.keys(setOperations).length > 0) {
            updateOperations.$set = setOperations;
        }

        if (Object.keys(pushOperations).length > 0) {
            updateOperations.$push = pushOperations;
        }

        // If no updates to perform, return true
        if (Object.keys(updateOperations).length === 0) {
            return true;
        }

        // Log what we're updating
        if (updatedFields.length > 0) {
            tripLogger(updatedTrip, `DB Update: ${updatedFields.join(', ')}`);
        }

        // Perform the update with retries
        let retryCount = 0;
        const MAX_RETRIES = 3;

        while (retryCount < MAX_RETRIES) {
            try {
                const result = await Trip.updateOne(
                    { _id: updatedTrip._id },
                    updateOperations,
                    { runValidators: true }
                );

                if (result.matchedCount === 0) {
                    throw new Error('Trip not found');
                }

                return true;
            } catch (dbError) {
                retryCount++;
                tripLogger(updatedTrip, `DB Update Retry ${retryCount}: ${dbError.message}`);

                if (retryCount >= MAX_RETRIES) {
                    throw dbError;
                }

                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
            }
        }

        return false;
    } catch (err) {
        tripLogger(updatedTrip, `DB Update Error: ${err.message}`);
        console.error(`Failed to update trip ${updatedTrip._id}:`, err);
        return false;
    }
}

module.exports = updateTripRecord;
