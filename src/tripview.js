'use strict';

const log       = require('./log');
const S3        = require('aws-sdk').S3;
const moment = require('moment-timezone');
const ld = require('lodash');
const today = moment().tz('America/New_York');

function getTrip(params) {
    return new Promise( (resolve, reject) => {
        let s3 = new S3();
   
        s3.getObject(params, (err,data) => {
    
            if (err) {
                return reject(err);
            }

            return resolve(JSON.parse(data.Body.toString()));
        });
    });
}

function displayDate(dt) {
    let m = moment(dt).tz('America/New_York');
    let format = 'ddd, h:mmA';

    if (m.isSame(today,'day')) {
        format = 'h:mmA';
    }

    return moment(dt).tz('America/New_York').format(format);
}

exports.handler = (event, context ) => {
    log.trace(event);
    let itineraryId = event.params.querystring.i;
    let appId  = ld.get(event,'params.path.app');
    log.info(`appId=${appId}, itineraryId=${itineraryId}`);

    getTrip({ Bucket : appId, Key : `itineraries/${itineraryId}.json` })
    .then(trip => {
        let r= [];
        let tripTime = moment(trip.endTime).diff(moment(trip.startTime), 'minutes');
        let deptTime = displayDate(trip.startTime);
        let arrTime = displayDate(trip.endTime);
        r.push('<div>');
        r.push(`<h2> ${trip.from} to ${trip.to} </h2>`);
        r.push(`Departs at ${deptTime}<br/>`);
        r.push(`Arrives at ${arrTime}<br/>`);
        r.push(`Trip Time: ${tripTime} minutes <br/>`);
        r.push(`Transfers: ${trip.transfers} <br/>`);
       
        for (let leg of trip.legs) {
            let deptTime = displayDate(leg.from.departure);
            let arrTime = displayDate(leg.to.arrival);
            r.push('<div>');
            r.push('<p>');
            r.push(`<b><u> ${leg.route} </u></b><br/>`);
//            r.push(`<b> ${leg.from.name} - ${leg.to.name} </b> <br/>`);
            r.push(`Departs ${leg.from.name} at ${deptTime}<br/>`);
            r.push(`Arrives ${leg.to.name} at ${arrTime}<br/></p>`);
            r.push('</p>');
            if (leg.intermediateStops && leg.intermediateStops.length){
                r.push('<h4> Stops </h4>');
                r.push('<ul>');
                for (let stop of leg.intermediateStops) {
                    r.push(`<li>${stop.name}</li>`);
                }
                r.push('</ul>');
            }
            r.push('</div>');
        }
        r.push('</div>');
        return r.join(' ');
    })
    .catch(err => {
        log.error(err,'TRIP LOOKUP ERROR');
        return '<p>There was an error locating your trip details.</p>';
    })
    .then(payload => {
        let html = [
            '<!DOCTYPE html>',
            '<html>',
            '<head>',
            '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">',
            '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
            '<meta name="viewport" content="width=device-width,initial-scale=1">',
            '</head>',
            `<body>${payload}</body>`,
            '</html>'
        ].join('');
        context.succeed({ htmlResult : html});
    });
};
