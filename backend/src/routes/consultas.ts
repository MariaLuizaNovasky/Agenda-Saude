import { Router } from 'express';
import { z } from 'zod';
import { permitir, RECEPCAO, type UsuarioToken } from '../auth.js';
import { montarFila, SQL_CONSULTA, STATUS_ATIVOS, validarHorario } from '../agenda.js';
import { config } from '../config.js';
import { all, one, run, transacao } from '../db.js';
import { emitir } from '../events.js';
import { agoraCompleto, agoraISO, auditar, HttpError, hojeISO, idParam, naoEncontrado, notificar, proibido, somarDias, validar } from '../util.js';

export const consultasRouter = Router();

interface Consulta {
  id: number;
  paciente_id: number;
  medico_id: number;
  data_hora: string;
  tipo: 'NORMAL' | 'ENCAIXE' | 'RETORNO';
  status: string;
  check_in_em: string | null;
  medico_nome: string;
  paciente_nome: string;
}

function carregar(id: number) {
  const c = one<Consulta>(`${SQL_CONSULTA} WHERE c.id = ?`, id);
  if (!c) throw naoEncontrado('Consulta');
  return c;
}

/** Quem pode ver/alterar a consulta: o próprio paciente, o médico dela ou a recepção. */
function exigirAcesso(u: UsuarioToken, c: Consulta) {
  if (u.tipo === 'PACIENTE' && c.paciente_id === u.id) return;
  if (u.tipo === 'MEDICO' && c.medico_id === u.id) return;
  if (RECEPCAO.includes(u.tipo)) return;
  throw proibido();
}

const mudou = () => {
  emitir('fila');
  emitir('agenda');
};

/* --------------------------------- leitura -------------------------------- */

consultasRouter.get('/consultas', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const f: string[] = [];
  const p: (string | number)[] = [];
  const u = req.usuario;
  if (u.tipo === 'PACIENTE') { f.push('c.paciente_id = ?'); p.push(u.id); }
  else if (u.tipo === 'MEDICO') { f.push('c.medico_id = ?'); p.push(u.id); }
  else if (!RECEPCAO.includes(u.tipo)) throw proibido();
  if (q.data) { f.push('substr(c.data_hora,1,10) = ?'); p.push(q.data); }
  if (q.inicio) { f.push('substr(c.data_hora,1,10) >= ?'); p.push(q.inicio); }
  if (q.fim) { f.push('substr(c.data_hora,1,10) <= ?'); p.push(q.fim); }
  if (q.medico_id) { f.push('c.medico_id = ?'); p.push(Number(q.medico_id)); }
  if (q.paciente_id) { f.push('c.paciente_id = ?'); p.push(Number(q.paciente_id)); }
  if (q.status) {
    const sts = q.status.split(',');
    f.push(`c.status IN (${sts.map(() => '?').join(',')})`);
    p.push(...sts);
  }
  if (q.futuras === '1') { f.push('c.data_hora >= ?'); p.push(hojeISO()); }
  const ordem = q.ordem === 'desc' ? 'DESC' : 'ASC';
  res.json(all(`${SQL_CONSULTA} ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY c.data_hora ${ordem} LIMIT 500`, ...p));
});

consultasRouter.get('/consultas/:id', (req, res) => {
  const c = carregar(idParam(req));
  exigirAcesso(req.usuario, c);
  const boleto = one('SELECT * FROM boletos WHERE consulta_id = ?', c.id);
  const exames = all('SELECT * FROM exames WHERE consulta_id = ?', c.id);
  const documentos = all('SELECT * FROM documentos_medicos WHERE consulta_id = ?', c.id);
  res.json({ ...c, boleto, exames, documentos });
});

/* -------------------------------- agendar -------------------------------- */

// Agendar consulta (paciente para si; recepção para qualquer paciente; encaixe só pela recepção)
consultasRouter.post('/consultas', permitir('PACIENTE', ...RECEPCAO), (req, res) => {
  const d = validar(
    z.object({
      medico_id: z.number().int().positive(),
      data_hora: z.string(),
      paciente_id: z.number().int().positive().optional(),
      tipo: z.enum(['NORMAL', 'ENCAIXE', 'RETORNO']).default('NORMAL'),
      lista_espera_id: z.number().int().positive().optional(),
    }),
    req.body,
  );
  const u = req.usuario;
  const pacienteId = u.tipo === 'PACIENTE' ? u.id : d.paciente_id;
  if (!pacienteId) throw new HttpError(400, 'Escolha o paciente.');
  if (d.tipo === 'ENCAIXE' && u.tipo === 'PACIENTE') {
    throw new HttpError(403, 'Encaixes são feitos pela recepção. Entre na lista de espera para pedir um.');
  }
  const pac = one('SELECT u.ativo FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id WHERE p.usuario_id = ?', pacienteId);
  if (!pac) throw naoEncontrado('Paciente');
  validarHorario(d.medico_id, d.data_hora, d.tipo);
  const id = transacao(() => {
    const { id } = run(
      'INSERT INTO consultas (paciente_id, medico_id, data_hora, tipo) VALUES (?,?,?,?)',
      pacienteId, d.medico_id, d.data_hora, d.tipo,
    );
    if (d.lista_espera_id) run('UPDATE lista_espera SET ativo = 0 WHERE id = ? AND paciente_id = ?', d.lista_espera_id, pacienteId);
    auditar(u.id, 'consultas', id, 'AGENDOU', { tipo: d.tipo, data_hora: d.data_hora });
    return id;
  });
  const c = carregar(id);
  if (u.tipo !== 'PACIENTE') {
    notificar(pacienteId, 'Consulta marcada', `${c.medico_nome} em ${fmt(c.data_hora)}${d.tipo === 'ENCAIXE' ? ' (encaixe)' : ''}.`, '/consultas');
    emitir('notificacao');
  }
  mudou();
  res.status(201).json(c);
});

const fmt = (dh: string) => `${dh.slice(8, 10)}/${dh.slice(5, 7)} às ${dh.slice(11, 16)}`;

// Consulta.reagendar(novaData)
consultasRouter.put('/consultas/:id/reagendar', (req, res) => {
  const c = carregar(idParam(req));
  exigirAcesso(req.usuario, c);
  if (req.usuario.tipo === 'MEDICO') throw proibido();
  if (!['AGENDADA', 'CONFIRMADA'].includes(c.status)) throw new HttpError(400, 'Só é possível remarcar consultas que ainda não começaram.');
  const { data_hora } = validar(z.object({ data_hora: z.string() }), req.body);
  validarHorario(c.medico_id, data_hora, c.tipo, c.id);
  run("UPDATE consultas SET data_hora = ?, status = 'AGENDADA', check_in_em = NULL, atraso_min = 0 WHERE id = ?", data_hora, c.id);
  auditar(req.usuario.id, 'consultas', c.id, 'REAGENDOU', { de: c.data_hora, para: data_hora });
  avisarVaga(c);
  mudou();
  res.json(carregar(c.id));
});

// Consulta.cancelar(motivo) — ao liberar a vaga, avisa a lista de espera (ListaEspera.notificarVaga)
consultasRouter.post('/consultas/:id/cancelar', (req, res) => {
  const c = carregar(idParam(req));
  exigirAcesso(req.usuario, c);
  if (!['AGENDADA', 'CONFIRMADA', 'EM_ESPERA'].includes(c.status)) throw new HttpError(400, 'Esta consulta não pode mais ser cancelada.');
  const { motivo } = validar(z.object({ motivo: z.string().trim().min(3, 'Informe o motivo do cancelamento.') }), req.body);
  run("UPDATE consultas SET status = 'CANCELADA', motivo_cancelamento = ? WHERE id = ?", motivo, c.id);
  auditar(req.usuario.id, 'consultas', c.id, 'CANCELOU', { motivo });
  if (req.usuario.id !== c.paciente_id) {
    notificar(c.paciente_id, 'Consulta cancelada', `Sua consulta com ${c.medico_nome} em ${fmt(c.data_hora)} foi cancelada. Motivo: ${motivo}`, '/consultas');
  }
  avisarVaga(c);
  mudou();
  emitir('notificacao');
  res.json({ ok: true });
});

/** Avisa o primeiro da lista de espera (maior prioridade, pedido mais antigo) de cada especialidade do médico. */
function avisarVaga(c: Consulta) {
  if (c.data_hora <= agoraISO()) return;
  const pedidos = all<{ id: number; paciente_id: number; especialidade: string }>(
    `SELECT le.id, le.paciente_id, e.nome AS especialidade FROM lista_espera le
     JOIN especialidades e ON e.id = le.especialidade_id
     WHERE le.ativo = 1 AND le.paciente_id <> ? AND le.especialidade_id IN (SELECT especialidade_id FROM medico_especialidade WHERE medico_id = ?)
     ORDER BY le.prioridade DESC, le.data_solicitacao ASC LIMIT 1`,
    c.paciente_id, c.medico_id,
  );
  for (const p of pedidos) {
    notificar(p.paciente_id, 'Vaga disponível', `Abriu um horário de ${p.especialidade} com ${c.medico_nome} em ${fmt(c.data_hora)}. Agende antes que outra pessoa marque.`, `/agendar?medico=${c.medico_id}&data=${c.data_hora.slice(0, 10)}`);
    for (const r of all<{ id: number }>("SELECT id FROM usuarios WHERE tipo = 'RECEPCIONISTA' AND ativo = 1")) {
      notificar(r.id, 'Vaga para a lista de espera', `Horário livre com ${c.medico_nome} em ${fmt(c.data_hora)}. Há pedido de ${p.especialidade} aguardando.`, '/lista-espera');
    }
  }
  emitir('notificacao');
}

/* ---------------------------- check-in e fila ---------------------------- */

// Consulta.realizarCheckIn(): paciente no dia (até 30 min após o horário); recepção já confirma presença
consultasRouter.post('/consultas/:id/checkin', permitir('PACIENTE', ...RECEPCAO), (req, res) => {
  const c = carregar(idParam(req));
  exigirAcesso(req.usuario, c);
  if (c.data_hora.slice(0, 10) !== hojeISO()) throw new HttpError(400, 'O check-in só pode ser feito no dia da consulta.');
  if (c.status !== 'AGENDADA') throw new HttpError(400, 'O check-in desta consulta já foi feito.');
  const recepcao = RECEPCAO.includes(req.usuario.tipo);
  const novo = recepcao ? 'EM_ESPERA' : 'CONFIRMADA';
  run('UPDATE consultas SET status = ?, check_in_em = ? WHERE id = ?', novo, agoraCompleto(), c.id);
  auditar(req.usuario.id, 'consultas', c.id, 'CHECK_IN');
  mudou();
  res.json(carregar(c.id));
});

// Recepcionista.confirmarPresenca(c): coloca o paciente na fila
consultasRouter.post('/consultas/:id/confirmar-presenca', permitir(...RECEPCAO), (req, res) => {
  const c = carregar(idParam(req));
  if (c.data_hora.slice(0, 10) !== hojeISO()) throw new HttpError(400, 'Só é possível confirmar presença no dia da consulta.');
  if (!['AGENDADA', 'CONFIRMADA'].includes(c.status)) throw new HttpError(400, 'Este paciente já está na fila ou foi atendido.');
  run("UPDATE consultas SET status = 'EM_ESPERA', check_in_em = coalesce(check_in_em, ?) WHERE id = ?", agoraCompleto(), c.id);
  auditar(req.usuario.id, 'consultas', c.id, 'CONFIRMOU_PRESENCA');
  mudou();
  res.json(carregar(c.id));
});

consultasRouter.post('/consultas/:id/faltou', permitir(...RECEPCAO), (req, res) => {
  const c = carregar(idParam(req));
  if (!['AGENDADA', 'CONFIRMADA'].includes(c.status)) throw new HttpError(400, 'Só consultas sem presença confirmada podem ser marcadas como falta.');
  if (c.data_hora > agoraISO()) throw new HttpError(400, 'O horário desta consulta ainda não chegou.');
  run("UPDATE consultas SET status = 'FALTOU' WHERE id = ?", c.id);
  auditar(req.usuario.id, 'consultas', c.id, 'MARCOU_FALTA');
  mudou();
  res.json({ ok: true });
});

// Devolve o paciente para a espera (ex.: chamado por engano)
consultasRouter.post('/consultas/:id/voltar-fila', permitir(...RECEPCAO, 'MEDICO'), (req, res) => {
  const c = carregar(idParam(req));
  exigirAcesso(req.usuario, c);
  if (c.status !== 'EM_ATENDIMENTO') throw new HttpError(400, 'Só um atendimento em andamento pode voltar para a fila.');
  run("UPDATE consultas SET status = 'EM_ESPERA', iniciada_em = NULL WHERE id = ?", c.id);
  auditar(req.usuario.id, 'consultas', c.id, 'VOLTOU_FILA');
  mudou();
  res.json({ ok: true });
});

/* ------------------------------- atendimento ------------------------------ */

// Consulta.iniciar()
consultasRouter.post('/consultas/:id/iniciar', permitir('MEDICO'), (req, res) => {
  const c = carregar(idParam(req));
  exigirAcesso(req.usuario, c);
  if (c.status !== 'EM_ESPERA') throw new HttpError(400, 'O paciente precisa estar na fila (presença confirmada pela recepção).');
  const outro = one("SELECT id FROM consultas WHERE medico_id = ? AND status = 'EM_ATENDIMENTO' AND id <> ?", c.medico_id, c.id);
  if (outro) throw new HttpError(409, 'Finalize o atendimento em andamento antes de chamar o próximo paciente.');
  run("UPDATE consultas SET status = 'EM_ATENDIMENTO', iniciada_em = ? WHERE id = ?", agoraCompleto(), c.id);
  auditar(req.usuario.id, 'consultas', c.id, 'INICIOU_ATENDIMENTO');
  notificar(c.paciente_id, 'Sua vez', `${c.medico_nome} está chamando você.`, '/fila');
  emitir('notificacao');
  mudou();
  res.json(carregar(c.id));
});

consultasRouter.put('/consultas/:id/anotacoes', permitir('MEDICO'), (req, res) => {
  const c = carregar(idParam(req));
  exigirAcesso(req.usuario, c);
  const { anotacoes } = validar(z.object({ anotacoes: z.string() }), req.body);
  run('UPDATE consultas SET anotacoes = ? WHERE id = ?', anotacoes, c.id);
  auditar(req.usuario.id, 'consultas', c.id, 'ANOTOU');
  res.json({ ok: true });
});

// Consulta.finalizar(): gera o boleto (particular ou convênio)
consultasRouter.post('/consultas/:id/finalizar', permitir('MEDICO'), (req, res) => {
  const c = carregar(idParam(req));
  exigirAcesso(req.usuario, c);
  if (c.status !== 'EM_ATENDIMENTO') throw new HttpError(400, 'Inicie o atendimento antes de finalizar.');
  const { anotacoes } = validar(z.object({ anotacoes: z.string().optional() }), req.body);
  const pac = one<{ convenio_id: number | null }>('SELECT convenio_id FROM pacientes WHERE usuario_id = ?', c.paciente_id)!;
  transacao(() => {
    run(
      "UPDATE consultas SET status = 'FINALIZADA', finalizada_em = ?, anotacoes = coalesce(?, anotacoes) WHERE id = ?",
      agoraCompleto(), anotacoes ?? null, c.id,
    );
    // retorno dentro do prazo e consultas por convênio não geram cobrança ao paciente
    const valor = c.tipo === 'RETORNO' ? 0 : config.valorConsulta;
    if (!one('SELECT id FROM boletos WHERE consulta_id = ?', c.id)) {
      run(
        'INSERT INTO boletos (consulta_id, convenio_id, valor, vencimento) VALUES (?,?,?,?)',
        c.id, pac.convenio_id, valor, somarDias(hojeISO(), 10),
      );
    }
    auditar(req.usuario.id, 'consultas', c.id, 'FINALIZOU_ATENDIMENTO');
  });
  mudou();
  res.json(carregar(c.id));
});

/* ---------------------------------- fila ---------------------------------- */

// Visualizar / gerenciar a fila do dia
consultasRouter.get('/fila', permitir(...RECEPCAO, 'MEDICO'), (req, res) => {
  const medicoId = req.usuario.tipo === 'MEDICO' ? req.usuario.id : req.query.medico_id ? Number(req.query.medico_id) : undefined;
  res.json({ data: hojeISO(), grupos: montarFila(hojeISO(), medicoId) });
});

// Paciente: acompanhar a própria posição em tempo real (sem ver dados de outros pacientes)
consultasRouter.get('/fila/minha', permitir('PACIENTE'), (req, res) => {
  const minhas = all<{ medico_id: number }>(
    `SELECT DISTINCT medico_id FROM consultas WHERE paciente_id = ? AND substr(data_hora,1,10) = ?
     AND status IN (${STATUS_ATIVOS.map(() => '?').join(',')})`,
    req.usuario.id, hojeISO(), ...STATUS_ATIVOS,
  );
  const resultado = minhas.flatMap(({ medico_id }) => {
    const g = montarFila(hojeISO(), medico_id)[0];
    if (!g) return [];
    const emEspera = g.itens.filter((i) => i.status === 'EM_ESPERA').length;
    const emAtendimento = g.itens.some((i) => i.status === 'EM_ATENDIMENTO');
    return g.itens
      .filter((i) => i.paciente_id === req.usuario.id)
      .map((i) => ({
        consulta_id: i.id,
        medico_nome: g.medico_nome,
        data_hora: i.data_hora,
        status: i.status,
        tipo: i.tipo,
        atraso_min: i.atraso_min,
        previsao: i.previsao,
        posicao: i.posicao,
        pessoas_na_frente: i.posicao ? i.posicao - 1 : null,
        total_em_espera: emEspera,
        medico_atendendo: emAtendimento,
      }));
  });
  res.json(resultado);
});

/* ------------------------------ lista de espera ------------------------------ */

consultasRouter.get('/lista-espera', permitir('PACIENTE', ...RECEPCAO), (req, res) => {
  const paciente = req.usuario.tipo === 'PACIENTE';
  res.json(
    all(
      `SELECT le.*, e.nome AS especialidade_nome, u.nome AS paciente_nome, u.telefone AS paciente_telefone
       FROM lista_espera le JOIN especialidades e ON e.id = le.especialidade_id JOIN usuarios u ON u.id = le.paciente_id
       WHERE le.ativo = 1 ${paciente ? 'AND le.paciente_id = ?' : ''}
       ORDER BY le.prioridade DESC, le.data_solicitacao ASC`,
      ...(paciente ? [req.usuario.id] : []),
    ),
  );
});

// Solicitar encaixe / entrar na lista de espera
consultasRouter.post('/lista-espera', permitir('PACIENTE', ...RECEPCAO), (req, res) => {
  const d = validar(
    z.object({
      especialidade_id: z.number().int().positive('Escolha a especialidade.'),
      paciente_id: z.number().int().positive().optional(),
      prioridade: z.number().int().min(0).max(2).default(0),
      observacao: z.string().trim().max(300).optional(),
    }),
    req.body,
  );
  const paciente = req.usuario.tipo === 'PACIENTE';
  const pacienteId = paciente ? req.usuario.id : d.paciente_id;
  if (!pacienteId) throw new HttpError(400, 'Escolha o paciente.');
  const ja = one('SELECT id FROM lista_espera WHERE paciente_id = ? AND especialidade_id = ? AND ativo = 1', pacienteId, d.especialidade_id);
  if (ja) throw new HttpError(409, 'Já existe um pedido ativo para esta especialidade.');
  const { id } = run(
    'INSERT INTO lista_espera (paciente_id, especialidade_id, prioridade, observacao) VALUES (?,?,?,?)',
    pacienteId, d.especialidade_id, paciente ? 0 : d.prioridade, d.observacao ?? null,
  );
  auditar(req.usuario.id, 'lista_espera', id, 'ENTROU_LISTA');
  res.status(201).json({ id });
});

consultasRouter.put('/lista-espera/:id', permitir(...RECEPCAO), (req, res) => {
  const id = idParam(req);
  const { prioridade } = validar(z.object({ prioridade: z.number().int().min(0).max(2) }), req.body);
  if (!run('UPDATE lista_espera SET prioridade = ? WHERE id = ?', prioridade, id).changes) throw naoEncontrado('Pedido');
  auditar(req.usuario.id, 'lista_espera', id, 'ALTEROU_PRIORIDADE', { prioridade });
  res.json({ ok: true });
});

consultasRouter.delete('/lista-espera/:id', permitir('PACIENTE', ...RECEPCAO), (req, res) => {
  const id = idParam(req);
  const le = one<{ paciente_id: number }>('SELECT paciente_id FROM lista_espera WHERE id = ? AND ativo = 1', id);
  if (!le) throw naoEncontrado('Pedido');
  if (req.usuario.tipo === 'PACIENTE' && le.paciente_id !== req.usuario.id) throw proibido();
  run('UPDATE lista_espera SET ativo = 0 WHERE id = ?', id);
  auditar(req.usuario.id, 'lista_espera', id, 'SAIU_LISTA');
  res.json({ ok: true });
});
