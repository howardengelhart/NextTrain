'use strict';

exports.createMockContext = (functionName) => {
    return {
        functionName : functionName,
        functionVersion : '$LATEST',
        getRemainingTimeInMillis : jasmine.createSpy('context.getRemMillis'),
        succeed : jasmine.createSpy('context.succeed'),
        fail : jasmine.createSpy('context.fail')
    };
};

exports.createMockLog = () => {
    return {
        level : jasmine.createSpy('log.level'),
        info : jasmine.createSpy('log.info'),
        warn : jasmine.createSpy('log.warn'),
        debug : jasmine.createSpy('log.debug'),
        trace : jasmine.createSpy('log.trace'),
        error : jasmine.createSpy('log.error')
    };
};
