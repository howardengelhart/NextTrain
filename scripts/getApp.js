'use strict';

var aws = require('aws-sdk');

aws.config.update({
      region:   'us-east-1',
      endpoint: 'http://localhost:8000'
});

const dynamodb = new aws.DynamoDB.DocumentClient();
let qry = { TableName : 'applications', Key : { id  : 'chatbot1' } };

dynamodb.get(qry, (err, data) => {
    if (err) {
        console.error('Unable to get record. Error JSON:', JSON.stringify(err, null, 2));
    } else {
        console.log(JSON.stringify(data, null, 3));
    }
});
