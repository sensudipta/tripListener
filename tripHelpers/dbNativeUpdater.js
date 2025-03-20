const { MongoClient, ObjectId } = require('mongodb');
const { tripLogger } = require('../common/helpers/logger');
const { RAWMONGO } = require('../common/liveDB');


const DB_NAME = 'tripdb';
const COLLECTION_NAME = 'trips';

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
 * Update trip record in database using native MongoDB driver
 * @param {Object} originalTrip - Original trip document from database
 * @param {Object} updatedTrip - Updated trip object with changes
 * @returns {Promise<boolean>} - Success status
 */
async function updateTripRecord(originalTrip, updatedTrip) {
    let client = null;

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
            tripLogger(updatedTrip, 'Native update error: Invalid trip or missing _id');
            return false;
        }

        // Connect to MongoDB - ensure RAWMONGO is defined and valid
        if (!RAWMONGO) {
            throw new Error('MongoDB connection string is undefined');
        }

        client = new MongoClient(RAWMONGO);
        await client.connect();

        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // Prepare update operations
        const updateOperations = {};
        const setOperations = {};
        const pushOperations = {};

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
                continue;
            }

            // Safely compare values - handle undefined originalTrip[key]
            try {
                if (originalTrip[key] === undefined || JSON.stringify(originalTrip[key]) !== JSON.stringify(value)) {
                    setOperations[key] = value;
                }
            } catch (e) {
                // If JSON.stringify fails, just set the value
                setOperations[key] = value;
            }
        }

        // 2. Handle array fields

        // 2.1 Handle tripPath
        if (updatedTrip.tripPath && Array.isArray(updatedTrip.tripPath)) {
            if (isBackdatedTrip) {
                // For backdated trips, set the entire tripPath
                setOperations.tripPath = updatedTrip.tripPath;
            } else if (updatedTrip.pathPoints?.fromIndex !== undefined &&
                updatedTrip.pathPoints?.toIndex !== undefined) {
                // For live trips, push only the new points
                const newPoints = updatedTrip.tripPath.slice(
                    updatedTrip.pathPoints.fromIndex,
                    updatedTrip.pathPoints.toIndex + 1
                );

                if (newPoints.length > 0) {
                    pushOperations.tripPath = { $each: newPoints };
                }
            }
        }

        // 2.2 Handle significantEvents
        if (updatedTrip.significantEvents && Array.isArray(updatedTrip.significantEvents)) {
            setOperations.significantEvents = updatedTrip.significantEvents;
        }

        // 2.3 Handle sentNotifications
        if (updatedTrip.sentNotifications && Array.isArray(updatedTrip.sentNotifications)) {
            // Safely handle lastUpdateTime
            let lastUpdateTime;
            try {
                lastUpdateTime = originalTrip.updatedAt ? new Date(originalTrip.updatedAt) : new Date(0);
            } catch (e) {
                lastUpdateTime = new Date(0);
            }

            const newNotifications = updatedTrip.sentNotifications.filter(notification => {
                if (!notification.sentTime) return false;
                try {
                    const notifTime = new Date(notification.sentTime);
                    return notifTime > lastUpdateTime;
                } catch (e) {
                    return false;
                }
            });

            if (newNotifications.length > 0) {
                pushOperations.sentNotifications = { $each: newNotifications };
            }
        }

        // 2.4 Handle segmentHistory
        if (updatedTrip.segmentHistory && Array.isArray(updatedTrip.segmentHistory)) {
            setOperations.segmentHistory = updatedTrip.segmentHistory;
        }

        // 2.5 Handle significantLocations
        if (updatedTrip.significantLocations && Array.isArray(updatedTrip.significantLocations)) {
            setOperations.significantLocations = updatedTrip.significantLocations;
        }

        // 2.6 Handle fuelEvents
        if (updatedTrip.fuelEvents && Array.isArray(updatedTrip.fuelEvents)) {
            setOperations.fuelEvents = updatedTrip.fuelEvents;
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

        // Add updatedAt timestamp
        if (!updateOperations.$set) {
            updateOperations.$set = {};
        }
        updateOperations.$set.updatedAt = new Date();

        // Convert string _id to ObjectId if needed
        let objectId;
        try {
            objectId = typeof updatedTrip._id === 'string'
                ? new ObjectId(updatedTrip._id)
                : updatedTrip._id;
        } catch (e) {
            throw new Error(`Invalid _id format: ${updatedTrip._id}`);
        }

        // Perform the update
        const result = await collection.updateOne(
            { _id: objectId },
            updateOperations
        );

        // Log minimal info about the update
        tripLogger(updatedTrip, `Native update: matched=${result.matchedCount}, modified=${result.modifiedCount}`);

        return result.matchedCount > 0;

    } catch (err) {
        tripLogger(updatedTrip, `Native update error: ${err.message}`);
        console.error('Native update error details:', err);
        return false;
    } finally {
        // Close the MongoDB connection
        if (client) {
            try {
                await client.close();
            } catch (e) {
                console.error('Error closing MongoDB connection:', e);
            }
        }
    }
}

module.exports = updateTripRecord; 