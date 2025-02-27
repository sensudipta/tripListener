const redis = require("redis");
const nodemailer = require("nodemailer");

// Redis client configuration
const REDIS_CONFIG = {
    socket: {
        host: 'uniredis1.xtm12q.ng.0001.aps1.cache.amazonaws.com',
        port: 21873
    },
    // Optional: Add retry strategy
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
};

// Create Redis clients
const createRedisClient = async (isSubscriber = false) => {
    const client = redis.createClient(REDIS_CONFIG);

    // Error handling
    client.on('error', (err) => console.error('Redis Client Error:', err));

    if (isSubscriber) {
        // For subscriber client, duplicate the connection
        const subscriber = client.duplicate();
        await subscriber.connect();
        return subscriber;
    }

    // Connect to Redis
    await client.connect();
    return client;
};

// Initialize Redis clients
let redisClient;
let redisSub;

// Add a promise to track initialization
let redisInitialized = false;
let initializationPromise = null;

// Modify the initializeRedis function
const initializeRedis = async () => {
    try {
        redisClient = await createRedisClient(false);
        redisSub = await createRedisClient(true);
        redisInitialized = true;
        console.log('Redis clients connected successfully');
    } catch (err) {
        console.error('Failed to initialize Redis clients:', err);
        throw err;
    }
};

// Add a wait function
const waitForConnection = async () => {
    if (redisInitialized) return;

    if (!initializationPromise) {
        initializationPromise = initializeRedis();
    }

    await initializationPromise;
};

// Initialize Redis on module load
initializeRedis();

// Rest of your configurations
const mailTransport = nodemailer.createTransport({
    host: "mail.roadmatics.in",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
        user: "myservices@mail.roadmatics.in",
        pass: "b@ll3b@ll3"
    }
});

const TRIPDB = "mongodb://172.31.25.209:41114/tripdb";

// Helper functions for Redis operations
const redisHelper = {
    get: async (key) => {
        try {
            return await redisClient.get(key);
        } catch (err) {
            console.error(`Redis GET Error for key ${key}:`, err);
            throw err;
        }
    },
    set: async (key, value) => {
        try {
            return await redisClient.set(key, value);
        } catch (err) {
            console.error(`Redis SET Error for key ${key}:`, err);
            throw err;
        }
    },
    del: async (key) => {
        try {
            return await redisClient.del(key);
        } catch (err) {
            console.error(`Redis DEL Error for key ${key}:`, err);
            throw err;
        }
    },
    lrange: async (key, start, stop) => {
        try {
            return await redisClient.lRange(key, start, stop);
        } catch (err) {
            console.error(`Redis LRANGE Error for key ${key}:`, err);
            throw err;
        }
    }
};

module.exports = {
    redis: redisHelper,  // Export the helper functions instead of the client directly
    redisSub,
    mailTransport,
    TRIPDB,
    waitForConnection  // Add this export
};

