const mongoose = require('mongoose');
const AutoIncrement = require('mongoose-sequence')(mongoose);

const driverSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    driverNumber: {
        type: Number,
        unique: true
    },
    dateOfBirth: {
        type: Date,
        required: true
    },
    photoLink: {
        type: String,  // AWS S3 URL
        required: true
    },
    bloodGroup: {
        type: String,
        required: true,
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
    },
    mobileNumbers: [{
        type: String,
        validate: {
            validator: function (v) {
                return /\d{10}/.test(v);
            },
            message: props => `${props.value} is not a valid phone number!`
        },
        required: true
    }],
    emergencyContact: {
        name: {
            type: String,
            required: true
        },
        number: {
            type: String,
            required: true,
            validate: {
                validator: function (v) {
                    return /\d{10}/.test(v);
                },
                message: props => `${props.value} is not a valid phone number!`
            }
        }
    },
    drivingLicense: {
        number: {
            type: String,
            required: true,
            unique: true
        },
        expiryDate: {
            type: Date,
            required: true
        },
        imageLink: {
            type: String,  // AWS S3 URL
            required: true
        }
    },
    aadhar: {
        number: {
            type: String,
            required: true,
            unique: true,
            validate: {
                validator: function (v) {
                    return /^\d{12}$/.test(v);
                },
                message: props => `${props.value} is not a valid Aadhar number!`
            }
        },
        imageLink: {
            type: String,  // AWS S3 URL
            required: true
        }
    },
    address: {
        current: {
            type: String,
            required: true
        },
        permanent: {
            type: String,
            required: true
        }
    },
    nativeState: {
        type: String,
        required: true
    },
    languagesSpoken: [{
        type: String,
        required: true
    }],
    truck: {
        assignedTruck: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Truck'
        },
        assignmentDate: Date
    },
    yearsOfExperience: {
        type: Number,
        required: true,
        min: 0
    },
    medicalHistory: {
        type: String
    },
    accidentInsurance: {
        policyNumber: {
            type: String,
            required: true
        },
        validUpto: {
            type: Date,
            required: true
        }
    },
    upi: {
        id: {
            type: String,
            required: true
        },
        scanCodeImage: {
            type: String,  // AWS S3 URL
            required: true
        }
    },
    remarks: String
}, {
    timestamps: true
});

// Add auto-increment plugin for driverNumber
driverSchema.plugin(AutoIncrement, { inc_field: 'driverNumber' });

const Driver = mongoose.model('Driver', driverSchema);

module.exports = Driver;