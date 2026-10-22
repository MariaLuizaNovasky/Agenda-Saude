import express from 'express';
import cors from 'cors';
import { autenticar } from './auth.js';
import { config } from './config.js';
import { conectarEventos } from './events.js';
import { adminRouter, catalogoRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { clinicoRouter } from './routes/clinico.js';
import { consultasRouter } from './routes/consultas.js';
import { financeiroRouter } from './routes/financeiro.js';
import { pessoasRouter } from './routes/pessoas.js';
import { one } from './db.js';
import { tratarErros } from './util.js';
import { popular } from './seed.js';

// banco vazio: cria os dados fictícios de demonstração
if (!one('SELECT id FROM usuarios LIMIT 1')) popular();

export const app = express();
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: '1mb' }));

const api = express.Router();
api.get('/saude', (_req, res) => res.json({ ok: true }));
api.use('/auth', authRouter);
api.use(catalogoRouter); // especialidades e convênios (leitura pública)
api.get('/eventos', conectarEventos); // tempo real (token na query)

api.use(autenticar);
api.use(adminRouter);
api.use(pessoasRouter);
api.use(consultasRouter);
api.use(clinicoRouter);
api.use(financeiroRouter);
api.use((_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

app.use('/api', api);
app.use(tratarErros);
