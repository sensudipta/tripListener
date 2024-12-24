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
        zoneCoordinates: { type: [Number] },
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
        zoneCoordinates: { type: [Number] },
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
        zoneCoordinates: { type: [Number] },
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
        drivingStartTime: { type: String, default: '00:00:00' },
        drivingEndTime: { type: String, default: '23:59:59' },
        speedLimit: { type: Number, default: 60 },
        maxHaltTime: { type: Number, default: 60 },
        routeViolationThreshold: { type: Number, default: 2 },
        reverseDrivingThreshold: { type: Number, default: 5 },
    },
    trips: [{ type: ObjectId, ref: 'Trip' }]
}, {
    timestamps: true
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
