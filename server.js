// Entry point. Everything else lives under src/ -- see src/routes/index.js for
// the API surface.
const app = require('./src/app');
const config = require('./src/config/env');
const initDb = require('./src/db/init');
const { runMigrations } = require('./src/db/migrations');

initDb().then(runMigrations);

app.listen(config.port, () => {
  console.log(`AIIA CTMS Server (21 CFR Part 11 Active) running at http://localhost:${config.port}`);
});
