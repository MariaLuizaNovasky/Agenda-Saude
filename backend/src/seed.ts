/**
 * Dados fictícios para demonstração (TAP: testes e apresentação com dados fictícios).
 * Rodar manualmente: npm run seed  (apaga e recria tudo)
 */
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { db, one, run, transacao } from './db.js';
import { agoraCompleto, hhmm, hojeISO, somarDias } from './util.js';

export const SENHA_DEMO = 'Senha123';

/** Gera um CPF válido a partir de 9 dígitos-base. */
function cpf(base: string) {
  const d = base.split('').map(Number);
  const dv = (arr: number[]) => {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i] * (arr.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(d));
  d.push(dv(d));
  return d.join('');
}

export function popular() {
  const hash = bcrypt.hashSync(SENHA_DEMO, 10);
  transacao(() => {
    for (const t of ['notificacoes', 'log_alteracoes', 'boletos', 'exames', 'documentos_medicos', 'prontuarios', 'lista_espera', 'consultas',
      'disponibilidades', 'medico_especialidade', 'pacientes', 'medicos', 'usuarios', 'especialidades', 'convenios']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec("DELETE FROM sqlite_sequence");

    const usuario = (nome: string, email: string, tipo: string, telefone: string) =>
      run('INSERT INTO usuarios (nome, email, senha_hash, telefone, tipo) VALUES (?,?,?,?,?)', nome, email, hash, telefone, tipo).id;

    // equipe
    usuario('Marcos Albuquerque', 'admin@agendasaude.com', 'ADMIN', '(11) 98000-0001');
    const recep = usuario('Juliana Castro', 'recepcao@agendasaude.com', 'RECEPCIONISTA', '(11) 98000-0002');
    usuario('Fernanda Lopes', 'financeiro@agendasaude.com', 'FINANCEIRO', '(11) 98000-0003');
    usuario('Lab. Análise Central', 'laboratorio@agendasaude.com', 'LABORATORIO', '(11) 98000-0004');
    usuario('Farmácia Bem Viver', 'farmacia@agendasaude.com', 'FARMACIA', '(11) 98000-0005');

    // catálogo
    const esp: Record<string, number> = {};
    for (const n of ['Clínica Geral', 'Cardiologia', 'Dermatologia', 'Ortopedia', 'Pediatria', 'Ginecologia']) {
      esp[n] = run('INSERT INTO especialidades (nome) VALUES (?)', n).id;
    }
    const conv = {
      saude: run("INSERT INTO convenios (nome, registro_ans) VALUES ('Saúde+', '412345')").id,
      vida: run("INSERT INTO convenios (nome, registro_ans) VALUES ('Vida Plena', '398765')").id,
      bem: run("INSERT INTO convenios (nome, registro_ans) VALUES ('Bem Cuidar', '401122')").id,
    };

    // médicos (CRMs fictícios)
    const medico = (nome: string, email: string, crm: string, uf: string, especs: string[], dias: number[], verificado = true) => {
      const id = usuario(nome, email, 'MEDICO', '(11) 97000-' + crm.slice(-4));
      run('INSERT INTO medicos (usuario_id, crm, crm_uf, crm_verificado) VALUES (?,?,?,?)', id, crm, uf, verificado);
      for (const e of especs) run('INSERT INTO medico_especialidade VALUES (?,?)', id, esp[e]);
      for (const d of dias) {
        run("INSERT INTO disponibilidades (medico_id, dia_semana, hora_inicio, hora_fim, duracao_min) VALUES (?,?, '07:00','12:00',30)", id, d);
        run("INSERT INTO disponibilidades (medico_id, dia_semana, hora_inicio, hora_fim, duracao_min) VALUES (?,?, '13:00','22:00',30)", id, d);
      }
      return id;
    };
    const todos = [0, 1, 2, 3, 4, 5, 6];
    const helena = medico('Dra. Helena Prado', 'helena@agendasaude.com', '123456', 'SP', ['Cardiologia', 'Clínica Geral'], todos);
    const rafael = medico('Dr. Rafael Moreira', 'rafael@agendasaude.com', '234567', 'SP', ['Clínica Geral', 'Pediatria'], todos);
    const camila = medico('Dra. Camila Souza', 'camila@agendasaude.com', '345678', 'RJ', ['Dermatologia'], [1, 3, 5]);
    const bruno = medico('Dr. Bruno Tavares', 'bruno@agendasaude.com', '456789', 'MG', ['Ortopedia'], [2, 4, 6], false);
    const medicos = [helena, rafael, camila, bruno];

    // pacientes
    const paciente = (nome: string, email: string, base: string, nasc: string, convenio: number | null) => {
      const id = usuario(nome, email, 'PACIENTE', '(11) 96' + base.slice(0, 3) + '-' + base.slice(3, 7));
      run(
        'INSERT INTO pacientes (usuario_id, cpf, data_nascimento, convenio_id, numero_carteirinha) VALUES (?,?,?,?,?)',
        id, cpf(base), nasc, convenio, convenio ? '0' + base + '01' : null,
      );
      run('INSERT INTO prontuarios (paciente_id, alergias, observacoes) VALUES (?,?,?)', id, null, null);
      return id;
    };
    const ana = paciente('Ana Beatriz Ribeiro', 'paciente@agendasaude.com', '123456789', '1990-04-12', conv.saude);
    const pacientes = [
      ana,
      paciente('Carlos Eduardo Lima', 'carlos.lima@email.com', '234567891', '1985-09-30', null),
      paciente('Mariana Fontes', 'mariana.fontes@email.com', '345678912', '1978-01-22', conv.vida),
      paciente('João Pedro Nunes', 'joao.nunes@email.com', '456789123', '2015-06-05', conv.saude),
      paciente('Luciana Batista', 'luciana.b@email.com', '567891234', '1966-11-17', null),
      paciente('Roberto Siqueira', 'roberto.s@email.com', '678912345', '1959-03-08', conv.bem),
      paciente('Patrícia Gomes', 'patricia.g@email.com', '789123456', '1995-07-27', null),
      paciente('Thiago Andrade', 'thiago.a@email.com', '891234567', '2001-12-01', conv.vida),
    ];
    run("UPDATE prontuarios SET alergias = 'Dipirona', observacoes = 'Hipertensão leve controlada com dieta.' WHERE paciente_id = ?", ana);

    const consulta = (pac: number, med: number, dh: string, status: string, tipo = 'NORMAL', extra: Record<string, unknown> = {}) => {
      const id = run(
        `INSERT INTO consultas (paciente_id, medico_id, data_hora, tipo, status, check_in_em, iniciada_em, finalizada_em, atraso_min, anotacoes, motivo_cancelamento)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        pac, med, dh, tipo, status,
        (extra.check_in_em as string) ?? null, (extra.iniciada_em as string) ?? null, (extra.finalizada_em as string) ?? null,
        (extra.atraso_min as number) ?? 0, (extra.anotacoes as string) ?? null, (extra.motivo as string) ?? null,
      ).id;
      if (status === 'FINALIZADA') {
        const c = one<{ convenio_id: number | null }>('SELECT convenio_id FROM pacientes WHERE usuario_id = ?', pac)!;
        const venc = somarDias(dh.slice(0, 10), 10);
        const pago = venc < hojeISO() || id % 3 === 0;
        run('INSERT INTO boletos (consulta_id, convenio_id, valor, vencimento, status) VALUES (?,?,?,?,?)',
          id, c.convenio_id, tipo === 'RETORNO' ? 0 : 180, venc, pago ? 'PAGO' : 'PENDENTE');
      }
      return id;
    };

    // histórico das duas últimas semanas (alimenta o dashboard e os relatórios)
    const hoje = hojeISO();
    let k = 0;
    for (let d = -14; d < 0; d++) {
      const dia = somarDias(hoje, d);
      for (let i = 0; i < 6; i++) {
        k++;
        const pac = pacientes[(k + i) % pacientes.length];
        const med = medicos[(k + i) % medicos.length];
        const h = `${dia}T${hhmm(8 * 60 + i * 60 + (k % 2) * 30)}`;
        const sorte = (k * 3) % 10;
        const status = sorte === 0 ? 'FALTOU' : sorte === 1 ? 'CANCELADA' : 'FINALIZADA';
        const ci = `${h}:00`;
        const espera = 5 + ((k * 11) % 25);
        consulta(pac, med, h, status, 'NORMAL', status === 'FINALIZADA'
          ? { check_in_em: ci, iniciada_em: `${h.slice(0, 11)}${hhmm(Number(h.slice(11, 13)) * 60 + Number(h.slice(14, 16)) + espera)}:00`, finalizada_em: ci, anotacoes: 'Paciente estável. Orientações gerais.' }
          : status === 'CANCELADA' ? { motivo: 'Imprevisto pessoal do paciente.' } : {});
      }
    }

    // consulta passada da Ana com exame concluído e prazo de retorno (gera "retorno pendente")
    const c1 = consulta(ana, helena, `${somarDias(hoje, -9)}T07:30`, 'FINALIZADA', 'NORMAL', {
      check_in_em: `${somarDias(hoje, -9)}T07:24:00`, iniciada_em: `${somarDias(hoje, -9)}T07:35:00`,
      finalizada_em: `${somarDias(hoje, -9)}T08:00:00`, anotacoes: 'Queixa de palpitações. Solicitado ECG e hemograma.',
    });
    const pAna = one<{ id: number }>('SELECT id FROM prontuarios WHERE paciente_id = ?', ana)!.id;
    run("INSERT INTO exames (prontuario_id, consulta_id, tipo, status, data_solicitacao, data_resultado, arquivo_resultado, arquivo_nome, prazo_retorno_dias) VALUES (?,?,'Eletrocardiograma','CONCLUIDO',?,?,NULL,NULL,30)",
      pAna, c1, somarDias(hoje, -9), somarDias(hoje, -2));
    run("INSERT INTO exames (prontuario_id, consulta_id, tipo, status, data_solicitacao, prazo_retorno_dias) VALUES (?,?,'Hemograma completo','COLETADO',?,30)",
      pAna, c1, somarDias(hoje, -9));
    run("INSERT INTO documentos_medicos (prontuario_id, consulta_id, medico_id, tipo, conteudo, data_emissao) VALUES (?,?,?,'RECEITA',?,?)",
      pAna, c1, helena, 'Propranolol 40 mg — tomar 1 comprimido de 12 em 12 horas por 30 dias.', somarDias(hoje, -9));
    const pCarlos = one<{ id: number }>('SELECT id FROM prontuarios WHERE paciente_id = ?', pacientes[1])!.id;
    const c2 = one<{ id: number }>("SELECT id FROM consultas WHERE paciente_id = ? AND status = 'FINALIZADA' LIMIT 1", pacientes[1])!.id;
    run("INSERT INTO exames (prontuario_id, consulta_id, tipo, status, data_solicitacao, prazo_retorno_dias) VALUES (?,?,'Raio-X de joelho','SOLICITADO',?,15)",
      pCarlos, c2, somarDias(hoje, -3));

    // fila de hoje, montada em torno do horário atual
    const agora = new Date();
    let base = Math.floor((agora.getHours() * 60 + agora.getMinutes()) / 30) * 30;
    base = Math.min(Math.max(base, 8 * 60), 20 * 60);
    const t = (desloc: number) => `${hoje}T${hhmm(base + desloc)}`;
    const ci = (desloc: number) => `${t(desloc)}:00`;
    const agoraTxt = agoraCompleto();
    consulta(pacientes[4], helena, t(-60), 'FINALIZADA', 'NORMAL', { check_in_em: ci(-65), iniciada_em: ci(-58), finalizada_em: ci(-35) });
    consulta(pacientes[2], helena, t(-30), 'EM_ATENDIMENTO', 'NORMAL', { check_in_em: ci(-38), iniciada_em: agoraTxt, atraso_min: 15 });
    consulta(pacientes[5], helena, t(0), 'EM_ESPERA', 'NORMAL', { check_in_em: ci(-12), atraso_min: 15 });
    consulta(ana, helena, t(30), 'AGENDADA', 'NORMAL', { atraso_min: 15 });
    consulta(pacientes[6], helena, t(60), 'AGENDADA', 'NORMAL', { atraso_min: 15 });
    consulta(pacientes[3], rafael, t(-30), 'EM_ESPERA', 'NORMAL', { check_in_em: ci(-40) });
    consulta(pacientes[7], rafael, t(0), 'CONFIRMADA', 'NORMAL', { check_in_em: ci(-5) });
    consulta(pacientes[1], rafael, t(15), 'EM_ESPERA', 'ENCAIXE', { check_in_em: ci(-20) });
    consulta(pacientes[4], rafael, t(60), 'AGENDADA');

    // próximos dias
    for (let d = 1; d <= 6; d++) {
      const dia = somarDias(hoje, d);
      consulta(pacientes[d % pacientes.length], medicos[d % 4], `${dia}T09:00`, 'AGENDADA');
      consulta(pacientes[(d + 3) % pacientes.length], medicos[(d + 1) % 4], `${dia}T15:30`, 'AGENDADA', d === 3 ? 'RETORNO' : 'NORMAL');
    }

    // lista de espera
    run("INSERT INTO lista_espera (paciente_id, especialidade_id, prioridade, observacao, data_solicitacao) VALUES (?,?,2,'Dor intensa no joelho após queda',?)", pacientes[5], esp['Ortopedia'], `${somarDias(hoje, -2)} 10:12:00`);
    run("INSERT INTO lista_espera (paciente_id, especialidade_id, prioridade, observacao, data_solicitacao) VALUES (?,?,0,'Prefere horários pela manhã',?)", pacientes[6], esp['Dermatologia'], `${somarDias(hoje, -1)} 16:40:00`);
    run("INSERT INTO lista_espera (paciente_id, especialidade_id, prioridade, data_solicitacao) VALUES (?,?,1,?)", pacientes[2], esp['Cardiologia'], `${hoje} 07:55:00`);

    run("INSERT INTO notificacoes (usuario_id, titulo, mensagem, link) VALUES (?, 'Resultado de exame disponível', 'O resultado de Eletrocardiograma já está no seu histórico. Agende o retorno com Dra. Helena Prado dentro de 30 dias.', '/historico')", ana);
    run("INSERT INTO notificacoes (usuario_id, titulo, mensagem, link) VALUES (?, 'Atendimento atrasado', 'Dra. Helena Prado está com cerca de 15 min de atraso.', '/fila')", ana);
    run("INSERT INTO notificacoes (usuario_id, titulo, mensagem, link) VALUES (?, 'Pedido urgente na lista de espera', 'Roberto Siqueira aguarda vaga em Ortopedia (prioridade alta).', '/lista-espera')", recep);
  });
  console.log(`Dados de demonstração criados. Senha de todos os usuários: ${SENHA_DEMO}`);
}

// executado via "npm run seed"
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) popular();
