import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { run } from './db.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const naoEncontrado = (o = 'Registro') => new HttpError(404, `${o} não encontrado.`);
export const proibido = () => new HttpError(403, 'Seu perfil não tem permissão para esta ação.');

/** Valida o corpo da requisição com um schema zod. */
export function validar<T>(schema: ZodType<T>, dados: unknown): T {
  return schema.parse(dados);
}

export function idParam(req: Request, nome = 'id'): number {
  const n = Number(req.params[nome]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identificador inválido.');
  return n;
}

/** Registra na trilha de auditoria (LOG_ALTERACOES). */
export function auditar(usuarioId: number | null, entidade: string, registroId: number | null, acao: string, detalhes?: unknown) {
  run(
    'INSERT INTO log_alteracoes (usuario_id, entidade, registro_id, acao, detalhes) VALUES (?,?,?,?,?)',
    usuarioId, entidade, registroId, acao, detalhes === undefined ? null : JSON.stringify(detalhes),
  );
}

/** Cria uma notificação para um usuário. */
export function notificar(usuarioId: number, titulo: string, mensagem: string, link?: string) {
  run('INSERT INTO notificacoes (usuario_id, titulo, mensagem, link) VALUES (?,?,?,?)', usuarioId, titulo, mensagem, link ?? null);
}

// ---------- datas (horário local, formato "YYYY-MM-DDTHH:MM") ----------
const p2 = (n: number) => String(n).padStart(2, '0');
export const hojeISO = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const agoraISO = (d = new Date()) => `${hojeISO(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const agoraCompleto = (d = new Date()) => `${agoraISO(d)}:${p2(d.getSeconds())}`;
export function somarDias(dataISO: string, dias: number) {
  const [a, m, d] = dataISO.slice(0, 10).split('-').map(Number);
  return hojeISO(new Date(a, m - 1, d + dias));
}
export const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const hhmm = (min: number) => `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;
export const diaSemana = (dataISO: string) => {
  const [a, m, d] = dataISO.slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d).getDay();
};

// ---------- validações de documentos ----------
export function cpfValido(cpf: string) {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const dv = (base: string, peso: number) => {
    let s = 0;
    for (const ch of base) s += Number(ch) * peso--;
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}
export const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
/** Valida apenas o formato do CRM (4 a 7 dígitos) — não substitui a consulta ao conselho. */
export const crmFormatoValido = (crm: string) => /^\d{4,7}$/.test(crm.replace(/\D/g, ''));

// ---------- tratamento de erros ----------
export function tratarErros(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });
  if (err instanceof ZodError) {
    const msg = err.issues.map((i) => i.message).join(' ');
    return res.status(400).json({ erro: msg || 'Dados inválidos.' });
  }
  const e = err as { code?: string; message?: string; errcode?: number };
  if (e?.message?.includes('UNIQUE constraint failed')) {
    if (e.message.includes('consultas')) return res.status(409).json({ erro: 'Este horário já está ocupado. Escolha outro horário.' });
    if (e.message.includes('email')) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });
    if (e.message.includes('cpf')) return res.status(409).json({ erro: 'Já existe um paciente com este CPF.' });
    if (e.message.includes('crm')) return res.status(409).json({ erro: 'Já existe um médico com este CRM nesta UF.' });
    return res.status(409).json({ erro: 'Registro duplicado.' });
  }
  if (e?.message?.includes('FOREIGN KEY constraint failed')) {
    return res.status(409).json({ erro: 'O registro está vinculado a outros dados e não pode ser alterado assim.' });
  }
  console.error(err);
  return res.status(500).json({ erro: 'Erro interno no servidor.' });
}
