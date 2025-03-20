const { redisClient } = require('../liveDB');
const moment = require('moment');
const { tripDateView } = require('./dateFormatter');
async function sendTelegramAlert(payload, telegramNumbers, trip) {
    const telegramMessage =
        `
🚚 *${payload.truckregistrationnumber}*

🔶 _${payload.eventtype}_ Alert
🔶 *${payload.eventtext}*
🔶 _${tripDateView(payload.eventtime)}_

🕵🏻 *Driver:* ${payload.drivername}  
☎️ *Phone:* ${payload.drivernumber}
🌎 *Route* ${payload.routename} ${payload.routeLength ? `♾️ ${payload.routeLength} Km` : ''}

*Trip Progress*

❇️ *Current State:* ${payload.tripstage}
💹 *Latest Activity:* ${payload.activestatus}

✒️ *Trip Start:* ${tripDateView(payload.actualstarttime)}
✒️ *Covered :* ${payload.distancecovered} Km
✒️ *Remaining :* ${payload.distanceremaining} Km
${payload.estimatedtimeofarrival ? `✒️ *ETA:* ${tripDateView(payload.estimatedtimeofarrival)}` : ''}

💰 *Shipper:* ${payload.customer}
🛢 *Goods:* ${payload.goodsname}

`;

    await redisClient.connect();
    console.log("Redis Ok, sending telegram message to:", telegramNumbers);
    await sendMessage(telegramNumbers, telegramMessage);
    console.log("Telegram message sent to:", telegramNumbers);
    redisClient.quit();
    process.exit(0);
}

async function sendMessage(numbers, message) {
    try {
        //console.log("Sending message to:", numbers);
        if (numbers.length > 0) {
            let phone = numbers.pop();
            const telegramid = await redisClient.get(`phone_telegramid:${phone}`);
            //console.log("got telegramid", telegramid);
            if (telegramid) {
                if (!redisClient.isReady) {
                    console.log("Redis client not ready, skipping message");
                    return;
                }
                const str = JSON.stringify({ chatId: telegramid, msg: message })
                await redisClient.publish('telegram_fuel', str);
                console.log("Published message to telegram_fuel");
                await sendMessage(numbers, message);
            } else {
                console.log("telegram chatid not available", phone);
                await sendMessage(numbers, message);
            }
        } else {
            console.log("Done Exiting\n");
            redisClient.quit();
            process.exit(0);
        }
    } catch (error) {
        console.log("Error sending message", error);
        redisClient.quit();
        process.exit(1);
    }
}

// Create dummy payload with test data
const dummyPayload = {
    truckregistrationnumber: "MH02AB1234",
    eventtype: "Speed Violation",
    eventtext: "Vehicle exceeded speed limit of 80 kmph",
    eventtime: "2024-01-10 14:30:00",
    drivername: "Ramesh Kumar",
    drivernumber: "9876543210",
    routename: "Mumbai-Delhi Express Route",
    tripstage: "Active",
    activestatus: "In Transit",
    actualstarttime: "2024-01-10 08:00:00",
    distancecovered: "450",
    distanceremaining: "800",
    estimatedtimeofarrival: "2024-01-11 16:00:00",
    customer: "ABC Logistics Ltd",
    goodsname: "Electronics and Consumer Goods",
    lat: "19.0760",
    lng: "72.8777",
    routeLength: "1250",
};

// Test numbers array
const testTelegramNumbers = ['9004040603'];

// Call sendTelegramAlert with dummy data
sendTelegramAlert(dummyPayload, testTelegramNumbers);


/*
sample payload
const { eventType, eventText, eventTime } = event;
        const {
            truckRegistrationNumber, tripStage, activeStatus,
            actualStartTime, truckPoint,
            distanceCovered, distanceRemaining, estimatedTimeOfArrival,
            customer, goodsName, driverName, driverPhoneNumber,
            route, notifications
        } = trip;
        const { routeName = null } = route || {};
        const { lat = null, lng = null } = truckPoint || {};
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
*/


/* 
const telegramMessage =
                    `🚚 *${tp.vehicle}* : Diesel ${tp.event_type} at ⏱ ${tp.event_time}
                    \n⛽ *${tp.quantity}* ${tp.confidence !== 'high' ? '_estimated_' : ''}
                    \n🏭 _${address}_
                    `;
                    pub.publish('telegram_fuel', JSON.stringify({ chatId: telegramid, msg: message }));
*/

/* 
🚚 Truck: *{{truckregistrationnumber}}* 
🕵🏻 *Driver:* {{drivername}} [ {{drivernumber}} ] is driving *Route* {{routename}}
~~~~~~~~~~~~~~~~~~
♻️ *{{eventtype}}*  Alert
🧿 Activity: *{{eventtext}}*  _at_ {{eventtime}}
🥏 Check Event location on google: https://maps.google.com/maps?q={{lat}},{{lng}}&t=m

*Trip Progress*
The trip currenltly is in *{{tripstage}}* status. The latest activity is *{{activestatus}}*. The trip started at {{actualstarttime}}. So far, the truck has *covered {{distancecovered}} Km*, and it has still to go {{distanceremaining}} Km. It is expected to reach the destination by {{estimatedtimeofarrival}}. The shipper of this trip is *{{customer}}* sending {{goodsname}}.
*/
