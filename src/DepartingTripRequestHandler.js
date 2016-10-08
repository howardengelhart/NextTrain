'use strict';

const log = require('./log');
const ld = require('lodash');
const fb = require('thefacebook');
const OTPlanner = require('./OTPlanner');
const moment = require('moment-timezone');

class DepartingTripRequestHandler {
    constructor(job) {
        this.job = job;
    }

    send(msg) {
        return this.message.send( this.job.user.userId, msg, this.job.token);
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
        return ld.get(this,'job.user.data.currentRequest');
    }

    get payload() {
        return ld.get(this,'job.payload');
    }

    set state(state) {
        ld.get(this,'job.user.data.currentRequest').state = state;
    }
    
    get state() {
        return ld.get(this,'job.user.data.currentRequest.state');
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
    
    requestDestination() {
        log.info('exec requestDestination');
        let text = new fb.Text('I need to know where this trip ends.  ' +
            'Send me the name of the station, or hit Send Location and I\'ll ' +
            'try to find one nearby.');
        text.quick_replies.push(new fb.LocationQuickReply() );

        this.state = 'WAIT_DESTIONATION';
        return this.send(text);
    }
    
    requestStationSelectionWide (stations, selectText) {
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
                new fb.PostbackButton({ title : (selectText || 'Select'),
                    payload : JSON.stringify(payload) })
            ];

            log.info({element : cfg }, 'create Element');
            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }

        return this.send(templ);
    }

    displayDate(dt) {
        return moment(dt).tz('America/New_York').format('YYYY-MM-DD HH:mm:ss');
    }

    requestTripSelection (plans ) {
        log.info('exec requestTripSelection');
        let templ = new fb.GenericTemplate();

        for (let i of plans.plan.itineraries) {
            let payload = {
                type : 'select_trip',
                payload :  'payload'
            };

            let cfg = {
                title : this.displayDate(i.startTime),
                subtitle : moment(i.startTime).diff(moment(i.endTime), 'minutes') + ' minutes'
            };

            cfg.buttons = [
                new fb.PostbackButton({ title : 'Select',
                    payload : JSON.stringify(payload) })
            ];

            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }
        
        return this.send(templ);
    }

    requestStationSelection(stations, selectText) {
        log.info('exec requestStationSelection');
        let templ = new fb.GenericTemplate();
        let cfg = { title : selectText };

        cfg.buttons = stations.map( (station) => {
            let payload = { type : 'select_station', stop : station };
            let title = station.name;
            if (station.dist) {
                let distance = Math.round((station.dist * 0.000621371) * 10) / 10;
                title = `${station.name} ${distance} m`;
            }
            return new fb.PostbackButton({ title : title, payload : JSON.stringify(payload) });
        });
        
        templ.elements.push(new fb.GenericTemplateElement(cfg));

        return this.send(templ);
    }

    getStationFromLocation(coordinates, selectText) {
        log.info('exec getStationFromLocation');
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
            return this.requestStationSelection(results, selectText);
        })
        .catch((err) => {
            log.error('Error: %s', err.message);
            return this.send('No stations found, try typing one in.');
        });
    }

    getStationFromList(stationName, selectText) {
        log.info('exec getStationFromList');
        return this.otp.findStops()
        .then((results) => {
            if (!results || !results.length) {
                return this.send('No stations found, try again later.');
            }

            let re = new RegExp(stationName,'gi');

            let matches = results.filter( stop => {
                return stop.name.match(re);
            });

            log.info({ 
                text: stationName,
                results : results.length, 
                matches : matches.length }, 'MATCH CHECK');

            if (!matches || !matches.length) {
                return this.send('No matching stations found, try again.');
            }

            if (matches.length > 5) {
                return this.send('Too many matching stations found, try again.');
            }

            log.info({ results : matches }, 'OTP found stops');
            return this.requestStationSelection(matches, selectText);
        })
        .catch((err) => {
            log.error('Error: %s', err.message);
            return this.send('No stations found, try typing one in.');
        });
    }

    onNew() {
        log.info('exec onNew');
        let rqs = { type : 'schedule_departing', state : 'NEW' };
        rqs.data = this.job.payload;
        this.job.user.data.currentRequest = rqs;
        return this.evalState();
    }

    onWaitOrigin() {
        log.info('exec onWaitOrigin, job.type=%s',this.job.type);
        if (this.job.type === 'location') {
            return this.getStationFromLocation(this.job.payload.coordinates, 'Select Origin');
        } else
        if (this.job.type === 'text') {
            this.request.data.origin = this.job.msg.message.text;
            return this.getStationFromList(this.request.data.origin, 'Select Origin');
        } else 
        if (this.job.type === 'postback') {
            if (this.payload.type === 'select_station') {
                this.request.data.originStop = this.payload.stop;
                if (!this.request.data.origin) {
                    this.request.data.origin = this.payload.stop.name;
                }
                return this.evalState();
            }
        }
        
        return Promise.resolve(this.job);
    }

    onWaitDestination() {
        if (this.job.type === 'location') {
            return this.getStationFromLocation(this.job.payload.coordinates,
                'Select Destination');
        } else
        if (this.job.type === 'text') {
            this.request.data.destination = this.job.msg.message.text;
            return this.getStationFromList(this.request.data.destination, 
                'Select Destination');
        } else 
        if (this.job.type === 'postback') {
            if (this.payload.type === 'select_station') {
                this.request.data.destinationStop = this.payload.stop;
                if (!this.request.data.destination) {
                    this.request.data.destination = this.payload.stop.name;
                }
                return this.evalState();
            }
        }
        
        return Promise.resolve(this.job);
    }

    onReady() {
        let otp = this.otp;
        let params = {
            fromPlace : this.request.data.originStop.id,
            toPlace: this.request.data.destinationStop.id,
            mode : 'TRANSIT',
            maxWalkDistance:804.672,
            locale:'en',
            numItineraries : 5,
            showIntermediateStops: true
        };

        return otp.findPlans(params)
        .then(result => {
            return this.requestTripSelection(result);
        });
    }


    evalState() {
        log.info('exec evalState');
        let rqs = this.request;
        
        if (!rqs.data.origin) {
            return this.requestOrigin();
        }
        else
        if (!rqs.data.originStop) {
            this.state = 'WAIT_ORIGIN';
            return this.getStationFromList(this.request.data.origin, 'Select Origin');
        }
        else
        if (!rqs.data.destination) {
            return this.requestDestination();
        }
        else
        if (!rqs.data.destinationStop) {
            this.state = 'WAIT_DESTINATION';
            return this.getStationFromList(this.request.data.destination, 'Select Destination');
        }
        else {
            this.state = 'READY';
            return this.work();
        }
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
            else
            if (state === 'WAIT_DESTINATION') {
                return this.onWaitDestination();
            } 
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
