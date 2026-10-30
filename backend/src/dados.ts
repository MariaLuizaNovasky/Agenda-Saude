/**
 * Acesso a dados comum às rotas.
 * As consultas não usam "embeds" do PostgREST (select com tabelas aninhadas) de propósito:
 * buscar por listas de IDs funciona qualquer que seja o nome das chaves estrangeiras no banco.
 */
import { supabase } from './supabase.js';
import { deBanco } from './tempo.js';
import { HttpError } from './util.js';

type Resultado<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string; details?: string } | null }>;

/** Traduz erros do Postgres/PostgREST para respostas HTTP com mensagem em português. */
export function erroBanco(error: { message: string; code?: string; details?: string }): HttpError {
  const m = `${error.message} ${error.details ?? ''}`;
  if (error.code === '23505') {
    if (/medico_horario/.test(m)) return new HttpError(409, 'Este horário já está ocupado. Escolha outro horário.');
    if (/paciente_horario/.test(m)) return new HttpError(409, 'O paciente já tem uma consulta neste horário.');
    if (/um_atendimento/.test(m)) return new HttpError(409, 'Finalize o atendimento em andamento antes de chamar o próximo.');
    if (/lista_espera/.test(m)) return new HttpError(409, 'Já existe um pedido ativo nessa especialidade.');
    if (/cpf/.test(m)) return new HttpError(409, 'CPF já cadastrado.');
    if (/crm/.test(m)) return new HttpError(409, 'Este CRM já está cadastrado nessa UF.');
    if (/email/.test(m)) return new HttpError(409, 'E-mail já cadastrado.');
    return new HttpError(409, 'Registro duplicado.');
  }
  if (error.code === '23P01') return new HttpError(409, 'Este período se sobrepõe a outro já cadastrado nesse dia.');
  if (error.code === '23503') return new HttpError(400, 'Há registros ligados a este item.');
  if (error.code === '23514') return new HttpError(400, `Dados inválidos (${error.message}).`);
  if (error.code === '22P02') return new HttpError(400, 'ID ou valor em formato inválido.');
  if (error.code === 'P0001') return new HttpError(400, error.message);
  if (error.code === 'PGRST116') return new HttpError(404, 'Registro não encontrado.');
  if (error.code === '42703' || error.code === 'PGRST204') {
    return new HttpError(500, `Coluna ausente no banco: ${error.message}. Rode supabase/migrations/0002_complementos_api.sql.`);
  }
  return new HttpError(500, error.message);
}

/** Executa uma consulta ao Supabase e devolve os dados, ou lança HttpError. */
export async function q<T>(p: Resultado<T>): Promise<T> {
  const { data, error } = await p;
  if (error) throw erroBanco(error);
  return data as T;
}

const unicos = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined))];

export interface UsuarioBasico { id: string; nome: string; email: string; telefone: string | null; tipo: string; ativo: boolean }

export async function usuariosPorId(ids: (string | null | undefined)[]) {
  const lista = unicos(ids);
  const mapa = new Map<string, UsuarioBasico>();
  if (!lista.length) return mapa;
  const rows = await q<UsuarioBasico[]>(supabase.from('usuarios').select('id, nome, email, telefone, tipo, ativo').in('id', lista));
  for (const r of rows) mapa.set(r.id, r);
  return mapa;
}

export async function pacientesPorId(ids: (string | null | undefined)[]) {
  const lista = unicos(ids);
  const mapa = new Map<string, { usuario_id: string; cpf: string; data_nascimento: string; convenio_id: number | null; numero_carteirinha: string | null }>();
  if (!lista.length) return mapa;
  const rows = await q<any[]>(supabase.from('pacientes').select('*').in('usuario_id', lista));
  for (const r of rows) mapa.set(r.usuario_id, r);
  return mapa;
}

export async function medicosPorId(ids: (string | null | undefined)[]) {
  const lista = unicos(ids);
  const mapa = new Map<string, { usuario_id: string; crm: string; crm_uf: string; crm_verificado: boolean }>();
  if (!lista.length) return mapa;
  const rows = await q<any[]>(supabase.from('medicos').select('*').in('usuario_id', lista));
  for (const r of rows) mapa.set(r.usuario_id, r);
  return mapa;
}

export async function convenioNomes() {
  const rows = await q<{ id: number; nome: string }[]>(supabase.from('convenios').select('id, nome'));
  return new Map(rows.map((c) => [c.id, c.nome]));
}

/** Especialidades de cada médico: medico_id -> [{id, nome}] */
export async function especialidadesDosMedicos(ids: (string | null | undefined)[]) {
  const lista = unicos(ids);
  const mapa = new Map<string, { id: number; nome: string }[]>();
  if (!lista.length) return mapa;
  const [ligacoes, esps] = await Promise.all([
    q<{ medico_id: string; especialidade_id: number }[]>(supabase.from('medico_especialidade').select('medico_id, especialidade_id').in('medico_id', lista)),
    q<{ id: number; nome: string }[]>(supabase.from('especialidades').select('id, nome')),
  ]);
  const nomes = new Map(esps.map((e) => [e.id, e.nome]));
  for (const l of ligacoes) {
    if (!mapa.has(l.medico_id)) mapa.set(l.medico_id, []);
    mapa.get(l.medico_id)!.push({ id: l.especialidade_id, nome: nomes.get(l.especialidade_id) ?? '' });
  }
  for (const v of mapa.values()) v.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return mapa;
}

export interface ConsultaLinha {
  id: number;
  paciente_id: string;
  medico_id: string;
  data_hora: string;
  tipo: 'NORMAL' | 'ENCAIXE' | 'RETORNO';
  status: string;
  check_in_em: string | null;
  atraso_min: number;
  anotacoes: string | null;
  motivo_cancelamento: string | null;
  iniciada_em: string | null;
  finalizada_em: string | null;
}

/** Consultas no formato que o frontend espera (nomes, CPF, CRM, especialidades, horários locais). */
export async function enriquecerConsultas(rows: ConsultaLinha[]) {
  const [usuarios, pacientes, medicos, esps] = await Promise.all([
    usuariosPorId(rows.flatMap((c) => [c.paciente_id, c.medico_id])),
    pacientesPorId(rows.map((c) => c.paciente_id)),
    medicosPorId(rows.map((c) => c.medico_id)),
    especialidadesDosMedicos(rows.map((c) => c.medico_id)),
  ]);
  return rows.map((c) => ({
    ...c,
    data_hora: deBanco(c.data_hora)!,
    check_in_em: deBanco(c.check_in_em),
    iniciada_em: deBanco(c.iniciada_em),
    finalizada_em: deBanco(c.finalizada_em),
    atraso_min: c.atraso_min ?? 0,
    paciente_nome: usuarios.get(c.paciente_id)?.nome ?? '',
    paciente_telefone: usuarios.get(c.paciente_id)?.telefone ?? null,
    paciente_cpf: pacientes.get(c.paciente_id)?.cpf ?? '',
    medico_nome: usuarios.get(c.medico_id)?.nome ?? '',
    crm: medicos.get(c.medico_id)?.crm ?? '',
    crm_uf: medicos.get(c.medico_id)?.crm_uf ?? '',
    especialidades: (esps.get(c.medico_id) ?? []).map((e) => e.nome).join(', ') || null,
  }));
}

export type Consulta = Awaited<ReturnType<typeof enriquecerConsultas>>[number];

export async function buscarConsulta(id: number) {
  const row = await q<ConsultaLinha | null>(supabase.from('consultas').select('*').eq('id', id).maybeSingle());
  if (!row) throw new HttpError(404, 'Consulta não encontrada.');
  return row;
}

export async function consultaCompleta(id: number) {
  return (await enriquecerConsultas([await buscarConsulta(id)]))[0];
}

/** Prontuário do paciente (cria se ainda não existir). */
export async function prontuarioDe(pacienteId: string) {
  const p = await q<any>(supabase.from('prontuarios').select('*').eq('paciente_id', pacienteId).maybeSingle());
  if (p) return p as { id: number; paciente_id: string; alergias: string | null; observacoes: string | null };
  return q<any>(supabase.from('prontuarios').insert([{ paciente_id: pacienteId }]).select().single());
}
