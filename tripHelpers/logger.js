const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { logDate, monthlyLogFileDate, consoleDate } = require('./dateFormatter');

function tripLogger(trip, message) {
    try {
        const { truckRegistrationNumber, tripId } = trip;
        const filename = `${tripId}.log`;
        const logFilePath = path.join(__dirname, '..', 'logs', 'tripLogs', filename);

        if (typeof message === 'string') {
            msgstr = message;
        } else {
            let msgstr = '';
            Object.entries(message).forEach(([key, value], index) => {
                if (Array.isArray(value)) {
                    msgstr += `${key} - ${value.join('|')}`;
                } else {
                    msgstr += `${key} - ${value}`;
                }
                if (index < Object.entries(message).length - 1) {
                    msgstr += ', ';
                }
            });
        }

        const logMessage = `${logDate(moment())}, ${msgstr}\n`;
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
        const logFilePath = path.join(__dirname, '..', 'logs', 'processLogs', filename);
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