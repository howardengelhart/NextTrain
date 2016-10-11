'use strict';

const log = require('./log');
const User = require('./User');
const Wit = require('./Wit');
const tripHandlers = require('./DepartingTripRequestHandler') ;
const DepartingTripRequestHandler = tripHandlers.DepartingTripRequestHandler;
const ArrivingTripRequestHandler = tripHandlers.ArrivingTripRequestHandler;
const fb = require('thefacebook');
const ld = require('lodash');

//function handleAttachment(job) {
//    let type = job.msg.message.attachments[0].type;
//    let response = '';
//    if (type === 'image') {
//        response = 'What a lovely picture, thanks.';
//    } else
//    if (type === 'video') {
//        response = 'Thanks, I\'ll watch this when I get home.'; 
//    } else
//    if (type === 'audio') {
//        response = 'Sounds interesting.';
//    } else {
//        response = 'I\'ll send this to my attorney.';
//    }
//    
//    return job.fbMessage.send(job.msg.sender.id,response,job.token)
//    .then((result) => {
//        job.result = result;
//        return job;
//    });
//}

class UnknownRequestHandler {
    constructor(job) {
        this.job = job;
    }
    
    work() {
        let message = new fb.Message();
        let user = this.job.user;
        let token = this.job.token;
        return message.send(user.userId,'Sorry, didn\'t quite get that.',token)
            .then(() => this.job);
    }
}

function textPreprocessor(wit,msg) {
    return wit.message(msg.message.text)
    .then(res => {
        log.info({ witResponse : res },'Handling wit response.');
        let payload = {};
        for (let ent in res.entities) {
            payload[ent] = ld.get(res,`entities.${ent}[0].value`);
        }

        return { payloadType : 'text', msg : msg, payload : payload };
    });
}

function dataPreprocessor(msg) {
    return new Promise((resolve) => {
        let payload, type = 'unknown';

        if (msg.postback) {
            type = 'postback';
            payload = msg.postback.payload;
        } else 
        if (msg.message) {
            if (msg.message.quick_reply) {
                type = 'postback';
                payload = msg.message.quick_reply.payload;
            }
            else
            if (msg.message.attachments) {
                if (msg.message.attachments[0].type === 'location') {
                    type = 'location';
                } else {
                    type = 'attachment';
                }
                payload = msg.message.attachments[0].payload;
            } 
        }

        if (type === 'postback') {
            payload = JSON.parse(payload);
        }

        log.debug('resolving prprocessor');
        return resolve({ payloadType : type, msg : msg, payload : payload });
    });
}

module.exports = (app, messages, users ) => {
    let wit = new Wit(app.wit);
    let tokens  = {};

    app.facebook.pages.forEach((page) => {
        tokens[page.id] = page.token;
    });

    log.trace({'tokens' : tokens });
    log.trace({'users' : users });

    return Promise.all((messages || []).map( (msg) => {
        log.debug({ message : msg }, 'Dispatching message.' );
        let preProcessor;

        if (msg.message && msg.message.text && (!msg.message.quick_reply)) {
            preProcessor = textPreprocessor.bind({}, wit);
        } else {
            preProcessor = dataPreprocessor;
        }

        log.debug('calling preprocessor...');
        return preProcessor(msg)
        .then( (job) => {
            job.app = app;
            job.token = tokens[msg.recipient.id];
            job.user = users[msg.sender.id];

            let handler, handlerType;

            if (!job.user) {
                job.user = new User({ appId : app.appId, userId : msg.sender.id });
            }

            log.info({ job : job }, 'Handle job.' );
            
            handlerType = ld.get(job,'user.data.currentRequest.type');

            if (!handlerType) {
                handlerType = ld.get(job,'payload.intent');

                if (!handlerType) {
                    if (job.payload.destination) {
                        job.payload.intent = handlerType = 'schedule_departing';
                    }
                    else
                    if (job.payload.origin) {
                        job.payload.intent = handlerType = 'schedule_arriving';
                    }
                }
            }

            if (handlerType === 'schedule_departing') {
                log.info('Create DepartingTripRequestHandler..');
                handler = new DepartingTripRequestHandler(job);
            } else
            if (handlerType === 'schedule_arriving') {
                log.info('Create ArrivingTripRequestHandler..');
                handler = new ArrivingTripRequestHandler(job);
            } else {
                log.info('Create UnknownRequestHandler..');
                handler = new UnknownRequestHandler(job);
            }

            log.debug('Call handler.work()');
            return handler.work()
                .then(() => {
                    if (ld.get(job,'user.data.currentRequest.state') === 'DONE') {
                        log.info('currentRequest is DONE, reset user for next request.');
                        delete job.user.data.currentRequest;
                    }
                    return job;
                });
        });
    }))
    .then( (jobs) => {
        return jobs.map(job => job.user);
    })
    .catch( (err) => {
        log.error({error : err.message }, 'DISPATCH ERROR');
    });
};
