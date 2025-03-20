const express = require('express');
const router = express.Router();
const moment = require('moment');
const datasource = require('../sourceLoader/datasource');
const s3Reader = require('../sourceLoader/s3Reader');
const diskReader = require('../sourceLoader/diskReader');
const redisReader = require('../sourceLoader/redisReader');
const redisHeaderReader = require('../sourceLoader/redisHeaderReader');
const greapMaker = require('../sourceLoader/grepMaker');
const folderName = 'trackerdata';
const minStopStandard = 300000;
const minDriveStandard = 1;
const minIdleStandard = 1;
const cutoff_speed = 2;

router.post('/driveandstopfuel', function (req, res) {
    let { timeFrom, timeTo, imei, minStop, minDrive, minidle } = req.body;
    console.log("Req", req.body);
    let timefrmarr = timeFrom.split(" ");
    let timefrmdate = timefrmarr[0];
    let timefrmtime = timefrmarr[1];
    if (timefrmtime == ':00:00') {
        timeFrom = `${timefrmdate} 00:00:00`;
    }
    if (!minStop) {
        minStop = minStopStandard;
    }
    if (!minDrive) {
        minDrive = minDriveStandard;
    }
    if (!minidle) {
        minidle = minIdleStandard;
    }
    console.log("Drive and Stop Request", timeFrom, timeTo, imei);
    const startTime = moment(timeFrom).subtract(330, 'minutes').format('YYYY-MM-DD HH:mm:ss');
    const endTime = moment(timeTo).subtract(330, 'minutes').format('YYYY-MM-DD HH:mm:ss');
    const sourceList = datasource(startTime, endTime);
    if (sourceList.length > 0) {
        sourceLooper(sourceList, imei, [], res, minStop, minDrive, minidle);
    } else {
        console.log("No Data found");
        res.status(200).send({ driveandstop: 'not_found' });
    }
});

module.exports = router;


async function sourceLooper(sourceList, imei, resData, res, minStop, minDrive, minidle) {
    const thisSource = sourceList.shift();
    let sourceData = [];
    if (thisSource.source == 's3') {
        sourceData = await gets3Data(thisSource, imei);
    } else if (thisSource.source == 'disk') {
        sourceData = await getdiskData(thisSource, imei);
    } else if (thisSource.source == 'diskandredis') {
        sourceData = await getdiskAndRedisData(thisSource, imei);
    } else {
        sourceData = [];
    }
    resData = [...resData, ...sourceData];
    if (sourceList.length > 0) {
        sourceLooper(sourceList, imei, resData, res, minStop, minDrive, minidle);
    } else {
        console.log("Raw data read, start process");
        const driveandstop = getStops(resData, minStop, minDrive, minidle);
        console.log("Drive and Stop Response", driveandstop.totalDistance);
        res.status(200).send({ driveandstop: driveandstop });
    }
}


function getStops(data, minStop, minDrive, minidle) {
    let stops = [];
    let stopped = 0;
    let stopStartIndex = null;
    let stopStartms = null;
    for (let i = 1; i < data.length; i++) {
        let datatype = 'inRange';
        if (i == 1) {
            datatype = 'rangeStart';
        } else if (i == data.length - 1) {
            datatype = 'rangeEnd';
        }

        const thisData = data[i];
        const stopSpeed = parseInt(thisData[3]);
        const dataCondition = parseInt(thisData[3]) > cutoff_speed ? 'drive' : 'stop';

        if (datatype == 'rangeStart') {
            if (dataCondition == 'stop') {
                stopStartIndex = i;
                stopped = 1;
                stopStartms = Date.parse(thisData[0]);
            }
        } else if (datatype == 'rangeEnd') {
            if (stopped == 1) {
                stops.push({
                    startIndex: stopStartIndex,
                    endIndex: i,
                });
            }
        } else {
            if (stopSpeed <= cutoff_speed) {
                if (stopped == 0) {
                    stopStartIndex = i;
                    stopped = 1;
                    stopStartms = Date.parse(thisData[0]);
                }
            } else {
                if (stopped == 1) {
                    if (Date.parse(thisData[0]) - stopStartms > minStop) {
                        if (stopStartIndex && stopStartms) {
                            stops.push({
                                startIndex: stopStartIndex,
                                endIndex: i,
                            });
                        }
                    }
                    stopped = 0;
                    stopStartIndex = null;
                    stopStartms = null;
                }
            }
        }
    }
    console.log("Raw Stops built", stops.length);
    return getDrives(data, stops, minDrive, minidle);
}


function getDrives(data, stops, minDrive, minidle) {
    let drives = [];
    stops.forEach(oneStop => {
        let lastdrive = drives.pop();
        lastdrive = {
            ...lastdrive,
            endIndex: oneStop.startIndex,
        };
        nextdrive = {
            startIndex: oneStop.endIndex,
        };
        drives = [
            ...drives,
            lastdrive,
            nextdrive
        ];

    })
    let refinedDrives = [];
    if (stops.length == 0) {
        if (data.length > 1) {
            const onlydrive = {
                startIndex: 0,
                endIndex: data.length - 1
            };
            refinedDrives.push(onlydrive);
        }

    } else {
        drives.forEach(onedrive => {
            if (onedrive.startIndex && onedrive.endIndex) {
                refinedDrives.push(onedrive);
            } else if (!onedrive.startIndex && onedrive.endIndex) {
                if (onedrive.endIndex != 0) {
                    const firstdrive = {
                        ...onedrive, startIndex: 0
                    };
                    refinedDrives.unshift(firstdrive);
                }
            } else if (onedrive.startIndex && !onedrive.endIndex) {
                if (onedrive.startIndex != data.length - 1) {
                    const lastdrive = {
                        ...onedrive, endIndex: data.length - 1
                    };
                    refinedDrives.push(lastdrive);
                }

            }
        })
    }
    console.log("Raw drives built", refinedDrives.length);
    return correctMinDrive(data, refinedDrives, minDrive, minidle);
}

function correctMinDrive(data, drives, minDrive, minidle) {
    let refinedStops = [];
    let refinedDrives = [];
    drives.forEach(oneDrive => {
        let driveData = [];
        for (k = 1; k < data.length - 1; k++) {
            if (k >= oneDrive.startIndex && k <= oneDrive.endIndex) {
                driveData.push(data[k]);
            }
        }
        const drivedist = distCalc(driveData);
        if (drivedist.point >= minDrive) {

            refinedDrives.push({ ...oneDrive, driveDistance: drivedist.point });
        }
    })
    if (refinedDrives.length === 0) {
        refinedStops.push({
            startIndex: 0,
            endIndex: data.length - 1,
        });
    } else {
        for (let i = 0; i < refinedDrives.length; i++) {
            const { startIndex, endIndex } = refinedDrives[i];
            if (startIndex > 0) {
                refinedStops.push({
                    startIndex: i === 0 ? 0 : refinedDrives[i - 1].endIndex,
                    endIndex: startIndex,
                });
            }
            if (i === refinedDrives.length - 1) {
                if (endIndex < data.length - 1) {
                    //route ends with a stop
                    refinedStops.push({
                        startIndex: refinedDrives[i].endIndex,
                        endIndex: data.length - 1,
                    })
                }
            }
        }
    }


    const totalDistance = refinedDrives.reduce((a, b) => a + b.driveDistance, 0);
    return getIdling(data, refinedStops, refinedDrives, totalDistance, minidle);

}



function getIdling(data, stops, drives, totalDistance, minidle) {
    let stopsWithIdles = [];
    stops.forEach(stop => {
        let idles = [];
        let idling = 0;
        let idleStartIndex = null;
        let idleStartms = null;

        for (let i = stop.startIndex; i <= stop.endIndex; i++) {
            let datatype = 'inRange';
            if (i == stop.startIndex) {
                datatype = 'rangeStart';
            } else if (i == stop.endIndex) {
                datatype = 'rangeEnd';
            }
            const thisData = data[i];
            //const acc = parseInt(thisData[5]);
            const dataCondition = parseInt(thisData[5]) == 1 ? 'idle' : 'stop';

            if (datatype == 'rangeStart') {
                if (dataCondition == 'idle') {
                    idleStartIndex = i;
                    idling = 1;
                    idleStartms = Date.parse(thisData[0]);
                }
            } else if (datatype == 'rangeEnd') {
                if (idling == 1) {
                    idles.push({
                        startIndex: idleStartIndex,
                        endIndex: i,
                    });
                }
            } else {
                if (dataCondition == 'idle') {
                    if (idling == 0) {
                        idleStartIndex = i;
                        idling = 1;
                        idleStartms = Date.parse(thisData[0]);
                    }
                } else {
                    if (idling == 1) {
                        if (Date.parse(thisData[0]) - idleStartms > minidle) {
                            if (idleStartIndex && idleStartms) {
                                idles.push({
                                    startIndex: idleStartIndex,
                                    endIndex: i,
                                });
                            }
                        }
                        idling = 0;
                        idleStartIndex = null;
                        idleStartms = null;
                    }
                }
            }
        }

        const thisStopWithIdle = { ...stop, idles };
        stopsWithIdles.push(thisStopWithIdle);
    })

    const finalData = {
        route: data,
        stops: stopsWithIdles,
        drives,
        totalDistance,
    };
    console.log("Final Data built", finalData.route.length, finalData.totalDistance, "stops", stopsWithIdles.length, "drives", drives.length);
    return finalData;
}


function distCalc(dataArry) {
    let sumDistOff = 0;
    let sumDistPoint = 0;
    let count = 0;
    dataArry.forEach((thisData, index) => {

        if (index > 1) {
            //console.log('Data index',index,data);
            const previousData = dataArry[index - 1];

            const speed1 = parseInt(previousData[3]);
            const speed2 = parseInt(thisData[3]);
            const acc1 = parseInt(previousData[4]);
            const acc2 = parseInt(thisData[4]);
            //console.log("Speed", thisData[5],"lat",thisData[3],"lng",thisData[4], "offset",thisData[7]);
            //console.log("Speed", data[5],"lat",data[3],"lng",data[4], "offset",data[7]);
            if (!isNaN(speed2)) {
                if (speed2 > cutoff_speed) {
                    const lat1 = parseFloat(previousData[1]);
                    const lng1 = parseFloat(previousData[2]);
                    const lat2 = parseFloat(thisData[1]);
                    const lng2 = parseFloat(thisData[2]);
                    const pointDist = getLengthBetweenCoordinates(lat1, lng1, lat2, lng2);
                    //console.log("GL Check", pointDist, thisData[7]);
                    sumDistPoint = parseFloat(sumDistPoint) + parseFloat(pointDist);
                    sumDistOff = parseFloat(sumDistOff) + parseFloat(thisData[5]);
                }
            }
        }
        count++;
    });
    //console.log("Point Sum", sumDistPoint, "Offset Sum", sumDistOff, "count", count);
    return { point: sumDistPoint, offset: sumDistOff };
    //console.log("Point Sum", sumDistPoint, "Offset Sum", sumDistOff, "count", count);
}


function getLengthBetweenCoordinates(lat1, lon1, lat2, lon2) {
    //console.log("GL proc",lat1, lon1, lat2, lon2);
    const theta = lon1 - lon2;
    //var dist = sin(deg2rad($lat1)) * sin(deg2rad($lat2)) +  cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * cos(deg2rad($theta));
    let dist = Math.sin(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(theta * Math.PI / 180);
    dist = Math.acos(dist);
    dist = dist * 180 / Math.PI;
    let km = dist * 60 * 1.1515 * 1.609344;

    if (isNaN(km)) {
        km = 0;
    }

    return km;
}




async function gets3Data(thisSource, imei) {

    const fileName = `${imei}_datafile_${thisSource.fileDate}`;
    //console.log("Attempting to get S3 Data", imei, fileName);
    const grepString = greapMaker.trackerDefault();
    const filearray = await s3Reader(folderName, fileName, grepString);
    //console.log("Proceeded S3 Data", filearray.length);
    if (filearray.length > 0) {
        return fileDataBuilder(filearray, thisSource);
    } else {
        return [];
    }
}

async function getdiskData(thisSource, imei) {

    const fileName = `${imei}_datafile_${thisSource.fileDate}`;
    //console.log("Attempting to get Disk Data", imei, fileName);
    const grepString = greapMaker.trackerDefault();
    const filearray = await diskReader(folderName, fileName, grepString);
    //console.log("Proceeded Disk Data", filearray.length);
    if (filearray.length > 0) {
        return fileDataBuilder(filearray, thisSource);
    } else {
        return [];
    }
}

async function getdiskAndRedisData(thisSource, imei) {
    //console.log("Attempting to get Disk+Redis Data", imei);
    const fileName = `${imei}_datafile_${thisSource.fileDate}`;
    const pipename = `${imei}:datafile:${thisSource.fileDate}:fresh`;
    const grepString = greapMaker.trackerDefault();

    const filearray = await diskReader(folderName, fileName, grepString);
    const redisarray = await redisReader(pipename, grepString);
    //console.log("Redis array length", pipename,redisarray.length);
    if (filearray.length > 0) {
        const diskandredisarray = [...filearray, ...redisarray];
        return fileDataBuilder(diskandredisarray, thisSource);
    } else if (redisarray.length > 0) {
        const headerLine = await redisHeaderReader(imei);
        //console.log("Found redis header", headerLine);
        if (headerLine) {
            const redisWithHeader = [headerLine, ...redisarray];
            return fileDataBuilder(redisWithHeader, thisSource);
        } else {
            return [];
        }
    } else {
        return [];
    }
}


function fileDataBuilder(filearray, thisSource) {
    let filebody = [];
    const headerArray = filearray.shift().split(',');
    const headerIndices = {
        dt_tracker: headerArray.indexOf('dt_tracker'),
        lat: headerArray.indexOf('lat'),
        lng: headerArray.indexOf('lng'),
        speed: headerArray.indexOf('speed'),
        offset: headerArray.indexOf('offset'),
        acc: headerArray.indexOf('acc'),
        angle: headerArray.indexOf('angle'),
        tank_1: headerArray.indexOf('tank_1'),
        tank_2: headerArray.indexOf('tank_2'),
        tank_3: headerArray.indexOf('tank_3'),
        tank_4: headerArray.indexOf('tank_4'),
        tank_5: headerArray.indexOf('tank_5'),
    };
    filearray.forEach((oneline) => {
        //console.log("Oneline", oneline);
        const onelineArray = oneline.split(',');
        let preppArray = [];
        const dataDate = new Date(onelineArray[headerIndices.dt_tracker]);
        const sourceStart = new Date(thisSource.startTime);
        const sourceEnd = new Date(thisSource.endTime);
        //console.log("DFata dates", dataDate, sourceStart, sourceEnd);
        if (dataDate.getTime() >= sourceStart.getTime() && dataDate.getTime() <= sourceEnd.getTime()) {
            //console.log("Matching data found");
            preppArray.push(onelineArray[headerIndices.dt_tracker]);
            preppArray.push(onelineArray[headerIndices.lat]);
            preppArray.push(onelineArray[headerIndices.lng]);
            preppArray.push(onelineArray[headerIndices.speed]);
            preppArray.push(onelineArray[headerIndices.angle]);
            preppArray.push(onelineArray[headerIndices.tank_1]);
            preppArray.push(onelineArray[headerIndices.tank_2]);
            preppArray.push(onelineArray[headerIndices.tank_3]);
            preppArray.push(onelineArray[headerIndices.tank_4]);
            preppArray.push(onelineArray[headerIndices.tank_5]);
            preppArray.push(onelineArray[headerIndices.offset]);
            filebody.push(
                preppArray
            );
            //console.log("One record", preppArray);
        }
    });
    //console.log("Retunrning filebody", filebody.length);
    return filebody;
}
/*
function rdsDataBuilder(rdsArray) {
    let rdsBody = [];
    return rdsBody;
}
*/
/*
function driveSum(data, stops, drives) {
    let totalPointDrive = 0;
    let refinedDrives = [];
    drives.forEach((oneDrive, didx) => {
        let driveData = [];
        for (k = 1; k < data.length - 1; k++) {
            if (k >= oneDrive.startIndex && k <= oneDrive.endIndex) {
                driveData.push(data[k]);
            }
        }
        const drivedist = distCalc(driveData);
        totalPointDrive += parseFloat(drivedist.point);
        refinedDrives.push({ ...oneDrive, driveDistance: drivedist.point });
    })
    return { route: data, stops, drives: refinedDrives, totalDistance: totalPointDrive };
}
*/

/*
function stopSum(data, stops, drives, driveDistance) {
    let totalStopMov = 0;
    let refinedStops = [];
    stops.forEach(oneStop => {
        let stopData = [];
        for (k = 1; k < data.length - 1; k++) {
            if (k >= oneStop.startIndex && k <= oneStop.endIndex) {
                stopData.push(data[k]);
            }
        }
        const stopdist = distCalc(stopData);
        totalStopMov += parseFloat(stopdist.point);
        refinedStops.push({ ...oneStop, stopMovement: stopdist.point });
    })
    const totalDistance = driveDistance + totalStopMov;
    const finalData = {
        route: data,
        stops: refinedStops,
        drives,
        totalDistance: driveDistance,
        grossDistance: totalDistance,
        totalDriveDistance: driveDistance,
        totalStopMovement: totalStopMov
    };
    console.log("FInal Data", finalData);
    return finalData;
}
*/