import { Router } from 'express';
import { z } from 'zod';
import { permitir, RECEPCAO, type UsuarioToken } from '../auth.js';
import { gerarHorarios } from '../agenda.js';
import { all, one, run, transacao } from '../db.js';
import { emitir } from '../events.js';
import { auditar, cpfValido, HttpError, hojeISO, idParam, naoEncontrado, notificar, proibido, validar } from '../util.js';
import { hashSenha, senhaForte } from './auth.js';

export const pessoasRouter = Router();

/* -------------------------------- médicos -------------------------------- */

// Consultar médicos, especialidades e horários disponíveis
pessoasRouter.get('/medicos', (req, res) => {
  const esp = req.query.especialidade_id ? Number(req.query.especialidade_id) : null;
  const medicos = all(
    `SELECT u.id, u.nome, m.crm, m.crm_uf, m.crm_verificado,
            (SELECT group_concat(e.nome, ', ') FROM medico_especialidade me JOIN especialidades e ON e.id = me.especialidade_id WHERE me.medico_id = u.id) AS especialidades,
            (SELECT group_concat(me.especialidade_id) FROM medico_especialidade me WHERE me.medico_id = u.id) AS especialidade_ids,
            (SELECT max(atraso_min) FROM consultas c WHERE c.medico_id = u.id AND substr(c.data_hora,1,10) = ?
               AND c.status IN ('AGENDADA','CONFIRMADA','EM_ESPERA')) AS atraso_hoje
     FROM medicos m JOIN usuarios u ON u.id = m.usuario_id
     WHERE u.ativo = 1 ${esp ? 'AND EXISTS (SELECT 1 FROM medico_especialidade me WHERE me.medico_id = u.id AND me.especialidade_id = ?)' : ''}
     ORDER BY u.nome`,
    ...(esp ? [hojeISO(), esp] : [hojeISO()]),
  );
  res.json(medicos);
});

pessoasRouter.get('/medicos/:id/horarios', (req, res) => {
  const id = idParam(req);
  const { data } = validar(z.object({ data: z.iso.date('Informe a data.') }), req.query);
  res.json(gerarHorarios(id, data));
});

/** Próximos dias com horário livre (até 30 dias), para o calendário de agendamento. */
pessoasRouter.get('/medicos/:id/dias-livres', (req, res) => {
  const id = idParam(req);
  const dias: { data: string; livres: number }[] = [];
  const hoje = new Date();
  for (let i = 0; i < 30; i++) {
    const d = hojeISO(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + i));
    const livres = gerarHorarios(id, d).filter((h) => h.livre).length;
    if (livres) dias.push({ data: d, livres });
  }
  res.json(dias);
});

function podeGerirAgenda(usuario: UsuarioToken, medicoId: number) {
  if (usuario.tipo === 'MEDICO' && usuario.id === medicoId) return;
  if (RECEPCAO.includes(usuario.tipo)) return;
  throw proibido();
}

// Medico.gerenciarDisponibilidade()
pessoasRouter.get('/medicos/:id/disponibilidades', (req, res) => {
  const id = idParam(req);
  res.json(all('SELECT * FROM disponibilidades WHERE medico_id = ? ORDER BY dia_semana, hora_inicio', id));
});

pessoasRouter.post('/medicos/:id/disponibilidades', (req, res) => {
  const id = idParam(req);
  podeGerirAgenda(req.usuario, id);
  const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM.');
  const d = validar(
    z.object({
      dia_semana: z.number().int().min(0).max(6),
      hora_inicio: hora,
      hora_fim: hora,
      duracao_min: z.number().int().min(10, 'Duração mínima de 10 minutos.').max(240),
    }),
    req.body,
  );
  if (d.hora_inicio >= d.hora_fim) throw new HttpError(400, 'O fim precisa ser depois do início.');
  const sobrepoe = one(
    'SELECT id FROM disponibilidades WHERE medico_id = ? AND dia_semana = ? AND hora_inicio < ? AND hora_fim > ?',
    id, d.dia_semana, d.hora_fim, d.hora_inicio,
  );
  if (sobrepoe) throw new HttpError(409, 'Este período se sobrepõe a outro já cadastrado neste dia.');
  const r = run(
    'INSERT INTO disponibilidades (medico_id, dia_semana, hora_inicio, hora_fim, duracao_min) VALUES (?,?,?,?,?)',
    id, d.dia_semana, d.hora_inicio, d.hora_fim, d.duracao_min,
  );
  auditar(req.usuario.id, 'disponibilidades', r.id, 'CRIOU', d);
  emitir('agenda');
  res.status(201).json({ id: r.id });
});

pessoasRouter.delete('/medicos/:id/disponibilidades/:dispId', (req, res) => {
  const id = idParam(req);
  podeGerirAgenda(req.usuario, id);
  const dispId = idParam(req, 'dispId');
  if (!run('DELETE FROM disponibilidades WHERE id = ? AND medico_id = ?', dispId, id).changes) throw naoEncontrado('Período');
  auditar(req.usuario.id, 'disponibilidades', dispId, 'EXCLUIU');
  emitir('agenda');
  res.json({ ok: true, aviso: 'Consultas já marcadas neste período continuam na agenda.' });
});

// Medico.informarAtraso(min): vale para as consultas de hoje ainda não atendidas
pessoasRouter.post('/medicos/:id/atraso', (req, res) => {
  const id = idParam(req);
  podeGerirAgenda(req.usuario, id);
  const { minutos } = validar(z.object({ minutos: z.number().int().min(0).max(480) }), req.body);
  const pendentes = all<{ id: number; paciente_id: number; data_hora: string }>(
    `SELECT id, paciente_id, data_hora FROM consultas WHERE medico_id = ? AND substr(data_hora,1,10) = ?
     AND status IN ('AGENDADA','CONFIRMADA','EM_ESPERA')`,
    id, hojeISO(),
  );
  const medico = one<{ nome: string }>('SELECT nome FROM usuarios WHERE id = ?', id)!;
  transacao(() => {
    run(
      `UPDATE consultas SET atraso_min = ? WHERE medico_id = ? AND substr(data_hora,1,10) = ?
       AND status IN ('AGENDADA','CONFIRMADA','EM_ESPERA')`,
      minutos, id, hojeISO(),
    );
    for (const c of pendentes) {
      notificar(
        c.paciente_id,
        minutos ? 'Atendimento atrasado' : 'Atendimento no horário',
        minutos
          ? `${medico.nome} está com cerca de ${minutos} min de atraso. Sua consulta das ${c.data_hora.slice(11)} deve começar mais tarde.`
          : `${medico.nome} voltou ao horário normal.`,
        '/fila',
      );
    }
    auditar(req.usuario.id, 'consultas', null, 'INFORMOU_ATRASO', { medico_id: id, minutos, consultas: pendentes.length });
  });
  emitir('fila');
  emitir('notificacao');
  res.json({ afetadas: pendentes.length });
});

/* ------------------------------- pacientes ------------------------------- */

const SQL_PACIENTE = `
  SELECT u.id, u.nome, u.email, u.telefone, u.ativo, p.cpf, p.data_nascimento, p.convenio_id, p.numero_carteirinha,
         c.nome AS convenio_nome
  FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id LEFT JOIN convenios c ON c.id = p.convenio_id`;

pessoasRouter.get('/pacientes', permitir('RECEPCIONISTA', 'ADMIN', 'MEDICO', 'FINANCEIRO'), (req, res) => {
  const busca = String(req.query.busca ?? '').trim();
  const digitos = busca.replace(/\D/g, '');
  res.json(
    all(
      `${SQL_PACIENTE} ${busca ? 'WHERE u.nome LIKE ? OR (? <> \'\' AND p.cpf LIKE ?) OR u.email LIKE ?' : ''} ORDER BY u.nome LIMIT 200`,
      ...(busca ? [`%${busca}%`, digitos, `%${digitos}%`, `%${busca}%`] : []),
    ),
  );
});

pessoasRouter.get('/pacientes/:id', (req, res) => {
  const id = idParam(req);
  if (req.usuario.tipo === 'PACIENTE' && req.usuario.id !== id) throw proibido();
  if (['LABORATORIO', 'FARMACIA'].includes(req.usuario.tipo)) throw proibido();
  const p = one(`${SQL_PACIENTE} WHERE u.id = ?`, id);
  if (!p) throw naoEncontrado('Paciente');
  res.json(p);
});

const pacienteSchema = z.object({
  nome: z.string().trim().min(3, 'Informe o nome completo.'),
  email: z.email('Informe um e-mail válido.'),
  telefone: z.string().trim().min(10, 'Informe um telefone com DDD.'),
  cpf: z.string().refine(cpfValido, 'CPF inválido.'),
  data_nascimento: z.iso.date('Informe a data de nascimento.'),
  convenio_id: z.number().int().positive().nullish(),
  numero_carteirinha: z.string().trim().nullish(),
});

// Recepção: gerenciar cadastro de pacientes
pessoasRouter.post('/pacientes', permitir(...RECEPCAO), (req, res) => {
  const d = validar(pacienteSchema.extend({ senha_temporaria: senhaForte }), req.body);
  if (d.convenio_id && !d.numero_carteirinha) throw new HttpError(400, 'Informe o número da carteirinha do convênio.');
  const id = transacao(() => {
    const { id } = run(
      "INSERT INTO usuarios (nome, email, senha_hash, telefone, tipo, troca_senha_obrigatoria) VALUES (?,?,?,?,'PACIENTE',1)",
      d.nome, d.email.toLowerCase(), hashSenha(d.senha_temporaria), d.telefone,
    );
    run(
      'INSERT INTO pacientes (usuario_id, cpf, data_nascimento, convenio_id, numero_carteirinha) VALUES (?,?,?,?,?)',
      id, d.cpf.replace(/\D/g, ''), d.data_nascimento, d.convenio_id, d.convenio_id ? d.numero_carteirinha : null,
    );
    run('INSERT INTO prontuarios (paciente_id) VALUES (?)', id);
    auditar(req.usuario.id, 'pacientes', id, 'CADASTROU');
    return id;
  });
  res.status(201).json({ id });
});

pessoasRouter.put('/pacientes/:id', permitir(...RECEPCAO), (req, res) => {
  const id = idParam(req);
  const d = validar(pacienteSchema, req.body);
  if (d.convenio_id && !d.numero_carteirinha) throw new HttpError(400, 'Informe o número da carteirinha do convênio.');
  transacao(() => {
    const r = run('UPDATE usuarios SET nome = ?, email = ?, telefone = ? WHERE id = ? AND tipo = \'PACIENTE\'', d.nome, d.email.toLowerCase(), d.telefone, id);
    if (!r.changes) throw naoEncontrado('Paciente');
    run(
      'UPDATE pacientes SET cpf = ?, data_nascimento = ?, convenio_id = ?, numero_carteirinha = ? WHERE usuario_id = ?',
      d.cpf.replace(/\D/g, ''), d.data_nascimento, d.convenio_id, d.convenio_id ? d.numero_carteirinha : null, id,
    );
    auditar(req.usuario.id, 'pacientes', id, 'EDITOU');
  });
  res.json({ ok: true });
});

/* ------------------------------ notificações ----------------------------- */

pessoasRouter.get('/notificacoes', (req, res) => {
  res.json(all('SELECT * FROM notificacoes WHERE usuario_id = ? ORDER BY id DESC LIMIT 50', req.usuario.id));
});
pessoasRouter.post('/notificacoes/:id/lida', (req, res) => {
  run('UPDATE notificacoes SET lida = 1 WHERE id = ? AND usuario_id = ?', idParam(req), req.usuario.id);
  res.json({ ok: true });
});
pessoasRouter.post('/notificacoes/lidas', (req, res) => {
  run('UPDATE notificacoes SET lida = 1 WHERE usuario_id = ?', req.usuario.id);
  res.json({ ok: true });
});
