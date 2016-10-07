'use strict';

const log = require('./log');
const ld = require('lodash');
const fb = require('thefacebook');
const OTPlanner = require('./OTPlanner');

class DepartingTripRequestHandler {
    constructor(job) {
        this.job = job;
    }

    get message() {
        if (!this._message) {
            this._message = new fb.Message();
        }
        return this._message;
    }

    get otp() {
        if (!this._otp) {
            this._otp = new OTPlanner(this.job.app.otp);
        }
        return this._otp;
    }

    get request() {
        return ld.get(this,'user.data.currentRequest');
    }

    send(msg) {
        return this.message.send( this.job.user.userId, msg, this.job.token);
    }

    set state(state) {
        ld.get(this,'job.user.data.currentRequest').state = state;
    }
    
    get state() {
        return ld.get(this,'job.user.data.currentRequest').state;
    }

    requestOrigin() {
        log.info('exec requestOrigin');
        let text = new fb.Text('I need to know where this trip starts.  ' +
            'Send me the name of the station, or hit Send Location and I\'ll ' +
            'try to find one nearby.');
        text.quick_replies.push(new fb.LocationQuickReply() );

        this.state = 'WAIT_ORIGIN';
        return this.send(text);
    }

    requestStationSelection(stations) {
        log.info('exec requestStationSelection');
        let templ = new fb.GenericTemplate();
        
        for (let station of stations) {
            let mapUrl = `https://www.google.com/maps?q=${station.lat}%2C${station.lon}`;

            let payload = {
                type : 'select_station',
                stop : station
            };

            let cfg = {
                title : station.name
            };

            if (station.dist) {
                let distance = Math.round((station.dist * 0.000621371) * 10) / 10;
                cfg.subtitle = `${distance} miles away`;
            }

            cfg.buttons = [
                new fb.UrlButton({ title : 'Map', url : mapUrl }),
                new fb.PostbackButton({ title : 'Select', payload : JSON.stringify(payload) })
            ];

            log.info({element : cfg }, 'create Element');
            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }

        return this.send(templ);
    }

    getStationFromLocation(coordinates) {
        let otp = this.otp;
        let otpParams = {
            lat : coordinates.lat,
            lon : coordinates.long,
            radius : 10000
        };
        
        return otp.findStops(otpParams)
        .then((results) => {
            if (!results || !results.length) {
                return this.send('No local stations found, try typing one in.');
            }

            log.info({ results : results }, 'OTP found stops');
            return this.requestStationSelection(results);
        })
        .catch((err) => {
            log.error('Error: %s', err.message);
            return this.send('No stations found, try typing one in.');
        });
    }

    getStationFromList() {
        log.info('exec getStationFromList');
        return this.otp.findStops()
        .then((results) => {
            if (!results || !results.length) {
                return this.send('No stations found, try again later.');
            }

            let re = new RegExp(this.request.data.origin,'gi');

            let matches = results.filter( stop => {
                return stop.name.match(re);
            });

            log.info({ 
                text: this.job.msg.message.text,
                results : results.length, 
                matches : matches.length }, 'MATCH CHECK');

            if (!matches || !matches.length) {
                return this.send('No matching stations found, try again.');
            }

            if (matches.length > 7) {
                return this.send('Too many matching stations found, try again.');
            }

            log.info({ results : matches }, 'OTP found stops');
            return this.requestStationSelection(matches);
        })
        .catch((err) => {
            log.error('Error: %s', err.message);
            return this.send('No stations found, try typing one in.');
        });
    }

    onWaitOrigin() {
        if (this.job.type === 'location') {
            return this.getStationFromLocation(this.job.payload.coordinates);
        } else
        if (this.job.type === 'text') {
            this.request.data.origin = this.job.msg.message.text;
            return this.getStationFromList();
        } else 
        if (this.job.type === 'postback') {
            if (this.payload.type === 'select_station') {
                this.request.data.originStop = this.payload.stop;
                return this.evalRequest();
            }
        }
        
        return Promise.resolve(this.job);
    }

    onNew() {
        log.info('exec onNew');
        let rqs = { type : 'schedule_departing', state : 'NEW' };
        rqs.data = this.job.payload;
        this.job.user.data.currentRequest = rqs;
        return this.evalRequest();
    }

    evalRequest() {
        log.info('exec evalRequest');
        let rqs = this.request;
        
        if (!rqs.data.origin) {
            return this.requestOrigin();
        }

        if (!rqs.data.originStop) {
            return this.onWaitOrigin();
        }

        if (!rqs.data.destination) {
            return this.requestDestination();
        }

        this.state = 'READY';
        return this.work();
    }

    work() {
        let state = ld.get(this, 'job.user.data.currentRequest.state','NEW');
        let doWork = () => {
            log.info(`doWork for state ${state}`);
            if (state === 'NEW') {
                return this.onNew();
            }
            else
            if (state === 'WAIT_ORIGIN') {
                return this.onWaitOrigin();
            } 
            //else
            //if (state === 'WAIT_ORIGIN_ID') {
            //    return this.onWaitOriginId();
            //} 
            //else
            //if (state === 'WAIT_DESTINATION') {
            //    return this.onWaitDestination();
            //} 
            //else
            //if (state === 'WAIT_DESTINATION_ID') {
            //    return this.onWaitDestinationId();
            //} 
            else
            if (state === 'READY') {
                return this.onReady();
            } 

            return Promise.resolve({});
        };
        return doWork().then(() => this.job );
    }
}

module.exports = DepartingTripRequestHandler;
