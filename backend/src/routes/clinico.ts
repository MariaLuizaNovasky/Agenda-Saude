import { Router } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { permitir, RECEPCAO, type UsuarioToken } from '../auth.js';
import { config } from '../config.js';
import { all, one, run } from '../db.js';
import { emitir } from '../events.js';
import { auditar, HttpError, hojeISO, idParam, naoEncontrado, notificar, proibido, somarDias, validar } from '../util.js';

export const clinicoRouter = Router();

/** Médico só acessa o prontuário de quem tem ou teve consulta com ele. */
function medicoAtendePaciente(medicoId: number, pacienteId: number) {
  return !!one('SELECT 1 FROM consultas WHERE medico_id = ? AND paciente_id = ? LIMIT 1', medicoId, pacienteId);
}

function exigirAcessoClinico(u: UsuarioToken, pacienteId: number) {
  if (u.tipo === 'PACIENTE' && u.id === pacienteId) return;
  if (u.tipo === 'MEDICO' && medicoAtendePaciente(u.id, pacienteId)) return;
  throw proibido();
}

function prontuarioDe(pacienteId: number) {
  let p = one<{ id: number }>('SELECT * FROM prontuarios WHERE paciente_id = ?', pacienteId);
  if (!p) {
    if (!one('SELECT 1 FROM pacientes WHERE usuario_id = ?', pacienteId)) throw naoEncontrado('Paciente');
    run('INSERT INTO prontuarios (paciente_id) VALUES (?)', pacienteId);
    p = one<{ id: number }>('SELECT * FROM prontuarios WHERE paciente_id = ?', pacienteId);
  }
  return p!;
}

const SQL_EXAME = `
  SELECT ex.*, pr.paciente_id, up.nome AS paciente_nome, p.cpf AS paciente_cpf, c.medico_id, um.nome AS medico_nome,
         CASE WHEN ex.data_resultado IS NOT NULL AND ex.prazo_retorno_dias IS NOT NULL
              THEN date(ex.data_resultado, '+' || ex.prazo_retorno_dias || ' days') END AS data_limite_retorno
  FROM exames ex
  JOIN prontuarios pr ON pr.id = ex.prontuario_id
  JOIN pacientes p ON p.usuario_id = pr.paciente_id
  JOIN usuarios up ON up.id = pr.paciente_id
  JOIN consultas c ON c.id = ex.consulta_id
  JOIN usuarios um ON um.id = c.medico_id`;

const SQL_DOC = `
  SELECT d.*, pr.paciente_id, up.nome AS paciente_nome, p.cpf AS paciente_cpf, um.nome AS medico_nome, m.crm, m.crm_uf
  FROM documentos_medicos d
  JOIN prontuarios pr ON pr.id = d.prontuario_id
  JOIN pacientes p ON p.usuario_id = pr.paciente_id
  JOIN usuarios up ON up.id = pr.paciente_id
  LEFT JOIN usuarios um ON um.id = d.medico_id
  LEFT JOIN medicos m ON m.usuario_id = d.medico_id`;

/* ------------------------------- prontuário ------------------------------- */

// Prontuario.consultarHistorico(): dados, consultas, exames, receitas e atestados
clinicoRouter.get('/pacientes/:id/historico', (req, res) => {
  const pacienteId = idParam(req);
  exigirAcessoClinico(req.usuario, pacienteId);
  const prontuario = prontuarioDe(pacienteId);
  const paciente = one(
    `SELECT u.id, u.nome, u.email, u.telefone, p.cpf, p.data_nascimento, p.numero_carteirinha, c.nome AS convenio_nome
     FROM pacientes p JOIN usuarios u ON u.id = p.usuario_id LEFT JOIN convenios c ON c.id = p.convenio_id WHERE u.id = ?`,
    pacienteId,
  );
  const consultas = all(
    `SELECT c.id, c.data_hora, c.tipo, c.status, c.anotacoes, c.motivo_cancelamento, u.nome AS medico_nome
     FROM consultas c JOIN usuarios u ON u.id = c.medico_id WHERE c.paciente_id = ? ORDER BY c.data_hora DESC`,
    pacienteId,
  );
  // o paciente não lê as anotações clínicas internas do médico
  if (req.usuario.tipo === 'PACIENTE') for (const c of consultas) delete c.anotacoes;
  res.json({
    paciente,
    prontuario,
    consultas,
    exames: all(`${SQL_EXAME} WHERE pr.paciente_id = ? ORDER BY ex.id DESC`, pacienteId),
    documentos: all(`${SQL_DOC} WHERE pr.paciente_id = ? ORDER BY d.id DESC`, pacienteId),
  });
});

// Criar e atualizar prontuário
clinicoRouter.put('/pacientes/:id/prontuario', permitir('MEDICO'), (req, res) => {
  const pacienteId = idParam(req);
  exigirAcessoClinico(req.usuario, pacienteId);
  const d = validar(z.object({ alergias: z.string().max(2000), observacoes: z.string().max(5000) }), req.body);
  const p = prontuarioDe(pacienteId);
  run('UPDATE prontuarios SET alergias = ?, observacoes = ? WHERE id = ?', d.alergias, d.observacoes, p.id);
  auditar(req.usuario.id, 'prontuarios', p.id, 'ATUALIZOU');
  res.json({ ok: true });
});

/** Consulta em andamento ou já finalizada pelo próprio médico. */
function consultaDoMedico(u: UsuarioToken, consultaId: number) {
  const c = one<{ id: number; paciente_id: number; medico_id: number; status: string }>('SELECT * FROM consultas WHERE id = ?', consultaId);
  if (!c) throw naoEncontrado('Consulta');
  if (c.medico_id !== u.id) throw proibido();
  if (!['EM_ATENDIMENTO', 'FINALIZADA'].includes(c.status)) throw new HttpError(400, 'Inicie o atendimento para registrar documentos e exames.');
  return c;
}

/* ---------------------------- receitas e atestados ---------------------------- */

// DocumentoMedico.emitir()
clinicoRouter.post('/documentos', permitir('MEDICO'), (req, res) => {
  const d = validar(
    z.object({
      consulta_id: z.number().int().positive(),
      tipo: z.enum(['RECEITA', 'ATESTADO']),
      conteudo: z.string().trim().min(5, 'Escreva o conteúdo do documento.').max(5000),
    }),
    req.body,
  );
  const c = consultaDoMedico(req.usuario, d.consulta_id);
  const p = prontuarioDe(c.paciente_id);
  const { id } = run(
    'INSERT INTO documentos_medicos (prontuario_id, consulta_id, medico_id, tipo, conteudo) VALUES (?,?,?,?,?)',
    p.id, c.id, req.usuario.id, d.tipo, d.conteudo,
  );
  auditar(req.usuario.id, 'documentos_medicos', id, 'EMITIU', { tipo: d.tipo });
  notificar(c.paciente_id, d.tipo === 'RECEITA' ? 'Nova receita' : 'Novo atestado', 'O documento está disponível no seu histórico.', '/historico');
  emitir('notificacao');
  res.status(201).json(one(`${SQL_DOC} WHERE d.id = ?`, id));
});

clinicoRouter.get('/documentos', permitir('FARMACIA', 'MEDICO', 'PACIENTE'), (req, res) => {
  const u = req.usuario;
  const busca = String(req.query.busca ?? '').trim();
  const f: string[] = [];
  const p: (string | number)[] = [];
  if (u.tipo === 'FARMACIA') {
    // a farmácia só vê receitas, e só quando busca pelo CPF do paciente ou pelo número da receita
    f.push("d.tipo = 'RECEITA'");
    const dig = busca.replace(/\D/g, '');
    if (!dig) return res.json([]);
    f.push('(p.cpf = ? OR d.id = ?)');
    p.push(dig, Number(dig));
  } else if (u.tipo === 'MEDICO') {
    f.push('d.medico_id = ?'); p.push(u.id);
  } else {
    f.push('pr.paciente_id = ?'); p.push(u.id);
  }
  res.json(all(`${SQL_DOC} WHERE ${f.join(' AND ')} ORDER BY d.id DESC LIMIT 100`, ...p));
});

clinicoRouter.get('/documentos/:id', (req, res) => {
  const doc = one<{ paciente_id: number; tipo: string }>(`${SQL_DOC} WHERE d.id = ?`, idParam(req));
  if (!doc) throw naoEncontrado('Documento');
  if (req.usuario.tipo === 'FARMACIA') {
    if (doc.tipo !== 'RECEITA') throw proibido();
  } else exigirAcessoClinico(req.usuario, doc.paciente_id);
  res.json(doc);
});

// DocumentoMedico.registrarRetirada() — Farmácia (externo)
clinicoRouter.post('/documentos/:id/retirada', permitir('FARMACIA'), (req, res) => {
  const id = idParam(req);
  const doc = one<{ tipo: string; data_retirada: string | null; paciente_id: number }>(`${SQL_DOC} WHERE d.id = ?`, id);
  if (!doc || doc.tipo !== 'RECEITA') throw naoEncontrado('Receita');
  if (doc.data_retirada) throw new HttpError(409, `Esta receita já foi retirada em ${doc.data_retirada.split('-').reverse().join('/')}.`);
  run('UPDATE documentos_medicos SET data_retirada = ? WHERE id = ?', hojeISO(), id);
  auditar(req.usuario.id, 'documentos_medicos', id, 'REGISTROU_RETIRADA');
  res.json({ ok: true });
});

/* ---------------------------------- exames ---------------------------------- */

// Solicitar exame e definir prazo de retorno
clinicoRouter.post('/exames', permitir('MEDICO'), (req, res) => {
  const d = validar(
    z.object({
      consulta_id: z.number().int().positive(),
      tipo: z.string().trim().min(2, 'Informe o exame.'),
      prazo_retorno_dias: z.number().int().min(1).max(365).nullish(),
    }),
    req.body,
  );
  const c = consultaDoMedico(req.usuario, d.consulta_id);
  const p = prontuarioDe(c.paciente_id);
  const { id } = run(
    'INSERT INTO exames (prontuario_id, consulta_id, tipo, prazo_retorno_dias) VALUES (?,?,?,?)',
    p.id, c.id, d.tipo, d.prazo_retorno_dias ?? null,
  );
  auditar(req.usuario.id, 'exames', id, 'SOLICITOU', d);
  res.status(201).json(one(`${SQL_EXAME} WHERE ex.id = ?`, id));
});

clinicoRouter.get('/exames', permitir('LABORATORIO', 'MEDICO', 'PACIENTE'), (req, res) => {
  const u = req.usuario;
  const f: string[] = [];
  const p: (string | number)[] = [];
  if (u.tipo === 'MEDICO') { f.push('c.medico_id = ?'); p.push(u.id); }
  if (u.tipo === 'PACIENTE') { f.push('pr.paciente_id = ?'); p.push(u.id); }
  const status = String(req.query.status ?? '');
  if (status) {
    const s = status.split(',');
    f.push(`ex.status IN (${s.map(() => '?').join(',')})`);
    p.push(...s);
  }
  const busca = String(req.query.busca ?? '').trim();
  if (busca) { f.push('(up.nome LIKE ? OR p.cpf LIKE ? OR ex.tipo LIKE ?)'); p.push(`%${busca}%`, `%${busca.replace(/\D/g, '') || busca}%`, `%${busca}%`); }
  res.json(all(`${SQL_EXAME} ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY ex.status = 'CONCLUIDO', ex.id DESC LIMIT 300`, ...p));
});

// Exame.atualizarStatus(s) — Laboratório (externo)
clinicoRouter.put('/exames/:id/status', permitir('LABORATORIO'), (req, res) => {
  const id = idParam(req);
  const { status } = validar(z.object({ status: z.enum(['SOLICITADO', 'COLETADO']) }), req.body);
  const ex = one<{ status: string }>('SELECT status FROM exames WHERE id = ?', id);
  if (!ex) throw naoEncontrado('Exame');
  if (ex.status === 'CONCLUIDO') throw new HttpError(400, 'O exame já tem resultado anexado.');
  run('UPDATE exames SET status = ? WHERE id = ?', status, id);
  auditar(req.usuario.id, 'exames', id, 'ATUALIZOU_STATUS', { status });
  res.json({ ok: true });
});

// Exame.anexarResultado(arquivo) — conclui o exame e notifica o paciente
const pastaUploads = resolve(config.uploadsDir);
mkdirSync(pastaUploads, { recursive: true });
const TIPOS_PERMITIDOS = ['.pdf', '.png', '.jpg', '.jpeg'];
const upload = multer({
  storage: multer.diskStorage({
    destination: pastaUploads,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (TIPOS_PERMITIDOS.includes(extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new HttpError(400, 'Envie o resultado em PDF, PNG ou JPG.'));
  },
});

clinicoRouter.post('/exames/:id/resultado', permitir('LABORATORIO'), upload.single('arquivo'), (req, res) => {
  const id = idParam(req);
  if (!req.file) throw new HttpError(400, 'Anexe o arquivo do resultado.');
  const ex = one<{ paciente_id: number; medico_id: number; tipo: string; prazo_retorno_dias: number | null; medico_nome: string }>(
    `${SQL_EXAME} WHERE ex.id = ?`,
    id,
  );
  if (!ex) throw naoEncontrado('Exame');
  run(
    "UPDATE exames SET status = 'CONCLUIDO', data_resultado = ?, arquivo_resultado = ?, arquivo_nome = ? WHERE id = ?",
    hojeISO(), req.file.filename, req.file.originalname, id,
  );
  auditar(req.usuario.id, 'exames', id, 'ANEXOU_RESULTADO');
  const prazo = ex.prazo_retorno_dias
    ? ` Agende o retorno com ${ex.medico_nome} até ${somarDias(hojeISO(), ex.prazo_retorno_dias).split('-').reverse().join('/')}.`
    : '';
  notificar(ex.paciente_id, 'Resultado de exame disponível', `O resultado de ${ex.tipo} já está no seu histórico.${prazo}`, '/historico');
  notificar(ex.medico_id, 'Resultado de exame', `Saiu o resultado de ${ex.tipo}.`, '/atendimentos');
  emitir('notificacao');
  res.json(one(`${SQL_EXAME} WHERE ex.id = ?`, id));
});

clinicoRouter.get('/exames/:id/arquivo', (req, res) => {
  const ex = one<{ paciente_id: number; medico_id: number; arquivo_resultado: string | null; arquivo_nome: string | null }>(
    `${SQL_EXAME} WHERE ex.id = ?`,
    idParam(req),
  );
  if (!ex || !ex.arquivo_resultado) throw naoEncontrado('Resultado');
  if (req.usuario.tipo !== 'LABORATORIO') exigirAcessoClinico(req.usuario, ex.paciente_id);
  const caminho = resolve(pastaUploads, ex.arquivo_resultado);
  if (!caminho.startsWith(pastaUploads) || !existsSync(caminho)) throw naoEncontrado('Arquivo');
  res.download(caminho, ex.arquivo_nome ?? ex.arquivo_resultado);
});

/* ---------------------------------- retornos ---------------------------------- */

/**
 * Retornos pendentes: exame concluído com prazo de retorno e sem consulta de RETORNO
 * marcada com o mesmo médico depois da solicitação do exame.
 */
clinicoRouter.get('/retornos', permitir('PACIENTE', ...RECEPCAO, 'MEDICO'), (req, res) => {
  const u = req.usuario;
  const f = ["ex.status = 'CONCLUIDO'", 'ex.prazo_retorno_dias IS NOT NULL'];
  const p: number[] = [];
  if (u.tipo === 'PACIENTE') { f.push('pr.paciente_id = ?'); p.push(u.id); }
  if (u.tipo === 'MEDICO') { f.push('c.medico_id = ?'); p.push(u.id); }
  f.push(`NOT EXISTS (SELECT 1 FROM consultas r WHERE r.paciente_id = pr.paciente_id AND r.medico_id = c.medico_id
          AND r.tipo = 'RETORNO' AND r.status NOT IN ('CANCELADA','FALTOU') AND r.data_hora >= ex.data_solicitacao)`);
  res.json(
    all(
      `SELECT * FROM (${SQL_EXAME} WHERE ${f.join(' AND ')}) ORDER BY data_limite_retorno`,
      ...p,
    ),
  );
});
