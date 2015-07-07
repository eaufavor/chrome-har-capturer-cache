var events = require('events');
var util = require('util');
var Chrome = require('chrome-remote-interface');
var common = require('./common.js');
var Page = require('./page.js');
var har = require('./har.js');

var NEUTRAL_URL = 'about:blank';

var CLEANUP_SCRIPT_FIRST =
    'chrome.benchmarking.clearCache();' +
    'chrome.benchmarking.clearHostResolverCache();' +
    'chrome.benchmarking.clearPredictorCache();' +
    'chrome.benchmarking.closeConnections();';

var CLEANUP_SCRIPT_REPEAT =
    'chrome.benchmarking.clearHostResolverCache();' +
    'chrome.benchmarking.closeConnections();';

var PAGE_DELAY = 1000;

function checkEnd(c, url, obj, page) {
    c.Runtime.evaluate({'expression': "performance.getEntriesByName('"+url+"')[0].responseEnd;", 'returnByValue': true},
        function (error, response){
            common.dump('--- RT: responseEnd: '+
                        response.result.value +
                        " resFinMs: " +
                        (obj.responseFinishedMs - page.originalRequestMs)  +
                        ' for ' + url);
        });
    c.Runtime.evaluate({'expression': "performance.getEntriesByName('"+url+"')[0].startTime;", 'returnByValue': true},
        function (error, response){
            common.dump('--- RT: startTime: '+
                        response.result.value +
                        " requestWillBeSent: " +
                        (obj.requestMessage.timestamp*1000 - page.originalRequestMs)  +
                        " requestTime " +
                        (obj.responseMessage.response.timing.requestTime*1000 - page.originalRequestMs)  +
                        ' for ' + url);
        });
}

function Client(urls, options) {
    var self = this;
    var pages = [];
    options = options || {};
    options.fetchContent = !!(options.fetchContent) || false;
    options.repeatView = !!(options.repeatView) || false;
    options.normalView = !!(options.normalView) || false;
    options.onLoadDelay = options.onLoadDelay || 0;
    // start the instrumentation
    Chrome(options, function (chrome) {
        function loadUrl(index) {
            if (index < urls.length) {
                var url = urls[index];
                var page = new Page(index, url, chrome, options.fetchContent);
                var loadEventTimeout;
                pages[index] = page;
                // load a neutral page before the user provided URL since
                // there's no way to stop pending loadings using the protocol
                chrome.Page.navigate({'url': NEUTRAL_URL}, function (error, response) {
                    if (error) {
                        // probably never emitted...
                        self.emit('error', new Error('Cannot load URL'));
                        chrome.close();
                    }
                });
                // wait its completion before starting with the next user-defined URL
                var neutralFrameid;
                chrome.on('event', function (message) {
                    switch (message.method) {
                    case 'Page.frameNavigated':
                        // save the frame id of the neutral URL
                        var frame = message.params.frame;
                        if (frame.url === NEUTRAL_URL) {
                            neutralFrameid = frame.id;
                        }
                        break;
                    case 'Page.frameStoppedLoading':
                        // load the next URL when done
                        if (message.params.frameId === neutralFrameid) {
                            chrome.removeAllListeners('event');
                            // inject the JavaScript code and load this URL
                            common.dump('--- Start: ' + url);
                            self.emit('pageStart', url);
                            var CLEANUP_SCRIPT = CLEANUP_SCRIPT_FIRST;
                            if (options.repeatView) {
                                CLEANUP_SCRIPT = CLEANUP_SCRIPT_REPEAT;
                                common.dump('--- repeatView enabled!');
                            }
                            if (options.normalView) {
                                CLEANUP_SCRIPT = '';
                                PAGE_DELAY = 50;
                                common.dump('--- normalView enabled!');
                            }
                            chrome.Runtime.evaluate({'expression': CLEANUP_SCRIPT}, function (error, response) {
                                // error with the communication or with the JavaScript code
                                if (error || (response && response.wasThrown)) {
                                    var errorDetails = JSON.stringify(response, null, 4);
                                    var errorMessage = 'Cannot inject JavaScript: ' + errorDetails;
                                    common.dump(errorMessage);
                                    self.emit('error', new Error(errorMessage));
                                    chrome.close();
                                } else {
                                    chrome.Page.navigate({'url': url}, function (error, response) {
                                        if (error) {
                                            self.emit('error', new Error('Cannot load URL'));
                                            chrome.close();
                                        }
                                    });
                                }
                            });
                            // then process events
                            chrome.on('event', function (message) {
                                page.processMessage(message);
                                // check if done with the current URL
                                if (page.isFinished() && typeof loadEventTimeout === 'undefined') {
                                    // keep listening for events for a certain amount of time
                                    // after the load event is triggered
                                    for (var requestId in page.objects) {
                                        var object = page.objects[requestId];
                                        if (!object.responseMessage || !object.responseFinishedMs ||
                                            !object.responseMessage.response.timing ||
                                            object.requestMessage.request.url.match('^data:')) {
                                            continue;
                                        }
                                        //var obj_url = object.requestMessage.request.url;
                                        //checkEnd(chrome, obj_url, object, page);
                                    }

                                    loadEventTimeout = setTimeout(function () {
                                        common.dump('--- End: ' + url);
                                        self.emit(page.isFailed() ? 'pageError' : 'pageEnd', url);
                                        chrome.removeAllListeners('event');
                                        // start the next URL after a certain delay
                                        // so to "purge" any spurious requests
                                        setTimeout(function () {
                                            loadUrl(index + 1);
                                        }, PAGE_DELAY);
                                    }, options.onLoadDelay);
                                }
                            });
                        }
                        break;
                    }
                });
            } else {
                // no more URLs to process
                chrome.close();
                self.emit('end', har.create(pages));
            }
        }
        self.emit('connect');
        // preliminary global setup
        chrome.Page.enable();
        chrome.Network.enable();
        chrome.Network.setCacheDisabled({'cacheDisabled': false});
        if (!options.repeatView && ! options.normalView) {
            common.dump('--- clearing cache!');
            chrome.Network.clearBrowserCache();
        }
        // start!
        chrome.once('ready', function () {
            loadUrl(0);
        });
    }).on('error', function (err) {
        common.dump("Emitting 'error' event: " + err.message);
        self.emit('error', err);
    });
}

util.inherits(Client, events.EventEmitter);

module.exports = Client;
