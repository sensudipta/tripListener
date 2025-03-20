const moment = require('moment');
const axios = require('axios');
const { tripLogger } = require('./logger');

async function getFuel({ timeFrom, timeTo, imei, user_id }) {
    const reqBody = { timeFrom, timeTo, imei, user_id };
    try {
        const levelResp = await axios.post('http://172.31.18.33:11001/fuelLevels', reqBody);
        const distanceResp = await axios.post('http://172.31.18.33:11001/accurateKm', reqBody);
        const distance = distanceResp.data.dist;
        const levels = levelResp.data.data;
        // Get events using spec API (removed crawl option as it's not needed)
        const specResp = await axios.post('http://172.31.18.33:11002/crawlFuel', reqBody);
        const events = specResp.data.data;
        return processConsumptionData(levels, events, distance);
    } catch (error) {
        console.error('Error in getFuel:', error);
        tripLogger(trip, '#FN:getFuel: Error in getFuel:', error);
        throw error;
    }
}

function processConsumptionData(levels, events, distance) {
    const tank = 'tank_1';
    let tanklist = { ...levels };
    if (!tanklist[tank]) {
        return null;
    }

    // Process events
    events.forEach(event => {
        if (moment(event.eventTime).isBetween(moment(levels[tank].startTime), moment(levels[tank].endTime))) {
            const eventType = event.fuel_event_type;
            if (eventType === 'filling' || eventType === 'theft') {
                tanklist[tank][eventType === 'filling' ? 'fills' : 'theft'] += parseFloat(event.fuel_event_volume);
            }
        }
    });

    const consumption = parseFloat(tanklist[tank].startLevel) - parseFloat(tanklist[tank].endLevel) +
        tanklist[tank].fills - tanklist[tank].theft;

    // Create fuelEvents array
    const fuelEvents = events
        .filter(event => moment(event.eventTime).isBetween(moment(levels[tank].startTime), moment(levels[tank].endTime)))
        .map(event => ({
            eventTime: event.eventTime,
            type: event.fuel_event_type,
            volume: parseFloat(event.fuel_event_volume)
        }))
        .sort((a, b) => moment(a.eventTime).valueOf() - moment(b.eventTime).valueOf());

    return {
        distance: parseFloat(distance).toFixed(2),
        consumption: consumption > 0 ? parseFloat(consumption).toFixed(3) : "NA",
        mileage: consumption > 0 ? distance ? (distance / consumption).toFixed(1) : "NA" : "NA",
        startVol: levels[tank].startLevel,
        endVol: levels[tank].endLevel,
        fuelEvents,

    };
}

module.exports = getFuel;