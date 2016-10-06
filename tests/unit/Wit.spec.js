'use strict';

describe('Wit', () => {
    let Wit, request;

    beforeEach(() => {
        const proxyquire = require('proxyquire');

        request = {
            get : jasmine.createSpy('request.get')
        };

        Wit = proxyquire('../../src/Wit.js', {
            request : request
        });
    });

    describe('initialization', () => {
        it('rejects if no token is passed', () => {
            expect(() => {
                new Wit();
            }).toThrowError('new Wit requires a token');
        });

        it('defaults properties if not passed', () => {
            let w = new Wit({ token : 'mytoken' });
            expect(w.token).toEqual('mytoken');
            expect(w.apiVersion).toEqual('20160526');
            expect(w.hostname).toEqual('api.wit.ai');
        });

        it('sets  properties if passed', () => {
            let w = new Wit({ token : 'mytoken', apiVersion : 'now', hostname : 'ex.com' });
            expect(w.token).toEqual('mytoken');
            expect(w.apiVersion).toEqual('now');
            expect(w.hostname).toEqual('ex.com');
        });
    });

    describe('apiUrl', () => {
        let w;
        beforeEach(()=>{
            w = new Wit({ token : 'mytoken' }); 
        });

        it('generates a url with no query parameters', ()=> {
            expect(w.apiUrl('message')).toEqual('https://api.wit.ai/message?v=20160526');
        });

        it('generates a url with query parameters', () => {
            expect(w.apiUrl('message', { foo : 'bar', up : 'is down' }))
                .toEqual('https://api.wit.ai/message?v=20160526&foo=bar&up=is%20down');
        });
    });

    describe('message', () => {
        let w, params;
        
        beforeEach(() => {
            w = new Wit({ token : 'mytoken' }); 
            request.get.and.callFake( (url,opts,cb) => {
                params = {
                    url : url,
                    opts : opts
                };
                cb(null,{ statusCode : 200 }, {});
            });
        });

        it('sends a message request to the wit server', (done) => {
            w.message('This is a test!')
            .then(() => {
                expect(params.url)
                    .toEqual('https://api.wit.ai/message?v=20160526&q=This%20is%20a%20test!');
                expect(params.opts).toEqual({
                    auth : { bearer : 'mytoken' },
                    json : true
                });
            })
            .then(done, done.fail);
        });

        it('rejects if the call returns an error', (done) => {
            let err = new Error('fail');
            request.get.and.callFake( (url,opts,cb) => { cb(err); });
            w.message('test')
            .then(done.fail, error => {
                expect(error).toBe(err);
            })
            .then(done, done.fail);
        });
        
        it('rejects if the call returns an erroneous statusCode', (done) => {
            request.get.and.callFake( (url,opts,cb) => { cb(null,{ statusCode : 400}, null); });
            w.message('test')
            .then(done.fail, error => {
                expect(error.message).toEqual('Unexpected statusCode: 400');
            })
            .then(done, done.fail);
        });
    });

});
