const { tripLogger } = require('./logger');
const { whatsApp } = require('../liveDB');

async function sendAlerts({ trip, event }) {
    try {
        const { eventType, eventText, eventTime } = event;
        const {
            truckRegistrationNumber, tripStage, activeStatus,
            actualStartTime,
            distanceCovered, distanceRemaining, estimatedTimeOfArrival,
            customer, goodsName, driverName, driverPhoneNumber,
            route, notifications
        } = trip;
        const { routeName = null } = route || {};

        const alertpayload = {
            truckregistrationnumber: truckRegistrationNumber ?? 'Unknown',
            eventtype: eventType ?? 'Unknown',
            eventtext: eventText ?? 'Unknown',
            eventtime: eventTime ?? 'Unknown',
            drivername: driverName ?? 'Unknown',
            drivernumber: driverPhoneNumber ?? 'Unknown',
            routename: routeName ?? 'Unknown',
            tripstage: tripStage ?? 'Unknown',
            activestatus: activeStatus ?? 'Unknown',
            actualstarttime: actualStartTime ?? 'Unknown',
            distancecovered: distanceCovered ?? 'Unknown',
            distanceremaining: distanceRemaining ?? 'Unknown',
            estimatedtimeofarrival: estimatedTimeOfArrival ?? 'Unknown',
            customer: customer ?? 'Unknown',
            goodsname: goodsName ?? 'Unknown',
        };

        let whatsAppNumbers = [];
        if (notifications?.whatsApp?.length > 0) {
            notifications.whatsApp.forEach(item => {
                whatsAppNumbers.push(item.number);
            });
        }
        if (whatsAppNumbers.length > 0) {
            sendWhatsAppAlert(alertpayload, whatsAppNumbers);
        }

    } catch (err) {
        console.error('Error in sendAlerts:', err);
        tripLogger(trip, `#FN:sendAlerts: Failed to send alerts: ${err}`);
        return false;
    }
}




async function sendWhatsAppAlert(alertpayload, whatsAppNumbers) {
    let whatsAppPayload = [];
    Object.keys(alertpayload).forEach(key => {
        whatsAppPayload.push({ name: `${key}`, value: alertpayload[key] });
    });
    whatsAppNumbers = ['9004040603', '9867151227', ...whatsAppNumbers];
    whatsAppNumbers.forEach((number, index) => {
        whatsAppNumbers[index] = `91${number}`;
    });
    console.log(whatsAppNumbers);

    let reqBody = {
        "template_name": "trip_update",
        "broadcast_name": "trip_update_alert",
        receivers: whatsAppNumbers.map(number => {
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
                console.log("Whatsapp Send Success");
            } else {
                console.log("whatsapp Send Faliure");
            }
            json.result ? console.log("Whatsapp Send Success") : console.log("whatsapp Send Faliure");
            if (json.errors.error) {
                console.log("Whatsapp Error Message:", json.errors.error);
                if (json.errors.invalidWhatsappNumbers && json.errors.invalidWhatsappNumbers.length > 0) {
                    json.errors.invalidWhatsappNumbers.forEach(e => {
                        console.log("Whatsapp Invalid Number", e);
                    })
                }
                if (json.errors.invalidCustomParameters && json.errors.invalidCustomParameters.length > 0) {
                    json.errors.invalidCustomParameters.forEach(e => {
                        console.log("Whatsapp Invalid Custom Parameter", e);
                        let str = '';
                        whatsAppReqParams.forEach(a => str += `${a.name}: ${a.value} || `);
                        console.log("ReqParams", str);
                    })
                }
            }
        })
        .catch(err => {
            console.error("Whatsapp API error:", err)

        });


}


const testEvent = {
    eventType: " Trip Status ",
    eventText: "Reached Start Location",
    eventTime: new Date().toLocaleString()
};

const testTrip = {
    truckRegistrationNumber: "MH02AB1234",
    tripStage: "IN_PROGRESS",
    activeStatus: "ACTIVE",
    actualStartTime: new Date().toLocaleString(),
    distanceCovered: "150",
    distanceRemaining: "350",
    estimatedTimeOfArrival: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString(), // 24 hours from now
    customer: "ABC Logistics",
    goodsName: "Electronics",
    driverName: "John Doe",
    driverPhoneNumber: "9876543210",
    route: {
        routeName: "Mumbai to Delhi"
    },
    notifications: {
        whatsApp: [
            { number: "9867151227" },
            { number: "9987166800" }
        ]
    }
};

sendAlerts({ trip: testTrip, event: testEvent });