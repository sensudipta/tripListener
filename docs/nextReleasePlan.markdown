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
