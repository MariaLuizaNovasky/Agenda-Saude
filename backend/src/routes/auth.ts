import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { autenticar, gerarToken, type Perfil } from '../auth.js';
import { all, one, run, transacao } from '../db.js';
import { auditar, cpfValido, HttpError, notificar, validar } from '../util.js';

export const authRouter = Router();

const senhaForte = z
  .string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
  .regex(/[A-Za-z]/, 'A senha precisa ter letras.')
  .regex(/\d/, 'A senha precisa ter números.');

export const hashSenha = (s: string) => bcrypt.hashSync(s, 10);

function dadosUsuario(id: number) {
  const u = one(
    `SELECT u.id, u.nome, u.email, u.telefone, u.tipo, u.troca_senha_obrigatoria,
            p.cpf, p.data_nascimento, p.convenio_id, p.numero_carteirinha, c.nome AS convenio_nome,
            m.crm, m.crm_uf, m.crm_verificado
     FROM usuarios u
     LEFT JOIN pacientes p ON p.usuario_id = u.id
     LEFT JOIN convenios c ON c.id = p.convenio_id
     LEFT JOIN medicos m ON m.usuario_id = u.id
     WHERE u.id = ?`,
    id,
  );
  if (u) u.troca_senha_obrigatoria = !!u.troca_senha_obrigatoria;
  return u;
}

// Usuario.login(email, senha)
authRouter.post('/login', (req, res) => {
  const { email, senha } = validar(z.object({ email: z.string().trim(), senha: z.string() }), req.body);
  const u = one<{ id: number; nome: string; tipo: Perfil; senha_hash: string; ativo: number }>(
    'SELECT id, nome, tipo, senha_hash, ativo FROM usuarios WHERE email = ?',
    email,
  );
  if (!u || !bcrypt.compareSync(senha, u.senha_hash)) throw new HttpError(401, 'E-mail ou senha incorretos.');
  if (!u.ativo) throw new HttpError(403, 'Seu acesso está desativado. Fale com a administração da clínica.');
  auditar(u.id, 'usuarios', u.id, 'LOGIN');
  res.json({ token: gerarToken({ id: u.id, nome: u.nome, tipo: u.tipo }), usuario: dadosUsuario(u.id) });
});

// Autocadastro do paciente (a equipe é criada pelo administrador)
authRouter.post('/cadastro', (req, res) => {
  const d = validar(
    z.object({
      nome: z.string().trim().min(3, 'Informe o nome completo.'),
      email: z.email('Informe um e-mail válido.'),
      senha: senhaForte,
      telefone: z.string().trim().min(10, 'Informe um telefone com DDD.'),
      cpf: z.string().refine(cpfValido, 'CPF inválido.'),
      data_nascimento: z.iso.date('Informe a data de nascimento.'),
      convenio_id: z.number().int().positive().nullish(),
      numero_carteirinha: z.string().trim().nullish(),
    }),
    req.body,
  );
  if (d.convenio_id && !d.numero_carteirinha) throw new HttpError(400, 'Informe o número da carteirinha do convênio.');
  const id = transacao(() => {
    const { id } = run(
      "INSERT INTO usuarios (nome, email, senha_hash, telefone, tipo) VALUES (?,?,?,?,'PACIENTE')",
      d.nome, d.email.toLowerCase(), hashSenha(d.senha), d.telefone,
    );
    run(
      'INSERT INTO pacientes (usuario_id, cpf, data_nascimento, convenio_id, numero_carteirinha) VALUES (?,?,?,?,?)',
      id, d.cpf.replace(/\D/g, ''), d.data_nascimento, d.convenio_id, d.convenio_id ? d.numero_carteirinha : null,
    );
    run('INSERT INTO prontuarios (paciente_id) VALUES (?)', id);
    auditar(id, 'usuarios', id, 'CADASTRO_PACIENTE');
    return id;
  });
  res.status(201).json({ mensagem: 'Cadastro concluído. Entre com seu e-mail e senha.', id });
});

// Recuperação de senha: o pedido é encaminhado ao administrador (TAP, objetivo 6)
authRouter.post('/recuperar-senha', (req, res) => {
  const { email } = validar(z.object({ email: z.string().trim() }), req.body);
  const u = one<{ id: number; nome: string }>('SELECT id, nome FROM usuarios WHERE email = ? AND ativo = 1', email);
  if (u) {
    run('UPDATE usuarios SET recuperacao_solicitada = 1 WHERE id = ?', u.id);
    for (const a of all<{ id: number }>("SELECT id FROM usuarios WHERE tipo = 'ADMIN' AND ativo = 1")) {
      notificar(a.id, 'Pedido de nova senha', `${u.nome} pediu uma senha temporária.`, '/usuarios');
    }
    auditar(u.id, 'usuarios', u.id, 'PEDIU_RECUPERACAO_SENHA');
  }
  // resposta igual em qualquer caso, para não revelar quais e-mails existem
  res.json({ mensagem: 'Se o e-mail estiver cadastrado, a administração vai gerar uma senha temporária e entrar em contato.' });
});

authRouter.get('/me', autenticar, (req, res) => {
  res.json(dadosUsuario(req.usuario.id));
});

// Usuario.alterarSenha(nova)
authRouter.post('/alterar-senha', autenticar, (req, res) => {
  const d = validar(z.object({ senha_atual: z.string(), nova_senha: senhaForte }), req.body);
  const u = one<{ senha_hash: string }>('SELECT senha_hash FROM usuarios WHERE id = ?', req.usuario.id)!;
  if (!bcrypt.compareSync(d.senha_atual, u.senha_hash)) throw new HttpError(400, 'A senha atual está incorreta.');
  if (d.senha_atual === d.nova_senha) throw new HttpError(400, 'A nova senha precisa ser diferente da atual.');
  run('UPDATE usuarios SET senha_hash = ?, troca_senha_obrigatoria = 0 WHERE id = ?', hashSenha(d.nova_senha), req.usuario.id);
  auditar(req.usuario.id, 'usuarios', req.usuario.id, 'ALTEROU_SENHA');
  res.json({ mensagem: 'Senha alterada.', usuario: dadosUsuario(req.usuario.id) });
});

// Paciente.editarDados() e dados de contato da equipe
authRouter.put('/perfil', autenticar, (req, res) => {
  const d = validar(
    z.object({
      nome: z.string().trim().min(3, 'Informe o nome completo.'),
      telefone: z.string().trim().min(10, 'Informe um telefone com DDD.'),
      data_nascimento: z.iso.date('Informe uma data de nascimento válida.').optional(),
    }).strict(),
    req.body,
  );
  if (d.data_nascimento && req.usuario.tipo !== 'PACIENTE') throw new HttpError(403, 'Seu perfil não pode alterar a data de nascimento.');
  transacao(() => {
    run('UPDATE usuarios SET nome = ?, telefone = ? WHERE id = ?', d.nome, d.telefone, req.usuario.id);
    if (d.data_nascimento) {
      run('UPDATE pacientes SET data_nascimento = ? WHERE usuario_id = ?', d.data_nascimento, req.usuario.id);
    }
    auditar(req.usuario.id, 'usuarios', req.usuario.id, 'EDITOU_DADOS');
  });
  res.json(dadosUsuario(req.usuario.id));
});

export { senhaForte, dadosUsuario };
