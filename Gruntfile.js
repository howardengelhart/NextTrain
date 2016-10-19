'use strict';
const path = require('path');
const Lambda = require('aws-sdk').Lambda;
const inspect = require('util').inspect;

module.exports = (grunt)=>  {

    grunt.initConfig({
        pkg : require('./package'),
        eslint : {
            target: ['index.js','Gruntfile.js','src/**/*.js',
                'tests/**/*.js', 'db/**/*.js', 'scripts/**/*.js']
        },

        lambda : {
            options : {
                src : [ '**/*.js' ]
            },
            webhook: {  },
            tripview: {  }
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
        },

        configureBot : {
            'testNJT' : {
                appId : 'next-sys-test',
                pageId : '303932029994147'
            },
            'testBART' : {
                appId : 'next-sys-test',
                pageId : '1419301661433153'
            },
            'nextNJT' : {
                appId : 'next-sys',
                pageId : '554561298060861'
            },
            'nextBART' : {
                appId : 'next-sys',
                pageId : '205643263198402'
            }
        },

        createTables : {
            test : {
                options : {
                    endpoint : 'http://localhost:8000',
                    drop : true
                }
            },
            prod : {
                options : {
                    drop : false
                }
            }
        },

        scanTables : {
            test : {
                options : {
                    endpoint : 'http://localhost:8000'
                }
            },
            prod : {
                options : { }
            }
        },

        putTables : {
            test : {
                options : {
                    endpoint : 'http://localhost:8000',
                    files : ['db/data/app-marco-test.js']
                }
            },
            prod : {
                options : {
                    files : ['db/data/app-marco-test.js']
                }
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
        let publish = grunt.option('publish');
        let pkg = grunt.config().pkg;
        let zipPath = path.join(opts.buildHome,opts.functionName +
            (publish ? `-${pkg.version}` : '') + '.zip');
        
        let lambda = new Lambda( { region : opts.region } );
        let tag = `${pkg.name}-${pkg.version.replace(/\./g,'_')}`;
        let ticker = setInterval(()=> grunt.log.write('.'), 1000);

        grunt.log.writelns('Deploy: ',zipPath);
        
        let lookupAlias = () => {
            return new Promise( (resolve, reject) => {
                if (!publish) {
                    return resolve({});
                }

                let params = {
                    FunctionName : opts.functionName,
                    Name : tag
                };

                lambda.getAlias(params, (err, data) => {
                    if (err) {
                        if (err.statusCode === 404) {
                            data = err;
                        } else {    
                            return reject(err);
                        }
                    } else {
                        if (!grunt.option('update')) {
                            return reject(new Error(
                                `Alias ${tag} already exists, delete or use --update.`
                            ));
                        }
                    }

                    grunt.log.debug('getAlias data:',data);
                    return resolve({lookupAlias : data});
                });
            });
        };


        let updateCode = (results) => {
            return new Promise( (resolve, reject) => {
                let params = {
                    FunctionName: opts.functionName,
                    Publish: opts.publish,
                    ZipFile : grunt.file.read(zipPath, { encoding : null })
                };

                lambda.updateFunctionCode(params, function(err, data) {
                    if (err) {
                        grunt.log.debug('updateCode err:',err);
                        return reject(err);
                    }
                  
                    grunt.log.debug('updateCode data:',data);
                    results.updateCode = data;
                    return resolve(results);
                });
            });
        };

        let setAlias = (results) => {
            return new Promise( (resolve, reject) => {
                if (!publish) {
                    return resolve(results);
                }

                let params = {
                    FunctionName : results.updateCode.FunctionName,
                    FunctionVersion : results.updateCode.Version,
                    Name : tag,
                    Description : `${results.updateCode.FunctionName} version ${tag}`
                };

                let method = 'createAlias';
                if (results.lookupAlias.FunctionVersion) {
                    method = 'updateAlias';
                }

                lambda[method](params, function(err, data) {
                    if (err) {
                        grunt.log.debug(`${method} err:`,err);
                        return reject(err);
                    }
                   
                    grunt.log.debug(`${method} data:`,data);
                    results.setAlias = data;
                    return resolve(results);
                });
            });
        };

        lookupAlias()
        .then(updateCode)
        .then(setAlias)
        .then(results => {
            grunt.log.writelns('.');
            clearInterval(ticker);
            grunt.log.writeflags(results.updateCode, 'updateFunctionCode Result');
            if (results.setAlias) {
                grunt.log.writeflags(results.setAlias, 'setAlias Result');
            }
            done(true);
        })
        .catch(err => {
            grunt.log.writelns('.');
            clearInterval(ticker);
            grunt.log.errorlns('lambdaUpload failed:', err);
            done(false);
        });
    }

    function lambdaRelease(opts) {
        let done = this.async();
        let target = grunt.option('target');
        
        if (!target) {
            grunt.log.errorlns('Requires a --target parameter.');
            return done(false);
        }

        let pkg = grunt.config().pkg;
        
        let lambda = new Lambda( { region : opts.region } );
        let tag = grunt.option('version') || `${pkg.name}-${pkg.version.replace(/\./g,'_')}`;
        let ticker = setInterval(()=> grunt.log.write('.'), 1000);

        grunt.log.writelns(`Release ${tag} to ${target}.`);
        let lookupVersionAlias = () => {
            return new Promise( (resolve, reject) => {
                let params = {
                    FunctionName : opts.functionName,
                    Name : tag
                };

                lambda.getAlias(params, (err, data) => {
                    if (err) {
                        grunt.log.debug('err:',err);
                        return reject(err);
                    }

                    grunt.log.debug('getAlias-Version data:',data);
                    return resolve({versionAlias : data});
                });
            });
        };

        let lookupTargetAlias = (results) => {
            return new Promise( (resolve, reject) => {
                let params = {
                    FunctionName : opts.functionName,
                    Name : target
                };

                lambda.getAlias(params, (err, data) => {
                    if (err) {
                        if (err.statusCode === 404) {
                            data = err;
                        } else {    
                            return reject(err);
                        }
                    }

                    grunt.log.debug('getAlias-Target data:',data);
                    results.targetAlias = data;
                    return resolve(results);
                });
            });
        };

        let setTargetAlias = (results) => {
            return new Promise( (resolve, reject) => {
                let params = {
                    FunctionName : opts.functionName,
                    FunctionVersion : results.versionAlias.FunctionVersion,
                    Name : target,
                    Description : `${opts.functionName} version ${target}`
                };

                let method = 'createAlias';
                if (results.targetAlias.FunctionVersion) {
                    method = 'updateAlias';
                }

                grunt.log.debug(`method=${method},params=`,params);
                lambda[method](params, function(err, data) {
                    if (err) {
                        grunt.log.debug(`${method} err:`,err);
                        return reject(err);
                    }
                   
                    grunt.log.debug(`${method} data:`,data);
                    results.setTargetAlias = data;
                    return resolve(results);
                });
            });
        };
        
        lookupVersionAlias()
        .then(lookupTargetAlias)
        .then(setTargetAlias)
        .then(results => {
            grunt.log.writelns('.');
            clearInterval(ticker);
            grunt.log.writeflags(results.setTargetAlias, 'setTargetAlias Result');
            done(true);
        })
        .catch(err => {
            grunt.log.writelns('.');
            clearInterval(ticker);
            grunt.log.errorlns('lambdaRelease failed:', err);
            done(false);
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
        } else 
        if (action === 'release') {
            func = lambdaRelease.bind(this);
        } else  {
            grunt.log.errorlns(`Unexpected action: ${action}`);
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
        let Tasks;
        let target = grunt.option('target');

        if (cmd) {
            Tasks = [
                `lambdaBuild:${cmd}`, 
                `lambdaUpload:${cmd}`
            ];
            if (target) {
                Tasks.push(`lambdaRelease:${cmd}`);
            }

        } else {
            Tasks = [
                'lambdaBuild',
                'lambdaUpload'
            ];
            if (target) {
                Tasks.push('lambdaRelease');
            }
        }

        grunt.task.run(Tasks);
    });
    
    grunt.registerTask('lambdaRelease', function(cmd) {
        grunt.option('action','release');
        grunt.task.run([ `lambda${cmd ? ':' + cmd : ''}`, ]);
    });

    grunt.registerMultiTask('createTables', function() {
        const tableDefs = require('./db/tables');
        const dynamoUtils = require('./tests/helpers/dynamodb');
        let done = this.async();

        let opts = this.options({
            region : grunt.option('region') || 'us-east-1',
            tables : grunt.option('tables') || Object.keys(tableDefs)
        });
        if (!Array.isArray(opts.tables)) {
            opts.tables = opts.tables.split(',');
        }

        if (grunt.option('drop') !== undefined) {
            opts.drop = grunt.option('drop');
        }

        grunt.log.debug('opts:',opts);

        let awsOpts = { region : opts.region };
        if (opts.endpoint){
            awsOpts.endpoint  = opts.endpoint;
        }

        function dropTables() {
            if (!opts.drop) {
                return Promise.resolve();
            }
            return dynamoUtils.deleteTables(opts.tables, awsOpts)
                .then( () => {
                    return new Promise( resolve  =>  {
                        setTimeout(resolve, 2000);
                    });
                });
        }

        function createTables() {
            let params = opts.tables.map( t => tableDefs[t] );
            return dynamoUtils.createTables(params, awsOpts);
        }

        grunt.log.writelns('Creating tables: ', opts.tables);
        dropTables()
        .then(createTables)
        .then(res => {
            grunt.log.debug(inspect(res,{ depth : null }));
            return done(true);
        })
        .catch( err => {
            grunt.log.errorlns(err.message);
            return done(false);
        });
    });

    grunt.registerMultiTask('putTables', function() {
        const dynamoUtils = require('./tests/helpers/dynamodb');
        let done = this.async();

        let opts = this.options({
            region : grunt.option('region') || 'us-east-1'
        });
        
        grunt.log.debug('opts:',opts);

        let awsOpts = { region : opts.region };
        if (opts.endpoint){
            awsOpts.endpoint  = opts.endpoint;
        }

        return Promise.all(opts.files.map(datafile => {
            grunt.log.writelns(`Load data from: ${datafile}`);
            return dynamoUtils.putRecords(require(path.resolve(datafile)), awsOpts)
                .then( res => {
                    grunt.log.debug(inspect(res,{ depth : null }));
                    return res;
                });
        }))
        .then(() => {
            return done(true);
        })
        .catch( err => {
            grunt.log.errorlns(err.message);
            return done(false);
        });
    });

    grunt.registerMultiTask('scanTables', function() {
        const dynamoUtils = require('./tests/helpers/dynamodb');
        const tableDefs = require('./db/tables');
        let done = this.async();

        let opts = this.options({
            region : grunt.option('region') || 'us-east-1',
            tables : grunt.option('tables') || Object.keys(tableDefs)
        });
        if (!Array.isArray(opts.tables)) {
            opts.tables = opts.tables.split(',');
        }

        grunt.log.debug('opts:',opts);

        let awsOpts = { region : opts.region };
        if (opts.endpoint){
            awsOpts.endpoint  = opts.endpoint;
        }

        return Promise.all(opts.tables.map(table => {
            grunt.log.debug(`Scanning table: ${table}`); 
            return dynamoUtils.scanTable(table, awsOpts)
                .then( res => {
                    grunt.log.writelns(`Table =====> ${table}`);
                    grunt.log.writelns(inspect(res,{ depth : null }));
                    return res;
                });
        }))
        .then(() => done(true) )
        .catch( err => {
            grunt.log.errorlns(err.message);
            return done(false);
        });
    });

    grunt.registerMultiTask('configureBot', function() {
        const DataStore = require('./src/DataStore');
        const fb = require('thefacebook');

        let done = this.async();
        //let config = this.data;
        let setting = new fb.ThreadSetting();

        let setGreeting = (data) => {
            if (!data.greetingText) {
                return setting.remove(new fb.GreetingText(), data.token)
                    .then(() => data, () => data);
            }
            grunt.log.writelns('set greeting text');
            return setting.apply(new fb.GreetingText(data.greetingText), data.token)
                .then((resp) => { grunt.log.debug('setGreeting:',resp); return data; });
        };

        let setStart = (data) => {
            if (!data.getStarted) {
                return setting.remove(new fb.GetStartedButton(), data.token)
                    .then(() => data, () => data);
            }

            grunt.log.writelns('set get started button');
            return setting.apply(
                new fb.GetStartedButton({ payload : data.getStarted }), data.token)
                    .then((resp) => { grunt.log.debug('getStarted:',resp); return data; });
        };

        let setMenu = (data) => {
            if (!data.persistentMenu) {
                return setting.remove(new fb.PersistentMenu(), data.token)
                    .then(() => data, () => data);
            }
            grunt.log.writelns('set persistent menu');
            return setting.apply(
                new fb.PersistentMenu( data.persistentMenu) , data.token)
                    .then((resp) => { grunt.log.debug('setPersistent:',resp); return data; });
        };

        let getAppPage = (cfg) => {
            let ds = new DataStore();
            grunt.log.writelns(`Lookup app: ${cfg.appId}, page: ${cfg.pageId}`);
            return ds.getApp(cfg.appId)
            .then((app) => {
                let page =  app.facebook.pages.filter((page) => (page.id === cfg.pageId))[0];
                page.getStarted = page.getStarted || app.facebook.getStarted;
                page.greetingText = page.greetingText || app.facebook.greetingText;
                page.persistentMenu = page.persistentMenu || app.facebook.persistentMenu;
                grunt.log.debug('Page config:',page);
                return page;
            });
        };

        getAppPage(this.data)
        .then(setGreeting)
        .then(setStart)
        .then(setMenu)
        .then(() => done(true) )
        .catch(e => {
            grunt.log.errorlns(e);
            done(false);
        });
    });
};
