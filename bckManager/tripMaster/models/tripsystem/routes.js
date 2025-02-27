const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const AutoIncrement = require('mongoose-sequence')(mongoose);
const { ObjectId, String, Number, Date } = mongoose.Schema.Types;

const routeSchema = new Schema({
    routeName: {
        type: String,
        required: true
    },
    routeNumber: {
        type: Number
    },
    builtFrom: {
        type: String,
        required: true,
        enum: ['googleRouteMaker', 'vehicleHistory', 'manual'],
        default: 'googleRouteMaker',
    },
    startLocation: {
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
        address: {
            type: String,
            required: true
        },
        locationType: {
            type: String,
            enum: ['zone', 'point'],
            required: true
        },
        locationName: { type: String },
        zoneCoordinates: { type: [[Number]] },
        triggerRadius: { type: Number },
        maxDetentionTime: { type: Number },
    },
    endLocation: {
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
        address: {
            type: String,
            required: true
        },
        locationType: {
            type: String,
            enum: ['zone', 'point'],
            required: true
        },
        locationName: { type: String },
        zoneCoordinates: { type: [[Number]] },
        triggerRadius: { type: Number },
        maxDetentionTime: { type: Number },
    },

    viaLocations: [{
        location: {
            type: {
                type: String,
                enum: ['Point'],
                required: true
            },
            coordinates: {
                type: [Number],
                required: true
            }
        },
        address: {
            type: String,
            required: true
        },
        locationType: {
            type: String,
            enum: ['zone', 'point'],
            required: true
        },
        locationName: { type: String },
        zoneCoordinates: { type: [[Number]] },
        triggerRadius: { type: Number },
        maxDetentionTime: { type: Number },
    }],
    routePath: {
        type: {
            type: String,
            enum: ['LineString'],
            required: true
        },
        coordinates: {
            type: [[Number]], // Array of [longitude, latitude]
            required: true
        }
    },
    routeLength: {
        type: Number,
        required: true,
        default: 0
    },
    routeDuration: {
        type: Number,
        required: true,
        default: 0
    },
    ilogistekUserId: {
        type: Number,
        required: true
    },
    rules: {
        drivingStartTime: { type: String },
        drivingEndTime: { type: String },
        speedLimit: { type: Number },
        maxHaltTime: { type: Number },
        routeViolationThreshold: { type: Number },
        minGeneratorHours: { type: Number },
        minGeneratorHoursPercentage: { type: Number },
        minGeneratorDistance: { type: Number },
        minGeneratorDistancePercentage: { type: Number },
        minTemperature: { type: Number },
        maxTemperature: { type: Number },
        maxFuelConsumption: { type: Number },
        minFuelEfficiency: { type: Number },
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
    trips: [{ type: ObjectId, ref: 'Trip' }]
}, {
    timestamps: true,
    versionKey: '__v'  // Add this line
});

// Create 2dsphere indexes for all GeoJSON fields
routeSchema.index({ 'startLocation.location': '2dsphere' });
routeSchema.index({ 'endLocation.location': '2dsphere' });
routeSchema.index({ 'viaLocations.location': '2dsphere' });
routeSchema.index({ 'routePath': '2dsphere' });
routeSchema.index({ routeName: 1 });
routeSchema.index({ ilogistekUserId: 1 });
routeSchema.index({ routeNumber: 1 });
routeSchema.index({ ilogistekUserId: 1, routePath: "2dsphere" });


routeSchema.plugin(AutoIncrement, {
    inc_field: 'routeNumber',
    start_seq: 1
});

module.exports = model('Route', routeSchema);
