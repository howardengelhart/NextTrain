'use strict';

const aws       = require('aws-sdk');
const ld        = require('lodash');
const log       = require('./log');
const User      = require('./User');

class DataStore {

    constructor(config) {
        let opts = {};
        opts.region = ld.get(config,'region','us-east-1');
        if (ld.get(config,'endpoint')) {
            opts.endpoint = config.endpoint;
        }
        this.db = new aws.DynamoDB.DocumentClient(opts);
    }

    getApp(app) {
        let qry = {
            TableName : 'applications',
            Key : {
                appId  : app 
            }
        };

        return new Promise( (resolve, reject) => {
            this.db.get(qry, (error, data) => {
                if (error) {
                    log.error({ dbError: error },'Error on application lookup.');
                    return reject(new Error('Internal Error'));
                }

                return resolve( data.Item );
            });
        });
    }

    getUsers(app, userList) {
        return new Promise( (resolve, reject) => {
            let qry = { RequestItems: { users : {  } } };
            qry.RequestItems.users.Keys = userList.map(user => ({ appId: app, userId: user }));
            
            this.db.batchGet(qry, (error, data) => {
                if (error) {
                    log.error({ dbError: error },'Error on user lookup.');
                    return reject(new Error('Internal Error'));
                }

                return resolve( data.Responses.users.map( m => new User(m) ));
            });
        });
    }

    putUsers( userList) {
        return new Promise( (resolve, reject) => {
            let records = {
                RequestItems : {
                    users : userList.map( user => ( 
                        { PutRequest : { Item :  user.serialize() } } ) )
                }
            };
            this.db.batchWrite(records, (err, data) => {
                if (err) {
                    reject(err); 
                } else {
                    resolve(data);
                }
            });
        });
    }
}

module.exports = DataStore;
