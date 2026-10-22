// Meta do TAP: 0 agendamentos duplicados
import { describe, expect, it } from 'vitest';
import { all } from '../src/db.js';
import { EMAILS, entrar, get, post, primeiroHorarioLivre, put } from './helpers.js';

describe('agendamentos duplicados', () => {
  it('bloqueia o mesmo horário do mesmo médico para outro paciente (409)', async () => {
    const helena = (await entrar(EMAILS.helena)).id;
    const horario = await primeiroHorarioLivre(EMAILS.ana, helena);

    const a = await post(EMAILS.ana, '/api/consultas', { medico_id: helena, data_hora: horario });
    expect(a.status).toBe(201);

    const b = await post(EMAILS.carlos, '/api/consultas', { medico_id: helena, data_hora: horario });
    expect(b.status).toBe(409);
    expect(b.body.erro).toMatch(/ocupado/i);
  });

  it('bloqueia a mesma pessoa duas vezes no mesmo horário, mesmo com médicos diferentes', async () => {
    const helena = (await entrar(EMAILS.helena)).id;
    const rafael = (await entrar(EMAILS.rafael)).id;
    const horario = await primeiroHorarioLivre(EMAILS.carlos, helena, 3);

    expect((await post(EMAILS.carlos, '/api/consultas', { medico_id: helena, data_hora: horario })).status).toBe(201);
    const dup = await post(EMAILS.carlos, '/api/consultas', { medico_id: rafael, data_hora: horario });
    expect(dup.status).toBe(409);
  });

  it('o banco também impede duplicidade, mesmo sem passar pela validação da API', async () => {
    const { db } = await import('../src/db.js');
    const helena = (await entrar(EMAILS.helena)).id;
    const ana = (await entrar(EMAILS.ana)).id;
    const carlos = (await entrar(EMAILS.carlos)).id;
    const horario = await primeiroHorarioLivre(EMAILS.ana, helena, 8);
    const ins = db.prepare('INSERT INTO consultas (paciente_id, medico_id, data_hora) VALUES (?,?,?)');
    ins.run(ana, helena, horario);
    expect(() => ins.run(carlos, helena, horario)).toThrow(/UNIQUE/);
  });

  it('cancelar libera o horário para outra pessoa', async () => {
    const helena = (await entrar(EMAILS.helena)).id;
    const horario = await primeiroHorarioLivre(EMAILS.ana, helena, 12);
    const c = await post(EMAILS.ana, '/api/consultas', { medico_id: helena, data_hora: horario });
    expect(c.status).toBe(201);

    expect((await post(EMAILS.ana, `/api/consultas/${c.body.id}/cancelar`, { motivo: 'Imprevisto' })).status).toBe(200);
    const nova = await post(EMAILS.carlos, '/api/consultas', { medico_id: helena, data_hora: horario });
    expect(nova.status).toBe(201);
  });

  it('remarcar para um horário ocupado é recusado', async () => {
    const helena = (await entrar(EMAILS.helena)).id;
    const h1 = await primeiroHorarioLivre(EMAILS.ana, helena, 16);
    const h2 = await primeiroHorarioLivre(EMAILS.ana, helena, 17);
    const c1 = await post(EMAILS.ana, '/api/consultas', { medico_id: helena, data_hora: h1 });
    await post(EMAILS.carlos, '/api/consultas', { medico_id: helena, data_hora: h2 });
    const r = await put(EMAILS.ana, `/api/consultas/${c1.body.id}/reagendar`, { data_hora: h2 });
    expect(r.status).toBe(409);
  });

  it('encaixe é a exceção prevista: só a recepção faz e pode coincidir com um horário ocupado', async () => {
    const helena = (await entrar(EMAILS.helena)).id;
    const roberto = (await entrar(EMAILS.roberto)).id;
    const horario = await primeiroHorarioLivre(EMAILS.ana, helena, 20);
    await post(EMAILS.ana, '/api/consultas', { medico_id: helena, data_hora: horario });

    const paciente = await post(EMAILS.ana, '/api/consultas', { medico_id: helena, data_hora: horario, tipo: 'ENCAIXE' });
    expect(paciente.status).toBe(403);

    const recepcao = await post(EMAILS.recepcao, '/api/consultas', {
      medico_id: helena, data_hora: horario, tipo: 'ENCAIXE', paciente_id: roberto,
    });
    expect(recepcao.status).toBe(201);
    expect(recepcao.body.tipo).toBe('ENCAIXE');
  });

  it('recusa horários fora da agenda do médico e horários no passado', async () => {
    const camila = (await entrar('camila@agendasaude.com')).id; // atende só seg, qua e sex
    const dias = await get(EMAILS.ana, `/api/medicos/${camila}/dias-livres`);
    const diaSemana = (d: string) => new Date(`${d}T12:00:00`).getDay();
    expect(dias.body.every((d: { data: string }) => [1, 3, 5].includes(diaSemana(d.data)))).toBe(true);

    const ruim = await post(EMAILS.ana, '/api/consultas', { medico_id: camila, data_hora: '2099-01-01T03:07' });
    expect(ruim.status).toBe(400);
    const passado = await post(EMAILS.ana, '/api/consultas', { medico_id: camila, data_hora: '2020-01-06T09:00' });
    expect(passado.status).toBe(400);
  });

  it('nenhuma consulta ativa do banco fica duplicada após todos os cenários', () => {
    const dups = all(
      `SELECT medico_id, data_hora, count(*) n FROM consultas
       WHERE status NOT IN ('CANCELADA','FALTOU') AND tipo <> 'ENCAIXE' GROUP BY 1,2 HAVING n > 1`,
    );
    expect(dups).toEqual([]);
  });
});
