import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';

const caminho = resolve(config.dbPath);
mkdirSync(dirname(caminho), { recursive: true });

export const db = new DatabaseSync(caminho);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

/**
 * Esquema baseado no "Diagrama BD.drawio".
 * Acréscimos em relação ao diagrama (necessários pelo TAP):
 *  - USUARIOS: troca_senha_obrigatoria, recuperacao_solicitada, criado_em
 *    e os perfis FINANCEIRO, LABORATORIO e FARMACIA
 *  - MEDICOS: crm_uf e crm_verificado (validação administrativa)
 *  - CONSULTAS: motivo_cancelamento, iniciada_em, finalizada_em, criado_em
 *  - NOTIFICACOES: avisos ao usuário (resultado de exame, vaga na lista de espera...)
 */
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  telefone TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('PACIENTE','MEDICO','RECEPCIONISTA','ADMIN','FINANCEIRO','LABORATORIO','FARMACIA')),
  ativo INTEGER NOT NULL DEFAULT 1,
  troca_senha_obrigatoria INTEGER NOT NULL DEFAULT 0,
  recuperacao_solicitada INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS convenios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  registro_ans TEXT
);

CREATE TABLE IF NOT EXISTS especialidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS medicos (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  crm TEXT NOT NULL,
  crm_uf TEXT NOT NULL,
  crm_verificado INTEGER NOT NULL DEFAULT 0,
  UNIQUE (crm, crm_uf)
);

CREATE TABLE IF NOT EXISTS pacientes (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  cpf TEXT NOT NULL UNIQUE,
  data_nascimento TEXT NOT NULL,
  convenio_id INTEGER REFERENCES convenios(id),
  numero_carteirinha TEXT
);

CREATE TABLE IF NOT EXISTS medico_especialidade (
  medico_id INTEGER NOT NULL REFERENCES medicos(usuario_id) ON DELETE CASCADE,
  especialidade_id INTEGER NOT NULL REFERENCES especialidades(id) ON DELETE CASCADE,
  PRIMARY KEY (medico_id, especialidade_id)
);

CREATE TABLE IF NOT EXISTS disponibilidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medico_id INTEGER NOT NULL REFERENCES medicos(usuario_id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio TEXT NOT NULL,
  hora_fim TEXT NOT NULL,
  duracao_min INTEGER NOT NULL DEFAULT 30 CHECK (duracao_min BETWEEN 5 AND 240),
  CHECK (hora_inicio < hora_fim)
);

CREATE TABLE IF NOT EXISTS consultas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(usuario_id),
  medico_id INTEGER NOT NULL REFERENCES medicos(usuario_id),
  data_hora TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'NORMAL' CHECK (tipo IN ('NORMAL','ENCAIXE','RETORNO')),
  status TEXT NOT NULL DEFAULT 'AGENDADA' CHECK (status IN ('AGENDADA','CONFIRMADA','EM_ESPERA','EM_ATENDIMENTO','FINALIZADA','CANCELADA','FALTOU')),
  check_in_em TEXT,
  atraso_min INTEGER NOT NULL DEFAULT 0,
  anotacoes TEXT,
  motivo_cancelamento TEXT,
  iniciada_em TEXT,
  finalizada_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Meta do TAP: zero agendamentos duplicados no mesmo horário.
-- Encaixes são a exceção prevista (entram entre os horários da agenda).
CREATE UNIQUE INDEX IF NOT EXISTS ux_consulta_medico_horario
  ON consultas (medico_id, data_hora)
  WHERE status NOT IN ('CANCELADA','FALTOU') AND tipo <> 'ENCAIXE';
CREATE UNIQUE INDEX IF NOT EXISTS ux_consulta_paciente_horario
  ON consultas (paciente_id, data_hora)
  WHERE status NOT IN ('CANCELADA','FALTOU');
CREATE INDEX IF NOT EXISTS ix_consulta_data ON consultas (data_hora);

CREATE TABLE IF NOT EXISTS lista_espera (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(usuario_id),
  especialidade_id INTEGER NOT NULL REFERENCES especialidades(id),
  data_solicitacao TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  prioridade INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  observacao TEXT
);

CREATE TABLE IF NOT EXISTS prontuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL UNIQUE REFERENCES pacientes(usuario_id),
  alergias TEXT,
  observacoes TEXT
);

CREATE TABLE IF NOT EXISTS documentos_medicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prontuario_id INTEGER NOT NULL REFERENCES prontuarios(id),
  consulta_id INTEGER REFERENCES consultas(id),
  medico_id INTEGER REFERENCES medicos(usuario_id),
  tipo TEXT NOT NULL CHECK (tipo IN ('RECEITA','ATESTADO')),
  conteudo TEXT NOT NULL,
  data_emissao TEXT NOT NULL DEFAULT (date('now','localtime')),
  data_retirada TEXT
);

CREATE TABLE IF NOT EXISTS exames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prontuario_id INTEGER NOT NULL REFERENCES prontuarios(id),
  consulta_id INTEGER NOT NULL REFERENCES consultas(id),
  tipo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SOLICITADO' CHECK (status IN ('SOLICITADO','COLETADO','CONCLUIDO')),
  data_solicitacao TEXT NOT NULL DEFAULT (date('now','localtime')),
  data_resultado TEXT,
  arquivo_resultado TEXT,
  arquivo_nome TEXT,
  prazo_retorno_dias INTEGER
);

CREATE TABLE IF NOT EXISTS boletos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consulta_id INTEGER NOT NULL UNIQUE REFERENCES consultas(id),
  convenio_id INTEGER REFERENCES convenios(id),
  valor REAL NOT NULL CHECK (valor >= 0),
  vencimento TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','PAGO','CANCELADO'))
);

CREATE TABLE IF NOT EXISTS log_alteracoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  entidade TEXT NOT NULL,
  registro_id INTEGER,
  acao TEXT NOT NULL,
  detalhes TEXT,
  data_hora TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notificacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  link TEXT,
  lida INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

type Param = SQLInputValue | boolean | undefined;
const norm = (p: Param[]) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

/** Retorna a primeira linha (ou undefined). */
export function one<T = any>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...norm(params)) as T | undefined;
}

/** Retorna todas as linhas. */
export function all<T = any>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...norm(params)) as T[];
}

/** Executa INSERT/UPDATE/DELETE e devolve o id inserido e o nº de linhas afetadas. */
export function run(sql: string, ...params: Param[]) {
  const r = db.prepare(sql).run(...norm(params));
  return { id: Number(r.lastInsertRowid), changes: Number(r.changes) };
}

/** Executa a função dentro de uma transação. */
export function transacao<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
