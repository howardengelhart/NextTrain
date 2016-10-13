'use strict';
/* eslint-disable no-console */
const ld = require('lodash');
const googleKey = 'KEY-GOES-HERE';
const request = require('request');
const S3    = require('aws-sdk').S3;

let stops = require('./stops.json');

let xferMap = (stop) => {
    return new Promise( (resolve, reject) => {
        let s3 = new S3();
        let url = 'https://maps.googleapis.com/maps/api/staticmap';
        let opts = {
            qs : {
                center : `${stop.lat},${stop.lon}`,
                zoom : 16,
                size : '420x220',
                key : googleKey
            }
        };

        request
        .get(url, opts)
        .on('error', (err) => {
            console.log('REQUEST ERROR: ', err);
            reject(err);
        })
        .on('response', (response) => {

            let s3params = {
                Bucket : 'tb-marco-1',
                Key : `img/njtransit/rail/${stop.code}.png`,
                ContentLength: response.headers['content-length'],
                ContentType: response.headers['content-type'],
                Body :  response,
                ACL : 'public-read'
            };

            s3.putObject(s3params, (err,data) => {
                if (err) {
                    console.log('PUT ERROR: ', stop, err);
                    return reject(err);
                } 
                ld.assign(stop,data);
                console.log(`Processed: ${stop.name}, ${stop.code}`);
                return resolve(stop);
            });
        });  
    });
};

let wait = () => { return new Promise((resolve) => setTimeout(resolve, 250)); };

let work = () => {
    let stop = stops.shift();
    if (stop === undefined) {
        return Promise.resolve();
    }
    console.log('Stop ==> ', stop.name);
    return xferMap(stop).then(wait).then(work);
};

work()
.then(() => {
    console.log('done');
})
.catch((e) => {
    console.log('error:', e);
});
