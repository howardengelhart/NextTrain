'use strict';

const log = require('./log');
const User = require('./User');
const Wit = require('./Wit');
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
        this.request = ld.get(this,'job.user.data.currentRequest', {});
    }

    requestOrigin() {
        let user = this.job.user;
        let token = this.job.token;
        let fbMessage = this.job.fbMessage;
        let text = new fb.Text('I need to know where this trip starts.  ' +
            'Send me the name of the station, or hit Send Location and I\'ll ' +
            'try to find one nearby.');
        text.quick_replies.push(new fb.LocationQuickReply() );

        return fbMessage.send(user.userId,text, token);
    }

    work() {
        if (!this.request.origin) {
            return this.requestOrigin(); 
        }
    }


}

function handleText(job) {
    let wit = job.wit;
    let msg = job.msg;
    let user = job.user;

    return wit.message(msg.message.text)
    .then(res => {
        log.info({ witResponse : res },'Handling wit response.');
        let rqs = {};
        rqs.intent = ld.get(res,'entities.intent[0].value');
        rqs.origin = ld.get(res,'entities.origin[0].value');
        rqs.destination = ld.get(res,'entities.destination[0].value');

        if (rqs.intent !== 'schedule_departing') {
            return job.fbMessage.send(user.userId,'Sorry, didn\'t quite get that.',job.token);
        }
        user.data.currentRequest = rqs;

        let rqsHandler = new DepartingTripRequestHandler(job);
        return rqsHandler.work();
    })
    .then(res => {
        job.result = res;
        return job;
    });
}

function handlePostback(job) {
    return job.fbMessage.send(job.msg.sender.id, 'Got your postback.', job.token)
    .then(res => {
        job.result = res;
        return job;
    });
}

module.exports = (app, messages, users ) => {
    let fbMessage = new fb.Message();
    let wit = new Wit(app.wit);
    let tokens  = {};

    app.facebook.pages.forEach((page) => {
        tokens[page.id] = page.token;
    });

    log.trace({'tokens' : tokens });
    log.trace({'users' : users });

    return Promise.all((messages || []).map( (msg) => {
        log.info({ message : msg }, 'Dispatching message.' );
        let job = {
            msg   : msg,
            token : tokens[msg.recipient.id],
            user  : users[msg.sender.id],
            fbMessage : fbMessage
        };
        let handler;

        if (!job.user) {
            job.user = new User({ appId : app.appId, userId : msg.sender.id });
        }

        if (msg.message.attachments) {
            if (msg.message.attachments[0].type === 'location') {
                job.payload = msg.message.attachments[0].payload;
                handler = handlePostback;
            } else {
                handler = handleAttachment;
            }
        } else
        if (msg.message.postback) {
            handler = handlePostback;
            job.payload = msg.message.postback.payload;
        } else 
        if (msg.message.quick_reply) {
            handler = handlePostback;
            job.payload = msg.message.quick_reply.payload;
        } else
        if (msg.message.text) {
            job.wit = wit;
            handler = handleText;
        } else {
            log.warn({ message : msg }, 'No handler for message.');
            handler = Promise.resolve; 
        }

        return handler(job);
    }))
    .then( (jobs) => {
        return jobs.map(job => job.user);
    });
};
