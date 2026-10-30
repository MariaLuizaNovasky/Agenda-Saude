import { Router } from 'express';
import { z } from 'zod';
import { permitir, RECEPCAO, type UsuarioToken } from '../auth.js';
import { montarFila, STATUS_ATIVOS, validarHorario, validarPacienteLivre } from '../agenda.js';
import { buscarConsulta, consultaCompleta, enriquecerConsultas, especialidadesDosMedicos, q, usuariosPorId, type ConsultaLinha } from '../dados.js';
import { emitir } from '../events.js';
import { supabase } from '../supabase.js';
import { agoraLocal, deBanco, ehData, hojeLocal, intervaloDia, paraBanco, somarMinutos } from '../tempo.js';
import { auditar, HttpError, notificar, validar } from '../util.js';
import { gerarBoletoDaConsulta } from './financeiro.js';

export const consultasRouter = Router();

const idDe = (v: unknown) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID inválido.');
  return id;
};
const ehRecepcao = (u: UsuarioToken) => RECEPCAO.includes(u.tipo);
const agoraBanco = () => new Date().toISOString();
const dataHoraTexto = (dh: string) => `${dh.slice(8, 10)}/${dh.slice(5, 7)} às ${dh.slice(11, 16)}`;

function exigirAcesso(u: UsuarioToken, c: ConsultaLinha) {
  if (ehRecepcao(u)) return;
  if (u.tipo === 'PACIENTE' && c.paciente_id === u.id) return;
  if (u.tipo === 'MEDICO' && c.medico_id === u.id) return;
  throw new HttpError(403, 'Acesso não autorizado a esta consulta.');
}

function exigirMedicoDaConsulta(u: UsuarioToken, c: ConsultaLinha) {
  if (u.tipo !== 'MEDICO' || c.medico_id !== u.id) throw new HttpError(403, 'Só o médico da consulta pode fazer isso.');
}

async function atualizar(id: number, campos: Record<string, unknown>) {
  return q<ConsultaLinha>(supabase.from('consultas').update(campos).eq('id', id).select().single());
}

/** Avisa o primeiro da lista de espera (maior prioridade, pedido mais antigo) de uma especialidade do médico. */
async function avisarListaEspera(medicoId: string, dataHora: string) {
  const esps = (await especialidadesDosMedicos([medicoId])).get(medicoId) ?? [];
  if (!esps.length) return;
  const fila = await q<{ id: number; paciente_id: string; especialidade_id: number }[]>(
    supabase
      .from('lista_espera')
      .select('id, paciente_id, especialidade_id')
      .eq('ativo', true)
      .in('especialidade_id', esps.map((e) => e.id))
      .order('prioridade', { ascending: false })
      .order('data_solicitacao', { ascending: true })
      .limit(1),
  );
  const primeiro = fila[0];
  if (!primeiro) return;
  const medico = (await usuariosPorId([medicoId])).get(medicoId);
  const esp = esps.find((e) => e.id === primeiro.especialidade_id)?.nome ?? '';
  await notificar(
    primeiro.paciente_id,
    'Vaga disponível',
    `Abriu um horário em ${esp} com ${medico?.nome ?? 'o médico'} em ${dataHoraTexto(dataHora)}. Agende antes que outra pessoa pegue.`,
    `/agendar?medico=${medicoId}`,
  );
}

/* ------------------------------- consultas ------------------------------- */

consultasRouter.get('/consultas', permitir('PACIENTE', 'MEDICO', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  const u = req.usuario;
  const { data, status, medico_id, paciente_id, futuras, ordem } = req.query as Record<string, string | undefined>;

  let b = supabase.from('consultas').select('*');
  if (u.tipo === 'PACIENTE') b = b.eq('paciente_id', u.id);
  else if (u.tipo === 'MEDICO') b = b.eq('medico_id', u.id);
  else {
    if (medico_id) b = b.eq('medico_id', medico_id);
    if (paciente_id) b = b.eq('paciente_id', paciente_id);
  }
  if (ehData(data)) {
    const dia = intervaloDia(data);
    b = b.gte('data_hora', dia.de).lt('data_hora', dia.ate);
  }
  if (status) b = b.in('status', status.split(',').map((s) => s.trim().toUpperCase()));
  if (futuras) b = b.gte('data_hora', intervaloDia(hojeLocal()).de);

  const asc = ordem === 'asc' || ehData(data) || !!futuras;
  const rows = await q<ConsultaLinha[]>(b.order('data_hora', { ascending: asc }).limit(500));
  res.json(await enriquecerConsultas(rows));
});

consultasRouter.get('/consultas/:id', async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  exigirAcesso(req.usuario, c);
  const [completa] = await enriquecerConsultas([c]);
  // a anotação clínica é só do médico
  if (req.usuario.tipo !== 'MEDICO') completa.anotacoes = null;
  res.json(completa);
});

const esquemaNova = z.object({
  medico_id: z.string().min(1, 'Escolha o médico.'),
  data_hora: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Data e hora inválidas.'),
  tipo: z.enum(['NORMAL', 'ENCAIXE', 'RETORNO']).default('NORMAL'),
  paciente_id: z.string().nullish(),
  lista_espera_id: z.number().int().positive().nullish(),
});

consultasRouter.post('/consultas', permitir('PACIENTE', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  const u = req.usuario;
  const d = validar(esquemaNova, req.body);
  const dataHora = d.data_hora.slice(0, 16);

  let pacienteId: string;
  if (u.tipo === 'PACIENTE') {
    if (d.tipo === 'ENCAIXE') throw new HttpError(403, 'Encaixe só pode ser feito pela recepção.');
    pacienteId = u.id;
  } else {
    if (!d.paciente_id) throw new HttpError(400, 'Escolha o paciente.');
    pacienteId = d.paciente_id;
    const pac = await q<{ usuario_id: string } | null>(supabase.from('pacientes').select('usuario_id').eq('usuario_id', pacienteId).maybeSingle());
    if (!pac) throw new HttpError(404, 'Paciente não encontrado.');
  }

  await validarHorario(d.medico_id, dataHora, d.tipo);
  await validarPacienteLivre(pacienteId, dataHora);

  const nova = await q<ConsultaLinha>(
    supabase
      .from('consultas')
      .insert([{ paciente_id: pacienteId, medico_id: d.medico_id, data_hora: paraBanco(dataHora), tipo: d.tipo, status: 'AGENDADA' }])
      .select()
      .single(),
  );

  // pedido da lista de espera atendido
  if (d.lista_espera_id) {
    await supabase.from('lista_espera').update({ ativo: false }).eq('id', d.lista_espera_id).eq('paciente_id', pacienteId);
  }

  await auditar(u.id, 'consultas', nova.id, 'AGENDOU', { data_hora: dataHora, tipo: d.tipo, paciente_id: pacienteId });
  if (u.tipo !== 'PACIENTE') {
    await notificar(pacienteId, 'Consulta agendada', `Sua consulta foi marcada para ${dataHoraTexto(dataHora)}.`, '/minhas-consultas');
  }
  await notificar(d.medico_id, d.tipo === 'ENCAIXE' ? 'Novo encaixe' : 'Nova consulta', `Consulta marcada para ${dataHoraTexto(dataHora)}.`, '/agenda');
  emitir('agenda');
  if (dataHora.slice(0, 10) === hojeLocal()) emitir('fila');

  res.status(201).json(await consultaCompleta(nova.id));
});

consultasRouter.put('/consultas/:id/reagendar', permitir('PACIENTE', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  exigirAcesso(req.usuario, c);
  const { data_hora } = validar(z.object({ data_hora: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Data e hora inválidas.') }), req.body);
  const novo = data_hora.slice(0, 16);
  if (!['AGENDADA', 'CONFIRMADA'].includes(c.status)) throw new HttpError(400, 'Só consultas ainda não iniciadas podem ser remarcadas.');

  const antigo = deBanco(c.data_hora)!;
  await validarHorario(c.medico_id, novo, c.tipo, c.id);
  await validarPacienteLivre(c.paciente_id, novo, c.id);
  await atualizar(c.id, { data_hora: paraBanco(novo), check_in_em: null });

  await auditar(req.usuario.id, 'consultas', c.id, 'REMARCOU', { de: antigo, para: novo });
  const aviso = `Consulta de ${dataHoraTexto(antigo)} remarcada para ${dataHoraTexto(novo)}.`;
  if (req.usuario.id !== c.paciente_id) await notificar(c.paciente_id, 'Consulta remarcada', aviso, '/minhas-consultas');
  await notificar(c.medico_id, 'Consulta remarcada', aviso, '/agenda');
  if (c.tipo !== 'ENCAIXE' && antigo > agoraLocal()) await avisarListaEspera(c.medico_id, antigo);
  emitir('agenda');
  emitir('fila');
  res.json(await consultaCompleta(c.id));
});

consultasRouter.post('/consultas/:id/cancelar', permitir('PACIENTE', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  exigirAcesso(req.usuario, c);
  const { motivo } = validar(z.object({ motivo: z.string().trim().min(3, 'Informe o motivo do cancelamento.') }), req.body);
  if (!['AGENDADA', 'CONFIRMADA', 'EM_ESPERA'].includes(c.status)) throw new HttpError(400, 'Esta consulta não pode mais ser cancelada.');

  await atualizar(c.id, { status: 'CANCELADA', motivo_cancelamento: motivo });
  const dh = deBanco(c.data_hora)!;
  await auditar(req.usuario.id, 'consultas', c.id, 'CANCELOU', { motivo });
  if (req.usuario.id !== c.paciente_id) await notificar(c.paciente_id, 'Consulta cancelada', `Sua consulta de ${dataHoraTexto(dh)} foi cancelada. Motivo: ${motivo}`, '/minhas-consultas');
  await notificar(c.medico_id, 'Consulta cancelada', `A consulta de ${dataHoraTexto(dh)} foi cancelada.`, '/agenda');
  if (c.tipo !== 'ENCAIXE' && dh > agoraLocal()) await avisarListaEspera(c.medico_id, dh);
  emitir('agenda');
  emitir('fila');
  res.json(await consultaCompleta(c.id));
});

// Paciente chegou: faz o check-in no dia da consulta
consultasRouter.post('/consultas/:id/checkin', permitir('PACIENTE', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  exigirAcesso(req.usuario, c);
  if (c.status !== 'AGENDADA') throw new HttpError(400, 'O check-in desta consulta já foi feito ou ela não está mais ativa.');
  if (deBanco(c.data_hora)!.slice(0, 10) !== hojeLocal()) throw new HttpError(400, 'O check-in só pode ser feito no dia da consulta.');

  await atualizar(c.id, { status: 'CONFIRMADA', check_in_em: agoraBanco() });
  await auditar(req.usuario.id, 'consultas', c.id, 'CHECK_IN');
  emitir('fila');
  emitir('agenda');
  res.json(await consultaCompleta(c.id));
});

// Recepção confirma a presença: o paciente entra na fila
consultasRouter.post('/consultas/:id/confirmar-presenca', permitir(...RECEPCAO), async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  if (!['AGENDADA', 'CONFIRMADA'].includes(c.status)) throw new HttpError(400, 'Este paciente já está na fila ou a consulta não está ativa.');
  if (deBanco(c.data_hora)!.slice(0, 10) !== hojeLocal()) throw new HttpError(400, 'Só é possível confirmar presença no dia da consulta.');

  if (c.status === 'AGENDADA') await atualizar(c.id, { status: 'CONFIRMADA', check_in_em: agoraBanco() });
  await atualizar(c.id, { status: 'EM_ESPERA', ...(c.check_in_em ? {} : { check_in_em: agoraBanco() }) });
  await auditar(req.usuario.id, 'consultas', c.id, 'CONFIRMOU_PRESENCA');
  await notificar(c.paciente_id, 'Presença confirmada', 'Você está na fila. Acompanhe sua posição pelo sistema.', '/fila');
  emitir('fila');
  emitir('agenda');
  res.json(await consultaCompleta(c.id));
});

consultasRouter.post('/consultas/:id/faltou', permitir(...RECEPCAO), async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  if (!['AGENDADA', 'CONFIRMADA', 'EM_ESPERA'].includes(c.status)) throw new HttpError(400, 'Não é possível registrar falta nesta consulta.');
  await atualizar(c.id, { status: 'FALTOU' });
  await auditar(req.usuario.id, 'consultas', c.id, 'REGISTROU_FALTA');
  emitir('fila');
  emitir('agenda');
  res.json(await consultaCompleta(c.id));
});

consultasRouter.post('/consultas/:id/iniciar', async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  exigirMedicoDaConsulta(req.usuario, c);
  if (c.status !== 'EM_ESPERA') throw new HttpError(400, 'O paciente ainda não está na fila de espera.');
  const emCurso = await q<{ id: number }[]>(supabase.from('consultas').select('id').eq('medico_id', c.medico_id).eq('status', 'EM_ATENDIMENTO'));
  if (emCurso.length) throw new HttpError(409, 'Finalize o atendimento em andamento antes de chamar o próximo.');

  await atualizar(c.id, { status: 'EM_ATENDIMENTO', iniciada_em: agoraBanco() });
  await auditar(req.usuario.id, 'consultas', c.id, 'INICIOU_ATENDIMENTO');
  await notificar(c.paciente_id, 'Sua vez', `${req.usuario.nome} está chamando você.`, '/fila');
  emitir('fila');
  res.json(await consultaCompleta(c.id));
});

consultasRouter.post('/consultas/:id/voltar-fila', async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  exigirMedicoDaConsulta(req.usuario, c);
  if (c.status !== 'EM_ATENDIMENTO') throw new HttpError(400, 'Esta consulta não está em atendimento.');
  await atualizar(c.id, { status: 'EM_ESPERA', iniciada_em: null });
  await auditar(req.usuario.id, 'consultas', c.id, 'VOLTOU_FILA');
  emitir('fila');
  res.json(await consultaCompleta(c.id));
});

consultasRouter.post('/consultas/:id/finalizar', async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  exigirMedicoDaConsulta(req.usuario, c);
  const { anotacoes } = validar(z.object({ anotacoes: z.string().nullish() }), req.body ?? {});
  if (c.status !== 'EM_ATENDIMENTO') throw new HttpError(400, 'Esta consulta não está em atendimento.');

  await atualizar(c.id, { status: 'FINALIZADA', finalizada_em: agoraBanco(), ...(anotacoes != null ? { anotacoes } : {}) });
  await auditar(req.usuario.id, 'consultas', c.id, 'FINALIZOU_ATENDIMENTO');
  await gerarBoletoDaConsulta(c.id, req.usuario.id);
  emitir('fila');
  emitir('agenda');
  res.json(await consultaCompleta(c.id));
});

consultasRouter.put('/consultas/:id/anotacoes', async (req, res) => {
  const c = await buscarConsulta(idDe(String(req.params.id)));
  exigirMedicoDaConsulta(req.usuario, c);
  const { anotacoes } = validar(z.object({ anotacoes: z.string() }), req.body);
  if (!['EM_ATENDIMENTO', 'FINALIZADA'].includes(c.status)) throw new HttpError(400, 'Anotações só durante ou depois do atendimento.');
  await atualizar(c.id, { anotacoes });
  await auditar(req.usuario.id, 'consultas', c.id, 'EDITOU_ANOTACOES');
  res.json(await consultaCompleta(c.id));
});

/* ---------------------------------- fila ---------------------------------- */

async function consultasDoDia(data: string, filtro: { medico_id?: string; paciente_id?: string } = {}) {
  const dia = intervaloDia(data);
  let b = supabase.from('consultas').select('*').gte('data_hora', dia.de).lt('data_hora', dia.ate).in('status', STATUS_ATIVOS);
  if (filtro.medico_id) b = b.eq('medico_id', filtro.medico_id);
  if (filtro.paciente_id) b = b.eq('paciente_id', filtro.paciente_id);
  return enriquecerConsultas(await q<ConsultaLinha[]>(b));
}

consultasRouter.get('/fila', permitir('MEDICO', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  const data = ehData(req.query.data) ? req.query.data : hojeLocal();
  const medicoId = req.usuario.tipo === 'MEDICO' ? req.usuario.id : (req.query.medico_id as string | undefined);
  const consultas = await consultasDoDia(data, medicoId ? { medico_id: medicoId } : {});
  res.json({ data, grupos: montarFila(consultas) });
});

// Fila do paciente: só a posição dele, sem nomes de outras pessoas
consultasRouter.get('/fila/minha', permitir('PACIENTE'), async (req, res) => {
  const hoje = hojeLocal();
  const minhas = await consultasDoDia(hoje, { paciente_id: req.usuario.id });
  const resposta = [];
  for (const m of minhas.sort((a, b) => a.data_hora.localeCompare(b.data_hora))) {
    const grupo = montarFila(await consultasDoDia(hoje, { medico_id: m.medico_id }))[0];
    const item = grupo?.itens.find((i) => i.id === m.id);
    const emEspera = grupo?.itens.filter((i) => i.status === 'EM_ESPERA').length ?? 0;
    const atraso = grupo?.atraso_min ?? m.atraso_min ?? 0;
    resposta.push({
      consulta_id: m.id,
      medico_nome: m.medico_nome,
      data_hora: m.data_hora,
      status: m.status,
      tipo: m.tipo,
      atraso_min: atraso,
      previsao: somarMinutos(m.data_hora, atraso),
      posicao: item?.posicao ?? null,
      pessoas_na_frente: item?.posicao ? item.posicao - 1 : null,
      total_em_espera: emEspera,
      medico_atendendo: !!grupo?.itens.some((i) => i.status === 'EM_ATENDIMENTO'),
    });
  }
  res.json(resposta);
});

/* ----------------------------- lista de espera ----------------------------- */

consultasRouter.get('/lista-espera', permitir('PACIENTE', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  let b = supabase.from('lista_espera').select('*').eq('ativo', true);
  if (req.usuario.tipo === 'PACIENTE') b = b.eq('paciente_id', req.usuario.id);
  const rows = await q<any[]>(b.order('prioridade', { ascending: false }).order('data_solicitacao', { ascending: true }));
  const [usuarios, esps] = await Promise.all([
    usuariosPorId(rows.map((r) => r.paciente_id)),
    q<{ id: number; nome: string }[]>(supabase.from('especialidades').select('id, nome')),
  ]);
  const nomesEsp = new Map(esps.map((e) => [e.id, e.nome]));
  res.json(
    rows.map((r) => ({
      id: r.id,
      paciente_id: r.paciente_id,
      especialidade_id: r.especialidade_id,
      especialidade_nome: nomesEsp.get(r.especialidade_id) ?? '',
      paciente_nome: usuarios.get(r.paciente_id)?.nome ?? '',
      paciente_telefone: usuarios.get(r.paciente_id)?.telefone ?? null,
      data_solicitacao: deBanco(r.data_solicitacao),
      prioridade: r.prioridade ?? 0,
      observacao: r.observacao ?? null,
    })),
  );
});

consultasRouter.post('/lista-espera', permitir('PACIENTE', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  const d = validar(
    z.object({
      especialidade_id: z.number().int().positive('Escolha a especialidade.'),
      paciente_id: z.string().nullish(),
      prioridade: z.number().int().min(0).max(2).nullish(),
      observacao: z.string().trim().max(300, 'A observação pode ter até 300 caracteres.').nullish(),
    }),
    req.body,
  );
  const paciente = req.usuario.tipo === 'PACIENTE';
  const pacienteId = paciente ? req.usuario.id : d.paciente_id;
  if (!pacienteId) throw new HttpError(400, 'Escolha o paciente.');

  const existe = await q<unknown[]>(supabase.from('lista_espera').select('id').eq('paciente_id', pacienteId).eq('especialidade_id', d.especialidade_id).eq('ativo', true));
  if (existe.length) throw new HttpError(409, 'Já existe um pedido ativo nessa especialidade.');

  const novo = await q<{ id: number }>(
    supabase
      .from('lista_espera')
      .insert([{ paciente_id: pacienteId, especialidade_id: d.especialidade_id, prioridade: paciente ? 0 : d.prioridade ?? 0, observacao: d.observacao || null }])
      .select('id')
      .single(),
  );
  await auditar(req.usuario.id, 'lista_espera', novo.id, 'ENTROU_LISTA_ESPERA', { especialidade_id: d.especialidade_id });
  res.status(201).json({ id: novo.id });
});

consultasRouter.put('/lista-espera/:id', permitir(...RECEPCAO), async (req, res) => {
  const id = idDe(String(req.params.id));
  const d = validar(z.object({ prioridade: z.number().int().min(0).max(2), observacao: z.string().trim().max(300, 'A observação pode ter até 300 caracteres.').nullish() }), req.body);
  const campos: Record<string, unknown> = { prioridade: d.prioridade };
  if (d.observacao !== undefined) campos.observacao = d.observacao || null;
  const r = await q<unknown[]>(supabase.from('lista_espera').update(campos).eq('id', id).eq('ativo', true).select('id'));
  if (!r.length) throw new HttpError(404, 'Pedido não encontrado.');
  await auditar(req.usuario.id, 'lista_espera', id, 'ALTEROU_PRIORIDADE', campos);
  res.json({ ok: true });
});

// PACIENTE tenta priorizar: 403 vem do permitir() acima. Remover vale para o dono e para a recepção.
consultasRouter.delete('/lista-espera/:id', permitir('PACIENTE', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  const id = idDe(String(req.params.id));
  let b = supabase.from('lista_espera').update({ ativo: false }).eq('id', id).eq('ativo', true);
  if (req.usuario.tipo === 'PACIENTE') b = b.eq('paciente_id', req.usuario.id);
  const r = await q<unknown[]>(b.select('id'));
  if (!r.length) throw new HttpError(404, 'Pedido não encontrado.');
  await auditar(req.usuario.id, 'lista_espera', id, 'SAIU_LISTA_ESPERA');
  res.json({ ok: true });
});
