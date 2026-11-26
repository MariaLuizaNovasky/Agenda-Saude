// Meta do TAP: nenhum acesso indevido entre perfis
import { describe, expect, it } from 'vitest';
import { api, EMAILS, entrar, get, post, put } from './helpers.js';

describe('autenticação obrigatória', () => {
  it('rotas protegidas sem token respondem 401', async () => {
    for (const url of ['/api/consultas', '/api/pacientes', '/api/boletos', '/api/usuarios', '/api/dashboard']) {
      expect((await api.get(url)).status).toBe(401);
    }
  });
  it('token inválido responde 401', async () => {
    expect((await api.get('/api/consultas').set('Authorization', 'Bearer lixo')).status).toBe(401);
  });
  it('catálogo de especialidades e convênios é público', async () => {
    expect((await api.get('/api/especialidades')).status).toBe(200);
    expect((await api.get('/api/convenios')).status).toBe(200);
  });
});

describe('paciente', () => {
  it('só enxerga as próprias consultas', async () => {
    const ana = (await entrar(EMAILS.ana)).id;
    const r = await get(EMAILS.ana, '/api/consultas');
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((c: { paciente_id: number }) => c.paciente_id === ana)).toBe(true);
  });

  it('não abre consulta, histórico, dados nem boletos de outro paciente', async () => {
    const carlos = (await entrar(EMAILS.carlos)).id;
    const deCarlos = await get(EMAILS.carlos, '/api/consultas');
    const id = deCarlos.body[0].id;
    expect((await get(EMAILS.ana, `/api/consultas/${id}`)).status).toBe(403);
    expect((await get(EMAILS.ana, `/api/pacientes/${carlos}/historico`)).status).toBe(403);
    expect((await get(EMAILS.ana, `/api/pacientes/${carlos}`)).status).toBe(403);
    const boletos = await get(EMAILS.ana, '/api/boletos');
    const ana = (await entrar(EMAILS.ana)).id;
    expect(boletos.body.every((b: { paciente_id: number }) => b.paciente_id === ana)).toBe(true);
  });

  it('não acessa telas administrativas, da recepção nem financeiras', async () => {
    for (const url of ['/api/usuarios', '/api/dashboard', '/api/fila', '/api/pacientes', '/api/relatorios/log']) {
      expect((await get(EMAILS.ana, url)).status).toBe(403);
    }
  });

  it('não lê as anotações clínicas internas do médico no próprio histórico', async () => {
    const ana = (await entrar(EMAILS.ana)).id;
    const h = await get(EMAILS.ana, `/api/pacientes/${ana}/historico`);
    expect(h.status).toBe(200);
    expect(h.body.consultas.some((c: object) => 'anotacoes' in c)).toBe(false);
  });

  it('não consegue alterar o próprio perfil de acesso', async () => {
    const ana = (await entrar(EMAILS.ana)).id;
    const r = await api.put(`/api/usuarios/${ana}`).set('Authorization', `Bearer ${(await entrar(EMAILS.ana)).token}`).send({ nome: 'Ana', tipo: 'ADMIN', ativo: true });
    expect(r.status).toBe(403);
  });

  it('não altera CPF, convênio ou carteirinha em Meus dados', async () => {
    const antes = await get(EMAILS.ana, '/api/auth/me');
    const r = await put(EMAILS.ana, '/api/auth/perfil', {
      nome: antes.body.nome,
      telefone: antes.body.telefone,
      cpf: '390.533.447-05',
      convenio_id: 1,
      numero_carteirinha: 'ALTERADA',
    });

    expect(r.status).toBe(400);
    const depois = await get(EMAILS.ana, '/api/auth/me');
    expect(depois.body.cpf).toBe(antes.body.cpf);
    expect(depois.body.convenio_id).toBe(antes.body.convenio_id);
    expect(depois.body.numero_carteirinha).toBe(antes.body.numero_carteirinha);
  });

  it('permite alterar a data de nascimento em Meus dados', async () => {
    const antes = await get(EMAILS.ana, '/api/auth/me');
    const novaData = antes.body.data_nascimento === '1990-01-01' ? '1990-01-02' : '1990-01-01';
    const r = await put(EMAILS.ana, '/api/auth/perfil', {
      nome: antes.body.nome,
      telefone: antes.body.telefone,
      data_nascimento: novaData,
    });

    expect(r.status).toBe(200);
    expect(r.body.data_nascimento).toBe(novaData);
  });

  it('fila do paciente não vaza dados de outros pacientes', async () => {
    const r = await get(EMAILS.ana, '/api/fila/minha');
    expect(r.status).toBe(200);
    const texto = JSON.stringify(r.body);
    expect(texto).not.toMatch(/Mariana|Roberto|Carlos|cpf/i);
  });
});

describe('recepção', () => {
  it('não vê dados clínicos (prontuário, receitas, exames, anotações)', async () => {
    const ana = (await entrar(EMAILS.ana)).id;
    expect((await get(EMAILS.recepcao, `/api/pacientes/${ana}/historico`)).status).toBe(403);
    expect((await get(EMAILS.recepcao, '/api/documentos')).status).toBe(403);
    expect((await get(EMAILS.recepcao, '/api/exames')).status).toBe(403);
  });
});

describe('médico', () => {
  it('só abre o prontuário de quem atende', async () => {
    // paciente recém-cadastrado, sem nenhuma consulta com a Dra. Helena
    const novo = await api.post('/api/auth/cadastro').send({
      nome: 'Paciente Sem Consulta', email: 'sem.consulta@email.com', senha: 'Senha123', telefone: '(11) 95555-0000',
      cpf: '529.982.247-25', data_nascimento: '1992-02-02',
    });
    expect(novo.status).toBe(201);
    expect((await get(EMAILS.helena, `/api/pacientes/${novo.body.id}/historico`)).status).toBe(403);

    const ana = (await entrar(EMAILS.ana)).id; // Ana tem consulta com a Helena
    const historico = await get(EMAILS.helena, `/api/pacientes/${ana}/historico`);
    expect(historico.status).toBe(200);
    expect(historico.body.paciente).toMatchObject({ id: ana });
    expect(historico.body.paciente.nome).toBeTruthy();
    expect(historico.body.prontuario).toBeTruthy();
  });

  it('só enxerga as próprias consultas e a própria fila', async () => {
    const helena = (await entrar(EMAILS.helena)).id;
    const r = await get(EMAILS.helena, '/api/consultas');
    expect(r.body.every((c: { medico_id: number }) => c.medico_id === helena)).toBe(true);
    const fila = await get(EMAILS.helena, '/api/fila');
    expect(fila.body.grupos.every((g: { medico_id: number }) => g.medico_id === helena)).toBe(true);
  });

  it('não gerencia a agenda de outro médico', async () => {
    const rafael = (await entrar(EMAILS.rafael)).id;
    const r = await post(EMAILS.helena, `/api/medicos/${rafael}/atraso`, { minutos: 30 });
    expect(r.status).toBe(403);
  });
});

describe('farmácia e laboratório', () => {
  it('farmácia não vê consultas, pacientes nem exames', async () => {
    const ana = (await entrar(EMAILS.ana)).id;
    expect((await get(EMAILS.farmacia, '/api/consultas')).status).toBe(403);
    expect((await get(EMAILS.farmacia, `/api/pacientes/${ana}`)).status).toBe(403);
    expect((await get(EMAILS.farmacia, `/api/pacientes/${ana}/historico`)).status).toBe(403);
    expect((await get(EMAILS.farmacia, '/api/exames')).status).toBe(403);
  });

  it('farmácia vê receitas disponíveis por padrão e busca pelo CPF ou número', async () => {
    const disponiveis = await get(EMAILS.farmacia, '/api/documentos');
    expect(disponiveis.status).toBe(200);
    expect(disponiveis.body.length).toBeGreaterThan(0);
    expect(disponiveis.body.every((d: { tipo: string; data_retirada: string | null }) => d.tipo === 'RECEITA' && d.data_retirada === null)).toBe(true);
    expect((await get(EMAILS.farmacia, '/api/documentos?busca=abc')).body).toEqual([]);
    const r = await get(EMAILS.farmacia, '/api/documentos?busca=123.456.789-09');
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((d: { tipo: string }) => d.tipo === 'RECEITA')).toBe(true);
  });

  it('laboratório não lê receitas nem consultas', async () => {
    expect((await get(EMAILS.laboratorio, '/api/documentos')).status).toBe(403);
    expect((await get(EMAILS.laboratorio, '/api/consultas')).status).toBe(403);
  });
});

describe('financeiro', () => {
  it('vê boletos e dashboard, mas não dados clínicos', async () => {
    expect((await get(EMAILS.financeiro, '/api/boletos')).status).toBe(200);
    expect((await get(EMAILS.financeiro, '/api/dashboard')).status).toBe(200);
    const ana = (await entrar(EMAILS.ana)).id;
    expect((await get(EMAILS.financeiro, `/api/pacientes/${ana}/historico`)).status).toBe(403);
    expect((await get(EMAILS.financeiro, '/api/exames')).status).toBe(403);
    expect((await post(EMAILS.financeiro, '/api/exames', { consulta_id: 1, tipo: 'X' })).status).toBe(403);
  });
});

describe('administrador', () => {
  it('acessa usuários, log e relatórios', async () => {
    expect((await get(EMAILS.admin, '/api/usuarios')).status).toBe(200);
    expect((await get(EMAILS.admin, '/api/relatorios/log')).status).toBe(200);
  });
  it('não vê prontuário clínico (o perfil herda só a recepção)', async () => {
    const ana = (await entrar(EMAILS.ana)).id;
    expect((await get(EMAILS.admin, `/api/pacientes/${ana}/historico`)).status).toBe(403);
  });
  it('não pode desativar o próprio acesso', async () => {
    const adm = await entrar(EMAILS.admin);
    const r = await api.put(`/api/usuarios/${adm.id}`).set('Authorization', `Bearer ${adm.token}`).send({ nome: 'Marcos Albuquerque', tipo: 'ADMIN', ativo: false });
    expect(r.status).toBe(400);
  });
});

describe('usuário desativado', () => {
  it('perde o acesso na hora, mesmo com token válido', async () => {
    const carlos = await entrar(EMAILS.carlos);
    const adm = await entrar(EMAILS.admin);
    const des = await api.put(`/api/usuarios/${carlos.id}`).set('Authorization', `Bearer ${adm.token}`)
      .send({ nome: 'Carlos Eduardo Lima', tipo: 'PACIENTE', ativo: false });
    expect(des.status).toBe(200);
    expect((await get(EMAILS.carlos, '/api/consultas')).status).toBe(401);
    expect((await api.post('/api/auth/login').send({ email: EMAILS.carlos, senha: 'Senha123' })).status).toBe(403);
  });
});
