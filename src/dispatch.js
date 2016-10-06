'use strict';

const log = require('./log');
const User = require('./User');
const Message = require('thefacebook').Message;
const Wit = require('./Wit');

module.exports = (app, messages, userMap ) => {
    let message = new Message();
    let tokenMap = {};
    let userUpdates = [];
    let wit = new Wit(app.wit);

    app.facebook.pages.forEach((page) => {
        tokenMap[page.id] = page.token;
    });

    log.info({ 'tokenMap' : tokenMap, 'userMap' : userMap });
    return Promise.all((messages || []).map( (msg) => {
        log.info('dispatching: ', msg);
        let token = tokenMap[msg.recipient.id];
        let user  = userMap[msg.sender.id];

        if (!user) {
            user = new User({ appId : app.appId, userId : msg.sender.id });
        }
       
        userUpdates.push(user);

        if (msg.message.attachments) {
            return message.send(msg.sender.id,'Send me no attachments.',token);
        }

        return wit.message(msg.message.text)
        .then(res => {
            log.info({ witResponse : res },'Handling wit response.');
            let resp = [];
            if (Array.isArray(res.entities.intent)) {
                if (res.entities.intent[0].value === 'train_schedule') {
                    resp.push ('You are looking for a train');
                }
            }
            
            if (Array.isArray(res.entities.origin)) {
                if (res.entities.origin[0].value) {
                    resp.push('from ' + res.entities.origin[0].value);
                }
            }
            
            if (Array.isArray(res.entities.destination)) {
                if (res.entities.destination[0].value) {
                    resp.push('to ' + res.entities.destination[0].value);
                }
            }

            if (!resp.length){
                resp.push('Sorry, I do not understand');
            }

            return message.send(msg.sender.id,resp.join(' ') + '.',token);
        });
    }))
    .then( () => {
        return userUpdates.length ? userUpdates : undefined;
    });
};
