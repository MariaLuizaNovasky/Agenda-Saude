import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 3333),
  jwtSecret: process.env.JWT_SECRET ?? 'agenda-saude-dev-secret',
  dbPath: process.env.DB_PATH ?? './data/agenda-saude.db',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  valorConsulta: Number(process.env.VALOR_CONSULTA ?? 180),
  uploadsDir: process.env.UPLOADS_DIR ?? './uploads',
};

if (!process.env.JWT_SECRET) {
  console.warn('[aviso] JWT_SECRET não definido; usando segredo de desenvolvimento.');
}
