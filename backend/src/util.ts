import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { supabase } from './supabase.js';
import { emitir } from './events.js';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function validar<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const erros = result.error.issues.map((e) => e.message).join(' ');
    throw new HttpError(400, erros);
  }
  return result.data;
}

export function gerarToken(payload: object): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}

export function cpfValido(cpf: string): boolean {
  const limpo = cpf.replace(/\D/g, '');
  if (limpo.length !== 11 || /^(\d)\1+$/.test(limpo)) return false;
  
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(limpo[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(limpo[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(limpo[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  
  return resto === parseInt(limpo[10]);
}

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
] as const;

export function crmFormatoValido(crm: string): boolean {
  return /^\d{4,8}$/.test(crm);
}

export const idParam = z.object({
  id: z.string().uuid('ID inválido.'),
});

export function naoEncontrado(mensagem = 'Registro não encontrado.'): never {
  throw new HttpError(404, mensagem);
}

// Funções de data auxiliares usadas nas rotas financeiras
export { hojeLocal as hojeISO } from './tempo.js';

export { somarDias } from './tempo.js';

// Funções de auditoria e notificação integradas ao Supabase
export async function auditar(usuarioId: string, entidade: string, registroId: string | number, acao: string, detalhes?: object) {
  try {
    const { error } = await supabase.from('log_alteracoes').insert([
      {
        usuario_id: usuarioId,
        entidade,
        registro_id: typeof registroId === 'number' ? registroId : null,
        acao,
        detalhes: typeof registroId === 'string' ? { registro: registroId, ...(detalhes || {}) } : detalhes || {},
      },
    ]);
    if (error) console.error('Erro ao registrar auditoria:', error.message);
  } catch (err) {
    console.error('Erro ao registrar auditoria:', err);
  }
}

export async function notificar(usuarioId: string, titulo: string, mensagem: string, link?: string) {
  try {
    const { error } = await supabase.from('notificacoes').insert([
      {
        usuario_id: usuarioId,
        titulo,
        mensagem,
        link: link || null,
      },
    ]);
    if (error) console.error('Erro ao enviar notificação:', error.message);
    else emitir('notificacao', { usuario_id: usuarioId });
  } catch (err) {
    console.error('Erro ao enviar notificação:', err);
  }
}