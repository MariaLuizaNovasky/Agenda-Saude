import { Router } from 'express';
import { z } from 'zod';
import { permitir, RECEPCAO, type Perfil } from '../auth.js';
import { all, one, run, transacao } from '../db.js';
import { auditar, crmFormatoValido, HttpError, idParam, naoEncontrado, UFS, validar } from '../util.js';
import { hashSenha, senhaForte } from './auth.js';

/* ------------------------------------------------------------------
 * Administrador: usuários e permissões, especialidades, convênios
 * ------------------------------------------------------------------ */
export const adminRouter = Router();

const PERFIS_EQUIPE = ['RECEPCIONISTA', 'MEDICO', 'ADMIN', 'FINANCEIRO', 'LABORATORIO', 'FARMACIA'] as const;

adminRouter.get('/usuarios', permitir('ADMIN'), (req, res) => {
  const { tipo, busca, recuperacao } = req.query as Record<string, string | undefined>;
  const filtros: string[] = [];
  const params: (string | number)[] = [];
  if (tipo) { filtros.push('u.tipo = ?'); params.push(tipo); }
  if (busca) { filtros.push('(u.nome LIKE ? OR u.email LIKE ?)'); params.push(`%${busca}%`, `%${busca}%`); }
  if (recuperacao === '1') filtros.push('u.recuperacao_solicitada = 1');
  res.json(
    all(
      `SELECT u.id, u.nome, u.email, u.telefone, u.tipo, u.ativo, u.troca_senha_obrigatoria, u.recuperacao_solicitada, u.criado_em,
              m.crm, m.crm_uf, m.crm_verificado,
              (SELECT group_concat(especialidade_id) FROM medico_especialidade WHERE medico_id = u.id) AS especialidade_ids
       FROM usuarios u LEFT JOIN medicos m ON m.usuario_id = u.id
       ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
       ORDER BY u.recuperacao_solicitada DESC, u.nome`,
      ...params,
    ),
  );
});

const medicoSchema = z.object({
  crm: z.string().trim().refine(crmFormatoValido, 'CRM deve ter de 4 a 7 dígitos.'),
  crm_uf: z.enum(UFS as [string, ...string[]], 'Escolha a UF do CRM.'),
  especialidade_ids: z.array(z.number().int().positive()).min(1, 'Escolha ao menos uma especialidade.'),
});

// Administrador.gerenciarUsuarios(): cria membro da equipe com senha temporária
adminRouter.post('/usuarios', permitir('ADMIN'), (req, res) => {
  const base = validar(
    z.object({
      nome: z.string().trim().min(3, 'Informe o nome completo.'),
      email: z.email('Informe um e-mail válido.'),
      telefone: z.string().trim().optional(),
      tipo: z.enum(PERFIS_EQUIPE, 'Escolha o perfil de acesso.'),
      senha_temporaria: senhaForte,
    }),
    req.body,
  );
  const med = base.tipo === 'MEDICO' ? validar(medicoSchema, req.body) : null;
  const id = transacao(() => {
    const { id } = run(
      'INSERT INTO usuarios (nome, email, senha_hash, telefone, tipo, troca_senha_obrigatoria) VALUES (?,?,?,?,?,1)',
      base.nome, base.email.toLowerCase(), hashSenha(base.senha_temporaria), base.telefone ?? null, base.tipo,
    );
    if (med) {
      run('INSERT INTO medicos (usuario_id, crm, crm_uf) VALUES (?,?,?)', id, med.crm.replace(/\D/g, ''), med.crm_uf);
      for (const e of med.especialidade_ids) run('INSERT INTO medico_especialidade VALUES (?,?)', id, e);
    }
    auditar(req.usuario.id, 'usuarios', id, 'CRIOU_USUARIO', { tipo: base.tipo });
    return id;
  });
  res.status(201).json({ id });
});

// Administrador.gerenciarPermissoes(): altera perfil, dados e status
adminRouter.put('/usuarios/:id', permitir('ADMIN'), (req, res) => {
  const id = idParam(req);
  const atual = one<{ tipo: Perfil }>('SELECT tipo FROM usuarios WHERE id = ?', id);
  if (!atual) throw naoEncontrado('Usuário');
  const d = validar(
    z.object({
      nome: z.string().trim().min(3, 'Informe o nome completo.'),
      telefone: z.string().trim().nullish(),
      tipo: z.enum([...PERFIS_EQUIPE, 'PACIENTE']),
      ativo: z.boolean(),
    }),
    req.body,
  );
  // paciente e médico têm tabelas próprias: o perfil deles não pode ser trocado por outro
  const fixos: Perfil[] = ['PACIENTE', 'MEDICO'];
  if (d.tipo !== atual.tipo && (fixos.includes(atual.tipo) || fixos.includes(d.tipo))) {
    throw new HttpError(400, 'Pacientes e médicos não podem mudar de perfil. Crie um novo usuário.');
  }
  if (id === req.usuario.id && (!d.ativo || d.tipo !== 'ADMIN')) {
    throw new HttpError(400, 'Você não pode desativar nem rebaixar o seu próprio acesso.');
  }
  transacao(() => {
    run('UPDATE usuarios SET nome = ?, telefone = ?, tipo = ?, ativo = ? WHERE id = ?', d.nome, d.telefone, d.tipo, d.ativo, id);
    if (atual.tipo === 'MEDICO' && req.body.crm !== undefined) {
      const med = validar(medicoSchema, req.body);
      run('UPDATE medicos SET crm = ?, crm_uf = ? WHERE usuario_id = ?', med.crm.replace(/\D/g, ''), med.crm_uf, id);
      run('DELETE FROM medico_especialidade WHERE medico_id = ?', id);
      for (const e of med.especialidade_ids) run('INSERT INTO medico_especialidade VALUES (?,?)', id, e);
    }
    auditar(req.usuario.id, 'usuarios', id, 'EDITOU_USUARIO', d);
  });
  res.json({ ok: true });
});

// Gera senha temporária (atende o pedido de recuperação); troca obrigatória no próximo login
adminRouter.post('/usuarios/:id/senha-temporaria', permitir('ADMIN'), (req, res) => {
  const id = idParam(req);
  const { senha } = validar(z.object({ senha: senhaForte }), req.body);
  const r = run(
    'UPDATE usuarios SET senha_hash = ?, troca_senha_obrigatoria = 1, recuperacao_solicitada = 0 WHERE id = ?',
    hashSenha(senha), id,
  );
  if (!r.changes) throw naoEncontrado('Usuário');
  auditar(req.usuario.id, 'usuarios', id, 'GEROU_SENHA_TEMPORARIA');
  res.json({ mensagem: 'Senha temporária definida. O usuário terá de trocá-la ao entrar.' });
});

// Confirmação administrativa da situação do CRM
adminRouter.post('/medicos/:id/verificar-crm', permitir('ADMIN'), (req, res) => {
  const id = idParam(req);
  const { verificado } = validar(z.object({ verificado: z.boolean() }), req.body);
  const r = run('UPDATE medicos SET crm_verificado = ? WHERE usuario_id = ?', verificado, id);
  if (!r.changes) throw naoEncontrado('Médico');
  auditar(req.usuario.id, 'medicos', id, verificado ? 'CRM_VERIFICADO' : 'CRM_PENDENTE');
  res.json({ ok: true });
});

/* ---------------------------- especialidades ---------------------------- */
// leitura pública: usada no cadastro e na busca de horários
export const catalogoRouter = Router();
catalogoRouter.get('/especialidades', (_req, res) => {
  res.json(
    all(`SELECT e.id, e.nome,
           (SELECT count(*) FROM medico_especialidade me JOIN usuarios u ON u.id = me.medico_id
             WHERE me.especialidade_id = e.id AND u.ativo = 1) AS total_medicos
         FROM especialidades e ORDER BY e.nome`),
  );
});
catalogoRouter.get('/convenios', (_req, res) => {
  res.json(all('SELECT id, nome, registro_ans FROM convenios ORDER BY nome'));
});

const nomeSchema = z.object({ nome: z.string().trim().min(2, 'Informe o nome.') });

adminRouter.post('/especialidades', permitir('ADMIN'), (req, res) => {
  const { nome } = validar(nomeSchema, req.body);
  const { id } = run('INSERT INTO especialidades (nome) VALUES (?)', nome);
  auditar(req.usuario.id, 'especialidades', id, 'CRIOU', { nome });
  res.status(201).json({ id });
});
adminRouter.put('/especialidades/:id', permitir('ADMIN'), (req, res) => {
  const id = idParam(req);
  const { nome } = validar(nomeSchema, req.body);
  if (!run('UPDATE especialidades SET nome = ? WHERE id = ?', nome, id).changes) throw naoEncontrado('Especialidade');
  auditar(req.usuario.id, 'especialidades', id, 'EDITOU', { nome });
  res.json({ ok: true });
});
adminRouter.delete('/especialidades/:id', permitir('ADMIN'), (req, res) => {
  const id = idParam(req);
  const uso = one<{ n: number }>(
    'SELECT (SELECT count(*) FROM medico_especialidade WHERE especialidade_id = ?) + (SELECT count(*) FROM lista_espera WHERE especialidade_id = ?) AS n',
    id, id,
  )!;
  if (uso.n) throw new HttpError(409, 'Há médicos ou pedidos na lista de espera com esta especialidade.');
  run('DELETE FROM especialidades WHERE id = ?', id);
  auditar(req.usuario.id, 'especialidades', id, 'EXCLUIU');
  res.json({ ok: true });
});

const convenioSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.'),
  registro_ans: z.string().trim().regex(/^\d{6}$/, 'O registro ANS tem 6 dígitos.'),
});
adminRouter.post('/convenios', permitir('ADMIN'), (req, res) => {
  const d = validar(convenioSchema, req.body);
  const { id } = run('INSERT INTO convenios (nome, registro_ans) VALUES (?,?)', d.nome, d.registro_ans);
  auditar(req.usuario.id, 'convenios', id, 'CRIOU', d);
  res.status(201).json({ id });
});
adminRouter.put('/convenios/:id', permitir('ADMIN'), (req, res) => {
  const id = idParam(req);
  const d = validar(convenioSchema, req.body);
  if (!run('UPDATE convenios SET nome = ?, registro_ans = ? WHERE id = ?', d.nome, d.registro_ans, id).changes) throw naoEncontrado('Convênio');
  auditar(req.usuario.id, 'convenios', id, 'EDITOU', d);
  res.json({ ok: true });
});
adminRouter.delete('/convenios/:id', permitir('ADMIN'), (req, res) => {
  const id = idParam(req);
  const uso = one<{ n: number }>('SELECT count(*) AS n FROM pacientes WHERE convenio_id = ?', id)!;
  if (uso.n) throw new HttpError(409, 'Há pacientes vinculados a este convênio.');
  run('DELETE FROM convenios WHERE id = ?', id);
  auditar(req.usuario.id, 'convenios', id, 'EXCLUIU');
  res.json({ ok: true });
});

/* ------------------------------ relatórios ------------------------------ */
adminRouter.get('/relatorios/log', permitir('ADMIN'), (req, res) => {
  const { entidade, usuario_id } = req.query as Record<string, string | undefined>;
  const f: string[] = [];
  const p: (string | number)[] = [];
  if (entidade) { f.push('l.entidade = ?'); p.push(entidade); }
  if (usuario_id) { f.push('l.usuario_id = ?'); p.push(Number(usuario_id)); }
  res.json(
    all(
      `SELECT l.*, u.nome AS usuario_nome, u.tipo AS usuario_tipo FROM log_alteracoes l
       LEFT JOIN usuarios u ON u.id = l.usuario_id ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
       ORDER BY l.id DESC LIMIT 300`,
      ...p,
    ),
  );
});

// Administrador.gerarRelatorio(): consultas por médico e status num período
adminRouter.get('/relatorios/consultas', permitir(...RECEPCAO), (req, res) => {
  const { inicio, fim } = validar(z.object({ inicio: z.iso.date(), fim: z.iso.date() }), req.query);
  res.json(
    all(
      `SELECT u.nome AS medico_nome, c.medico_id,
              count(*) AS total,
              sum(c.status = 'FINALIZADA') AS finalizadas,
              sum(c.status = 'CANCELADA') AS canceladas,
              sum(c.status = 'FALTOU') AS faltas,
              sum(c.tipo = 'ENCAIXE') AS encaixes,
              sum(c.tipo = 'RETORNO') AS retornos,
              round(avg(CASE WHEN c.check_in_em IS NOT NULL AND c.iniciada_em IS NOT NULL
                   THEN (julianday(c.iniciada_em) - julianday(c.check_in_em)) * 1440 END), 0) AS espera_media_min
       FROM consultas c JOIN usuarios u ON u.id = c.medico_id
       WHERE substr(c.data_hora,1,10) BETWEEN ? AND ?
       GROUP BY c.medico_id ORDER BY u.nome`,
      inicio, fim,
    ),
  );
});
