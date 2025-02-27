const { redisClient } = require('../common/liveDB');
const { tripLogger } = require('./logger');
const { getLengthBetweenPoints } = require('./helpers');


async function getTripPath(trip) {
    try {
        const { deviceImei, tripStage } = trip;
        if (tripStage === 'Active') {
            // Get and clear rawTripPath data from redis
            const rawPathData = await redisClient.lRange(`${deviceImei}:rawTripPath`, 0, -1);
            await redisClient.del(`${deviceImei}:rawTripPath`);
            //tripLogger(trip, `#FN:TripPath raw points ${deviceImei} Stage: ${tripStage} Points: ${rawPathData.length}`);
            // Parse and sort path points
            const pathPoints = rawPathData
                .map(point => JSON.parse(point))
                .sort((a, b) => new Date(a.dt_tracker) - new Date(b.dt_tracker));

            if (!pathPoints.length) return null;

            // Get last point as truck point
            const truckPoint = pathPoints[pathPoints.length - 1];

            // Evaluate drive status
            let driveStatus = 'Unknown';
            const isAllHalted = pathPoints.every(p => parseInt(p.acc) === 0 && parseInt(p.speed) < 2);
            const isAllDriving = pathPoints.every(p => parseInt(p.acc) === 1 && parseInt(p.speed) > 2);

            if (isAllHalted) driveStatus = 'Halted';
            else if (isAllDriving) driveStatus = 'Driving';

            // Compute metrics
            let topSpeed = 0;
            let totalValidSpeed = 0;
            let validSpeedPoints = 0;
            let totalDistance = 0;
            let runDuration = 0;

            for (let i = 1; i < pathPoints.length; i++) {
                const prevPoint = pathPoints[i - 1];
                const currentPoint = pathPoints[i];

                if (prevPoint.acc == 1 && currentPoint.acc == 1 &&
                    prevPoint.speed > 2 && currentPoint.speed > 2) {

                    topSpeed = Math.max(topSpeed, prevPoint.speed, currentPoint.speed);
                    totalValidSpeed += (prevPoint.speed + currentPoint.speed) / 2;
                    validSpeedPoints++;

                    const p1 = { latitude: prevPoint.lat, longitude: prevPoint.lng };
                    const p2 = { latitude: currentPoint.lat, longitude: currentPoint.lng };
                    totalDistance += getLengthBetweenPoints(p1, p2);
                    runDuration += (new Date(currentPoint.dt_tracker) - new Date(prevPoint.dt_tracker)) / 1000 / 60;
                }
            }

            const averageSpeed = validSpeedPoints > 0 ? totalValidSpeed / validSpeedPoints : 0;
            return {
                truckPoint,
                pathPoints,
                driveStatus,
                topSpeed: Math.round(topSpeed),
                averageSpeed: Math.round(averageSpeed),
                totalDistance: totalDistance / 1000,
                runDuration
            };

        } else if (tripStage === 'Planned' || tripStage === 'Start Delayed') {
            // Get current location for planned/delayed trips
            const [lat, lng, dt_tracker] = await Promise.all([
                redisClient.get(`${deviceImei}:lat`),
                redisClient.get(`${deviceImei}:lng`),
                redisClient.get(`${deviceImei}:dt_tracker`)
            ]);

            return {
                truckPoint: { lat, lng, dt_tracker }
            };
        }
    } catch (err) {
        console.error('Error in getTripPath:', err);
        tripLogger(trip, '#FN:TripPath: Error in getTripPath:', err);
        return null;
    }
}

module.exports = getTripPath;