const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { logDate, monthlyLogFileDate, consoleDate } = require('./dateFormatter');

function tripLogger(trip, message) {
    try {
        // First, log to console for debugging
        console.log(`TRIP LOG [${trip?.tripId || 'unknown'}]: ${message}`);

        // Check if trip object is valid
        if (!trip || !trip.tripId) {
            console.error('Invalid trip object passed to tripLogger');
            return false;
        }

        const { truckRegistrationNumber, tripId } = trip;

        // Create logs directory if it doesn't exist
        const logsDir = path.join(__dirname, '../../', 'logs', 'tripLogs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const filename = `${tripId}.log`;
        const logFilePath = path.join(logsDir, filename);

        let msgstr = '';
        if (typeof message === 'string') {
            msgstr = message;
        } else if (message instanceof Error) {
            msgstr = `${message.message} - ${message.stack}`;
        } else if (typeof message === 'object') {
            try {
                msgstr = JSON.stringify(message);
            } catch (e) {
                let objStr = '';
                Object.entries(message).forEach(([key, value], index) => {
                    if (Array.isArray(value)) {
                        objStr += `${key} - ${value.join('|')}`;
                    } else {
                        objStr += `${key} - ${value}`;
                    }
                    if (index < Object.entries(message).length - 1) {
                        objStr += ', ';
                    }
                });
                msgstr = objStr;
            }
        } else {
            msgstr = String(message);
        }

        const logMessage = `${logDate(moment(trip?.tripPath?.[trip?.tripPath?.length - 1]?.dt_tracker || moment()))}, ${msgstr}\n`;
        fs.appendFileSync(logFilePath, logMessage);

        return true;
    } catch (error) {
        console.error('Error in tripLogger:', error);
        return false;
    }
}

function processLogger(message) {
    try {
        const date = monthlyLogFileDate(moment());
        const filename = `processLog_${date}.csv`;
        const logFilePath = path.join(__dirname, '../../', 'logs', 'processLogs', filename);
        const logMessage = `${logDate(moment())}, #,${message}\n`;
        console.log(consoleDate(moment()), "#ProcessLogger: ", message);
        fs.appendFileSync(logFilePath, logMessage);
        return true;
    } catch (error) {
        console.error('Error in processLogger:', error);
        return false;
    }
}


module.exports = {
    tripLogger,
    processLogger
};