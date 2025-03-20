/**
 * Script to find routes that don't have routeStatus property set
 * 
 * This script:
 * 1. Connects to MongoDB
 * 2. Finds all routes where routeStatus is undefined, null, or empty
 * 3. Checks if number of segments matches viaLocations + 1
 * 4. Sets routeStatus to 'active' if conditions match
 * 
 * Usage: node scripts/findRoutesWithoutStatus.js
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
    processRoutes();
}).catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
});

async function updateRouteStatus(routeId, status) {
    try {
        // Use native MongoDB operation through Mongoose
        const result = await mongoose.connection.db.collection('routes').updateOne(
            { _id: new mongoose.Types.ObjectId(routeId) },
            { $set: { routeStatus: status } }
        );

        if (result.matchedCount === 0) {
            throw new Error('Route not found');
        }

        if (result.modifiedCount === 0) {
            throw new Error('Route found but not modified');
        }

        return true;
    } catch (error) {
        console.error(`Failed to update route ${routeId}:`, error.message);
        return false;
    }
}

async function processRoutes() {
    try {
        // Use native MongoDB find operation
        const routes = await mongoose.connection.db.collection('routes').find({
            $or: [
                { routeStatus: { $exists: false } },
                { routeStatus: null },
                { routeStatus: '' }
            ]
        }).toArray();

        console.log(`\nFound ${routes.length} routes without routeStatus:`);
        console.log('----------------------------------------');

        if (routes.length === 0) {
            console.log('No routes found without routeStatus.');
        } else {
            let activatedCount = 0;
            let inactivatedCount = 0;
            let failedCount = 0;
            let failedRoutes = [];

            // Process routes in batches
            const batchSize = 50;
            for (let i = 0; i < routes.length; i += batchSize) {
                const batch = routes.slice(i, i + batchSize);
                console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(routes.length / batchSize)}`);

                for (const route of batch) {
                    const expectedSegments = (route.viaLocations?.length || 0) + 1;
                    const actualSegments = route.segments?.length || 0;
                    const isValid = actualSegments === expectedSegments && actualSegments > 0;

                    console.log(`\nProcessing Route:`);
                    console.log(`   ID: ${route._id}`);
                    console.log(`   Name: ${route.routeName}`);
                    console.log(`   Start Location: ${route.startLocation?.locationName || 'N/A'}`);
                    console.log(`   End Location: ${route.endLocation?.locationName || 'N/A'}`);
                    console.log(`   Via Locations: ${route.viaLocations?.length || 0}`);
                    console.log(`   Expected Segments: ${expectedSegments}`);
                    console.log(`   Actual Segments: ${actualSegments}`);

                    const status = isValid ? 'active' : 'inactive';
                    const success = await updateRouteStatus(route._id, status);

                    if (success) {
                        if (isValid) {
                            console.log(`   Status: Set to ACTIVE ✓`);
                            activatedCount++;
                        } else {
                            console.log(`   Status: Set to INACTIVE (segment count mismatch) ✓`);
                            inactivatedCount++;
                        }
                    } else {
                        console.log(`   Status: Update FAILED ✗`);
                        failedCount++;
                        failedRoutes.push({
                            id: route._id,
                            name: route.routeName,
                            intendedStatus: status
                        });
                    }
                    console.log('----------------------------------------');
                }

                // Small delay between batches
                if (i + batchSize < routes.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log('\nSummary:');
            console.log(`Total routes processed: ${routes.length}`);
            console.log(`Routes set to active: ${activatedCount}`);
            console.log(`Routes set to inactive: ${inactivatedCount}`);
            console.log(`Failed updates: ${failedCount}`);

            if (failedRoutes.length > 0) {
                console.log('\nFailed Routes:');
                failedRoutes.forEach(route => {
                    console.log(`   ${route.id} (${route.name}) - Intended status: ${route.intendedStatus}`);
                });
                console.log('\nFailed Route IDs (CSV format):');
                console.log(failedRoutes.map(route => route.id).join(','));
            }

            // Final verification using native MongoDB operation
            const remainingCount = await mongoose.connection.db.collection('routes').countDocuments({
                $or: [
                    { routeStatus: { $exists: false } },
                    { routeStatus: null },
                    { routeStatus: '' }
                ]
            });

            if (remainingCount > 0) {
                console.log(`\nWARNING: ${remainingCount} routes still have no routeStatus after processing`);
            } else {
                console.log('\nSuccess: All routes have been assigned a status!');
            }
        }

        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    } catch (error) {
        console.error('Error processing routes:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
} 