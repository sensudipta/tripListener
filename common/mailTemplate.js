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

module.exports = {
    reportMail: reportMail
};