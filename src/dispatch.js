'use strict';

const log = require('./log');
const Message = require('thefacebook').Message;

module.exports = (app, messages, userMap ) => {
    let message = new Message();
    let tokenMap = {};
    let userUpdates = [];

    app.facebook.pages.forEach((page) => {
        tokenMap[page.id] = page.token;
    });

    log.info({ 'tokenMap' : tokenMap, 'userMap' : userMap });
    return Promise.all((messages || []).map( (msg) => {
        log.info('dispatching: ', msg);
        let token = tokenMap[msg.recipient.id];
        let user  = userMap[msg.sender.id];

        if (!user) {
            user = {
                appId : app.appId,
                userId : msg.sender.id
            };
            userUpdates.push(user);
        }

        return message.send(msg.sender.id,'Your message has been received.',token);
    }))
    .then( () => {
        return userUpdates.length ? userUpdates : undefined;
    });
};
