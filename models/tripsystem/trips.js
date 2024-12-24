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
        drivingTimeStatus: { type: String, default: 'Good' },
        speedLimit: { type: Number, default: 60 },
        speedStatus: { type: String, default: 'Good' },
        maxHaltTime: { type: Number, default: 60 },
        haltTimeStatus: { type: String, default: 'Good' },
        routeViolationThreshold: { type: Number, default: 2 },
        routeViolationStatus: { type: String, default: 'Good' },
        reverseDrivingThreshold: { type: Number, default: 5 },
        reverseDrivingStatus: { type: String, default: 'Good' },
    },

    // Trip Progress & Status
    lastCheckTime: { type: Date },

    actualStartTime: { type: Date },
    actualEndTime: { type: Date },

    activeStatus: {
        type: String,
        enum: ['Inactive',
            'Reached Origin', 'Detained At Origin',
            'Reached Destination', 'Detained At Destination',
            'Reached Via Location', 'Detained At Via Location',
            'Running On Route', 'Running Off Route', 'Halted',
        ],
        default: 'Inactive',
        required: true,
    },

    tripStage: {
        type: String,
        enum: ['Planned', 'Start Delayed', 'Active', 'Completed', 'Aborted', 'Cancelled'],
        default: 'Planned',
        required: true,
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
                'OverSpeed', 'Night Driving', 'Route Violation',
                'Reverse Driving', 'Max Halt Violation',
                'Reached Origin', 'Detained At Origin',
                'Reached Destination', 'Detained At Destination',
                'Reached Via Location', 'Detained At Via Location',
                'Running On Route', 'Running Off Route', 'Halted',
                'Activated', 'Completed', 'Aborted', 'Cancelled',
            ],
        },
        eventTime: { type: Date },
        eventStartTime: { type: Date },
        eventEndTime: { type: Date },
        eventDuration: { type: Number },
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
    actualRunTime: { type: Number, default: 0 }, // minutes
    averageSpeed: { type: Number, default: 0 }, // km/h
    topSpeed: { type: Number, default: 0 }, // km/h


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
    fuelConsumption: { type: Number, default: 0 }, // liters
    fuelEfficiency: { type: Number, default: 0 }, // km/liter
    fuelStatusUpdateTime: { type: Date },

    endReason: {
        type: String,
        enum: ['TRIP_COMPLETED', 'TRIP_ABORTED', 'TRIP_CANCELLED'],
        default: 'TRIP_COMPLETED',
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
