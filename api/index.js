// Vercel Serverless Function entry point
// Imports the compiled Express app from dist/server.cjs
const app = require('../dist/server.cjs').default;

module.exports = app;
