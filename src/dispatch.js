'use strict';

const log = require('./log');
const User = require('./User');
const Wit = require('./Wit');
const tripHandlers = require('./triphandlers') ;
const DepartingTripRequestHandler = tripHandlers.DepartingTripRequestHandler;
const ArrivingTripRequestHandler = tripHandlers.ArrivingTripRequestHandler;
const fb = require('thefacebook');
const ld = require('lodash');

const wait = (timeout) => ( new Promise( (resolve) => setTimeout(resolve,timeout)) );

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
            .then(() => { this.job.done = true; return this.job; });
    }
}


class HelpMenu {
    constructor() {
        let menuItem = (t,i) => (new fb.PostbackButton({ 
            title : t, payload : JSON.stringify({ type : 'MAIN-MENU', item : i })
        }));
        this.templ = new fb.ButtonTemplate('Let me find you..', [
            menuItem('Departing trains', 'schedule_departing'),
            menuItem('Arriving trains', 'schedule_arriving'),
            new fb.PostbackButton({
                title : 'Help', 
                payload : JSON.stringify({ type : 'welcome', index : 2 })
            })
        ]);
        this.message = new fb.Message();
    }

    send(userId, token) {
        return this.message.send(userId,this.templ,token); 
    }
}

class MenuRequestHandler {
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

    work() {
        return (new HelpMenu()).send(this.job.user.userId, this.job.token)
            .then(() => { this.job.done = true; return this.job; });
    }
}

class WelcomeRequestHandler {
    constructor(job) {
        this.job = job;
        this.speech = [
            'Hi there! I am here to help you find a train...' ,
            '...in New Jersey.',
            'You can send me questions like..' +
            '"When does the next train leave Hamilton for New York?", or simply ' +
                '"When is the next train to New York?".',
            'You can also ask about arriving trains.. "When does the next train from ' +
                'Hoboken arrive?"',
            'You can get to my Quick Start menu and help any time by typing "menu", or ' +
            'clicking the menu button on the bottom left corner of Messenger.'
        ];
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

    work() {
        let index = ld.get(this,'job.payload.index',0);
        let line = this.speech[index++];
         
        if (!line) {
            return Promise.resolve({});
        }

        let endIndex = ld.get(this,'job.payload.endIndex',this.speech.length);
        let text = new fb.Text(line);
        if (index < endIndex) {
            text.quick_replies.push(new fb.TextQuickReply( { 
                title : 'Continue',
                payload : JSON.stringify({
                    type : 'welcome', index : index, endIndex : endIndex 
                })
            }));
        } else {
            this.job.done = true;
        }
        return this.send(text);
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
    let action = new fb.SenderAction();

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
        return action.send(msg.sender.id,'typing_on',tokens[msg.recipient.id])
        .then(() => preProcessor(msg))
        .then((job) => {
            job.app = app;
            job.token = tokens[msg.recipient.id];
            job.user = users[msg.sender.id];

            let handler, handlerType;

            if (!job.user) {
                job.user = new User({ appId : app.appId, userId : msg.sender.id });
            }

            log.info({ job : job }, 'Handle job.' );

            if (ld.get(job,'payload.type') === 'MAIN-MENU') {
                handlerType = job.payload.item;
                job.payload = {};
            } else
            if ((job.payloadType === 'text') && 
                    (ld.get(job,'payload.intent') === 'display_menu')) {
                handlerType = 'display_menu';
                job.payload = {};
            } else {
                handlerType = ld.get(job,'user.data.currentRequest.type');
            }
            
            if (!handlerType) {
                if (job.payloadType === 'text') {
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
                } else {
                    handlerType = ld.get(job,'payload.type');
                }
            }

            if (handlerType === 'display_menu') {
                log.info('Create MenuRequestHandler..');
                handler = new MenuRequestHandler(job);
            } else
            if (handlerType === 'schedule_departing') {
                log.info('Create DepartingTripRequestHandler..');
                handler = new DepartingTripRequestHandler(job);
            } else
            if (handlerType === 'schedule_arriving') {
                log.info('Create ArrivingTripRequestHandler..');
                handler = new ArrivingTripRequestHandler(job);
            } else
            if (handlerType === 'welcome') {
                log.info('Create WelcomeRequestHandler..');
                handler = new WelcomeRequestHandler(job);
            } else {
                log.info('Create UnknownRequestHandler..');
                handler = new UnknownRequestHandler(job);
            }

            log.debug('Call handler.work()');
            return handler.work()
                .then(() => {
                    if (job.done && (handler.constructor.name !== 'MenuRequestHandler')) {
                        log.info('currentRequest is DONE, reset user for next request.');
                        delete job.user.data.currentRequest;
                        return action.send(job.user.userId,'typing_on',job.token)
                            .then(() => wait(1500))
                            .then(() => ((new MenuRequestHandler(job)).work()) )
                            .then(() => job);
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
