'use strict';

const request = require('request');
const inspect = require('util').inspect;
const ld   = require('lodash');
const qstr = require('querystring').stringify;

let _data = new WeakMap();
class OTPlanner {

    constructor(opts) {
        _data.set(this, {
            hostname : ld.get(opts,'hostname','localhost:8080'),
            routerId : ld.get(opts,'routerId','default')
        });
    }

    get hostname() { return _data.get(this).hostname; }
    
    get routerId() { return _data.get(this).routerId; }

    apiUrl(endpoint,qs) {
        let _ = _data.get(this);
        return `http://${_.hostname}/${endpoint}${qs ? '?' + qstr(qs) : ''  }`;
    }

    sendRequest(path, params) {
        return new Promise( (resolve, reject) => {
            let url = this.apiUrl(path,params);
            let opts = { json : true };
            request.get(url,opts,(err,resp,body) => {
                if (err) {
                    return reject(err);
                }

                if ((resp.statusCode < 200) || (resp.statusCode > 299)) {
                    return reject( 
                        new Error('Unexpected statusCode: ' + resp.statusCode + 
                            (resp.body ? ', ' + inspect(resp.body,{depth:3}) : ''))
                    );
                }

                return resolve(body);
            });
        });
    }
    
    findStops(params, routerId) {
        routerId = routerId || ld.get(_data.get(this),'routerId');
        return this.sendRequest(`otp/routers/${routerId}/index/stops`, params);
    }

    findPlans(params, routerId) {
        routerId = routerId || ld.get(_data.get(this),'routerId');
        return this.sendRequest(`otp/routers/${routerId}/plan`, params);
    }
}

module.exports = OTPlanner;
