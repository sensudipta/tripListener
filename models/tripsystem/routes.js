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
    routeType: {
        type: String,
        required: true,
        enum: ['oneWayDirect', 'roundTrip', 'oneWayWithStops', 'roundTripWithStops'],
        default: 'oneWayDirect',
    },
    builtFrom: {
        type: String,
        required: true,
        enum: ['googleRouteMaker', 'vehicleHistory', 'manual'],
        default: 'googleRouteMaker',
    },
    segments: [{
        name: { type: String, required: true },
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
            address: { type: String, required: true },
            locationType: {
                type: String,
                enum: ['zone', 'point'],
                required: true
            },
            locationName: { type: String },
            zoneCoordinates: { type: [[Number]] },
            triggerRadius: { type: Number },
            maxDetentionTime: { type: Number },
            purpose: {
                type: String,
                enum: ['Loading', 'Unloading', 'LoadingUnloading', 'Fueling', 'Resting', 'Checkpost', 'Other'],
                required: true,
                default: 'Loading'
            }
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
            address: { type: String, required: true },
            locationType: {
                type: String,
                enum: ['zone', 'point'],
                required: true
            },
            locationName: { type: String },
            zoneCoordinates: { type: [[Number]] },
            triggerRadius: { type: Number },
            maxDetentionTime: { type: Number },
            purpose: {
                type: String,
                enum: ['Loading', 'Unloading', 'LoadingUnloading', 'Fueling', 'Resting', 'Checkpost', 'Other'],
                required: true,
                default: 'Unloading'
            }
        },
        segmentPath: {
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
        segmentLength: { type: Number, required: true, default: 0 },
        segmentDuration: { type: Number, required: true, default: 0 },
        direction: {
            type: String,
            enum: ['up', 'down', 'oneway'],
            required: true,
            default: 'oneway'
        },
        loadType: {
            type: String,
            enum: ['loaded', 'empty', 'none'],
            required: true,
            default: 'none'
        }
    }],
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
        purpose: {
            type: String,
            enum: ['Loading', 'Unloading', 'LoadingUnloading', 'Fueling', 'Resting', 'Checkpost', 'Other'],
            required: true,
            default: 'Loading'
        }
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
        purpose: {
            type: String,
            enum: ['Loading', 'Unloading', 'LoadingUnloading', 'Fueling', 'Resting', 'Checkpost', 'Other'],
            required: true,
            default: 'Unloading'
        }
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
        purpose: {
            type: String,
            enum: ['Loading', 'Unloading', 'LoadingUnloading', 'Fueling', 'Resting', 'Checkpost', 'Other'],
            required: true,
            default: 'LoadingUnloading'
        }
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
        drivingStartTime: { type: String }, // vehicle should not drive before this time
        drivingEndTime: { type: String }, // vehicle should not drive after this time
        speedLimit: { type: Number }, // vehicle should not exceed this speed
        maxHaltTime: { type: Number }, // vehicle should not stay at a location for more than this time
        routeViolationThreshold: { type: Number }, // vehicle should not exceed this distance from the route
        minGeneratorHours: { type: Number }, // vehicle should not run the generator for less than this time
        minGeneratorHoursPercentage: { type: Number }, // vehicle should not run the generator for less than this percentage of the time
        minGeneratorDistance: { type: Number }, // vehicle should not run the generator for less than this distance
        minGeneratorDistancePercentage: { type: Number }, // vehicle should not run the generator for less than this percentage of the distance
        minTemperature: { type: Number }, // vehicle should not be less than this temperature
        maxTemperature: { type: Number }, // vehicle should not be more than this temperature
        maxFuelConsumption: { type: Number }, // vehicle should not consume more than this fuel
        minFuelEfficiency: { type: Number }, // vehicle should not be less than this fuel efficiency
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
    trips: [{ type: ObjectId, ref: 'Trip' }],
    archivedRoutes: [{
        routePath: {
            type: {
                type: String,
                enum: ['LineString'],
                required: true
            },
            coordinates: {
                type: [[Number]],
                required: true
            }
        },
        routeLength: { type: Number, required: true },
        routeDuration: { type: Number, required: true },
        routeName: { type: String, required: true },
        archivedAt: { type: Date, default: Date.now },
        version: { type: String, required: true }
    }],
    routeStatus: {
        type: String,
        enum: ['active', 'inactive', 'deleted'],
        default: 'active',
        required: true
    },
    routeIssues: [{
        type: String,
        default: []
    }]
}, {
    timestamps: true,
    versionKey: '__v'  // Add this line
});

// Create 2dsphere indexes for all GeoJSON fields
routeSchema.index({ 'startLocation.location': '2dsphere' });
routeSchema.index({ 'endLocation.location': '2dsphere' });
routeSchema.index({ 'viaLocations.location': '2dsphere' });
routeSchema.index({ 'routePath': '2dsphere' });
routeSchema.index({ 'segments.startLocation.location': '2dsphere' });
routeSchema.index({ 'segments.endLocation.location': '2dsphere' });
routeSchema.index({ 'segments.segmentPath': '2dsphere' });
routeSchema.index({ routeName: 1 });
routeSchema.index({ ilogistekUserId: 1 });
routeSchema.index({ routeNumber: 1 });
routeSchema.index({ ilogistekUserId: 1, routePath: "2dsphere" });


routeSchema.plugin(AutoIncrement, {
    inc_field: 'routeNumber',
    start_seq: 1
});

module.exports = model('Route', routeSchema);
