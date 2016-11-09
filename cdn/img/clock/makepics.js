'use strict';

const spawn = require('child_process').spawn;
const S3 = require('aws-sdk').S3;

const IMAGES = {
    '0.png' : { width : 78, height : 148 },
    '1.png' : { width : 45, height : 145 },
    '2.png' : { width : 79, height : 145 },
    '3.png' : { width : 78, height : 148 },
    '4.png' : { width : 83, height : 144 },
    '5.png' : { width : 79, height : 145 },
    '6.png' : { width : 79, height : 148 },
    '7.png' : { width : 77, height : 142 },
    '8.png' : { width : 79, height : 148 },
    '9.png' : { width : 79, height : 148 },
    'bar.png' : { width : 243, height : 15 },
    'clockface.png' : { width : 496, height : 266 },
    'am.png' : { width : 35, height : 21 },
    'pm.png' : { width : 33, height : 21 },
    'sun.png' : { width : 47, height : 22 },
    'mon.png' : { width : 51, height : 22 },
    'tue.png' : { width : 46, height : 22 },
    'wed.png' : { width : 54, height : 21 },
    'thu.png' : { width : 46, height : 22 },
    'fri.png' : { width : 34, height : 21 },
    'sat.png' : { width : 45, height : 22 },
    'departing.png' : { width : 193, height : 54 },
    'arriving.png' : { width : 192, height : 54 }
};

const CLOCK_WIDTH = IMAGES['clockface.png'].width / 2;
const MARGIN_DAY = { x : 20, y : IMAGES['clockface.png'].height - IMAGES['mon.png'].height - 20 };
const MARGIN_MER = { x : IMAGES['clockface.png'].width - IMAGES['am.png'].width - 20, y : MARGIN_DAY.y};
const MARGIN_DIG = { y : ((IMAGES['clockface.png'].height - IMAGES['9.png'].height) / 2)  };

function formatFilter(direction,day,meridian,digit1,digit2,digit3,digit4) {
    let result = { command : 'ffmpeg', args : [] };
    let inputs = [ 'clockface.png', 'bar.png', day, meridian, direction,
        digit1, digit2, digit3, digit4 ];
    
    if (inputs[5] === undefined) {
        inputs.splice(5,1);
    }

    let i = {
        cl : 0,
        br : 1,
        dy : 2,
        mr : 3,
        dr : 4,
        d1: 5,
        d2: digit1 === undefined ? 5 : 6,
        d3: digit1 === undefined ? 6 : 7,
        d4: digit1 === undefined ? 7 : 8
    };

    for (let file of inputs) {
        result.args.push('-i');
        result.args.push(`${file}`);
    }

    let d1X,d2X,d3X,d4X,dY,b1X,b2X,bY,drX,drY;

    let calcDW = (d1,d2) => ((CLOCK_WIDTH - (IMAGES[d1].width + IMAGES[d2].width + 40)) / 2);
     
    let pad;
    if (digit1) {
        pad = calcDW(digit1,digit2);
        d1X = pad;
        d2X = CLOCK_WIDTH - pad - IMAGES[digit2].width;
    } else {
        d2X = ((IMAGES['clockface.png'].width / 2) - IMAGES[digit2].width) / 2;
    }

    pad = calcDW(digit3,digit4);
    d3X = CLOCK_WIDTH + pad;
    d4X = (2 * CLOCK_WIDTH) - pad - IMAGES[digit4].width;

    dY = MARGIN_DIG.y;
    bY = dY + (IMAGES[digit2].height / 2);
    b1X = 8;
    b2X = CLOCK_WIDTH + 4;

    drY=0;
    drX=Math.round(((CLOCK_WIDTH * 2) - (IMAGES[direction].width )) / 2);
    result.args.push('-filter_complex');
    let filter = `'[${i.cl}][${i.dy}]overlay=${MARGIN_DAY.x}:${MARGIN_DAY.y}[d];`;
    filter += `[d][${i.mr}]overlay=${MARGIN_MER.x}:${MARGIN_MER.y}[m];`;
    if (digit1 !== undefined) {
        filter += `[m][${i.d1}]overlay=${d1X}:${dY}[h1];[h1][${i.d2}]overlay=${d2X}:${dY}[hr];`;
    } else {
        filter += `[m][${i.d2}]overlay=${d2X}:${dY}[hr];`;
    }
    filter += `[hr][${i.br}]overlay=${b1X}:${bY}[b1];`;
    filter += `[b1][${i.d3}]overlay=${d3X}:${dY}[m1];[m1][${i.d4}]overlay=${d4X}:${dY}[mn];`;
    filter += `[mn][${i.br}]overlay=${b2X}:${bY}[mo];[mo][${i.dr}]overlay=${drX}:${drY}'`;
    result.args.push(filter);
    result.args.push('-y');

    let parts = [day, meridian, digit1, digit2, digit3, digit4].map(part => {
        if (part !== undefined) {
            part = part.replace('.png','');
        }
        if (part === 'sun') { return '0'; } else
        if (part === 'mon') { return '1'; } else 
        if (part === 'tue') { return '2'; } else
        if (part === 'wed') { return '3'; } else
        if (part === 'thu') { return '4'; } else
        if (part === 'fri') { return '5'; } else
        if (part === 'sat') { return '6'; } else
        if (part === 'am') { return '0'; } else
        if (part === 'pm') { return '1'; } else
        if (part === undefined) { return '0'; } else
        return part;
    });

    let outPut = `./out/${direction.replace('.png','')}_${parts[0]}_${parts[1]}_${parts[2]}${parts[3]}_${parts[4]}${parts[5]}.png`;
    result.args.push(outPut);
    result.output = outPut;
    return result;
}


let cmds = [];
for (let direction of [ 'arriving.png', 'departing.png']) { 
    for (let day of [ 'sun.png', 'mon.png', 'tue.png', 'wed.png', 
        'thu.png', 'fri.png', 'sat.png' ] ) {
        for (let meridian of [ 'am.png', 'pm.png' ]) {
            for (let hour =1; hour <= 12; hour++ ) {
                for (let minute = 0; minute <= 59; minute++) {
                    let digit1, digit2, digit3, digit4;
                    if (hour > 9 ) {
                        digit1 = '1.png';
                        digit2 = `${hour % 10}.png`;
                    } else {
                        digit2 = `${hour}.png`;
                    }

                    for (let tmin = 50; tmin >= 0; tmin -=10) {
                        if (minute >= tmin) {
                            digit3 = `${tmin / 10}.png`;
                            if (tmin > 0) {
                                digit4 = `${minute % tmin}.png`;
                            } else {
                                digit4 = `${minute}.png`;
                            }
                            break;
                        }
                    }
                    cmds.push(formatFilter(direction,day,meridian,digit1,digit2,digit3,digit4));
                }
            }
        }
    }
}

for (let c of cmds) {
    console.log(`${c.command} ${c.args.join(' ')}`);
}


function createPng(cmd) {
    return new Promise((resolve,reject) => {
        let proc = spawn(cmd.command, cmd.args, { cwd : '.', shell : '/bin/bash' });
        proc.on('close', code => {
            resolve(cmd);
        });

        proc.stdout.on('data', data => {
            console.log(`stdout: ${data}`);
        });
        
        proc.stderr.on('data', data => {
            console.log(`stderr: ${data}`);
        });

        proc.on('error', err => {
            reject(err);
        });
    });
}

function uploadPng(cmd) {

}

function deletePng(cmd) {

}

function work() {
    let cmd = cmds.shift();
    if (!cmd) {
        return Promise.resolve();
    }

    //console.log('Process: ', cmd);
    console.log(`Process ${cmd.output}`);
    return createPng(cmd).then(work);
}

//work()
//.then(() => {
//    console.log('all done.');
//})
//.catch((err) => {
//    console.log('ERROR:', err.stack);
//});



