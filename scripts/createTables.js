'use strict';

var aws = require('aws-sdk');

aws.config.update({
      region:   'us-east-1'
      endpoint: 'http://localhost:8000'
});

const dynamodb = new aws.DynamoDB();

let appsTable = {
    TableName: 'applications',
    KeySchema: [
       { AttributeName: 'appId', KeyType: 'HASH' } // Partition Key
    ],
    AttributeDefinitions: [
       {
          AttributeName: 'appId',
          AttributeType: 'S'
       }
    ],
    ProvisionedThroughput: {
       ReadCapacityUnits: 5,
       WriteCapacityUnits: 5
    }
};

let usersTable = {
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
};

Promise.all([appsTable,usersTable].map(table => {
    return new Promise((resolve,reject) => {
        console.log('Create: ', table.TableName);
        dynamodb.createTable(table, (err, data) => {
            if (err) {
                console.error('Unable to create table. Error JSON:',
                    JSON.stringify(err, null, 2));
                reject(err);
            } else {
                console.log('Created table. Table description JSON:',
                    JSON.stringify(data, null, 2));
                resolve(data);
            }
        });
    });
}))
.then(() => {
    return process.exit(0);
})
.catch((e) => {
//    console.log(e);
    return process.exit(1);
});


