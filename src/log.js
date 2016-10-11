'use strict';
    
const bunyan = require('bunyan');

let log;

if (!log){
    log = bunyan.createLogger({ name : 'marco', level : 'info' });
}

module.exports = log;
