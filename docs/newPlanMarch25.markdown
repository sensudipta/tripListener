# Old Plan without Segment Checking and Historical Data processing

## Process Flow V2

> Function - tripStatusChecker (receive - truckPoint, tripPath, currentSignificantLocation, movementStatus, tripStage, activeStatus)
1. tripStage: Planned - check presence in startLocation
   1. Reached startLocation -> tripStage: ACTIVE | activeStatus: Reached Origin
   2. Not reached startLocation -> START Delayed | activeStatus: Inactive
2. tripStage: Start Delayed - check presence in startLocation
   1. Reached startLocation -> ACTIVE | activeStatus: Reached Origin
   2. Not reached startLocation -> START Delayed | activeStatus: Inactive
3. tripStage: Active (Check movementStatus, presence in significantLocations, routeViolationStatus)
   1. activeStatus: Reached Origin
      1. If still at startLocation
         1. check dwellTime at startLocation > maxDetentionTime -> activeStatus: Detained At Origin
      2. Left startLocation
         1. movementStatus - Halted -> activeStatus: Halted
         2. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
         3. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
   2. activeStatus: Detained at Origin
      1. If still at startLocation
         1. check dwellTime at startLocation > maxDetentionTime -> activeStatus: Detained At Origin
      2. Left startLocation
         1. movementStatus - Halted -> activeStatus: Halted
         2. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
         3. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
   3. activeStatus: Running On Route
      1. In any viaLocation -> activeStatus: Reached Via Location (viaLocationName) 
      2. In endLocation -> activeStatus: Reached Destination 
      3. movementStatus - Halted -> activeStatus: Halted
         1. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
         2. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
   4. activeStatus: Route Violated
      1. In any viaLocation -> activeStatus: Reached Via Location (viaLocationName) 
      2. In endLocation -> activeStatus: Reached Destination 
      3. movementStatus - Halted -> activeStatus: Halted
         1. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
         2. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
   5. activeStatus: Halted
         1. movementStatus - Halted -> activeStatus: Halted
         2. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
         3. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
   6. activeStatus: Reached Via Location (viaLocationName)
      1. If still at same viaLocation 
         1. check dwellTime at this viaLocation > maxDetentionTime -> activeStatus: Detained At Via Location (viaLocationName)
      2. Left that viaLocation and not entered any other viaLocation
         1. movementStatus - Halted -> activeStatus: Halted
         2. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
         3. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
      3. Inside a different viaLocation
         1. activeStatus: Reached Via Location (viaLocationName)
   7. activeStatus: Reached destination
      1. If still at endLocation
         1. check dwellTime at endLocation > maxDetentionTime -> activeStatus: Detained At Destination 
      2. If left endLocation
         1. tripStage: Completed 
   8. activeStatus: Detained at destination
      1. If still at endLocation
         1. check dwellTime at endLocation > maxDetentionTime -> activeStatus: Detained At Destination 
      2. If left endLocation
         1. tripStage: Completed 


## Functions

1. **getTripPath** function
   1. receive deviceImei and tripStage
   2. if tripStage is 'Active'
      1. Get rawTripPath data from redis list `${deviceImei}:rawTripPath`
      2. remove all data from this redis list
      3. data points in rawTripPath are JSON.stringify of object {dt_tracker, lat, lng, speed, acc, fuellevel}
      4. JSON parse, sort the array in ascending order of dt_tracker -> build pathPoints array
      5. build truckPoint Object -> the last point in pathPoints
      6. evaluate driveStatus
         1. if all points (of pathPoints array) has acc = 0 and speed < 2 -> driveStatus = 'Halted'
         2. if all points (of pathPoints aray) has acc = 1 and speed > 2 -> driveStatus = 'Driving'
         3. otherwise -> driveStatus = 'Unknown'
      7. compute topSpeed, averageSpeed, totalDistance and runDuration from tripPath - consider only those pair of consecutive points where both points have acc = 1 and speed > 2
      8. return truckPoint, pathPoints, driveStatus, topSpeed, averageSpeed, totalDistance and runDuration
   3. if tripStage is 'Planned' or 'Start Delayed'
      1. get lat, lng from redis using keys ${deviceImei}:lat, ${deviceImei}:lng, ${deviceImei}:dt_tracker
      2. build truckPoint object with these lat-lng and dt_tracker values
      3. return truckPoint
   
2. **presenceInSignificantLocation** function
   1. receive currentSignificantLocation object, startLocation, endLocation, viaLocations and truckPoint
   2. use truckPoint and find if the truck is within any of the significantLocations ( startLocation, endLocation, viaLocations)
   3. call it newSignificantLocation
      1. if truck is not inside any significantLocation - newSignificantLocation = null
      2. if truck is inside any significantLocation - newSignificantLocation = {...significantLocation}
      3. if newSignificantLocation
         1. if currentSignificantLocation object is null
            1. currentSignificantLocation = {...newSignificantLocation, entryTime: dt_tracker of truck point}
         2. if currentSignificantLocation object is not null
            1. newSignificantLocation is same as currentSignificantLocation
               1. do nothing
            2. new significantLocation if different than currentSignificantLocation
               1. create object previousSignificantLocation object by copying currentSignificantLocation
                  1. add exitTime (truckPoint dt_tracker) to the previousSignificantLocation
               2. create fresh currentSignificantLocation object
                  1. currentSignificantLocation = {...newSignificantLocation, entryTime: dt_tracker of truck point}
      4. If newSignificantLocation = null 
         1. if currentSignificantLocation is not null
            1. currentSignificantLocation = {...currentSignificantLocation, exitTime: dt_tracker of truckPoint}
         2. if currentSignificantLocation = null
            1. do nothing
   4. return currentSignificantLocation and (if avaiable) previousSignificantLocation

3. **getRouteSituation** function
   1. receive truckPoint, pathPoints, routePath (route.routePath)
   2. use the truckPoint and the routePath to determine and return
      1. nearestRoutePoint - lat,lng
      2. nearestPointIndex - index of this nearestRoutePoint in the routePath array
      3. distanceFromTruck (of the nearestRoutePoint)
      4. cumulativeDistance - distance of the route covered so far (index 0 till nearestPointIndex)
   3. use tripPath and the route object to 
      1. determine travelDirection - forward or reverse.
      2. if travelDirection is reverse -> compute distance covered while travelling reverse - reverseTravelDistance
   4. return nearestRoutePoint, nearestPointIndex, distanceFromTruck, cumulativeDistance, travelDirection and reverseTravelDistance

4. **checkRules** function
   1. Receive rules object - {drivingStartTime, drivingEndTime, speedLimit, maxHaltTime, routeViolationThreshold}
   2. Receive ruleStatus object - {drivingTimeStatus, speedStatus, haltTimeStatus, routeViolationStatus}
   3. Receive pathPoints, truckPoint, currentHaltDuration, truckDistance, travelDirection, reverseTravelDistance, currentSignificantLocation
   4. check each rule against the trip's current parameters (recived in point 3 and existing status of that rule (received in point 2)
   5. For routeViolation rule - if either of the truckDistance or reverseTravelDistance violates the routeViolationThreshold, then consider the rule violated
   6. If the ruleViolationStatus is Normal and previous status was also normal, then omit it from the return object
   7. return the updated ruleStatus Object with the items where status is Violated or became Good from Violated

5. **tripStatusChecker** function
   1. receive - ruckPoint, tripPath, currentSignificantLocation, movementStatus, tripStage, activeStatus
   2. use the following rule set to evaluate new tripStage and activeStatus
      1. tripStage: Planned - check presence in startLocation
         1. Reached startLocation -> tripStage: ACTIVE | activeStatus: Reached Origin
         2. Not reached startLocation -> START Delayed | activeStatus: Inactive
      2. tripStage: Start Delayed - check presence in startLocation
         1. Reached startLocation -> ACTIVE | activeStatus: Reached Origin
         2. Not reached startLocation -> START Delayed | activeStatus: Inactive
      3. tripStage: Active (Check movementStatus, presence in significantLocations, routeViolationStatus)
         1. activeStatus: Reached Origin
            1. If still at startLocation
               1. check dwellTime at startLocation > maxDetentionTime -> activeStatus: Detained At Origin
            2. Left startLocation
               1. movementStatus - Halted -> activeStatus: Halted
               2. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
               3. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
         2. activeStatus: Detained at Origin
            1. If still at startLocation
               1. check dwellTime at startLocation > maxDetentionTime -> activeStatus: Detained At Origin
            2. Left startLocation
               1. movementStatus - Halted -> activeStatus: Halted
               2. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
               3. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
         3. activeStatus: Running On Route
            1. In any viaLocation -> activeStatus: Reached Via Location (viaLocationName) 
            2. In endLocation -> activeStatus: Reached Destination 
            3. movementStatus - Halted -> activeStatus: Halted
               1. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
               2. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
         4. activeStatus: Route Violated
            1. In any viaLocation -> activeStatus: Reached Via Location (viaLocationName) 
            2. In endLocation -> activeStatus: Reached Destination 
            3. movementStatus - Halted -> activeStatus: Halted
               1. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
               2. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
         5. activeStatus: Halted
               1. movementStatus - Halted -> activeStatus: Halted
               2. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
               3. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
         6. activeStatus: Reached Via Location (viaLocationName)
            1. If still at same viaLocation 
               1. check dwellTime at this viaLocation > maxDetentionTime -> activeStatus: Detained At Via Location (viaLocationName)
            2. Left that viaLocation and not entered any other viaLocation
               1. movementStatus - Halted -> activeStatus: Halted
               2. movementStatus - Driving -> routeViolationStatus - Good -> activeStatus: Running on Route
               3. movementStatus - Driving -> routeViolationStatus - Violated -> activeStatus: Route Violated
            3. Inside a different viaLocation
               1. activeStatus: Reached Via Location (viaLocationName)
         7. activeStatus: Reached destination
            1. If still at endLocation
               1. check dwellTime at endLocation > maxDetentionTime -> activeStatus: Detained At Destination 
            2. If left endLocation
               1. tripStage: Completed 
         8. activeStatus: Detained at destination
            1. If still at endLocation
               1. check dwellTime at endLocation > maxDetentionTime -> activeStatus: Detained At Destination 
            2. If left endLocation
               1. tripStage: Completed
   3. return tripStage and activeStatus
   
6. **sendAlerts** function
   1. receive - updated variables
   2. build a switch case block to determine the notification category
   3. load the notifications object available from route object
   4. sms - if sms array has one or more elements
      1. build smsText
      2. call sms sender api and send message to all sms recepients which are enabled for this notification category
      3. add entry to sentNotifications
   5. email - if email array has elements
      1. build email text using emailTemplate
      2. send email to all email recepients which are enabled for this notification category
      3. add entry to sentNotifications
   6. whatsApp - if whatsApp array has elements
      1. build whatsApp message using Template
      2. call whatsApp sender API and send whatsApp to all recepients which are enabled for this notification category
      3. add entry to sentNotifications
   7. push -if push array has elements
      1. send push notification to recepients which are enabled for this notification category
      2. add entry to sentNotifications

7. **updateTripRecord** function
   1. receive existing trip record and all updated variables and their values
   2. build update query
   3. execute and update trip record in database

8. **main** function
   1. declare global array allTrips as an empty array
   2. connect to mongoose tripdb
   3. fetch all trips with status 'Planned', 'Start Delayed' and 'Active'
   4. save these trip records in global allTrips array.

9.  **mainLoop** function
   1. Process trip records from global array allTrips one by one
      1. pop one element from the allTrips array and process it 
      2. after processing of this record is complete, pop the next element and process
      3. when allTrips has become empty, end the processing (process.exit(0))
   2. With each trip record do the following -
      1. update lastCheckTime to current Time
      2. if tripStage is 'Planned' or 'Start Delayed'
         1. call getTripPath function -> receive truckPopint
         2. call presenceInSignificantLocation function -> get updated currentSignificantLocation object
         3. call tripStatusChecker -> get update tripStage and activeStatus
         4. call updateTripRecord function with updated variables with their new values
      3. if tripStage is active
         1. call getTripPath function -> get all return values
            1. update movementStatus -> trip.movementStatus === 'unknown' ? driveStatus : driveStatus === 'unknown' ? trip.movementStatus : driveStatus;
            2. update haltStartTime and currentHaltDuration
            3. update truckRunDistance -> use totalDistance
            4. update runDuration and parkedDuration -> use movementStatus and runDuration
            5. update topSpeed and averageSpeed
            6. update tripPath - add the pathPoints to the tripPath array
         2. call presenceInSignificantLocation
            1. receive currentSignificantLocation and (maybe) previousSignificantLocation
            2. if previousSignificantLocation is received - then 
               1. compute dwellTime, add to the previousSignificantLocation object
               2. push it in the significantLocations array
            3. if currentSignificantLocation as received has exitTime
               1. compute the dwellTime and add to the object
               2. push currentSignificantLocation object into significantLocations array
            4. if currentSignificantLocation as received does not have exitTime
               1. update currentSignificantLocation on the trip object with the returned currentSignificantLocation
         3. call getRouteSituation function
            1. update distanceCovered, distanceRemaining
            2. update estimatedTimeOfArrival (use movementStatus, distanceRemaining and averageSpeed)
            3. if travelDirection is reverse and reverseTravelDistance > 500, 
               1. then add the pathPoints to reverseTravelPath.
               2. incremenet the reverseTravelDistance 
            4. if travelDirection is forward, 
               1. then set reverseTravelPath as null
               2. set reverseTravelDistance as 0
         4. call checkRules function
            1. Get updated ruleStatus object
            2. For the rules where status is Violated
               1. check if an element is already open in significantEvents for this particular instance of violation
               2. if not, create a new element and add 
                  1. eventType ('Rule Violation'), 
                  2. eventName (name of the rule which got violated)
                  3. eventTime and eventStartTime - dt_tracker of first pathPoint
                  4. eventLocation - location of first pathPoint
                  5. eventPath - push pathPoints
                  6. call sendAlerts function
               3. if an element is present 
                  1. add pathPoint to eventPath
                  2. use updated eventPath to compute and update eventDuration (seconds) and eventDistance (meters)
            3. For the rules where status became Good but last status was Violated
               1. add eventEndTime - dt_tracker of first pathPoint
               2. update eventDistance and eventDuration
               3. call sendAlerts function
         5. call tripStatusChecker function
            1. receive updated tripStage and activeStatus
            2. update trip record with new tripStage and activeStatus (if changed from previous status)
            3. if tripStage is "Completed"
               1. update endReason - Trip Completed
               2. endLocation - route endLocation
            4. call sendAlerts if a change is detected in tripStage or activeStatus
         6. check fuelStatusUpdateTime and see if 1 hour has passed since last update
            1. if yes
               1. call fuel_integrated api with deviceImei, timeFrom : time when trip became active, timeTo: currentTime, user_id: ilogistekUserId of the trip record
               2. receive fuelFillinga nd Theft events, startVol, endVol, fuelConsumption and fuelEfficiency
               3. update these in the trip object
      4. Check all values which got updated during execution of all above mentioned processes
      5. call updateTripRecord function with all updated values

# New Trip Management System Plan

## New Objectives

### Segment Based Trip Monitopring

1. check if currentSignificantLocation is not null and previousSignificantLocation is null -> means vehcile entered significantlocation, hence -> segment changed
2. If segment has changed
   1. update the latest element in segmentHistory
      1. distanceCovered, distanceRemianing(should be 0), completionPercentage
      2. endLocation -> tripPathIndex, arrivalTime
   2. create new segmentObject
      1. copy the segment object from segments array on the route
      2. add properties - startTime (dt_tracker of the gps point triggering segemnt start), status: running, distanceCovered: 0, distanceRemaining: segementLength, completionPercentage: 0, ETA: null, startLocation: {locationName, arrivalTime}
      3. set currentlyActiveSegmentIndex to the index of this segement in route segments array
      4. set this object as currentlyActiveSegment
      5. push this object into segment history array
3. if segment has not changed
   1. check if vehicle is in styartLocation of the segment
      1. if yes, do nothing
      2. if not, check if startLocatiuon.departureTime is set
         1. if no, 
            1. then set departureTime to the dt_tracker of the first point of current gps data (first pathPoint)
            2. comppute dwellTime and update startLocation property of currentActiveSegment
   2. if not
      1. get segmentPath of the currentlyActiveSegment
      2. run routeChecker algo on the segment path
      3. get distanceCovered, distanceRemaining, completionPercentage and ETA for this segmentPath
      4. update these values in currentlyActiveSegment object
4. Now aggregate distanceCovered, disatnceRemaining for all segment objects in segmentHistory. Then add the same values for currentlyActiveSegment. Then update these aggregate values to the main trip object.


### BackDated Trip handling
> Sometimes the trips are created after vehicle has already started, or even finished the trip. In such cases our real time flow will not work. 

1. How to detect a backdated trip
   1. trip's plannedStartTime is before trips createdAt time (should have the backDated flag set to true)
2. What to do with backdated trips
   1. Need to follow the same process as the main flow
      1. get the tripPath from routeRaw
      2. start iterating from the start - build sub array of first 5 minutes, slice it out, send it to trip procesing algo
      3. Go on till the entire array is finished or trip Complete is achieved
      4. instead of saving DBrecords, keep building the trip Object and then when the full data is processed, update all at once and leave it ready for next normal run (if the trip was completed in the bakcdated period)

## Thinggs to do to handle backdate processing in parallel with real time

1. Review all helper functions and see where current time is used, make sure that all times are dt dt_tracker
2. database updation logic - need to update the master trip object and then save. handle arrays and nested fields
3. review all helper Fucntions and make them independent. they should perform their updates to the trip object and return it. master should not do a lot of logic
4. redo tripmaster logic in a lean way
5. setup backdating master 
   1. this will handle one trip at a time.
   2. it will be trrigerred when a trip is created with backdating from mobile api
   3. mobile api should push it in a backdateQueue redis
   4. trip master should at the end of all normal trips processing, pop this queue and process the trips
   5. tripmaster if need be, will pick it up at the next run
6. Review trip Completion logic. It should ideally be an independent fucntion, which should be called from tripMaster or backDateMaster
7. create completeTrip function
   1. Set necessary variables on the trip object
   2. make a JSON stringify of the whole trip Object
   3. send it to fileMaster for saving

### Finished Trip Data handling
1. Need to implement a redis-fileMaster-fileWritter setup to save trips on aws
2. need to verify the tripData required for displaying list items and basic reports. rest data should be deleted from mongodb record
3. Need to setup dataApi for returning tripData 
4. Need tyo update get trip data Mobile APi with this new fetching (from mongo and file together)

 
## New Helper Functions

1. getLiveTripPath() - done
2. getBackdatedTripPath() - done
3. movementChecker() - done
4. pathMetricsCalculator() - done
5. locationChecker() - done
6. segmentChecker() - done
   1. routeChecker() - done
7. fuelChecker() - done
8. checkRules() - done
9. statusChecker() - done
11. alertSender() - done
12. dbUpdater() - done
10. finishTrip() - done

## Helper Fucntions

1. alertSender()
2. checkRules()
3. dbUpdater()
4. fuelChecker()
5. getTripPath()
6. locationChecker()
7. movementChecker()
8. processHistoricalData()
9. routeChecker()
10. segmentChecker()
11. statusChecker()
12. getRouteRaw()
13. getAddress()


## Trip Properties to Keep in Mongo
Based on the code in <mcfile name="TripListItem.jsx" path="j:\Github\ilog_next\ilog3\src\components\tripcenter\tripComponents\TripListItem.jsx"></mcfile>, here are all the properties of the trip object that are being used:

1. `_id` - Unique identifier for the trip
2. `truckRegistrationNumber` - Vehicle registration number
3. `fuelEfficiency` - Fuel efficiency in Km/L (optional)
4. `route` - Object containing route information
   - `routeName` - Name of the route
5. `actualStartTime` - Actual time when trip started
6. `plannedStartTime` - Planned start time of the trip
7. `completionPercentage` - Percentage of trip completion
8. `currentLocation` - Object containing current location information (optional)
   - `name` - Name of the location
   - `type` - Type of location ('startLocation', 'endLocation', or other)
9. `activeStatus` - Current status of the trip
10. `activeStatusColor` - Color code for the active status
11. `tripStage` - Current stage of the trip ('Active', 'Planned', 'Start Delayed', 'Completed')
12. `stageColor` - Color code for the trip stage
13. `violationsCount` - Number of violations in the trip
14. `tripId` - Trip identifier used for logs

These properties are used in various parts of the component for displaying trip information, controlling the UI state, and managing trip-related actions.


### Combined Properties List to keep

1. _id
2. iLogistekUserId
3. tripName
4. tripId
5. erpSystemID
6. truckRegistrationNumber
7. deviceImei
8. route
9.  customer
10. goodsName
11. actualStartTime
12. actualEndTime
13. endReason
14. tripStage
15. truckRunDistance
16. fuelConsumption
17. fuelEfficiency
18. tripDataFile


## Final work
1. Build new liveTRipMaster and bakdatedTripMaster