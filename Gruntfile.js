'use strict';
const path = require('path');
const Lambda = require('aws-sdk').Lambda;

module.exports = (grunt)=>  {

    grunt.initConfig({
        eslint : {
            target: ['index.js','Gruntfile.js','src/**/*.js','tests/**/*.js']
        },

        lambda : {
            options : {
                src : [ '**/*.js' ]
            },
            webhook: {  }
        },

        jasmine_nodejs : {
            options : {
                specNameSuffix: '.spec.js'
            },

            unit : {
                specs : [ 'tests/unit/**' ]
            },

            e2e : {
                specs : [ 'tests/e2e/**' ]
            }

        },

        watch : {
            options: {
                atBegin : true,
                debounceDelay : 1000,
                event : [ 'added', 'changed' ],
                forever : true
            },
            scripts : {
                files : [ 'index.js', 'Gruntfile.js', 'src/**/*.js',
                            'tests/unit/**', 'tests/e2e/**' ],
                tasks : [ 'eslint', 'test:unit' ],
            }
        }
    });

    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-jasmine-nodejs');
    grunt.loadNpmTasks('grunt-contrib-watch');

    grunt.registerTask('test:unit', [
        'eslint',
        'jasmine_nodejs:unit'
    ]);
    
    grunt.registerTask('test:e2e', [
        'eslint',
        'jasmine_nodejs:e2e'
    ]);

    function lambdaRun(opts) {
        let done = this.async();
        let mockEvent = grunt.option('mock-event') ||
            path.resolve(path.join('mocks',`${opts.functionName}.event.json`));
        let mockEnv = grunt.option('mock-env') ||
            path.resolve(path.join('mocks',`${opts.functionName}.env.json`));

        let env, evt, lambda, key, context, started = Date.now();

        if (grunt.file.exists(mockEnv)) {
            env = grunt.file.readJSON(mockEnv);
            for (key in env) {
                process.env[key] = env[key];
            }
        }

        if (grunt.file.exists(mockEvent)) {
            evt = grunt.file.readJSON(mockEvent);
        } else {
            evt = {
                key1 : 'value1',
                key2 : 'value2',
                key3 : 'value3'
            };
        }

        delete require.cache[opts.functionPath];
        lambda  = require(opts.functionPath);
        
        context = {
            functionName : opts.functionName,
            functionVersion : '$LATEST',
            getRemainingTimeInMillis : function() {
                return Math.max(30000 - (Date.now() - started),0);
            },
            succeed : function(data) {
                grunt.log.writelns(`${opts.functionName} Completed: ` + (data || '' ));
                done(true);
            },
            fail    : function(err) {
                grunt.log.errorlns(`${opts.functionName} ` + err);
                done(false);
            },
            done : function(err,data){
                if (err) {
                    this.fail(err);
                } else {
                    this.succeed(data);
                }
            }
        };

        try {
            lambda.handler(evt,context);
        } 
        catch(e) {
            grunt.log.errorlns(`${opts.functionName} ` + e);
            done(false);
        }
    }

    function lambdaBuild(opts) {
        const fs = require('fs');
        let done = this.async();

        let zipPath = path.join(opts.buildHome,opts.functionName +
            (grunt.option('publish') ? '-' + grunt.config().pkg.version : '') + '.zip');

        let archive = new require('archiver')('zip');

        if (!grunt.file.exists(opts.buildHome)){
            grunt.file.mkdir(opts.buildHome);
        }

        if (grunt.file.exists(zipPath)){
            grunt.file.delete(zipPath);
        }

        grunt.log.writelns('Build: ',zipPath);
        function createNodeDeps() {
            grunt.log.writelns('Build dependencies');
            return new Promise((resolve, reject) => {
                try {
                    grunt.file.copy('./package.json',path.join(opts.buildHome,'package.json'));
                } catch(e) {
                    return reject(e);
                }

                let ticker = setInterval(()=> grunt.log.write('.'), 1000);
                let cmdOpts = {
                    cmd : 'npm',
                    args: ['install','--production'],
                    opts : {
                        cwd : opts.buildHome
                    }
                };
                grunt.util.spawn(cmdOpts, (error, result ) => {
                    grunt.log.writelns('.');
                    clearInterval(ticker);
                    if (error) {
                        reject(error);
                    } else {
                        resolve(result);
                    }
                });
            });
        }

        function writeArchive() {
            grunt.log.writelns('Write zip file.');
       
            return new Promise((resolve, reject) => {
                let output = fs.createWriteStream(zipPath);
                output.on('close', () => {
                    resolve(archive);
                });
                output.on('error', reject);
                archive.on('error', reject);
                archive.pipe(output);
                archive.bulk([
                    {
                        expand : true,
                        cwd: opts.functionHome,
                        src : opts.src,
                        dot : true
                    }
                ]);
                archive.directory(path.join(opts.buildHome,'node_modules'),'node_modules');
                archive.finalize();
            });
        }

        createNodeDeps()
        .then(writeArchive)
        .then(() => {
            grunt.file.delete(path.join(opts.buildHome,'node_modules'));
            grunt.file.delete(path.join(opts.buildHome,'package.json'));
            return done(true);
        })
        .catch((err) => {
            grunt.log.errorlns(opts.functionName + ' ' + err.message);
            return done(false);
        });
    }

    function lambdaUpload(opts){
        let done = this.async();

        let zipPath = path.join(opts.buildHome,opts.functionName +
            (grunt.option('publish') ? '-' + grunt.config().pkg.version : '') + '.zip');
        
        let lambda = new Lambda( { region : opts.region } );

        let params = {
            FunctionName: opts.functionName,
            Publish: opts.publish,
            ZipFile : grunt.file.read(zipPath, { encoding : null })
        };

        let ticker = setInterval(()=> grunt.log.write('.'), 1000);

        grunt.log.writelns('Deploy: ',zipPath);

        lambda.updateFunctionCode(params, function(err, data) {
            grunt.log.writelns('.');
            clearInterval(ticker);
            if (err) {
                grunt.log.errorlns(opts.functionName + ' ' + err.message);
                return done(false);
            }
           
            grunt.log.writeflags(data,'updateFunctionCode Result');
            return done(true);
        });
    }
   
    grunt.registerMultiTask('lambda', function() {
        let action = grunt.option('action') || 'run';
        let func;
        let opts     = this.options({
            functionName : this.target,
            functionHome : path.resolve('src'),
            buildHome    : path.resolve('dist'),
            publish      : !!grunt.option('publish'),
            region       : grunt.option('region') || 'us-east-1',
            src          : [ 'index.js' ]
        });

        opts.functionPath = opts.functionPath ||
            path.join(opts.functionHome,`${opts.functionName}.js`);

        if (action === 'run') {
            func = lambdaRun.bind(this);
        } else
        if (action === 'build') {
            func = lambdaBuild.bind(this);
        } else 
        if (action === 'upload') {
            func = lambdaUpload.bind(this);
        } else {
            grunt.log.error(`Unexpected action: ${action}`);
            return false;
        }

        func(opts);
    });

    grunt.registerTask('lambdaBuild', function(cmd) {
        grunt.option('action','build');
        grunt.task.run([ `lambda${cmd ? ':' + cmd : ''}`, ]);
    });

    grunt.registerTask('lambdaUpload', function(cmd) {
        grunt.option('action','upload');
        grunt.task.run([ `lambda${cmd ? ':' + cmd : ''}`, ]);
    });

    grunt.registerTask('lambdaDeploy', function(cmd) {
        if (cmd) {
            grunt.task.run([
                `lambdaBuild:${cmd}`, 
                `lambdaUpload:${cmd}`
            ]);
        } else {
            grunt.task.run([
                'lambdaBuild',
                'lambdaUpload'
            ]);
        }
    });
};
