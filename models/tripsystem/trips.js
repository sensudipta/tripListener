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

    //trip constraints

    rules: {
        drivingStartTime: { type: String, default: '00:00:00' },
        drivingEndTime: { type: String, default: '23:59:59' },
        speedLimit: { type: Number, default: 60 },
        maxHaltTime: { type: Number, default: 60 },
        routeViolationThreshold: { type: Number, default: 2 },
    },
    ruleStatus: {
        drivingTimeStatus: { type: String, default: 'Normal' },
        speedStatus: { type: String, default: 'Normal' },
        haltTimeStatus: { type: String, default: 'Normal' },
        routeViolationStatus: { type: String, default: 'Normal' },
        reverseTravelPath: {
            type: {
                type: String,
                enum: ['LineString'],
                required: true
            },
            coordinates: { type: [[Number]], required: true },
        },
        reverseTravelDistance: { type: Number, default: 0 },
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
        enum: ['Inactive',
            'Reached Origin', 'Detained At Origin',
            'Reached Via Location', 'Detained At Via Location',
            'Running On Route', 'Route Violated', 'Halted',
            'Reached Destination', 'Detained At Destination',
        ],
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
                required: true
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: true
            }
        },
        locationName: { type: String },
        locationType: {
            type: String,
            enum: ['startLocation', 'endLocation', 'viaLocation'],
            required: true
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
                required: true
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: true
            }
        },
        locationName: { type: String },
        locationType: {
            type: String,
            enum: ['startLocation', 'endLocation', 'viaLocation'],
            required: true
        },
        entryTime: { type: Date },
        exitTime: { type: Date },
        dwellTime: { type: Number },
    }],

    significantEvents: [{
        eventType: {
            type: String,
            enum: [
                'tripStage', 'activeStatus', 'ruleViolation', 'fuelEvent'
            ],
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
                required: true
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: true
            }
        },
        eventPath: {
            type: {
                type: String,
                enum: ['LineString'],
                required: true
            },
            coordinates: { type: [[Number]], required: true },
        },
    }],

    tripPath: [{
        type: {
            type: String,
            enum: ['Point'],
        },
        coordinates: { type: [Number], required: true },
        dtTracker: { type: Date },
        gpsRecord: {
            speed: { type: Number },
            heading: { type: Number },
            acc: { type: Number },
        }
    }],

    movementStatus: {
        type: String,
        enum: ['Moving', 'Halted', 'Unknown'],
        default: 'Unknown',
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
                required: true
            },
            coordinates: { type: [Number], required: true },
        }
    }],
    currentFuelLevel: { type: Number, default: 0 }, // liters
    fuelConsumption: { type: Number, default: 0 }, // liters
    fuelEfficiency: { type: Number, default: 0 }, // km/liter
    fuelStatusUpdateTime: { type: Date },


    sentNotifications: [
        {
            type: {
                type: String,
                enum: ['sms', 'email', 'whatsApp', 'push'],
                required: true
            },
            category: {
                type: String,
                enum: ['tripStage', 'activeStatus', 'ruleViolation', 'finalReport'],
                required: true
            },
            recipient: { name: { type: String }, number: { type: String } },
            message: { type: String },
            sentTime: { type: Date },
        }
    ],
}, {
    timestamps: true
});

// Indexes
tripSchema.index({ tripId: 1 });
tripSchema.index({ 'customer.companyName': 1 });
tripSchema.index({ status: 1 });
tripSchema.index({ plannedStartTime: 1 });
tripSchema.index({ actualStartTime: 1 });
tripSchema.index({ truckRegistrationNumber: 1 });
tripSchema.index({ deviceImei: 1 });


module.exports = mongoose.model('Trip', tripSchema);
