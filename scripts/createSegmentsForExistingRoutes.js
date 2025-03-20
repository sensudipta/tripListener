/**
 * Script to update existing routes with segments based on via locations
 * 
 * This script:
 * 1. Reads all routes from MongoDB
 * 2. For each route, creates segments based on via locations
 * 3. Updates the route with the new segments
 * 
 * Usage: node scripts/createSegmentsForExistingRoutes.js
 */

const mongoose = require('mongoose');
const Route = require('../models/tripsystem/routes');
const liveDB = require('../common/liveDB');
const { TRIPDB } = liveDB;
const turf = require('@turf/turf');

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

/**
 * Calculate distance between two points using Haversine formula
 */
function getDistanceBetweenCoordinates(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

/**
 * Main function to process all routes
 */
async function processRoutes() {
    try {
        // Get all routes from the database
        const routes = await Route.find({});
        console.log(`Found ${routes.length} routes`);

        let successCount = 0;
        let errorCount = 0;
        let updatedCount = 0;
        let inactiveCount = 0;

        for (const route of routes) {
            try {
                console.log(`Processing route: ${route.routeName} (${route._id})`);

                if (route.segments && route.segments.length > 0) {
                    console.log(`Route ${route.routeName} has ${route.segments.length} existing segments. Will recreate segments.`);
                    updatedCount++;
                }

                const segments = createSegmentsForRoute(route);

                if (segments === null) {
                    console.log(`Marking route ${route.routeName} (${route._id}) as inactive due to validation issues`);
                    route.routeStatus = 'inactive';
                    route.segments = [];
                    await route.save();
                    inactiveCount++;
                    continue;
                }

                if (segments.length === 0) {
                    console.error(`No valid segments created for route ${route.routeName} (${route._id}). Marking as inactive.`);
                    route.routeStatus = 'inactive';
                    route.segments = [];
                    await route.save();
                    inactiveCount++;
                    continue;
                }

                route.segments = segments;
                await route.save();

                console.log(`Updated route: ${route.routeName} (${route._id}) with ${segments.length} segments`);
                successCount++;
            } catch (error) {
                console.error(`Error processing route ${route.routeName} (${route._id}):`, error);
                try {
                    // Always mark route as inactive on any error
                    route.routeStatus = 'inactive';
                    route.segments = [];
                    await route.save();
                    console.log(`Marked route ${route.routeName} (${route._id}) as inactive due to processing error`);
                    inactiveCount++;
                } catch (saveError) {
                    console.error(`Failed to mark route ${route.routeName} (${route._id}) as inactive:`, saveError);
                    // If we can't even save the inactive status, we should still count it as an error
                    errorCount++;
                }
                errorCount++;
            }
        }

        console.log(`\nProcessing complete:`);
        console.log(`- Successfully updated: ${successCount} routes`);
        console.log(`- Updated existing segments: ${updatedCount} routes`);
        console.log(`- Marked as inactive: ${inactiveCount} routes`);
        console.log(`- Failed to update: ${errorCount} routes`);

        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    } catch (error) {
        console.error('Error processing routes:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
}

/**
 * Create segments for a route based on via locations
 */
function createSegmentsForRoute(route) {
    try {
        // Validate route data
        if (!route.routePath || !route.routePath.coordinates || route.routePath.coordinates.length < 2) {
            console.error(`Invalid route path for route ${route.routeName}`);
            return null;
        }

        if (!isValidLocation(route.startLocation) || !isValidLocation(route.endLocation)) {
            console.error(`Invalid start or end location for route ${route.routeName}`);
            return null;
        }

        const routePath = route.routePath.coordinates;
        const routeLength = route.routeLength || 0;

        // Check if it's a round trip by calculating distance between start and end points
        const startCoords = route.startLocation.location.coordinates;
        const endCoords = route.endLocation.location.coordinates;
        const startEndDistance = getDistanceBetweenCoordinates(
            startCoords[1], startCoords[0],
            endCoords[1], endCoords[0]
        );

        // If distance between start and end is less than 2% of total route length, it's a round trip
        const isRoundTrip = startEndDistance < (routeLength * 0.02);
        console.log(`Route ${route.routeName} is ${isRoundTrip ? 'a round trip' : 'one-way'} (start-end distance: ${startEndDistance.toFixed(2)}km, route length: ${routeLength}km)`);

        const validViaLocations = route.viaLocations ? route.viaLocations.filter(loc => isValidLocation(loc)) : [];
        const allLocations = [route.startLocation, ...validViaLocations, route.endLocation];
        const segments = [];

        // Create segments between each pair of consecutive locations
        for (let i = 0; i < allLocations.length - 1; i++) {
            const startLoc = allLocations[i];
            const endLoc = allLocations[i + 1];

            // Extract the segment path
            const segmentPath = extractSegmentPath(routePath, startLoc, endLoc);
            const segmentLength = calculateDistance(segmentPath);
            const segmentDuration = calculateDuration(segmentPath);

            const segment = {
                name: `${startLoc.locationName} to ${endLoc.locationName}`,
                startLocation: startLoc,
                endLocation: endLoc,
                segmentPath: {
                    type: "LineString",
                    coordinates: segmentPath
                },
                segmentLength,
                segmentDuration,
                direction: isRoundTrip ? (i === 0 ? "up" : "down") : "oneway",
                loadType: determineLoadType(startLoc, endLoc)
            };

            segments.push(segment);
        }

        return segments;
    } catch (error) {
        console.error(`Error in createSegmentsForRoute:`, error);
        return null;
    }
}

/**
 * Extract segment path between two locations from the route path
 */
function extractSegmentPath(routePath, startLoc, endLoc) {
    try {
        const routeLineString = turf.lineString(routePath);
        const startPoint = turf.point(startLoc.location.coordinates);
        const endPoint = turf.point(endLoc.location.coordinates);

        const nearestStartPoint = turf.nearestPointOnLine(routeLineString, startPoint);
        const nearestEndPoint = turf.nearestPointOnLine(routeLineString, endPoint);

        const startIndex = nearestStartPoint.properties.index;
        const endIndex = nearestEndPoint.properties.index;

        let segmentPath;
        if (startIndex <= endIndex) {
            segmentPath = routePath.slice(startIndex, endIndex + 1);
        } else {
            segmentPath = routePath.slice(endIndex, startIndex + 1).reverse();
        }

        if (segmentPath.length < 2) {
            throw new Error('Segment path must have at least 2 points');
        }

        return segmentPath;
    } catch (error) {
        console.error('Error in extractSegmentPath:', error);
        throw error;
    }
}

/**
 * Calculate distance for a path using turf.js
 */
function calculateDistance(coordinates) {
    try {
        return turf.length(turf.lineString(coordinates));
    } catch (error) {
        console.error('Error calculating distance:', error);
        return 0;
    }
}

/**
 * Calculate duration based on distance and average speed
 */
function calculateDuration(coordinates) {
    try {
        const distance = calculateDistance(coordinates);
        const averageSpeed = 40; // km/h
        return Math.round((distance / averageSpeed) * 3600); // Convert to seconds
    } catch (error) {
        console.error('Error calculating duration:', error);
        return 0;
    }
}

/**
 * Check if a location object is valid
 */
function isValidLocation(location) {
    if (!location || !location.location || !location.location.coordinates) {
        return false;
    }

    const coords = location.location.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) {
        return false;
    }

    if (typeof coords[0] !== 'number' || typeof coords[1] !== 'number' ||
        isNaN(coords[0]) || isNaN(coords[1])) {
        return false;
    }

    return true;
}

/**
 * Determine load type based on location purposes
 */
function determineLoadType(startLoc, endLoc) {
    if (
        (startLoc.purpose === 'Loading' || startLoc.purpose === 'LoadingUnloading') &&
        (endLoc.purpose === 'Unloading' || endLoc.purpose === 'LoadingUnloading')
    ) {
        return 'loaded';
    }

    if (
        (startLoc.purpose === 'Unloading' || startLoc.purpose === 'LoadingUnloading') &&
        (endLoc.purpose === 'Loading' || endLoc.purpose === 'LoadingUnloading')
    ) {
        return 'empty';
    }

    return 'none';
} 