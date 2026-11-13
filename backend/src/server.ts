import { app } from './app.js';
import { config } from './config.js';

const PORT = config.port || 3000;
// No Windows usamos 127.0.0.1 (evita conflito IPv6/IPv4).
// Em produção (Render), defina HOST=0.0.0.0 nas variáveis de ambiente.
const HOST = process.env.HOST || '127.0.0.1';

app.listen(Number(PORT), HOST, () => {
  console.log(`Agenda-Saúde API em http://${HOST}:${PORT}/api`);
});