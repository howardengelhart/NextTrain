'use strict';

const log = require('./log');
const Message = require('thefacebook').Message;

module.exports = (app, messages ) => {
    let message = new Message();
    let tokenMap = {};
    
    app.facebook.pages.forEach((page) => {
        tokenMap[page.id] = page.token;
    });

    log.info('tokenMap:',tokenMap);
    return Promise.all((messages || []).map( (msg) => {
        log.info('dispatching: ', msg);
        let token = tokenMap[msg.recipient.id];
        message.send(msg.sender.id,'Your message has been received.',token);
    }));
};
