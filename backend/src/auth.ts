import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { supabase } from './supabase.js';
import { HttpError } from './util.js';

export type Perfil = 'PACIENTE' | 'MEDICO' | 'RECEPCIONISTA' | 'ADMIN' | 'FINANCEIRO' | 'LABORATORIO' | 'FARMACIA';

export interface UsuarioToken {
  id: string; // UUID
  tipo: Perfil;
  nome: string;
}

declare global {
  namespace Express {
    interface Request {
      usuario: UsuarioToken;
    }
  }
}

export const RECEPCAO: Perfil[] = ['RECEPCIONISTA', 'ADMIN'];

export function hashSenha(senha: string): string {
  return bcrypt.hashSync(senha, 10);
}

export const senhaForte = z.string().min(6, 'A senha deve ter pelo menos 6 caracteres.');

export function lerToken(token: string): UsuarioToken | null {
  try {
    return jwt.verify(token, config.jwtSecret) as UsuarioToken;
  } catch {
    return null;
  }
}

// Middleware de autenticação por Token JWT
export async function autenticar(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) throw new HttpError(401, 'Token não informado.');

  const [, token] = authHeader.split(' ');
  const payload = lerToken(token ?? '');
  if (!payload) throw new HttpError(401, 'Token inválido ou expirado.');

  // Verifica no Supabase se o usuário ainda está ativo
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, tipo, nome, ativo')
    .eq('id', payload.id)
    .single();

  if (!usuario || !usuario.ativo) {
    throw new HttpError(401, 'Usuário inativo ou não encontrado.');
  }

  req.usuario = { id: usuario.id, tipo: usuario.tipo as Perfil, nome: usuario.nome };
  next();
}

export function permitir(...perfis: Perfil[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.usuario || !perfis.includes(req.usuario.tipo)) {
      throw new HttpError(403, 'Acesso não autorizado.');
    }
    next();
  };
}

export function proibido(): HttpError {
  return new HttpError(403, 'Acesso proibido.');
}