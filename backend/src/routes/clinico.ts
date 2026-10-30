import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { permitir, RECEPCAO } from '../auth.js';
import { config } from '../config.js';
import { buscarConsulta, medicosPorId, pacientesPorId, prontuarioDe, q, usuariosPorId, type ConsultaLinha } from '../dados.js';
import { supabase } from '../supabase.js';
import { deBanco, hojeLocal, somarDias } from '../tempo.js';
import { auditar, HttpError, notificar, validar } from '../util.js';

export const clinicoRouter = Router();

const idDe = (v: unknown) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID inválido.');
  return id;
};
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Dados de paciente e médico de cada linha (exame ou documento), a partir do prontuário e da consulta. */
async function contexto(rows: { prontuario_id: number; consulta_id: number | null; medico_id?: string | null }[]) {
  const prontIds = [...new Set(rows.map((r) => r.prontuario_id))];
  const consIds = [...new Set(rows.map((r) => r.consulta_id).filter((x): x is number => !!x))];
  const [pronts, cons] = await Promise.all([
    prontIds.length ? q<{ id: number; paciente_id: string }[]>(supabase.from('prontuarios').select('id, paciente_id').in('id', prontIds)) : [],
    consIds.length ? q<{ id: number; medico_id: string }[]>(supabase.from('consultas').select('id, medico_id').in('id', consIds)) : [],
  ]);
  const pacDoPront = new Map(pronts.map((p) => [p.id, p.paciente_id]));
  const medDaCons = new Map(cons.map((c) => [c.id, c.medico_id]));
  const pacIds = pronts.map((p) => p.paciente_id);
  const medIds = [...cons.map((c) => c.medico_id), ...rows.map((r) => r.medico_id ?? null)];
  const [usuarios, pacientes, medicos] = await Promise.all([usuariosPorId([...pacIds, ...medIds]), pacientesPorId(pacIds), medicosPorId(medIds)]);
  return (r: { prontuario_id: number; consulta_id: number | null; medico_id?: string | null }) => {
    const pacienteId = pacDoPront.get(r.prontuario_id) ?? '';
    const medicoId = r.medico_id ?? (r.consulta_id ? medDaCons.get(r.consulta_id) : undefined) ?? null;
    return {
      paciente_id: pacienteId,
      paciente_nome: usuarios.get(pacienteId)?.nome ?? '',
      paciente_cpf: pacientes.get(pacienteId)?.cpf ?? '',
      medico_id: medicoId,
      medico_nome: medicoId ? usuarios.get(medicoId)?.nome ?? null : null,
      crm: medicoId ? medicos.get(medicoId)?.crm ?? null : null,
      crm_uf: medicoId ? medicos.get(medicoId)?.crm_uf ?? null : null,
    };
  };
}

/* ------------------------------- documentos ------------------------------- */

export async function listarDocumentos(filtro: { prontuario_id?: number; medico_id?: string; ids?: number[]; tipo?: string; disponiveis?: boolean }) {
  let b = supabase.from('documentos_medicos').select('*');
  if (filtro.prontuario_id) b = b.eq('prontuario_id', filtro.prontuario_id);
  if (filtro.medico_id) b = b.eq('medico_id', filtro.medico_id);
  if (filtro.ids) b = b.in('id', filtro.ids.length ? filtro.ids : [0]);
  if (filtro.tipo) b = b.eq('tipo', filtro.tipo);
  if (filtro.disponiveis) b = b.is('data_retirada', null);
  const rows = await q<any[]>(b.order('id', { ascending: false }).limit(500));
  const ctx = await contexto(rows);
  return rows.map((d) => {
    const c = ctx(d);
    return {
      id: d.id,
      consulta_id: d.consulta_id ?? null,
      tipo: d.tipo,
      conteudo: d.conteudo,
      data_emissao: deBanco(d.data_emissao),
      data_retirada: deBanco(d.data_retirada),
      paciente_id: c.paciente_id,
      paciente_nome: c.paciente_nome,
      paciente_cpf: c.paciente_cpf,
      medico_nome: c.medico_nome,
      crm: c.crm,
      crm_uf: c.crm_uf,
    };
  });
}

clinicoRouter.get('/documentos', permitir('PACIENTE', 'MEDICO', 'FARMACIA'), async (req, res) => {
  const u = req.usuario;
  const busca = String(req.query.busca ?? '').trim();

  if (u.tipo === 'FARMACIA') {
    if (!busca) return res.json(await listarDocumentos({ tipo: 'RECEITA', disponiveis: true }));
    const digitos = busca.replace(/\D/g, '');
    if (!digitos || digitos.length !== busca.replace(/[.\-\s/]/g, '').length) return res.json([]);
    if (digitos.length === 11) {
      const pacienteId = await pacientePorCpf(digitos);
      if (!pacienteId) return res.json([]);
      return res.json(await listarDocumentos({ prontuario_id: (await prontuarioDe(pacienteId)).id, tipo: 'RECEITA' }));
    }
    return res.json(await listarDocumentos({ ids: [Number(digitos)], tipo: 'RECEITA' }));
  }
  if (u.tipo === 'MEDICO') return res.json(await listarDocumentos({ medico_id: u.id }));
  const pront = await prontuarioDe(u.id);
  res.json(await listarDocumentos({ prontuario_id: pront.id }));
});

async function pacientePorCpf(cpf: string) {
  const p = await q<{ usuario_id: string } | null>(supabase.from('pacientes').select('usuario_id').eq('cpf', cpf).maybeSingle());
  return p?.usuario_id ?? null;
}

clinicoRouter.get('/documentos/:id', permitir('PACIENTE', 'MEDICO', 'FARMACIA'), async (req, res) => {
  const [doc] = await listarDocumentos({ ids: [idDe(String(req.params.id))] });
  if (!doc) throw new HttpError(404, 'Documento não encontrado.');
  const u = req.usuario;
  const pode =
    (u.tipo === 'FARMACIA' && doc.tipo === 'RECEITA') ||
    (u.tipo === 'PACIENTE' && doc.paciente_id === u.id) ||
    (u.tipo === 'MEDICO' && (await atende(u.id, doc.paciente_id)));
  if (!pode) throw new HttpError(403, 'Acesso não autorizado a este documento.');
  res.json(doc);
});

async function atende(medicoId: string, pacienteId: string) {
  return (await q<unknown[]>(supabase.from('consultas').select('id').eq('medico_id', medicoId).eq('paciente_id', pacienteId).limit(1))).length > 0;
}

/** Consulta em que o médico pode emitir documento ou pedir exame. */
async function consultaDoMedico(medicoId: string, consultaId: number) {
  const c = await buscarConsulta(consultaId);
  if (c.medico_id !== medicoId) throw new HttpError(403, 'Esta consulta é de outro médico.');
  if (!['EM_ATENDIMENTO', 'FINALIZADA'].includes(c.status)) throw new HttpError(400, 'Só é possível durante ou depois do atendimento.');
  return c as ConsultaLinha;
}

clinicoRouter.post('/documentos', permitir('MEDICO'), async (req, res) => {
  const d = validar(
    z.object({
      consulta_id: z.number().int().positive(),
      tipo: z.enum(['RECEITA', 'ATESTADO']),
      conteudo: z.string().trim().min(5, 'Escreva o conteúdo do documento.').max(5000, 'Documento muito longo.'),
    }),
    req.body,
  );
  const c = await consultaDoMedico(req.usuario.id, d.consulta_id);
  const pront = await prontuarioDe(c.paciente_id);
  const novo = await q<{ id: number }>(
    supabase.from('documentos_medicos').insert([{ prontuario_id: pront.id, consulta_id: c.id, medico_id: req.usuario.id, tipo: d.tipo, conteudo: d.conteudo }]).select('id').single(),
  );
  await auditar(req.usuario.id, 'documentos_medicos', novo.id, 'EMITIU', { tipo: d.tipo, consulta_id: c.id });
  await notificar(c.paciente_id, d.tipo === 'RECEITA' ? 'Nova receita' : 'Novo atestado', `${req.usuario.nome} emitiu ${d.tipo === 'RECEITA' ? 'uma receita' : 'um atestado'} para você.`, '/historico');
  const [doc] = await listarDocumentos({ ids: [novo.id] });
  res.status(201).json(doc);
});

clinicoRouter.post('/documentos/:id/retirada', permitir('FARMACIA'), async (req, res) => {
  const id = idDe(String(req.params.id));
  const doc = await q<any>(supabase.from('documentos_medicos').select('id, tipo, data_retirada').eq('id', id).eq('tipo', 'RECEITA').maybeSingle());
  if (!doc) throw new HttpError(404, 'Receita não encontrada.');
  if (doc.data_retirada) throw new HttpError(409, 'Esta receita já foi retirada.');
  const r = await q<unknown[]>(supabase.from('documentos_medicos').update({ data_retirada: hojeLocal() }).eq('id', id).is('data_retirada', null).select('id'));
  if (!r.length) throw new HttpError(409, 'Esta receita já foi retirada.');
  await auditar(req.usuario.id, 'documentos_medicos', id, 'REGISTROU_RETIRADA');
  res.json({ ok: true });
});

/* ---------------------------------- exames ---------------------------------- */

export async function listarExames(filtro: { prontuario_id?: number; consulta_ids?: number[]; ids?: number[]; status?: string[] }) {
  let b = supabase.from('exames').select('*');
  if (filtro.prontuario_id) b = b.eq('prontuario_id', filtro.prontuario_id);
  if (filtro.consulta_ids) b = b.in('consulta_id', filtro.consulta_ids.length ? filtro.consulta_ids : [0]);
  if (filtro.ids) b = b.in('id', filtro.ids.length ? filtro.ids : [0]);
  if (filtro.status?.length) b = b.in('status', filtro.status);
  const rows = await q<any[]>(b.order('id', { ascending: false }).limit(500));
  const ctx = await contexto(rows);
  return rows.map((e) => {
    const c = ctx(e);
    return {
      id: e.id,
      prontuario_id: e.prontuario_id,
      consulta_id: e.consulta_id,
      tipo: e.tipo,
      status: e.status,
      data_solicitacao: e.data_solicitacao,
      data_resultado: e.data_resultado ?? null,
      arquivo_resultado: e.arquivo_resultado ? 'sim' : null, // o caminho no servidor não sai da API
      arquivo_nome: e.arquivo_nome ?? null,
      prazo_retorno_dias: e.prazo_retorno_dias ?? null,
      // não há coluna própria: o prazo conta a partir do resultado
      data_limite_retorno: e.data_resultado && e.prazo_retorno_dias ? somarDias(e.data_resultado, e.prazo_retorno_dias) : null,
      paciente_id: c.paciente_id,
      paciente_nome: c.paciente_nome,
      paciente_cpf: c.paciente_cpf,
      medico_id: c.medico_id,
      medico_nome: c.medico_nome ?? '',
    };
  });
}

async function consultasDoMedico(medicoId: string) {
  return (await q<{ id: number }[]>(supabase.from('consultas').select('id').eq('medico_id', medicoId))).map((c) => c.id);
}

clinicoRouter.get('/exames', permitir('PACIENTE', 'MEDICO', 'LABORATORIO'), async (req, res) => {
  const u = req.usuario;
  const status = String(req.query.status ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const busca = String(req.query.busca ?? '').trim().toLowerCase();
  let lista;
  if (u.tipo === 'PACIENTE') lista = await listarExames({ prontuario_id: (await prontuarioDe(u.id)).id, status });
  else if (u.tipo === 'MEDICO') lista = await listarExames({ consulta_ids: await consultasDoMedico(u.id), status });
  else lista = await listarExames({ status });
  if (busca) {
    const dig = busca.replace(/\D/g, '');
    lista = lista.filter((e) => e.paciente_nome.toLowerCase().includes(busca) || e.tipo.toLowerCase().includes(busca) || (dig.length >= 3 && e.paciente_cpf.includes(dig)));
  }
  res.json(lista);
});

clinicoRouter.post('/exames', permitir('MEDICO'), async (req, res) => {
  const d = validar(
    z.object({
      consulta_id: z.number().int().positive(),
      tipo: z.string().trim().min(2, 'Informe o exame.'),
      prazo_retorno_dias: z.number().int().min(1).max(365).nullish(),
    }),
    req.body,
  );
  const c = await consultaDoMedico(req.usuario.id, d.consulta_id);
  const pront = await prontuarioDe(c.paciente_id);
  const novo = await q<{ id: number }>(
    supabase
      .from('exames')
      .insert([{ prontuario_id: pront.id, consulta_id: c.id, tipo: d.tipo, status: 'SOLICITADO', data_solicitacao: hojeLocal(), prazo_retorno_dias: d.prazo_retorno_dias ?? null }])
      .select('id')
      .single(),
  );
  await auditar(req.usuario.id, 'exames', novo.id, 'PEDIU_EXAME', { tipo: d.tipo });
  await notificar(c.paciente_id, 'Exame solicitado', `${req.usuario.nome} pediu o exame ${d.tipo}. Procure o laboratório.`, '/historico');
  const [exame] = await listarExames({ ids: [novo.id] });
  res.status(201).json(exame);
});

clinicoRouter.put('/exames/:id/status', permitir('LABORATORIO'), async (req, res) => {
  const id = idDe(String(req.params.id));
  validar(z.object({ status: z.literal('COLETADO', { message: 'Use o envio do resultado para concluir o exame.' }) }), req.body);
  const r = await q<unknown[]>(supabase.from('exames').update({ status: 'COLETADO' }).eq('id', id).eq('status', 'SOLICITADO').select('id'));
  if (!r.length) throw new HttpError(400, 'A coleta só pode ser registrada em exames solicitados.');
  await auditar(req.usuario.id, 'exames', id, 'REGISTROU_COLETA');
  const [exame] = await listarExames({ ids: [id] });
  res.json(exame);
});

const TIPOS_ARQUIVO: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const pastaExames = () => {
  const p = resolve(config.uploadsDir, 'exames');
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
  return p;
};

clinicoRouter.post('/exames/:id/resultado', permitir('LABORATORIO'), upload.single('arquivo'), async (req, res) => {
  const id = idDe(String(req.params.id));
  const arq = req.file;
  if (!arq) throw new HttpError(400, 'Anexe o arquivo do resultado.');
  const ext = extname(arq.originalname).toLowerCase();
  if (!TIPOS_ARQUIVO[ext]) throw new HttpError(400, 'Envie o resultado em PDF, PNG ou JPG.');

  const exame = await q<any>(supabase.from('exames').select('*').eq('id', id).maybeSingle());
  if (!exame) throw new HttpError(404, 'Exame não encontrado.');
  if (exame.status === 'CONCLUIDO') throw new HttpError(400, 'Este exame já tem resultado.');

  const nomeSalvo = `${id}-${randomBytes(8).toString('hex')}${ext}`;
  await writeFile(join(pastaExames(), nomeSalvo), arq.buffer);

  const hoje = hojeLocal();
  const limite = exame.prazo_retorno_dias ? somarDias(hoje, exame.prazo_retorno_dias) : null;
  // registra a coleta se o laboratório pulou essa etapa
  if (exame.status === 'SOLICITADO') await q(supabase.from('exames').update({ status: 'COLETADO' }).eq('id', id));
  await q(
    supabase
      .from('exames')
      .update({ status: 'CONCLUIDO', arquivo_resultado: nomeSalvo, arquivo_nome: arq.originalname, data_resultado: hoje })
      .eq('id', id),
  );
  await auditar(req.usuario.id, 'exames', id, 'ANEXOU_RESULTADO');

  const [e] = await listarExames({ ids: [id] });
  await notificar(
    e.paciente_id,
    'Resultado de exame',
    limite ? `O resultado de ${e.tipo} está pronto. Marque o retorno até ${dataBR(limite)}.` : `O resultado de ${e.tipo} está pronto.`,
    limite ? '/retornos' : '/historico',
  );
  if (e.medico_id) await notificar(e.medico_id, 'Resultado de exame', `${e.paciente_nome}: resultado de ${e.tipo} disponível.`, '/exames');
  res.json(e);
});

clinicoRouter.get('/exames/:id/arquivo', async (req, res) => {
  const id = idDe(String(req.params.id));
  const exame = await q<any>(supabase.from('exames').select('*').eq('id', id).maybeSingle());
  if (!exame) throw new HttpError(404, 'Exame não encontrado.');
  const [e] = await listarExames({ ids: [id] });
  const u = req.usuario;
  const pode =
    u.tipo === 'LABORATORIO' ||
    (u.tipo === 'PACIENTE' && e.paciente_id === u.id) ||
    (u.tipo === 'MEDICO' && (await atende(u.id, e.paciente_id)));
  if (!pode) throw new HttpError(403, 'Acesso não autorizado a este resultado.');
  if (!exame.arquivo_resultado) throw new HttpError(404, 'Este exame ainda não tem resultado.');
  const caminho = join(pastaExames(), String(exame.arquivo_resultado).replace(/[\\/]/g, ''));
  if (!existsSync(caminho)) throw new HttpError(404, 'Arquivo do resultado não encontrado no servidor.');
  res.download(caminho, exame.arquivo_nome ?? `resultado-exame-${id}${extname(caminho)}`);
});

/* --------------------------------- retornos --------------------------------- */

// Exames com resultado e prazo de retorno, enquanto o paciente não tiver um retorno marcado com o médico
clinicoRouter.get('/retornos', permitir('PACIENTE', 'MEDICO', ...RECEPCAO), async (req, res) => {
  const u = req.usuario;
  let exames = (await listarExames({ status: ['CONCLUIDO'] })).filter((e) => e.data_limite_retorno);
  if (u.tipo === 'PACIENTE') exames = exames.filter((e) => e.paciente_id === u.id);
  if (u.tipo === 'MEDICO') exames = exames.filter((e) => e.medico_id === u.id);
  if (!exames.length) return res.json([]);

  const retornos = await q<{ id: number; paciente_id: string; medico_id: string }[]>(
    supabase
      .from('consultas')
      .select('id, paciente_id, medico_id')
      .eq('tipo', 'RETORNO')
      .not('status', 'in', '(CANCELADA,FALTOU)')
      .in('paciente_id', [...new Set(exames.map((e) => e.paciente_id))]),
  );
  const pendentes = exames.filter((e) => !retornos.some((r) => r.paciente_id === e.paciente_id && r.medico_id === e.medico_id && r.id > e.consulta_id));
  pendentes.sort((a, b) => String(a.data_limite_retorno).localeCompare(String(b.data_limite_retorno)));
  res.json(pendentes);
});
