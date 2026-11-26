import { Router } from 'express';
import { z } from 'zod';
import { permitir, RECEPCAO, type UsuarioToken } from '../auth.js';
import { diasLivres, gerarHorarios, STATUS_ATIVOS } from '../agenda.js';
import { criarConta, cpfEmUso, emailEmUso } from '../contas.js';
import { convenioNomes, enriquecerConsultas, especialidadesDosMedicos, medicosPorId, pacientesPorId, prontuarioDe, q, usuariosPorId, type ConsultaLinha } from '../dados.js';
import { emitir } from '../events.js';
import { supabase } from '../supabase.js';
import { deBanco, ehData, hojeLocal, intervaloDia, minutos } from '../tempo.js';
import { auditar, cpfValido, HttpError, notificar, validar } from '../util.js';
import { listarDocumentos, listarExames } from './clinico.js';

export const pessoasRouter = Router();

const idDe = (v: unknown) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID inválido.');
  return id;
};
const ehRecepcao = (u: UsuarioToken) => RECEPCAO.includes(u.tipo);
const soDigitos = (s: string) => s.replace(/\D/g, '');

/** Médico só acessa dados clínicos de quem tem ou teve consulta com ele. */
export async function medicoAtendePaciente(medicoId: string, pacienteId: string) {
  const r = await q<unknown[]>(supabase.from('consultas').select('id').eq('medico_id', medicoId).eq('paciente_id', pacienteId).limit(1));
  return r.length > 0;
}

/* -------------------------------- pacientes -------------------------------- */

async function montarPacientes(rows: any[]) {
  const [usuarios, convenios] = await Promise.all([usuariosPorId(rows.map((p) => p.usuario_id)), convenioNomes()]);
  return rows
    .map((p) => {
      const u = usuarios.get(p.usuario_id);
      return {
        id: p.usuario_id,
        nome: u?.nome ?? '',
        email: u?.email ?? '',
        telefone: u?.telefone ?? null,
        ativo: u?.ativo ?? false,
        cpf: p.cpf,
        data_nascimento: p.data_nascimento,
        convenio_id: p.convenio_id ?? null,
        convenio_nome: p.convenio_id ? convenios.get(p.convenio_id) ?? null : null,
        numero_carteirinha: p.numero_carteirinha ?? null,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

pessoasRouter.get('/pacientes', permitir(...RECEPCAO), async (req, res) => {
  const busca = String(req.query.busca ?? '').trim().toLowerCase();
  const lista = await montarPacientes(await q<any[]>(supabase.from('pacientes').select('*')));
  const digitos = soDigitos(busca);
  const filtrada = busca
    ? lista.filter((p) => p.nome.toLowerCase().includes(busca) || p.email.toLowerCase().includes(busca) || (digitos.length >= 3 && p.cpf.includes(digitos)))
    : lista;
  res.json(filtrada.slice(0, 300));
});

pessoasRouter.get('/pacientes/:id', async (req, res) => {
  const id = String(req.params.id);
  const u = req.usuario;
  if (!(ehRecepcao(u) || (u.tipo === 'PACIENTE' && u.id === id))) throw new HttpError(403, 'Acesso não autorizado.');
  const p = await q<any>(supabase.from('pacientes').select('*').eq('usuario_id', id).maybeSingle());
  if (!p) throw new HttpError(404, 'Paciente não encontrado.');
  res.json((await montarPacientes([p]))[0]);
});

const camposPaciente = {
  nome: z.string().trim().min(3, 'Informe o nome completo.'),
  email: z.string().trim().email('Informe um e-mail válido.'),
  telefone: z.string().trim().min(10, 'Informe um telefone com DDD.'),
  cpf: z.string().refine(cpfValido, 'CPF inválido.'),
  data_nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de nascimento.'),
  convenio_id: z.number().int().positive().nullish(),
  numero_carteirinha: z.string().trim().nullish(),
};

pessoasRouter.post('/pacientes', permitir(...RECEPCAO), async (req, res) => {
  const d = validar(
    z.object({ ...camposPaciente, senha_temporaria: z.string().min(8, 'A senha temporária precisa ter pelo menos 8 caracteres.') }),
    req.body,
  );
  if (d.convenio_id && !d.numero_carteirinha) throw new HttpError(400, 'Informe o número da carteirinha do convênio.');
  const cpf = soDigitos(d.cpf);
  if (await cpfEmUso(cpf)) throw new HttpError(409, 'CPF já cadastrado.');
  if (await emailEmUso(d.email)) throw new HttpError(409, 'E-mail já cadastrado.');

  const id = await criarConta(d.email, d.senha_temporaria, async (id) => {
    await q(supabase.from('usuarios').insert([{ id, nome: d.nome, email: d.email.toLowerCase(), telefone: d.telefone, tipo: 'PACIENTE', troca_senha_obrigatoria: true }]));
    await q(
      supabase.from('pacientes').insert([
        { usuario_id: id, cpf, data_nascimento: d.data_nascimento, convenio_id: d.convenio_id ?? null, numero_carteirinha: d.convenio_id ? d.numero_carteirinha : null },
      ]),
    );
    await q(supabase.from('prontuarios').insert([{ paciente_id: id }]));
  });
  await auditar(req.usuario.id, 'usuarios', id, 'CADASTROU_PACIENTE');
  res.status(201).json({ id });
});

pessoasRouter.put('/pacientes/:id', permitir(...RECEPCAO), async (req, res) => {
  const id = String(req.params.id);
  const d = validar(z.object(camposPaciente), req.body);
  if (d.convenio_id && !d.numero_carteirinha) throw new HttpError(400, 'Informe o número da carteirinha do convênio.');
  const cpf = soDigitos(d.cpf);
  const atual = await q<any>(supabase.from('pacientes').select('usuario_id').eq('usuario_id', id).maybeSingle());
  if (!atual) throw new HttpError(404, 'Paciente não encontrado.');
  if (await cpfEmUso(cpf, id)) throw new HttpError(409, 'CPF já cadastrado.');
  if (await emailEmUso(d.email, id)) throw new HttpError(409, 'E-mail já cadastrado.');

  const { data: authAtual } = await supabase.auth.admin.getUserById(id);
  if (authAtual?.user && authAtual.user.email?.toLowerCase() !== d.email.toLowerCase()) {
    const { error } = await supabase.auth.admin.updateUserById(id, { email: d.email.toLowerCase(), email_confirm: true });
    if (error) throw new HttpError(400, `Não foi possível trocar o e-mail: ${error.message}`);
  }
  await q(supabase.from('usuarios').update({ nome: d.nome, email: d.email.toLowerCase(), telefone: d.telefone }).eq('id', id));
  await q(
    supabase
      .from('pacientes')
      .update({ cpf, data_nascimento: d.data_nascimento, convenio_id: d.convenio_id ?? null, numero_carteirinha: d.convenio_id ? d.numero_carteirinha : null })
      .eq('usuario_id', id),
  );
  await auditar(req.usuario.id, 'pacientes', id, 'EDITOU_PACIENTE');
  res.json({ ok: true });
});

// Histórico clínico: o próprio paciente ou o médico que o atende (recepção e administração não veem)
pessoasRouter.get('/pacientes/:id/historico', async (req, res) => {
  const id = String(req.params.id);
  const u = req.usuario;
  const medico = u.tipo === 'MEDICO' && (await medicoAtendePaciente(u.id, id));
  if (!(medico || (u.tipo === 'PACIENTE' && u.id === id))) throw new HttpError(403, 'Acesso não autorizado ao histórico clínico.');

  const [consultasRows, prontuario, pacienteRow] = await Promise.all([
    q<ConsultaLinha[]>(supabase.from('consultas').select('*').eq('paciente_id', id).order('data_hora', { ascending: false }).limit(200)),
    prontuarioDe(id),
    q<any>(supabase.from('pacientes').select('*').eq('usuario_id', id).maybeSingle()),
  ]);
  if (!pacienteRow) throw new HttpError(404, 'Paciente não encontrado.');
  const paciente = (await montarPacientes([pacienteRow]))[0];
  const consultas = (await enriquecerConsultas(consultasRows)).map((c) => {
    const base = { id: c.id, data_hora: c.data_hora, tipo: c.tipo, status: c.status, medico_id: c.medico_id, medico_nome: c.medico_nome, especialidades: c.especialidades, motivo_cancelamento: c.motivo_cancelamento };
    return medico ? { ...base, anotacoes: c.anotacoes } : base; // anotação clínica não aparece para o paciente
  });
  const [exames, documentos] = await Promise.all([listarExames({ prontuario_id: prontuario.id }), listarDocumentos({ prontuario_id: prontuario.id })]);
  res.json({ paciente, prontuario, consultas, exames, documentos });
});

pessoasRouter.put('/pacientes/:id/prontuario', permitir('MEDICO'), async (req, res) => {
  const id = String(req.params.id);
  if (!(await medicoAtendePaciente(req.usuario.id, id))) throw new HttpError(403, 'Você não atende este paciente.');
  const d = validar(z.object({ alergias: z.string().nullish(), observacoes: z.string().nullish() }), req.body);
  const p = await prontuarioDe(id);
  const atualizado = await q(supabase.from('prontuarios').update({ alergias: d.alergias || null, observacoes: d.observacoes || null }).eq('id', p.id).select().single());
  await auditar(req.usuario.id, 'prontuarios', p.id, 'EDITOU_PRONTUARIO');
  res.json(atualizado);
});

/* --------------------------------- médicos --------------------------------- */

pessoasRouter.get('/medicos', async (req, res) => {
  const espFiltro = req.query.especialidade_id ? Number(req.query.especialidade_id) : null;
  const rows = await q<any[]>(supabase.from('medicos').select('*'));
  const ids = rows.map((m) => m.usuario_id);
  const hoje = intervaloDia(hojeLocal());
  const [usuarios, esps, hojeRows] = await Promise.all([
    usuariosPorId(ids),
    especialidadesDosMedicos(ids),
    q<{ medico_id: string; atraso_min: number }[]>(
      supabase.from('consultas').select('medico_id, atraso_min').gte('data_hora', hoje.de).lt('data_hora', hoje.ate).in('status', STATUS_ATIVOS),
    ),
  ]);
  const atraso = new Map<string, number>();
  for (const c of hojeRows) atraso.set(c.medico_id, Math.max(atraso.get(c.medico_id) ?? 0, c.atraso_min ?? 0));

  const lista = rows
    .filter((m) => usuarios.get(m.usuario_id)?.ativo)
    .map((m) => {
      const e = esps.get(m.usuario_id) ?? [];
      return {
        id: m.usuario_id,
        nome: usuarios.get(m.usuario_id)!.nome,
        crm: m.crm,
        crm_uf: m.crm_uf,
        crm_verificado: m.crm_verificado ? 1 : 0,
        especialidades: e.map((x) => x.nome).join(', ') || null,
        especialidade_ids: e.map((x) => x.id).join(',') || null,
        atraso_hoje: atraso.get(m.usuario_id) || null,
      };
    })
    .filter((m) => !espFiltro || m.especialidade_ids?.split(',').map(Number).includes(espFiltro))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  res.json(lista);
});

function exigirAgendaPropria(u: UsuarioToken, medicoId: string) {
  if (u.tipo === 'ADMIN' || (u.tipo === 'MEDICO' && u.id === medicoId)) return;
  throw new HttpError(403, 'Você só gerencia a sua própria agenda.');
}

const formatarPeriodo = (p: any) => ({ ...p, hora_inicio: String(p.hora_inicio).slice(0, 5), hora_fim: String(p.hora_fim).slice(0, 5) });

pessoasRouter.get('/medicos/:id/disponibilidades', async (req, res) => {
  const rows = await q<any[]>(supabase.from('disponibilidades').select('*').eq('medico_id', String(req.params.id)).order('dia_semana').order('hora_inicio'));
  res.json(rows.map(formatarPeriodo));
});

pessoasRouter.post('/medicos/:id/disponibilidades', async (req, res) => {
  const medicoId = String(req.params.id);
  exigirAgendaPropria(req.usuario, medicoId);
  const hora = z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida.');
  const d = validar(
    z.object({
      dia_semana: z.number().int().min(0).max(6),
      hora_inicio: hora,
      hora_fim: hora,
      duracao_min: z.number().int().min(10, 'A duração mínima é de 10 minutos.').max(240, 'A duração máxima é de 240 minutos.'),
    }),
    req.body,
  );
  if (minutos(d.hora_fim) <= minutos(d.hora_inicio)) throw new HttpError(400, 'O fim precisa ser depois do início.');
  if (minutos(d.hora_fim) - minutos(d.hora_inicio) < d.duracao_min) throw new HttpError(400, 'O período é menor que a duração de uma consulta.');

  const doDia = await q<any[]>(supabase.from('disponibilidades').select('hora_inicio, hora_fim').eq('medico_id', medicoId).eq('dia_semana', d.dia_semana));
  const sobrepoe = doDia.some((p) => minutos(d.hora_inicio) < minutos(String(p.hora_fim)) && minutos(String(p.hora_inicio)) < minutos(d.hora_fim));
  if (sobrepoe) throw new HttpError(409, 'Este período se sobrepõe a outro já cadastrado nesse dia.');

  const novo = await q<any>(supabase.from('disponibilidades').insert([{ medico_id: medicoId, ...d }]).select().single());
  await auditar(req.usuario.id, 'disponibilidades', novo.id, 'ADICIONOU_DISPONIBILIDADE', d);
  emitir('agenda');
  res.status(201).json(formatarPeriodo(novo));
});

pessoasRouter.delete('/medicos/:id/disponibilidades/:did', async (req, res) => {
  const medicoId = String(req.params.id);
  exigirAgendaPropria(req.usuario, medicoId);
  const did = idDe(String(req.params.did));
  const r = await q<unknown[]>(supabase.from('disponibilidades').delete().eq('id', did).eq('medico_id', medicoId).select('id'));
  if (!r.length) throw new HttpError(404, 'Período não encontrado.');
  await auditar(req.usuario.id, 'disponibilidades', did, 'REMOVEU_DISPONIBILIDADE');
  emitir('agenda');
  res.json({ ok: true });
});

pessoasRouter.get('/medicos/:id/horarios', async (req, res) => {
  if (!ehData(req.query.data)) throw new HttpError(400, 'Informe a data (AAAA-MM-DD).');
  res.json(await gerarHorarios(String(req.params.id), req.query.data));
});

pessoasRouter.get('/medicos/:id/dias-livres', async (req, res) => {
  res.json(await diasLivres(String(req.params.id)));
});

// Médico (ou recepção) informa atraso: vale para as consultas de hoje ainda não finalizadas
pessoasRouter.post('/medicos/:id/atraso', permitir('MEDICO', 'RECEPCIONISTA', 'ADMIN'), async (req, res) => {
  const medicoId = String(req.params.id);
  if (req.usuario.tipo === 'MEDICO' && req.usuario.id !== medicoId) throw new HttpError(403, 'Você só informa atraso na sua própria agenda.');
  const { minutos: min } = validar(z.object({ minutos: z.number().int().min(0).max(600) }), req.body);
  const hoje = intervaloDia(hojeLocal());
  const afetadas = await q<{ id: number; paciente_id: string; data_hora: string }[]>(
    supabase
      .from('consultas')
      .update({ atraso_min: min })
      .eq('medico_id', medicoId)
      .gte('data_hora', hoje.de)
      .lt('data_hora', hoje.ate)
      .in('status', ['AGENDADA', 'CONFIRMADA', 'EM_ESPERA'])
      .select('id, paciente_id, data_hora'),
  );
  const medico = (await usuariosPorId([medicoId])).get(medicoId);
  for (const c of afetadas) {
    await notificar(
      c.paciente_id,
      min ? 'Atraso no atendimento' : 'Atendimento no horário',
      min
        ? `${medico?.nome ?? 'O médico'} está com cerca de ${min} min de atraso. Sua consulta das ${deBanco(c.data_hora)!.slice(11, 16)} deve começar mais tarde.`
        : `${medico?.nome ?? 'O médico'} voltou a atender no horário.`,
      '/fila',
    );
  }
  await auditar(req.usuario.id, 'medicos', medicoId, 'INFORMOU_ATRASO', { minutos: min, afetadas: afetadas.length });
  emitir('fila');
  res.json({ afetadas: afetadas.length });
});

pessoasRouter.post('/medicos/:id/verificar-crm', permitir('ADMIN'), async (req, res) => {
  const { verificado } = validar(z.object({ verificado: z.boolean() }), req.body);
  const r = await q<unknown[]>(supabase.from('medicos').update({ crm_verificado: verificado }).eq('usuario_id', String(req.params.id)).select('usuario_id'));
  if (!r.length) throw new HttpError(404, 'Médico não encontrado.');
  await auditar(req.usuario.id, 'medicos', String(req.params.id), verificado ? 'VERIFICOU_CRM' : 'DESMARCOU_CRM');
  res.json({ ok: true });
});

/* ------------------------------ notificações ------------------------------ */

pessoasRouter.get('/notificacoes', async (req, res) => {
  const rows = await q<any[]>(supabase.from('notificacoes').select('*').eq('usuario_id', req.usuario.id).order('id', { ascending: false }).limit(50));
  res.json(rows.map((n) => ({ id: n.id, titulo: n.titulo, mensagem: n.mensagem, link: n.link ?? null, lida: n.lida ? 1 : 0, criado_em: deBanco(n.criado_em) })));
});

pessoasRouter.post('/notificacoes/lidas', async (req, res) => {
  await q(supabase.from('notificacoes').update({ lida: true }).eq('usuario_id', req.usuario.id).eq('lida', false));
  res.json({ ok: true });
});

pessoasRouter.post('/notificacoes/:id/lida', async (req, res) => {
  await q(supabase.from('notificacoes').update({ lida: true }).eq('id', idDe(String(req.params.id))).eq('usuario_id', req.usuario.id));
  res.json({ ok: true });
});

export { medicosPorId, pacientesPorId };
