const mongoose = require('mongoose');
const { TRIPDB } = require('../common/liveDB');
const Route = require('../models/tripsystem/routes');

/**
 * Extract distance from route name (e.g. "Route Name|123KM" -> 123)
 * @param {string} routeName 
 * @returns {number|null} Distance in KM or null if not found
 */
function getDistanceFromRouteName(routeName) {
    if (!routeName) return null;

    // Try different patterns
    const patterns = [
        /\|(\d+)KM$/i,                              // |330KM or |330Km
        /\|\s*(\d+)\s*Km$/i,                        // | 330 Km
        /\|\s*(\d+)\s*KM$/i,                        // | 330 KM
        /\|\s*\d+\s*Stops\s*\|\s*(\d+\.?\d*)\s*Km$/i,  // | 1 Stops | 183.5 Km
        /\|\s*(\d+\.?\d*)\s*Km$/i,                  // | 54.2 Km
        /\|\s*\d+\s*Stops\s*\|\s*(\d+\.?\d*)\s*KM$/i   // | 1 Stops | 183.5 KM
    ];

    for (const pattern of patterns) {
        const match = routeName.match(pattern);
        if (match) {
            return parseFloat(match[1]);
        }
    }
    return null;
}

/**
 * Checks if a length needs conversion by comparing with route name
 * @param {number} length - The length to check
 * @param {string} routeName - The route name containing the expected distance
 * @returns {boolean} - True if length needs conversion to km
 */
function needsConversion(length, routeName) {
    const expectedKm = getDistanceFromRouteName(routeName);

    // If we can't determine expected km from name, use size-based logic
    if (!expectedKm) {
        // If length is unreasonably large for km (> 10000), it's probably in meters
        return length > 10000 || Number.isInteger(length);
    }

    // If length is very close to the expected km, it's already in km
    const diff = Math.abs(length - expectedKm);
    if (diff < 1) return false;

    // If length divided by 1000 is close to expected km, it's in meters
    const lengthInKm = length / 1000;
    const diffInKm = Math.abs(lengthInKm - expectedKm);

    // Use percentage-based tolerance for larger numbers
    const tolerance = Math.max(expectedKm * 0.1, 1); // 10% or at least 1km
    return diffInKm < tolerance;
}

/**
 * Convert meters to kilometers
 * @param {number} meters 
 * @returns {number}
 */
function metersToKilometers(meters) {
    return meters / 1000;
}

/**
 * Fix route lengths that are in meters by converting them to kilometers
 * @param {boolean} dryRun - If true, only shows what would be done without making changes
 */
async function fixRouteLengths(dryRun = false) {
    try {
        // Connect to MongoDB
        console.log('Connecting to MongoDB...');
        await mongoose.connect(TRIPDB, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        // Get all routes
        const routes = await Route.find({}).sort({ routeName: 1 }); // Sort by name for easier reading
        console.log(`Found ${routes.length} routes to check${dryRun ? ' (DRY RUN)' : ''}\n`);

        let convertedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const errors = [];

        // Print header for the table
        console.log('ROUTE LENGTH ANALYSIS:');
        console.log('ACTION'.padEnd(10) + 'LENGTH'.padEnd(15) + 'NEW LENGTH'.padEnd(15) + 'EXPECTED'.padEnd(15) + 'ROUTE NAME');
        console.log('-'.repeat(95));

        // Process each route
        for (const route of routes) {
            try {
                const originalLength = route.routeLength;
                const routeInfo = `${route.routeName} (${route._id})`;
                const expectedKm = getDistanceFromRouteName(route.routeName);

                // Skip if no length or invalid length
                if (typeof originalLength !== 'number' || isNaN(originalLength)) {
                    console.log(`INVALID`.padEnd(10) +
                        `${originalLength}`.padEnd(15) +
                        `--`.padEnd(15) +
                        `${expectedKm || '--'}`.padEnd(15) +
                        routeInfo);
                    skippedCount++;
                    continue;
                }

                // Check if length needs conversion
                if (needsConversion(originalLength, route.routeName)) {
                    const newLength = metersToKilometers(originalLength);

                    console.log(`CONVERT`.padEnd(10) +
                        `${originalLength}m`.padEnd(15) +
                        `${newLength.toFixed(2)}km`.padEnd(15) +
                        `${expectedKm}km`.padEnd(15) +
                        routeInfo);

                    if (!dryRun) {
                        await Route.updateOne(
                            { _id: route._id },
                            { $set: { routeLength: newLength } }
                        );
                    }
                    convertedCount++;
                } else {
                    console.log(`SKIP`.padEnd(10) +
                        `${originalLength}km`.padEnd(15) +
                        `--`.padEnd(15) +
                        `${expectedKm || '--'}km`.padEnd(15) +
                        routeInfo);
                    skippedCount++;
                }
            } catch (error) {
                console.error(`Error processing route ${route.routeName} (${route._id}):`, error);
                errors.push({ routeId: route._id, routeName: route.routeName, error: error.message });
                errorCount++;
            }
        }

        // Print summary
        console.log('\n' + '='.repeat(95));
        console.log(`SUMMARY (${dryRun ? 'DRY RUN - No changes made' : 'LIVE RUN - Changes will be applied'})`);
        console.log(`Total routes: ${routes.length}`);
        console.log(`To be converted: ${convertedCount}`);
        console.log(`To be skipped: ${skippedCount}`);
        console.log(`Errors: ${errorCount}`);

        if (errors.length > 0) {
            console.log('\nERRORS:');
            errors.forEach(({ routeId, routeName, error }) => {
                console.log(`${routeName} (${routeId}): ${error}`);
            });
        }

        // Disconnect from MongoDB
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');

        return {
            total: routes.length,
            converted: convertedCount,
            skipped: skippedCount,
            errors: errorCount
        };

    } catch (error) {
        console.error('Error fixing route lengths:', error);
        try {
            await mongoose.disconnect();
            console.log('Disconnected from MongoDB');
        } catch (disconnectError) {
            console.error('Error disconnecting from MongoDB:', disconnectError);
        }
        throw error;
    }
}

// Run the script
if (require.main === module) {
    const args = process.argv.slice(2);
    const shouldApply = args.includes('--apply');

    fixRouteLengths(!shouldApply)
        .then(results => {
            if (!shouldApply) {
                console.log('\nDry run completed. To apply these changes, run:');
                console.log('node scripts/fixRouteLengths.js --apply');
            } else {
                console.log('\nChanges have been applied.');
            }
            process.exit(0);
        })
        .catch(error => {
            console.error('Route length conversion failed:', error);
            process.exit(1);
        });
}

module.exports = { fixRouteLengths, needsConversion, getDistanceFromRouteName }; 