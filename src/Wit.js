'use strict';

const ld   = require('lodash');
const qstr = require('querystring').stringify;
const request = require('request');
const inspect = require('util').inspect;
//const log = require('./log');

let _data = new WeakMap();

class Wit {
    constructor(opts) {
        if (!(opts && opts.token)) {
            throw new Error('new Wit requires a token');
        }
        _data.set(this, {
            token : opts.token,
            hostname : ld.get(opts,'hostname','api.wit.ai'),
            apiVersion : ld.get(opts,'apiVersion','20160526')
        });
    }
    
    get token()      { return _data.get(this).token; }
    get hostname()   { return _data.get(this).hostname; }
    get apiVersion() { return _data.get(this).apiVersion; }

    apiUrl(endpoint,qs) {
        let _ = _data.get(this);
        let params = ld.assign({ v : _.apiVersion}, qs);
        return `https://${_.hostname}/${endpoint}?${qstr(params)}`;
    }

    message(msg) {
        return new Promise( (resolve, reject) => {
            let _ = _data.get(this);
            let url = this.apiUrl('message',{ q : msg });
            let opts = { auth : { bearer : _.token }, json : true };
//            log.info({ 'url' : url },'Sending request to wit');
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

    converse(msg,sessionId,context) {
        return new Promise( (resolve, reject) => {
            let _ = _data.get(this);
            let params = { session_id : sessionId };
            if (msg && msg.length > 0) {
                params.q = msg;
            }
            let url = this.apiUrl('converse',params);
            let opts = { 
                auth : { bearer : _.token }, 
                headers : {
                    Accept: 'application/json'
                },
                json : context || true 
            };
            request.post(url,opts,(err,resp,body) => {
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
}

module.exports = Wit;
