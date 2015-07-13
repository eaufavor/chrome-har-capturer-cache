#!/usr/bin/env node

var fs = require('fs');
var colors = require('colors');
var program = require('commander');
var chc = require('../');

program
    .usage('[options] URL...')
    .option('-t, --host <host>', 'Remote Debugging Protocol host')
    .option('-p, --port <port>', 'Remote Debugging Protocol port')
    .option('-o, --output <file>', 'dump to file instead of stdout')
    .option('-c, --content', 'also capture the requests body')
    .option('-d, --delay <ms>', 'time to wait after the load event')
    .option('-v, --verbose', 'enable verbose output on stderr')
    .option('-r, --repeat', 'clean connections and DNS but not cache for a repeat view')
    .option('-n, --normal', 'clean no connections no cache and no DNS')
    .parse(process.argv);

if (program.args.length === 0) {
    program.outputHelp();
    process.exit(1);
}

var output = program.output;
var urls = program.args;
var c = chc.load(urls, {
    'host': program.host,
    'port': program.port,
    'fetchContent': program.content,
    'onLoadDelay': program.delay,
    'repeatView': program.repeat,
    'normalView': program.normal
});

if (program.verbose) {
    chc.setVerbose();
}

c.on('pageEnd', function (url) {
    var status = 'DONE';
    if (process.stderr.isTTY) status = status.green;
    console.error(status + ' ' + url);
});
c.on('pageError', function (url, text) {
    var status = 'FAIL';
    if (process.stderr.isTTY) status = status.red;
    console.error(status + ' ' + url + ' ' + text);
});
c.on('end', function (har) {
    var json = JSON.stringify(har, null, 4);
    if (program.output) {
        fs.writeFileSync(output, json);
    } else {
        console.log(json);
    }
});
c.on('error', function (err) {
    console.error('Cannot connect to Chrome');
    console.error(err.toString());
    process.exit(1);
});
