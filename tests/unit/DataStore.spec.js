'use strict';

describe('DataStore', () => {
    const mocks = require('../helpers/mocks');
    let DataStore, DocumentClient, ds, db, mockLog ;
    beforeEach(() => {
        const proxyquire = require('proxyquire');
        DocumentClient = jasmine.createSpy('DynamoDB.DocumentClient()').and.callFake(() =>  {
            return {
                get         : jasmine.createSpy('db.get'),
                batchGet    : jasmine.createSpy('db.batchGet')
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
                    env : {
                        test : {
                            facebook : {
                                appId : 'fb-1',
                                verifyToken : 'fb-token1',
                                pages : []
                            }
                        }
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
                expect(e.message).toEqual('Forbidden');
                expect(mockLog.error).toHaveBeenCalledWith(
                    { dbError: err},'Error on application lookup.');
            })
            .then(done, done.fail);
        });

        it('rejects if there is no record', (done) => {
            db.get.and.callFake((params, cb) => {
                cb(null, {});
            });
            
            ds.getApp('a-123','test')
            .then(done.fail, e => {
                expect(e.message).toEqual('Forbidden');
                expect(mockLog.error).toHaveBeenCalledWith(
                    'Failed on application lookup, a-123 not found.');
            })
            .then(done, done.fail);
        });

        it('rejects if the app is not active', (done) => {
            db.get.and.callFake((params, cb) => {
                mockApp.Item.active = false;
                cb(null, mockApp);
            });
            
            ds.getApp('a-123','test')
            .then(done.fail, e => {
                expect(e.message).toEqual('Forbidden');
                expect(mockLog.error).toHaveBeenCalledWith(
                    'Failed on application lookup, a-123 not active.');
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
                cb(null, { Responses : [] });
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
                cb(null, { Responses : users });
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

});
