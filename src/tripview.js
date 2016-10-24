'use strict';

const log       = require('./log');
//const S3        = require('aws-sdk').S3;
const request   = require('request');
const moment = require('moment-timezone');
const ld = require('lodash');
const inspect = require('util').inspect;

//function getTrip(params) {
//    return new Promise( (resolve, reject) => {
//        let s3 = new S3();
//   
//        s3.getObject(params, (err,data) => {
//    
//            if (err) {
//                return reject(err);
//            }
//
//            return resolve(JSON.parse(data.Body.toString()));
//        });
//    });
//}

function getTrip(url) {
    return new Promise((resolve,reject) => {
        let opts = { json : true };
        log.info(`Retrieving: ${url}`);
        request.get(url,opts,(err,resp,body) => {
            if (err) {
                return reject(err);
            }

            if ((resp.statusCode < 200) || (resp.statusCode > 299)) {
                return reject( 
                    new Error('Unexpected statusCode: ' + resp.statusCode + 
                        (resp.body ? ', ' + inspect(resp.body,{depth:3}) : ''))
                );
            }

            return resolve(body);
        });
    });
}

function displayDate(dt, timezone) {
    timezone = timezone || 'America/New_York';
    let today = moment().tz(timezone);
    let m = moment(dt).tz(timezone);
    let format = 'ddd, h:mma';

    if (m.isSame(today,'day')) {
        format = 'h:mma';
    }

    return moment(dt).tz(timezone).format(format);
}

exports.handler = (event, context ) => {
    log.level(ld.get(event,'stage-variables.loglevel','info'));
    log.debug(event);
    let itineraryId = event.params.querystring.i;
    let routerId = event.params.querystring.r;
    let appId  = ld.get(event,'params.path.app');
    let cdnRoot = `https://cdn.mechinate.com/${appId}`;
    log.info(`appId=${appId}, itineraryId=${itineraryId}, routerId=${routerId}`);

    //getTrip({ Bucket : appId, Key : `itineraries/${routerId}/${itineraryId}.json` })
    getTrip(`${cdnRoot}/itineraries/${routerId}/${itineraryId}.json` )
    .then(trip => {
        let tripTime = moment(trip.endTime).diff(moment(trip.startTime), 'minutes');
        let deptTime = displayDate(trip.startTime, trip.timezone);
        let arrTime = displayDate(trip.endTime, trip.timezone);
        let body = [
            '<section class="summary-block">',
            '<div class="depart-summary">',
            '<span>Departs</span>',
            `<h2>${deptTime}<span class="small-text"></span></h2>`,
            `<span>${trip.from}</span>`,
            '</div>',
            '<div class="arrive-summary">',
            '<span>Arrives</span>',
            `<h2>${arrTime}<span class="small-text"></span></h2>`,
            `<span>${trip.to}</span>`,
            '</div>',
            '<hr>',
            `<span class="summary-line">Transfers <strong>${trip.transfers}</strong></span>`,
            '<hr>',
            `<span class="summary-line">Duration (minutes) <strong>${tripTime}</strong></span>`,
            '<hr>',
            '</section>',
            '<section class="transit-info">'
        ];
       
        for (let i = 0; i < trip.legs.length; i++) {
            let leg = trip.legs[i];
            let deptTime = displayDate(leg.from.departure, trip.timezone);
            let arrTime = displayDate(leg.to.arrival, trip.timezone);

            if (i > 0) {
                body.push('<hr> <span class="centered">Transfer</span> <hr>');
            }

            body.push(`<h3 class="transit-name icon-train">${leg.route}</h3>`);
            body.push('<div>');
            body.push('<p>');
            body.push('<ul class="transit-stops">');
            body.push(`<li class="highlight-stop">${leg.from.name}<strong>` + 
                `${deptTime}</strong></li>`);
            if (leg.intermediateStops && leg.intermediateStops.length){
                for (let stop of leg.intermediateStops) {
                    body.push(`<li>${stop.name}</li>`);
                }
            }
            body.push(`<li class="highlight-stop">${leg.to.name}<strong>` +
                `${arrTime}</strong></li>`);
            body.push('</ul>');
        }
        body.push('<hr> <span class="centered">Destination</span> ');
        body.push('</section>');

        let iconImg;
        if (trip.pageLink) {
            iconImg = [
                `<a href="${trip.pageLink}">`,
                `<img src="${cdnRoot}/img/icons/engineer-30x30.png"/>`,
                '</a>'
            ].join('');
        } else {
            iconImg = 
                `<img src="${cdnRoot}/img/icons/engineer-30x30.png"/>`;
        }
    
        let html = [
            '<!DOCTYPE html>',
            '<html>',
            '<head>',
            '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">',
            '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
            '<meta name="viewport" content="width=device-width,initial-scale=1">',
            '<link href="https://fonts.googleapis.com/css?family=Source+Sans+Pro' +
                ':300,400" rel="stylesheet">',
            `<link href="${cdnRoot}/css/tripview.css" rel="stylesheet">`,
            `<link href="${cdnRoot}/img/icons/engineer-30x30.png" rel="icon" >`,
            '</head>',
            '<body>',
            '<div class="page-wrap">',
            '<header class="head-wrap">',
            iconImg,
            `<h1> ${trip.pageName || 'Your Trip' }</h1>`,
            '</header>',
            `${body.join('')}`,
            '</div>',
            '</body>',
            '</html>'
        ].join('');
        context.succeed({ htmlResult : html});
    })
    .catch(err => {
        log.error(err,'TRIP LOOKUP ERROR');
        let html = [
            '<!DOCTYPE html>',
            '<html>',
            '<head>',
            '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">',
            '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
            '<meta name="viewport" content="width=device-width,initial-scale=1">',
            '</head>',
            '<p>There was an error locating your trip details.</p>',
            '<body>',
            '</body>',
            '</html>'
        ].join('');
        context.succeed({ htmlResult : html});
    });
};
