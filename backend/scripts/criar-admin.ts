/**
 * Cria (ou promove) uma conta de administrador.
 *
 *   npm run criar-admin -- "email@clinica.com" "SenhaForte1" "Nome Completo"
 *
 * - Se o e-mail ainda não existe: cria a conta no Supabase Auth e na tabela usuarios como ADMIN.
 * - Se já existe: passa a ser ADMIN, fica ativo e recebe a senha informada.
 */
import 'dotenv/config';
import { supabase } from '../src/supabase.js';

const [email, senha, ...resto] = process.argv.slice(2);
const nome = resto.join(' ').trim() || 'Administrador';

function sair(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!email || !senha) sair('Uso: npm run criar-admin -- "email@clinica.com" "SenhaForte1" "Nome Completo"');
if (!/^\S+@\S+\.\S+$/.test(email)) sair('E-mail inválido.');
if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) sair('A senha precisa ter pelo menos 8 caracteres, com letras e números.');
if (nome.length < 3) sair('O nome precisa ter pelo menos 3 letras.');

const emailMin = email.trim().toLowerCase();

/** Procura a conta no Supabase Auth pelo e-mail. */
async function idNoAuth(): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) sair(`Não foi possível consultar o Supabase Auth: ${error.message}`);
    const u = data.users.find((x) => x.email?.toLowerCase() === emailMin);
    if (u) return u.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

let id = await idNoAuth();

if (id) {
  const { error } = await supabase.auth.admin.updateUserById(id, { password: senha, email_confirm: true });
  if (error) sair(`Não foi possível atualizar a senha: ${error.message}`);
  console.log('• A conta já existia no Supabase Auth: senha atualizada.');
} else {
  const { data, error } = await supabase.auth.admin.createUser({ email: emailMin, password: senha, email_confirm: true });
  if (error || !data.user) sair(`Não foi possível criar a conta: ${error?.message}`);
  id = data.user.id;
  console.log('• Conta criada no Supabase Auth.');
}

const { data: existente, error: erroBusca } = await supabase.from('usuarios').select('id, tipo').eq('id', id).maybeSingle();
if (erroBusca) sair(`Erro ao ler a tabela usuarios: ${erroBusca.message}`);

if (existente) {
  const { error } = await supabase
    .from('usuarios')
    .update({ tipo: 'ADMIN', ativo: true, troca_senha_obrigatoria: false, recuperacao_solicitada: false })
    .eq('id', id);
  if (error) sair(`Erro ao promover o usuário: ${error.message}`);
  console.log(existente.tipo === 'ADMIN' ? '• O usuário já era ADMIN (conta reativada).' : `• Usuário existente promovido de ${existente.tipo} para ADMIN.`);
} else {
  const { error } = await supabase.from('usuarios').insert([{ id, nome, email: emailMin, tipo: 'ADMIN', ativo: true }]);
  if (error) sair(`Erro ao gravar na tabela usuarios: ${error.message}`);
  console.log('• Usuário ADMIN gravado na tabela usuarios.');
}

await supabase.from('log_alteracoes').insert([{ usuario_id: id, entidade: 'usuarios', acao: 'CRIOU_ADMIN_PELO_TERMINAL', detalhes: { registro: id } }]);

console.log(`\n✔ Pronto! Entre no sistema com:\n   E-mail: ${emailMin}\n   Senha:  (a que você informou)\n`);
process.exit(0);
