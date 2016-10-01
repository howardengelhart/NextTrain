'use strict';

const ld        = require('lodash');
const log       = require('./log');
const dispatch  = require('./dispatch');
const config    = require('./config');
const DataStore = require('./DataStore');

let db  = new DataStore(config.aws);

function onGet (event, context, app ) {
    let hubMode =  ld.get(event,'params.querystring[\'hub.mode\']');
    let tokenToVerify =  ld.get(event,'params.querystring[\'hub.verify_token\']');
    let appToken = ld.get(app,'facebook.verifyToken');

    if (hubMode !== 'subscribe'){
        log.error('GET is not a subscribe request.');
        throw new Error('Invalid request.');
    }

    if (tokenToVerify !== appToken){
        log.error(`Failed to verify ${app.name} tokens do not match.`);
        throw new Error('Forbidden');
    }
    return parseInt(event.params.querystring['hub.challenge'],10);
}

function onPost(event, context, app ) {
    let messages = [];
    let body = event['body-json']; 

    if (!body.entry) {
        throw new Error('Invalid event type.');
    }

    for (let entry of body.entry) {
        if (!entry.messaging) {
            log.warn('Unexpected entry: ', entry);
            continue;
        }

        for (let message of entry.messaging) {
            let sender = ld.get(message,'sender.id');
            if (!sender) {
                log.warn('Message is missing sender.id: ', message);
                continue;
            }

            let ts = ld.get(message,'timestamp');
            if (!ts) {
                log.warn('Message is missing timestamp: ', message);
                continue;
            }

            if ((Date.now() - ts) > config.maxMessageAge){
                log.warn('Message is stale: ', message);
                continue;
            }

            let idx = ld.findIndex(messages, (m) => (m.sender.id  === message.sender.id));
            if (idx >= 0) {
                if (message.timestamp > messages[idx].timestamp) {
                    messages[idx] = message;
                }
            } else {
                messages.push(message);
            }
        }
    }

    return dispatch(app, messages.sort((a,b) => a.timestamp > b.timestamp ? 1 : -1) );
}

exports.handler = (event, context ) => {
    log.info({'event': event, context: context},'New Request');
    let method = ld.get(event,'context.http-method');
    let env    = ld.get(event,'context.stage');
    let app    = ld.get(event,'params.path.app');
    let handler;
    
    if (method === 'GET') {
        handler = onGet;
    } else 
    if (method === 'POST') {
        handler = onPost;
    } else {
        let err = new Error('Invalid request.');
        context.fail(err);
        return Promise.reject(err);
    }
    return db.getApp(app, env)
    .then( (app) => {
        return handler(event,context,app);
    })
    .then(res => {
        log.info({'result': res},'Handler Succeeded.');
        context.succeed(res);
        return res;
    })
    .catch(err => {
        log.error({'error': err},'Handler Failed.');
        context.fail(err);
        return Promise.reject(err);
    });
};