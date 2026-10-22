import { useEffect, useState } from 'react';
import { api, type Paciente } from '../api';
import { cpf } from '../formato';

/** Busca de paciente por nome, CPF ou e-mail (recepção). */
export function BuscaPaciente({ valor, aoEscolher }: { valor: Paciente | null; aoEscolher: (p: Paciente | null) => void }) {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<Paciente[]>([]);

  useEffect(() => {
    if (termo.trim().length < 2) return setResultados([]);
    const t = setTimeout(() => {
      api.get<Paciente[]>(`/pacientes?busca=${encodeURIComponent(termo.trim())}`).then(setResultados).catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [termo]);

  if (valor) {
    return (
      <div className="busca-escolhido">
        <div>
          <strong>{valor.nome}</strong>
          <span className="texto-suave">CPF {cpf(valor.cpf)}{valor.convenio_nome ? `, ${valor.convenio_nome}` : ', particular'}</span>
        </div>
        <button type="button" className="btn btn-texto" onClick={() => aoEscolher(null)}>Trocar</button>
      </div>
    );
  }
  return (
    <div className="busca">
      <input
        type="search"
        placeholder="Nome, CPF ou e-mail do paciente"
        aria-label="Buscar paciente"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        autoFocus
      />
      {resultados.length > 0 && (
        <ul className="busca-resultados" role="listbox">
          {resultados.slice(0, 8).map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => { aoEscolher(p); setTermo(''); }}>
                <strong>{p.nome}</strong>
                <span className="texto-suave">CPF {cpf(p.cpf)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {termo.trim().length >= 2 && !resultados.length && <p className="texto-suave">Nenhum paciente encontrado.</p>}
    </div>
  );
}
