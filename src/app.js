const express = require('express');
const path = require('path');

const apiRoutes = require('./routes');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', apiRoutes);

module.exports = app;
