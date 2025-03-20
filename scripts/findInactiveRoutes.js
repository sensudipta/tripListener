/**
 * Script to find routes that are not active
 * 
 * This script:
 * 1. Connects to MongoDB
 * 2. Finds all routes where routeStatus is not 'active'
 * 3. Shows detailed information about these routes
 * 
 * Usage: node scripts/findInactiveRoutes.js
 */

const mongoose = require('mongoose');
const Route = require('../models/tripsystem/routes');
const liveDB = require('../common/liveDB');
const { TRIPDB } = liveDB;

// Connect to MongoDB
mongoose.connect(TRIPDB, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB');
    findInactiveRoutes();
}).catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
});

async function findInactiveRoutes() {
    try {
        // Find routes that are not active
        const routes = await Route.find({
            $or: [
                { routeStatus: 'inactive' },
                { routeStatus: 'deleted' },
                { routeStatus: { $exists: false } },
                { routeStatus: null },
                { routeStatus: '' }
            ]
        });

        console.log(`\nFound ${routes.length} inactive routes:`);
        console.log('----------------------------------------');

        if (routes.length === 0) {
            console.log('No inactive routes found.');
        } else {
            // Group routes by status
            const routesByStatus = {
                'inactive': [],
                'deleted': [],
                'no_status': []
            };

            // Process each route
            routes.forEach(route => {
                let status = route.routeStatus;
                if (!status) status = 'no_status';

                if (!routesByStatus[status]) {
                    routesByStatus[status] = [];
                }
                routesByStatus[status].push(route);
            });

            // Print summary by status
            console.log('\nSummary by Status:');
            for (const [status, statusRoutes] of Object.entries(routesByStatus)) {
                if (statusRoutes.length > 0) {
                    console.log(`\n${status.toUpperCase()} ROUTES (${statusRoutes.length}):`);
                    console.log('----------------------------------------');

                    statusRoutes.forEach((route, index) => {
                        console.log(`\nRoute ${index + 1}:`);
                        console.log(`   ID: ${route._id}`);
                        console.log(`   Name: ${route.routeName}`);
                        console.log(`   Start Location: ${route.startLocation?.locationName || 'N/A'}`);
                        console.log(`   End Location: ${route.endLocation?.locationName || 'N/A'}`);
                        console.log(`   Via Locations: ${route.viaLocations?.length || 0}`);
                        console.log(`   Number of Segments: ${route.segments?.length || 0}`);
                        console.log(`   Route Length: ${route.routeLength || 'N/A'}`);
                        console.log(`   Status: ${status}`);

                        // Check if segments match via locations
                        const expectedSegments = (route.viaLocations?.length || 0) + 1;
                        const actualSegments = route.segments?.length || 0;
                        if (expectedSegments !== actualSegments) {
                            console.log(`   Segment Mismatch: Expected ${expectedSegments}, Found ${actualSegments}`);
                        }

                        console.log('----------------------------------------');
                    });

                    // Print CSV of route IDs for this status
                    console.log(`\n${status.toUpperCase()} Route IDs (CSV format):`);
                    console.log(statusRoutes.map(route => route._id).join(','));
                }
            }
        }

        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    } catch (error) {
        console.error('Error finding inactive routes:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
} 