// Senhas, CRM, cadastro e persistência
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { api, EMAILS, entrar, get, post, put } from './helpers.js';

describe('cadastro do paciente', () => {
  const base = {
    nome: 'Beatriz Teste', email: 'beatriz@email.com', senha: 'Senha123', telefone: '(11) 94444-0000',
    cpf: '529.982.247-25', data_nascimento: '1999-09-09',
  };
  it('cria paciente com CPF válido e já permite login', async () => {
    expect((await api.post('/api/auth/cadastro').send(base)).status).toBe(201);
    expect((await api.post('/api/auth/login').send({ email: base.email, senha: base.senha })).status).toBe(200);
  });
  it('recusa CPF inválido, CPF repetido, e-mail repetido e senha fraca', async () => {
    expect((await api.post('/api/auth/cadastro').send({ ...base, email: 'x@email.com', cpf: '111.111.111-11' })).status).toBe(400);
    const dupCpf = await api.post('/api/auth/cadastro').send({ ...base, email: 'outro@email.com' });
    expect(dupCpf.status).toBe(409);
    const dupEmail = await api.post('/api/auth/cadastro').send({ ...base, cpf: '123.456.789-09' });
    expect(dupEmail.status).toBe(409);
    expect((await api.post('/api/auth/cadastro').send({ ...base, email: 'f@email.com', cpf: '168.995.350-09', senha: '12345678' })).status).toBe(400);
    expect((await api.post('/api/auth/cadastro').send({ ...base, email: 'f@email.com', cpf: '168.995.350-09', senha: 'abc' })).status).toBe(400);
  });
  it('convênio exige o número da carteirinha', async () => {
    const convs = await api.get('/api/convenios');
    const r = await api.post('/api/auth/cadastro').send({ ...base, email: 'g@email.com', cpf: '168.995.350-09', convenio_id: convs.body[0].id });
    expect(r.status).toBe(400);
  });
});

describe('login', () => {
  it('senha errada e e-mail inexistente dão a mesma mensagem', async () => {
    const a = await api.post('/api/auth/login').send({ email: EMAILS.ana, senha: 'errada123' });
    const b = await api.post('/api/auth/login').send({ email: 'ninguem@email.com', senha: 'Senha123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.erro).toBe(b.body.erro);
  });
  it('e-mail não diferencia maiúsculas de minúsculas', async () => {
    expect((await api.post('/api/auth/login').send({ email: 'PACIENTE@agendasaude.com', senha: 'Senha123' })).status).toBe(200);
  });
  it('a resposta do login não expõe o hash da senha', async () => {
    const r = await api.post('/api/auth/login').send({ email: EMAILS.ana, senha: 'Senha123' });
    expect(JSON.stringify(r.body)).not.toMatch(/senha_hash|\$2[aby]\$/);
  });
});

describe('recuperação de senha via administrador', () => {
  it('pedido chega ao admin, que gera senha temporária; troca é obrigatória', async () => {
    const pedido = await api.post('/api/auth/recuperar-senha').send({ email: EMAILS.carlos });
    expect(pedido.status).toBe(200);

    const adm = await get(EMAILS.admin, '/api/usuarios?recuperacao=1');
    const carlos = adm.body.find((u: { email: string }) => u.email === EMAILS.carlos);
    expect(carlos).toBeTruthy();
    const notas = await get(EMAILS.admin, '/api/notificacoes');
    expect(notas.body.some((n: { titulo: string }) => n.titulo === 'Pedido de nova senha')).toBe(true);

    const temp = await post(EMAILS.admin, `/api/usuarios/${carlos.id}/senha-temporaria`, { senha: 'Temporaria1' });
    expect(temp.status).toBe(200);

    expect((await api.post('/api/auth/login').send({ email: EMAILS.carlos, senha: 'Senha123' })).status).toBe(401);
    const login = await api.post('/api/auth/login').send({ email: EMAILS.carlos, senha: 'Temporaria1' });
    expect(login.status).toBe(200);
    expect(login.body.usuario.troca_senha_obrigatoria).toBe(true);

    const troca = await api.post('/api/auth/alterar-senha').set('Authorization', `Bearer ${login.body.token}`)
      .send({ senha_atual: 'Temporaria1', nova_senha: 'NovaSenha2' });
    expect(troca.status).toBe(200);
    expect(troca.body.usuario.troca_senha_obrigatoria).toBe(false);
    expect((await api.post('/api/auth/login').send({ email: EMAILS.carlos, senha: 'NovaSenha2' })).status).toBe(200);
  });

  it('a resposta é igual para e-mail cadastrado e não cadastrado', async () => {
    const a = await api.post('/api/auth/recuperar-senha').send({ email: EMAILS.ana });
    const b = await api.post('/api/auth/recuperar-senha').send({ email: 'nao.existe@email.com' });
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
  });

  it('só o administrador gera senha temporária', async () => {
    const ana = (await entrar(EMAILS.ana)).id;
    expect((await post(EMAILS.recepcao, `/api/usuarios/${ana}/senha-temporaria`, { senha: 'Temporaria1' })).status).toBe(403);
  });

  it('alterar senha exige a senha atual e uma nova diferente', async () => {
    expect((await post(EMAILS.ana, '/api/auth/alterar-senha', { senha_atual: 'errada', nova_senha: 'NovaSenha2' })).status).toBe(400);
    expect((await post(EMAILS.ana, '/api/auth/alterar-senha', { senha_atual: 'Senha123', nova_senha: 'Senha123' })).status).toBe(400);
  });
});

describe('CRM com UF e verificação', () => {
  const medico = {
    nome: 'Dr. Novo Médico', email: 'novo.medico@agendasaude.com', tipo: 'MEDICO', senha_temporaria: 'Temporaria1',
    crm: '555666', crm_uf: 'PR', especialidade_ids: [1],
  };
  it('recusa CRM com formato inválido e UF inexistente', async () => {
    expect((await post(EMAILS.admin, '/api/usuarios', { ...medico, crm: '12' })).status).toBe(400);
    expect((await post(EMAILS.admin, '/api/usuarios', { ...medico, crm: '12345678' })).status).toBe(400);
    expect((await post(EMAILS.admin, '/api/usuarios', { ...medico, crm: 'abcd' })).status).toBe(400);
    expect((await post(EMAILS.admin, '/api/usuarios', { ...medico, crm_uf: 'XX' })).status).toBe(400);
    expect((await post(EMAILS.admin, '/api/usuarios', { ...medico, especialidade_ids: [] })).status).toBe(400);
  });
  it('cadastra o médico como não verificado; o admin confirma manualmente', async () => {
    const r = await post(EMAILS.admin, '/api/usuarios', medico);
    expect(r.status).toBe(201);
    const lista = await get(EMAILS.admin, '/api/usuarios?tipo=MEDICO');
    const novo = lista.body.find((u: { id: number }) => u.id === r.body.id);
    expect(novo).toMatchObject({ crm: '555666', crm_uf: 'PR', crm_verificado: 0 });
    expect((await post(EMAILS.admin, `/api/medicos/${r.body.id}/verificar-crm`, { verificado: true })).status).toBe(200);
    const depois = (await get(EMAILS.admin, '/api/usuarios?tipo=MEDICO')).body.find((u: { id: number }) => u.id === r.body.id);
    expect(depois.crm_verificado).toBe(1);
  });
  it('o mesmo CRM na mesma UF não repete, mas em outra UF pode', async () => {
    expect((await post(EMAILS.admin, '/api/usuarios', { ...medico, email: 'dup@agendasaude.com' })).status).toBe(409);
    expect((await post(EMAILS.admin, '/api/usuarios', { ...medico, email: 'outra.uf@agendasaude.com', crm_uf: 'SC' })).status).toBe(201);
  });
  it('só o administrador verifica CRM ou cria usuários', async () => {
    const helena = (await entrar(EMAILS.helena)).id;
    expect((await post(EMAILS.recepcao, `/api/medicos/${helena}/verificar-crm`, { verificado: false })).status).toBe(403);
    expect((await post(EMAILS.recepcao, '/api/usuarios', medico)).status).toBe(403);
  });
});

describe('disponibilidade do médico', () => {
  it('recusa períodos sobrepostos e fim antes do início', async () => {
    const camila = (await entrar('camila@agendasaude.com')).id;
    const h = { dia_semana: 1, hora_inicio: '09:00', hora_fim: '10:00', duracao_min: 30 };
    expect((await post('camila@agendasaude.com', `/api/medicos/${camila}/disponibilidades`, h)).status).toBe(409); // sobrepõe 07–12
    expect((await post('camila@agendasaude.com', `/api/medicos/${camila}/disponibilidades`, { ...h, dia_semana: 0, hora_fim: '08:00' })).status).toBe(400);
    expect((await post('camila@agendasaude.com', `/api/medicos/${camila}/disponibilidades`, { ...h, dia_semana: 0, duracao_min: 5 })).status).toBe(400);
  });
});

describe('persistência', () => {
  it('dados continuam no arquivo do banco depois de uma nova conexão (nova sessão)', async () => {
    const r = await post(EMAILS.recepcao, '/api/pacientes', {
      nome: 'Paciente Persistente', email: 'persistente@email.com', telefone: '(11) 93333-0000',
      cpf: '168.995.350-09', data_nascimento: '1980-08-08', senha_temporaria: 'Temporaria1',
    });
    expect(r.status).toBe(201);
    const outraConexao = new DatabaseSync(process.env.DB_PATH!);
    const linha = outraConexao.prepare('SELECT nome FROM usuarios WHERE email = ?').get('persistente@email.com') as { nome: string };
    outraConexao.close();
    expect(linha.nome).toBe('Paciente Persistente');
  });
});
