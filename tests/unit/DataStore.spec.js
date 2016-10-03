'use strict';

describe('DataStore', () => {
    const mocks = require('../helpers/mocks');
    let DataStore, DocumentClient, ds, db, mockLog ;
    beforeEach(() => {
        const proxyquire = require('proxyquire');
        DocumentClient = jasmine.createSpy('DynamoDB.DocumentClient()').and.callFake(() =>  {
            return {
                get         : jasmine.createSpy('db.get'),
                batchGet    : jasmine.createSpy('db.batchGet'),
                batchWrite  : jasmine.createSpy('db.batchWrite')
            };
        });

        mockLog = mocks.createMockLog();

        DataStore = proxyquire('../../src/DataStore.js', {
            'aws-sdk' : {
                DynamoDB : { DocumentClient : DocumentClient }
            },
            './log' : mockLog,
        });
        
        ds = new DataStore();
        db  = DocumentClient.calls.mostRecent().returnValue;
    });

    describe('initialization', () => {
        it('sets aws config to defaults', () => {
            new DataStore();
            expect(DocumentClient).toHaveBeenCalledWith({ region : 'us-east-1' });
        });

        it('sets aws config with region', () => {
            new DataStore({ region : 'here' });
            expect(DocumentClient).toHaveBeenCalledWith({ region : 'here' });
        });

        it('sets aws config with endpoint', () => {
            new DataStore({ region : 'here', endpoint : 'end' });
            expect(DocumentClient).toHaveBeenCalledWith({ 
                region : 'here' , endpoint : 'end' 
            });
        });
    });

    describe('getApp', () => {
        let mockApp ;
        beforeEach(() => {
            mockApp = { 
                Item : {
                    appId : 'a-123',
                    name : 'My App',
                    active : true,
                    facebook : {
                        appId : 'fb-1',
                        verifyToken : 'fb-token1',
                        pages : []
                    }
                }
            };
        });

        it('rejects if there is a db error', (done) => {
            let err = new Error('fail');
            db.get.and.callFake((params, cb) => {
                cb(err, null);
            });
            
            ds.getApp('a-123','test')
            .then(done.fail, e => {
                expect(e.message).toEqual('Internal Error');
                expect(mockLog.error).toHaveBeenCalledWith(
                    { dbError: err},'Error on application lookup.');
            })
            .then(done, done.fail);
        });

        it('gets an app', (done) => {
            let params;
            db.get.and.callFake((p, cb) => {
                params = p;
                cb(null, mockApp);
            });

            ds.getApp('a-123','test')
            .then((res) => {
                expect(params).toEqual({
                    TableName: 'applications',
                    Key: { appId : 'a-123' }
                });
                expect(res).toEqual({
                    appId : 'a-123',
                    name: 'My App',
                    active : true,
                    facebook : {
                        appId : 'fb-1',
                        verifyToken : 'fb-token1',
                        pages : []
                    }
                });
            })
            .then(done, done.fail);
        });
    });

    describe('getUsers', () => {
        
        it('rejects if there is a db error', (done) => {
            let err = new Error('fail');
            db.batchGet.and.callFake((params, cb) => {
                cb(err, null);
            });
            
            ds.getUsers('a-123',['u-123','u-456'])
            .then(done.fail, e => {
                expect(e.message).toEqual('Internal Error');
                expect(mockLog.error).toHaveBeenCalledWith(
                    { dbError: err},'Error on user lookup.');
            })
            .then(done, done.fail);
        });

        it('returns an empty array if no users are found', (done) => {
            db.batchGet.and.callFake((params, cb) => {
                cb(null, { Responses : { users : [] } });
            });

            ds.getUsers('a-123',['u-123','u-456'])
            .then(r => {
                expect(r).toEqual([]);
            })
            .then(done, done.fail);
        });

        it('gets users', (done) => {
            let params, users;
            users = [
                { appId : 'a-123', userId: 'u-123' },
                { appId : 'a-123', userId: 'u-789' }
            ];
                    
            db.batchGet.and.callFake((p, cb) => {
                params = p;
                cb(null, { Responses : { users : users } });
            });

            ds.getUsers('a-123',['u-123','u-456','u-789'])
            .then((res) => {
                expect(params).toEqual({
                    RequestItems : {
                        'users' : {
                            Keys  : [
                                { appId : 'a-123', userId: 'u-123' },
                                { appId : 'a-123', userId: 'u-456' },
                                { appId : 'a-123', userId: 'u-789' }
                            ]
                        }
                    }
                });
                expect(res).toEqual( users);
            })
            .then(done, done.fail);
        });
    });
    
    describe('putUsers', () => {
        let userList;
        beforeEach(() => {
            userList = [
                { appId : 'app1', userId : 'user1' },
                { appId : 'app1', userId : 'user2' }
            ];
        });

        it('rejects if there is a db error', (done) => {
            let err = new Error('fail');
            db.batchWrite.and.callFake((params, cb) => {
                cb(err, null);
            });
            
            ds.putUsers(userList)
            .then(done.fail, e => {
                expect(e.message).toEqual('fail');
            })
            .then(done, done.fail);
        });

        it('puts user records', (done) => {
            let params;
            db.batchWrite.and.callFake((p, cb) => {
                params = p;
                cb(null, {});
            });
            
            ds.putUsers(userList)
            .then( () => {
                expect(params).toEqual({
                    RequestItems : {
                        users : [
                            { PutRequest: { Item : { appId : 'app1', userId: 'user1' } } },
                            { PutRequest: { Item : { appId : 'app1', userId: 'user2' } } }
                        ]
                    }
                });
            })
            .then(done, done.fail);
        });
    });
});
