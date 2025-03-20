# Next Release Plan

1. Fix the routeChecker algorithm to make it work with round trips - handle situations where the vehicle may trace back whole or part of its path
2. Review the trip start algorithm
   1. Sometimes its not starting although the vehicle did reach the startLocation
   2. If the plannedStartTime has elapsed and vehicle is not at startLocation, get history data since plannedStartTime, see if the vehicle went into the zone, if yes, start the trip and backfill the data
3. Review the display list of Active/Planned and completed trips. Review the default sorting. Enable pagination.
4. Check and fix the trip search system
5. Fix the issue where the vehicle may not be marked as arrived at destination if it is within a certain distance from the destination (configurable) after planned arrival time has elapsed.
6. Setup file system for storing trip data after completion, so that we can query historical trips and generate reports later on.
7. Setup trip reports - frond end and backend. need to review aht kind of reports are required.



# Issues to Solve

1. Route checker is not working for round trips.
2. The trips status variables like distanceCovered, distanceRemaining, completionPercentage, estimatedTimeOfArrival are not being updated properly.
3. Sometimes, even if the vehicle is at the start location, the trip is not being started. (not sure - user reported, unconfirmed issue)
4. checkRules functionality should push location points to the eventPath array in significantEvents and also calculate the eventEndTime, eventDuration, eventDistance. This is not working.
5. If the trip is created with plannedStartTime in the past, the trip start will not trigger. So in such cases, I need to call my routedata api to get the route data for the period from the past trip start time and now. Then i need to check if the vehicle ever went to the startLocation. If yes, then start the trip and backfill the data. for backfilling i will mention which all fields need to be backfilled.

6. Front end- trip search is working fine, but display is not proper. We need a tab for search view, which will show the items.
7. 


# Route Checking Mods needed

1. To Determine if this route is one-way or round trip.
   1. Route Name contains "RoundTrip" or "OneWay"
   2. Route Path needs to be segmented if its a Round Trip - Up segement and Down segment.
   3. Need to determine which segment is currently active.
   4. Then need to see where is the vehicle with respect to the currently active segment


# Work Plan

## Database
1. route schema - add fields
   1. segments - array of objects
      1. type
      2. coordinates
      3. startLocation
      4. endLocation
      5. name
      6. type - loaded / empty / none
      7. direction - up / down /none
2. trip schema - add fields
   1. currentlyActiveSegment - {index, name, type, direction}
   2. segmentHistory - array of objects
      1. segment object
      2. segmentIndex
      3. startTime
      4. endTime
      5. distanceCovered
      6. distanceRemaining
      7. completionPercentage
      8. estimatedTimeOfArrival
      9. status - not started, running, complete

## Create Route API
1. Implement code to divide route into segments
   1. Segemnt based on viaLocations
   2. Default Name - A to B
   3. Default Direction
      1. if roundTrip
         1. Segment 1 - UP
         2. Segment 2 - Down
      2. if oneWay
         1. all segments - OneWay

## tripListener for round trips
1. We need 4 functions in place of existing routeChecker 
   1. segmentChecker
      1. detect segementChange
         1. if segment changed
            1. call finish segment function
               1. get final routeProgress object for the segment
               2. update the segment in the segmentHistory
            2. call start segment function
               1. get next segment details from route object
               2. push it into segmentHistory
      2. sets currentlyActiveSegment
      3. calls routeChekcer with currentlyActiveSegment
      4. Receives routeProgress objectstory
      5. update latest segemnt in segmentHistory based on what routeChecker returns
   2. routeChecker
      1. Gets the segment it needs to check along with truckPoint
      2. build routeProgress object
         1. nearestPointIndex
         2. truckDistance (from nearest point)
         3. distanceCovered
         4. distanceRemaining
         5. completionPercentage
         6. estimatedTimeOfArrival
      3. Returns the segmentProgress object to segmentChecker
   3. startSegment
      1. gets the next segment details from route object
      2. push it into segmentHistory
   4. finishSegment
      1. get final routeProgress object for the segment
      2. update the segment in the segmentHistory
   5. updateSegment
      1. gets the currentlyActiveSegment
      2. get routePRogress for this segment
      3. update the latest segment in the segmentHistory and currentlyActiveSegment
   6. detectSegmentChange
      1. run locationChecker to get locEntry and locExit
      2. if currentSignificantLocation is null
         1. previsousSignificantLocation is null
            1. return 'nochange'
         2. previousSignificantLocation is not null
            1. return locExit -> previousSignificantLocation
      3. currentSignificantLocation is not null
            1. previsouSignificantLocation is null
               1. return locEntry -> currentSignificantLocation
            2. previsouSignificantLocation is not null
               1. if previousSignificantLocation is same as currentSignificantLocation
                  1. return 'nochange'
               2. if previousSignificantLocation is different from currentSignificantLocation
                  1. return locExit -> previsouSignificantLocation, locEntry -> currentSignificantLocation
      4. each segemnt will have two locations - startLocation and endLocation
      5. entry into startLocation will signal the start of a new segemnt
      6. at the same time, it will signal the end of previsou segemnt (if any)
      7. segemntChange logic
         1. when a new location is entered
            1. Check if there are no segmenets already in the segmentHistory
               1. start a new segment with the first segoment of the route
            2. Check if there are segments already in the history and 
               1. there are more segmnents left in route yet to start
                  1. if yes,
                     1. Then finish the current segment
                     2. start a new segment
                  2. if no
                     1.  then dont do anything
         2. When a location is exited
            1. If activeSegment is not the last, do nothing
            2. If activeSegment is the last, 
               1. finish the segment and 
               2. finish the trip
2. FLow Summary
   1. Trip start and end will be based on segment activity
   2. So, tripStatusChecker should not work on locations but on segments now
   3. At first, we will check the following on the trip object
      1. tripStage - Planned / Active / Complete (aborted/cancelled)
      2. currentlyActiveSegment
   4. if tripStage is Planned
      1. We will wait and see if first segment becomes active
         1. run segmentChecker to detect this
      2. When first segment gets active, we mark the trip active
   5. if tripStage is Active
      1. We will wait and see if last segment became finished$$  $$
         1. run segmentCheker to detect this
      2. When last segment gets finished, we mark the trip complete


## tripListener for backDated trips

### When checking trips at Planned stage

1. check trip's plannedStartTime against current time
   1. if plannedStartTime is in future - all good. Current code will handle.
   2. if plannedStartTime is in the past
      1. check if vehicle is at the startLocation
         1. If yes - all good, current code will handle
         2. if no -
            1. call routeRaw api from plannedStartTime till now
            2. get routeArray
            3. check each point in routeArray from the start for presence in startLocation
            4. if found
               1. Consider this a backdatedStart trip
               2. note the time when vehicle entered startLocation (dt_tracker of the first point found inside startLocation) - backDate_actualStartTime
               3. note in index of routeArray where this entry happened - backDate_index
            5. if not found, nothing to be done. Mark tripStage as Start Delayed

## What to do for a backDatedStart trip
1. Check if the vehicle is still at startLocation
   1. if yes
      1. update actualStartTime of the trip with backDate_actualStartTime
      2. push pathPoints in tripPath
   2. if no
      1. We have to run the entire tripPath as a batch and do
         1. Movement Status Processing
         2. Route Situation Processing
         3. Reverse Travel Handling
         4. Significant Location Procesing
         5. Rule Compliance Procesing
         6. Trip Status update
         7. Fuel Status update
         8. database update

Your summary is excellent and captures all the key tasks needed to implement both the segment-based system and backdated trip handling. Let me refine and expand on each task to ensure you have a comprehensive plan:

# Implementation Plan Summary

## 1. Segment-Based System Implementation
- **Create segmentChecker.js**:
  - Implement detectSegmentChange() to identify segment transitions
  - Implement startSegment() to initialize new segments
  - Implement finishSegment() to complete segments
  - Implement updateSegment() to track segment progress
  - Integrate with locationChecker for detecting location-based segment changes

- **Refactor routeChecker.js**:
  - Modify to work with individual segments instead of entire routes
  - Update to handle both one-way and round-trip segments
  - Return segment-specific progress metrics

## 2. Update tripStatusChecker.js
- Modify to consider segment status for trip stage transitions
- Add logic to detect first segment activation for trip start
- Add logic to detect last segment completion for trip end
- Maintain compatibility with location-based checks for backward compatibility
- Update active status determination based on segment status

## 3. Update Trip Completion Logic
- Modify trip completion trigger to use segment completion instead of location
- Update the logic to mark a trip as completed when the last segment is finished
- Ensure all trip completion tasks (finalizing metrics, setting end time) work with segment-based completion

## 4. Historical Data Processing
- **Create processHistoricalData.js**:
  - Implement function to retrieve historical path data
  - Add logic to split data into manageable chunks (5-minute intervals)
  - Create sequential processing loop for chunks
  - Maintain state between chunk processing
  - Accumulate events, locations, and metrics across chunks
  - Handle final database update with complete trip history

## 5. Refactor Time-Dependent Components
- **Update Movement Status Processing**:
  - Modify to use last point timestamp instead of current time
  - Ensure halt duration calculations work correctly for both real-time and historical data

- **Update Fuel Status Check**:
  - Modify to handle both real-time and historical fuel data retrieval
  - For backdated trips, use first and last point timestamps for API call
  - Ensure fuel events are properly integrated with other trip events

## 6. Additional Considerations
- **Database Schema Updates**:
  - Add segment-related fields to route and trip schemas
  - Ensure backward compatibility with existing data

- **Testing Strategy**:
  - Create test cases for segment transitions in both one-way and round trips
  - Test backdated trip processing with various historical datasets
  - Verify correct event generation and chronological ordering

- **Logging Enhancements**:
  - Add segment-specific logging
  - Add historical processing logging

## Implementation Sequence Recommendation

I recommend implementing these changes in the following order:

1. First, refactor the time-dependent components to use last point timestamp
   - This is a smaller, isolated change that improves the system immediately

2. Implement the segment-based system
   - Create the new segment-related functions
   - Update the trip status checker
   - Test thoroughly with various route types

3. Finally, implement the historical data processing
   - Build on the now-consistent time handling
   - Leverage the segment-based system for accurate processing

This sequence allows you to make incremental improvements while maintaining system stability throughout the process.
