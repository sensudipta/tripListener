# System Components

## Editing Interfaces
1. Interface for Creating Geofences (to mark factory and customer delivery locations on map)
2. Interface for creating routes using google maps - Start, End and Via points (max 20) can be selected from user's zones/markers
3. Interface for creating routes from vehicle history
4. Interface for creating Drivers with details
   1. Driver Name
   2. Driver Phone Number
   3. Driving License Number
   4. DL valid Upto
   5. Driver Photo 
5. Interface for Creating Vehicle Details
   1. Vehicle will be auto created in the system from Roadmatics backend 
   2. Vehicle Details
      1. Vehicle Number (auto created)
      2. Transporter Name - Shiny Shipping (auto created)
      3. Transporter Contact Number
      4. Transporter Email Address
6. Interface for creating trips by selecting
   1. Trip Name (a trip ID will be auto generated)
   2. Trip Identification from ERP System (Optional add on available upon deep integration with User's ERP system)
   3. Vehicle
   4. Driver(s) [ option to add multiple drivers for double/triple driver setups ]
   5. Trip Origin Geofence
   6. Customer
      1. Customer Company Name
      2. Customer delivery location geofence
   7. Route - from list of routes already created
   8. Start Time
   9. Estimated End Time
   10. Cargo Details
      1. Goods Name / Description
      2. Other Fields ( as required)
   11. Maximum Allowed speed
   12. Maximum allowed detention at origin
   13. Maximum allowed detention at destination
   14. Maximum route deviation allowed (Kilometers away from route)
   15. Driving Allowed Period (Say 8 AM to 6 PM)
   16. Max allowed halt duration (during allowed hours)


## Monitoring Interfaces

1. Trip Dashboard
   1. Planned Trip (Trip start time in future)
      1. List of planned trips showing 
         1. Trip Start Time
         2. Estimated End Time
         3. Route - start and end geofence, kilometers, estiamted time required
         4. Vehicle Details - veh number, transporter details
         5. Driver Details - name phone number
         6. Tranrporter Details
   2. Live Trips (Trip start time elapsed and trip not completed)
      1. Trip Details - strat/end time, vehicle, transporter, customer, driver, route etc
      2. Progress - 
         1. Kilometers completed vs total route kilometers shown as percentage
         2. Kilometers covered so far
         3. Kilometers left to reach destination
         4. Estimated time of arrival (Optional)
      3. Trip Status - Not Started, Reached origin, Running as per Route, Running off route, Halted, Reached Destination, Detailed at Destination, Left destination (trip completed), Estimated Time of Arrival (approx.)
   3. Completed Trips
      1. Trip Details - Actual Start/end time, actual time taken, actual distance covered, location from and to, customer details, goods details
   4. Aborted Trips - Trip started but did not finish. Trip aborted manually.
      1. Trip Details
         1. Actual Start Time
         2. Manual Abort Time
         3. Reason for aborting trip
         4. Vehicle Location at the time of aborting
         5. Vehicle, Transporter, Route and Goods Details
   5. Cancelled Trips - Trips planned but manually cancelled.
      1. Trip Details
         1. Planned Start / End Time
         2. Manual Abort Time
         3. Reason for cancelling trip
         4. Vehicle Location at the time of aborting
         5. Vehicle, Transporter, Route and Goods Details


## Reporting interfaces

1. Reporting Interface is available on the web portal
2. Report Columns to be selectable
3. Reports can be downloaded as excel files
4. PDF export of reports from web portal (optional)
5. Report Data Items
   1. DATE (Planned Trip start Date)
   2. Vehicle No
   3. TRIP NAME
   4. Starting Location (Origin Geofence Name)
   5. Trip Start Date (Actual trip start date)
   6. Start Time (Actual trip start time)
   7. Last Location ( Destination Geofence Name)
   8. Source Entry Time (Origin geofence entry time)
   9. Source Exit Time (Origin Geofence exit time)
   10. Detention at Source (Time period between entry and exit of origin geofence)
   11. Destination Name (Destination geofence name)
   12. End Date (Actual trip end date)
   13. End Time (Actual trip end time)
   14. Destination Entry Time (Destination geofence entry time)
   15. Destination Exit Time (Destination geofence exit time)
   16. Detention at Destination (Time period between entry and exit of destination geofence)
   17. Material Name
   18. Trip End Reason (Normal finish - vehicle left destination geofence, custom reason - if entered manually - for aborted trips)
   19. Parked Duration (Total duration of parkings after leaving origin geofence and before entering destination geofence)
   20. Inactive Duration (Need clarification - what is this)
   21. Actual Time (Assumption - The actual run time between orgin and destination exluding parked time)
   22. Distance Covered (Actual distance covered by vehicle)
   23. Over Speed Violations - (Number of overspeed events)
   24. Night Driving Violations - (number of times vehicle was moved during non allowed driving periods)
   25. Count Of Geofence Exits (Need clarification - as such it should be two - once for origin, once for destination. Do we need more geofences along the way? Also, will the trips be for one paird of origin destination or will it be multi stop - One origin and multiple sequential destinations )
   26. Average Speed
   27. Event (What events?)
   28. Speed (Km/Hr) (What speed needs to be shown here - top speed? we have already shown average speed on column no 28)


## Alerts

1. Alerts will be created on defined events
2. Alerts will be sent via Email and Whatsapp (Optional)
3. Alert events
   1. Vehicle reached Origin
   2. Origin detention elapsed
   3. Trip Started
   4. Trip Progress - 25%, 50%, 75%
   5. Route deviation
   6. Over speed
   7. Driving outside of allowed hours
   8. Vehicle reached destination
   9. Destination detention elapsed
   10. Trip Completed
   11. Trip Aborted
4.  Alert Data payload
    1.  Alert Event Type (as per defined events)
    2.  Event trigger Time
    3.  Trip name
    4.  Destination Name
    5.  Trip Start date & time (Actual)
    6.  Goods / Material name
    7.  Vehicle Name
    8.  Driver Name
    9.  Driver Contact Number
    10. Transporter Name
    11. Transporter contact info (phone and email)
    12. Vehicle current location 
        1.  Location address
    13. Trip Progress at the time of alert trigger
        1.  Total Distance
        2.  Total budgeted time for completing trip (based on planned start and end time)
        3.  Distance Covered so far
        4.  Distance left to destination
        5.  Time elasped since trip start
        6.  Estimated Time of arrival and Time required to reach destination (optional)
    14. Vehicle Location link (To open Google maps with a marker on vehicle current location)
    15. Destination Entry Time (If reached destination)
    16. Destination Exit time (If exited from destination geofence)

  