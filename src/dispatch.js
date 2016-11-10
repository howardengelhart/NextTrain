'use strict';

const log = require('./log');
const User = require('./User');
const Wit = require('./Wit');
const HandlerFactory = require('./handlers').HandlerFactory;

const fb = require('thefacebook');
const ld = require('lodash');

const wait = (timeout) => ( new Promise( (resolve) => setTimeout(resolve,timeout)) );

/**
 * Text messages are sent to WIT for analysis
 **/
function textPreprocessor(wit,msg,job) {
    return wit.message(msg.message.text)
    .then(res => {
        log.debug({ witResponse : res },'Handling wit response.');
        let payload = { };
        for (let ent in res.entities) {
            if (ent === 'datetime') {
                payload[ent] = ld.get(res,`entities.${ent}[0].values[0]`);
            } else {
                payload[ent] = ld.get(res,`entities.${ent}[0].value`);
            }
        }

        // Sometimes WIT interprets a time range (from/to) now when its not
        // supposed to be... ie "by 9am tomorrow morning" is sent as a range
        // where from is NOW and to is 9am tomorrow.  We'd rather treat the
        // from as a null..
        if ((payload.datetime) && (payload.datetime.type === 'interval')) {
            let now = Date.now();
            let fromVal = ld.get(payload,'datetime.from.value');
            let fromGrain = ld.get(payload,'datetime.from.grain');
            let toVal = ld.get(payload,'datetime.to.value');
            let toGrain = ld.get(payload,'datetime.to.grain');
            
            let fromNow = (fromGrain === 'second' && fromVal && 
                (Math.abs((new Date(fromVal)).valueOf() - now) < 30000));
            let toNow = (toGrain === 'second' && toVal && 
                (Math.abs((new Date(toVal)).valueOf() - now) < 30000));
       
            log.debug({
                fromVal : fromVal,
                fromGrain : fromGrain,
                toVal : toVal,
                toGrain : toGrain,
                fromNow : fromNow,
                toNow : toNow
            },'DATETIME BOGUS RANGE CHECK');

            if (fromNow) {
                payload.datetime.originalFrom = payload.datetime.from;
                delete payload.datetime.from;
            }

            if (toNow) {
                payload.datetime.originalTo = payload.datetime.to;
                delete payload.datetime.to;
            }
        }

        ld.assign(job, { payloadType : 'text', msg : msg, 
            payload : payload, witResponse : res });
        return job;
    });
}

/**
 * Handles structured data messages sent from Messenger.  These would be generated
 * by users clicking the bot's Buttons or Menu options from the Messenger app.
 **/
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

    // Merge Page (transit-system) specific configuration with the general
    // app configuration.
    app.facebook.pages.forEach((page) => {
        let appPage = {
            appId : app.appId,
            S3Bucket : app.S3Bucket,
            appRootUrl : app.appRootUrl,
            numItineraries : app.numItineraries,
            minConfidence : app.minConfidence,
            token : page.token,
            pageId : page.id,
            pageName : page.name,
            pageLink : `https://www.facebook.com/${page.id}`,
            messengerLink : `https://m.me/${page.id}`,
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
        // We put all of the request and related configuration data into a Job object.
        let job = {
            app : pages[msg.recipient.id],
            user : users[msg.sender.id]
        };
        if (!job.user) {
            job.user = new User({ appId : app.appId, userId : msg.sender.id });
        }

        // sending typing_on makes messenger show the user we're doing something..
        return action.send(job.user.userId,'typing_on',job.app.token)
        .then(() => {
            // If we don't have profile info for this user, or its old, we use
            // Facebook's user profile api to look it up.
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
                    // Errors here are not fatal.
                    log.warn({err : err.message}, 'USER PROFILE LOOKUP FAIL');
                    return job;
                });
            } 
            return job;
        })
        .then(() => {
            let preProcessor;

            // Pick a pre-processor based on the message.  Pre-processor's extract additional
            // data from the request, or via Wit, and attach it to the Job.
            if (msg.message && msg.message.text && (!msg.message.quick_reply)) {
                preProcessor = textPreprocessor.bind({}, wit, msg, job);
            } else {
                preProcessor = dataPreprocessor.bind({}, msg, job);
            }

            log.debug('calling preprocessor...');
            return preProcessor();
        })
        .then((job) => {
            // Most of the real work is done in Handlers.  CreateHandler looks at the job
            // to instantiate the right handler.
            let handler = HandlerFactory.CreateHandler(job);
            log.debug('Call handler.handle()');

            // Dot the actual handling..
            return handler.handle()
                .then(() => {
                    // TODO look at moving this logic out of here..
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
        // make sure messenger doesn't look like we're still working the request..
        .then(job => action.send(job.user.userId,'typing_off',job.app.token).then(() => job) );
    }))
    .then( (jobs) => {
        return jobs.map(job => job.user);
    })
    .catch( (err) => {
        log.error({error : err.message }, 'DISPATCH ERROR');
    });
};
