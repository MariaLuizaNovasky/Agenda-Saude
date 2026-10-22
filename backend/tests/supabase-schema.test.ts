// Valida a migração do Supabase (supabase/migrations/0001) num PostgreSQL real em memória (PGlite).
// Simula o que o Supabase fornece: papéis anon/authenticated/service_role, auth.users e auth.uid().
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ID = {
  admin: '00000000-0000-4000-8000-000000000001',
  recepcao: '00000000-0000-4000-8000-000000000002',
  financeiro: '00000000-0000-4000-8000-000000000003',
  lab: '00000000-0000-4000-8000-000000000004',
  farmacia: '00000000-0000-4000-8000-000000000005',
  helena: '00000000-0000-4000-8000-000000000011',
  rafael: '00000000-0000-4000-8000-000000000012',
  ana: '00000000-0000-4000-8000-000000000021',
  carlos: '00000000-0000-4000-8000-000000000022',
  semConsulta: '00000000-0000-4000-8000-000000000023',
};
const CPF = { ana: '12345678909', carlos: '52998224725', semConsulta: '16899535009' };

let pg: PGlite;

/** Executa SQL como um usuário logado no Supabase (papel authenticated + auth.uid()). */
async function como<T = any>(uid: string | null, sql: string, params: unknown[] = []) {
  await pg.exec(uid ? `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);` : 'set role anon;');
  try {
    return (await pg.query<T>(sql, params)).rows;
  } finally {
    await pg.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}
const erro = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

beforeAll(async () => {
  pg = new PGlite({ extensions: { btree_gist } });
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  await pg.exec(readFileSync(new URL('../supabase/migrations/0001_agenda_saude.sql', import.meta.url), 'utf8'));
  await pg.exec(readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));

  const usuarios: [string, string, string][] = [
    [ID.admin, 'Marcos Admin', 'ADMIN'], [ID.recepcao, 'Juliana Recepcao', 'RECEPCIONISTA'], [ID.financeiro, 'Fernanda Financeiro', 'FINANCEIRO'],
    [ID.lab, 'Laboratorio Central', 'LABORATORIO'], [ID.farmacia, 'Farmacia Bem Viver', 'FARMACIA'],
    [ID.helena, 'Dra. Helena Prado', 'MEDICO'], [ID.rafael, 'Dr. Rafael Moreira', 'MEDICO'],
    [ID.ana, 'Ana Beatriz Ribeiro', 'PACIENTE'], [ID.carlos, 'Carlos Eduardo Lima', 'PACIENTE'], [ID.semConsulta, 'Paciente Sem Consulta', 'PACIENTE'],
  ];
  for (const [id, nome, tipo] of usuarios) {
    await pg.query('insert into auth.users (id) values ($1)', [id]);
    await pg.query('insert into public.usuarios (id, nome, email, tipo) values ($1,$2,$3,$4)', [id, nome, `${id}@teste.com`, tipo]);
  }
  await pg.exec(`
    insert into public.medicos (usuario_id, crm, crm_uf) values ('${ID.helena}', '123456', 'SP'), ('${ID.rafael}', '234567', 'SP');
    insert into public.pacientes (usuario_id, cpf, data_nascimento) values
      ('${ID.ana}', '${CPF.ana}', '1990-04-12'), ('${ID.carlos}', '${CPF.carlos}', '1985-09-30'), ('${ID.semConsulta}', '${CPF.semConsulta}', '1992-02-02');
    insert into public.prontuarios (paciente_id, alergias) values ('${ID.ana}', 'Dipirona'), ('${ID.carlos}', 'Nenhuma'), ('${ID.semConsulta}', null);
    insert into public.consultas (paciente_id, medico_id, data_hora, status) values
      ('${ID.ana}', '${ID.helena}', '2030-01-07 09:00-03', 'AGENDADA'),
      ('${ID.carlos}', '${ID.rafael}', '2030-01-07 10:00-03', 'AGENDADA');
  `);
});
afterAll(() => pg.close());

const consulta = (pac: string, med: string, hora: string, extra = "'NORMAL','AGENDADA'") =>
  pg.query<{ id: number }>(`insert into public.consultas (paciente_id, medico_id, data_hora, tipo, status) values ($1,$2,$3,${extra}) returning id`, [pac, med, hora]);

describe('integridade no banco', () => {
  it('a migração cria as 15 tabelas', async () => {
    const r = await pg.query<{ n: number }>("select count(*)::int n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'");
    expect(r.rows[0].n).toBe(15);
  });

  it('o seed do catálogo carrega e é repetível', async () => {
    await pg.exec(readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));
    expect((await pg.query<{ n: number }>('select count(*)::int n from public.especialidades')).rows[0].n).toBe(6);
  });

  it('bloqueia o mesmo horário do mesmo médico', async () => {
    expect(await erro(consulta(ID.carlos, ID.helena, '2030-01-07 09:00-03'))).toMatch(/ux_consulta_medico_horario/);
  });

  it('bloqueia o mesmo paciente em dois lugares no mesmo horário', async () => {
    expect(await erro(consulta(ID.ana, ID.rafael, '2030-01-07 09:00-03'))).toMatch(/ux_consulta_paciente_horario/);
  });

  it('encaixe é permitido no horário ocupado do médico', async () => {
    expect(await erro(consulta(ID.semConsulta, ID.helena, '2030-01-07 09:00-03', "'ENCAIXE','AGENDADA'"))).toBeNull();
  });

  it('cancelar libera o horário', async () => {
    await pg.exec(`update public.consultas set status = 'CANCELADA' where paciente_id = '${ID.ana}' and data_hora = '2030-01-07 09:00-03'`);
    expect(await erro(consulta(ID.carlos, ID.helena, '2030-01-07 09:00-03'))).toBeNull();
  });

  it('exige que o status siga o ciclo da consulta', async () => {
    const { rows } = await consulta(ID.ana, ID.helena, '2030-02-01 09:00-03');
    const id = rows[0].id;
    expect(await erro(pg.query("update public.consultas set status = 'FINALIZADA' where id = $1", [id]))).toMatch(/Transição de status inválida/);
    for (const s of ['CONFIRMADA', 'EM_ESPERA', 'EM_ATENDIMENTO', 'FINALIZADA']) {
      expect(await erro(pg.query('update public.consultas set status = $2 where id = $1', [id, s])), s).toBeNull();
    }
    expect(await erro(pg.query("update public.consultas set status = 'AGENDADA' where id = $1", [id]))).toMatch(/Transição de status inválida/);
  });

  it('só um atendimento em andamento por médico', async () => {
    const a = (await consulta(ID.ana, ID.rafael, '2030-03-01 09:00-03', "'NORMAL','EM_ESPERA'")).rows[0].id;
    const b = (await consulta(ID.carlos, ID.rafael, '2030-03-01 09:30-03', "'NORMAL','EM_ESPERA'")).rows[0].id;
    expect(await erro(pg.query("update public.consultas set status = 'EM_ATENDIMENTO' where id = $1", [a]))).toBeNull();
    expect(await erro(pg.query("update public.consultas set status = 'EM_ATENDIMENTO' where id = $1", [b]))).toMatch(/ux_um_atendimento_por_medico/);
  });

  it('valida CPF, CRM, UF e carteirinha do convênio', async () => {
    const novo = async (n: number) => {
      const id = `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;
      await pg.query('insert into auth.users (id) values ($1)', [id]);
      await pg.query("insert into public.usuarios (id, nome, email, tipo) values ($1,'Pessoa Teste',$2,'PACIENTE')", [id, `${id}@t.com`]);
      return id;
    };
    expect(await erro(pg.query("insert into public.pacientes (usuario_id, cpf, data_nascimento) values ($1,'123','2000-01-01')", [await novo(1)]))).toMatch(/cpf/);
    expect(await erro(pg.query("insert into public.pacientes (usuario_id, cpf, data_nascimento) values ($1,$2,'2000-01-01')", [await novo(2), CPF.ana]))).toMatch(/unique|duplicate/i);
    const conv = (await pg.query<{ id: number }>('select id from public.convenios limit 1')).rows[0].id;
    expect(await erro(pg.query("insert into public.pacientes (usuario_id, cpf, data_nascimento, convenio_id) values ($1,'39053344705','2000-01-01',$2)", [await novo(3), conv]))).toMatch(/check/);
    expect(await erro(pg.query("insert into public.medicos (usuario_id, crm, crm_uf) values ($1,'12','SP')", [await novo(4)]))).toMatch(/crm/);
    expect(await erro(pg.query("insert into public.medicos (usuario_id, crm, crm_uf) values ($1,'123456','XX')", [await novo(5)]))).toMatch(/crm_uf/);
    expect(await erro(pg.query("insert into public.medicos (usuario_id, crm, crm_uf) values ($1,'123456','SP')", [await novo(6)]))).toMatch(/unique|duplicate/i);
    expect(await erro(pg.query("insert into public.medicos (usuario_id, crm, crm_uf) values ($1,'123456','RJ')", [await novo(7)]))).toBeNull();
  });

  it('períodos de disponibilidade do mesmo médico não se sobrepõem', async () => {
    const ins = (d: number, a: string, b: string) =>
      pg.query('insert into public.disponibilidades (medico_id, dia_semana, hora_inicio, hora_fim) values ($1,$2,$3,$4)', [ID.helena, d, a, b]);
    expect(await erro(ins(1, '07:00', '12:00'))).toBeNull();
    expect(await erro(ins(1, '13:00', '18:00'))).toBeNull();
    expect(await erro(ins(1, '11:00', '14:00'))).toMatch(/sem_sobreposicao/);
    expect(await erro(ins(2, '11:00', '14:00'))).toBeNull(); // outro dia
    expect(await erro(ins(3, '10:00', '09:00'))).toMatch(/check/);
  });

  it('pedido ativo repetido na lista de espera é recusado', async () => {
    const esp = (await pg.query<{ id: number }>("select id from public.especialidades where nome = 'Ortopedia'")).rows[0].id;
    await pg.query('insert into public.lista_espera (paciente_id, especialidade_id) values ($1,$2)', [ID.ana, esp]);
    expect(await erro(pg.query('insert into public.lista_espera (paciente_id, especialidade_id) values ($1,$2)', [ID.ana, esp]))).toMatch(/ux_lista_espera_ativa/);
    await pg.query('update public.lista_espera set ativo = false where paciente_id = $1', [ID.ana]);
    expect(await erro(pg.query('insert into public.lista_espera (paciente_id, especialidade_id) values ($1,$2)', [ID.ana, esp]))).toBeNull();
  });

  it('o log de alterações é imutável, até para o superusuário', async () => {
    await pg.query("insert into public.log_alteracoes (usuario_id, entidade, acao, detalhes) values ($1,'consultas','AGENDOU','{\"a\":1}')", [ID.ana]);
    expect(await erro(pg.exec('update public.log_alteracoes set acao = \'X\''))).toMatch(/imutável/);
    expect(await erro(pg.exec('delete from public.log_alteracoes'))).toMatch(/imutável/);
  });

  it('boleto: um por consulta e sem valor negativo', async () => {
    const c = (await consulta(ID.semConsulta, ID.rafael, '2030-04-01 09:00-03')).rows[0].id;
    await pg.query("insert into public.boletos (consulta_id, valor, vencimento) values ($1,180,'2030-04-11')", [c]);
    expect(await erro(pg.query("insert into public.boletos (consulta_id, valor, vencimento) values ($1,180,'2030-04-11')", [c]))).toMatch(/unique|duplicate/i);
    const c2 = (await consulta(ID.semConsulta, ID.rafael, '2030-04-02 09:00-03')).rows[0].id;
    expect(await erro(pg.query("insert into public.boletos (consulta_id, valor, vencimento) values ($1,-1,'2030-04-11')", [c2]))).toMatch(/check/);
  });
});

describe('RLS: acesso entre perfis', () => {
  let consultaAna: number, consultaCarlos: number, receita: number, exame: number, boletoAna: number, boletoCarlos: number;

  beforeAll(async () => {
    // cenário: Helena atendeu Ana e Carlos fez consulta com Rafael
    consultaAna = (await consulta(ID.ana, ID.helena, '2030-05-01 09:00-03', "'NORMAL','EM_ATENDIMENTO'")).rows[0].id;
    consultaCarlos = (await consulta(ID.carlos, ID.rafael, '2030-05-01 10:00-03')).rows[0].id;
    const prAna = (await pg.query<{ id: number }>('select id from public.prontuarios where paciente_id = $1', [ID.ana])).rows[0].id;
    receita = (await pg.query<{ id: number }>(
      "insert into public.documentos_medicos (prontuario_id, consulta_id, medico_id, tipo, conteudo) values ($1,$2,$3,'RECEITA','Propranolol 40 mg 12/12h') returning id",
      [prAna, consultaAna, ID.helena])).rows[0].id;
    exame = (await pg.query<{ id: number }>(
      "insert into public.exames (prontuario_id, consulta_id, tipo) values ($1,$2,'Hemograma') returning id", [prAna, consultaAna])).rows[0].id;
    boletoAna = (await pg.query<{ id: number }>("insert into public.boletos (consulta_id, valor, vencimento) values ($1,180,'2030-05-11') returning id", [consultaAna])).rows[0].id;
    boletoCarlos = (await pg.query<{ id: number }>("insert into public.boletos (consulta_id, valor, vencimento) values ($1,180,'2030-05-11') returning id", [consultaCarlos])).rows[0].id;
    await pg.query("insert into public.notificacoes (usuario_id, titulo, mensagem) values ($1,'Para Ana','x'), ($2,'Para Carlos','y')", [ID.ana, ID.carlos]);
  });

  it('anônimo lê o catálogo, mas nada de consultas, usuários ou prontuários', async () => {
    expect((await como(null, 'select * from public.especialidades')).length).toBe(6);
    for (const t of ['consultas', 'usuarios', 'pacientes', 'prontuarios', 'documentos_medicos', 'exames', 'boletos', 'notificacoes', 'log_alteracoes']) {
      expect((await como(null, `select * from public.${t}`)).length, t).toBe(0);
    }
  });

  it('paciente vê só as próprias consultas, boletos e notificações', async () => {
    const c = await como(ID.ana, 'select paciente_id from public.consultas');
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x.paciente_id === ID.ana)).toBe(true);
    expect((await como(ID.ana, 'select id from public.boletos')).map((b) => b.id)).toEqual([boletoAna]);
    expect((await como(ID.ana, 'select titulo from public.notificacoes')).map((n) => n.titulo)).toEqual(['Para Ana']);
  });

  it('paciente não lê prontuário, receitas, exames nem dados pessoais de outro paciente', async () => {
    expect((await como(ID.carlos, 'select id from public.prontuarios')).map((p) => p.id).length).toBe(1);
    expect(await como(ID.carlos, 'select * from public.documentos_medicos')).toHaveLength(0);
    expect(await como(ID.carlos, 'select * from public.exames')).toHaveLength(0);
    expect(await como(ID.carlos, 'select cpf from public.pacientes where usuario_id = $1', [ID.ana])).toHaveLength(0);
  });

  it('paciente não vira administrador nem reativa a própria conta', async () => {
    expect(await erro(como(ID.ana, "update public.usuarios set tipo = 'ADMIN' where id = $1", [ID.ana]))).toMatch(/Sem permissão/);
    expect(await erro(como(ID.ana, 'update public.usuarios set ativo = true, recuperacao_solicitada = true where id = $1', [ID.ana]))).toMatch(/Sem permissão/);
    expect(await erro(como(ID.ana, "update public.usuarios set nome = 'Ana B. Ribeiro' where id = $1", [ID.ana]))).toBeNull();
  });

  it('paciente não troca o CPF, nem agenda encaixe, nem agenda para outra pessoa', async () => {
    expect(await erro(como(ID.ana, "update public.pacientes set cpf = '39053344705' where usuario_id = $1", [ID.ana]))).toMatch(/recepção/);
    expect(await erro(como(ID.ana, "insert into public.consultas (paciente_id, medico_id, data_hora, tipo) values ($1,$2,'2030-06-01 09:00-03','ENCAIXE')", [ID.ana, ID.helena]))).toMatch(/row-level security/);
    expect(await erro(como(ID.ana, "insert into public.consultas (paciente_id, medico_id, data_hora) values ($1,$2,'2030-06-01 09:00-03')", [ID.carlos, ID.helena]))).toMatch(/row-level security/);
    expect(await erro(como(ID.ana, "insert into public.consultas (paciente_id, medico_id, data_hora) values ($1,$2,'2030-06-01 09:00-03')", [ID.ana, ID.helena]))).toBeNull();
  });

  it('paciente cancela a própria consulta, mas não a dos outros', async () => {
    const minha = (await consulta(ID.ana, ID.rafael, '2030-06-02 09:00-03')).rows[0].id;
    const alheia = (await consulta(ID.carlos, ID.rafael, '2030-06-02 10:00-03')).rows[0].id;
    expect((await como(ID.ana, "update public.consultas set status = 'CANCELADA' where id = $1 returning id", [minha])).length).toBe(1);
    expect((await como(ID.ana, "update public.consultas set status = 'CANCELADA' where id = $1 returning id", [alheia])).length).toBe(0);
    expect((await pg.query<{ status: string }>('select status from public.consultas where id = $1', [alheia])).rows[0].status).toBe('AGENDADA');
  });

  it('recepção gerencia consultas e pacientes, mas não lê dados clínicos', async () => {
    expect((await como(ID.recepcao, 'select id from public.consultas')).length).toBeGreaterThan(3);
    expect((await como(ID.recepcao, 'select usuario_id from public.pacientes')).length).toBe(3);
    for (const t of ['prontuarios', 'documentos_medicos', 'exames']) expect(await como(ID.recepcao, `select * from public.${t}`), t).toHaveLength(0);
    expect((await como(ID.recepcao, "insert into public.consultas (paciente_id, medico_id, data_hora, tipo) values ($1,$2,'2030-07-01 09:00-03','ENCAIXE') returning id", [ID.carlos, ID.helena])).length).toBe(1);
  });

  it('médico lê o prontuário só de quem atende', async () => {
    const vistos = (await como(ID.helena, 'select paciente_id from public.prontuarios')).map((p) => p.paciente_id);
    expect(vistos).toContain(ID.ana);
    // paciente novo, sem nenhuma consulta com a Helena
    const novo = '00000000-0000-4000-8000-000000000099';
    await pg.query('insert into auth.users (id) values ($1)', [novo]);
    await pg.query("insert into public.usuarios (id, nome, email, tipo) values ($1,'Paciente Novo','novo@t.com','PACIENTE')", [novo]);
    await pg.query("insert into public.pacientes (usuario_id, cpf, data_nascimento) values ($1,'39053344705','2000-01-01')", [novo]);
    await pg.query('insert into public.prontuarios (paciente_id) values ($1)', [novo]);
    expect((await como(ID.helena, 'select paciente_id from public.prontuarios')).map((p) => p.paciente_id)).not.toContain(novo);
    expect(await como(ID.helena, 'select * from public.pacientes where usuario_id = $1', [novo])).toHaveLength(0);
    // Rafael também já atendeu a Ana (cenário dos testes de integridade), então a regra "atende ou atendeu" libera o histórico dela
    expect((await como(ID.rafael, 'select id from public.documentos_medicos')).length).toBe(1);
    expect((await como(ID.helena, 'select id from public.documentos_medicos')).length).toBe(1);
  });

  it('médico emite documento só na própria consulta em andamento', async () => {
    const prAna = (await pg.query<{ id: number }>('select id from public.prontuarios where paciente_id = $1', [ID.ana])).rows[0].id;
    const ins = (med: string, cons: number, pr: number) =>
      como(med, "insert into public.documentos_medicos (prontuario_id, consulta_id, medico_id, tipo, conteudo) values ($1,$2,$3,'ATESTADO','Repouso de 2 dias') returning id", [pr, cons, med]);
    expect(await erro(ins(ID.helena, consultaAna, prAna))).toBeNull();
    expect(await erro(ins(ID.rafael, consultaAna, prAna))).toMatch(/row-level security/); // consulta é da Helena
    const prCarlos = (await pg.query<{ id: number }>('select id from public.prontuarios where paciente_id = $1', [ID.carlos])).rows[0].id;
    expect(await erro(ins(ID.helena, consultaAna, prCarlos))).toMatch(/row-level security/); // prontuário de outro paciente
  });

  it('farmácia só acha receita por CPF/número e não lê tabelas clínicas', async () => {
    expect(await como(ID.farmacia, 'select * from public.documentos_medicos')).toHaveLength(0);
    expect(await como(ID.farmacia, 'select * from public.consultas')).toHaveLength(0);
    expect(await como(ID.farmacia, "select * from public.buscar_receitas('')")).toHaveLength(0);
    expect(await como(ID.farmacia, "select * from public.buscar_receitas('abc')")).toHaveLength(0);
    const porCpf = await como(ID.farmacia, 'select * from public.buscar_receitas($1)', ['123.456.789-09']);
    expect(porCpf.map((r) => r.id)).toEqual([receita]);
    expect((await como(ID.farmacia, 'select * from public.buscar_receitas($1)', [String(receita)])).length).toBe(1);
    expect(await como(ID.farmacia, 'select * from public.buscar_receitas($1)', ['529.982.247-25'])).toHaveLength(0); // Carlos não tem receita
  });

  it('retirada da receita só pela farmácia e só uma vez', async () => {
    expect(await erro(como(ID.ana, 'select public.registrar_retirada($1)', [receita]))).toMatch(/Sem permissão/);
    expect(await erro(como(ID.recepcao, 'select public.registrar_retirada($1)', [receita]))).toMatch(/Sem permissão/);
    expect(await erro(como(ID.farmacia, 'select public.registrar_retirada($1)', [receita]))).toBeNull();
    expect(await erro(como(ID.farmacia, 'select public.registrar_retirada($1)', [receita]))).toMatch(/já foi retirada/);
    expect(await erro(como(ID.ana, 'select * from public.buscar_receitas($1)', ['12345678909']))).toMatch(/Sem permissão/);
    expect(await erro(como(null, 'select * from public.buscar_receitas($1)', ['12345678909']))).toMatch(/permission denied/);
    // a retirada ficou no log
    expect((await pg.query("select 1 from public.log_alteracoes where acao = 'REGISTROU_RETIRADA'")).rows.length).toBe(1);
  });

  it('laboratório vê exames e atualiza o status, mas não lê receitas', async () => {
    expect((await como(ID.lab, 'select id from public.exames')).map((e) => e.id)).toContain(exame);
    expect(await como(ID.lab, 'select * from public.documentos_medicos')).toHaveLength(0);
    expect((await como(ID.lab, "update public.exames set status = 'COLETADO' where id = $1 returning id", [exame])).length).toBe(1);
    expect((await como(ID.ana, "update public.exames set status = 'COLETADO' where id = $1 returning id", [exame])).length).toBe(0);
  });

  it('exame concluído exige arquivo e data de resultado', async () => {
    expect(await erro(como(ID.lab, "update public.exames set status = 'CONCLUIDO' where id = $1", [exame]))).toMatch(/check/);
    expect(await erro(como(ID.lab, "update public.exames set status = 'CONCLUIDO', arquivo_resultado = 'r.pdf', data_resultado = current_date where id = $1", [exame]))).toBeNull();
    // o paciente dono e o médico veem; outro paciente, não
    expect((await como(ID.ana, 'select id from public.exames')).length).toBe(1);
    expect((await como(ID.helena, 'select id from public.exames')).length).toBe(1);
    expect(await como(ID.carlos, 'select id from public.exames')).toHaveLength(0);
  });

  it('financeiro vê e baixa boletos; paciente não altera boleto', async () => {
    expect((await como(ID.financeiro, 'select id from public.boletos')).length).toBeGreaterThanOrEqual(2);
    expect((await como(ID.financeiro, "update public.boletos set status = 'PAGO' where id = $1 returning id", [boletoCarlos])).length).toBe(1);
    expect((await como(ID.ana, "update public.boletos set status = 'PAGO' where id = $1 returning id", [boletoAna])).length).toBe(0);
    expect(await como(ID.financeiro, 'select * from public.prontuarios')).toHaveLength(0);
    expect(await como(ID.financeiro, 'select * from public.exames')).toHaveLength(0);
  });

  it('administrador gerencia usuários e lê o log; os demais não leem o log', async () => {
    expect((await como(ID.admin, 'select id from public.usuarios')).length).toBeGreaterThanOrEqual(10);
    expect((await como(ID.admin, 'select id from public.log_alteracoes')).length).toBeGreaterThan(0);
    for (const u of [ID.ana, ID.recepcao, ID.helena, ID.financeiro]) expect(await como(u, 'select id from public.log_alteracoes'), u).toHaveLength(0);
    expect(await erro(como(ID.admin, "update public.usuarios set tipo = 'FINANCEIRO' where id = $1", [ID.recepcao]))).toBeNull();
    await pg.query("update public.usuarios set tipo = 'RECEPCIONISTA' where id = $1", [ID.recepcao]);
  });

  it('só o administrador cadastra especialidades, convênios e verifica CRM', async () => {
    expect(await erro(como(ID.recepcao, "insert into public.especialidades (nome) values ('Neurologia')"))).toMatch(/row-level security/);
    expect(await erro(como(ID.admin, "insert into public.especialidades (nome) values ('Neurologia')"))).toBeNull();
    expect((await como(ID.recepcao, "update public.medicos set crm_verificado = true where usuario_id = $1 returning usuario_id", [ID.helena])).length).toBe(0);
    expect((await como(ID.admin, "update public.medicos set crm_verificado = true where usuario_id = $1 returning usuario_id", [ID.helena])).length).toBe(1);
  });

  it('ninguém registra no log em nome de outro usuário', async () => {
    expect(await erro(como(ID.ana, "insert into public.log_alteracoes (usuario_id, entidade, acao) values ($1,'x','y')", [ID.admin]))).toMatch(/row-level security/);
    expect(await erro(como(ID.ana, "insert into public.log_alteracoes (usuario_id, entidade, acao) values ($1,'x','y')", [ID.ana]))).toBeNull();
  });

  it('usuário desativado perde todo o acesso', async () => {
    await pg.query('update public.usuarios set ativo = false where id = $1', [ID.carlos]);
    expect(await como(ID.carlos, 'select * from public.consultas')).toHaveLength(0);
    expect(await como(ID.carlos, 'select * from public.notificacoes')).toHaveLength(0);
    await pg.query('update public.usuarios set ativo = true where id = $1', [ID.carlos]);
  });
});
