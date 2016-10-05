'use strict';

describe('webhook', () => {
    const mocks = require('../helpers/mocks');
    const dynamoUtil = require('../helpers/dynamodb');
    const User = require('../../src/User');

    let mockDispatch, mockLog, mockEvent, mockContext, config, handler ;
    beforeEach(() => {
        const proxyquire = require('proxyquire');

        mockContext = mocks.createMockContext('webhook');
        mockDispatch = jasmine.createSpy('.dispatch').and.returnValue(Promise.resolve());
        mockLog = mocks.createMockLog();

        config = {
            aws : {
                region : 'us-east-1',
                endpoint : 'http://localhost:8000'
            }
        };

        handler = proxyquire('../../src/webhook.js', {
            './log'         : mockLog,
            './config'      : config,
            './dispatch'    : mockDispatch
        }).handler;
    });

    beforeEach( done => {
        let tableDefs = require('../../db/tables');
        let data = require('../../db/data/e2e-apps');
        let tables = [];
        for (let table in tableDefs) {
            tables.push(tableDefs[table]);
        }
        dynamoUtil.deleteTables(Object.keys(tableDefs),config.aws)
        .then( () => dynamoUtil.createTables(tables,config.aws) )
        .then( () => dynamoUtil.putRecords(data,config.aws) )
        .then(done,done.fail);
    });

    describe('GET', () => {
        beforeEach(()=> {
            mockEvent = {
                'body-json': {},
                params: {
                    path: {
                        app : 'test-app1'       
                    },
                    querystring: {
                        'hub.challenge': '1242057029',
                        'hub.mode'     : 'subscribe',
                        'hub.verify_token': 'fb-test-app1-token',
                    }
                },
                context : {
                    'stage' : 'test',
                    'http-method' : 'GET'
                }
            };
        });
        it('fails if the app is not in the db', (done) => {
            mockEvent.params.path.app = 'test-app0';
            handler(mockEvent,mockContext)
            .then(done.fail, err => {
                expect(err.message).toEqual('Forbidden');
            })
            .then(done,done.fail);
        });
        
        it('fails if the app is not active', (done) => {
            mockEvent.params.path.app = 'test-app2';
            handler(mockEvent,mockContext)
            .then(done.fail, err => {
                expect(err.message).toEqual('Forbidden');
            })
            .then(done,done.fail);
        });
        
        it('succeeds if the app is active', (done) => {
            handler(mockEvent,mockContext)
            .then(() => {
                expect(mockContext.succeed).toHaveBeenCalledWith(1242057029);
            })
            .then(done,done.fail);
        });
    });

    describe('POST', () => {
        beforeEach( () => {
            mockEvent = {
                params: { path: { app : 'test-app1' } },
                context : { 'stage' : 'test', 'http-method' : 'POST' },
                'body-json' : {
                    'object': 'page',
                    'entry' : [
                        {
                            'id': '1083198791769324',
                            'time': Date.now() - 1000,
                            'messaging': [
                                {
                                    recipient: { id: '1083198791769324' },
                                    timestamp: Date.now() - 1000,
                                    sender: { id: 'test-app1-user1' },
                                    postback: {
                                        payload: 'msg1'
                                    }
                                },
                                {
                                    recipient: { id: '1083198791769324' },
                                    timestamp: Date.now() - 1000,
                                    sender: { id: 'test-app1-user2' },
                                    postback: {
                                        payload: 'msg2'
                                    }
                                },
                                {
                                    recipient: { id: '1083198791769324' },
                                    timestamp: Date.now() - 1000,
                                    sender: { id: 'xxxxxxxxxxxxxxx' },
                                    postback: {
                                        payload: 'msg2'
                                    }
                                }
                            ]
                        }
                    ]
                }
            };
        });

        it('dispatches messages', (done) => {
            mockDispatch.and.returnValue(Promise.resolve([
                new User({ appId :  'app1', userId : 'user1' }),
                new User({ appId :  'app2', userId : 'user2' })
            ]));
            handler(mockEvent, mockContext)
//            .then(() => dynamoUtil.scanTable('users',config.aws) )
            .then(() => {
                let args = mockDispatch.calls.argsFor(0);
                expect(args[0].appId).toEqual('test-app1');
                expect(args[1].length).toEqual(3);
                expect(args[2]['test-app1-user1'].serialize()).toEqual(
                    jasmine.objectContaining({
                        userId : 'test-app1-user1',
                        appId : 'test-app1',
                        requests : [ { depart: 'station1', arrive : 'station2' } ]
                    }));
                expect(args[2]['test-app1-user2'].serialize()).toEqual(
                    jasmine.objectContaining({
                        userId : 'test-app1-user2',
                        appId : 'test-app1',
                        requests : [ { arrive : 'station2' } ]
                    }));
                //expect(users.Items).toEqual(jasmine.arrayContaining([
                //        { appId: 'app1', userId: 'user1' },
                //        { appId: 'app2', userId: 'user2' }
                //]));
                expect(mockContext.succeed).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });
    });
});
