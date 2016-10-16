'use strict';

describe('OTPlanner', () => {
    let OTPlanner, request;

    beforeEach(() => {
        const proxyquire = require('proxyquire');

        request = {
            get : jasmine.createSpy('request.get')
        };

        OTPlanner = proxyquire('../../src/OTPlanner.js', {
            request : request
        });
    });

    describe('initialization', () => {
        it('defaults properties if not passed', () => {
            let p = new OTPlanner();
            expect(p.hostname).toEqual('localhost:8080');
            expect(p.routerId).toEqual('default');
        });

        it('sets  properties if passed', () => {
            let p = new OTPlanner({ hostname : 'ex.com', routerId : 'sf' });
            expect(p.hostname).toEqual('ex.com');
            expect(p.routerId).toEqual('sf');
        });
    });
    
    describe('apiUrl', () => {
        let p;
        beforeEach(()=>{
            p = new OTPlanner(); 
        });

        it('generates a url with no query parameters', ()=> {
            expect(p.apiUrl('router')).toEqual('http://localhost:8080/router');
        });

        it('generates a url with query parameters', () => {
            expect(p.apiUrl('router', { foo : 'bar', up : 'is down' }))
                .toEqual('http://localhost:8080/router?foo=bar&up=is%20down');
        });
    });
    
    describe('sendRequest', () => {
        let p, params;
        
        beforeEach(() => {
            p = new OTPlanner(); 
            request.get.and.callFake( (url,opts,cb) => {
                params = {
                    url : url,
                    opts : opts
                };
                cb(null,{ statusCode : 200 }, {});
            });
        });

        it('sends a request to the otp host', (done) => {
            p.sendRequest('test/path', { foo : 'bar' })
            .then(() => {
                expect(params.url)
                    .toEqual('http://localhost:8080/test/path?foo=bar');
                expect(params.opts).toEqual({
                    json : true
                });
            })
            .then(done, done.fail);
        });

        it('rejects if the call returns an error', (done) => {
            let err = new Error('fail');
            request.get.and.callFake( (url,opts,cb) => { cb(err); });
            p.sendRequest('test/path', { foo : 'bar' })
            .then(done.fail, error => {
                expect(error).toBe(err);
            })
            .then(done, done.fail);
        });
    });

    describe('methods', () => {
        let p;
        beforeEach(() => {
            p = new OTPlanner(); 
            spyOn(p,'sendRequest');
        });

        it('findStops uses the default Router if none passed', () => {
            p.findStops();
            expect(p.sendRequest)
                .toHaveBeenCalledWith('otp/routers/default/index/stops',undefined);
        });
        
        it('findPlans uses the default Router if none passed', () => {
            p.findPlans();
            expect(p.sendRequest)
                .toHaveBeenCalledWith('otp/routers/default/plan',undefined);
        });
        
        it('findStops uses the default Router and params if passed', () => {
            p.findStops({ stopId : 'someid' });
            expect(p.sendRequest)
                .toHaveBeenCalledWith('otp/routers/default/index/stops',{ stopId : 'someid' });
        });
        
        it('findPlans uses the default Router and params if passed', () => {
            p.findPlans({ stopId : 'someid' });
            expect(p.sendRequest)
                .toHaveBeenCalledWith('otp/routers/default/plan',{ stopId : 'someid' });
        });
        
        it('findStops uses the specified Router and params if passed', () => {
            p.findStops({ stopId : 'someid' }, 'njt');
            expect(p.sendRequest)
                .toHaveBeenCalledWith('otp/routers/njt/index/stops',{ stopId : 'someid' });
        });
        
        it('findPlans uses the specified Router and params if passed', () => {
            p.findPlans({ stopId : 'someid' }, 'njt');
            expect(p.sendRequest)
                .toHaveBeenCalledWith('otp/routers/njt/plan',{ stopId : 'someid' });
        });
    });
});

