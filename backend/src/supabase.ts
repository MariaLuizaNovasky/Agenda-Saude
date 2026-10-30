import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceKey) {
  throw new Error(
    'Configure SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY no arquivo .env do backend.',
  );
}

const semSessao = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/**
 * Cliente do servidor (chave service_role): ignora o RLS, porque quem controla
 * o acesso é a própria API (middleware autenticar/permitir). Nunca faz login nele,
 * senão todas as consultas seguintes passariam a rodar como o último usuário logado.
 */
export const supabase = createClient(supabaseUrl, serviceKey, semSessao);

/** Confere e-mail e senha num cliente descartável, sem mexer no cliente do servidor. */
export async function conferirSenha(email: string, senha: string) {
  const cliente = createClient(supabaseUrl!, anonKey!, semSessao);
  const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha });
  return { usuarioAuth: data?.user ?? null, error };
}
