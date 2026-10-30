import { Router } from 'express';
import { z } from 'zod';
import { permitir } from '../auth.js';
import { config } from '../config.js';
import { convenioNomes, enriquecerConsultas, q, usuariosPorId, type ConsultaLinha } from '../dados.js';
import { supabase } from '../supabase.js';
import { intervaloDia } from '../tempo.js';
import { auditar, HttpError, hojeISO, naoEncontrado, notificar, somarDias, validar } from '../util.js';

export const financeiroRouter = Router();

// Consultar boletos (paciente: os próprios) / gerenciar boletos (financeiro e administrador)
financeiroRouter.get('/boletos', permitir('PACIENTE', 'FINANCEIRO', 'ADMIN'), async (req, res) => {
  const { status, busca, tipo } = req.query as Record<string, string | undefined>;
  let b = supabase.from('boletos').select('*');
  if (req.usuario.tipo === 'PACIENTE') {
    const minhas = (await q<{ id: number }[]>(supabase.from('consultas').select('id').eq('paciente_id', req.usuario.id))).map((c) => c.id);
    b = b.in('consulta_id', minhas.length ? minhas : [0]);
  }
  if (status) b = b.eq('status', status);
  if (tipo === 'CONVENIO') b = b.not('convenio_id', 'is', null);
  if (tipo === 'PARTICULAR') b = b.is('convenio_id', null);
  const rows = await q<any[]>(b.order('vencimento', { ascending: false }).limit(500));

  const consultas = await q<ConsultaLinha[]>(supabase.from('consultas').select('*').in('id', rows.length ? rows.map((r) => r.consulta_id) : [0]));
  const porId = new Map((await enriquecerConsultas(consultas)).map((c) => [c.id, c]));
  const convenios = await convenioNomes();
  const hoje = hojeISO();

  let lista = rows.map((bol) => {
    const c = porId.get(bol.consulta_id);
    return {
      ...bol,
      valor: Number(bol.valor),
      consulta_tipo: c?.tipo ?? null,
      data_hora: c?.data_hora ?? null,
      paciente_id: c?.paciente_id ?? null,
      paciente_nome: c?.paciente_nome ?? '',
      paciente_cpf: c?.paciente_cpf ?? '',
      medico_nome: c?.medico_nome ?? '',
      convenio_nome: bol.convenio_id ? convenios.get(bol.convenio_id) ?? null : null,
      vencido: bol.status === 'PENDENTE' && bol.vencimento < hoje ? 1 : 0,
    };
  });
  if (busca) {
    const termo = busca.toLowerCase();
    const dig = busca.replace(/\D/g, '');
    lista = lista.filter((x) => x.paciente_nome.toLowerCase().includes(termo) || (dig.length >= 3 && x.paciente_cpf.includes(dig)) || String(x.id) === busca.trim());
  }
  res.json(lista);
});

/** Ao finalizar a consulta: boleto de R$ 180 (retorno não é cobrado), vencimento em 10 dias. */
export async function gerarBoletoDaConsulta(consultaId: number, usuarioId: string) {
  const ja = await q<unknown[]>(supabase.from('boletos').select('id').eq('consulta_id', consultaId));
  if (ja.length) return;
  const c = await q<any>(supabase.from('consultas').select('tipo, paciente_id').eq('id', consultaId).single());
  const pac = await q<any>(supabase.from('pacientes').select('convenio_id').eq('usuario_id', c.paciente_id).maybeSingle());
  const valor = c.tipo === 'RETORNO' ? 0 : config.valorConsulta;
  const novo = await q<{ id: number }>(
    supabase
      .from('boletos')
      .insert([{ consulta_id: consultaId, convenio_id: pac?.convenio_id ?? null, valor, vencimento: somarDias(hojeISO(), 10), status: valor === 0 ? 'PAGO' : 'PENDENTE' }])
      .select('id')
      .single(),
  );
  await auditar(usuarioId, 'boletos', novo.id, 'GEROU_BOLETO', { consulta_id: consultaId, valor });
  if (valor > 0) await notificar(c.paciente_id, 'Boleto disponível', `O boleto nº ${novo.id} da sua consulta já está disponível.`, '/boletos');
}

// Boleto.gerar(): para consultas finalizadas que ainda não têm cobrança
financeiroRouter.post('/boletos', permitir('FINANCEIRO', 'ADMIN'), async (req, res) => {
  const d = validar(
    z.object({
      consulta_id: z.number().int().positive(),
      valor: z.number().min(0, 'O valor não pode ser negativo.'),
      vencimento: z.string().min(10, 'Informe o vencimento.'),
    }),
    req.body,
  );

  const { data: consulta } = await supabase
    .from('consultas')
    .select('status, paciente_id')
    .eq('id', d.consulta_id)
    .single();

  if (!consulta) throw naoEncontrado('Consulta não encontrada.');
  if (consulta.status !== 'FINALIZADA') throw new HttpError(400, 'Só consultas finalizadas geram cobrança.');

  const { data: paciente } = await supabase
    .from('pacientes')
    .select('convenio_id')
    .eq('usuario_id', consulta.paciente_id)
    .single();

  const { data: novoBoleto, error } = await supabase
    .from('boletos')
    .insert([
      {
        consulta_id: d.consulta_id,
        convenio_id: paciente?.convenio_id || null,
        valor: d.valor,
        vencimento: d.vencimento,
        status: 'PENDENTE'
      }
    ])
    .select()
    .single();

  if (error) throw new HttpError(400, error.message);

  auditar(req.usuario.id, 'boletos', novoBoleto.id, 'GEROU', d);
  res.status(201).json({ id: novoBoleto.id });
});

financeiroRouter.put('/boletos/:id', permitir('FINANCEIRO', 'ADMIN'), async (req, res) => {
  const id = Number((req.params as any).id);
  const d = validar(z.object({ valor: z.number().min(0), vencimento: z.string() }), req.body);

  const { data: boleto } = await supabase.from('boletos').select('status').eq('id', id).maybeSingle();
  if (!boleto) throw naoEncontrado('Boleto não encontrado.');
  if (boleto.status !== 'PENDENTE') throw new HttpError(400, 'Só boletos pendentes podem ser alterados.');

  const { error } = await supabase.from('boletos').update(d).eq('id', id);
  if (error) throw new HttpError(400, error.message);

  auditar(req.usuario.id, 'boletos', id, 'EDITOU', d);
  res.json({ ok: true });
});

// Boleto.darBaixa()
financeiroRouter.post('/boletos/:id/baixa', permitir('FINANCEIRO', 'ADMIN'), async (req, res) => {
  const id = Number((req.params as any).id);

  const { data: b } = await supabase
    .from('boletos')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!b) throw naoEncontrado('Boleto não encontrado.');
  if (b.status !== 'PENDENTE') throw new HttpError(400, 'Este boleto não está pendente.');

  const { error } = await supabase.from('boletos').update({ status: 'PAGO' }).eq('id', id);
  if (error) throw new HttpError(400, error.message);

  auditar(req.usuario.id, 'boletos', id, 'DEU_BAIXA');
  
  const { data: cons } = await supabase.from('consultas').select('paciente_id').eq('id', b.consulta_id).maybeSingle();
  const pacienteId = cons?.paciente_id;
  if (pacienteId) {
    await notificar(pacienteId, 'Pagamento confirmado', `O boleto nº ${id} foi registrado como pago.`, '/boletos');
  }

  res.json({ ok: true });
});

// Boleto.cancelar()
financeiroRouter.post('/boletos/:id/cancelar', permitir('FINANCEIRO', 'ADMIN'), async (req, res) => {
  const id = Number((req.params as any).id);

  const { data: b } = await supabase.from('boletos').select('status').eq('id', id).maybeSingle();
  if (!b) throw naoEncontrado('Boleto não encontrado.');
  if (b.status !== 'PENDENTE') throw new HttpError(400, 'Só boletos pendentes podem ser cancelados.');

  const { error } = await supabase.from('boletos').update({ status: 'CANCELADO' }).eq('id', id);
  if (error) throw new HttpError(400, error.message);

  auditar(req.usuario.id, 'boletos', id, 'CANCELOU');
  res.json({ ok: true });
});

/* -------------------------------- dashboard -------------------------------- */

financeiroRouter.get('/dashboard', permitir('RECEPCIONISTA', 'ADMIN', 'FINANCEIRO'), async (req, res) => {
  const dataRef = typeof req.query.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.data) ? req.query.data : hojeISO();

  // Consultas do dia
  const { data: consultasDia } = await supabase
    .from('consultas')
    .select('*')
    .gte('data_hora', intervaloDia(dataRef).de)
    .lt('data_hora', intervaloDia(dataRef).ate);

  const total = consultasDia?.length || 0;
  const agendadas = consultasDia?.filter(c => c.status === 'AGENDADA').length || 0;
  const aguardando = consultasDia?.filter(c => ['CONFIRMADA', 'EM_ESPERA'].includes(c.status)).length || 0;
  const em_atendimento = consultasDia?.filter(c => c.status === 'EM_ATENDIMENTO').length || 0;
  const finalizadas = consultasDia?.filter(c => c.status === 'FINALIZADA').length || 0;
  const canceladas = consultasDia?.filter(c => c.status === 'CANCELADA').length || 0;
  const faltas = consultasDia?.filter(c => c.status === 'FALTOU').length || 0;
  const encaixes = consultasDia?.filter(c => c.tipo === 'ENCAIXE' && c.status !== 'CANCELADA').length || 0;
  const com_atraso = consultasDia?.filter(c => (c.atraso_min || 0) > 0 && !['CANCELADA', 'FALTOU'].includes(c.status)).length || 0;

  let somaEsperaMin = 0;
  let countEspera = 0;
  consultasDia?.forEach(c => {
    if (c.check_in_em && c.iniciada_em) {
      const diffMs = new Date(c.iniciada_em).getTime() - new Date(c.check_in_em).getTime();
      const diffMin = diffMs / 60000;
      if (diffMin > 0) {
        somaEsperaMin += diffMin;
        countEspera++;
      }
    }
  });
  const espera_media_min = countEspera > 0 ? Math.round(somaEsperaMin / countEspera) : null;

  const dia = {
    total, agendadas, aguardando, em_atendimento, finalizadas, canceladas, faltas, encaixes, com_atraso, espera_media_min
  };

  // Resumo da semana (últimos 7 dias)
  const inicio = somarDias(dataRef, -6);
  const semana = [];
  for (let i = 0; i < 7; i++) {
    const dStr = somarDias(inicio, i);
    const { data: cSemana } = await supabase
      .from('consultas')
      .select('status')
      .gte('data_hora', intervaloDia(dStr).de)
      .lt('data_hora', intervaloDia(dStr).ate);

    const consultasCount = cSemana?.filter(c => c.status !== 'CANCELADA').length || 0;
    const faltasCount = cSemana?.filter(c => c.status === 'FALTOU').length || 0;
    semana.push({ data: dStr, consultas: consultasCount, faltas: faltasCount });
  }

  // Por Médico
  const medicosRows = await q<{ usuario_id: string }[]>(supabase.from('medicos').select('usuario_id'));
  const nomesMed = await usuariosPorId(medicosRows.map((m) => m.usuario_id));
  const medicosAtivos = medicosRows
    .filter((m) => nomesMed.get(m.usuario_id)?.ativo)
    .map((m) => ({ usuario_id: m.usuario_id, usuarios: { nome: nomesMed.get(m.usuario_id)!.nome } }));

  const porMedico = [];
  for (const m of medicosAtivos) {
    const cMed = consultasDia?.filter(c => c.medico_id === m.usuario_id && c.status !== 'CANCELADA') || [];
    const finCount = cMed.filter(c => c.status === 'FINALIZADA').length;
    const maxAtraso = cMed.reduce((max, c) => Math.max(max, c.atraso_min || 0), 0);

    porMedico.push({
      medico_id: m.usuario_id,
      medico_nome: (m.usuarios as any)?.nome,
      consultas: cMed.length,
      finalizadas: finCount,
      atraso_min: maxAtraso
    });
  }
  porMedico.sort((a, b) => b.consultas - a.consultas || a.medico_nome.localeCompare(b.medico_nome));

  // Outros indicadores
  const { count: listaEsperaCount } = await supabase.from('lista_espera').select('*', { count: 'exact', head: true }).eq('ativo', true);
  const { data: boletosPendentes } = await supabase.from('boletos').select('valor, vencimento').eq('status', 'PENDENTE');
  
  const countBoletosPendentes = boletosPendentes?.length || 0;
  const valor_pendente = boletosPendentes?.reduce((acc, b) => acc + Number(b.valor), 0) || 0;
  const hojeStr = hojeISO();
  const boletos_vencidos = boletosPendentes?.filter(b => b.vencimento < hojeStr).length || 0;

  const { count: examesAndamentoCount } = await supabase.from('exames').select('*', { count: 'exact', head: true }).neq('status', 'CONCLUIDO');
  const { count: pacientesCount } = await supabase.from('pacientes').select('*', { count: 'exact', head: true });

  const outros = {
    lista_espera: listaEsperaCount || 0,
    boletos_pendentes: countBoletosPendentes,
    valor_pendente,
    boletos_vencidos,
    exames_em_andamento: examesAndamentoCount || 0,
    pacientes: pacientesCount || 0
  };

  res.json({ data: dataRef, dia, semana, porMedico, ...outros });
});