'use strict';

describe('webhook', () => {
    const mocks = require('../helpers/mocks');
    const TEST_DATE = 1453929767464; //Wed Jan 27 2016 16:22:47 GMT-0500 (EST)

    let mockDispatch, mockLog, mockEvent, mockContext, mockApp,
        DataStore, db, handler ;
    
    beforeAll(() => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(TEST_DATE));
    });

    afterAll(() => {
        jasmine.clock().uninstall();
    });


    beforeEach(() => {
        const proxyquire = require('proxyquire');

        mockContext = mocks.createMockContext('webhook');
        mockLog = mocks.createMockLog();
        mockDispatch = jasmine.createSpy('dispatch');

        mockApp = {
            appId : 'a-123',
            name  : 'My App',
            active : true,
            facebook : {
                appId : 'fb-1',
                verifyToken : 'fb-token1',
                pages : []
            }
        };

        DataStore = jasmine.createSpy('DataStore()').and.callFake(() =>  {
            return {
                getApp      : jasmine.createSpy('db.getApp'),
                getUsers    : jasmine.createSpy('db.getUsers'),
                putUsers    : jasmine.createSpy('db.putUsers')
            };
        });

        handler = proxyquire('../../src/webhook.js', {
            './DataStore' : DataStore,
            './log' : mockLog,
            './dispatch' : mockDispatch
        }).handler;
        
        db  = DataStore.calls.mostRecent().returnValue;
        db.getApp.and.callFake( () => {
            return Promise.resolve(mockApp );
        });
        
        db.getUsers.and.callFake( (app,userList) => {
            let result = userList.map( (user) => ({ appId : app, userId : user }) );
            return Promise.resolve(result );
        });

        db.putUsers.and.callFake( () => {
            return Promise.resolve ( {} );
        });
        
    });

    describe('PUT,DELETE', () => {
        beforeEach(()=> {
            mockEvent = {
                'body-json': {},
                params: {
                    path: {},
                    querystring: { }
                },
                context : {}
            };
        });

        it('PUT responds with an invalid request error', (done) => {
            mockEvent.context['http-method'] = 'PUT';
            handler(mockEvent, mockContext)
            .then(done.fail, (err) => {
                expect(err.message).toEqual('Invalid request.');
                expect(mockContext.fail).toHaveBeenCalledWith(err);
            })
            .then(done, done.fail);
        });

        it('DELETE responds with an invalid request error', (done) => {
            mockEvent.context['http-method'] = 'DELETE';
            handler(mockEvent, mockContext)
            .then(done.fail, (err) => {
                expect(err.message).toEqual('Invalid request.');
                expect(mockContext.fail).toHaveBeenCalledWith(err);
            })
            .then(done, done.fail);
        });
        
        it('Undefined context responds with an invalid request error', (done) => {
            handler(mockEvent, mockContext)
            .then(done.fail, (err) => {
                expect(err.message).toEqual('Invalid request.');
                expect(mockContext.fail).toHaveBeenCalledWith(err);
            })
            .then(done, done.fail);
        });

        it('Missing context responds with an invalid request error', (done) => {
            delete mockEvent.context;
            handler(mockEvent, mockContext)
            .then(done.fail, (err) => {
                expect(err.message).toEqual('Invalid request.');
                expect(mockContext.fail).toHaveBeenCalledWith(err);
            })
            .then(done, done.fail);
        });

    });

    describe('GET', () => {
        beforeEach(()=> {
            mockEvent = {
                'body-json': {},
                params: {
                    path: {
                        app : 'a-123'       
                    },
                    querystring: {
                        'hub.challenge': '1242057029',
                        'hub.mode'     : 'subscribe',
                        'hub.verify_token': 'fb-token1'
                    }
                },
                context : {
                    'stage' : 'test',
                    'http-method' : 'GET'
                }
            };
        });
        
        it('responds with an error if the request has no params', (done) => {
            delete mockEvent.params;
            handler(mockEvent, mockContext)
            .then(done.fail, (err) => {
                expect(err.message).toEqual('Invalid request.');
                expect(mockContext.fail).toHaveBeenCalledWith(err);
            })
            .then(done, done.fail);
        });

        it('responds with an error if params.querystring[hub.mode] != subscribe', (done) => {
            mockEvent.params.querystring['hub.mode'] = 'xxx';
            handler(mockEvent, mockContext)
            .then(done.fail, (err) => {
                expect(mockLog.error).toHaveBeenCalledWith(
                    'GET is not a subscribe request.');
                expect(err.message).toEqual('Invalid request.');
                expect(mockContext.fail).toHaveBeenCalledWith(err);
            })
            .then(done, done.fail);
        });
        
        it('rejects if there is no record', (done) => {
            mockApp = undefined;
            handler(mockEvent, mockContext)
            .then(done.fail, e => {
                expect(e.message).toEqual('Forbidden');
                expect(mockLog.error).toHaveBeenCalledWith(
                    'Failed on application lookup, a-123 not found.');
            })
            .then(done, done.fail);
        });

        it('rejects if the app is not active', (done) => {
            mockApp.active = false; 
            handler(mockEvent, mockContext)
            .then(done.fail, e => {
                expect(e.message).toEqual('Forbidden');
                expect(mockLog.error).toHaveBeenCalledWith(
                    'Failed on application lookup, a-123 not active.');
            })
            .then(done, done.fail);
        });

        it('responds with an error if the token lookup fails', (done) => {
            mockEvent.params.querystring['hub.verify_token'] = 'BAD TOKEN';
            handler(mockEvent, mockContext)
            .then(done.fail, (err) => {
                expect(mockLog.error).toHaveBeenCalledWith(
                    'Failed to verify My App tokens do not match.');
                expect(err.message).toEqual('Forbidden');
                expect(mockContext.fail).toHaveBeenCalledWith(err);
            })
            .then(done, done.fail);
        });

        it('responds to hub.challenge requests',(done)=>{
            handler(mockEvent, mockContext)
            .then((res) => {
                expect(res).toEqual(1242057029);
                expect(mockContext.succeed).toHaveBeenCalledWith(1242057029);
            })
            .then(done, done.fail);
        });
    });

    describe('POST', () => {
        beforeEach(()=> {
            mockEvent = {
                params: {
                    path: {
                        app : 'a-123'       
                    }
                },
                'body-json' : {
                    'object' : 'page',
                    entry : [
                        { id : '123456788', time : TEST_DATE },
                        {
                            id : '123456789',
                            time : TEST_DATE,
                            messaging : [
                                {
                                    recipient : { id : 'r-123'}, sender : { id : 's-123' },
                                    timestamp : TEST_DATE - 1000,
                                    postback : { payload : 'payload' }
                                },
                                {
                                    recipient : { id : 'r-456'}, sender : { id : 's-456' },
                                    timestamp : TEST_DATE - 1100,
                                    postback : { payload : 'payload' }
                                },
                                {
                                    recipient : { id : 'r-123'}, sender : { id : 's-789' },
                                    timestamp : TEST_DATE - 500,
                                    postback : { payload : 'payload' }
                                }
                            ]
                        }
                    ]
                },
                context : {
                    stage : 'test',
                    'http-method' : 'POST'
                }
            };
        });

        it('will fail if the entry property is missing from the event',(done)=>{
            delete mockEvent['body-json'].entry;
            handler(mockEvent, mockContext)
            .then(done.fail, err => {
                expect(mockContext.succeed).toHaveBeenCalledWith(err);
                expect(err.message).toEqual('Invalid event type.');
            })
            .then(done, done.fail);
        });
        
        it('will warn if the entry messaging property is missing',(done)=>{
            delete mockEvent['body-json'].entry[0].messaging;
            handler(mockEvent, mockContext)
            .then(res => {
                expect(mockLog.warn).toHaveBeenCalledWith('Unexpected entry: ',
                    mockEvent['body-json'].entry[0]);
                expect(mockDispatch).toHaveBeenCalled();
                expect(mockContext.succeed).toHaveBeenCalledWith(res);
            })
            .then(done, done.fail);
        });
        
        it('will remove messages with no sender', (done) => {
            delete mockEvent['body-json'].entry[1].messaging[1].sender;
            handler(mockEvent, mockContext)
            .then(res => {
                expect(mockDispatch).toHaveBeenCalled();
                let args = mockDispatch.calls.argsFor(0)[1];
                expect(args.length).toEqual(2);
                expect(args[0].sender.id).toEqual('s-123');
                expect(args[1].sender.id).toEqual('s-789');
                expect(mockLog.warn).toHaveBeenCalledWith(
                    'Message is missing sender.id: ',
                    mockEvent['body-json'].entry[1].messaging[1]
                );
                expect(mockContext.succeed).toHaveBeenCalledWith(res);
            })
            .then(done, done.fail);
        });
        
        it('will remove messages with no sender id', (done) => {
            delete mockEvent['body-json'].entry[1].messaging[1].sender.id;
            handler(mockEvent, mockContext)
            .then(res => {
                expect(mockDispatch).toHaveBeenCalled();
                let args = mockDispatch.calls.argsFor(0)[1];
                expect(args.length).toEqual(2);
                expect(args[0].sender.id).toEqual('s-123');
                expect(args[1].sender.id).toEqual('s-789');
                expect(mockLog.warn).toHaveBeenCalledWith(
                    'Message is missing sender.id: ',
                    mockEvent['body-json'].entry[1].messaging[1]
                );
                expect(mockContext.succeed).toHaveBeenCalledWith(res);
            })
            .then(done, done.fail);
        });
        
        it('will remove messages with no timestamp', (done) => {
            delete mockEvent['body-json'].entry[1].messaging[1].timestamp;
            handler(mockEvent, mockContext)
            .then(res => {
                expect(mockDispatch).toHaveBeenCalled();
                let args = mockDispatch.calls.argsFor(0)[1];
                expect(args.length).toEqual(2);
                expect(args[0].sender.id).toEqual('s-123');
                expect(args[1].sender.id).toEqual('s-789');
                expect(mockLog.warn).toHaveBeenCalledWith(
                    'Message is missing timestamp: ',
                    mockEvent['body-json'].entry[1].messaging[1]
                );
                expect(mockContext.succeed).toHaveBeenCalledWith(res);
            })
            .then(done, done.fail);
        });
        
        it('will remove old messages', (done) => {
            mockEvent['body-json'].entry[1].messaging[1].timestamp = TEST_DATE - 5001;
            handler(mockEvent, mockContext)
            .then(res => {
                expect(mockDispatch).toHaveBeenCalled();
                let args = mockDispatch.calls.argsFor(0)[1];
                expect(args.length).toEqual(2);
                expect(args[0].sender.id).toEqual('s-123');
                expect(args[1].sender.id).toEqual('s-789');
                expect(mockLog.warn).toHaveBeenCalledWith(
                    'Message is stale: ',mockEvent['body-json'].entry[1].messaging[1]);
                expect(mockContext.succeed).toHaveBeenCalledWith(res);
            })
            .then(done, done.fail);
        });
        
        
        it('will only keep latest message from a given user id', (done) => {
            mockEvent['body-json'].entry[0].messaging = [
                {
                    recipient : { id : 'r-123'}, sender : { id : 's-456' },
                    timestamp : TEST_DATE - 1200, postback : { payload : 'payload' }
                },
                {
                    recipient : { id : 'r-123'}, sender : { id : 's-456' },
                    timestamp : TEST_DATE - 1500, postback : { payload : 'payload' }
                }
            ];
            mockEvent['body-json'].entry[1].messaging.unshift(
                {
                    recipient : { id : 'r-123'}, sender : { id : 's-456' },
                    timestamp : TEST_DATE - 400, postback : { payload : 'payload' }
                }
            );
            
            handler(mockEvent, mockContext)
            .then(res => {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(db.getUsers).toHaveBeenCalledWith('a-123',[
                    's-123', 's-789', 's-456' ]);
                expect(mockDispatch).toHaveBeenCalled();
                let args = mockDispatch.calls.argsFor(0)[1];
                expect(args.length).toEqual(3);
                expect(args[0].sender.id).toEqual('s-123');
                expect(args[1].sender.id).toEqual('s-789');
                expect(args[2].sender.id).toEqual('s-456');
                expect(args[2].timestamp).toEqual(TEST_DATE - 400);
                expect(mockContext.succeed).toHaveBeenCalledWith(res);
            })
            .then(done, done.fail);
        });

        it('will store user updates if it receives any', (done) => {
            let userList = [
                { appId  : 'app1', userId : 'user1' },
                { appId  : 'app1', userId : 'user2' }
            ];

            mockDispatch.and.returnValue(Promise.resolve(userList));

            handler(mockEvent, mockContext)
            .then( () => {
                expect(db.putUsers).toHaveBeenCalledWith(userList);
            })
            .then(done, done.fail);
        });
    });
});
