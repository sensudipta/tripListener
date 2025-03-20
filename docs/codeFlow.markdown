# TripMaster Code Flow Summary

## Initialization and Setup
1. Database Connection
    1. Connect to MongoDB (tripDB)
    2. Connect to Redis
    3. Load all trips with status 'Planned', 'Start Delayed', or 'Active'
    4. Convert trips to plain objects and store in allTrips array
2. Main Loop Execution
   1. Process one trip at a time from allTrips array
   2. Validate trip data for required fields and formats
   3. Update lastCheckTime to current time


## Trip Processing Flow

1. **Planned/Start Delayed Trip Processing**
   1. Get trip path data using getTripPath()
      1. If no path data, skip to next trip
   2. Check for presence in significant locations using presenceInSignificantLocation()
      1. Determine if truck is at a significant location (like start/end points)
   3. Check trip status using tripStatusChecker()
      1. Determine if trip should transition to 'Active'
   4. If trip transitions to 'Active'
      1. Set actualStartTime to current truck timestamp
      2. Create and send 'Trip Activated' alert
   5. Update trip record in database with all changes
2. **Active Trip Processing**
   1. Get trip path data using getTripPath()
      1. If no path data, skip to next trip
      2. Extract truckPoint, pathPoints, driveStatus, speeds, distances
   2. Movement Status Processing
      1. Update movementStatus based on driveStatus
      2. Track halt durations if truck is halted
         1. Update haltStartTime, currentHaltDuration, parkedDuration
      3. Calculate weighted average speed based on run durations
      4. Update trip metrics (distances, speeds, durations)
      5. Add path points to tripPath
   3. **Route Situation Analysis**
      1. Get route situation using getRouteSituation()
         1. If route situation can't be determined, skip to next trip
      2. Extract distance metrics, travel direction, nearest point info
      3. Update trip with route progress metrics
         1. distanceCovered, distanceRemaining, completionPercentage
      4. Calculate ETA if conditions are met
         1. Speed > 0, remaining distance > 0, covered distance > 0, truck is driving
   4. **Reverse Travel Handling**
      1. If travel direction is 'reverse'
         1. Update or create reverseTravelPath with current path points
         2. Accumulate reverseTravelDistance
      2. If travel direction changes to 'forward' after reverse travel
         1. Create a 'Reverse Travel' event with path, duration, distance
         2. Reset reverseTravelPath and reverseTravelDistance
   5. **Significant Location Processing**
      1. Check for presence in significant locations
      2. Process previous significant location if exists
         1. Calculate dwellTime
         2. Add to significantLocations array
      3. Process current significant location
         1. If location has exitTime, close it and add to significantLocations
         2. Otherwise, keep it as currentSignificantLocation
   6. **Rule Compliance Checking**
      1. Check rules using checkRules()
      2. Process rule violations and status changes
         1. Update ruleStatus with new violations
         2. Create violation events for newly violated rules
         3. Send alerts for rule violations
         4. Update existing violation events with new path points
         5. Close violation events when status returns to 'Good'
   7. **Trip Status Update**
      1. Check trip status using tripStatusChecker()
      2. Handle trip stage changes (e.g., 'Active' to 'Completed')
         1. Create tripStageChange event
         2. Send status update alert
      3. Handle active status changes
         1. Create activeStatusChange event
         2. Send activity update alert
      4. If trip becomes 'Completed', set actualEndTime
   8. **Fuel Status Processing**
      1. Check if fuel status update is needed
      2. If needed, get fuel data and update
         1. Process fuel events (filling/theft)
         2. Update fuel consumption, efficiency metrics
         3. Add fuel events to significantEvents
   9. **Database Update**
      1.  Update trip record with all accumulated changes
3.  **Loop Continuation**
    1.  Process next trip in allTrips array
    2.  If no more trips, exit process


## Helper Functions

1. validateTripData
   1. Check for required fields (deviceImei, tripName, tripStage, etc.)
   2. Validate route object and its components
   3. Validate specific field formats (IMEI, tripStage values)


## Key Components and Their Roles

1. **getTripPath** - Retrieves GPS data for the trip
2. **presenceInSignificantLocation** - Determines if truck is at important locations
3. **tripStatusChecker** - Determines trip stage and active status
4. **getRouteSituation** - Analyzes truck position relative to planned route
5. **checkRules** - Checks for rule violations (speed, route deviation, etc.)
6. **updateTripRecord** - Persists changes to the database
7. **sendAlerts** - Sends notifications for important events
   

## Current Limitations

1. Route checker doesn't handle round trips properly
2. Trip status variables may not update correctly in some scenarios
3. Trip start detection has issues when vehicle is at start location
4. Rule violation events don't properly track path, duration, and distance
5. Trips with plannedStartTime in the past don't trigger properly
