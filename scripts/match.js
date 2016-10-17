'use strict';
/* eslint-disable no-console */

const OTPlanner = require('../src/OTPlanner');
const fuzzy = require('fuzzy');

let routerId = process.argv[2];
let search = process.argv[3];
let otp = new OTPlanner({ hostname : 'otp.mechinate.com:8080', routerId : routerId });

console.log(`Look for "${search}" using router ${routerId}`);
otp.findStops()
.then(results => {
    let matches = fuzzy.filter(search,results,{ extract: (s=> s.name)}).map(m => m.original);
    if (!matches.length) {
        let c = search.replace(/\W+/g,' ').split(' ');
        console.log('Search: ', c);
        matches = fuzzy.filter(c[0],results,{ extract: (s=> s.name)}).map(m => m.original);
    }

    console.log(matches);
})
.catch(err => {
    console.log(err);
});



