# Views

> This view will contain features required for creating and monitoring trips and routes.

1. 


## Trip Center
>

### Trip Center Top

### Trip List Sidebar

### Trip Center Main Content (Map View)


## Routes

### Routes Top

### Routes Sidebar

### Routes Main Content (Map View)



# Create Route

> Need 
1. routeName
2. startLocation
   1. zone - (zoneid, zoneName, coords)
   2. marker and triggerRadius
   3. point on map and triggerRadius
   4. location name - (zone, marker name or custom name)
   5. max detentionTime
3. endLocation
4. viaLocations
5. rules
   1. drivingStartTime
   2. drivingEndTime
   3. speedLimit
   4. maxHaltTime
   5. routeViolationThreshold
   6. reverseDrivingThreshold
6. notifications
   1. whatsApp - name,number, categories
   2. email - name, email, categories
   3. push - name, phone number, categories



# Create Route Wizard

1. routeName -> enter or select auto
2. Add Start Location
   1. Radio -> zone, marker, locate on map
   2. if zone -> zone select dialog with autocomplete -> on select update zone details, locationName
   3. if marker -> marker select dialog & triggerRadius input
   4. if point -> let user select the point on map -> location name prompt
   5. maxDetention -> hours input
   6. save
3. Add End Location (same as start)
4. Add Stop / Build Route -> same dialog after adding each stop
5. Add Stop (number) -> add location dialog
6. Add rules
   1. Chekbox - rule name, inputs
7. Notifications - add whatsapp, add email, add push
8. Notif dialog - Name, Number / email, category checkboxes - 
9. if name auto then name = startLoc-endLoc-noOfViaLocs-Stop ->save
   

# route View Cards

routeName, startLocation - name, type, maxDetention, endLocation, no of stops if > 0,
routeLength, routeDuration
number of rules, number of notifications
view on map, delete, add trip - buttons

map view -
1. Route PolyLine
2. start, end and via locs - icon and circle or zone



# Add Trip

Start from Route

1. Truck select
2. Customer and Goods, erpSystemId
3. add Start Time
5. TripName - auto - routeName + Date,month, startTime
6. Show Rules
7. Save



# View Trip

1. Card View 
   1. Route name, trip name, truck number, customer name
   2. Planned / actual start time / end time, tripStage, activeStatus, movement status
   3. Progress - distance remaining, percent complete, eta (distance covered, truckDistance covered)
   4. Rule Compliance - Good, Violated (if any rule violation is there)
   5. Last significant location (left n hours ago)
   6. Fuel - consumption, mileage, filled, currentlevel
2. Map View
   1. Route PolyLine (full path in light color, completed path - index 0 to nearestPointIndex in bold color)
   2. start, end and via locs - icon and circle or zone
   3. Trip Path PolyLine (Truck path - dark color)
   4. truck asset icon (live)
   5. event paths in red - mouseover - event type, event name, event time, event duration, event distance, eventIcon at eventLocation
3. Big Modal View
4. Report view




## Trip data

### Trip Details
tripName
tripId
erpSystemId
plannedStartTime

### Truck and Driver
truckRegistrationNumber
driverName
driverPhoneNumber

### Customer & Goods
customer, goodsName, goodsDescription



### Compliance Violation Status
drivingTimeStatus
speedStatus
haltTimeStatus
routeViolationStatus
reverseTravelDistance
generatorHours, generatorHoursPercentage
generatorDistance, generatorDistancePercentage
minTemperature, maxTemperature
maxFuelConsumption, minFuelEfficiency



### Trip Progress
actualStartTime

actualEndTime
endReason
abortReason
endLocation

tripStage
activeStatus

movementStatus
distanceCovered
distanceRemaining
estimateTimeOfArrival
parkedDuration
runDuration
averageSpeed
topSpeed
truckDistance

### Recent Activity
currentLocation (if any) - locationName, entryTime, dwellTime
if not currentLocation - lastLocation (latest item in significantLocations) - locationName, entryTime, dwellTime, exitTime

last significantEvent - (last item in significantEvents array) - eventType, eventName, eventTime, eventDuration, eventDistance, eventLocation

### Fuel Situation
currentFuelLevel
fuelConsumption
fuelEfficiency
fuelStatusUpdateTime
Fuel events list


### Trip Notifications
sentTime
recipient.name, recipient.number
type
category
message (truncate in table, show full on mouseover)



## Design Elements

There will be two types of display elements and three types of views for the trips

1. List Card
   1. Cards that will appear as listItems in the leftsidebar area (width - 300-350px)
   2. Card Header - will have basic information related to trip identity and current status
   3. Card Content - will have more detailed information on the trip progress and current situation
2. DetailView Modal
   1. A larger panel to show all trip related information

Below are the brief description of each of the above mentioned design elements

1. List Card
   1. Card Header - 
      1. truckRegistrationNumber, 
      2. routeName, 
      3. tripStage, 
      4. activeStatus, 
      5. plannedStartTime (if tripStage is Planned or Start Delayed) or estimateTimeOfArrival (if tripStage is Active) or actualEndTime (if tripStage is Completed or Aborted)
      6. movementStatus
   2. Card Header action buttons - Show trip (collapse uncollapse the cardcontent section), Cancel Trip
   3. Card Content
      1. Truck - truckRegistrationNumber, driver name, driver number, movementStatus, truckDistance (KM), crrenuHaltDuration (if activeStatus Halted)
      2. Customer - customer, goodsName
      3. Trip Progress - distanceCovered, distanceRemaining, estimateTimeOfArrival, parkedDuration, runDuration, averageSpeed, topSpeed,
      4. Compliance - Good if no ruleVIolation event is there in significantEvents, otherwise - Violated. Also show the names of rules which has been violated (find from significantEvents)
      5. Location - Last Significant Location - locationName, entry time, exitTime and dwellTime (if vehicle exited this location)
      6. Fuel Situation - currentFuelLevel,fuelConsumption,fuelEfficiency
2. DetailView Modal
   1. All trip information neatly organized
   2. A timeline showing all important events - merge significantLocation and significantEvents array, sort by time -> timeline info -> eventTime or eventStartTime, eventType, eventName, locationName, entryTime (eventStartTime), exitTime (eventEndTime), eventDuration or dwellTime, eventDistance
   



