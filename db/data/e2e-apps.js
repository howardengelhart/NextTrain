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
            }
        ]
    }
};
