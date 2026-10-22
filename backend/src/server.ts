import { app } from './app.js';
import { config } from './config.js';

app.listen(config.port, () => {
  console.log(`Agenda-Saúde API em http://localhost:${config.port}/api`);
});
