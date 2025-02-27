1. Get Google Maps in proper working order
   1. List down all necessary features
   2. reimplement the features using visgl library
   3. test and make sure everything works - mota mota
2. Setup Route saving controller
   1. route data model (already there)
   2. save route logic (already there - quick review)
   3. v3 side - slice and reducers for submitting route data (already there - review)
3. Show list of routes - v3 app
   1. controller to load tripdata frommongodb and respond
   2. design route list view and route cards
4. Setup menthods to show route on google map (list item click) - v3 app
   1. setup route line drawing with required icons on google maps
5. Trip Creation form - v3
   1. simple form with fields for selecting vehicles, route, start and end time
   2. advanced form will come later
   3. slice and reducers for submitting trip form data to backend
6. Backend controller to save trips
   1. trip data model on mongodb
   2. simple controller to save trip data sent from v3 into db
7. Show trip list view - v3
   1. slice and reducer to ask tripdata from backend
   2. controller to load tripdata from db and respond
   3. list view and list cards design and implement
8. Show trip on maps
   1. show route line (in light color) and trip route line (in same color darked/bolder) to display trip progress against route
9.  Trip Listener - process trips against mapped vehicles and update trip status and other variables
10. Trip Event System - check trip status and other variables against given rule set and generate events
11. Trip Alert system - Broadcasting trip events to users via sms, whatsapp and mobile app
12. Trip report system - 
    1.  trip report form (new form or integrate into existing report form)
    2.  report egenration backend logic - buildReport functions
    3.  report view templates
    4.  report view excel and pdf