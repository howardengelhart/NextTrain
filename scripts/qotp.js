'use strict';

const moment = require('moment-timezone');
const OTPlanner = require('../src/OTPlanner');
const otp = new OTPlanner( {"hostname":"otp.mechinate.com:8080","routerId":"njt"} );
const TODAY = timezone => moment().tz(timezone);

function fmtDate(dt) {
    let m = moment(dt).tz('America/New_York');
    let format = 'ddd, h:mmA';
    
    if (m.isSame(TODAY('America/New_York'),'day')) {
        format = 'h:mmA';
    }
    return m.format(format);
}

function displayPlan(plan) {
    let output = [];
    output.push(`${fmtDate(plan.date)} : ${plan.from.name} to ${plan.to.name}`);
    for (let i = 0; i < plan.itineraries.length; i++) {
        output.push('');
        let it = plan.itineraries[i];
        let header = `Itinerary #${i + 1}: ${fmtDate(it.startTime)} to ${fmtDate(it.endTime)}`;
        output.push(Array(header.length + 6).fill('-').join(''));
        output.push(`   ${header}   `);
        output.push(Array(header.length + 6).fill('-').join(''));
        for (let leg of it.legs) {
            output.push('');
            let header = `${leg.route}, realTime ${leg.realTime}`;
            output.push(header);
            output.push(Array(header.length).fill('-').join(''));
            output.push(`${fmtDate(leg.startTime)}, Depart ${leg.from.name}`);
            for (let stop of leg.intermediateStops) {
                output.push(`${fmtDate(stop.departure)}, ${stop.name} `);
            }
            output.push(`${fmtDate(leg.endTime)}, Arrive ${leg.to.name} `);
        }
    }
    return output;
}


let range = moment().tz('America/New_York').add(1,'hours');

let params = {
    fromPlace : '1:105',
    toPlace: '1:125',
    mode : 'TRANSIT',
    maxWalkDistance:804.672,
    locale:'en',
    numItineraries : 3,
    showIntermediateStops: true,
//    arriveBy : true,
//    ignoreRealtimeUpdates : true,
    date : range.format('MM-DD-YYYY'),
    time : range.format('HH:mm:00')
};

otp.findPlans(params)
.then(result => {
    let output = displayPlan(result.plan);
    for (let line of output) {
        console.log(line);
    }
})
.catch(err => {
    console.log(err);
});


