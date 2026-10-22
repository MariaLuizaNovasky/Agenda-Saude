import request from 'supertest';
import { app } from '../src/app.js';

// um único servidor por arquivo de teste (evita abrir/fechar uma porta a cada requisição)
export const servidor = app.listen(0);
await new Promise<void>((ok) => (servidor.listening ? ok() : servidor.once('listening', () => ok())));
export const api = request(servidor);
export const SENHA = 'Senha123';

export const EMAILS = {
  admin: 'admin@agendasaude.com',
  recepcao: 'recepcao@agendasaude.com',
  financeiro: 'financeiro@agendasaude.com',
  laboratorio: 'laboratorio@agendasaude.com',
  farmacia: 'farmacia@agendasaude.com',
  helena: 'helena@agendasaude.com',
  rafael: 'rafael@agendasaude.com',
  bruno: 'bruno@agendasaude.com',
  ana: 'paciente@agendasaude.com',
  carlos: 'carlos.lima@email.com',
  roberto: 'roberto.s@email.com',
} as const;

const cache = new Map<string, { token: string; id: number }>();

/** Faz login (com cache) e devolve token + id. */
export async function entrar(email: string, senha = SENHA) {
  const chave = `${email}|${senha}`;
  if (!cache.has(chave)) {
    const r = await api.post('/api/auth/login').send({ email, senha });
    if (r.status !== 200) throw new Error(`login falhou para ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    cache.set(chave, { token: r.body.token, id: r.body.usuario.id });
  }
  return cache.get(chave)!;
}

export const get = async (email: string, url: string) => api.get(url).set('Authorization', `Bearer ${(await entrar(email)).token}`);
export const post = async (email: string, url: string, corpo: object = {}) =>
  api.post(url).set('Authorization', `Bearer ${(await entrar(email)).token}`).send(corpo);
export const put = async (email: string, url: string, corpo: object = {}) =>
  api.put(url).set('Authorization', `Bearer ${(await entrar(email)).token}`).send(corpo);

const p2 = (n: number) => String(n).padStart(2, '0');
export const hojeISO = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** Primeiro horário livre de um médico em algum dos próximos 30 dias. */
export async function primeiroHorarioLivre(email: string, medicoId: number, pular = 0) {
  const dias = await get(email, `/api/medicos/${medicoId}/dias-livres`);
  // só usa dias a partir de hoje+8: o seed já ocupa os próximos 6 dias (em horários que variam com a data)
  const limite = new Date();
  limite.setDate(limite.getDate() + 8);
  for (const dia of dias.body.filter((d: { data: string }) => d.data >= hojeISO(limite))) {
    const h = await get(email, `/api/medicos/${medicoId}/horarios?data=${dia.data}`);
    const livres = h.body.filter((x: { livre: boolean }) => x.livre);
    if (livres.length > pular) return livres[pular].data_hora as string;
  }
  throw new Error('sem horário livre');
}