const { tripLogger } = require('./logger');
const { whatsApp, redisClient } = require('../common/liveDB');
const { tripDateView } = require('./dateFormatter');
const { SESClient } = require("@aws-sdk/client-ses");
const nodemailer = require('nodemailer');
const { tripStatusMail } = require('../common/mailTemplate');

const mandatoryPayloadKeys = [
    'truckregistrationnumber', 'routename', 'tripstage', 'activestatus',
    'eventtype', 'eventtext', 'eventtime', 'lat', 'lng'
];


async function sendAlerts(trip, event) {
    try {
        const { eventType, eventText, eventTime } = event;
        const {
            truckRegistrationNumber, tripStage, activeStatus,
            actualStartTime, truckPoint,
            distanceCovered, distanceRemaining, estimatedTimeOfArrival,
            customer, goodsName, driverName, driverPhoneNumber,
            route, notifications
        } = trip;
        const { routeName = null } = route || {};
        const { lat, lng } = truckPoint || {};
        const alertpayload = {
            truckregistrationnumber: truckRegistrationNumber ?? 'NA',
            eventtype: eventType ?? 'NA',
            eventtext: eventText ?? 'NA',
            eventtime: eventTime ? tripDateView(eventTime) : 'NA',
            drivername: driverName ?? 'NA',
            drivernumber: driverPhoneNumber ?? 'NA',
            routename: routeName ?? 'NA',
            tripstage: tripStage ?? 'NA',
            activestatus: activeStatus ?? 'NA',
            actualstarttime: actualStartTime ? tripDateView(actualStartTime) : 'NA',
            distancecovered: distanceCovered ?? 'NA',
            distanceremaining: distanceRemaining ?? 'NA',
            estimatedtimeofarrival: estimatedTimeOfArrival ?? 'NA',
            customer: customer ?? 'NA',
            goodsname: goodsName ?? 'NA',
            lat: lat ?? 'NA',
            lng: lng ?? 'NA',
        };
        const telegramMessage = formTelegramMessage(alertpayload);
        let missingKeys = [];
        Object.keys(mandatoryPayloadKeys).forEach(key => {
            if (alertpayload[key] === 'NA') {
                missingKeys.push(key);
            }
        });
        if (missingKeys.length > 0) {
            tripLogger(trip, `#FN:sendAlerts: WHATSAPP failed. Missing mandatory keys: ${missingKeys}`);
            return false;
        } else {
            let whatsAppNumbers = [];
            if (notifications?.whatsApp?.length > 0) {
                notifications.whatsApp.forEach(item => {
                    whatsAppNumbers.push(item.number);
                });
            }
            if (whatsAppNumbers.length > 0) {
                sendTelegramMessage(['9004040603', ...whatsAppNumbers], telegramMessage, trip);
                return sendWhatsAppAlert(alertpayload, whatsAppNumbers, trip);
            }

            let emailAddresses = [];
            if (notifications?.email?.length > 0) {
                notifications.email.forEach(item => {
                    emailAddresses.push(item.email);
                });
            }
            if (emailAddresses.length > 0) {
                return sendEmailAlert(alertpayload, emailAddresses, trip);
            }
        }
        return false;

    } catch (err) {
        console.error('Error in sendAlerts:', err);
        tripLogger(trip, `#FN:sendAlerts: Failed to send alerts: ${err}`);
        process.exit(0);
    }
}

module.exports = sendAlerts;


async function sendWhatsAppAlert(alertpayload, whatsAppNumbers, trip) {
    let whatsAppPayload = [];
    Object.keys(alertpayload).forEach(key => {
        whatsAppPayload.push({ name: `${key}`, value: alertpayload[key] });
    });
    whatsAppNumbers = ['9004040603', '9867151227', ...whatsAppNumbers];
    whatsAppNumbers = [...new Set(whatsAppNumbers)]; // Remove duplicates
    whatsAppNumbers.forEach((number, index) => {
        whatsAppNumbers[index] = `91${number}`;
    });
    tripLogger(trip, `#FN:sendAlerts: Whatsapp Numbers: ${whatsAppNumbers.join(', ')}`);

    let reqBody = {
        "template_name": "trip_update_v1",
        "broadcast_name": "trip_update_alert",
        //todo - remove this in production
        receivers: whatsAppNumbers.map(number => {
            //receivers: ournumbers.map(number => {
            return {
                "whatsappNumber": number.replace(/ /g, ""),
                "customParams": whatsAppPayload
            };
        }),
    };

    const headers = { Authorization: whatsApp.authToken, "Content-Type": "text/json", };
    const url = 'https://live-server-101048.wati.io/api/v1/sendTemplateMessages';
    const options = {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(reqBody)
    };

    fetch(url, options)
        .then(res => res.json())
        .then(json => {
            if (json.result) {
                tripLogger(trip, `#FN:sendAlerts: Whatsapp Send Success ${whatsAppNumbers.join(', ')}`);
            } else {
                tripLogger(trip, `#FN:sendAlerts: Whatsapp Send Faliure`);
                console.log(`#FN:sendAlerts: Whatsapp Send Faliure ${JSON.stringify(json)}`);
            }
            if (json.errors.error) {
                console.log(`#FN:sendAlerts: Whatsapp Error Message: ${json.errors.error}`);
                if (json.errors.invalidWhatsappNumbers && json.errors.invalidWhatsappNumbers.length > 0) {
                    json.errors.invalidWhatsappNumbers.forEach(e => {
                        console.log(`#FN:sendAlerts: Whatsapp Invalid Number: ${e}`);
                    })
                }
                if (json.errors.invalidCustomParameters && json.errors.invalidCustomParameters.length > 0) {
                    json.errors.invalidCustomParameters.forEach(e => {
                        console.log(`#FN:sendAlerts: Whatsapp Invalid Custom Parameter: ${e}`);
                        let str = '';
                        whatsAppPayload.forEach(a => str += `${a.name}: ${a.value} || `);
                        console.log(`#FN:sendAlerts: ReqParams: ${str}`);
                    })
                }
            }
            return true;
        })
        .catch(err => {
            console.error("Whatsapp API error:", err);
            tripLogger(trip, `#FN:sendAlerts: Whatsapp API error ${trip.truckRegistrationNumber}`);
            return false;
        });


}


function sendEmailAlert(payload, emails, trip) {
    try {
        if (emails && emails.length > 0) {
            emails.push('sudipta@roadmatics.com');
            emails.push('tandrima.mukherjee@roadmatics.com');
            const emails = `${emails.join()}`;
            const mailOptions = {
                from: '"Roadmatics Support" services@roadmatics.com',
                subject: `Trip update: ${payload.truckRegistrationNumber} - ${payload.eventType}`,
                text: tripStatusMail(payload),
                to: emails,
            };
            const transporter = nodemailer.createTransport({
                SES: { ses: SESClient, aws: { SESClient } }
            });
            transporter.sendMail(mailOptions, function (err, info) {
                if (err) {
                    console.log(err);
                    tripLogger(trip, `#FN:sendAlerts: Email send failed`);
                } else {
                    console.log('Email sent successfully');
                    tripLogger(trip, `#FN:sendAlerts: Email sent successfully ${emails}`);
                }
            });
        }
        return true;
    } catch (error) {
        console.error('Error in sendEmailAlert:', error);
        return false;
    }

}

function formTelegramMessage(payload) {
    //console.log("Forming telegram message for:", payload.truckregistrationnumber);
    //console.log("Payload:", payload);
    const telegramMessage =
        `
🚚 *${payload.truckregistrationnumber}*

🔷 _${payload.eventtype}_
🔶 *${payload.eventtext}*
🕐 _${payload.eventtime}_

🕵🏻 *Driver:* ${payload.drivername}  
☎️ *Phone:* ${payload.drivernumber}
🌎 *Route* ${payload.routename} ${payload.routeLength ? `♾️ ${payload.routeLength} Km` : ''}

_*Trip Progress*_

❇️ *Current State:* ${payload.tripstage}
💹 *Latest Activity:* ${payload.activestatus}

✒️ *Trip Start:* ${payload.actualstarttime}
✒️ *Covered :* ${payload.distancecovered.toFixed(0)} Km
✒️ *Remaining :* ${payload.distanceremaining.toFixed(0)} Km
${payload.estimatedtimeofarrival && payload.estimatedtimeofarrival !== 'NA' ? `✒️ *ETA:* ${tripDateView(payload.estimatedtimeofarrival)}` : ''}

💰 *Shipper:* ${payload.customer}
🛢 *Goods:* ${payload.goodsname}

`;
    return telegramMessage;
}

async function sendTelegramMessage(numbers, message, trip) {
    try {
        if (numbers.length > 0) {
            let phone = numbers.pop();
            const telegramid = await redisClient.get(`phone_telegramid:${phone}`);
            if (telegramid) {
                const str = JSON.stringify({ chatId: telegramid, msg: message })
                await redisClient.publish('telegram_fuel', str);
                tripLogger(trip, `#FN:sendAlerts: Telegram message sent to ${phone}`);
                await sendTelegramMessage(numbers, message, trip);
            } else {
                tripLogger(trip, `#FN:sendAlerts: Telegram chatid not available ${phone}`);
                await sendTelegramMessage(numbers, message, trip);
            }
        } else {
            tripLogger(trip, `#FN:sendAlerts: Telegram message sent to all numbers`);
        }
    } catch (error) {
        console.error(`#FN:sendAlerts: Error sending message ${error}`);
        tripLogger(trip, `#FN:sendAlerts: Error sending message ${JSON.stringify(error)}`);
    }
}