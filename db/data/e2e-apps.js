'use strict';

module.exports = {
    RequestItems : {
        applications :  [
            {
                PutRequest : {
                    Item: {
                        appId: 'test-app1',
                        name: 'E2E Test1',
                        active: true,
                        facebook: {
                            appId: 'fb-test-app1',
                            verifyToken: 'fb-test-app1-token',
                            pages: [
                                {
                                    id: 'fb-test-app1-page-1',
                                    name: 'App 1, Test Page 1',
                                    token: 'fb-test-app1-page-1-token'
                                }
                            ]
                        }
                    }
                }
            },
            {
                PutRequest : {
                    Item: {
                        appId: 'test-app2',
                        name: 'E2E Test2',
                        active: false,
                        facebook: {
                            appId: 'fb-test-app2',
                            verifyToken: 'fb-test-app2-token',
                            pages: [
                                {
                                    id: 'fb-test-app2-page-1',
                                    name: 'App 2, Test Page 1',
                                    token: 'fb-test-app2-page-1-token'
                                }
                            ]
                        }
                    }
                }
            },
            {
                PutRequest : {
                    Item: {
                        appId: 'test-app3',
                        name: 'E3E Test3',
                        active: true,
                        facebook: {
                            appId: 'fb-test-app3',
                            verifyToken: 'fb-test-app3-token',
                            pages: [
                                {
                                    id: 'fb-test-app3-page-1',
                                    name: 'App 3, Test Page 1',
                                    token: 'fb-test-app3-page-1-token'
                                }
                            ]
                        }
                    }
                }
            }
        ],
        users : [
            {
                PutRequest: {
                    Item : {
                        appId : 'test-app1',
                        userId : 'test-app1-user1',
                        requests : [
                            {
                                depart : 'station1',
                                arrive : 'station2'
                            }
                        ]
                    }
                }
            },
            {
                PutRequest: {
                    Item : {
                        appId : 'test-app1',
                        userId : 'test-app1-user2',
                        requests : [
                            {
                                arrive : 'station2'
                            }
                        ]
                    }
                }
            },
            {
                PutRequest: {
                    Item : {
                        appId : 'test-app2',
                        userId : 'test-app2-user1',
                        requests : [
                            {
                                arrive : 'station3'
                            }
                        ]
                    }
                }
            }
        ]
    }
};
