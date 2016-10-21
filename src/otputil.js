'use strict';

const log   = require('./log');
const S3    = require('aws-sdk').S3;

function objectExists (s3, params) {
    log.debug(params, 'HEAD');
    return new Promise( (resolve) => {
        s3.headObject(params, (err,data) => {
            if (err) {
                if (err.name === 'Forbidden') {
                    log.debug(params,'Object does not exist in S3.');
                } else {
                    log.error(`HEAD ERROR: ${err.name || err.message || 'Unspecificed.' }`);
                }
                return resolve(false);
            } 
            log.info(data, 'HEAD DATA');
            return resolve(true);
        });
    });
}

function putObject (s3, params) {
    log.debug({ Bucket : params.Bucket, Key : params.Key }, 'PUT');
    return new Promise( (resolve, reject) => {
        s3.putObject(params, (err,data) => {
            if (err) {
                log.error(err, 'PUT ERROR');
                return reject(err);
            } 
            log.info(data, 'PUT DATA');
            return resolve(data);
        });
    });  
}

function compressPlanItinerary(plan, i, app) {
    return {
        date : (plan.date - (plan.date % 3600000)), // round to the hour
        timezone : app.timezone,
        pageName : app.pageName,
        pageLink : app.pageLink,
        messengerLink : app.messengerLink,
        from : plan.from.name,
        to : plan.to.name,
        duration : i.duration,
        startTime : i.startTime,
        endTime : i.endTime,
        transfers : i.transfers,
        legs : i.legs.map( l => ( 
            {
                startTime : l.startTime,
                endTime : l.endTime,
                distance : l.distance,
                mode : l.mode,
                route : l.route,
                routeId  : l.routeId,
                tripId  : l.tripId,
                serviceDate : l.serviceDate,
                from : {
                    stopId : l.from.stopId,
                    name : l.from.name,
                    arrival : l.to.arrival,
                    departure : l.from.departure
                },
                to : {
                    stopId : l.to.stopId,
                    name : l.to.name,
                    arrival : l.to.arrival,
                    departure : l.to.departure
                },
                duration : l.duration,
                intermediateStops : l.intermediateStops.map( s => (
                    {
                        name : s.name,
                        stopId : s.stopId,
                        arrival : s.arrival,
                        departure : s.departure,
                        stopIndex : s.stopIndex,
                        stopSequence : s.stopSequence
                    }
                ))
            }
        ))
    };
}

exports.compressAndStorePlan = (bucket, key, app, planner) => {
    const crypto = require('crypto');
    let s3 = new S3();
    return Promise.all(planner.plan.itineraries.map(itinerary => {
        let i = compressPlanItinerary(planner.plan,itinerary, app);
        let hash = crypto.createHash('md5');
        let result = {
            itinerary : i
        };
        hash.update(JSON.stringify(i));
        
        result.itineraryId = hash.digest('hex');

        return objectExists(s3, { 
            Bucket: bucket, 
            Key : `itineraries/${result.itineraryId}.json`
        })
        .then(exists => {
            log.info(`Itinerary ${result.itineraryId} exists: ${exists}`);
            if (exists) {
                return result;
            }
                                                                
            return putObject(s3, { 
                Bucket : bucket, 
                Key : `${key}/${result.itineraryId}.json`, 
                Body : JSON.stringify(i), 
                ContentType : 'application/json' ,
                CacheControl: 'max-age=900'
            })
            .then( () => result);
        });
    }));
};
