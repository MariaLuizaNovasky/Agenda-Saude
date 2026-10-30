import { q, type Consulta } from './dados.js';
import { supabase } from './supabase.js';
import { agoraLocal, deBanco, diaSemana, hhmm, hojeLocal, intervaloDia, minutos, paraBanco, somarDias, somarMinutos } from './tempo.js';
import { HttpError } from './util.js';

export const STATUS_ATIVOS = ['AGENDADA', 'CONFIRMADA', 'EM_ESPERA', 'EM_ATENDIMENTO'];
export const DIAS_AGENDA = 30;

export interface Horario {
  data_hora: string;
  livre: boolean;
}

interface Periodo { dia_semana: number; hora_inicio: string; hora_fim: string; duracao_min: number }

async function periodosDoMedico(medicoId: string) {
  return q<Periodo[]>(supabase.from('disponibilidades').select('dia_semana, hora_inicio, hora_fim, duracao_min').eq('medico_id', medicoId).order('hora_inicio'));
}

/** Horários já tomados (consultas ativas, exceto encaixes) entre duas datas. */
async function ocupados(medicoId: string, de: string, ateExclusivo: string) {
  const rows = await q<{ data_hora: string }[]>(
    supabase
      .from('consultas')
      .select('data_hora')
      .eq('medico_id', medicoId)
      .gte('data_hora', intervaloDia(de).de)
      .lt('data_hora', intervaloDia(ateExclusivo).de)
      .not('status', 'in', '(CANCELADA,FALTOU)')
      .neq('tipo', 'ENCAIXE'),
  );
  return new Set(rows.map((r) => deBanco(r.data_hora)!));
}

function montarDia(periodos: Periodo[], data: string, tomados: Set<string>, agora: string): Horario[] {
  const lista: Horario[] = [];
  const dia = diaSemana(data);
  for (const p of periodos.filter((x) => x.dia_semana === dia)) {
    const dur = p.duracao_min || 30;
    for (let m = minutos(p.hora_inicio); m + dur <= minutos(p.hora_fim); m += dur) {
      const dh = `${data}T${hhmm(m)}`;
      if (dh <= agora) continue;
      lista.push({ data_hora: dh, livre: !tomados.has(dh) });
    }
  }
  return lista.sort((a, b) => a.data_hora.localeCompare(b.data_hora));
}

/** Disponibilidade.gerarHorarios(): horários da agenda do médico numa data, marcando os ocupados. */
export async function gerarHorarios(medicoId: string, data: string): Promise<Horario[]> {
  const [periodos, tomados] = await Promise.all([periodosDoMedico(medicoId), ocupados(medicoId, data, somarDias(data, 1))]);
  return montarDia(periodos, data, tomados, agoraLocal());
}

/** Dias dos próximos 30 com pelo menos um horário livre. */
export async function diasLivres(medicoId: string) {
  const hoje = hojeLocal();
  const fim = somarDias(hoje, DIAS_AGENDA);
  const [periodos, tomados] = await Promise.all([periodosDoMedico(medicoId), ocupados(medicoId, hoje, fim)]);
  const agora = agoraLocal();
  const dias: { data: string; livres: number }[] = [];
  for (let d = hoje; d < fim; d = somarDias(d, 1)) {
    const livres = montarDia(periodos, d, tomados, agora).filter((h) => h.livre).length;
    if (livres) dias.push({ data: d, livres });
  }
  return dias;
}

/** Garante que o médico está ativo e que o horário é da agenda dele e está livre (encaixe dispensa a agenda). */
export async function validarHorario(medicoId: string, dataHora: string, tipo: string, ignorarConsultaId?: number) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dataHora)) throw new HttpError(400, 'Data e hora inválidas.');
  if (dataHora <= agoraLocal()) throw new HttpError(400, 'Escolha um horário no futuro.');

  const medico = await q<{ ativo: boolean; tipo: string } | null>(supabase.from('usuarios').select('ativo, tipo').eq('id', medicoId).maybeSingle());
  if (!medico || !medico.ativo || medico.tipo !== 'MEDICO') throw new HttpError(404, 'Médico não encontrado.');
  if (tipo === 'ENCAIXE') return;

  let conflito = supabase
    .from('consultas')
    .select('id')
    .eq('medico_id', medicoId)
    .eq('data_hora', paraBanco(dataHora))
    .not('status', 'in', '(CANCELADA,FALTOU)')
    .neq('tipo', 'ENCAIXE');
  if (ignorarConsultaId) conflito = conflito.neq('id', ignorarConsultaId);
  if ((await q<unknown[]>(conflito)).length) throw new HttpError(409, 'Este horário já está ocupado. Escolha outro horário.');

  const naAgenda = (await gerarHorarios(medicoId, dataHora.slice(0, 10))).some((h) => h.data_hora === dataHora);
  if (!naAgenda) throw new HttpError(400, 'Este horário não faz parte da agenda do médico.');
}

/** O mesmo paciente não pode ter duas consultas ativas no mesmo horário. */
export async function validarPacienteLivre(pacienteId: string, dataHora: string, ignorarConsultaId?: number) {
  let b = supabase
    .from('consultas')
    .select('id')
    .eq('paciente_id', pacienteId)
    .eq('data_hora', paraBanco(dataHora))
    .not('status', 'in', '(CANCELADA,FALTOU)');
  if (ignorarConsultaId) b = b.neq('id', ignorarConsultaId);
  if ((await q<unknown[]>(b)).length) throw new HttpError(409, 'O paciente já tem uma consulta neste horário.');
}

export type ItemFila = Consulta & { posicao: number | null; previsao: string };

const ORDEM: Record<string, number> = { EM_ATENDIMENTO: 0, EM_ESPERA: 1, CONFIRMADA: 2, AGENDADA: 3 };

/** Fila do dia por médico: em atendimento, em espera (ordem de horário/check-in) e ainda por chegar. */
export function montarFila(consultas: Consulta[]) {
  const linhas = consultas
    .filter((c) => STATUS_ATIVOS.includes(c.status))
    .sort((a, b) =>
      a.medico_nome.localeCompare(b.medico_nome, 'pt-BR') ||
      ORDEM[a.status] - ORDEM[b.status] ||
      a.data_hora.localeCompare(b.data_hora) ||
      String(a.check_in_em ?? '').localeCompare(String(b.check_in_em ?? '')),
    );
  const porMedico = new Map<string, { medico_id: string; medico_nome: string; atraso_min: number; itens: ItemFila[] }>();
  for (const c of linhas) {
    if (!porMedico.has(c.medico_id)) porMedico.set(c.medico_id, { medico_id: c.medico_id, medico_nome: c.medico_nome, atraso_min: 0, itens: [] });
    const g = porMedico.get(c.medico_id)!;
    g.atraso_min = Math.max(g.atraso_min, c.atraso_min ?? 0);
    g.itens.push({ ...c, posicao: null, previsao: somarMinutos(c.data_hora, c.atraso_min ?? 0) });
  }
  for (const g of porMedico.values()) {
    let pos = 0;
    for (const i of g.itens) if (i.status === 'EM_ESPERA') i.posicao = ++pos;
  }
  return [...porMedico.values()];
}
