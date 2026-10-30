import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ErroApi } from '../api';
import { useAuth } from '../auth';
import { Bolinha, Estrela, SetaDiagonal, Simbolo } from '../components/Icones';
import { Aviso, Botao, Campo } from '../components/ui';

const DEMO = [
  ['Paciente', 'paciente@agendasaude.com'],
  ['Recepção', 'recepcao@agendasaude.com'],
  ['Médica', 'helena@agendasaude.com'],
  ['Administrador', 'admin@agendasaude.com'],
  ['Financeiro', 'financeiro@agendasaude.com'],
  ['Laboratório', 'laboratorio@agendasaude.com'],
  ['Farmácia', 'farmacia@agendasaude.com'],
];

/** Moldura das telas de acesso. */
export function TelaAcesso({ titulo, children, lateral }: { titulo: string; children: ReactNode; lateral?: ReactNode }) {
  return (
    <div className="acesso">
      <div className="acesso-folha">
        <header className="acesso-topo">
          <div className="acesso-logo">
            <Simbolo />
            <span>Agenda-Saúde</span>
          </div>
        </header>

        <section className="acesso-form">
          <p className="acesso-frase">Sua consulta, do check-in ao retorno.</p>
          <p className="acesso-sub">Marque consultas, acompanhe a fila pelo celular e encontre seus exames e receitas num só lugar.</p>
          <div className="acesso-caixa">
            <h1>{titulo}</h1>
            {children}
          </div>
          {lateral}
        </section>

        <div className="colagem acesso-colagem" aria-hidden>
          <Estrela style={{ left: -6, top: '44%' }} />
          <Estrela tamanho={16} style={{ right: 2, bottom: 8 }} />
          <Bolinha cor="var(--lilas)" tamanho={16} style={{ right: 4, top: '36%' }} />
          <Bolinha cor="var(--ceu)" tamanho={24} style={{ right: '32%', bottom: -6 }} />
          <div className="bloco bloco-ceu bloco-hora">
            <span className="bloco-rotulo">Hoje</span>
            <span className="bloco-grande">09:30</span>
            <span className="bloco-titulo">Check-in feito. Você é o 2º da fila.</span>
            <span className="bloco-seta" style={{ right: -14, top: -14 }}><SetaDiagonal /></span>
          </div>
          <div className="bloco bloco-lilas bloco-medico">
            <span className="monograma">HP</span>
            <span className="bloco-rotulo">Cardiologia</span>
          </div>
          <div className="bloco bloco-salvia bloco-retorno">
            <span className="bloco-rotulo">Resultado pronto</span>
            <span className="bloco-titulo">Retorno até 18/11</span>
          </div>
          <div className="bloco bloco-pessego bloco-pilula">
            <span className="argolas"><i /><i /><i /></span>
            <span className="bloco-titulo">Fila ao vivo</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Entrar() {
  const { entrar } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), senha);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível entrar.');
      setEnviando(false);
    }
  };

  return (
    <TelaAcesso
      titulo="Entrar"
      lateral={
        <div className="acesso-demo">
          <p>Para testar, escolha um perfil (senha <strong>Senha123</strong>):</p>
          <ul>
            {DEMO.map(([perfil, mail]) => (
              <li key={mail}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(mail);
                    setSenha('Senha123');
                  }}
                >
                  <span>{perfil}</span>
                  <span className="acesso-demo-email">{mail}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      }
    >
      <form onSubmit={enviar} className="form">
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Campo rotulo="E-mail">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Campo>
        <Campo rotulo="Senha">
          <input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        <Botao type="submit" carregando={enviando} className="btn-bloco">
          Entrar
        </Botao>
      </form>
      <div className="acesso-links">
        <Link to="/recuperar-senha">Esqueci minha senha</Link>
        <span>
          Primeira vez? <Link to="/cadastro">Criar conta de paciente</Link>
        </span>
      </div>
    </TelaAcesso>
  );
}
