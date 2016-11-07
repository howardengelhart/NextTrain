'use strict';

const ld        = require('lodash');
const log       = require('./log');
const OTPlanner = require('./OTPlanner');

exports.handler = (event, context ) => {
    let stage = ld.get(event,'context.stage','');
    let appId  = ld.get(event,'params.path.app','');
    let routerId = event.params.querystring.r;
    let cdnRoot = `https://cdn.mechinate.com/${appId}`;
    let iconImg = `<img src="${cdnRoot}/img/icons/engineer-30x30.png"/>`;


    let host = ld.get(event,'params.header.Host','');
    
    log.level(ld.get(event,'stage-variables.loglevel','info'));
    log.trace({'event': event, context: context},'New Request');
    
    let isAwsHost = host.match(/amazonaws.com/) ? true : false;
    let pathParts = isAwsHost ? [ stage, appId ] : [ 'messenger', stage, appId ];

    let appRootUrl = require('url').format({
        protocol : ld.get(event,'params.header.CloudFront-Forwarded-Proto'),
        host : host,
        pathname : pathParts.join('/')
    });
    
    log.debug({ appRootUrl : appRootUrl}, 'Handler called.');
    
    let otp = new OTPlanner({ hostname : 'otp.mechinate.com:8080', routerId : routerId });
    return otp.findRoutes() 
    .then((routes) => {
        return Promise.all(routes.map((route) => {
            log.debug({route : route},'Find stops for route.');
            return otp.findStopsByRoute(route.id)
            .then((stops) => {
                route.stops = stops;
                return route;
            });
        }));
    })
    .then((routes) => {
        let body = [];
        let routeMap = {};
        body.push('<ul>');
        for (let route of routes.sort((a,b) => (a.longName > b.longName ? 1 : -1))) {
            routeMap[route.longName] = {};
            for (let stop of route.stops) {
                routeMap[route.longName][stop.name] = 1;
            }
        }

        for (let route in routeMap) {
            body.push(`<li><span class="route-name">${route}</span><ul>`);
            for (let stop of 
                Object.keys(routeMap[route]).sort((a,b) => (a> b? 1 : -1))) {
                body.push(`<li class="stop-name">${stop}</li>`);
            }
            body.push('</ul></li>');
        }
        body.push('</ul>');

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
            '<h1> Station Stops </h1>',
            '</header>',
            `${body.join('')}`,
            '</div>',
            '</body>',
            '</html>'
        ].join('');
        context.succeed({ htmlResult : html});
    })
    .catch((err) => {
        context.fail(err);
    });
};
