import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, definirAoExpirar, getToken, setToken, type Usuario } from './api';

interface AuthCtx {
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<Usuario>;
  sair: () => void;
  atualizar: (u?: Usuario) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(!!getToken());

  const sair = useCallback(() => {
    setToken(null);
    setUsuario(null);
  }, []);

  const atualizar = useCallback(async (u?: Usuario) => {
    if (u) return setUsuario(u);
    setUsuario(await api.get<Usuario>('/auth/me'));
  }, []);

  useEffect(() => {
    definirAoExpirar(sair);
    if (!getToken()) return;
    api
      .get<Usuario>('/auth/me')
      .then(setUsuario)
      .catch(() => setToken(null))
      .finally(() => setCarregando(false));
  }, [sair]);

  const entrar = async (email: string, senha: string) => {
    const r = await api.post<{ token: string; usuario: Usuario }>('/auth/login', { email, senha });
    setToken(r.token);
    setUsuario(r.usuario);
    return r.usuario;
  };

  return <Ctx.Provider value={{ usuario, carregando, entrar, sair, atualizar }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}

/** Usuário logado (para telas que só aparecem depois do login). */
export function useUsuario() {
  return useAuth().usuario!;
}
