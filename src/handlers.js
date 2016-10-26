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
const wait = (timeout) => ( new Promise( (resolve) => setTimeout(resolve,timeout)) );

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
        delete job.user.data.currentRequest;
    }
    
    menuItem (t,i) {
        return new fb.PostbackButton({ 
            title : t, payload : JSON.stringify({ handlerType : i })
        });
    }

    work() {
        let s3Bucket = `https://s3.amazonaws.com/${this.job.app.appId}/img/buttons`;
        let templ = new fb.GenericTemplate();

        templ.elements.push(new fb.GenericTemplateElement({
            title : 'Find Trains',
            image_url : `${s3Bucket}/menu_trains.png`,
            buttons : [ 
                this.menuItem('Arriving', ArrivingTripRequestHandler.handlerType),
                this.menuItem('Departing', DepartingTripRequestHandler.handlerType)
                //new fb.UrlButton({
                //    title : 'Stations List',
                //    url : `${this.job.app.appRootUrl}/stopview?r=${this.app.otp.routerId}`,
                //    webview_height_ratio : 'tall'
                //})
            ]
        }));
        
        templ.elements.push(new fb.GenericTemplateElement({
            title : 'Help & Feedback',
            image_url : `${s3Bucket}/menu_help.png`,
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
                    handlerType : this.type, index : index, endIndex : endIndex 
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
        delete job.user.data.currentRequest;
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

        delete job.user.data.currentRequest;
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
        this.noob = (ld.get(this,'user.data.tripHistory.length',0) <= 3);
    }

    get otp() {
        if (!this._otp) {
            this.log.debug({otpConfig : this.app.otp}, 'Creating OTPPlanner');
            this._otp = new OTPlanner(this.app.otp);
        }
        return this._otp;
    }
    
    get numItineraries() {
        return ld.get(this,'app.stageVars.numItineraries',3);
    }

    get request() {
        return ld.get(this,'user.data.currentRequest');
    }

    set fails(fails) {
        ld.get(this,'user.data.currentRequest').fails = fails;
    }
    
    get fails() {
        return ld.get(this,'user.data.currentRequest.fails',0);
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
                        payload: JSON.stringify({ 
                            handlerType : this.type,
                            type: 'stop', 
                            stop: stop 
                        })
                    }));
                }
            }
        }

        return this.send(text);
    }
    
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
    
    requestStationSelection(stations) {
        this.log.debug({ stops : stations}, 'exec requestStationSelection');
        let templ = new fb.GenericTemplate();
        let stopType = this.state === 'WAIT_ORIGIN' ? 'Departing' : 'Arriving';
        let action = stations.length > 1 ? 'Select' : 'Confirm';
        
        for (let station of stations) {
            let s3Bucket = `https://s3.amazonaws.com/${this.job.app.appId}`;
            let routerId = this.app.otp.routerId;
            let mapUrl = `https://www.google.com/maps?q=${station.lat}%2C${station.lon}`;
            let imgUrl = `${s3Bucket}/img/${routerId}/${encodeURIComponent(station.id)}.png`;
            let stopName = this.abbrevStopName(station.name);

            let payload = {
                handlerType : this.type,
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

        return this.send(templ)
        .then(() => {
            let phrase = stations.length > 1 ? 'Select your station from the list above' : 
                'Confirm the station above';
            let text = new fb.Text(
                `${phrase} or find another ${stopType} Station.`
            );
            text.quick_replies.push(new fb.LocationQuickReply() );
            return this.send(text);
        });
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
                return this.stationLookupFailure(
                    'No local stations found, try typing one in.'
                );
            }

            this.log.debug({ results : results }, 'OTP found stops');
            return this.requestStationSelection(results );
        })
        .catch((err) => {
            this.log.error('Error: %s', err.message);
            return this.stationLookupFailure(
                'No local stations found, try typing one in.'
            );
        });
    }
    
    findAlias(a) {
        let aliases = this.app.aliases;
        for (let stop in aliases) {
            for (let alias of aliases[stop]) {
                let re = new RegExp(alias,'i');
                if (a.match(re)) {
                    this.log.debug(`findAlias found ${stop} for alias ${a}.`);
                    return stop;
                }
            }
        }
        return a;
    }

    getStationFromList(stationName ) {
        this.log.debug('exec getStationFromList');
        stationName = this.findAlias(stationName);
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
                return this.stationLookupFailure(
                    'Sorry, I couldn\'t find any Stations, try a different spelling?'
                );
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
        });
    }

    stationLookupFailure(txt) {
        this.fails += 1;
        if (this.fails >= 2) {
            this.fails = 0;
            return this.sendEnterStationHelp();
        }
        return this.send(txt); 
    }

    stationFound() {
        this.fails = 0;
    }

    work() {
        let state = ld.get(this, 'job.user.data.currentRequest.state','NEW');
        let doWork = () => {
            let wantsHelp = this.payload.wantsHelp;
            this.log.info(`doWork for state ${state} helpRequired ${wantsHelp}`);
            if (wantsHelp) {
                return this.sendHelp();
            }
            else
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

    sendEnterStationHelp() {
        let l = `https://cdn.mechinate.com/${this.app.appId}/stops/${this.app.otp.routerId}`;
        let templ = new fb.ButtonTemplate('Need help finding a station?', [
            new fb.UrlButton({
                title : 'List all Stations',
                url : l,
                //url : `${this.job.app.appRootUrl}/stopview?r=${this.app.otp.routerId}`,
                webview_height_ratio : 'tall'
            })
        ]);
        return this.send(templ).then(() => wait(500))
            .then(() => {
                let text = new fb.Text([
                    'You can also try to enter part of the Station name, or use the ' +
                    'Send Location button to find a Station near your current location ' +
                    'or another point on the map.'
                ].join(''));
                text.quick_replies.push(new fb.LocationQuickReply() );
                return this.send(text);
            });
    }

    sendHelp() {
        let text;
        if (this.state === 'WAIT_DESTINATION') {
            text = new fb.Text([
                'We need to find the station that will be the ultimate destination.  ',
                'If you click the Location button you can send your current location ',
                'and I will look for any stations within a few miles.  You can also ',
                'use the map to search for the station or other locations you know are ',
                'close to it.'
            ].join(''));
        }
        else
        if (this.state === 'WAIT_ORIGIN') {
            text = new fb.Text([
                'We need to find the station where the trip will be starting.  ',
                'If you click the Location button you can send your current location ',
                'and I will look for any stations within a few miles.  You can also ',
                'use the map to search for the station or other locations you know are ',
                'close to it.'
            ].join(''));
        }

        text.quick_replies.push(new fb.LocationQuickReply() );
        text.quick_replies.push(new fb.TextQuickReply( { 
            title : 'Back to Menu', 
            payload : JSON.stringify({ handlerType : MenuRequestHandler.handlerType})
        }));
        text.quick_replies.push(new fb.TextQuickReply( { 
            title : 'More Help', 
            payload : JSON.stringify({ handlerType : HelpRequestHandler.handlerType})
        }));

        return this.send(text);
    }

    onNew() {
        this.log.debug('exec onNew');
        let rqs = { type : this.type, state : 'NEW' };
        rqs.data = this.payload;
        this.user.data.currentRequest = rqs;
        return this.evalState();
    }
    
    onWaitOrigin() {
        this.log.debug({
            payloadType : this.job.payloadType, 
            payload : this.job.payload
        }, 'exec onWaitOrigin');
        if (this.job.payloadType === 'location') {
            return this.getStationFromLocation(this.payload.coordinates);
        } else
        if (this.job.payloadType === 'text') {
            this.request.data.origin = this.job.msg.message.text;
            return this.getStationFromList(this.request.data.origin);
        } else 
        if (this.job.payloadType === 'postback') {
            if (this.payload.type === 'stop') {
                this.stationFound();
                this.request.data.originStop = this.payload.stop;
                if (!this.request.data.origin) {
                    this.request.data.origin = this.payload.stop.name;
                }
            }
            if (this.noob) {
                return this.send(`Okay, departing ${this.payload.stop.name}.`)
                    .then(() => this.evalState());
            }
            return this.evalState();
        }
        
        return Promise.resolve(this.job);
    }

    onWaitDestination() {
        this.log.debug({
            payloadType : this.job.payloadType, 
            payload : this.job.payload
        }, 'exec onWaitDestination');
        if (this.job.payloadType === 'location') {
            return this.getStationFromLocation(this.payload.coordinates);
        } else
        if (this.job.payloadType === 'text') {
            this.request.data.destination = this.job.msg.message.text;
            return this.getStationFromList(this.request.data.destination);
        } else 
        if (this.job.payloadType === 'postback') {
            if (this.payload.type === 'stop') {
                this.stationFound();
                this.request.data.destinationStop = this.payload.stop;
                if (!this.request.data.destination) {
                    this.request.data.destination = this.payload.stop.name;
                }
            }
            if (this.noob) {
                return this.send(`Okay, arriving at ${this.payload.stop.name}.`)
                    .then(() => this.evalState());
            }
            
            return this.evalState();
        }
        
        return Promise.resolve(this.job);
    }
    
    onReady() {
        if (this.request.data.originStop.id === this.request.data.destinationStop.id ) {
            return this.send(
                'FDR once said "There are many ways of going forward, ' +
                'but only one way of standing still."'
            )
            .then(() => {
                let org = this.request.data.origin;
                let dst = this.request.data.destination;
                return this.send(`"${org}" and "${dst}" appear to be one in the same.`);
            })
            .then(() => this.finishRequest('Try again?') );
        }

        let otp = this.otp;
        let params = this.getTripParams();
        let bucket = this.app.S3Bucket;
        let key = `${this.app.appId}/itineraries/${this.app.otp.routerId}`;

        this.log.debug({ otpParams : params }, 'calling findPlans');
        return otp.findPlans(params)
        .then(plans => {
            if (ld.get(plans,'plan.itineraries') === undefined) {
                let response = 'Unable to locate any trips at this time.';
                if (plans.error) {
                    this.log.error(plans.error, 'findPlans error response');
                    if (plans.error.msg) {
                        response = plans.error.msg;
                    }
                }
                return this.send(response)
                    .then(() => this.finishRequest('Try again?') );
            }
            return compressAndStorePlan(bucket, key, this.app, plans) 
                .then(compressedPlans => this.sendTrips(compressedPlans) )
                .then(() => this.finishRequest() );
        });
    }

    finishRequest(prompt) {
        this.job.done = true;
        this.state = 'DONE';
        let history = this.user.data.tripHistory || [];
        history.unshift(this.request);
        while (history.length > 5) {
            history.pop();
        }
        this.user.data.tripHistory = history;
        delete this.user.data.currentRequest;

        let text = new fb.Text(prompt || 'Anything else?');
        text.quick_replies.push(new fb.TextQuickReply( { 
            title : 'Arriving',
            payload : JSON.stringify({ handlerType : ArrivingTripRequestHandler.handlerType})
        }));
        text.quick_replies.push(new fb.TextQuickReply( { 
            title : 'Departing',
            payload : JSON.stringify({ handlerType : DepartingTripRequestHandler.handlerType})
        }));
        text.quick_replies.push(new fb.TextQuickReply( { 
            title : 'Menu', 
            payload : JSON.stringify({ handlerType : MenuRequestHandler.handlerType})
        }));
        return this.send(text);
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
    
    sendTrips(plans ) {
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
                new fb.UrlButton({ 
                    title : 'Details', 
                    url : link ,
                    webview_height_ratio : 'tall'
                }),
                new fb.ShareButton()
            ];

            templ.elements.push(new fb.GenericTemplateElement(cfg));
        }
        
        if (templ.elements.length < 1 ) {
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

    
    sendTrips(plans ) {
        this.log.debug('exec sendTrips');
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
                new fb.UrlButton({ 
                    title : 'Details', 
                    url : link ,
                    webview_height_ratio : 'tall'
                }),
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

        let currentHandlerType = ld.get(job,'user.data.currentRequest.type');

        _log.debug(`Locating handler, handlerType=${handlerType}`);

        // If the handlerType was not passed in..
        if (!handlerType) {

            if (job.payloadType === 'text') {
                // If it was text, we look to see if we found the intent.
                
                let intent = ld.get(job,'payload.intent');
                let confidence = ld.get(job,'witResponse.entities.intent[0].confidence',0);
                let minConfidence = ld.get(job,'app.minConfidence',0.9);
                log.debug(`Confidence in intent (${intent}) is at ${confidence}.`);
                if (confidence < minConfidence) {
                    log.info(`Confidence (${confidence}) in intent (${intent}) is below ` +
                        `${minConfidence}. Disregarding intent.`);
                    intent = undefined;
                }

                if (intent === undefined) {
                    // It was text not recongized as a command, if we have a current request
                    // its likely a stop name, so we will continue with existing handler
                    handlerType = currentHandlerType;
                } else 

                if (intent === HelpRequestHandler.handlerType) {
                    // If it was a cry for help and user is currently in a trip handler
                    // we'll try to give context specific help, otherwise general help.
                    if ((currentHandlerType === DepartingTripRequestHandler.handlerType) || 
                        (currentHandlerType === ArrivingTripRequestHandler.handlerType) ) {
                        handlerType = currentHandlerType;
                        job.payload = { wantsHelp : true };
                    } else  {
                        handlerType = HelpRequestHandler.handlerType;
                        delete job.user.data.currentRequest;
                    }
                } else {
                    // It was a new command, so we will reset the user and assign this handler
                    delete job.user.data.currentRequest;
                    handlerType = intent;
                }
            } else {
                // User clicked on a menu item or quick reply button
                if (ld.get(job,'payload.type') === WelcomeRequestHandler.handlerType) {
                    handlerType = WelcomeRequestHandler.handlerType; // remove update started
                }
                else if (ld.get(job,'payload.type') === MenuRequestHandler.handlerType) {
                    handlerType = MenuRequestHandler.handlerType; // remove update menu
                } else {
                    handlerType = ld.get(job,'payload.handlerType',currentHandlerType);
                }
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
