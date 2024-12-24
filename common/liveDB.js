const redis = require("redis");
const nodemailer = require("nodemailer");
const asyncRedis = require("async-redis");

const readConn = {
    host: "roadmaticsstatic-1.cluster-ro-cm7uxzduxld2.ap-south-1.rds.amazonaws.com",
    port: 16161,
    database: 'ilogistek_static',
    user: 'iniya',
    password: 'khardungla2008',
    waitForConnections: true
};

const writeConn = {
    host: "roadmaticsstatic-1.cluster-cm7uxzduxld2.ap-south-1.rds.amazonaws.com",
    port: 16161,
    database: 'ilogistek_static',
    user: 'iniya',
    password: 'khardungla2008',
    waitForConnections: true
};


const redisClient = redis.createClient('21873', 'uniredis1.xtm12q.ng.0001.aps1.cache.amazonaws.com');
const redisSub = redis.createClient('21873', 'uniredis1.xtm12q.ng.0001.aps1.cache.amazonaws.com');
const asyncRedisClient = asyncRedis.createClient('21873', 'uniredis1.xtm12q.ng.0001.aps1.cache.amazonaws.com');
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

module.exports = {
    redis: redisClient,
    asyncRedis: asyncRedisClient,
    redisSub: redisSub,
    mailTransport: mailTransport,
    readConn: readConn,
    writeConn: writeConn,
    TRIPDB: TRIPDB
};

