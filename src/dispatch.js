'use strict';

const log = require('./log');
const User = require('./User');
const Wit = require('./Wit');
const OTPlanner = require('./OTPlanner');
const fb = require('thefacebook');
const ld = require('lodash');

function handleAttachment(job) {
    let type = job.msg.message.attachments[0].type;
    let response = '';
    if (type === 'image') {
        response = 'What a lovely picture, thanks.';
    } else
    if (type === 'video') {
        response = 'Thanks, I\'ll watch this when I get home.'; 
    } else
    if (type === 'audio') {
        response = 'Sounds interesting.';
    } else {
        response = 'I\'ll send this to my attorney.';
    }
    
    return job.fbMessage.send(job.msg.sender.id,response,job.token)
    .then((result) => {
        job.result = result;
        return job;
    });
}

class DepartingTripRequestHandler {
    constructor(job) {
        this.job = job;
    }

    requestOrigin() {
        log.info('exec requestOrigin');
        let user = this.job.user;
        let token = this.job.token;
        let fbMessage = this.job.fbMessage;
        let text = new fb.Text('I need to know where this trip starts.  ' +
            'Send me the name of the station, or hit Send Location and I\'ll ' +
            'try to find one nearby.');
        text.quick_replies.push(new fb.LocationQuickReply() );

        user.data.currentRequest.state = 'WAIT_ORIGIN';
        return fbMessage.send(user.userId,text, token);
    }

    evalRequest() {
        log.info('exec evalRequest');
        let rqs = ld.get(this,'job.user.data.currentRequest');
        if (!rqs.data.origin) {
            return this.requestOrigin();
        }

        //if (!rqs.data.originId) {
        //    return this.requestOriginId();
        //}

        //if (!rqs.data.destination) {
        //    return this.requestOrigin();
        //}

        //if (!rqs.data.destinationId) {
        //    return this.requestDestinationId();
        //}

        rqs.state = 'READY';
        return this.work();
    }

    onNew() {
        log.info('exec onNew');
        let rqs = { type : 'schedule_departing', state : 'NEW' };
        rqs.data = this.job.payload;
        this.job.user.data.currentRequest = rqs;
        return this.evalRequest();
    }

    requestStationSelection(stations) {
        log.info('exec requestStationSelection');
        let user = this.job.user;
        let token = this.job.token;
        let fbMessage = this.job.fbMessage;
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

        return fbMessage.send(user.userId,templ,token);
    }

    getStationFromLocation(coordinates) {
        let otp = this.job.otp;
        let otpParams = {
            lat : coordinates.lat,
            lon : coordinates.long,
            radius : 10000
        };
        
        return otp.findStops(otpParams)
        .then((results) => {
            log.info({ results : results }, 'OTP found stops');
            return this.requestStationSelection(results);
        });
    }

    onWaitOrigin() {
        if (this.job.type === 'location') {
            return this.getStationFromLocation(this.job.payload.coordinates);
        } else
        if (this.job.type === 'text') {
            return this.getStationFromList();
        }
        else return Promise.resolve(this.job);
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

class UnknownRequestHandler {
    constructor(job) {
        this.job = job;
    }

    work() {
        let fbMessage = this.job.fbMessage;
        let user = this.job.user;
        let token = this.job.token;
        return fbMessage.send(user.userId,'Sorry, didn\'t quite get that.',token);
    }
}

//function handleText(job) {
//    let wit = job.wit;
//    let msg = job.msg;
//    let user = job.user;
//
//    return wit.message(msg.message.text)
//    .then(res => {
//        let rqs = {}, rqsHandler;
//        log.info({ witResponse : res },'Handling wit response.');
//        rqs.type = ld.get(res,'entities.intent[0].value');
//
//        if (rqs.type === 'schedule_departing') {
//            rqs.origin = ld.get(res,'entities.origin[0].value');
//            rqs.destination = ld.get(res,'entities.destination[0].value');
//            user.data.currentRequest = rqs;
//            rqsHandler = new DepartingTripRequestHandler(job);
//        } else {
//            rqsHandler = new UnknownRequestHandler(job);
//        }
//
//        return rqsHandler.work();
//    })
//    .then(res => {
//        job.result = res;
//        return job;
//    });
//}

function textPreprocessor(wit,msg) {
    return wit.message(msg.message.text)
    .then(res => {
        log.info({ witResponse : res },'Handling wit response.');
        let payload = {};
        for (let ent in res.entities) {
            payload[ent] = ld.get(res,`entities.${ent}[0].value`);
        }

        return { type : 'text', msg : msg, payload : payload };
    });
}

function dataPreprocessor(msg) {
    let payload, type = 'unknown';

    if (msg.message.attachments) {
        if (msg.message.attachments[0].type === 'location') {
            type = 'location';
        } else {
            type = 'attachment';
        }
        payload = msg.message.attachments[0].payload;
    } else
    if (msg.message.postback) {
        type = 'postback';
        payload = msg.message.postback.payload;
    } else 
    if (msg.message.quick_reply) {
        type = 'postback';
        payload = msg.message.quick_reply.payload;
    } 

    return Promise.resolve({ type : type, msg : msg, payload : payload });
}

module.exports = (app, messages, users ) => {
    let fbMessage = new fb.Message();
    let wit = new Wit(app.wit);
    let otp = new OTPlanner(app.otp);
    let tokens  = {};

    app.facebook.pages.forEach((page) => {
        tokens[page.id] = page.token;
    });

    log.trace({'tokens' : tokens });
    log.trace({'users' : users });

    return Promise.all((messages || []).map( (msg) => {
        log.info({ message : msg }, 'Dispatching message.' );
        let preProcessor;

        if (msg.message.text) {
            preProcessor = textPreprocessor.bind({}, wit);
        } else {
            preProcessor = dataPreprocessor;
        }

        return preProcessor(msg)
        .then( (job) => {
            job.token = tokens[msg.recipient.id];
            job.user = users[msg.sender.id];
            job.fbMessage = fbMessage;
            job.otp = otp;

            let handler, handlerType;

            if (!job.user) {
                job.user = new User({ appId : app.appId, userId : msg.sender.id });
            }

            log.info({ job : job }, 'Handle job.' );

            handlerType = ld.get(job,'payload.intent',
                ld.get(job,'user.data.currentRequest.type'));

            if (handlerType === 'schedule_departing') {
                log.info('Create DepartingTripRequestHandler..');
                handler = new DepartingTripRequestHandler(job);
            } else {
                log.info('Create UnknownRequestHandler..');
                handler = new UnknownRequestHandler(job);
            }

            log.info('Call handler.work()');
            return handler.work();

            //if (msg.message.attachments) {
            //    if (msg.message.attachments[0].type === 'location') {
            //        job.payload = msg.message.attachments[0].payload;
            //        handler = handlePostback;
            //    } else {
            //        handler = handleAttachment;
            //    }
            //} else
            //if (msg.message.postback) {
            //    handler = handlePostback;
            //    job.payload = msg.message.postback.payload;
            //} else 
            //if (msg.message.quick_reply) {
            //    handler = handlePostback;
            //    job.payload = msg.message.quick_reply.payload;
            //} else
            //if (msg.message.text) {
            //    job.wit = wit;
            //    handler = handleText;
            //} else {
            //    log.warn({ message : msg }, 'No handler for message.');
            //    handler = Promise.resolve; 
            //}

            //return handler(job);
        });
    }))
    .then( (jobs) => {
        return jobs.map(job => job.user);
    });
};
