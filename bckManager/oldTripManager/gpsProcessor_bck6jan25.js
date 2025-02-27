const { spawn } = require('child_process');
const path = require('path');
const liveDB = require('./common/liveDB');
const { redis } = liveDB;
const tripManagerInterval = 5;

// Flag to track if tripManager is running
let isTripManagerRunning = false;

// Function to process GPS data
async function processGPSData(payload) {
    try {
        const data = JSON.parse(payload);
        const imei = String(data.imei);
        //console.log("IMEI data", imei);
        /* if (imei == "358735077543691" || imei == "358735077543691") {
            console.log("Processing GPS data for device:", imei);
        } */
        // Check if device is part of active trips
        const isActiveTrip = await redis.sIsMember('activeTripImeis', imei);
        if (isActiveTrip) {
            //console.log("Active trip detected for device:", imei);
            const gpsRecord = {
                dt_tracker: data.dt_tracker,
                lat: data.lat,
                lng: data.lng,
                speed: data.speed,
                acc: data.acc,
                fuelLevel: data.tank1,
                temperature: data.atmp,
                generatorStatus: (data.di1 === 1 || data.di2 === 1 || data.mdi1 === 1) ? 1 : 0
            };
            // Push to Redis list
            await redis.rPush(`${imei}:rawTripPath`, JSON.stringify(gpsRecord));
        }
    } catch (error) {
        console.error('Error processing GPS data:', error);
    }
}

// Function to run tripManager
async function runTripManager() {
    if (isTripManagerRunning) {
        console.log(getCurrentTimeIST(), 'TripManager is already running');
        return;
    }

    try {
        isTripManagerRunning = true;

        const tripManager = spawn('node', [path.join(__dirname, 'tripManager.js')]);

        tripManager.stdout.on('data', (data) => {
            console.log(getCurrentTimeIST(), `#TMGR: ${data}`);
        });

        tripManager.stderr.on('data', (data) => {
            console.error(getCurrentTimeIST(), `TripManager stderr: ${data}`);
        });

        // Wait for tripManager to complete
        await new Promise((resolve, reject) => {
            tripManager.on('close', (code) => {
                console.log(getCurrentTimeIST(), `TripManager exited with code ${code}\n\n\n`);
                console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
                isTripManagerRunning = false;
                resolve();
            });

            tripManager.on('error', (error) => {
                console.error(getCurrentTimeIST(), 'TripManager error:', error);
                isTripManagerRunning = false;
                reject(error);
            });
        });

    } catch (error) {
        console.error(getCurrentTimeIST(), 'Error running TripManager:', error);
        isTripManagerRunning = false;
    }
}

// Initialize and start the GPS processor
async function init() {
    try {
        console.log(getCurrentTimeIST(), "Initing GPS Processor")

        // Create subscriber client
        await redis.connect();
        console.log(getCurrentTimeIST(), "Redis connected")
        const redisSub = redis.duplicate();
        await redisSub.connect();
        console.log(getCurrentTimeIST(), "Redis Sub connected")

        // Subscribe to fdata channels
        await redisSub.pSubscribe('*:fdata', (message, channel) => {
            processGPSData(message);
        });

        console.log(getCurrentTimeIST(), 'GPS Processor started and listening for data...');

        // Schedule TripManager execution
        setInterval(async () => {
            await runTripManager();
        }, tripManagerInterval * 60 * 1000); // Run every 2 minutes

    } catch (error) {
        console.error(getCurrentTimeIST(), 'Failed to initialize GPS Processor:', error);
        process.exit(1);
    }
}

// Handle process termination
process.on('SIGTERM', () => {
    console.log(getCurrentTimeIST(), 'Shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log(getCurrentTimeIST(), 'Shutting down...');
    process.exit(0);
});

// Start the application
init();

// Helper function to get current time in IST formatted as HH:mm DMMM
function getCurrentTimeIST() {
    const date = new Date();
    // Add 5 hours and 30 minutes for IST
    date.setHours(date.getHours() + 5);
    date.setMinutes(date.getMinutes() + 30);

    // Format hours and minutes
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    // Get date and month
    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();

    return `${hours}:${minutes} ${day}${month}`;
}
