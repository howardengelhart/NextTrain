'use strict';

const aws = require('aws-sdk');

aws.config.update({
      region:   'us-east-1'
//      endpoint: 'http://localhost:8000'
});

const dynamodb = new aws.DynamoDB.DocumentClient();

let qry = { 
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
                     token: 'EAACp8LyeYWwBABXdMUCFzvQ3ZBy3rGEZBegV91W6C8qyfzoixZA6tFczrTrZCzWZAU4Ve3Nn4RM8EkCoGo7r19IZC1ZCKZCGeWOeNDKMuQSZBcay7w7EkAPQ3TQBJpSEbGdHeY44WBC14ZCSkNSPPMFBj1DannYc4zEZAoZCralDgRq3qAZDZD',
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

dynamodb.put(qry, (err, data) => {
    if (err) {
        console.error('Unable to put record. Error JSON:', JSON.stringify(err, null, 2));
    } else {
        console.log(JSON.stringify(data, null, 3));
    }
});
