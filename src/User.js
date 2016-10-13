'use strict';
const ld = require('lodash');
const crypto = require('crypto');

let userData = new WeakMap();

class User {
    constructor( params ) {
        let props = ld.assign({}, params);
        if ((!props.appId) || (!props.userId)) { 
            throw new Error('new User requires an appId and userId.');
        }

        userData.set(this, props);
        let session = props.session;
        let now = Date.now();

        if ((!session) || ((now - session.lastTouch) > (session.ttl * 1000))) {
            this.generateSession();
        } else {
            session.lastTouch = now;
        }
    }

    get appId() {
        return userData.get(this).appId;
    }

    get userId() {
        return userData.get(this).userId;
    }

    get session() {
        return ld.assign({}, userData.get(this).session);
    }

    get context() {
        return userData.get(this).context;
    }

    set context(v) {
        return userData.get(this).context = v;
    }

    get profile() {
        return userData.get(this).profile;
    }

    set profile(v) {
        return userData.get(this).profile = ld.assign({}, v, {profile_date : Date.now()}) ;
    }

    get data() {
        if (!userData.get(this).data){
            userData.get(this).data = {};
        }
        return userData.get(this).data;
    }

    generateSession(ttl) {
        const hash = crypto.createHash('sha1');
        let props = userData.get(this);
        ttl = ttl || 300;
        hash.update(
            `appId=${props.appId},userId=${props.userId},dt=${Date.now()}`
        );
        props.session = {
            sessionId : hash.digest('hex'),
            lastTouch : Date.now(),
            ttl : ttl
        };
        return props.session;
    }

    serialize() {
        let props = userData.get(this);
        props.session.lastTouch = Date.now();
        return ld.assign({}, props);
    }
}


module.exports = User;
