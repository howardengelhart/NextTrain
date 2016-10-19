'use strict';

const aws = require('aws-sdk');
const log = require('./log');
const ld = require('lodash');
const fb = require('thefacebook');
const OTPlanner = require('./OTPlanner');
const moment = require('moment-timezone');
const compressAndStorePlan = require('./otputil').compressAndStorePlan;
const fuzzy = require('fuzzy');
const TODAY = timezone => moment().tz(timezone);

class RequestHandler { 
    constructor(job, type) {
        let user = { id : job.user.userId };
        let profile = ld.get(job,'user.profile');
        if (profile) {
            user.name = `${profile.first_name} ${profile.last_name}`;
        }
        
        this.job    = job;
        this.type   = type;
        this.log    = log.child({ requestType : this.type, user :  user });

        this.log.trace('Initialized.');
    }
    
    get payload() { return this.job.payload; }
    get user() { return this.job.user; }
    get app() { return this.job.app; }
    get token() { return this.job.app.token; }
    
    send(msg) {
        if (!this._message) {
            this._message = new fb.Message();
        }
        return this._message.send( this.job.user.userId, msg, this.job.app.token);
    }

    handle() {
        return this.work().then(() => this.job);
    }
}

class UnknownRequestHandler extends RequestHandler {
    static get handlerType() { return 'unknown'; }
    
    constructor(job) {
        super (job, UnknownRequestHandler.requestType);
    }
    
    work() {
        return this.send('Sorry, didn\'t quite get that.')
        .then(() => { 
            this.job.done = true;
            return this.job; 
        });
    }
}

class MenuRequestHandler extends RequestHandler{
    static get handlerType() { return 'display_menu'; }

    constructor(job) {
        super (job, MenuRequestHandler.handlerType);
    }
    
    menuItem (t,i) {
        return new fb.PostbackButton({ 
            title : t, payload : JSON.stringify({ type : 'MAIN-MENU', item : i })
        });
    }

    work() {
        //let templ = new fb.ButtonTemplate('Let me find you..', [
        //    this.menuItem('Departing trains', DepartingTripRequestHandler.handlerType),
        //    this.menuItem('Arriving trains', ArrivingTripRequestHandler.handlerType),
        //    this.menuItem('Help', HelpRequestHandler.handlerType),
        //    this.menuItem('Send Feedback', FeedbackRequestHandler.handlerType)
        //]);
        
        let s3Bucket = `https://s3.amazonaws.com/${this.job.app.appId}/img/buttons`;
        let templ = new fb.GenericTemplate();

        templ.elements.push(new fb.GenericTemplateElement({
            title : 'Find Trains',
            image_url : `${s3Bucket}/train_departing.png`,
            buttons : [ 
                this.menuItem('Departing', DepartingTripRequestHandler.handlerType),
                this.menuItem('Arriving', ArrivingTripRequestHandler.handlerType) 
            ]
        }));

        templ.elements.push(new fb.GenericTemplateElement({
            title : 'Help & Feedback',
            image_url : `${s3Bucket}/shoutout.png`,
            buttons : [ 
                this.menuItem('Get Help', HelpRequestHandler.handlerType),
                this.menuItem('Send Feedback', FeedbackRequestHandler.handlerType) 
            ]
        }));

        return this.send(templ)
        .then(() => { 
            this.job.done = true; 
            return this.job; 
        });
    }
}

class MultiLineTextRequestHandler extends RequestHandler {
    constructor(job, type, lines) {
        super(job, type );
        this.lines = lines;
    }
    
    work() {
        let index = ld.get(this,'job.payload.index',0);
        let endIndex = ld.get(this,'job.payload.endIndex',this.lines.length);
        let line = this.lines[index++];
         
        if (!line) {
            this.job.done = true;
            return Promise.resolve(this.job);
        }

        let text = new fb.Text(line);
        if (index < endIndex) {
            text.quick_replies.push(new fb.TextQuickReply( { 
                title : 'Continue',
                payload : JSON.stringify({
                    type : this.type, index : index, endIndex : endIndex 
                })
            }));
        } else {
            this.job.done = true;
        }
        return this.send(text);
    }
    
}

class WelcomeRequestHandler extends MultiLineTextRequestHandler {
    static get handlerType() { return 'welcome'; }
    
    constructor(job) {
        let userName = ld.get(job,'user.profile.first_name','Friend');
        let speech = job.app.welcome.map((line) => {
            return line.replace('{userName}',userName);
        });
        super(job,WelcomeRequestHandler.handlerType,speech);
    }
}

class HelpRequestHandler extends MultiLineTextRequestHandler {
    static get handlerType() { return 'help'; }

    constructor(job) {
        let city1 = ld.get(job,'app.help.city1');
        let city2 = ld.get(job,'app.help.city2');
        let city3 = ld.get(job,'app.help.city3');

        let speech = [
            'You can send me questions like..' +
            `"When does the next train leave ${city1} for ${city2}?", or simply ` +
                `"When is the next train to ${city2}?".`,
            'You can also ask about arriving trains.. "When does the next train from ' +
                `${city3} arrive?"`,
            'You can get to my Quick Start menu and help any time by typing "menu", or ' +
            'clicking the menu button on the bottom left corner of Messenger.'
        ];

        super(job,HelpRequestHandler.handlerType,speech);
    }
}

class FeedbackRequestHandler extends RequestHandler {
    static get handlerType() { return 'feedback'; }

    constructor(job) {
        super (job, FeedbackRequestHandler.handlerType);
        let currentHandlerType = ld.get(this,'job.user.data.currentRequest.type');
        if (currentHandlerType !== FeedbackRequestHandler.handlerType) {
            this.user.data.currentRequest = {};
        }
    }
    
    set state(state) {
        ld.get(this,'user.data.currentRequest').state = state;
    }
    
    get state() {
        return ld.get(this,'user.data.currentRequest.state');
    }
    
    work() {
        let state = (this.state || 'NEW');
        let doWork = () => {
            this.log.info(`doWork for state ${state}`);
            if (state === 'NEW') {
                return this.onNew();
            }
            else
            if (state === 'WAIT_RESPONSE') {
                return this.onWaitResponse();
            } 

            return Promise.resolve({});
        };
        return doWork().then(() => this.job );
    }

    onNew() {
        this.log.debug('exec onNew');
        this.user.data.currentRequest = { 
            type : this.type, 
            state : 'NEW',
            data : this.payload
        };

        return this.send('Tell me what\'s on your mind.')
            .then(() => {
                this.state = 'WAIT_RESPONSE';
            });
    }

    onWaitResponse() {
        return new Promise((resolve) => {
            this.log.debug({ feedback : this.job.msg }, 'exec onWaitResponse');
            let message = JSON.stringify({
                user : this.user.serialize(),
                message : this.job.msg
            },null, 5);

            let profile = ld.get(this.job,'user.profile');
            if (profile) {
                profile = `${profile.first_name} ${profile.last_name}`;
            } else {
                profile = this.user.userId;
            }

            let subject = `Message from ${this.app.appId} - ${this.app.otp.routerId} ` +
                `user ${profile}`;
            let params = {
                Destination : {
                    ToAddresses: [ this.app.feedback.to ]
                },
                Source : this.app.feedback.from,
                ReplyToAddresses : [ this.app.feedback.from ],
                Message : {
                    Subject : {
                        Data : subject
                    },
                    Body : {
                        Text : {
                            Data : message
                        }
                    }
                }

            };
            let ses = new aws.SES();
          
            ses.sendEmail(params, (err, data) => {
                if (err) {
                    this.log.error({ error : err}, 'SES Error');
                } else {
                    this.log.debug({ ses : data }, 'Feedback has been sent.');
                }
               
                resolve(true);
            });
        })
        .then(() => {
            this.job.done = true;
            return this.send('Thanks for sharing.');
        });
    }
}

class TripRequestHandler extends RequestHandler {
    constructor(job, type) {
        super (job, type);
        let currentHandlerType = ld.get(this,'job.user.data.currentRequest.type');
        if (currentHandlerType !== type) {
            this.user.data.currentRequest = {};
        }
    }

    get noob() {
        return (ld.get(this,'user.data.tripHistory.length',0) <= 3);
    }


    get otp() {
        if (!this._otp) {
            this.log.debug({otpConfig : this.app.otp}, 'Creating OTPPlanner');
            this._otp = new OTPlanner(this.app.otp);
        }
        return this._otp;
    }
    
    get shouldSendTripsWide() {
        return ld.get(this,'app.stageVars.sendTripsWide',false);
    }

    get shouldRequestStationSelectionWide() {
        return ld.get(this,'app.stageVars.requestStationSelectionWide',false);
    }

    get numItineraries() {
        return ld.get(this,'app.stageVars.numItineraries',3);
    }

    get request() {
        return ld.get(this,'user.data.currentRequest');
    }

    set state(state) {
        ld.get(this,'user.data.currentRequest').state = state;
    }
    
    get state() {
        return ld.get(this,'user.data.currentRequest.state');
    }

    get timezone() {
        return ld.get(this,'app.timezone');
    }

    abbrevStopName(stopName) {
        this.log.debug(`abbrevStopName: ${stopName}`);
        const replaces = {
            STREET : 'ST',
            'LIGHT RAIL': 'LR',
            LIGHT : 'LT',
            LEVEL : 'LVL',
            RAILROAD : 'RR',
            RAIL : 'RL',
            ROUTE : 'RT',
            DRIVE : 'DR',
            AVENUE : 'AV',
            TERMINAL : 'TERM',
            STATION : 'STN',
            DEPARTURE : 'DEP',
            TRANSIT: 'TRANS',
            CENTER : 'CTR',
            'FRANK R LAUTENBERG' : ''
        };
        
        if (stopName.length <= 18) {
            return stopName;
        }

        let newName = stopName;
        for (let repl in replaces) {
            newName = newName.replace(repl,replaces[repl]);
            if (newName.length < 18) {
                break;
            }
        }

        if (newName.length > 20) {
            newName = newName.substr(0,18) + '..';
        }

        return newName;
    }

    requestStop(prompt) {
        this.log.debug('exec requestStop');
        let text = new fb.Text(prompt);
        text.quick_replies.push(new fb.LocationQuickReply() );
        
        let checkName = (this.state === 'WAIT_ORIGIN') ?
            ld.get(this,'request.data.destination') :
            ld.get(this,'request.data.origin');
        let checkId = (this.state === 'WAIT_ORIGIN') ?
            ld.get(this,'request.data.destinationStop.id') :
            ld.get(this,'request.data.originStop.id');

        let stopped = {};
        for (let trip of ld.get(this,'user.data.tripHistory',[])){
            for (let stop of [ trip.data.destinationStop, trip.data.originStop ]) {
                this.log.trace({ stop : stop }, 'EVAL HISTORICAL STOP');
                if (( text.quick_replies.length < 10) && 
                    (stopped[stop.name] === undefined) && 
                    (checkId !== stop.id) && 
                    ((!checkName) || (fuzzy.filter(checkName,[stop.name]).length === 0))
                    ) {
                    stopped[stop.name] = true;
                    this.log.debug({ stop : stop }, 'ADD STOP BUTTON');
                    text.quick_replies.push(new fb.TextQuickReply( { 
                        title: this.abbrevStopName(stop.name),
                        payload: JSON.stringify({ type: 'stop', stop: stop })
                    }));
                }
            }
        }

        return this.send(text);
    }
    
//    requestStop(prompt) {
//        let trip = ld.get(this,'user.data.tripHistory[0]');
//        let text = new fb.Text(prompt);
//        text.quick_replies.push(new fb.LocationQuickReply() );
//        log.debug({ thisTrip : this.request, oldTrip : trip}, 'REQUEST STOP QR CHECK');
//        
//        if (trip) {
//            let re, newId;
//            
//            // If we are looking for an Origin, make sure the old trip does not
//            // match this trip's destination as we do not want to suggest a possible
//            // destination match for the origin.
//            // If we are looking for a Destination, then make sure we don't suggest
//            // something we've already used for the origin.
//            
//            if (this.state === 'WAIT_ORIGIN') {
//                re = new RegExp(ld.get(this,'request.data.destination',''),'gi');
//                newId = ld.get(this,'request.data.destinationStop.id','');
//            } else {
//                re = new RegExp(ld.get(this,'request.data.origin',''),'gi');
//                newId = ld.get(this,'request.data.originStop.id','');
//            }
//
//            [trip.data.destinationStop, trip.data.originStop].forEach( (oldStop) => {
//                if ((!oldStop.name.match(re)) && (oldStop.id !== newId)) {
//                    text.quick_replies.push(new fb.TextQuickReply( { 
//                        title: this.abbrevStopName(oldStop.name),
//                        payload: JSON.stringify({ type: 'stop', stop: oldStop })
//                    }));
//                }
//
//            });
//        }
//        
//        return this.send(text);
//    }
    
    requestOrigin() {
        this.log.debug('exec requestOrigin');
        this.state = 'WAIT_ORIGIN';
        return this.requestStop(this.getRequestOriginText());
    }
    
    requestDestination() {
        this.log.debug('exec requestDestination');
        this.state = 'WAIT_DESTINATION';
        return this.requestStop(this.getRequestDestinationText());
    }
    
    displayDate(dt) {
        let m = moment(dt).tz(this.timezone);
        let format = 'ddd, h:mmA';

        if (m.isSame(TODAY(this.timezone),'day')) {
            format = 'h:mmA';
        }

        return moment(dt).tz(this.timezone).format(format);
    }

    dateToClockUrl(dt) {
        let s3Bucket = `https://s3.amazonaws.com/${this.job.app.appId}/img/clocks`;
        let fname = moment(dt).tz(this.timezone)
            .format('d_A_hh_mm').replace('AM','0').replace('PM','1');
        return `${s3Bucket}/${fname}.png`;
    }
    
    //Optional alternative for formatting station choices
    
    requestStationSelectionWide (stations) {
        this.log.debug({ stops : stations}, 'exec requestStationSelectionWide');
        let templ = new fb.GenericTemplate();
        let action = stations.length > 1 ? 'Select' : 'Confirm';
//        let stopType = this.state === 'WAIT_ORIGIN' ? 'Origin' : 'Destination';
        
        for (let station of stations) {
            let s3Bucket = `https://s3.amazonaws.com/${this.job.app.appId}`;
            let routerId = this.app.otp.routerId;
            let mapUrl = `https://www.google.com/maps?q=${station.lat}%2C${station.lon}`;
            let imgUrl = `${s3Bucket}/img/${routerId}/${encodeURIComponent(station.id)}.png`;
            let stopName = this.abbrevStopName(station.name);

            let payload = {
                type : 'stop',
                stop : station
            };

            let cfg = {
                title : stopName,
                item_url : mapUrl,
                image_url : imgUrl
            };

            if (station.dist) {
                let distance = Math.round((station.dist * 0.000621371) * 10) / 10;
                cfg.subtitle = `${distance} miles away`;
            }

            cfg.buttons = [
//                new fb.UrlButton({ title : 'Map', url : mapUrl }),
                new fb.PostbackButton({ title : action,
                    payload : JSON.stringify(payload) })
            ];

            this.log.debug({element : cfg }, 'create Element');
            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }

        return this.send(templ);
    }

    requestStationSelection(stations) {
        this.log.debug('exec requestStationSelection');
        if (this.shouldRequestStationSelectionWide) {
            return this.requestStationSelectionWide(stations);
        }
        let action = stations.length > 1 ? 'Select' : 'Confirm';
//        let stopType = this.state === 'WAIT_ORIGIN' ? 'Origin' : 'Destination';
        let templ = new fb.ButtonTemplate(action);

        templ.buttons = stations.map( (station) => {
            let payload = { type : 'stop', stop : station };
            let stopName = this.abbrevStopName(station.name);
            let title = stopName;
            if (station.dist) {
                let distance = Math.round((station.dist * 0.000621371) * 10) / 10;
                title = `${stopName} ${distance} m`;
            }
            return new fb.PostbackButton({ title : title, payload : JSON.stringify(payload) });
        });
       
        this.log.info(`Sending ${stations.length} stops to user.`);
        return this.send(templ);
    }
    
    getStationFromLocation(coordinates) {
        this.log.debug('exec getStationFromLocation');
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

            this.log.debug({ results : results }, 'OTP found stops');
            return this.requestStationSelection(results );
        })
        .catch((err) => {
            this.log.error('Error: %s', err.message);
            return this.send('No stations found, try typing one in.');
        });
    }

    getStationFromList(stationName ) {
        this.log.debug('exec getStationFromList');
        return this.otp.findStops()
        .then((results) => {
            if (!results || !results.length) {
                return this.send('No stations found, try again later.');
            }

            let matches = fuzzy.filter(stationName,results,{ extract: (s=> s.name)})
                .slice(0,5).map(m => m.original);
            //let re = new RegExp(stationName,'gi');
            //let matches = results.filter( stop => {
            //    return stop.name.match(re);
            //});
       
            this.log.debug({ 
                text: stationName,
                results : results.length, 
                matches : matches.length }, 'MATCH CHECK 1');

            if (!matches || !matches.length) {
                let takeTwo = stationName.replace(/\W+/g,' ').split(' ')[0];
                matches = fuzzy.filter(takeTwo,results,{ extract: (s=> s.name)})
                    .slice(0,5).map(m => m.original);
                this.log.debug({ 
                    text: takeTwo,
                    results : results.length, 
                    matches : matches.length }, 'MATCH CHECK 2');
            }

            if (!matches || !matches.length) {
                return this.send(`No matching stations found for "${stationName}", try again.`);
            }

            if (matches.length > 5) {
                return this.send(
                    `Too many matching stations found for "${stationName}", try again.`);
            }

            let previousStops = {};
            for (let trip of ld.get(this,'user.data.tripHistory',[])) {
                previousStops[ld.get(trip,'data.destinationStop.name','unknown')] = true;
                previousStops[ld.get(trip,'data.originStop.name','unknown')] = true;
            }

            this.log.debug({previousStops : previousStops}, 'PREV STOPS');

            matches = matches.sort((a,b) => {
                if (previousStops[a.name]) {
                    return -1;
                } else
                if (previousStops[b.name]) {
                    return 1;
                } else {
                    return 0;
                }
            });

            this.log.debug({ results : matches, resultType: typeof(matches) }, 
                'OTP found stops');
            return this.requestStationSelection(matches );
        })
        .catch((err) => {
            this.log.error('Error: %s', err.message);
            return this.send('No stations found, try typing one in.');
        });
    }
    
    work() {
        let state = ld.get(this, 'job.user.data.currentRequest.state','NEW');
        let doWork = () => {
            this.log.info(`doWork for state ${state}`);
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

    onNew() {
        this.log.debug('exec onNew');
        let rqs = { type : this.type, state : 'NEW' };
        rqs.data = this.payload;
        this.user.data.currentRequest = rqs;
        return this.evalState();
    }
    
    onWaitOrigin() {
        this.log.debug('exec onWaitOrigin, job.payloadType=%s',this.job.payloadType);
        if (this.job.payloadType === 'location') {
            return this.getStationFromLocation(this.payload.coordinates);
        } else
        if (this.job.payloadType === 'text') {
            this.request.data.origin = this.job.msg.message.text;
            return this.getStationFromList(this.request.data.origin);
        } else 
        if (this.job.payloadType === 'postback') {
            if (this.payload.type === 'stop') {
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
        if (this.job.payloadType === 'location') {
            return this.getStationFromLocation(this.payload.coordinates);
        } else
        if (this.job.payloadType === 'text') {
            this.request.data.destination = this.job.msg.message.text;
            return this.getStationFromList(this.request.data.destination);
        } else 
        if (this.job.payloadType === 'postback') {
            if (this.payload.type === 'stop') {
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
        let params = this.getTripParams();
        let bucket = this.app.appId;
        let key = `itineraries/${this.app.otp.routerId}`;

        this.log.debug({ otpParams : params }, 'calling findPlans');
        return otp.findPlans(params)
        .then(plans  => compressAndStorePlan(bucket, key, this.timezone, plans) )
        .then(compressedPlans => this.sendTrips(compressedPlans) )
        .then(() => this.finishRequest() );
    }

    finishRequest() {
        this.job.done = true;
        this.state = 'DONE';
        let history = this.user.data.tripHistory || [];
        history.unshift(this.request);
        while (history.length > 5) {
            history.pop();
        }
        this.user.data.tripHistory = history;
        return this;
    }

}

class DepartingTripRequestHandler extends TripRequestHandler {
    static get handlerType() { return 'schedule_departing'; }

    constructor(job) {
        super(job,DepartingTripRequestHandler.handlerType);
    }

    evalState() {
        this.log.debug('exec evalState');
        let rqs = this.request;
        
        if (!rqs.data.origin) {
            // If they typed in a destination, lets make sure its valid before
            // we ask them for an origin.
            if ((rqs.data.destination) && (!rqs.data.destinationStop)){
                this.state = 'WAIT_DESTINATION';
                return this.getStationFromList(
                    this.request.data.destination, 'Select Destination');
            } 
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

    
    getRequestOriginText() {
        let text = 'Departing from which station?';
        if (this.noob) {
            text += ' Type the name of the station, or hit Send Location and ' +
                'I\'ll try to find a station nearby.';
        }
        return text;
    }
    
    getRequestDestinationText() {
        let text = 'What station is your destination?';
        if (this.noob) {
            text += ' Type the name of the station, or hit Send Location and ' +
                'I\'ll try to find a station nearby.';
        }
        this.state = 'WAIT_DESTINATION';
        return text;
    }
    
    sendTripsWide (plans ) {
        this.log.debug('exec sendTrips');
        let templ = new fb.GenericTemplate();

        for (let plan of plans) {
            let i = plan.itinerary;
            let routerId = this.app.otp.routerId;
            let link = `${this.job.app.appRootUrl}/tripview?r=${routerId}&i=${plan.itineraryId}`;
            let imgLink = this.dateToClockUrl(i.startTime);
            this.log.debug(`trip link: ${link}`);
            let cfg = {
                title : `Departs ${this.abbrevStopName(i.from)} - ` +
                    this.displayDate(i.startTime),
                subtitle : `Arrives ${this.abbrevStopName(i.to)} - ` +
                    `${this.displayDate(i.endTime)}. Trip time is ` +
                    moment(i.endTime).diff(moment(i.startTime), 'minutes') + ' minutes',
                image_url : imgLink
            };

            cfg.buttons = [
                new fb.UrlButton({ title : 'View', url : link }),
                new fb.ShareButton()
            ];

            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }
        
        if (templ.elements.length < 1 ) {
            return this.send('Sorry, but I wasn\'t able to find any trips. Try starting over?');
        }

        return this.send(templ);
    }
    
    sendTrips (plans ) {
        this.log.debug('exec sendTrips');
        if (this.shouldSendTripsWide) {
            return this.sendTripsWide(plans);
        }
        let templ = new fb.ButtonTemplate('Departing at');

        for (let plan of plans) {
            let i = plan.itinerary;
            let routerId = this.app.otp.routerId;
            let link = `${this.job.app.appRootUrl}/tripview?r=${routerId}&i=${plan.itineraryId}`;
            let startTime = this.displayDate(i.startTime);
            let tripTime = moment(i.endTime).diff(moment(i.startTime), 'minutes') + ' minutes';
            let cfg = { title : `${startTime} - ${tripTime}`, url : link };

            this.log.info({trip: cfg}, 'SEND TRIP');
            templ.buttons.push(new fb.UrlButton(cfg));
        }
        
        if (templ.buttons.length < 1 ) {
            return this.send('Sorry, but I wasn\'t able to find any trips. Try starting over?');
        }
        
        return this.send(templ);
    }
    

    getTripParams() {
        return {
            fromPlace : this.request.data.originStop.id,
            toPlace: this.request.data.destinationStop.id,
            mode : 'TRANSIT',
            maxWalkDistance:804.672,
            locale:'en',
            numItineraries : this.numItineraries,
            showIntermediateStops: true
        };
    }
}

class ArrivingTripRequestHandler extends TripRequestHandler {
    static get handlerType() { return 'schedule_arriving'; }

    constructor(job) {
        super(job,ArrivingTripRequestHandler.handlerType);
    }
    
    getRequestOriginText() {
        let text = 'Coming from which station?';
        if (this.noob) {
            text += ' Type the name of the station, or hit Send Location and ' +
                'I\'ll try to find a station nearby.';
        }
        return text;
    }
    
    getRequestDestinationText() {
        let text = 'Arriving at which station?';
        if (this.noob) {
            text += ' Type the name of the station, or hit Send Location and ' +
                'I\'ll try to find a station nearby.';
        }
        this.state = 'WAIT_DESTINATION';
        return text;
    }
    
    evalState() {
        this.log.debug('exec evalState');
        let rqs = this.request;
        
        if (!rqs.data.destination) {
            // If they typed in an origin, lets make sure its valid before
            // we ask them for an destination.
            if ((rqs.data.origin) && (!rqs.data.originStop)){
                this.state = 'WAIT_ORIGIN';
                return this.getStationFromList(
                    this.request.data.origin, 'Select Origin');
            } 
            return this.requestDestination();
        }
        else
        if (!rqs.data.destinationStop) {
            this.state = 'WAIT_DESTINATION';
            return this.getStationFromList(this.request.data.destination, 'Select Destination');
        }
        else 
        if (!rqs.data.origin) {
            // If they typed in a destination, lets make sure its valid before
            // we ask them for an origin.
            if ((rqs.data.destination) && (!rqs.data.destinationStop)){
                this.state = 'WAIT_DESTINATION';
                return this.getStationFromList(
                    this.request.data.destination, 'Select Destination');
            } 
            return this.requestOrigin();
        }
        else
        if (!rqs.data.originStop) {
            this.state = 'WAIT_ORIGIN';
            return this.getStationFromList(this.request.data.origin, 'Select Origin');
        }
        else {
            this.state = 'READY';
            return this.work();
        }
    }

    
    sendTrips (plans ) {
        this.log.debug('exec sendTrips');
        if (this.shouldSendTripsWide) {
            return this.sendTripsWide(plans);
        }

        let templ = new fb.ButtonTemplate('Arriving in');
        let now = moment().tz(this.timezone);

        plans = (plans || []).sort((a,b) => ( a.itinerary.endTime > b.itinerary.endTime ));
        for (let plan of plans) {
            this.log.debug({ plan : plan}, 'HANDLE PLAN');
            let i = plan.itinerary;
            let endTime = this.displayDate(i.endTime);
            
            if (moment(i.endTime).tz(this.timezone).isBefore(now)) {
                this.log.debug(`trip has endTime (${endTime}) < now, skip`);
                continue;
            }
            
            let routerId = this.app.otp.routerId;
            let link = `${this.job.app.appRootUrl}/tripview?r=${routerId}&i=${plan.itineraryId}`;
            let arrivesIn = moment(i.endTime).tz(this.timezone).fromNow(true);
            
            let cfg = { title : `${arrivesIn} - ${endTime}`, url : link };

            this.log.info({trip: cfg}, 'SEND TRIP');
            templ.buttons.push(new fb.UrlButton(cfg));
        }

        if (templ.buttons.length < 1 ) {
            return this.send('Sorry, but I wasn\'t able to find any trips. Try starting over?');
        }
        
        return this.send(templ);
    }
    
    
    sendTripsWide (plans ) {
        this.log.debug('exec sendTripsWide');
        let templ = new fb.GenericTemplate();
        let now = moment().tz(this.timezone);

        plans = (plans || []).sort((a,b) => ( a.itinerary.endTime > b.itinerary.endTime ));
        for (let plan of plans) {
            let i = plan.itinerary;
            let endTime = this.displayDate(i.endTime);
            let imgLink = this.dateToClockUrl(i.endTime);

            if (moment(i.endTime).tz(this.timezone).isBefore(now)) {
                this.log.debug(`trip has endTime (${endTime}) < now, skip`);
                continue;
            }

            //let arrivesIn = moment(i.endTime).tz(this.timezone).fromNow(true);
            let routerId = this.app.otp.routerId;
            let link = `${this.job.app.appRootUrl}/tripview?r=${routerId}&i=${plan.itineraryId}`;
            let cfg = {
                title : `Arrives ${this.abbrevStopName(i.to)} - ${endTime}`,
                image_url : imgLink
//                title : `Scheduled to arrive in ${arrivesIn} (${this.displayDate(i.endTime)})`
            };

            cfg.buttons = [
                new fb.UrlButton({ title : 'View', url : link }),
                new fb.ShareButton()
            ];

            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }

        this.log.debug(`checking elements length: ${templ.elements.length}`);
        if (templ.elements.length < 1 ) {
            return this.send('Sorry, but I wasn\'t able to find any trips. Try starting over?');
        }
        
        return this.send(templ);
    }


    getTripParams() {
        let range = moment().tz(this.timezone).add(1,'hours');
        let params = {
            fromPlace : this.request.data.originStop.id,
            toPlace: this.request.data.destinationStop.id,
            mode : 'TRANSIT',
            maxWalkDistance:804.672,
            locale:'en',
            numItineraries : this.numItineraries,
            showIntermediateStops: true,
            arriveBy : true,
            date : range.format('MM-DD-YYYY'),
            time : range.format('HH:mm:00')
        };
        return params;
    }
}

class HandlerFactory {

    static CreateHandler(job, handlerType) {
        let user = { userId : job.user.userId};
        let profile = ld.get(job,'user.profile');
        if (profile) {
            user.name = `${profile.first_name} ${profile.last_name}`;
        }
        let handler, _log = log.child({ 
                module : 'HandlerFactory::CreateHandler',
                job : job,
                user : user
            });

        _log.debug(`Locating handler, handlerType=${handlerType}`);

        // If the handlerType was not passed in, first check for high priorit checks.
        if (!handlerType) {

            // User clicked on a menu item, that takes priority over current request
            if (ld.get(job,'payload.type') === 'MAIN-MENU') {
                handlerType = job.payload.item;
                job.payload = {};
            } else
            // User is trying to get the menu, that takes priority over current request
            if ((job.payloadType === 'text') && 
                    (ld.get(job,'payload.intent') === MenuRequestHandler.handlerType)) {
                handlerType = MenuRequestHandler.handlerType;
                job.payload = {};
            // If the user is already in the middle of a request, handle that
            } else {
                handlerType = ld.get(job,'user.data.currentRequest.type');
            }
        } 

        // If its not a menu request, menu response, or current request, 
        // figure out what it is
        if (!handlerType) {
            if (job.payloadType === 'text') {
                handlerType = ld.get(job,'payload.intent');

                // If we can't figure out what the request is, lets guess its
                // a trip request.
                if (!handlerType) {
                    if (job.payload.destination) {
                        job.payload.intent =
                            handlerType = DepartingTripRequestHandler.handlerType;
                    }
                    else
                    if (job.payload.origin) {
                        job.payload.intent =
                            handlerType = ArrivingTripRequestHandler.handlerType;
                    }
                }
            } else {
                // The request came from a postback, or quick-reply
                handlerType = ld.get(job,'payload.type');
            }
        }

        if (handlerType === MenuRequestHandler.handlerType) {
            _log.info('Create MenuRequestHandler..');
            handler = new MenuRequestHandler(job);
        } else
        if (handlerType === DepartingTripRequestHandler.handlerType) {
            _log.info('Create DepartingTripRequestHandler..');
            handler = new DepartingTripRequestHandler(job);
        } else
        if (handlerType === ArrivingTripRequestHandler.handlerType) {
            _log.info('Create ArrivingTripRequestHandler..');
            handler = new ArrivingTripRequestHandler(job);
        } else
        if (handlerType === WelcomeRequestHandler.handlerType) {
            _log.info('Create WelcomeRequestHandler..');
            handler = new WelcomeRequestHandler(job);
        } else 
        if (handlerType === HelpRequestHandler.handlerType) {
            _log.info('Create HelpRequestHandler..');
            handler = new HelpRequestHandler(job);
        } else 
        if (handlerType === FeedbackRequestHandler.handlerType) {
            _log.info('Create FeedbackRequestHandler..');
            handler = new FeedbackRequestHandler(job);
        } else {
            _log.info('Create UnknownRequestHandler..');
            handler = new UnknownRequestHandler(job);
        }

        return handler;
    }
    
    static get UnknownRequestHandlerType() { return UnknownRequestHandler.handlerType; }
    static get WelcomeRequestHandlerType() { return WelcomeRequestHandler.handlerType; }
    static get MenuRequestHandlerType() { return MenuRequestHandler.handlerType; }
    static get HelpRequestHandlerType() { return HelpRequestHandler.handlerType; }
    static get FeedbackRequestHandlerType() { return FeedbackRequestHandler.handlerType; }
    static get DepartingTripRequestHandlerType() { 
        return DepartingTripRequestHandler.handlerType; }
    static get ArrivingTripRequestHandlerType() { 
        return ArrivingTripRequestHandler.handlerType; }
}

exports.UnknownRequestHandler = UnknownRequestHandler;
exports.WelcomeRequestHandler = WelcomeRequestHandler;
exports.MenuRequestHandler = MenuRequestHandler;
exports.HelpRequestHandler = HelpRequestHandler;
exports.FeedbackRequestHandler = FeedbackRequestHandler;
exports.DepartingTripRequestHandler = DepartingTripRequestHandler;
exports.ArrivingTripRequestHandler = ArrivingTripRequestHandler;
exports.HandlerFactory = HandlerFactory;
