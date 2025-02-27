const { Trip } = require('../models');
const { tripLogger } = require('./logger');

/*
Array Fields:
    tripPath - push new elements
    fuelEvents
    sentNotifications
    ruleStatus.reverseTravelPath.coordinates
    significantLocations
    significantEvents
*/


async function updateTripRecord(trip, updates) {
    try {
        if (!trip?._id) {
            throw new Error('Invalid trip ID');
        }

        // Debug logging for array fields
        const arrayFields = ['tripPath', 'fuelEvents', 'sentNotifications', 'significantEvents', 'significantLocations'];
        arrayFields.forEach(field => {
            if (updates[field]) {
                tripLogger(trip, `Received ${field}: ${Array.isArray(updates[field]) ? updates[field].length + ' items' : 'not an array'}`);
            }
        });

        tripLogger(trip, `@MAIN: UpdateDB Keys: ${Object.keys(updates).join(', ')}`);

        let retryCount = 0;
        const MAX_RETRIES = 3;
        const keyCount = Object.keys(updates).length;

        while (retryCount < MAX_RETRIES) {
            try {
                const updateQuery = {
                    $set: {},
                    $push: {}
                };

                // Handle tripPath array
                if (updates.tripPath && Array.isArray(updates.tripPath)) {
                    //tripLogger(trip, `Total points to add: ${updates.tripPath.length}`);
                    updateQuery.$push.tripPath = { $each: updates.tripPath };
                    delete updates.tripPath;
                }

                // Handle ruleStatus through deep merge
                if (updates.ruleStatus) {
                    const currentRuleStatus = trip.ruleStatus || {};
                    const updatedRuleStatus = updates.ruleStatus;
                    const tripRules = trip.rules || {};

                    // Initialize mergedRuleStatus with basic fields that don't depend on rules
                    const mergedRuleStatus = {
                        // Core status fields - always present
                        drivingTimeStatus: updatedRuleStatus.drivingTimeStatus || currentRuleStatus.drivingTimeStatus || 'Good',
                        speedStatus: updatedRuleStatus.speedStatus || currentRuleStatus.speedStatus || 'Good',
                        haltTimeStatus: updatedRuleStatus.haltTimeStatus || currentRuleStatus.haltTimeStatus || 'Good',
                        routeViolationStatus: updatedRuleStatus.routeViolationStatus || currentRuleStatus.routeViolationStatus || 'Good',
                    };

                    // Add reverseTravelPath only if route violation tracking is enabled
                    if (tripRules.routeViolationThreshold !== undefined) {
                        mergedRuleStatus.reverseTravelPath = {
                            type: 'LineString',
                            coordinates: [
                                ...(currentRuleStatus.reverseTravelPath?.coordinates || []),
                                ...(updatedRuleStatus.reverseTravelPath?.coordinates || [])
                            ]
                        };
                        mergedRuleStatus.reverseTravelDistance = updatedRuleStatus.reverseTravelDistance ?? currentRuleStatus.reverseTravelDistance ?? 0;
                    }

                    // Add generator-related status only if generator rules exist
                    if (tripRules.minGeneratorHours !== undefined || tripRules.minGeneratorDistance !== undefined) {
                        mergedRuleStatus.generatorHours = updatedRuleStatus.generatorHours ?? currentRuleStatus.generatorHours ?? 0;
                        mergedRuleStatus.generatorHoursPercentage = updatedRuleStatus.generatorHoursPercentage ?? currentRuleStatus.generatorHoursPercentage ?? 0;
                        mergedRuleStatus.generatorDistance = updatedRuleStatus.generatorDistance ?? currentRuleStatus.generatorDistance ?? 0;
                        mergedRuleStatus.generatorDistancePercentage = updatedRuleStatus.generatorDistancePercentage ?? currentRuleStatus.generatorDistancePercentage ?? 0;
                    }

                    // Add temperature status only if temperature rules exist
                    if (tripRules.minTemperature !== undefined || tripRules.maxTemperature !== undefined) {
                        mergedRuleStatus.minTemperature = updatedRuleStatus.minTemperature ?? currentRuleStatus.minTemperature ?? 0;
                        mergedRuleStatus.maxTemperature = updatedRuleStatus.maxTemperature ?? currentRuleStatus.maxTemperature ?? 0;
                    }

                    // Add fuel consumption status if maxFuelConsumption rule exists
                    if (tripRules.maxFuelConsumption !== undefined) {
                        mergedRuleStatus.fuelConsumptionStatus = updatedRuleStatus.fuelConsumptionStatus ?? currentRuleStatus.fuelConsumptionStatus ?? 'Good';
                    }

                    // Add fuel efficiency status if minFuelEfficiency rule exists
                    if (tripRules.minFuelEfficiency !== undefined) {
                        mergedRuleStatus.fuelEfficiencyStatus = updatedRuleStatus.fuelEfficiencyStatus ?? currentRuleStatus.fuelEfficiencyStatus ?? 'Good';
                    }

                    tripLogger(trip, `Merged ruleStatus based on rules: ${JSON.stringify({
                        hasRules: {
                            routeViolation: tripRules.routeViolationThreshold !== undefined,
                            generator: tripRules.minGeneratorHours !== undefined || tripRules.minGeneratorDistance !== undefined,
                            temperature: tripRules.minTemperature !== undefined || tripRules.maxTemperature !== undefined,
                            fuelConsumption: tripRules.maxFuelConsumption !== undefined,
                            fuelEfficiency: tripRules.minFuelEfficiency !== undefined
                        },
                        resultFields: Object.keys(mergedRuleStatus)
                    })}`);

                    updateQuery.$set.ruleStatus = mergedRuleStatus;
                    delete updates.ruleStatus;
                }

                // Handle other array fields
                ['fuelEvents', 'sentNotifications', 'significantEvents', 'significantLocations'].forEach(field => {
                    if (updates[field] && Array.isArray(updates[field])) {
                        tripLogger(trip, `Total ${field} to add: ${updates[field].length}`);
                        updateQuery.$push[field] = { $each: updates[field] };
                        delete updates[field];
                    }
                });

                // Handle all remaining fields as $set operations
                Object.entries(updates).forEach(([key, value]) => {
                    if (value !== undefined) {
                        updateQuery.$set[key] = value;
                    }
                });

                // Remove empty operators
                if (Object.keys(updateQuery.$push).length === 0) delete updateQuery.$push;
                if (Object.keys(updateQuery.$set).length === 0) delete updateQuery.$set;

                //tripLogger(trip, `Final updateQuery: ${JSON.stringify(updateQuery)}`);

                const result = await Trip.findOneAndUpdate(
                    { _id: trip._id },
                    updateQuery,
                    {
                        new: true,
                        runValidators: true
                    }
                );

                if (!result) {
                    throw new Error('Trip not found or no changes made');
                }

                // Log array updates
                const arrays = {
                    tripPath: { old: trip.tripPath?.length || 0, new: result.tripPath?.length || 0 },
                    fuelEvents: { old: trip.fuelEvents?.length || 0, new: result.fuelEvents?.length || 0 },
                    sentNotifications: { old: trip.sentNotifications?.length || 0, new: result.sentNotifications?.length || 0 },
                    significantEvents: { old: trip.significantEvents?.length || 0, new: result.significantEvents?.length || 0 },
                    significantLocations: { old: trip.significantLocations?.length || 0, new: result.significantLocations?.length || 0 }
                };

                Object.entries(arrays).forEach(([name, counts]) => {
                    const added = counts.new - counts.old;
                    if (added > 0) {
                        tripLogger(trip, `DB UPDATE ${name}: ${counts.old} -> ${counts.new} items (added ${added})`);
                    }
                });

                tripLogger(trip, `DB UPDATE SUCCESS: ${keyCount} updates\n`);
                return true;

            } catch (dbError) {
                retryCount++;
                tripLogger(trip, `Retry ${retryCount}: ${dbError.message}`);
                if (retryCount === MAX_RETRIES) {
                    throw dbError;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
            }
        }
    } catch (err) {
        tripLogger(trip, `Error in updateTripRecord: ${err}`);
        console.error(`Failed to update trip ${trip._id}:`, err);
        return false;
    }
}

module.exports = updateTripRecord;