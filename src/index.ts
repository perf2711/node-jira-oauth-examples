import express from 'express';

let app: express.Application;
const argv = process.argv.slice(2);
switch (argv[0]) {
    case '1':
    case '1.0':
        app = require('./oauth1').default;
        break;
    case '2':
    case '2.0':
        app = require('./oauth2').default;
        break;
    default:
        throw new Error('unknown argument');
}

app.listen(3000);
