import { app } from './app.js';
import { config } from './config.js';

const PORT = config.port || 3000;

// Força o uso de '127.0.0.1' para evitar conflitos de IPv6/IPv4 no Windows
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Agenda-Saúde API em http://127.0.0.1:${PORT}/api`);
});