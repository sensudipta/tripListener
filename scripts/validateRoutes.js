const mongoose = require('mongoose');
const { TRIPDB } = require('../common/liveDB');
const turf = require('@turf/turf');

// Import the Route model
const Route = require('../models/tripsystem/routes');

/**
 * Validates all routes in the database to ensure they meet the required criteria:
 * 1. Routes should have a segments array with at least one segment, or be marked as inactive
 * 2. Segment objects should comply with the route's viaLocations array
 * 3. If segments are missing, the route should be marked as inactive
 * 4. Additional production-ready validations
 */
async function validateRoutes() {
    try {
        // Connect to MongoDB
        console.log('Connecting to MongoDB...');
        await mongoose.connect(TRIPDB, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        // Get all routes
        const routes = await Route.find({});
        console.log(`Found ${routes.length} routes to validate`);

        // Initialize counters and arrays for tracking validation results
        const validRoutes = [];
        const invalidRoutes = [];
        const issuesByType = {
            noSegments: [],
            inactiveWithSegments: [],
            segmentViaLocationMismatch: [],
            segmentCountMismatch: [],
            invalidRoutePath: [],
            invalidLocations: [],
            segmentPathIssues: [],
            segmentLengthIssues: [],
            otherIssues: []
        };

        // Validate each route
        for (const route of routes) {
            const issues = [];
            const routeInfo = {
                id: route._id,
                name: route.routeName || 'Unnamed Route',
                status: route.routeStatus || 'unknown',
                hasSegments: route.segments && route.segments.length > 0,
                segmentCount: route.segments ? route.segments.length : 0,
                viaLocationCount: route.viaLocations ? route.viaLocations.length : 0,
                expectedSegmentCount: (route.viaLocations ? route.viaLocations.length : 0) + 1, // Start to first via, via to via, last via to end
                issues: []
            };

            // Set routeStatus if missing (fix issue #1)
            if (!route.routeStatus) {
                route.routeStatus = 'active'; // Default to active
                console.log(`Set missing routeStatus to 'active' for route ${route.routeName} (${route._id})`);
                try {
                    await Route.updateOne(
                        { _id: route._id },
                        { $set: { routeStatus: 'active' } },
                        { runValidators: false }
                    );
                } catch (saveError) {
                    console.error(`Failed to save routeStatus for route ${route.routeName} (${route._id}):`, saveError);
                }
            }

            // Check 1: Routes should have segments or be marked as inactive
            if (!route.segments || route.segments.length === 0) {
                if (route.routeStatus !== 'inactive') {
                    issues.push('Route has no segments but is not marked as inactive');
                    issuesByType.noSegments.push(routeInfo);
                }
            }
            // Check if route is inactive but has segments
            else if (route.routeStatus === 'inactive' && route.segments.length > 0) {
                issues.push('Route is marked as inactive but has segments');
                issuesByType.inactiveWithSegments.push(routeInfo);
            }

            // Check route path validity
            if (!route.routePath || !route.routePath.coordinates || route.routePath.coordinates.length < 2) {
                issues.push('Invalid route path');
                issuesByType.invalidRoutePath.push(routeInfo);
            } else {
                // Validate GeoJSON structure
                try {
                    const isValid = turf.lineString(route.routePath.coordinates);
                } catch (error) {
                    issues.push(`Invalid GeoJSON LineString: ${error.message}`);
                    issuesByType.invalidRoutePath.push(routeInfo);
                }
            }

            // Check location validity
            if (!isValidLocation(route.startLocation)) {
                issues.push('Invalid start location');
                issuesByType.invalidLocations.push(routeInfo);
            }

            if (!isValidLocation(route.endLocation)) {
                issues.push('Invalid end location');
                issuesByType.invalidLocations.push(routeInfo);
            }

            // Check via locations
            if (route.viaLocations) {
                const invalidViaLocations = route.viaLocations.filter(loc => !isValidLocation(loc));
                if (invalidViaLocations.length > 0) {
                    issues.push(`${invalidViaLocations.length} invalid via locations`);
                    issuesByType.invalidLocations.push(routeInfo);
                }
            }

            // Check 2: Segment count should match expected count based on via locations
            if (route.segments && route.segments.length > 0) {
                // Determine if this is a round trip
                const isRoundTrip = route.routeName.toLowerCase().includes('roundtrip');
                const expectedSegmentCount = isRoundTrip ? 2 : (route.viaLocations ? route.viaLocations.length : 0) + 1;

                if (route.segments.length !== expectedSegmentCount) {
                    issues.push(`Segment count mismatch: has ${route.segments.length}, expected ${expectedSegmentCount} ${isRoundTrip ? '(round trip)' : '(one-way)'}`);
                    issuesByType.segmentCountMismatch.push(routeInfo);
                }

                // Check 3: Validate segment sequence matches via locations
                if (!isRoundTrip && route.viaLocations && route.viaLocations.length > 0) {
                    // Create an array of all locations in order (start, via, end)
                    const allLocations = [route.startLocation, ...route.viaLocations, route.endLocation];

                    // Check if segments follow the correct sequence
                    let hasSequenceIssue = false;
                    for (let i = 0; i < route.segments.length; i++) {
                        const segment = route.segments[i];

                        // Handle case where segment index is out of bounds of expected locations
                        if (i >= allLocations.length - 1) {
                            hasSequenceIssue = true;
                            issues.push(`Segment ${i} has no corresponding locations in the route (expected max ${allLocations.length - 1} segments)`);
                            continue;
                        }

                        const expectedStartLoc = allLocations[i];
                        const expectedEndLoc = allLocations[i + 1];

                        // Compare location IDs or coordinates to check if they match
                        const startMatches = compareLocations(segment.startLocation, expectedStartLoc);
                        const endMatches = compareLocations(segment.endLocation, expectedEndLoc);

                        if (!startMatches || !endMatches) {
                            hasSequenceIssue = true;
                            // Enhanced debug info for location mismatches
                            const startLocName = segment.startLocation?.locationName || 'Unknown';
                            const endLocName = segment.endLocation?.locationName || 'Unknown';
                            const expectedStartName = expectedStartLoc?.locationName || 'Unknown';
                            const expectedEndName = expectedEndLoc?.locationName || 'Unknown';

                            let mismatchDetails = `Segment ${i} has incorrect locations:`;
                            if (!startMatches) {
                                mismatchDetails += `\n    - Start location mismatch: Expected "${expectedStartName}" but got "${startLocName}"`;
                            }
                            if (!endMatches) {
                                mismatchDetails += `\n    - End location mismatch: Expected "${expectedEndName}" but got "${endLocName}"`;
                            }
                            issues.push(mismatchDetails);
                            break;
                        }
                    }

                    if (hasSequenceIssue) {
                        issuesByType.segmentViaLocationMismatch.push(routeInfo);
                    }
                } else if (isRoundTrip) {
                    // For round trips, validate that we have exactly two segments with correct start/end locations
                    if (route.segments.length === 2) {
                        const outbound = route.segments[0];
                        const returnTrip = route.segments[1];

                        // Check outbound segment
                        if (!compareLocations(outbound.startLocation, route.startLocation) ||
                            !compareLocations(outbound.endLocation, route.endLocation)) {
                            issues.push('Round trip outbound segment has incorrect start/end locations');
                            issuesByType.segmentViaLocationMismatch.push(routeInfo);
                        }

                        // Check return segment
                        if (!compareLocations(returnTrip.startLocation, route.endLocation) ||
                            !compareLocations(returnTrip.endLocation, route.startLocation)) {
                            issues.push('Round trip return segment has incorrect start/end locations');
                            issuesByType.segmentViaLocationMismatch.push(routeInfo);
                        }
                    }
                }

                // Validate each segment
                let totalSegmentLength = 0;

                for (let i = 0; i < route.segments.length; i++) {
                    const segment = route.segments[i];

                    // Check segment path
                    if (!segment.segmentPath || !segment.segmentPath.coordinates || segment.segmentPath.coordinates.length < 2) {
                        issues.push(`Segment ${i} has invalid path`);
                        issuesByType.segmentPathIssues.push(routeInfo);
                    } else {
                        // Validate segment GeoJSON
                        try {
                            const isValid = turf.lineString(segment.segmentPath.coordinates);
                        } catch (error) {
                            issues.push(`Segment ${i} has invalid GeoJSON LineString: ${error.message}`);
                            issuesByType.segmentPathIssues.push(routeInfo);
                        }
                    }

                    // Check segment length
                    if (typeof segment.segmentLength !== 'number' || isNaN(segment.segmentLength) || segment.segmentLength <= 0) {
                        issues.push(`Segment ${i} has invalid length: ${segment.segmentLength}`);
                        issuesByType.segmentLengthIssues.push(routeInfo);
                    } else {
                        totalSegmentLength += segment.segmentLength;
                    }

                    // Check load type
                    if (!['loaded', 'empty', 'none'].includes(segment.loadType)) {
                        issues.push(`Segment ${i} has invalid load type: ${segment.loadType}`);
                        issuesByType.otherIssues.push(routeInfo);
                    }
                }

                // Check if total segment length matches route length (with 10% tolerance)
                const tolerance = 0.10; // 10% tolerance
                const routeLength = route.routeLength || 0;

                if (routeLength > 0) {
                    // Check for meter/kilometer conversion issues
                    let lengthDiff = Math.abs(totalSegmentLength - routeLength) / routeLength;
                    let lengthIssue = false;
                    let lengthMessage = '';

                    // If the difference is very large, check for unit conversion issues
                    if (lengthDiff > 0.9 && routeLength > 1000) {
                        // Check if converting meters to kilometers fixes the issue
                        const routeLengthInKm = routeLength / 1000;
                        const kmDiff = Math.abs(totalSegmentLength - routeLengthInKm) / routeLengthInKm;

                        if (kmDiff < tolerance) {
                            lengthMessage = `Route length appears to be in meters (${routeLength}m) while segments are in kilometers (${totalSegmentLength.toFixed(2)}km). Converted value: ${routeLengthInKm.toFixed(2)}km`;
                            // Attempt to fix the route length
                            route.routeLength = routeLengthInKm;
                            try {
                                await Route.updateOne(
                                    { _id: route._id },
                                    { $set: { routeLength: routeLengthInKm } },
                                    { runValidators: false }
                                );
                                console.log(`Fixed route length unit for ${route.routeName} (${route._id}): ${routeLength}m -> ${routeLengthInKm.toFixed(2)}km`);
                            } catch (saveError) {
                                console.error(`Failed to save corrected route length for ${route.routeName} (${route._id}):`, saveError);
                            }
                        } else {
                            // Check if segments might be in meters while route is in kilometers
                            const segmentLengthInKm = totalSegmentLength / 1000;
                            const reverseKmDiff = Math.abs(segmentLengthInKm - routeLength) / routeLength;

                            if (reverseKmDiff < tolerance) {
                                lengthMessage = `Segment lengths appear to be in meters (${totalSegmentLength}m) while route is in kilometers (${routeLength.toFixed(2)}km). Converted segment total: ${segmentLengthInKm.toFixed(2)}km`;
                            } else {
                                lengthIssue = true;
                                lengthMessage = `Total segment length (${totalSegmentLength.toFixed(2)} km) differs from route length (${routeLength.toFixed(2)} km) by ${(lengthDiff * 100).toFixed(2)}%. Possible unit conversion issue.`;
                            }
                        }
                    } else if (lengthDiff > tolerance) {
                        lengthIssue = true;
                        lengthMessage = `Total segment length (${totalSegmentLength.toFixed(2)} km) differs from route length (${routeLength.toFixed(2)} km) by ${(lengthDiff * 100).toFixed(2)}%`;
                    }

                    if (lengthIssue || lengthMessage) {
                        issues.push(lengthMessage);
                        issuesByType.segmentLengthIssues.push(routeInfo);
                    }
                }
            }

            // Add issues to route info
            routeInfo.issues = issues;

            // Update the route with the detected issues
            if (issues.length > 0) {
                try {
                    await Route.updateOne(
                        { _id: route._id },
                        {
                            $set: {
                                routeIssues: issues,
                                ...(route.routeStatus ? { routeStatus: route.routeStatus } : {}),
                                ...(route.routeLength ? { routeLength: route.routeLength } : {}),
                            }
                        },
                        { runValidators: false }
                    );
                    console.log(`Updated route ${route.routeName} (${route._id}) with ${issues.length} issues`);
                } catch (saveError) {
                    console.error(`Failed to save issues for route ${route.routeName} (${route._id}):`, saveError);
                }
            } else if (route.routeIssues && route.routeIssues.length > 0) {
                // Clear any existing issues if the route is now valid
                try {
                    await Route.updateOne(
                        { _id: route._id },
                        { $set: { routeIssues: [] } },
                        { runValidators: false }
                    );
                    console.log(`Cleared issues for now-valid route ${route.routeName} (${route._id})`);
                } catch (saveError) {
                    console.error(`Failed to clear issues for route ${route.routeName} (${route._id}):`, saveError);
                }
            }

            // Categorize route as valid or invalid
            if (issues.length === 0) {
                validRoutes.push(routeInfo);
            } else {
                invalidRoutes.push(routeInfo);
            }
        }

        // Print validation results
        console.log('\n=== ROUTE VALIDATION SUMMARY ===');
        console.log(`Total routes: ${routes.length}`);
        console.log(`Valid routes: ${validRoutes.length}`);
        console.log(`Invalid routes: ${invalidRoutes.length}`);

        // Print detailed breakdown of issues
        console.log('\n=== ISSUES BREAKDOWN ===');
        console.log(`Routes with no segments but not marked inactive: ${issuesByType.noSegments.length}`);
        console.log(`Routes marked inactive but have segments: ${issuesByType.inactiveWithSegments.length}`);
        console.log(`Routes with segment count mismatch: ${issuesByType.segmentCountMismatch.length}`);
        console.log(`Routes with segment/via location mismatch: ${issuesByType.segmentViaLocationMismatch.length}`);
        console.log(`Routes with invalid route paths: ${issuesByType.invalidRoutePath.length}`);
        console.log(`Routes with invalid locations: ${issuesByType.invalidLocations.length}`);
        console.log(`Routes with segment path issues: ${issuesByType.segmentPathIssues.length}`);
        console.log(`Routes with segment length issues: ${issuesByType.segmentLengthIssues.length}`);
        console.log(`Routes with other issues: ${issuesByType.otherIssues.length}`);

        // Print details of invalid routes
        if (invalidRoutes.length > 0) {
            console.log('\n=== INVALID ROUTES DETAILS ===');
            invalidRoutes.forEach(route => {
                console.log(`\nRoute: ${route.name} (${route.id})`);
                console.log(`Status: ${route.status}`);
                console.log(`Segments: ${route.segmentCount} (Expected: ${route.expectedSegmentCount})`);
                console.log('Issues:');
                route.issues.forEach(issue => console.log(`  - ${issue}`));
            });
        }

        // Generate a report file
        const reportData = {
            timestamp: new Date().toISOString(),
            summary: {
                totalRoutes: routes.length,
                validRoutes: validRoutes.length,
                invalidRoutes: invalidRoutes.length,
                issuesByType: Object.fromEntries(
                    Object.entries(issuesByType).map(([key, value]) => [key, value.length])
                )
            },
            invalidRoutes: invalidRoutes
        };

        // Write report to file
        const fs = require('fs');
        const reportPath = `./route_validation_report_${new Date().toISOString().replace(/:/g, '-')}.json`;
        fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
        console.log(`\nDetailed report saved to: ${reportPath}`);

        // Disconnect from MongoDB
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');

        return {
            valid: validRoutes.length,
            invalid: invalidRoutes.length,
            total: routes.length,
            invalidRoutes
        };

    } catch (error) {
        console.error('Error validating routes:', error);
        // Ensure we disconnect from MongoDB even if there's an error
        try {
            await mongoose.disconnect();
            console.log('Disconnected from MongoDB');
        } catch (disconnectError) {
            console.error('Error disconnecting from MongoDB:', disconnectError);
        }
        throw error;
    }
}

/**
 * Compare two locations to check if they are the same
 * 
 * @param {Object} loc1 - First location
 * @param {Object} loc2 - Second location
 * @returns {Boolean} - True if locations match
 */
function compareLocations(loc1, loc2) {
    // Check if locations are defined
    if (!loc1 || !loc2) {
        return false;
    }

    // If locations have IDs, compare them
    if (loc1._id && loc2._id) {
        return loc1._id.toString() === loc2._id.toString();
    }

    // Otherwise, compare coordinates
    if (loc1.location && loc2.location &&
        loc1.location.coordinates && loc2.location.coordinates) {
        const coords1 = loc1.location.coordinates;
        const coords2 = loc2.location.coordinates;
        return coords1[0] === coords2[0] && coords1[1] === coords2[1];
    }

    return false;
}

/**
 * Check if a location object is valid
 * 
 * @param {Object} location - The location object to validate
 * @returns {Boolean} - True if the location is valid
 */
function isValidLocation(location) {
    if (!location || !location.location || !location.location.coordinates) {
        return false;
    }

    const coords = location.location.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) {
        return false;
    }

    // Check that coordinates are valid numbers
    if (typeof coords[0] !== 'number' || typeof coords[1] !== 'number' ||
        isNaN(coords[0]) || isNaN(coords[1])) {
        return false;
    }

    // Check that coordinates are within valid ranges
    if (coords[0] < -180 || coords[0] > 180 || coords[1] < -90 || coords[1] > 90) {
        return false;
    }

    return true;
}

/**
 * Fix issues with routes automatically where possible
 * 
 * @param {Array} invalidRoutes - Array of invalid routes from validateRoutes
 * @returns {Object} - Results of the fix operation
 */
async function fixRouteIssues(invalidRoutes) {
    if (!invalidRoutes || invalidRoutes.length === 0) {
        console.log('No invalid routes to fix');
        return { fixed: 0, failed: 0 };
    }

    try {
        // Connect to MongoDB
        console.log('Connecting to MongoDB...');
        await mongoose.connect(TRIPDB, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');

        let fixedCount = 0;
        let failedCount = 0;

        for (const routeInfo of invalidRoutes) {
            try {
                const route = await Route.findById(routeInfo.id);
                if (!route) {
                    console.log(`Route not found: ${routeInfo.id}`);
                    failedCount++;
                    continue;
                }

                let fixed = false;
                let fixedIssues = [];

                // Fix 1: Mark routes with no segments as inactive
                if ((!route.segments || route.segments.length === 0) && route.routeStatus !== 'inactive') {
                    route.routeStatus = 'inactive';
                    fixed = true;
                    fixedIssues.push('Marked route as inactive due to no segments');
                    console.log(`Fixed: Marked route ${route.routeName} (${route._id}) as inactive due to no segments`);
                }

                // Fix 2: Remove segments from inactive routes
                if (route.routeStatus === 'inactive' && route.segments && route.segments.length > 0) {
                    route.segments = [];
                    fixed = true;
                    fixedIssues.push('Removed segments from inactive route');
                    console.log(`Fixed: Removed segments from inactive route ${route.routeName} (${route._id})`);
                }

                // Save the route if fixes were applied
                if (fixed) {
                    // Update routeIssues to reflect what was fixed and what remains
                    route.routeIssues = [...fixedIssues, ...routeInfo.issues.filter(issue =>
                        !issue.includes('no segments') &&
                        !issue.includes('not marked as inactive') &&
                        !issue.includes('marked as inactive but has segments')
                    )];

                    await route.save();
                    fixedCount++;
                } else {
                    console.log(`No automatic fixes available for route ${route.routeName} (${route._id})`);
                    failedCount++;
                }
            } catch (error) {
                console.error(`Error fixing route ${routeInfo.id}:`, error);
                failedCount++;
            }
        }

        // Disconnect from MongoDB
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');

        console.log(`\n=== FIX RESULTS ===`);
        console.log(`Fixed routes: ${fixedCount}`);
        console.log(`Failed to fix: ${failedCount}`);

        return { fixed: fixedCount, failed: failedCount };
    } catch (error) {
        console.error('Error fixing routes:', error);
        // Ensure we disconnect from MongoDB even if there's an error
        try {
            await mongoose.disconnect();
            console.log('Disconnected from MongoDB');
        } catch (disconnectError) {
            console.error('Error disconnecting from MongoDB:', disconnectError);
        }
        throw error;
    }
}

// Run the validation if this script is executed directly
if (require.main === module) {
    validateRoutes()
        .then(results => {
            console.log('Route validation completed');

            // Ask if user wants to fix issues
            if (results.invalid > 0) {
                const readline = require('readline').createInterface({
                    input: process.stdin,
                    output: process.stdout
                });

                readline.question('\nDo you want to attempt to fix issues automatically? (y/n) ', async (answer) => {
                    if (answer.toLowerCase() === 'y') {
                        try {
                            await fixRouteIssues(results.invalidRoutes);
                            console.log('Fix operation completed');
                        } catch (error) {
                            console.error('Fix operation failed:', error);
                        }
                    }
                    readline.close();
                    process.exit(0);
                });
            } else {
                process.exit(0);
            }
        })
        .catch(error => {
            console.error('Route validation failed:', error);
            process.exit(1);
        });
}

module.exports = { validateRoutes, fixRouteIssues }; 