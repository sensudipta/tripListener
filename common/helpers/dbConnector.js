const mongoose = require('mongoose');
const { TRIPDB, redisClient } = require('../liveDB');
const { processLogger } = require('./logger');

/**
 * Initialize database connections
 * @param {boolean} createIfMissing - Whether to create connections if they don't exist
 * @returns {Promise<void>}
 */
async function initializeConnections(createIfMissing = false) {
    try {
        // Check MongoDB connection
        if (mongoose.connection.readyState !== 1) {
            if (createIfMissing) {
                try {
                    await mongoose.connect(TRIPDB, {
                        connectTimeoutMS: 30000,
                        socketTimeoutMS: 30000,
                        serverSelectionTimeoutMS: 5000,
                        maxPoolSize: 10,
                        minPoolSize: 5
                    });
                    processLogger("MongoDB connection established");
                } catch (mongoError) {
                    processLogger(`MongoDB connection error: ${mongoError.message}`);
                    throw mongoError;
                }
            } else {
                processLogger("MongoDB connection not ready");
                throw new Error("MongoDB connection not available");
            }
        } else {
            processLogger("Using existing MongoDB connection");
        }

        // Check Redis connection
        if (!redisClient.isOpen) {
            if (createIfMissing) {
                try {
                    await redisClient.connect();
                    processLogger("Redis connection established");
                } catch (redisError) {
                    processLogger(`Redis connection error: ${redisError.message}`);
                    throw redisError;
                }
            } else {
                processLogger("Redis connection not ready");
                throw new Error("Redis connection not available");
            }
        } else {
            processLogger("Using existing Redis connection");
        }
    } catch (error) {
        processLogger(`Error initializing connections: ${error.message}`);
        throw error;
    }
}

/**
 * Clean up database connections
 * @param {boolean} keepConnection - Whether to keep connections open
 * @returns {Promise<void>}
 */
async function cleanup(keepConnection = false) {
    try {
        if (mongoose.connection.readyState === 1 && !keepConnection) {
            await mongoose.connection.close();
            processLogger("Closed MongoDB connection");
        }

        if (redisClient.isOpen && !keepConnection) {
            await redisClient.quit();
            processLogger("Closed Redis connection");
        }
    } catch (error) {
        processLogger("Error during cleanup:", error);
        throw error;
    }
}

module.exports = {
    initializeConnections,
    cleanup
}; 