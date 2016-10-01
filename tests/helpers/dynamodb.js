'use strict';

var aws = require('aws-sdk');

exports.createTables = (tableDefs, config) => {

    const dynamodb = new aws.DynamoDB(config);

    if (!Array.isArray(tableDefs)) {
        tableDefs = [ tableDefs ];
    }

    return Promise.all(tableDefs.map(table => {
        return new Promise((resolve,reject) => {
            dynamodb.createTable(table, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }));
};

exports.deleteTables = (tables, config) => {

    const dynamodb = new aws.DynamoDB(config);

    if (!Array.isArray(tables)) {
        tables = [ tables ];
    }

    return Promise.all(tables.map(table => {
        return new Promise((resolve,reject) => {
            dynamodb.deleteTable({ TableName: table}, (err, data) => {
                if (err) {
                    if (err.message === 'Cannot do operations on a non-existent table') {
                        resolve( {} );
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(data);
                }
            });
        });
    }));
};

exports.putRecords = (records, config) => {
    const dynamodb = new aws.DynamoDB.DocumentClient(config);

    if (!Array.isArray(records)) {
        records = [ records ];
    }

    return Promise.all(records.map(qry => {
        return new Promise((resolve,reject) => {
            dynamodb.put(qry, (err, data) => {
                if (err) {
                    reject(err); 
                } else {
                    resolve(data);
                }
            });
        });
    }));
};
