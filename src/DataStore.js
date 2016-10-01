'use strict';

const aws       = require('aws-sdk');
const ld        = require('lodash');
const log       = require('./log');

class DataStore {

    constructor(config) {
        let opts = {};
        opts.region = ld.get(config,'region','us-east-1');
        if (ld.get(config,'endpoint')) {
            opts.endpoint = config.endpoint;
        }
        this.db = new aws.DynamoDB.DocumentClient(opts);
    }

    getApp(app, env ) {
        let qry = {
            TableName : 'applications',
            Key : {
                id  : app 
            }
        };

        return new Promise( (resolve, reject) => {
            this.db.get(qry, (error, data) => {
                if (error) {
                    log.error({ dbError: error },'Error on application lookup.');
                    return reject(new Error('Forbidden'));
                }

                log.info({ dbResult : data},'application lookup result.');

                let item = data.Item;

                if (!item) {
                    log.error(`Failed on application lookup, ${app} not found.`);
                    return reject(new Error('Forbidden'));
                }
                
                if (!item.active) {
                    log.error(`Failed on application lookup, ${app} not active.`);
                    return reject(new Error('Forbidden'));
                }

                return resolve(ld.assign({ id : item.id, name : item.name}, item.env[env]));
            });
        });
    }
}

module.exports = DataStore;
