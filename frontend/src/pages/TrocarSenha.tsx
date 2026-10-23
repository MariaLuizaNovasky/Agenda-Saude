import { useState, type FormEvent } from 'react';
import { api, ErroApi, type Usuario } from '../api';
import { useAuth } from '../auth';
import { Aviso, Botao, Campo, useToast } from '../components/ui';
import { TelaAcesso } from './Entrar';

/** Formulário de troca de senha (também usado no perfil). */
export function FormSenha({ aoConcluir, rotuloAtual = 'Senha atual' }: { aoConcluir: (u: Usuario) => void; rotuloAtual?: string }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (nova !== conf) return setErro('A confirmação não confere com a nova senha.');
    setEnviando(true);
    try {
      const r = await api.post<{ usuario: Usuario }>('/auth/alterar-senha', { senha_atual: atual, nova_senha: nova });
      setAtual('');
      setNova('');
      setConf('');
      aoConcluir(r.usuario);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível alterar a senha.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="form">
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <Campo rotulo={rotuloAtual}>
        <input type="password" autoComplete="current-password" required value={atual} onChange={(e) => setAtual(e.target.value)} />
      </Campo>
      <Campo rotulo="Nova senha" dica="Mínimo de 8 caracteres, com letras e números.">
        <input type="password" autoComplete="new-password" required minLength={8} value={nova} onChange={(e) => setNova(e.target.value)} />
      </Campo>
      <Campo rotulo="Confirme a nova senha">
        <input type="password" autoComplete="new-password" required value={conf} onChange={(e) => setConf(e.target.value)} />
      </Campo>
      <Botao type="submit" carregando={enviando}>Salvar nova senha</Botao>
    </form>
  );
}

export function TrocarSenha({ obrigatoria }: { obrigatoria?: boolean }) {
  const { atualizar, sair } = useAuth();
  const toast = useToast();
  return (
    <TelaAcesso titulo="Crie sua senha">
      {obrigatoria && <p className="texto-suave">Você entrou com uma senha temporária. Crie uma senha pessoal para continuar.</p>}
      <FormSenha
        rotuloAtual="Senha temporária"
        aoConcluir={(u) => {
          toast('Senha alterada.');
          atualizar(u);
        }}
      />
      <button type="button" className="btn btn-texto link-centro" onClick={sair}>Sair</button>
    </TelaAcesso>
  );
}
