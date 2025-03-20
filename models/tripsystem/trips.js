const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const { String, Number, Date, ObjectId } = Schema.Types;

const tripSchema = new Schema({
    iLogistekUserId: { type: Number, required: true },
    tripName: { type: String },
    tripId: { type: String, unique: true, required: true }, // auto-generated
    erpSystemId: String, // Optional ERP system integration ID

    //vehicle and driver info
    truckRegistrationNumber: { type: String, required: true },
    deviceImei: { type: String, required: true },
    driverName: { type: String },
    driverPhoneNumber: { type: String },

    //route
    route: { type: ObjectId, ref: 'Route', required: true },

    //customer and goods
    customer: { type: String, required: true },
    goodsName: { type: String, required: true },
    goodsDescription: { type: String },

    //planned start time
    plannedStartTime: { type: Date, required: true },
    backDated: { type: Boolean, required: true, default: false },

    //trip constraints
    rules: {
        drivingStartTime: { type: String },
        drivingEndTime: { type: String },
        speedLimit: { type: Number },
        maxHaltTime: { type: Number },
        routeViolationThreshold: { type: Number },
        minGeneratorHours: { type: Number },
        minGeneratorHoursPercentage: { type: Number},
        minGeneratorDistance: { type: Number },
        minGeneratorDistancePercentage: { type: Number },
        minTemperature: { type: Number },
        maxTemperature: { type: Number },
        maxFuelConsumption: { type: Number },
        minFuelEfficiency: { type: Number },

    },
    ruleStatus: {
        drivingTimeStatus: { type: String },
        speedStatus: { type: String },
        haltTimeStatus: { type: String },
        routeViolationStatus: { type: String },
        reverseTravelPath: {
            type: {
                type: String,
                enum: ['LineString'],
            },
            coordinates: { type: [[Number]] },
        },
        reverseTravelDistance: { type: Number },
        generatorHours: { type: Number },
        generatorHoursPercentage: { type: Number },
        generatorDistance: { type: Number },
        generatorDistancePercentage: { type: Number },
        minTemperature: { type: Number },
        maxTemperature: { type: Number },
    },
    notifications: {
        sms: [{
            name: { type: String },
            number: { type: String },
            categories: [{
                type: String,
                enum: ['tripStage', 'activeStatus', 'ruleViolation']
            }]
        }],
        whatsApp: [{
            name: { type: String }, number: { type: String }, categories: [{
                type: String,
                enum: ['tripStage', 'activeStatus', 'ruleViolation', 'finalReport']
            }]
        }],
        telegram: [{
            name: { type: String }, number: { type: String }, categories: [{
                type: String,
                enum: ['tripStage', 'activeStatus', 'ruleViolation', 'finalReport']
            }]
        }],
        email: [{
            name: { type: String }, email: { type: String }, categories: [{
                type: String,
                enum: ['tripStage', 'activeStatus', 'ruleViolation', 'finalReport']
            }]
        }],
        push: [{
            name: { type: String }, token: { type: String }, categories: [{
                type: String,
                enum: ['tripStage', 'activeStatus', 'ruleViolation']
            }]
        }],
    },


    // Trip Progress & Status
    lastCheckTime: { type: Date },

    actualStartTime: { type: Date },
    actualEndTime: { type: Date },
    endReason: {
        type: String,
        enum: ['Trip Completed', 'Trip Aborted', 'Trip Cancelled'],
        default: 'Trip Completed',
    },
    abortReason: {
        type: String,
    },
    endLocation: {
        coordinates: {
            type: [Number], // [longitude, latitude]
            index: '2dsphere'
        },
        address: String
    },

    activeStatus: {
        type: String,
        default: 'Inactive',
        required: true,
    },

    tripStage: {
        type: String,
        enum: ['Planned', 'Start Delayed', 'Active',
            'Completed', 'Aborted', 'Cancelled'],
        default: 'Planned',
        required: true,
    },

    currentSignificantLocation: {
        location: {
            type: {
                type: String,
                enum: ['Point'],
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
            }
        },
        locationName: { type: String },
        locationType: {
            type: String,
            enum: ['startLocation', 'endLocation', 'viaLocation'],
        },
        entryTime: { type: Date },
        exitTime: { type: Date },
        dwellTime: { type: Number },
    },

    significantLocations: [{
        location: {
            type: {
                type: String,
                enum: ['Point'],
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
            }
        },
        locationName: { type: String },
        locationType: {
            type: String,
            enum: ['startLocation', 'endLocation', 'viaLocation'],
        },
        entryTime: { type: Date },
        exitTime: { type: Date },
        dwellTime: { type: Number },
    }],

    // Add this field to the schema
    hasExitedEndLocation: { type: Boolean, default: false },

    // Segment tracking fields
    currentlyActiveSegmentIndex: { type: Number, default: -1 }, // -1 means no active segment yet
    currentlyActiveSegment: {
        segmentIndex: { type: Number },
        name: { type: String },
        direction: { type: String, enum: ['up', 'down', 'oneway'] },
        loadType: { type: String, enum: ['loaded', 'empty', 'none'] },
        startTime: { type: Date },
        status: {
            type: String,
            enum: ['not_started', 'running', 'completed'],
            default: 'not_started'
        },
        distanceCovered: { type: Number, default: 0 },
        distanceRemaining: { type: Number, default: 0 },
        completionPercentage: { type: Number, default: 0 },
        estimatedTimeOfArrival: { type: Date },
        nearestPointIndex: { type: Number, default: 0 },
        startLocation: {
            locationName: { type: String },
            arrivalTime: { type: Date },
            departureTime: { type: Date },
            dwellTime: { type: Number },
        },
        endLocation: {
            locationName: { type: String },
            arrivalTime: { type: Date },
            departureTime: { type: Date },
            dwellTime: { type: Number },
        },
    },

    segmentHistory: [{
        segmentIndex: { type: Number, required: true },
        name: { type: String, required: true },
        direction: { type: String, enum: ['up', 'down', 'oneway'], required: true },
        loadType: { type: String, enum: ['loaded', 'empty', 'none'], required: true },
        startTime: { type: Date },
        endTime: { type: Date },
        status: {
            type: String,
            enum: ['not_started', 'running', 'completed'],
            default: 'not_started',
            required: true
        },
        distanceCovered: { type: Number, default: 0 },
        distanceRemaining: { type: Number, default: 0 },
        completionPercentage: { type: Number, default: 0 },
        estimatedTimeOfArrival: { type: Date },
        nearestPointIndex: { type: Number, default: 0 },
        startLocation: {
            locationName: { type: String },
            arrivalTime: { type: Date },
            departureTime: { type: Date },
            dwellTime: { type: Number },
            tripPathIndex: { type: Number },
        },
        endLocation: {
            locationName: { type: String },
            arrivalTime: { type: Date },
            departureTime: { type: Date },
            dwellTime: { type: Number },
            tripPathIndex: { type: Number },
        },
    }],

    significantEvents: [{
        eventType: {
            type: String,
        },
        eventName: { type: String },
        eventTime: { type: Date },
        eventStartTime: { type: Date },
        eventEndTime: { type: Date },
        eventDuration: { type: Number },
        eventDistance: { type: Number },
        eventLocation: {
            type: {
                type: String,
                enum: ['Point'],
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
            }
        },
        eventStartTripPathIndex: { type: Number },
        eventEndTripPathIndex: { type: Number },
    }],

    tripPath: [{
        type: {
            type: String,
            enum: ['Point'],
        },
        coordinates: { type: [Number] },
        dt_tracker: { type: Date },
        gpsRecord: {
            speed: { type: Number },
            heading: { type: Number },
            acc: { type: Number },
        },
        fuelLevel: { type: Number },
    }],

    movementStatus: {
        type: String,
        enum: ['Driving', 'Halted', 'Unknown'],
        default: 'Halted',
    },

    distanceCovered: { type: Number, default: 0 }, // kilometers
    distanceRemaining: { type: Number, default: 0 }, // kilometers
    completionPercentage: { type: Number, default: 0 },
    estimatedTimeOfArrival: Date,
    parkedDuration: { type: Number, default: 0 }, // minutes
    runDuration: { type: Number, default: 0 }, // minutes
    averageSpeed: { type: Number, default: 0 }, // km/h
    topSpeed: { type: Number, default: 0 }, // km/h
    truckRunDistance: { type: Number, default: 0 }, // kilometers
    nearestRoutePoint: { lat: { type: Number }, lng: { type: Number } }, // kilometers
    nearestPointIndex: { type: Number, default: 0 }, // kilometers


    haltStartTime: { type: Date },
    currentHaltDuration: { type: Number, default: 0 },
    reverseDrivingStartTime: { type: Date },
    reverseDrivingDuration: { type: Number, default: 0 },
    reverseDrivingDistance: { type: Number, default: 0 },
    routeViolationStartTime: { type: Date },
    routeViolationDuration: { type: Number, default: 0 },
    routeViolationDistance: { type: Number, default: 0 },

    //violation counts
    reverseDrivingCount: { type: Number, default: 0 },
    overSpeedCount: { type: Number, default: 0 },
    nightDrivingCount: { type: Number, default: 0 },
    routeViolationCount: { type: Number, default: 0 },
    maxHaltViolationCount: { type: Number, default: 0 },
    startLocationDetentionViolation: { type: Number, default: 0 }, //minutes    
    endLocationDetentionViolation: { type: Number, default: 0 }, //minutes
    viaLocationDetentionViolation: { type: Number, default: 0 }, //minutes

    fuelEvents: [{
        eventType: {
            type: String,
            enum: ['Filling', 'Theft'],
        },
        eventTime: { type: Date },
        volume: { type: Number }, // liters
        location: {
            type: {
                type: String,
                enum: ['Point'],
            },
            coordinates: { type: [Number] },
        }
    }],
    currentFuelLevel: { type: Number, default: 0 }, // liters
    fuelConsumption: { type: Number, default: 0 }, // liters
    fuelEfficiency: { type: Number, default: 0 }, // km/liter
    fuelStatusUpdateTime: { type: Date },

    //generator Status
    generatorStatus: { type: String, default: 'Off' },
    generatorStatusUpdateTime: { type: Date },

    //temperature Status
    temperatureStatus: { type: Number, default: 0 },
    temperatureStatusUpdateTime: { type: Date },

    sentNotifications: [
        {
            type: {
                type: String,
                enum: ['sms', 'email', 'whatsApp', 'push'],
            },
            category: {
                type: String,
                enum: ['tripStage', 'activeStatus', 'ruleViolation', 'finalReport'],
            },
            recipient: { name: { type: String }, number: { type: String } },
            message: { type: String },
            sentTime: { type: Date },
        }
    ],
    tripDataFile: { type: String },
}, {
    timestamps: true,
    versionKey: '__v'  // Add this line
});

// Indexes
//tripSchema.index({ tripId: 1 });
tripSchema.index({ 'customer.companyName': 1 });
tripSchema.index({ status: 1 });
tripSchema.index({ plannedStartTime: 1 });
tripSchema.index({ actualStartTime: 1 });
tripSchema.index({ truckRegistrationNumber: 1 });
tripSchema.index({ deviceImei: 1 });


module.exports = mongoose.model('Trip', tripSchema);

/*
enum: ['Inactive',
            'Reached Start Location', 'Detained At Start Location',
            'Reached Via Location', 'Detained At Via Location',
            'Running On Route', 'Route Violated', 'Halted',
            'Reached End Location', 'Detained At End Location',
        ],
*/