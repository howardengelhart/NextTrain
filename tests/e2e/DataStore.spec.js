'use strict';

describe('DataStore', () => {
    const mocks = require('../helpers/mocks');
    const dynamoUtil = require('../helpers/dynamodb');

    let mockLog, ds, config ;
    beforeEach(() => {
        const proxyquire = require('proxyquire');

        mockLog = mocks.createMockLog();

        let DataStore = proxyquire('../../src/DataStore.js', {
            './log' : mockLog,
        });
        
        config = {
            region : 'us-east-1',
            endpoint : 'http://localhost:8000'
        };
        
        ds = new DataStore(config);
    });

    describe('getApp', () => {
        let app;
        beforeEach( done => {
            app = { 
                TableName : 'applications',
                Item: {
                    name: 'Marco Polo = Test1',
                    env: {
                        staging: {
                            facebook: {
                                appId: '186851421741420',
                                verifyToken: '68dfd144f81d7fbdfb8ed6088da7d97e256d90a7',
                                pages: [
                                    {
                                        id: '1757069501222687',
                                        token: 'TOKEN',
                                        name: 'My Test Page2',
                                        active: true
                                    }
                                ]
                            }
                        }
                    },
                    id: 'marcotest',
                    active: true
                }
            };
            
            let appsTable = {
                TableName: 'applications',
                KeySchema: [
                   { AttributeName: 'appId', KeyType: 'HASH' } // Partition Key
                ],
                AttributeDefinitions: [
                    { AttributeName: 'appId', AttributeType: 'S' }
                ],
                ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
            };

            dynamoUtil.deleteTables('applications',config)
            .then( () => dynamoUtil.createTables(appsTable,config))
            .then(done,done.fail);
        });

        it('rejects if the app is not found', done => {
            ds.getApp('myapp','staging')
            .then(done.fail, e => {
                expect(e.message).toEqual('Forbidden');
            })
            .then(done, done.fail);
        });

        it('returns an app if it finds one', done => {
            dynamoUtil.putRecords(app,config)
            .then(() => ds.getApp('marcotest','staging') )
            .then((a) => {
                expect(a).toEqual({
                    id: 'marcotest',
                    name: 'Marco Polo = Test1',
                    facebook: {
                        appId: '186851421741420',
                        verifyToken: '68dfd144f81d7fbdfb8ed6088da7d97e256d90a7',
                        pages: [
                            {
                                id: '1757069501222687',
                                token: 'TOKEN', 
                                name: 'My Test Page2',
                                active: true
                            }
                        ]
                    }
                });
            })
            .then(done, done.fail);
        });
    });

});

