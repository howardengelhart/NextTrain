'use strict';

var aws = require('aws-sdk');

aws.config.update({
      region:   'us-east-1'
//      endpoint: 'http://localhost:8000'
});

const dynamodb = new aws.DynamoDB();

let params = {
    TableName: 'applications',
    KeySchema: [
       { AttributeName: 'id', KeyType: 'HASH' } // Partition Key
    ],
    AttributeDefinitions: [
       {
          AttributeName: 'id',
          AttributeType: 'S'
       }
    ],
    ProvisionedThroughput: {
       ReadCapacityUnits: 5,
       WriteCapacityUnits: 5
    }
};

dynamodb.createTable(params, (err, data) => {
    if (err) {
        console.error('Unable to create table. Error JSON:', JSON.stringify(err, null, 2));
    } else {
        console.log('Created table. Table description JSON:', JSON.stringify(data, null, 2));
    }
});
