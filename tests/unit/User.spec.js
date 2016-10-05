'use strict';

describe('User', () => {
    const TEST_DATE = 1453929767464; //Wed Jan 27 2016 16:22:47 GMT-0500 (EST)
    let User; 

    beforeAll(() => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(TEST_DATE));
    });

    afterAll(() => {
        jasmine.clock().uninstall();
    });

    beforeEach(() => {
        const proxyquire = require('proxyquire');
        User = proxyquire('../../src/User',{});
    });
   
    describe('initialization', () => {
        it('requires an appId and userId', () => {
            expect(() => {
                new User();
            }).toThrowError('new User requires an appId and userId.');
            
            expect(() => {
                new User({appId : 'app1' });
            }).toThrowError('new User requires an appId and userId.');
            
            expect(() => {
                new User({userId : 'user1' });
            }).toThrowError('new User requires an appId and userId.');
            
            expect(() => {
                new User({appId: 'app1', userId : 'user1' });
            }).not.toThrow();
        });

        it('sets properties', () => {
            let u = new User({
                appId : 'app1',
                userId : 'user1',
                session : {
                    sessionId : 'session1',
                    lastTouch : TEST_DATE - 100,
                    ttl : 250
                }
            });
            expect(u.appId).toEqual('app1');
            expect(u.userId).toEqual('user1');

            // lastTouch is updated to now if not stale.
            expect(u.session).toEqual({
                sessionId : 'session1',
                lastTouch : TEST_DATE,
                ttl : 250
            });
        });

        it('creates a session by default if none exists', () => {
            let u = new User({appId: 'app1', userId : 'user1' });
            expect(u.session).toEqual({
                sessionId : 'a708b462703e96dd1ebc4bdae3c290b943ad9004',
                lastTouch : TEST_DATE,
                ttl : 300
            });
        });

    });

    describe('properties', () => {
        it('are mostly read only', () => {
            let u = new User({
                appId : 'app1',
                userId : 'user1',
                session : {
                    sessionId : 'session1',
                    lastTouch : TEST_DATE,
                    ttl : 250
                }
            });
            expect(() => {
                u.appId = 'a';
            }).toThrowError('Cannot set property appId of #<User> which has only a getter');
            
            expect(() => {
                u.userId = 'a';
            }).toThrowError('Cannot set property userId of #<User> which has only a getter');
            
            expect(() => {
                u.session = 'a';
            }).toThrowError('Cannot set property session of #<User> which has only a getter');
        });

        it('except for context', () => {
            let u = new User({
                appId : 'app1',
                userId : 'user1',
                context : { foo : 'bar' },
                session : {
                    sessionId : 'session1',
                    lastTouch : TEST_DATE,
                    ttl : 250
                }
            });
            expect(u.context).toEqual({foo : 'bar' });
            u.context = 1;
            expect(u.context).toEqual(1);
        });
    });

    describe('generateSession', () => {
        it('creates a sessionId using appId, userId and timestamp', () => {
            let u = new User({ appId : 'app1', userId : 'user1' });
            expect(u.generateSession()).toEqual({
                sessionId : 'a708b462703e96dd1ebc4bdae3c290b943ad9004',
                lastTouch : TEST_DATE,
                ttl : 300
            });

            expect(u.session).toEqual({
                sessionId : 'a708b462703e96dd1ebc4bdae3c290b943ad9004',
                lastTouch : TEST_DATE,
                ttl : 300
            });
        });
        
        it('creates a sessionId with overridden ttl', () => {
            let u = new User({ appId : 'app1', userId : 'user1' });
            expect(u.generateSession(100)).toEqual({
                sessionId : 'a708b462703e96dd1ebc4bdae3c290b943ad9004',
                lastTouch : TEST_DATE,
                ttl : 100
            });

            expect(u.session).toEqual({
                sessionId : 'a708b462703e96dd1ebc4bdae3c290b943ad9004',
                lastTouch : TEST_DATE,
                ttl : 100
            });
        });

        it('is called if the User is constructed with a stale session', () => {
            let u = new User({
                appId : 'app1',
                userId : 'user1',
                session : {
                    sessionId : 'session1',
                    lastTouch : TEST_DATE - 300001,
                    ttl : 300
                }
            });

            expect(u.session).toEqual({
                sessionId : 'a708b462703e96dd1ebc4bdae3c290b943ad9004',
                lastTouch : TEST_DATE,
                ttl : 300
            });
        });
    });

    describe('serialize', () => {
        it('returns a POJO', () => {
            let u = new User({ appId : 'app1', userId : 'user1' });
            expect(u.serialize()).toEqual({
                appId : 'app1',
                userId : 'user1',
                session : {
                    sessionId : 'a708b462703e96dd1ebc4bdae3c290b943ad9004',
                    lastTouch : TEST_DATE,
                    ttl : 300
                }
            });
        });
    });
});
