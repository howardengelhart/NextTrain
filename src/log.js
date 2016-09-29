'use strict';

const bunyan = require('bunyan');
const data = {};

if (!data.log){
    data.log = bunyan.createLogger({ name : 'screenjack', level : 'info' });
}

module.exports = data.log;
