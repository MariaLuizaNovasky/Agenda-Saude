import { Router } from 'express';
import { z } from 'zod';
import { autenticar, permitir, type Perfil } from '../auth.js';
import { criarConta, emailEmUso } from '../contas.js';
import { especialidadesDosMedicos, medicosPorId, q, usuariosPorId } from '../dados.js';
import { supabase } from '../supabase.js';
import { deBanco, ehData, intervaloDia, somarDias } from '../tempo.js';
import { auditar, crmFormatoValido, HttpError, UFS, validar } from '../util.js';

export const adminRouter = Router();
/** Catálogo público (leitura sem login: a tela de cadastro do paciente usa os convênios). */
export const catalogoRouter = Router();

const idNumerico = (v: unknown) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID inválido.');
  return id;
};

const somenteAdmin = [autenticar, permitir('ADMIN')];

// --- ESPECIALIDADES ---
catalogoRouter.get('/especialidades', async (_req, res) => {
  const { data, error } = await supabase
    .from('especialidades')
    .select('id, nome, medico_especialidade(count)')
    .order('nome');
  if (error) throw new HttpError(500, `Erro ao listar especialidades: ${error.message}`);

  res.json(
    (data ?? []).map((e: any) => ({
      id: e.id,
      nome: e.nome,
      total_medicos: e.medico_especialidade?.[0]?.count ?? 0,
    })),
  );
});

const esquemaEsp = z.object({ nome: z.string().trim().min(2, 'Informe o nome da especialidade.') });

catalogoRouter.post('/especialidades', ...somenteAdmin, async (req, res) => {
  const { nome } = validar(esquemaEsp, req.body);
  const { data, error } = await supabase.from('especialidades').insert([{ nome }]).select().single();
  if (error) throw new HttpError(400, error.code === '23505' ? 'Essa especialidade já existe.' : error.message);
  await auditar(req.usuario.id, 'especialidades', data.id, 'CRIOU_ESPECIALIDADE', { nome });
  res.status(201).json(data);
});

catalogoRouter.put('/especialidades/:id', ...somenteAdmin, async (req, res) => {
  const id = idNumerico(String(req.params.id));
  const { nome } = validar(esquemaEsp, req.body);
  const { data, error } = await supabase.from('especialidades').update({ nome }).eq('id', id).select().single();
  if (error || !data) throw new HttpError(400, error?.message ?? 'Especialidade não encontrada.');
  await auditar(req.usuario.id, 'especialidades', id, 'RENOMEOU_ESPECIALIDADE', { nome });
  res.json(data);
});

catalogoRouter.delete('/especialidades/:id', ...somenteAdmin, async (req, res) => {
  const id = idNumerico(String(req.params.id));
  const { error } = await supabase.from('especialidades').delete().eq('id', id);
  if (error) {
    throw new HttpError(400, error.code === '23503' ? 'Há médicos ou pedidos ligados a essa especialidade.' : error.message);
  }
  await auditar(req.usuario.id, 'especialidades', id, 'EXCLUIU_ESPECIALIDADE');
  res.json({ mensagem: 'Especialidade excluída.' });
});

// --- CONVÊNIOS ---
catalogoRouter.get('/convenios', async (_req, res) => {
  const { data, error } = await supabase.from('convenios').select('id, nome, registro_ans').order('nome');
  if (error) throw new HttpError(500, `Erro ao listar convênios: ${error.message}`);
  res.json(data ?? []);
});

const esquemaConv = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do convênio.'),
  registro_ans: z
    .string()
    .trim()
    .regex(/^(\d{6})?$/, 'O registro ANS tem 6 dígitos.')
    .nullish()
    .transform((v) => v || null),
});

catalogoRouter.post('/convenios', ...somenteAdmin, async (req, res) => {
  const d = validar(esquemaConv, req.body);
  const { data, error } = await supabase.from('convenios').insert([d]).select().single();
  if (error) throw new HttpError(400, error.code === '23505' ? 'Esse convênio já existe.' : error.message);
  await auditar(req.usuario.id, 'convenios', data.id, 'CRIOU_CONVENIO', d);
  res.status(201).json(data);
});

catalogoRouter.put('/convenios/:id', ...somenteAdmin, async (req, res) => {
  const id = idNumerico(String(req.params.id));
  const d = validar(esquemaConv, req.body);
  const { data, error } = await supabase.from('convenios').update(d).eq('id', id).select().single();
  if (error || !data) throw new HttpError(400, error?.message ?? 'Convênio não encontrado.');
  await auditar(req.usuario.id, 'convenios', id, 'EDITOU_CONVENIO', d);
  res.json(data);
});

catalogoRouter.delete('/convenios/:id', ...somenteAdmin, async (req, res) => {
  const id = idNumerico(String(req.params.id));
  const { error } = await supabase.from('convenios').delete().eq('id', id);
  if (error) throw new HttpError(400, error.code === '23503' ? 'Há pacientes ou boletos ligados a esse convênio.' : error.message);
  await auditar(req.usuario.id, 'convenios', id, 'EXCLUIU_CONVENIO');
  res.json({ mensagem: 'Convênio excluído.' });
});

/* -------------------------------- usuários -------------------------------- */

const bin = (v: unknown) => (v ? 1 : 0);

adminRouter.get('/usuarios', permitir('ADMIN'), async (req, res) => {
  const { tipo, busca, recuperacao } = req.query as Record<string, string | undefined>;
  let b = supabase.from('usuarios').select('*');
  if (tipo) b = b.eq('tipo', tipo);
  if (recuperacao) b = b.eq('recuperacao_solicitada', true);
  let rows = await q<any[]>(b.order('nome'));
  if (busca) {
    const t = busca.trim().toLowerCase();
    rows = rows.filter((u) => u.nome.toLowerCase().includes(t) || u.email.toLowerCase().includes(t));
  }
  const medIds = rows.filter((u) => u.tipo === 'MEDICO').map((u) => u.id);
  const [medicos, esps] = await Promise.all([medicosPorId(medIds), especialidadesDosMedicos(medIds)]);
  res.json(
    rows.map((u) => {
      const m = medicos.get(u.id);
      return {
        id: u.id,
        nome: u.nome,
        email: u.email,
        telefone: u.telefone ?? null,
        tipo: u.tipo,
        ativo: bin(u.ativo),
        troca_senha_obrigatoria: bin(u.troca_senha_obrigatoria),
        recuperacao_solicitada: bin(u.recuperacao_solicitada),
        crm: m?.crm ?? null,
        crm_uf: m?.crm_uf ?? null,
        crm_verificado: m ? bin(m.crm_verificado) : null,
        especialidade_ids: (esps.get(u.id) ?? []).map((e) => e.id).join(',') || null,
      };
    }),
  );
});

const PERFIS_EQUIPE = ['RECEPCIONISTA', 'MEDICO', 'ADMIN', 'FINANCEIRO', 'LABORATORIO', 'FARMACIA'] as const;
const camposMedico = {
  crm: z.string().trim().optional(),
  crm_uf: z.string().trim().toUpperCase().optional(),
  especialidade_ids: z.array(z.number().int().positive()).optional(),
};

function validarMedico(d: { crm?: string; crm_uf?: string; especialidade_ids?: number[] }) {
  if (!d.crm || !/^\d{4,7}$/.test(d.crm) || !crmFormatoValido(d.crm)) throw new HttpError(400, 'CRM inválido: use de 4 a 7 dígitos.');
  if (!d.crm_uf || !(UFS as readonly string[]).includes(d.crm_uf)) throw new HttpError(400, 'UF do CRM inválida.');
  if (!d.especialidade_ids?.length) throw new HttpError(400, 'Escolha ao menos uma especialidade.');
  return { crm: d.crm, crm_uf: d.crm_uf, especialidade_ids: d.especialidade_ids };
}

async function crmEmUso(crm: string, uf: string, ignorarId?: string) {
  let b = supabase.from('medicos').select('usuario_id').eq('crm', crm).eq('crm_uf', uf);
  if (ignorarId) b = b.neq('usuario_id', ignorarId);
  return (await q<unknown[]>(b)).length > 0;
}

async function gravarEspecialidades(medicoId: string, ids: number[]) {
  await q(supabase.from('medico_especialidade').delete().eq('medico_id', medicoId));
  await q(supabase.from('medico_especialidade').insert(ids.map((especialidade_id) => ({ medico_id: medicoId, especialidade_id }))));
}

adminRouter.post('/usuarios', permitir('ADMIN'), async (req, res) => {
  const d = validar(
    z.object({
      nome: z.string().trim().min(3, 'Informe o nome completo.'),
      email: z.string().trim().email('Informe um e-mail válido.'),
      telefone: z.string().trim().nullish(),
      tipo: z.enum(PERFIS_EQUIPE, { message: 'Perfil inválido. Pacientes são cadastrados pela recepção.' }),
      senha_temporaria: z.string().min(8, 'A senha temporária precisa ter pelo menos 8 caracteres.'),
      ...camposMedico,
    }),
    req.body,
  );
  const med = d.tipo === 'MEDICO' ? validarMedico(d) : null;
  if (med && (await crmEmUso(med.crm, med.crm_uf))) throw new HttpError(409, 'Este CRM já está cadastrado nessa UF.');
  if (await emailEmUso(d.email)) throw new HttpError(409, 'E-mail já cadastrado.');

  const id = await criarConta(d.email, d.senha_temporaria, async (id) => {
    await q(supabase.from('usuarios').insert([{ id, nome: d.nome, email: d.email.toLowerCase(), telefone: d.telefone || null, tipo: d.tipo, troca_senha_obrigatoria: true }]));
    if (med) {
      await q(supabase.from('medicos').insert([{ usuario_id: id, crm: med.crm, crm_uf: med.crm_uf, crm_verificado: false }]));
      await gravarEspecialidades(id, med.especialidade_ids);
    }
  });
  await auditar(req.usuario.id, 'usuarios', id, 'CRIOU_USUARIO', { tipo: d.tipo });
  res.status(201).json({ id });
});

adminRouter.put('/usuarios/:id', permitir('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const d = validar(
    z.object({
      nome: z.string().trim().min(3, 'Informe o nome completo.'),
      telefone: z.string().trim().nullish(),
      tipo: z.enum(['PACIENTE', ...PERFIS_EQUIPE]),
      ativo: z.boolean(),
      ...camposMedico,
    }),
    req.body,
  );
  const atual = await q<any>(supabase.from('usuarios').select('*').eq('id', id).maybeSingle());
  if (!atual) throw new HttpError(404, 'Usuário não encontrado.');
  if (id === req.usuario.id && (!d.ativo || d.tipo !== 'ADMIN')) throw new HttpError(400, 'Você não pode desativar nem rebaixar o próprio acesso.');
  const fixos: Perfil[] = ['PACIENTE', 'MEDICO'];
  if (d.tipo !== atual.tipo && (fixos.includes(atual.tipo) || fixos.includes(d.tipo))) {
    throw new HttpError(400, 'Pacientes e médicos não mudam de perfil. Crie um novo usuário.');
  }

  if (atual.tipo === 'MEDICO' && (d.crm || d.crm_uf || d.especialidade_ids)) {
    const med = validarMedico(d);
    if (await crmEmUso(med.crm, med.crm_uf, id)) throw new HttpError(409, 'Este CRM já está cadastrado nessa UF.');
    await q(supabase.from('medicos').update({ crm: med.crm, crm_uf: med.crm_uf }).eq('usuario_id', id));
    await gravarEspecialidades(id, med.especialidade_ids);
  }
  await q(supabase.from('usuarios').update({ nome: d.nome, telefone: d.telefone || null, tipo: d.tipo, ativo: d.ativo }).eq('id', id));
  await auditar(req.usuario.id, 'usuarios', id, atual.ativo && !d.ativo ? 'DESATIVOU_USUARIO' : 'EDITOU_USUARIO', { tipo: d.tipo, ativo: d.ativo });
  res.json({ ok: true });
});

adminRouter.post('/usuarios/:id/senha-temporaria', permitir('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const { senha } = validar(
    z.object({ senha: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').regex(/[A-Za-z]/, 'A senha precisa ter letras.').regex(/\d/, 'A senha precisa ter números.') }),
    req.body,
  );
  const atual = await q<any>(supabase.from('usuarios').select('id').eq('id', id).maybeSingle());
  if (!atual) throw new HttpError(404, 'Usuário não encontrado.');
  const { error } = await supabase.auth.admin.updateUserById(id, { password: senha });
  if (error) throw new HttpError(400, `Não foi possível trocar a senha: ${error.message}`);
  await q(supabase.from('usuarios').update({ troca_senha_obrigatoria: true, recuperacao_solicitada: false }).eq('id', id));
  await auditar(req.usuario.id, 'usuarios', id, 'GEROU_SENHA_TEMPORARIA');
  res.json({ ok: true });
});

/* ------------------------------- relatórios ------------------------------- */

adminRouter.get('/relatorios/consultas', permitir('ADMIN'), async (req, res) => {
  const hoje = new Date().toISOString().slice(0, 10);
  const inicio = ehData(req.query.inicio) ? req.query.inicio : somarDias(hoje, -30);
  const fim = ehData(req.query.fim) ? req.query.fim : hoje;
  const rows = await q<any[]>(
    supabase
      .from('consultas')
      .select('medico_id, tipo, status, check_in_em, iniciada_em')
      .gte('data_hora', intervaloDia(inicio).de)
      .lt('data_hora', intervaloDia(fim).ate),
  );
  const nomes = await usuariosPorId(rows.map((r) => r.medico_id));
  const porMedico = new Map<string, any>();
  for (const c of rows) {
    if (!porMedico.has(c.medico_id)) {
      porMedico.set(c.medico_id, { medico_nome: nomes.get(c.medico_id)?.nome ?? '', total: 0, finalizadas: 0, canceladas: 0, faltas: 0, encaixes: 0, retornos: 0, esperas: [] as number[] });
    }
    const l = porMedico.get(c.medico_id);
    l.total++;
    if (c.status === 'FINALIZADA') l.finalizadas++;
    if (c.status === 'CANCELADA') l.canceladas++;
    if (c.status === 'FALTOU') l.faltas++;
    if (c.tipo === 'ENCAIXE') l.encaixes++;
    if (c.tipo === 'RETORNO') l.retornos++;
    if (c.check_in_em && c.iniciada_em) {
      const m = (new Date(c.iniciada_em).getTime() - new Date(c.check_in_em).getTime()) / 60000;
      if (m >= 0) l.esperas.push(m);
    }
  }
  res.json(
    [...porMedico.values()]
      .map(({ esperas, ...l }) => ({ ...l, espera_media_min: esperas.length ? Math.round(esperas.reduce((a: number, b: number) => a + b, 0) / esperas.length) : null }))
      .sort((a, b) => b.total - a.total),
  );
});

adminRouter.get('/relatorios/log', permitir('ADMIN'), async (req, res) => {
  let b = supabase.from('log_alteracoes').select('*');
  if (req.query.entidade) b = b.eq('entidade', String(req.query.entidade));
  const rows = await q<any[]>(b.order('id', { ascending: false }).limit(500));
  const usuarios = await usuariosPorId(rows.map((l) => l.usuario_id));
  res.json(
    rows.map((l) => ({
      id: l.id,
      usuario_nome: usuarios.get(l.usuario_id)?.nome ?? null,
      usuario_tipo: usuarios.get(l.usuario_id)?.tipo ?? null,
      entidade: l.entidade,
      registro_id: l.registro_id ?? null,
      acao: l.acao,
      detalhes: l.detalhes == null ? null : typeof l.detalhes === 'string' ? l.detalhes : JSON.stringify(l.detalhes),
      data_hora: deBanco(l.data_hora ?? l.criado_em ?? null),
    })),
  );
});
