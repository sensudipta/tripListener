const { tripLogger, processLogger } = require('../common/helpers/logger');
const { whatsApp, redisClient } = require('../common/liveDB');
const { tripDateView } = require('../common/helpers/dateFormatter');
const { SESClient } = require("@aws-sdk/client-ses");
const nodemailer = require('nodemailer');
const { tripStatusMail } = require('../common/mailTemplate');

const mandatoryPayloadKeys = [
    'truckregistrationnumber', 'routename', 'tripstage', 'activestatus',
    'eventtype', 'eventtext', 'eventtime', 'lat', 'lng'
];

const ADMIN_NUMBERS = ['9004040603', '9867151227'];
const ADMIN_EMAILS = ['sudipta@roadmatics.com', 'tandrima.mukherjee@roadmatics.com'];

/**
 * Send alerts for trip events
 * @param {Object} trip - Trip object
 * @param {Object} event - Event object
 * @param {string} category - Notification category ('tripStage', 'activeStatus', 'ruleViolation', 'finalReport')
 * @returns {boolean} - Success status
 */
async function processAlerts(trip, event, category = 'activeStatus') {
    try {

        if (!trip) {
            processLogger(`#FN:Alerts: Failed Processing alerts for invalid trip`);
            return false;
        }
        // Validate required event properties
        if (!event || !event.eventType || !event.eventText || !event.eventTime) {
            tripLogger(trip, '#FN:Alerts: Missing required event properties');
            return false;
        }

        // Validate category
        const validCategories = ['tripStage', 'activeStatus', 'ruleViolation', 'finalReport'];
        if (!validCategories.includes(category)) {
            tripLogger(trip, `#FN:Alerts: Invalid category: ${category}, defaulting to 'activeStatus'`);
            category = 'activeStatus';
        }

        // Create alert payload
        const alertPayload = createAlertPayload(trip, event);

        // Validate mandatory fields
        const missingKeys = mandatoryPayloadKeys.filter(key => alertPayload[key] === 'NA');
        if (missingKeys.length > 0) {
            tripLogger(trip, `#FN:Alerts: Missing mandatory keys: ${missingKeys.join(', ')}`);
            return false;
        }

        // Send alerts based on notification preferences
        const { notifications } = trip;
        let success = false;

        // Process WhatsApp and Telegram notifications separately
        if (notifications?.telegram?.length > 0) {
            const telegramNumbers = [...new Set([
                ...ADMIN_NUMBERS,
                ...notifications.telegram.map(item => item.number)
            ])];

            // Send Telegram messages
            const telegramMessage = formTelegramMessage(alertPayload);
            const telegramSuccess = await sendTelegramMessage([...telegramNumbers], telegramMessage, trip);

            if (telegramSuccess) {
                // Add Telegram notifications to sentNotifications array
                if (!trip.sentNotifications) {
                    trip.sentNotifications = [];
                }

                // Add a notification record for each Telegram recipient
                telegramNumbers.forEach(number => {
                    const notification = {
                        type: 'push', // Using 'push' type for Telegram
                        category: category,
                        recipient: {
                            number: number,
                            name: findRecipientName(notifications.telegram, number) || 'Admin'
                        },
                        message: `Telegram: ${event.eventText}`,
                        sentTime: new Date()
                    };

                    trip.sentNotifications.push(notification);
                });

                tripLogger(trip, `#FN:Alerts: Added ${telegramNumbers.length} Telegram notifications to sentNotifications array`);
                success = true;
            }
        }

        // Process WhatsApp notifications separately
        if (notifications?.whatsApp?.length > 0) {
            const whatsAppNumbers = [...new Set([
                ...ADMIN_NUMBERS,
                ...notifications.whatsApp.map(item => item.number)
            ])];

            // Send WhatsApp messages
            const whatsAppSuccess = await sendWhatsAppAlert(alertPayload, whatsAppNumbers, trip);

            if (whatsAppSuccess) {
                // Add WhatsApp notifications to sentNotifications array
                if (!trip.sentNotifications) {
                    trip.sentNotifications = [];
                }

                // Add a notification record for each recipient
                whatsAppNumbers.forEach(number => {
                    const notification = {
                        type: 'whatsApp',
                        category: category,
                        recipient: {
                            number: number,
                            name: findRecipientName(notifications.whatsApp, number) || 'Admin'
                        },
                        message: event.eventText,
                        sentTime: new Date()
                    };

                    trip.sentNotifications.push(notification);
                });

                tripLogger(trip, `#FN:Alerts: Added ${whatsAppNumbers.length} WhatsApp notifications to sentNotifications array`);
                success = true;
            }
        }

        // Process Email notifications
        if (notifications?.email?.length > 0) {
            const emailAddresses = [...new Set([
                ...ADMIN_EMAILS,
                ...notifications.email.map(item => item.email)
            ])];
            const emailSuccess = await sendEmailAlert(alertPayload, emailAddresses, trip);

            if (emailSuccess) {
                // Add Email notifications to sentNotifications array
                if (!trip.sentNotifications) {
                    trip.sentNotifications = [];
                }

                // Add a notification record for each recipient
                emailAddresses.forEach(email => {
                    const notification = {
                        type: 'email',
                        category: category,
                        recipient: {
                            number: email, // Using number field for email address
                            name: findRecipientNameByEmail(notifications.email, email) || 'Admin'
                        },
                        message: event.eventText,
                        sentTime: new Date()
                    };

                    trip.sentNotifications.push(notification);
                });

                tripLogger(trip, `#FN:Alerts: Added ${emailAddresses.length} Email notifications to sentNotifications array`);
                success = true;
            }
        }

        // Process Push notifications
        if (notifications?.push?.length > 0) {
            const pushTokens = [...new Set([
                // Add admin push tokens if needed
                ...notifications.push.map(item => item.token)
            ])];

            // Send Push notifications
            const pushSuccess = await sendPushNotification(alertPayload, pushTokens, trip);

            if (pushSuccess) {
                // Add Push notifications to sentNotifications array
                if (!trip.sentNotifications) {
                    trip.sentNotifications = [];
                }

                // Add a notification record for each recipient
                pushTokens.forEach(token => {
                    const notification = {
                        type: 'push',
                        category: category,
                        recipient: {
                            number: token, // Using number field for token
                            name: findRecipientNameByToken(notifications.push, token) || 'User'
                        },
                        message: event.eventText,
                        sentTime: new Date()
                    };

                    trip.sentNotifications.push(notification);
                });

                tripLogger(trip, `#FN:Alerts: Added ${pushTokens.length} Push notifications to sentNotifications array`);
                success = true;
            }
        }

        return success;

    } catch (err) {
        console.error('Error in processAlerts:', err);
        if (trip) {
            tripLogger(trip, `#FN:Alerts: Failed to send alerts: ${err}`);
        } else {
            processLogger(`#FN:Alerts: Failed to send alerts: ${err}`);
        }
        return false;
    }
}

function createAlertPayload(trip, event) {
    const { eventType, eventText, eventTime } = event;
    const {
        truckRegistrationNumber, tripStage, activeStatus,
        actualStartTime, distanceCovered, distanceRemaining,
        estimatedTimeOfArrival, customer, goodsName,
        driverName, driverPhoneNumber, route
    } = trip;

    const { routeName = null } = route || {};
    const truckPoint = trip?.tripPath?.[trip?.pathPoints?.toIndex];
    const { lat, lng } = truckPoint || {};

    return {
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
        lng: lng ?? 'NA'
    };
}

function formTelegramMessage(payload) {
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
        let success = false;
        const originalNumbers = [...numbers]; // Make a copy for logging

        while (numbers.length > 0) {
            let phone = numbers.pop();
            const telegramid = await redisClient.get(`phone_telegramid:${phone}`);
            if (telegramid) {
                const str = JSON.stringify({ chatId: telegramid, msg: message });
                await redisClient.publish('telegram_fuel', str);
                tripLogger(trip, `#FN:Alerts: Telegram message sent to ${phone}`);
                success = true;
            } else {
                tripLogger(trip, `#FN:Alerts: Telegram chatid not available ${phone}`);
            }
        }

        if (success) {
            tripLogger(trip, `#FN:Alerts: Telegram message sent to at least one recipient`);
        } else {
            tripLogger(trip, `#FN:Alerts: No Telegram messages sent - no valid recipients`);
        }

        return success;
    } catch (error) {
        console.error(`#FN:Alerts: Error sending message ${error}`);
        tripLogger(trip, `#FN:Alerts: Error sending message ${JSON.stringify(error)}`);
        return false;
    }
}

async function sendWhatsAppAlert(alertPayload, whatsAppNumbers, trip) {
    const whatsAppPayload = Object.entries(alertPayload)
        .map(([name, value]) => ({ name, value }));

    const formattedNumbers = whatsAppNumbers
        .map(number => `91${number.replace(/ /g, "")}`)
        .filter((value, index, self) => self.indexOf(value) === index);

    tripLogger(trip, `#FN:Alerts: WhatsApp Numbers: ${formattedNumbers.join(', ')}`);

    const reqBody = {
        template_name: "trip_update_v1",
        broadcast_name: "trip_update_alert",
        receivers: formattedNumbers.map(number => ({
            whatsappNumber: number,
            customParams: whatsAppPayload
        }))
    };

    try {
        const response = await fetch('https://live-mt-server.wati.io/101048/api/v1/sendTemplateMessages', {
            method: 'POST',
            headers: {
                Authorization: whatsApp.authToken,
                "Content-Type": "text/json"
            },
            body: JSON.stringify(reqBody)
        });

        const json = await response.json();
        if (json.result) {
            tripLogger(trip, `#FN:Alerts: WhatsApp Send Success ${formattedNumbers.join(', ')}`);
        } else {
            tripLogger(trip, '#FN:Alerts: WhatsApp Send Failure');
            console.log(`#FN:Alerts: WhatsApp Send Failure ${JSON.stringify(json)}`);
            if (json.errors?.error) {
                console.log(`#FN:Alerts: WhatsApp Error Message: ${json.errors.error}`);
                if (json.errors.invalidWhatsappNumbers?.length > 0) {
                    json.errors.invalidWhatsappNumbers.forEach(e => {
                        console.log(`#FN:Alerts: WhatsApp Invalid Number: ${e}`);
                    });
                }
                if (json.errors.invalidCustomParameters?.length > 0) {
                    json.errors.invalidCustomParameters.forEach(e => {
                        console.log(`#FN:Alerts: WhatsApp Invalid Custom Parameter: ${e}`);
                        let str = '';
                        whatsAppPayload.forEach(a => str += `${a.name}: ${a.value} || `);
                        console.log(`#FN:Alerts: ReqParams: ${str}`);
                    });
                }
            }
        }
        return true;
    } catch (err) {
        console.error("WhatsApp API error:", err);
        tripLogger(trip, `#FN:Alerts: WhatsApp API error ${trip.truckRegistrationNumber}`);
        return false;
    }
}

async function sendEmailAlert(alertPayload, emails, trip) {
    try {
        if (emails?.length > 0) {
            const mailOptions = {
                from: '"Roadmatics Support" services@roadmatics.com',
                subject: `Trip update: ${alertPayload.truckregistrationnumber} - ${alertPayload.eventtype}`,
                text: tripStatusMail(alertPayload),
                to: emails.join(','),
            };

            const transporter = nodemailer.createTransport({
                SES: { ses: SESClient, aws: { SESClient } }
            });

            await new Promise((resolve, reject) => {
                transporter.sendMail(mailOptions, function (err, info) {
                    if (err) {
                        console.log(err);
                        tripLogger(trip, '#FN:Alerts: Email send failed');
                        reject(err);
                    } else {
                        console.log('Email sent successfully');
                        tripLogger(trip, `#FN:Alerts: Email sent successfully ${emails.join(',')}`);
                        resolve(info);
                    }
                });
            });
        }
        return true;
    } catch (error) {
        console.error('Error in sendEmailAlert:', error);
        return false;
    }
}

/**
 * Find recipient name by phone number
 * @param {Array} recipients - Array of recipients
 * @param {string} number - Phone number to find
 * @returns {string|null} - Recipient name or null if not found
 */
function findRecipientName(recipients, number) {
    const recipient = recipients.find(r => r.number === number);
    return recipient ? recipient.name : null;
}

/**
 * Find recipient name by email
 * @param {Array} recipients - Array of recipients
 * @param {string} email - Email to find
 * @returns {string|null} - Recipient name or null if not found
 */
function findRecipientNameByEmail(recipients, email) {
    const recipient = recipients.find(r => r.email === email);
    return recipient ? recipient.name : null;
}

/**
 * Send push notifications
 * @param {Object} alertPayload - Alert payload
 * @param {Array} tokens - Array of device tokens
 * @param {Object} trip - Trip object
 * @returns {Promise<boolean>} - Success status
 */
async function sendPushNotification(alertPayload, tokens, trip) {
    try {
        // TODO: Implement push notification logic
        // This would typically involve calling a service like Firebase Cloud Messaging (FCM)
        // or another push notification service

        tripLogger(trip, `#FN:Alerts: Push notification not implemented yet`);
        return false; // Return false until implemented
    } catch (error) {
        console.error("Push notification error:", error);
        tripLogger(trip, `#FN:Alerts: Push notification error: ${error.message}`);
        return false;
    }
}

/**
 * Find recipient name by token
 * @param {Array} recipients - Array of recipients
 * @param {string} token - Push token to find
 * @returns {string|null} - Recipient name or null if not found
 */
function findRecipientNameByToken(recipients, token) {
    const recipient = recipients.find(r => r.token === token);
    return recipient ? recipient.name : null;
}

module.exports = processAlerts;