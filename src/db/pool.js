const mysql = require('mysql2/promise');
const config = require('../config/env');

// Shared MySQL connection pool. Every module talks to the database through this
// single instance -- do not create additional pools.
const db = mysql.createPool(config.db);

module.exports = db;
