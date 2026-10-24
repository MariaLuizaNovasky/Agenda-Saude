// Fluxo completo do diagrama de atividades (roteiro de demonstração do README)
import { describe, expect, it } from 'vitest';
import { api, EMAILS, entrar, get, hojeISO, post, primeiroHorarioLivre, put } from './helpers.js';

const estado: Record<string, any> = {};

describe('check-in, fila e atendimento', () => {
  it('paciente faz check-in no dia e fica CONFIRMADA ("Aguarde")', async () => {
    const hoje = await get(EMAILS.ana, `/api/consultas?data=${hojeISO()}&status=AGENDADA`);
    expect(hoje.body.length).toBeGreaterThan(0);
    estado.consulta = hoje.body[0].id;
    const r = await post(EMAILS.ana, `/api/consultas/${estado.consulta}/checkin`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('CONFIRMADA');
    const fila = await get(EMAILS.ana, '/api/fila/minha');
    expect(fila.body[0]).toMatchObject({ consulta_id: estado.consulta, status: 'CONFIRMADA', posicao: null });
  });

  it('não permite check-in duas vezes nem de consulta de outro dia', async () => {
    expect((await post(EMAILS.ana, `/api/consultas/${estado.consulta}/checkin`)).status).toBe(400);
    const helena = (await entrar(EMAILS.helena)).id;
    const futuro = await primeiroHorarioLivre(EMAILS.ana, helena, 2);
    const c = await post(EMAILS.ana, '/api/consultas', { medico_id: helena, data_hora: futuro });
    expect((await post(EMAILS.ana, `/api/consultas/${c.body.id}/checkin`)).status).toBe(400);
  });

  it('recepção confirma presença e a paciente recebe posição na fila', async () => {
    const r = await post(EMAILS.recepcao, `/api/consultas/${estado.consulta}/confirmar-presenca`);
    expect(r.body.status).toBe('EM_ESPERA');
    const fila = await get(EMAILS.ana, '/api/fila/minha');
    const minha = fila.body.find((f: { consulta_id: number }) => f.consulta_id === estado.consulta);
    expect(minha.posicao).toBeGreaterThan(0);
    expect(minha.pessoas_na_frente).toBe(minha.posicao - 1);
  });

  it('médico informa atraso e os pacientes são avisados', async () => {
    const helena = (await entrar(EMAILS.helena)).id;
    const r = await post(EMAILS.helena, `/api/medicos/${helena}/atraso`, { minutos: 25 });
    expect(r.status).toBe(200);
    expect(r.body.afetadas).toBeGreaterThan(0);
    const notas = await get(EMAILS.ana, '/api/notificacoes');
    expect(notas.body.some((n: { mensagem: string }) => /25 min/.test(n.mensagem))).toBe(true);
    const fila = await get(EMAILS.ana, '/api/fila/minha');
    expect(fila.body[0].atraso_min).toBe(25);
  });

  it('médico só chama o próximo depois de finalizar o atendimento em curso', async () => {
    const emCurso = await get(EMAILS.helena, '/api/consultas?status=EM_ATENDIMENTO');
    expect(emCurso.body).toHaveLength(1);
    const bloqueado = await post(EMAILS.helena, `/api/consultas/${estado.consulta}/iniciar`);
    expect(bloqueado.status).toBe(409);

    const fim = await post(EMAILS.helena, `/api/consultas/${emCurso.body[0].id}/finalizar`, { anotacoes: 'Ok.' });
    expect(fim.body.status).toBe('FINALIZADA');
    const boleto = await get(EMAILS.financeiro, '/api/boletos?status=PENDENTE');
    expect(boleto.body.some((b: { consulta_id: number }) => b.consulta_id === emCurso.body[0].id)).toBe(true);

    const inicio = await post(EMAILS.helena, `/api/consultas/${estado.consulta}/iniciar`);
    expect(inicio.body.status).toBe('EM_ATENDIMENTO');
    const aviso = await get(EMAILS.ana, '/api/notificacoes');
    expect(aviso.body.some((n: { titulo: string }) => n.titulo === 'Sua vez')).toBe(true);
  });

  it('médico não inicia atendimento de quem não está na fila', async () => {
    const outra = await get(EMAILS.helena, `/api/consultas?data=${hojeISO()}&status=AGENDADA`);
    expect(outra.body.length).toBeGreaterThan(0);
    expect((await post(EMAILS.helena, `/api/consultas/${outra.body[0].id}/iniciar`)).status).toBe(400);
  });

  it('só o médico da consulta inicia/finaliza', async () => {
    expect((await post(EMAILS.rafael, `/api/consultas/${estado.consulta}/finalizar`)).status).toBe(403);
    expect((await post(EMAILS.recepcao, `/api/consultas/${estado.consulta}/iniciar`)).status).toBe(403);
  });
});

describe('prontuário, receita e exame', () => {
  it('médico registra anotações, emite receita e pede exame com prazo de retorno', async () => {
    const ant = await put(EMAILS.helena, `/api/consultas/${estado.consulta}/anotacoes`, { anotacoes: 'Palpitações persistem.' });
    expect(ant.status).toBe(200);

    const rec = await post(EMAILS.helena, '/api/documentos', { consulta_id: estado.consulta, tipo: 'RECEITA', conteudo: 'Dipirona 500 mg se dor.' });
    expect(rec.status).toBe(201);
    estado.receita = rec.body.id;

    const ex = await post(EMAILS.helena, '/api/exames', { consulta_id: estado.consulta, tipo: 'Holter 24h', prazo_retorno_dias: 20 });
    expect(ex.status).toBe(201);
    expect(ex.body.status).toBe('SOLICITADO');
    estado.exame = ex.body.id;

    const fim = await post(EMAILS.helena, `/api/consultas/${estado.consulta}/finalizar`, {});
    expect(fim.body.status).toBe('FINALIZADA');
  });

  it('outro médico não emite documento nem exame na consulta alheia', async () => {
    expect((await post(EMAILS.rafael, '/api/documentos', { consulta_id: estado.consulta, tipo: 'ATESTADO', conteudo: 'Atestado de teste.' })).status).toBe(403);
    expect((await post(EMAILS.rafael, '/api/exames', { consulta_id: estado.consulta, tipo: 'X-Ray' })).status).toBe(403);
  });

  it('laboratório registra coleta e anexa resultado; só PDF/PNG/JPG', async () => {
    const lab = (await entrar(EMAILS.laboratorio)).token;
    const coleta = await put(EMAILS.laboratorio, `/api/exames/${estado.exame}/status`, { status: 'COLETADO' });
    expect(coleta.status).toBe(200);

    const ruim = await api.post(`/api/exames/${estado.exame}/resultado`).set('Authorization', `Bearer ${lab}`)
      .attach('arquivo', Buffer.from('MZ'), 'virus.exe');
    expect(ruim.status).toBe(400);

    const ok = await api.post(`/api/exames/${estado.exame}/resultado`).set('Authorization', `Bearer ${lab}`)
      .attach('arquivo', Buffer.from('%PDF-1.4 teste'), 'resultado.pdf');
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CONCLUIDO');

    const aviso = await get(EMAILS.ana, '/api/notificacoes');
    expect(aviso.body.some((n: { mensagem: string }) => /Holter 24h.*até/.test(n.mensagem))).toBe(true);
  });

  it('só o dono (e o médico) baixam o resultado; outro paciente recebe 403', async () => {
    expect((await get(EMAILS.ana, `/api/exames/${estado.exame}/arquivo`)).status).toBe(200);
    expect((await get(EMAILS.helena, `/api/exames/${estado.exame}/arquivo`)).status).toBe(200);
    expect((await get(EMAILS.carlos, `/api/exames/${estado.exame}/arquivo`)).status).toBe(403);
    expect((await get(EMAILS.farmacia, `/api/exames/${estado.exame}/arquivo`)).status).toBe(403);
  });

  it('exame concluído aparece como retorno pendente até o retorno ser marcado', async () => {
    const antes = await get(EMAILS.ana, '/api/retornos');
    expect(antes.body.some((r: { id: number }) => r.id === estado.exame)).toBe(true);

    const helena = (await entrar(EMAILS.helena)).id;
    const h = await primeiroHorarioLivre(EMAILS.ana, helena, 5);
    expect((await post(EMAILS.ana, '/api/consultas', { medico_id: helena, data_hora: h, tipo: 'RETORNO' })).status).toBe(201);
    const depois = await get(EMAILS.ana, '/api/retornos');
    expect(depois.body.some((r: { id: number }) => r.id === estado.exame)).toBe(false);
  });

  it('farmácia retira a receita uma única vez', async () => {
    const busca = await get(EMAILS.farmacia, '/api/documentos?busca=12345678909');
    expect(busca.body.some((d: { id: number }) => d.id === estado.receita)).toBe(true);
    expect((await post(EMAILS.farmacia, `/api/documentos/${estado.receita}/retirada`)).status).toBe(200);
    const dup = await post(EMAILS.farmacia, `/api/documentos/${estado.receita}/retirada`);
    expect(dup.status).toBe(409);
    const disponiveis = await get(EMAILS.farmacia, '/api/documentos');
    expect(disponiveis.body.some((d: { id: number }) => d.id === estado.receita)).toBe(false);
    const historico = await get(EMAILS.farmacia, `/api/documentos?busca=${estado.receita}`);
    expect(historico.body.some((d: { id: number; data_retirada: string | null }) => d.id === estado.receita && d.data_retirada)).toBe(true);
  });

  it('farmácia não retira atestado', async () => {
    const at = await post(EMAILS.helena, '/api/documentos', { consulta_id: estado.consulta, tipo: 'ATESTADO', conteudo: 'Repouso por 2 dias.' });
    expect(at.status).toBe(201);
    expect((await post(EMAILS.farmacia, `/api/documentos/${at.body.id}/retirada`)).status).toBe(404);
    expect((await get(EMAILS.farmacia, `/api/documentos/${at.body.id}`)).status).toBe(403);
  });
});

describe('financeiro', () => {
  it('dá baixa no boleto gerado ao finalizar a consulta e avisa o paciente', async () => {
    const lista = await get(EMAILS.financeiro, '/api/boletos?status=PENDENTE');
    const b = lista.body.find((x: { consulta_id: number }) => x.consulta_id === estado.consulta);
    expect(b).toBeTruthy();
    expect(b.valor).toBe(180);
    expect((await post(EMAILS.financeiro, `/api/boletos/${b.id}/baixa`)).status).toBe(200);
    expect((await post(EMAILS.financeiro, `/api/boletos/${b.id}/baixa`)).status).toBe(400);
    expect((await post(EMAILS.financeiro, `/api/boletos/${b.id}/cancelar`)).status).toBe(400);
    const notas = await get(EMAILS.ana, '/api/notificacoes');
    expect(notas.body.some((n: { titulo: string }) => n.titulo === 'Pagamento confirmado')).toBe(true);
  });

  it('retorno não gera cobrança (valor 0)', async () => {
    const r = await get(EMAILS.admin, '/api/boletos');
    expect(r.body.filter((b: { consulta_tipo: string }) => b.consulta_tipo === 'RETORNO').every((b: { valor: number }) => b.valor === 0)).toBe(true);
  });

  it('dashboard soma consultas do dia e exames em andamento', async () => {
    const d = await get(EMAILS.admin, '/api/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.dia.total).toBeGreaterThan(0);
    expect(d.body.semana).toHaveLength(7);
  });
});

describe('lista de espera', () => {
  it('cancelamento libera a vaga e avisa o primeiro da lista (maior prioridade)', async () => {
    const bruno = (await entrar(EMAILS.bruno)).id; // Ortopedia; Roberto espera por Ortopedia com prioridade alta
    const h = await primeiroHorarioLivre(EMAILS.ana, bruno);
    const c = await post(EMAILS.ana, '/api/consultas', { medico_id: bruno, data_hora: h });
    expect(c.status).toBe(201);
    expect((await post(EMAILS.ana, `/api/consultas/${c.body.id}/cancelar`, { motivo: 'Mudança de planos' })).status).toBe(200);
    const notas = await get(EMAILS.roberto, '/api/notificacoes');
    expect(notas.body.some((n: { titulo: string }) => n.titulo === 'Vaga disponível')).toBe(true);
  });

  it('não permite pedido duplicado na mesma especialidade', async () => {
    const esp = (await get(EMAILS.ana, '/api/especialidades')).body.find((e: { nome: string }) => e.nome === 'Dermatologia').id;
    expect((await post(EMAILS.ana, '/api/lista-espera', { especialidade_id: esp })).status).toBe(201);
    expect((await post(EMAILS.ana, '/api/lista-espera', { especialidade_id: esp })).status).toBe(409);
  });

  it('paciente não prioriza o próprio pedido; recepção sim', async () => {
    const lista = await get(EMAILS.recepcao, '/api/lista-espera');
    const id = lista.body[0].id;
    expect((await put(EMAILS.ana, `/api/lista-espera/${id}`, { prioridade: 2 })).status).toBe(403);
    expect((await put(EMAILS.recepcao, `/api/lista-espera/${id}`, { prioridade: 2 })).status).toBe(200);
  });
});

describe('rastreabilidade', () => {
  it('registra no log quem fez o quê', async () => {
    const log = await get(EMAILS.admin, '/api/relatorios/log');
    const acoes = new Set(log.body.map((l: { acao: string }) => l.acao));
    for (const a of ['LOGIN', 'AGENDOU', 'CANCELOU', 'CHECK_IN', 'CONFIRMOU_PRESENCA', 'INICIOU_ATENDIMENTO', 'FINALIZOU_ATENDIMENTO', 'EMITIU', 'ANEXOU_RESULTADO', 'DEU_BAIXA']) {
      expect(acoes, a).toContain(a);
    }
    expect(log.body.every((l: { usuario_nome: string | null }) => l.usuario_nome)).toBe(true);
  });
});
