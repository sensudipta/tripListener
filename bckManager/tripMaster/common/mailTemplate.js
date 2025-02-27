const moment = require('moment');

const reportMail = (item) => {
    return `

Dated: ${moment().format('Do MMM YYYY')}

Subject: ${item.reportSummary.reportName} report for ${item.reportSummary.assetName}

Dear Ma'am/ Sir,

    Please find your data report attached with this email.

    Report Type - ${item.reportSummary.reportName}
    Vehicle - ${item.reportSummary.assetName}
    Period Start - ${moment(item.reportSummary.reqBody.timeFrom).format('Do MMM YYYY h:mm A')}
    Period End - ${moment(item.reportSummary.reqBody.timeTo).format('Do MMM YYYY h:mm A')}
    
    This is an auto generated email delivered directly from Roadmatics iLogistek 3.0 system. 

    DO NOT REPLY TO THIS EMAIL. ROADMATICS DOES NOT PROCESS REPLIES TO REPORT EMAILS.
    CONTACT THE VEHICLE OWNER DIRECTLY.
    
Sincere Regards,

Customer Support Desk
Roadmatics Technologies Private Limited
info@roadmatics.com
`
};


const tripStatusMail = (payload) => {
    return `
Dated: ${moment().format('Do MMM YYYY')}

Subject: Trip update: ${payload.truckRegistrationNumber} - ${payload.eventType}

Dear Ma'am/ Sir,

    Please find your trip update attached with this email.

    Truck Registration Number - ${payload.truckRegistrationNumber}
    Event - ${payload.eventText}
    Time - ${payload.eventTime}

    Driver Name - ${payload.driverName}
    Driver Phone Number - ${payload.driverPhoneNumber}
    Route Name - ${payload.routeName}

    Trip Stage - ${payload.tripStage}
    Active Status - ${payload.activeStatus}
    Actual Start Time - ${payload.actualStartTime}
    
    Distance Covered - ${payload.distanceCovered}
    Distance Remaining - ${payload.distanceRemaining}
    Estimated Time of Arrival - ${payload.estimatedTimeOfArrival}
    
    Customer - ${payload.customer}
    Goods Name - ${payload.goodsName}

    This is an auto generated email delivered directly from Roadmatics iLogistek 3.0 system.

    DO NOT REPLY TO THIS EMAIL. ROADMATICS DOES NOT PROCESS REPLIES TO AUTOMATED EMAILS.
    CONTACT THE VEHICLE OWNER DIRECTLY.

Sincere Regards,

Customer Support Desk
Roadmatics Technologies Private Limited
info@roadmatics.com

    `
};


module.exports = {
    reportMail: reportMail,
    tripStatusMail: tripStatusMail
};