const { Trip } = require('../models');
const { tripLogger } = require('../common/helpers/logger');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Fields that should never be updated
const STATIC_FIELDS = [
    '_id', '__v',  // MongoDB internal fields
    'iLogistekUserId', 'tripName', 'tripId', 'erpSystemId',
    'truckRegistrationNumber', 'deviceImei', 'driverName', 'driverPhoneNumber',
    'route', 'customer', 'goodsName', 'goodsDescription',
    'plannedStartTime', 'rules', 'notifications'
];

const ARRAY_FIELDS = [
    'tripPath', 'sentNotifications',
];

/**
 * Write object to file for debugging
 * @param {Object} obj - Object to write
 * @param {string} filename - Filename
 */
function writeObjectToFile(obj, filename) {
    try {
        // Create logs directory if it doesn't exist
        const logsDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const filePath = path.join(logsDir, filename);
        const objCopy = JSON.parse(JSON.stringify(obj)); // Deep copy to remove circular references

        // Format with indentation for readability
        fs.writeFileSync(filePath, JSON.stringify(objCopy, null, 2));
        console.log(`Wrote object to ${filePath}`);
        return filePath;
    } catch (err) {
        console.error(`Error writing object to file: ${err.message}`);
        return null;
    }
}

/**
 * Update trip record in database with detailed debugging
 * @param {Object} originalTrip - Original trip document from database
 * @param {Object} updatedTrip - Updated trip object with changes
 * @returns {Promise<boolean>} - Success status
 */
async function updateTripRecord(originalTrip, updatedTrip) {
    try {
        // If only one argument is provided, assume it's a Mongoose document
        if (!updatedTrip) {
            updatedTrip = originalTrip;
            // Check if it's a Mongoose document with toObject method
            if (typeof originalTrip.toObject === 'function') {
                originalTrip = originalTrip.toObject();
            }
        } else if (typeof originalTrip.toObject === 'function') {
            originalTrip = originalTrip.toObject();
        }

        if (!updatedTrip?._id) {
            tripLogger(updatedTrip, '#FN:DBDebugUpdate: Error: Invalid trip or missing _id');
            return false;
        }

        // Write original and updated trip objects to files
        const tripId = updatedTrip.tripId;
        const timestamp = new Date().toISOString().replace(/:/g, '-');

        const originalFilePath = writeObjectToFile(
            originalTrip,
            `${tripId}_original_${timestamp}.json`
        );

        const updatedFilePath = writeObjectToFile(
            updatedTrip,
            `${tripId}_updated_${timestamp}.json`
        );

        tripLogger(updatedTrip, `#FN:DBDebugUpdate: Wrote original trip to ${originalFilePath}`);
        tripLogger(updatedTrip, `#FN:DBDebugUpdate: Wrote updated trip to ${updatedFilePath}`);

        // Create clean object for update
        let tripObj = updatedTrip;
        if (typeof updatedTrip.toObject === 'function') {
            tripObj = updatedTrip.toObject();
        }

        // Prepare operations array
        const operations = [];

        // Handle backdated trips specially
        const isBackdatedTrip = tripObj.backDated === true;

        // 1. Handle tripPath update for backdated trips
        if (isBackdatedTrip && tripObj.tripPath && Array.isArray(tripObj.tripPath)) {
            operations.push({
                operationType: 'set',
                fieldName: 'tripPath',
                fieldValue: tripObj.tripPath,
                tripId: tripObj._id
            });

            operations.push({
                operationType: 'set',
                fieldName: 'backDated',
                fieldValue: false,
                tripId: tripObj._id
            });
        }
        // Handle tripPath update for live trips
        else if (!isBackdatedTrip && tripObj.pathPoints?.fromIndex !== undefined &&
            tripObj.pathPoints?.toIndex !== undefined &&
            tripObj.tripPath && Array.isArray(tripObj.tripPath)) {

            const newPoints = tripObj.tripPath.slice(tripObj.pathPoints.fromIndex, tripObj.pathPoints.toIndex + 1);
            if (newPoints.length > 0) {
                operations.push({
                    operationType: 'push',
                    fieldName: 'tripPath',
                    fieldValue: { $each: newPoints },
                    tripId: tripObj._id
                });
            }
        }

        // 2. Handle significantEvents array
        if (tripObj.significantEvents && Array.isArray(tripObj.significantEvents)) {
            operations.push({
                operationType: 'set',
                fieldName: 'significantEvents',
                fieldValue: tripObj.significantEvents,
                tripId: tripObj._id
            });
        }

        // 3. Handle sentNotifications array
        if (tripObj.sentNotifications && Array.isArray(tripObj.sentNotifications)) {
            const lastUpdateTime = originalTrip.updatedAt ? new Date(originalTrip.updatedAt) : new Date(0);

            const newNotifications = tripObj.sentNotifications.filter(notification => {
                if (!notification.sentTime) return false;
                const notifTime = new Date(notification.sentTime);
                return notifTime > lastUpdateTime;
            });

            if (newNotifications.length > 0) {
                operations.push({
                    operationType: 'push',
                    fieldName: 'sentNotifications',
                    fieldValue: { $each: newNotifications },
                    tripId: tripObj._id
                });
            }
        }

        // 4. Handle all other fields
        for (const [key, value] of Object.entries(tripObj)) {
            // Skip fields we've already handled or should never update
            if (key === 'tripPath' || key === 'pathPoints' ||
                key === 'significantEvents' || key === 'sentNotifications' ||
                key === 'backDated' && isBackdatedTrip ||
                STATIC_FIELDS.includes(key)) {
                continue;
            }

            // Skip null or undefined values
            if (value === null || value === undefined) {
                continue;
            }

            operations.push({
                operationType: 'set',
                fieldName: key,
                fieldValue: value,
                tripId: tripObj._id
            });
        }

        // If no updates to perform, return true
        if (operations.length === 0) {
            tripLogger(updatedTrip, '#FN:DBDebugUpdate: No changes to update');
            return true;
        }

        tripLogger(updatedTrip, `#FN:DBDebugUpdate: Will perform ${operations.length} operations`);

        // Start the recursive update process
        await processOperations(operations, tripObj, timestamp);

        tripLogger(updatedTrip, `#FN:DBDebugUpdate: All ${operations.length} operations completed successfully`);
        return true;

    } catch (err) {
        console.error(`Failed to update trip:`, err);
        tripLogger(updatedTrip, `#FN:DBDebugUpdate: Fatal Error: ${err.message}`);

        // Write error details to file
        const tripId = updatedTrip._id.toString();
        const timestamp = new Date().toISOString().replace(/:/g, '-');

        writeObjectToFile({
            error: err.message,
            stack: err.stack,
            tripId: tripId
        }, `${tripId}_fatal_error_${timestamp}.json`);

        return false;
    }
}

/**
 * Process operations recursively
 * @param {Array} operations - Array of operations
 * @param {Object} tripObj - Trip object for logging
 * @param {string} timestamp - Timestamp for file naming
 * @param {number} index - Current operation index
 */
async function processOperations(operations, tripObj, timestamp, index = 0) {
    // Base case: all operations processed
    if (index >= operations.length) {
        return;
    }

    const operation = operations[index];
    tripLogger(tripObj, `#FN:DBDebugUpdate: Processing operation ${index + 1}/${operations.length}: ${operation.operationType} ${operation.fieldName}`);

    try {
        // Perform the operation and verify
        await performAndVerifyOperation(operation, tripObj, timestamp, index);

        // Process next operation
        await processOperations(operations, tripObj, timestamp, index + 1);
    } catch (error) {
        // Error is already logged in performAndVerifyOperation
        process.exit(1);
    }
}

/**
 * Perform a single operation and verify it
 * @param {Object} operation - Operation to perform
 * @param {Object} tripObj - Trip object for logging
 * @param {string} timestamp - Timestamp for file naming
 * @param {number} index - Operation index
 */
async function performAndVerifyOperation(operation, tripObj, timestamp, index) {
    const { operationType, fieldName, fieldValue, tripId } = operation;

    try {
        // Log the operation details for debugging
        const valuePreview = Array.isArray(fieldValue)
            ? `array with ${fieldValue.length} items`
            : (typeof fieldValue === 'object' && fieldValue !== null)
                ? 'object'
                : String(fieldValue);

        tripLogger(tripObj, `#FN:DBDebugUpdate: Operation details - ${operationType} ${fieldName}: ${valuePreview}`);

        // Construct the update query
        const updateQuery = {};
        if (operationType === 'set') {
            updateQuery.$set = { [fieldName]: fieldValue };
        } else if (operationType === 'push') {
            updateQuery.$push = { [fieldName]: fieldValue };
        } else {
            throw new Error(`Unknown operation type: ${operationType}`);
        }

        // Perform the update with runValidators to catch schema issues
        const updateResult = await Trip.findByIdAndUpdate(
            tripId,
            updateQuery,
            {
                runValidators: true,
                new: true, // Return the updated document
                projection: { [fieldName]: 1 } // Only return the field we updated
            }
        );

        if (!updateResult) {
            throw new Error(`Trip not found after update`);
        }

        // Query the database again to verify the update
        const updatedTrip = await Trip.findById(tripId).lean();

        if (!updatedTrip) {
            throw new Error(`Trip not found after update`);
        }

        // Verify the update with more detailed checks
        let verificationSuccess = false;
        let verificationMessage = '';

        if (operationType === 'set') {
            // For arrays, do a more thorough check
            if (Array.isArray(fieldValue)) {
                if (!Array.isArray(updatedTrip[fieldName])) {
                    verificationMessage = `Field ${fieldName} is not an array in updated trip`;
                } else if (updatedTrip[fieldName].length === 0 && fieldValue.length > 0) {
                    verificationMessage = `Array ${fieldName} is empty after update, expected ${fieldValue.length} items`;
                } else if (updatedTrip[fieldName].length !== fieldValue.length) {
                    verificationMessage = `Array length mismatch: expected ${fieldValue.length}, got ${updatedTrip[fieldName].length}`;
                } else {
                    verificationSuccess = true;
                    tripLogger(tripObj, `#FN:DBDebugUpdate: Array ${fieldName} updated with ${updatedTrip[fieldName].length} items`);
                }
            }
            // For objects, check if the field exists and has properties
            else if (typeof fieldValue === 'object' && fieldValue !== null) {
                if (!updatedTrip[fieldName]) {
                    verificationMessage = `Field ${fieldName} not found in updated trip`;
                } else if (Object.keys(updatedTrip[fieldName]).length === 0 && Object.keys(fieldValue).length > 0) {
                    verificationMessage = `Object ${fieldName} is empty after update`;
                } else {
                    verificationSuccess = true;
                }
            }
            // For primitive values, check exact equality
            else {
                if (updatedTrip[fieldName] === fieldValue) {
                    verificationSuccess = true;
                } else {
                    verificationMessage = `Value mismatch: expected ${fieldValue}, got ${updatedTrip[fieldName]}`;
                }
            }
        }
        else if (operationType === 'push') {
            // Verify array exists and has elements
            if (!Array.isArray(updatedTrip[fieldName])) {
                verificationMessage = `Field ${fieldName} is not an array in updated trip`;
            } else if (updatedTrip[fieldName].length === 0) {
                verificationMessage = `Array ${fieldName} is empty after push operation`;
            } else {
                verificationSuccess = true;
                tripLogger(tripObj, `#FN:DBDebugUpdate: Array ${fieldName} now has ${updatedTrip[fieldName].length} items after push`);
            }
        }

        if (!verificationSuccess) {
            // Write verification failure details to file
            const errorFilePath = writeObjectToFile({
                operation: operation,
                updateQuery: updateQuery,
                updatedTrip: updatedTrip,
                verificationMessage: verificationMessage
            }, `${tripId}_verification_failed_op${index + 1}_${timestamp}.json`);

            tripLogger(tripObj, `#FN:DBDebugUpdate: Verification failed for operation ${index + 1}: ${verificationMessage}`);
            tripLogger(tripObj, `#FN:DBDebugUpdate: Details written to ${errorFilePath}`);

            throw new Error(`Verification failed: ${verificationMessage}`);
        }

        tripLogger(tripObj, `#FN:DBDebugUpdate: Operation ${index + 1} successful and verified`);

    } catch (error) {
        const errorMsg = `Operation ${index + 1} (${operationType} ${fieldName}) failed: ${error.message}`;
        tripLogger(tripObj, `#FN:DBDebugUpdate: ERROR: ${errorMsg}`);

        // Write error details to file
        writeObjectToFile({
            error: errorMsg,
            operation: operation,
            errorDetails: {
                message: error.message,
                stack: error.stack
            }
        }, `${tripId}_error_op${index + 1}_${timestamp}.json`);

        throw error; // Re-throw to stop processing
    }
}

mongoose.set('debug', true);

module.exports = updateTripRecord; 