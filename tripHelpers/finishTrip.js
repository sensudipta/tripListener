const { Trip } = require('../models');
const { tripLogger } = require('../common/helpers/logger');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const alertSender = require('./alertSender');

// Initialize the S3 client
const s3Client = new S3Client({
    region: 'ap-south-1',
    sslEnabled: true,
    maxRetries: 3,
    // SDK v3 uses named profiles differently
    credentials: {
        profile: 'ubuntu'
    },
    // Timeout is now set via request-specific commands
});

// Fields to retain in MongoDB
const RETAIN_FIELDS = [
    '_id', 'iLogistekUserId', 'tripName', 'tripId', 'erpSystemID',
    'truckRegistrationNumber', 'deviceImei', 'driverName',
    'route', 'customer', 'goodsName',
    'plannedStartTime', 'actualStartTime', 'actualEndTime',
    'endReason', 'tripStage', 'activeStatus', 'backDated',
    'truckRunDistance', 'fuelConsumption', 'fuelEfficiency',
    'tripDataFile'
];

/**
 * Upload trip data to S3 and clean MongoDB record
 * @param {Object} trip - Complete trip object
 * @returns {Promise<boolean>} - Success status
 */
async function finishTrip(trip) {
    try {
        if (!trip?._id) {
            tripLogger(trip, '#FN:FinishTrip: Error: Invalid trip or missing _id');
            return false;
        }

        // Send final trip report alert
        const alertEvent = {
            eventType: 'Final Report',
            eventText: `Trip ${trip.tripId} completed and archived`,
            eventTime: new Date()
        };

        try {
            await alertSender(trip, alertEvent, 'finalReport');
            tripLogger(trip, `#FN:FinishTrip: Sent final trip report alert`);
        } catch (alertError) {
            tripLogger(trip, `#FN:FinishTrip: Error sending final alert: ${alertError.message}`);
        }

        // 1. Upload to S3
        const tripData = trip.toObject ? trip.toObject() : trip;
        const fileName = `${trip.tripId}.json`;

        try {
            const uploadParams = {
                Bucket: 'ilogistekdata',
                Key: `tripData/${fileName}`,
                Body: JSON.stringify(tripData, null, 2),
                ContentType: 'application/json'
            };

            // Create and execute the put object command with timeout
            const command = new PutObjectCommand(uploadParams);
            const uploadResult = await s3Client.send(command, { requestTimeout: 15000 });

            // v3 doesn't return Location directly, so we construct it
            const s3Location = `https://${uploadParams.Bucket}.s3.${s3Client.config.region}.amazonaws.com/${uploadParams.Key}`;
            tripLogger(trip, `#FN:FinishTrip: Trip data uploaded to S3: ${s3Location}`);

            // 2. Create clean object with only retained fields
            const cleanTrip = {};
            RETAIN_FIELDS.forEach(field => {
                if (tripData[field] !== undefined) {
                    cleanTrip[field] = tripData[field];
                }
            });

            // 3. Add S3 file location
            cleanTrip.tripDataFile = s3Location;

            // 4. Replace MongoDB document with clean version
            const result = await Trip.replaceOne(
                { _id: trip._id },
                cleanTrip,
                { runValidators: true }
            );

            if (!result.acknowledged) {
                throw new Error('Failed to update trip record');
            }

            tripLogger(trip, '#FN:FinishTrip: Trip record cleaned and updated successfully');
            return true;

        } catch (uploadError) {
            tripLogger(trip, `#FN:FinishTrip: S3 upload error: ${uploadError.message}`);
            throw uploadError;
        }

    } catch (err) {
        console.error(`Failed to finish trip ${trip._id}:`, err);
        tripLogger(trip, `#FN:FinishTrip: Fatal Error: ${err.message}`);
        return false;
    }
}

/**
 * Retry wrapper for finishTrip
 * @param {Object} trip - Trip object
 * @returns {Promise<boolean>} - Success status
 */
async function processFinishTrip(trip) {
    const MAX_RETRIES = 3;
    let retryCount = 0;

    while (retryCount < MAX_RETRIES) {
        try {
            const success = await finishTrip(trip);
            if (success) return true;

            retryCount++;
            tripLogger(trip, `#FN:FinishTrip: Retry ${retryCount}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));

        } catch (error) {
            retryCount++;
            if (retryCount === MAX_RETRIES) {
                tripLogger(trip, '#FN:FinishTrip: Max retries reached');
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
        }
    }

    return false;
}

module.exports = processFinishTrip;
