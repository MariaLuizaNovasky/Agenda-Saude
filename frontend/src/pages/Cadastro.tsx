import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ErroApi } from '../api';
import { CamposPaciente, pacienteVazio } from '../components/CamposPaciente';
import { Aviso, Botao, Campo, useToast } from '../components/ui';
import { TelaAcesso } from './Entrar';

export function Cadastro() {
  const [dados, setDados] = useState(pacienteVazio);
  const [senha, setSenha] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const navegar = useNavigate();
  const toast = useToast();

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (senha !== conf) return setErro('A confirmação não confere com a senha.');
    setEnviando(true);
    try {
      const r = await api.post<{ mensagem: string }>('/auth/cadastro', { ...dados, senha, numero_carteirinha: dados.numero_carteirinha || null });
      toast(r.mensagem);
      navegar('/entrar');
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível concluir o cadastro.');
      setEnviando(false);
    }
  };

  return (
    <TelaAcesso titulo="Criar conta de paciente">
      <form onSubmit={enviar} className="form">
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <CamposPaciente valor={dados} aoMudar={setDados} />
        <div className="grade-campos">
          <Campo rotulo="Senha" dica="Mínimo de 8 caracteres, com letras e números.">
            <input type="password" required minLength={8} autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </Campo>
          <Campo rotulo="Confirme a senha">
            <input type="password" required autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} />
          </Campo>
        </div>
        <Botao type="submit" carregando={enviando} className="btn-bloco">Criar conta</Botao>
        <Link to="/entrar" className="link-centro">Já tenho conta</Link>
      </form>
    </TelaAcesso>
  );
}
