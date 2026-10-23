import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ErroApi } from '../api';
import { Aviso, Botao, Campo } from '../components/ui';
import { TelaAcesso } from './Entrar';

export function RecuperarSenha() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.post<{ mensagem: string }>('/auth/recuperar-senha', { email: email.trim() });
      setMsg(r.mensagem);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível enviar o pedido.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <TelaAcesso titulo="Recuperar senha">
      {msg ? (
        <>
          <Aviso tom="ok">{msg}</Aviso>
          <p className="texto-suave">Ao entrar com a senha temporária, você vai criar uma nova senha.</p>
          <Link to="/entrar" className="btn btn-secundario btn-bloco">Voltar para o login</Link>
        </>
      ) : (
        <form onSubmit={enviar} className="form">
          <p className="texto-suave">O pedido vai para a administração da clínica, que gera uma senha temporária para você.</p>
          {erro && <Aviso tom="erro">{erro}</Aviso>}
          <Campo rotulo="E-mail cadastrado">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Campo>
          <Botao type="submit" carregando={enviando} className="btn-bloco">Pedir nova senha</Botao>
          <Link to="/entrar" className="link-centro">Voltar para o login</Link>
        </form>
      )}
    </TelaAcesso>
  );
}
