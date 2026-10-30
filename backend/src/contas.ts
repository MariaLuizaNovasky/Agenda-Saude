import { q } from './dados.js';
import { supabase } from './supabase.js';
import { HttpError } from './util.js';

/**
 * Cria a conta no Supabase Auth e executa `preencher` (linhas em usuarios/pacientes/medicos...).
 * Se algo falhar no meio, apaga o que foi criado: assim não sobra usuário "órfão" no Auth
 * (que depois não consegue entrar, porque falta a linha em public.usuarios).
 */
export async function criarConta(email: string, senha: string, preencher: (id: string) => Promise<void>) {
  const { data, error } = await supabase.auth.admin.createUser({ email: email.toLowerCase(), password: senha, email_confirm: true });
  if (error || !data.user) {
    if (/already|exists|registered/i.test(error?.message ?? '')) throw new HttpError(409, 'E-mail já cadastrado.');
    if (/password/i.test(error?.message ?? '')) throw new HttpError(400, 'Senha recusada pelo Supabase: use pelo menos 8 caracteres com letras e números.');
    throw new HttpError(400, error?.message ?? 'Não foi possível criar a conta.');
  }
  const id = data.user.id;
  try {
    await preencher(id);
  } catch (e) {
    await supabase.from('medico_especialidade').delete().eq('medico_id', id);
    await supabase.from('prontuarios').delete().eq('paciente_id', id);
    await supabase.from('medicos').delete().eq('usuario_id', id);
    await supabase.from('pacientes').delete().eq('usuario_id', id);
    await supabase.from('usuarios').delete().eq('id', id);
    await supabase.auth.admin.deleteUser(id);
    throw e;
  }
  return id;
}

export async function emailEmUso(email: string, ignorarId?: string) {
  let b = supabase.from('usuarios').select('id').ilike('email', email.toLowerCase());
  if (ignorarId) b = b.neq('id', ignorarId);
  return (await q<unknown[]>(b)).length > 0;
}

export async function cpfEmUso(cpf: string, ignorarId?: string) {
  let b = supabase.from('pacientes').select('usuario_id').eq('cpf', cpf);
  if (ignorarId) b = b.neq('usuario_id', ignorarId);
  return (await q<unknown[]>(b)).length > 0;
}
