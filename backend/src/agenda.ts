import { all, one } from './db.js';
import { agoraISO, diaSemana, hhmm, HttpError, minutos } from './util.js';

export const STATUS_ATIVOS = ['AGENDADA', 'CONFIRMADA', 'EM_ESPERA', 'EM_ATENDIMENTO'];

export interface Horario {
  data_hora: string;
  livre: boolean;
}

/** Disponibilidade.gerarHorarios(): horários da agenda do médico numa data, marcando os ocupados. */
export function gerarHorarios(medicoId: number, data: string): Horario[] {
  const dispon = all<{ hora_inicio: string; hora_fim: string; duracao_min: number }>(
    'SELECT hora_inicio, hora_fim, duracao_min FROM disponibilidades WHERE medico_id = ? AND dia_semana = ? ORDER BY hora_inicio',
    medicoId, diaSemana(data),
  );
  const ocupados = new Set(
    all<{ data_hora: string }>(
      `SELECT data_hora FROM consultas WHERE medico_id = ? AND substr(data_hora,1,10) = ?
       AND status NOT IN ('CANCELADA','FALTOU') AND tipo <> 'ENCAIXE'`,
      medicoId, data,
    ).map((c) => c.data_hora),
  );
  const agora = agoraISO();
  const lista: Horario[] = [];
  for (const d of dispon) {
    for (let m = minutos(d.hora_inicio); m + d.duracao_min <= minutos(d.hora_fim); m += d.duracao_min) {
      const dh = `${data}T${hhmm(m)}`;
      if (dh <= agora) continue;
      lista.push({ data_hora: dh, livre: !ocupados.has(dh) });
    }
  }
  return lista;
}

/** Garante que o horário pertence à agenda do médico e está livre (encaixes não precisam). */
export function validarHorario(medicoId: number, dataHora: string, tipo: string, ignorarConsultaId?: number) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dataHora)) throw new HttpError(400, 'Data e hora inválidas.');
  if (dataHora <= agoraISO()) throw new HttpError(400, 'Escolha um horário no futuro.');
  const medico = one<{ ativo: number }>(
    'SELECT u.ativo FROM medicos m JOIN usuarios u ON u.id = m.usuario_id WHERE m.usuario_id = ?',
    medicoId,
  );
  if (!medico || !medico.ativo) throw new HttpError(404, 'Médico não encontrado.');
  if (tipo === 'ENCAIXE') return;
  const conflito = one(
    `SELECT id FROM consultas WHERE medico_id = ? AND data_hora = ? AND status NOT IN ('CANCELADA','FALTOU')
     AND tipo <> 'ENCAIXE' AND id <> ?`,
    medicoId, dataHora, ignorarConsultaId ?? 0,
  );
  if (conflito) throw new HttpError(409, 'Este horário já está ocupado. Escolha outro horário.');
  const naAgenda = gerarHorarios(medicoId, dataHora.slice(0, 10)).some((h) => h.data_hora === dataHora);
  if (!naAgenda) throw new HttpError(400, 'Este horário não faz parte da agenda do médico.');
}

/** SQL base de consultas com nomes de paciente e médico. */
export const SQL_CONSULTA = `
  SELECT c.*, up.nome AS paciente_nome, up.telefone AS paciente_telefone, p.cpf AS paciente_cpf,
         um.nome AS medico_nome, m.crm, m.crm_uf,
         (SELECT group_concat(e.nome, ', ') FROM medico_especialidade me JOIN especialidades e ON e.id = me.especialidade_id
           WHERE me.medico_id = c.medico_id) AS especialidades
  FROM consultas c
  JOIN pacientes p ON p.usuario_id = c.paciente_id
  JOIN usuarios up ON up.id = c.paciente_id
  JOIN medicos m ON m.usuario_id = c.medico_id
  JOIN usuarios um ON um.id = c.medico_id`;

export interface ItemFila {
  id: number;
  paciente_id: number;
  paciente_nome: string;
  medico_id: number;
  medico_nome: string;
  data_hora: string;
  tipo: string;
  status: string;
  check_in_em: string | null;
  atraso_min: number;
  posicao: number | null;
  previsao: string;
}

/** Monta a fila do dia por médico: em atendimento, em espera (ordem de horário/check-in) e ainda por chegar. */
export function montarFila(data: string, medicoId?: number) {
  const linhas = all<ItemFila>(
    `${SQL_CONSULTA} WHERE substr(c.data_hora,1,10) = ? AND c.status IN ('AGENDADA','CONFIRMADA','EM_ESPERA','EM_ATENDIMENTO')
     ${medicoId ? 'AND c.medico_id = ?' : ''}
     ORDER BY c.medico_id, CASE c.status WHEN 'EM_ATENDIMENTO' THEN 0 WHEN 'EM_ESPERA' THEN 1 WHEN 'CONFIRMADA' THEN 2 ELSE 3 END,
              c.data_hora, c.check_in_em`,
    ...(medicoId ? [data, medicoId] : [data]),
  );
  const porMedico = new Map<number, { medico_id: number; medico_nome: string; atraso_min: number; itens: ItemFila[] }>();
  for (const l of linhas) {
    if (!porMedico.has(l.medico_id)) porMedico.set(l.medico_id, { medico_id: l.medico_id, medico_nome: l.medico_nome, atraso_min: 0, itens: [] });
    const g = porMedico.get(l.medico_id)!;
    g.atraso_min = Math.max(g.atraso_min, l.atraso_min);
    l.posicao = null;
    l.previsao = somarMinutos(l.data_hora, l.atraso_min);
    g.itens.push(l);
  }
  for (const g of porMedico.values()) {
    let pos = 0;
    for (const i of g.itens) if (i.status === 'EM_ESPERA') i.posicao = ++pos;
  }
  return [...porMedico.values()];
}

export function somarMinutos(dataHora: string, min: number) {
  const [d, t] = dataHora.split('T');
  const [a, me, di] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const x = new Date(a, me - 1, di, h, mi + min);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}
