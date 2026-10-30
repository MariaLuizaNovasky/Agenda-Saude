import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { conferirSenha, supabase } from '../supabase.js';
import { auditar, cpfValido, HttpError, notificar, validar } from '../util.js';
import { autenticar } from '../auth.js';
import { criarConta, cpfEmUso, emailEmUso } from '../contas.js';
import { q } from '../dados.js';

export const authRouter = Router();

export const senhaForte = z
  .string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
  .regex(/[A-Za-z]/, 'A senha precisa ter letras.')
  .regex(/\d/, 'A senha precisa ter números.');

export const hashSenha = (s: string) => bcrypt.hashSync(s, 10);

// Dados completos do usuário logado, no formato que o frontend espera
async function dadosUsuario(id: string) {
  const { data: u, error } = await supabase
    .from('usuarios')
    .select('id, nome, email, telefone, tipo, troca_senha_obrigatoria')
    .eq('id', id)
    .maybeSingle();
  if (error || !u) return null;

  const [{ data: p }, { data: m }] = await Promise.all([
    supabase.from('pacientes').select('cpf, data_nascimento, convenio_id, numero_carteirinha').eq('usuario_id', id).maybeSingle(),
    supabase.from('medicos').select('crm, crm_uf, crm_verificado').eq('usuario_id', id).maybeSingle(),
  ]);
  let convenio_nome: string | null = null;
  if (p?.convenio_id) {
    const { data: c } = await supabase.from('convenios').select('nome').eq('id', p.convenio_id).maybeSingle();
    convenio_nome = c?.nome ?? null;
  }
  return {
    ...u,
    troca_senha_obrigatoria: !!u.troca_senha_obrigatoria,
    cpf: p?.cpf ?? null,
    data_nascimento: p?.data_nascimento ?? null,
    convenio_id: p?.convenio_id ?? null,
    convenio_nome,
    numero_carteirinha: p?.numero_carteirinha ?? null,
    crm: m?.crm ?? null,
    crm_uf: m?.crm_uf ?? null,
    crm_verificado: m ? (m.crm_verificado ? 1 : 0) : null,
  };
}

// Rota de Login integrada com Supabase Auth
authRouter.post('/login', async (req, res) => {
  const { email, senha } = validar(
    z.object({
      email: z.string().trim().email('E-mail inválido.'),
      senha: z.string().min(1, 'Informe a senha.'),
    }),
    req.body,
  );

  const { usuarioAuth, error: authError } = await conferirSenha(email.toLowerCase(), senha);

  if (authError || !usuarioAuth) {
    console.error('[login] Supabase Auth recusou:', authError?.message);
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }

  const { data: usuario, error: userError } = await supabase
    .from('usuarios')
    .select('id, nome, tipo, ativo')
    .eq('id', usuarioAuth.id)
    .single();

  if (userError || !usuario) {
    console.error('[login] usuário existe no Auth mas não na tabela usuarios:', usuarioAuth.id, userError?.message);
    throw new HttpError(403, 'Dados do usuário não encontrados.');
  }

  if (!usuario.ativo) {
    throw new HttpError(403, 'Seu acesso está desativado. Fale com a administração da clínica.');
  }

  await auditar(usuario.id, 'usuarios', usuario.id, 'LOGIN');
  const usuarioCompleto = await dadosUsuario(usuario.id);

  const tokenPayload = {
    id: usuario.id,
    tipo: usuario.tipo,
    nome: usuario.nome,
  };

  const token = jwt.sign(tokenPayload, config.jwtSecret, { expiresIn: '7d' });

  res.json({
    token,
    usuario: usuarioCompleto,
  });
});

// Dados do usuário logado (usado ao recarregar a página)
authRouter.get('/me', autenticar, async (req, res) => {
  const u = await dadosUsuario(req.usuario.id);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  res.json(u);
});

// Autocadastro do paciente
authRouter.post('/cadastro', async (req, res) => {
  const d = validar(
    z.object({
      nome: z.string().trim().min(3, 'Informe o nome completo.'),
      email: z.string().email('Informe um e-mail válido.'),
      senha: senhaForte,
      telefone: z.string().trim().min(10, 'Informe um telefone com DDD.'),
      cpf: z.string().refine(cpfValido, 'CPF inválido.'),
      data_nascimento: z.string().min(10, 'Informe a data de nascimento.'),
      convenio_id: z.number().int().positive().nullish(),
      numero_carteirinha: z.string().trim().nullish(),
    }),
    req.body,
  );

  if (d.convenio_id && !d.numero_carteirinha) {
    throw new HttpError(400, 'Informe o número da carteirinha do convênio.');
  }

  const cpf = d.cpf.replace(/\D/g, '');
  if (await cpfEmUso(cpf)) throw new HttpError(409, 'CPF já cadastrado.');
  if (await emailEmUso(d.email)) throw new HttpError(409, 'E-mail já cadastrado.');

  const userId = await criarConta(d.email, d.senha, async (id) => {
    await q(supabase.from('usuarios').insert([{ id, nome: d.nome, email: d.email.toLowerCase(), telefone: d.telefone, tipo: 'PACIENTE' }]));
    await q(
      supabase.from('pacientes').insert([
        { usuario_id: id, cpf, data_nascimento: d.data_nascimento, convenio_id: d.convenio_id || null, numero_carteirinha: d.convenio_id ? d.numero_carteirinha : null },
      ]),
    );
    await q(supabase.from('prontuarios').insert([{ paciente_id: id }]));
  });
  await auditar(userId, 'usuarios', userId, 'CADASTRO_PACIENTE');

  res.status(201).json({ mensagem: 'Cadastro concluído. Entre com seu e-mail e senha.', id: userId });
});

// Recuperação de senha
authRouter.post('/recuperar-senha', async (req, res) => {
  const { email } = validar(z.object({ email: z.string().trim() }), req.body);
  
  const { data: u } = await supabase
    .from('usuarios')
    .select('id, nome')
    .ilike('email', email.toLowerCase())
    .eq('ativo', true)
    .maybeSingle();

  if (u) {
    await supabase.from('usuarios').update({ recuperacao_solicitada: true }).eq('id', u.id);
    
    const { data: admins } = await supabase
      .from('usuarios')
      .select('id')
      .eq('tipo', 'ADMIN')
      .eq('ativo', true);

    if (admins) {
      for (const a of admins) {
        await notificar(a.id, 'Pedido de nova senha', `${u.nome} pediu uma senha temporária.`, '/usuarios');
      }
    }
    await auditar(u.id, 'usuarios', u.id, 'PEDIU_RECUPERACAO_SENHA');
  }

  res.json({ mensagem: 'Se o e-mail estiver cadastrado, a administração vai gerar uma senha temporária e entrar em contato.' });
});

// Alterar senha
authRouter.post('/alterar-senha', autenticar, async (req, res) => {
  const d = validar(z.object({ senha_atual: z.string(), nova_senha: senhaForte }), req.body);
  
  if (d.senha_atual === d.nova_senha) {
    throw new HttpError(400, 'A nova senha precisa ser diferente da atual.');
  }
  const { data: eu } = await supabase.from('usuarios').select('email').eq('id', req.usuario.id).single();
  const { usuarioAuth } = await conferirSenha(String(eu?.email ?? ''), d.senha_atual);
  if (!usuarioAuth) throw new HttpError(400, 'A senha atual está incorreta.');

  const { error: updateError } = await supabase.auth.admin.updateUserById(req.usuario.id, {
    password: d.nova_senha,
  });

  if (updateError) {
    throw new HttpError(400, 'Erro ao atualizar a senha.');
  }

  await supabase
    .from('usuarios')
    .update({ troca_senha_obrigatoria: false })
    .eq('id', req.usuario.id);

  await auditar(req.usuario.id, 'usuarios', req.usuario.id, 'ALTEROU_SENHA');
  const usuarioAtualizado = await dadosUsuario(String(req.usuario.id));

  res.json({ mensagem: 'Senha alterada.', usuario: usuarioAtualizado });
});

// Editar Perfil
authRouter.put('/perfil', autenticar, async (req, res) => {
  const d = validar(
    z.object({
      nome: z.string().trim().min(3, 'Informe o nome completo.'),
      telefone: z.string().trim().min(10, 'Informe um telefone com DDD.'),
      data_nascimento: z.string().optional(),
    }).strict(),
    req.body,
  );

  if (d.data_nascimento && req.usuario.tipo !== 'PACIENTE') {
    throw new HttpError(403, 'Seu perfil não pode alterar a data de nascimento.');
  }

  await supabase
    .from('usuarios')
    .update({ nome: d.nome, telefone: d.telefone })
    .eq('id', req.usuario.id);

  if (d.data_nascimento) {
    await supabase
      .from('pacientes')
      .update({ data_nascimento: d.data_nascimento })
      .eq('usuario_id', req.usuario.id);
  }

  await auditar(req.usuario.id, 'usuarios', req.usuario.id, 'EDITOU_DADOS');
  const usuarioAtualizado = await dadosUsuario(String(req.usuario.id));

  res.json(usuarioAtualizado);
});

export { dadosUsuario };