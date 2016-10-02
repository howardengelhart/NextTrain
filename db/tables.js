'use strict';

module.exports = {
    applications : {
        TableName: 'applications',
        KeySchema: [
           { AttributeName: 'appId', KeyType: 'HASH' } // Partition Key
        ],
        AttributeDefinitions: [
           { AttributeName: 'appId', AttributeType: 'S' }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    },

    users : {
        TableName: 'users',
        KeySchema: [
           { AttributeName: 'appId', KeyType: 'HASH' }, // Partition Key
           { AttributeName: 'userId', KeyType: 'RANGE' } // Sort Key
        ],
        AttributeDefinitions: [
           { AttributeName: 'appId', AttributeType: 'S' },
           { AttributeName: 'userId', AttributeType: 'S' }
        ],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    }
};
