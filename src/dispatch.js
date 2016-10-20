'use strict';

const log = require('./log');
const User = require('./User');
const Wit = require('./Wit');
const HandlerFactory = require('./handlers').HandlerFactory;

const fb = require('thefacebook');
const ld = require('lodash');

const wait = (timeout) => ( new Promise( (resolve) => setTimeout(resolve,timeout)) );

function textPreprocessor(wit,msg,job) {
    return wit.message(msg.message.text)
    .then(res => {
        log.debug({ witResponse : res },'Handling wit response.');
        let payload = {};
        for (let ent in res.entities) {
            payload[ent] = ld.get(res,`entities.${ent}[0].value`);
        }

        ld.assign(job, { payloadType : 'text', msg : msg, payload : payload });
        return job;
    });
}

function dataPreprocessor(msg, job) {
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
        ld.assign(job, { payloadType : type, msg : msg, payload : payload });
        return resolve(job);
    });
}

module.exports = (app, messages, users ) => {
    let wit = new Wit(app.wit);
    let pages  = {};
    let action = new fb.SenderAction();
    let userProfile = new fb.UserProfile();

    app.facebook.pages.forEach((page) => {
        let appPage = {
            appId : app.appId,
            appRootUrl : app.appRootUrl,
            stageVars : app.stageVars,
            token : page.token,
            pageId : page.id,
            pageName : page.name,
            aliases : page.aliases
        };
        appPage.otp = ld.assign({},app.otp,page.otp);
        appPage.wit = ld.assign({},app.wit,page.wit);
        appPage.timezone = page.timezone || app.timezone;
        appPage.welcome = page.welcome || app.welcome;
        appPage.help = page.help || app.help;
        appPage.feedback = page.feedback || app.feedback;
        pages[page.id] = appPage;
    });

    log.trace({'pages' : pages });
    log.trace({'users' : users });

    return Promise.all((messages || []).map( (msg) => {
        log.debug({ message : msg }, 'Dispatching message.' );
        let job = {
            app : pages[msg.recipient.id],
            user : users[msg.sender.id]
        };
        if (!job.user) {
            job.user = new User({ appId : app.appId, userId : msg.sender.id });
        }

        return action.send(job.user.userId,'typing_on',job.app.token)
        .then(() => {
            if ((!ld.get(job,'user.profile')) || 
                ((Date.now() - ld.get(job,'user.profile.profile_date',0)) > 900000) ) {
                log.debug(`Lookup profile for user ${job.user.userId}`);
                return userProfile.getProfile(job.user.userId,job.app.token)
                .then((profile) => {
                    log.debug({ profile : profile}, `Set profile for user ${job.user.userId}`);
                    job.user.profile = profile;
                    return job;
                })
                .catch(err => {
                    log.warn({err : err.message}, 'USER PROFILE LOOKUP FAIL');
                    return job;
                });
            } 
            return job;
        })
        .then(() => {
            let preProcessor;

            if (msg.message && msg.message.text && (!msg.message.quick_reply)) {
                preProcessor = textPreprocessor.bind({}, wit, msg, job);
            } else {
                preProcessor = dataPreprocessor.bind({}, msg, job);
            }

            log.debug('calling preprocessor...');
            return preProcessor();
        })
        .then((job) => {
            let handler = HandlerFactory.CreateHandler(job);
            log.debug('Call handler.handle()');
            return handler.handle()
                .then(() => {
                    if (job.done && (handler.type !== HandlerFactory.MenuRequestHandlerType)) {
                        log.info('currentRequest is DONE, reset user for next request.');
                        delete job.user.data.currentRequest;
                        if ( (handler.type === HandlerFactory.WelcomeRequestHandlerType) ||
                            (handler.type === HandlerFactory.FeedbackRequestHandlerType)  ||
                            (handler.type === HandlerFactory.HelpRequestHandlerType) ) {
                            return action.send(job.user.userId,'typing_on',job.app.token)
                                .then(() => wait(1500))
                                .then(() => ((HandlerFactory.CreateHandler(
                                    job,HandlerFactory.MenuRequestHandlerType
                                )).work()) )
                                .then(() => job);
                        }
                    }
                    return job;
                });
        })
        .then(job => action.send(job.user.userId,'typing_off',job.app.token).then(() => job) );
    }))
    .then( (jobs) => {
        return jobs.map(job => job.user);
    })
    .catch( (err) => {
        log.error({error : err.message }, 'DISPATCH ERROR');
    });
};
