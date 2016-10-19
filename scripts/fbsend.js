'use strict';
/* eslint-disable no-console */
/* eslint-disable max-len */
const fb = require('thefacebook');

let userId1 = '1134369433316195';
//let userId2 = '1213646378699370';
let token1 = 'EAAFcCPRVltABAHUcueV6iYP1U6WJ0E95TDxS3OCO0C7ksiRRQ9t0ZA9NnighKmLOuvMYdHJM6OZBXYY0bPalcM9yywNpN2BJTgD4QQHIc1QN5ZCK1hMqticAZBt8w4kW6UgmTOAdEcevXer4WHqJvNnhaKKjeuDDrM7sdN3eNAZDZD';
//let token2 = 'EAAFcCPRVltABABppRMrq7DmdTg41Illz7ZAxOqENgChbUrat0LwGI0Bz4v83YIYe6p4ugxBP8nBVcz810lOIWsK72xoMzdoQsTQZCpIJe1cjKvdSjhhEk6Bzgoj8Q09zD00TlROG1ygUKwBGGbUsj9xazzvMLpt4ZAcLcya0AZDZD';

let templ = new fb.GenericTemplate();
let cfg = {
    title : 'Blah blah blah',
    subtitle : 'some general things that can be said',
    image_url : 'https://s3.amazonaws.com/next-sys/img/0_0_03_28.png'
};

cfg.buttons = [
    new fb.ShareButton()
];

templ.elements.push(new fb.GenericTemplateElement(cfg));
let message = new fb.Message();
message.send( userId1, templ, token1)
.then((resp) => {
    console.log(resp);
})
.catch((err) => {
    console.log(err);
});

