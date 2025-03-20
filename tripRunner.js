const mongoose = require('mongoose');
const { spawn } = require('child_process');
const os = require('os');
const { Trip } = require('./models');
const { tripLogger, processLogger } = require('./common/helpers/logger');
const { TRIPDB, redisClient } = require('./common/liveDB');

class TripRunner {
    constructor() {
        // Configuration
        this.maxConcurrentProcesses = 1; // Maximum number of concurrent trips to process
        this.runInterval = 5 * 60 * 1000; // 5 minutes in milliseconds
        this.processTimeout = 300000; // 5 minutes timeout for each process
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 seconds
        this.backDatedTripsKey = 'backdatedTrips';
        this.checkProcessInterval = 5000; // Check for available slots every 5 seconds

        // State tracking
        this.activeProcesses = new Map(); // Map of tripId -> process info
        this.isRunning = false; // Flag to prevent overlapping runs
        this.pendingBackdatedTrips = []; // Queue of backdated trips waiting to be processed
        this.pendingLiveTrips = []; // Queue of live trips waiting to be processed

        // Process monitoring
        this.processMonitorIntervalId = null;
    }

    async initialize() {
        try {
            processLogger("Initializing TripRunner...");

            // Connect to MongoDB
            try {
                processLogger("Connecting to MongoDB...");
                await mongoose.connect(TRIPDB, {
                    maxPoolSize: 10,
                    socketTimeoutMS: 30000,
                    connectTimeoutMS: 10000,
                    serverSelectionTimeoutMS: 5000,
                    family: 4  // Force IPv4
                });
                processLogger("MongoDB connection established");
            } catch (error) {
                processLogger("Error connecting to MongoDB: " + error.message);
                process.exit(1);
            }

            // Connect to Redis
            try {
                await redisClient.connect();
                processLogger("Redis connection established");
            } catch (error) {
                processLogger("Error connecting to Redis: " + error.message);
                process.exit(1);
            }

            // Setup shutdown handlers
            this.setupShutdownHandlers();

            // Start the process monitor
            this.startProcessMonitor();

            // Start the periodic runner
            this.startPeriodicRunner();

            processLogger(`TripRunner initialized with max ${this.maxConcurrentProcesses} concurrent processes`);

        } catch (error) {
            processLogger("Error initializing TripRunner:", error);
            process.exit(1);
        }
    }

    // Start the process monitor to continuously check for available slots
    startProcessMonitor() {
        if (this.processMonitorIntervalId) {
            clearInterval(this.processMonitorIntervalId);
        }

        this.processMonitorIntervalId = setInterval(() => {
            this.checkAndLaunchPendingTrips();
        }, this.checkProcessInterval);

        processLogger("Process monitor started");
    }

    // Check for available slots and launch pending trips
    checkAndLaunchPendingTrips() {
        // Calculate available slots
        const availableSlots = this.maxConcurrentProcesses - this.activeProcesses.size;

        if (availableSlots <= 0) {
            return; // No available slots
        }

        // First prioritize backdated trips
        let slotsUsed = 0;
        while (slotsUsed < availableSlots && this.pendingBackdatedTrips.length > 0) {
            const tripId = this.pendingBackdatedTrips.shift();
            this.launchBackdatedTripProcessor(tripId).catch(error => {
                processLogger(`Error launching backdated trip ${tripId}: ${error.message}`);
            });
            slotsUsed++;
        }

        // Then process live trips with remaining slots
        while (slotsUsed < availableSlots && this.pendingLiveTrips.length > 0) {
            const trip = this.pendingLiveTrips.shift();
            this.launchTripProcessor(trip).catch(error => {
                processLogger(`Error launching live trip ${trip._id}: ${error.message}`);
            });
            slotsUsed++;
        }

        if (slotsUsed > 0) {
            processLogger(`Launched ${slotsUsed} trips (${this.activeProcesses.size}/${this.maxConcurrentProcesses} processes active)`);
        }
    }

    startPeriodicRunner() {
        // Run immediately on startup
        this.start().catch(error => {
            processLogger("Error in initial run:", error);
        });

        // Then schedule to run every 5 minutes
        setInterval(async () => {
            try {
                if (!this.isRunning) {
                    await this.start();
                } else {
                    processLogger("Previous run still in progress, skipping this interval");
                }
            } catch (error) {
                processLogger("Error in scheduled run:", error);
            }
        }, this.runInterval);

        processLogger(`Scheduled to run every ${this.runInterval / 60000} minutes`);
    }

    async start() {
        if (this.isRunning) {
            processLogger("Previous execution still running, skipping this run");
            return;
        }

        try {
            this.isRunning = true;
            processLogger("Starting scheduled TripRunner execution");

            // Process any backdated trips first
            await this.processBackdatedTrips();

            // Then process regular trips (uncomment when needed)
            await this.processTrips();

            processLogger("Completed scheduled TripRunner execution");
        } catch (error) {
            processLogger("Error in TripRunner execution:", error);
        } finally {
            this.isRunning = false;
        }
    }

    async processTrips() {
        try {
            // Get trips that need processing
            const trips = await Trip.find({
                tripStage: { $in: ['Planned', 'Start Delayed', 'Active'] },
                backDated: { $ne: true } // Exclude backdated trips
            }).limit(100); // Limit to a reasonable number

            processLogger(`Found ${trips.length} active trips to process`);

            // Clear pending live trips and add new ones
            this.pendingLiveTrips = trips;

            // Initial batch of launches will be handled by checkAndLaunchPendingTrips
            this.checkAndLaunchPendingTrips();

            return trips.length;
        } catch (error) {
            processLogger("Error processing trips:", error);
            return 0;
        }
    }

    async launchTripProcessor(trip) {
        try {
            const tripId = trip._id.toString();

            // Skip if already processing this trip
            if (this.activeProcesses.has(tripId)) {
                processLogger(`Trip ${tripId} already being processed, skipping`);
                return false;
            }

            processLogger(`Launching processor for trip ${tripId}`);

            // Create new process for trip
            const childProcess = spawn('node', ['liveTripMaster.js'], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    TRIP_ID: tripId
                }
            });

            // Set process timeout
            const timeout = setTimeout(() => {
                if (this.activeProcesses.has(tripId)) {
                    const processInfo = this.activeProcesses.get(tripId);
                    if (processInfo && processInfo.process && !processInfo.process.killed) {
                        processInfo.process.kill();
                        processLogger(`Process timeout for trip ${tripId}`);
                    }
                    this.activeProcesses.delete(tripId);

                    // Check if we can launch more trips
                    this.checkAndLaunchPendingTrips();
                }
            }, this.processTimeout);

            // Handle process events
            childProcess.stdout.on('data', (data) => {
                const output = data.toString().trim();
                if (output) {
                    processLogger(`Trip ${tripId} output: ${output}`);
                }
            });

            childProcess.stderr.on('data', (data) => {
                const error = data.toString().trim();
                if (error) {
                    processLogger(`Trip ${tripId} error: ${error}`);
                    console.error(`Trip ${tripId} error: ${error}`);
                }
            });

            childProcess.on('close', (code) => {
                clearTimeout(timeout);
                this.activeProcesses.delete(tripId);
                processLogger(`Trip ${tripId} process exited with code ${code}`);
                console.log(`Trip ${tripId} process exited with code ${code}`);

                // Handle non-zero exit code if needed
                if (code !== 0) {
                    this.handleProcessError(tripId, trip);
                }

                // Check if we can launch more trips
                this.checkAndLaunchPendingTrips();
            });

            // Store process reference
            this.activeProcesses.set(tripId, {
                process: childProcess,
                startTime: Date.now(),
                retries: 0
            });

            processLogger(`Launched processor for trip ${tripId} (${this.activeProcesses.size}/${this.maxConcurrentProcesses} processes active)`);
            return true;
        } catch (error) {
            processLogger(`Error launching processor for trip ${trip._id}:`, error);
            await this.handleProcessError(trip._id.toString(), trip);
            return false;
        }
    }

    async handleProcessError(tripId, trip) {
        const processInfo = this.activeProcesses.get(tripId);
        if (!processInfo) return;

        if (processInfo.retries < this.maxRetries) {
            processInfo.retries++;
            processLogger(`Retrying trip ${tripId} (attempt ${processInfo.retries}/${this.maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, this.retryDelay));

            // Add back to pending queue instead of immediately retrying
            this.pendingLiveTrips.push(trip);
            this.activeProcesses.delete(tripId);

            // Check if we can launch more trips
            this.checkAndLaunchPendingTrips();
        } else {
            processLogger(`Max retries (${this.maxRetries}) reached for trip ${tripId}, giving up`);
            this.activeProcesses.delete(tripId);

            // Check if we can launch more trips
            this.checkAndLaunchPendingTrips();
        }
    }

    setupShutdownHandlers() {
        process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
        process.on('SIGINT', () => this.handleShutdown('SIGINT'));
        process.on('uncaughtException', (error) => {
            processLogger(`Uncaught exception: ${error.message}`);
            processLogger(error.stack);
            this.handleShutdown('uncaughtException');
        });
    }

    async handleShutdown(signal) {
        processLogger(`Received ${signal}, initiating graceful shutdown...`);

        // Stop the process monitor
        if (this.processMonitorIntervalId) {
            clearInterval(this.processMonitorIntervalId);
            this.processMonitorIntervalId = null;
        }

        // Kill all active processes
        for (const [tripId, processInfo] of this.activeProcesses.entries()) {
            try {
                if (processInfo.process && !processInfo.process.killed) {
                    processInfo.process.kill();
                    processLogger(`Killed process for trip ${tripId}`);
                }
            } catch (error) {
                processLogger(`Error killing process for trip ${tripId}:`, error);
            }
        }

        // Close connections
        try {
            await mongoose.connection.close();
            await redisClient.quit();
            processLogger("Closed database connections");
        } catch (error) {
            processLogger("Error closing connections:", error);
        }

        process.exit(0);
    }

    async processBackdatedTrips() {
        try {
            processLogger("Starting to process backdated trips from Redis queue");

            // Track total trips to process
            const maxTripsToRead = 100; // Safety limit
            this.pendingBackdatedTrips = []; // Clear existing queue

            // Get trips from Redis queue
            for (let i = 0; i < maxTripsToRead; i++) {
                const tripId = await redisClient.lPop(this.backDatedTripsKey);
                if (!tripId) break; // No more trips in queue
                this.pendingBackdatedTrips.push(tripId);
            }

            processLogger(`Found ${this.pendingBackdatedTrips.length} backdated trips in queue`);

            // Initial launches will be handled by checkAndLaunchPendingTrips
            this.checkAndLaunchPendingTrips();

            return this.pendingBackdatedTrips.length;
        } catch (error) {
            processLogger("Error processing backdated trips:", error);
            return 0;
        }
    }

    async launchBackdatedTripProcessor(tripId) {
        try {
            // Skip if already processing this trip
            if (this.activeProcesses.has(tripId)) {
                processLogger(`Trip ${tripId} already being processed, skipping`);
                return false;
            }

            processLogger(`Launching backdated processor for trip ${tripId}`);

            // Create the child process
            const childProcess = spawn('node', ['backDateTripMaster.js'], {
                env: { ...process.env, TRIP_ID: tripId },
                stdio: 'pipe'
            });

            // Set process timeout
            const timeout = setTimeout(async () => {
                processLogger(`Backdated trip ${tripId} processing timed out after ${this.processTimeout / 60000} minutes`);

                if (this.activeProcesses.has(tripId)) {
                    const process = this.activeProcesses.get(tripId);
                    if (process && !process.killed) {
                        process.kill();
                    }
                    this.activeProcesses.delete(tripId);

                    // Push tripId back to Redis for retry
                    try {
                        await redisClient.rPush(this.backDatedTripsKey, tripId);
                        processLogger(`Pushed trip ${tripId} back to Redis queue after timeout`);
                    } catch (redisError) {
                        processLogger(`Failed to push trip ${tripId} back to Redis: ${redisError.message}`);
                    }

                    // Check if we can launch more trips
                    this.checkAndLaunchPendingTrips();
                }
            }, this.processTimeout);

            // Store in active processes
            this.activeProcesses.set(tripId, childProcess);

            // Handle process output
            childProcess.stdout.on('data', (data) => {
                const output = data.toString().trim();
                if (output) {
                    processLogger(`Backdated trip ${tripId} output: ${output}`);
                }
            });

            childProcess.stderr.on('data', (data) => {
                const error = data.toString().trim();
                if (error) {
                    processLogger(`Backdated trip ${tripId} error: ${error}`);
                }
            });

            // Handle process exit
            childProcess.on('close', async (code) => {
                clearTimeout(timeout);
                this.activeProcesses.delete(tripId);

                /*if (code !== 0) {
                    processLogger(`Backdated trip ${tripId} process exited with code ${code}`);

                    // Push tripId back to Redis for retry on non-zero exit code
                    try {
                        await redisClient.rPush(this.backDatedTripsKey, tripId);
                        processLogger(`Pushed trip ${tripId} back to Redis queue after exit code ${code}`);
                    } catch (redisError) {
                        processLogger(`Failed to push trip ${tripId} back to Redis: ${redisError.message}`);
                    }
                } else {
                    processLogger(`Backdated trip ${tripId} processed successfully`);
                }*/
                processLogger(`Backdated trip ${tripId} processed successfully`);
                // Check if we can launch more trips
                this.checkAndLaunchPendingTrips();
            });

            // Handle launch errors
            childProcess.on('error', async (error) => {
                clearTimeout(timeout);
                this.activeProcesses.delete(tripId);
                processLogger(`Error launching backdated trip processor for ${tripId}: ${error.message}`);

                // Push tripId back to Redis for retry
                /* try {
                    await redisClient.rPush(this.backDatedTripsKey, tripId);
                    processLogger(`Pushed trip ${tripId} back to Redis queue after launch error`);
                } catch (redisError) {
                    processLogger(`Failed to push trip ${tripId} back to Redis: ${redisError.message}`);
                } */

                // Check if we can launch more trips
                this.checkAndLaunchPendingTrips();
            });

            processLogger(`Launched backDateTripMaster.js for trip ${tripId} (${this.activeProcesses.size}/${this.maxConcurrentProcesses} processes active)`);
            return true;

        } catch (error) {
            processLogger(`Failed to launch backdated trip processor for ${tripId}: ${error.message}`);

            // Push tripId back to Redis for retry
            /* try {
                await redisClient.rPush(this.backDatedTripsKey, tripId);
                processLogger(`Pushed trip ${tripId} back to Redis queue after catch error`);
            } catch (redisError) {
                processLogger(`Failed to push trip ${tripId} back to Redis: ${redisError.message}`);
            } */

            // Check if we can launch more trips
            this.checkAndLaunchPendingTrips();
            return false;
        }
    }
}

// Start the runner
const runner = new TripRunner();
runner.initialize().catch(error => {
    processLogger("Fatal error:", error);
    process.exit(1);
}); 