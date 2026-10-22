import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { one } from './db.js';
import { HttpError, proibido } from './util.js';

export type Perfil = 'PACIENTE' | 'MEDICO' | 'RECEPCIONISTA' | 'ADMIN' | 'FINANCEIRO' | 'LABORATORIO' | 'FARMACIA';
export const PERFIS: Perfil[] = ['PACIENTE', 'MEDICO', 'RECEPCIONISTA', 'ADMIN', 'FINANCEIRO', 'LABORATORIO', 'FARMACIA'];
/** Perfis da equipe que operam a recepção (o Administrador herda os casos da Recepcionista). */
export const RECEPCAO: Perfil[] = ['RECEPCIONISTA', 'ADMIN'];

export interface UsuarioToken {
  id: number;
  nome: string;
  tipo: Perfil;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario: UsuarioToken;
    }
  }
}

export const gerarToken = (u: UsuarioToken) => jwt.sign(u, config.jwtSecret, { expiresIn: '12h' });

export function lerToken(token: string): UsuarioToken {
  try {
    const dados = jwt.verify(token, config.jwtSecret) as UsuarioToken;
    const atual = one<{ ativo: number; tipo: Perfil; nome: string }>('SELECT ativo, tipo, nome FROM usuarios WHERE id = ?', dados.id);
    if (!atual || !atual.ativo) throw new HttpError(401, 'Usuário inativo. Fale com o administrador.');
    // o perfil sempre vem do banco: mudanças de permissão valem na hora
    return { id: dados.id, nome: atual.nome, tipo: atual.tipo };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  }
}

/** Exige usuário autenticado. */
export function autenticar(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'Entre no sistema para continuar.');
  req.usuario = lerToken(h.slice(7));
  next();
}

/** Restringe a rota a determinados perfis. */
export const permitir = (...perfis: Perfil[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!perfis.includes(req.usuario.tipo)) throw proibido();
  next();
};
