const moment = require('moment');

function formatToIST(datetime) {
    return moment(datetime)
        .utcOffset('+05:30')
        .format('DDMMM HH:mm');
}

function shortDate(datetime) {
    return moment(datetime)
        .utcOffset('+05:30')
        .format('D-M h:mm A');
}

function consoleDate(datetime) {
    return moment(datetime)
        .utcOffset('+05:30')
        .format('>>D/M h:mm A');
}

function logDate(datetime) {
    return moment(datetime)
        .utcOffset('+05:30')
        .format('YYYY-MM-DD HH:mm:ss');
}

function monthlyLogFileDate(datetime) {
    return moment(datetime)
        .utcOffset('+05:30')
        .format('MM-YYYY');
}

function tripDateView(datetime) {
    return moment(datetime)
        .utcOffset('+05:30')
        .format('hh:mm A, DMMM YYYY');
}


module.exports = {
    formatToIST,
    shortDate,
    logDate,
    consoleDate,
    monthlyLogFileDate,
    tripDateView
};