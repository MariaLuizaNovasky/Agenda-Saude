import { useState, type FormEvent } from 'react';
import { api, type Disponibilidade as Disp } from '../api';
import { useUsuario } from '../auth';
import { Botao, Cabecalho, Campo, Carregando, useAcao } from '../components/ui';
import { DIAS_SEMANA } from '../formato';
import { useCarregar } from '../hooks';

// Medico.gerenciarDisponibilidade()
export function Disponibilidade() {
  const u = useUsuario();
  const { dados, carregando, recarregar } = useCarregar(() => api.get<Disp[]>(`/medicos/${u.id}/disponibilidades`));
  const [f, setF] = useState({ dia_semana: 1, hora_inicio: '08:00', hora_fim: '12:00', duracao_min: 30 });
  const [executar, executando] = useAcao();

  const adicionar = async (e: FormEvent) => {
    e.preventDefault();
    const r = await executar(() => api.post(`/medicos/${u.id}/disponibilidades`, f), 'Período adicionado à agenda.');
    if (r) recarregar();
  };

  const vagas = (d: Disp) => {
    const [hi, mi] = d.hora_inicio.split(':').map(Number);
    const [hf, mf] = d.hora_fim.split(':').map(Number);
    return Math.floor((hf * 60 + mf - hi * 60 - mi) / d.duracao_min);
  };

  return (
    <>
      <Cabecalho titulo="Disponibilidade" descricao="Os horários que os pacientes podem marcar saem destes períodos." />
      <div className="colunas colunas-assimetricas">
        <section className="semana">
          {carregando ? <Carregando /> : DIAS_SEMANA.map((nome, i) => {
            const periodos = dados?.filter((d) => d.dia_semana === i) ?? [];
            return (
              <div key={nome} className={`semana-dia ${periodos.length ? '' : 'semana-dia-vazio'}`}>
                <h3>{nome}</h3>
                {periodos.length ? (
                  <ul>
                    {periodos.map((p) => (
                      <li key={p.id} className="periodo">
                        <span><strong>{p.hora_inicio} às {p.hora_fim}</strong> <span className="texto-suave">{vagas(p)} horários de {p.duracao_min} min</span></span>
                        <Botao variante="texto" carregando={executando} onClick={() => executar(() => api.del(`/medicos/${u.id}/disponibilidades/${p.id}`), 'Período removido. Consultas já marcadas continuam valendo.').then(recarregar)}>Remover</Botao>
                      </li>
                    ))}
                  </ul>
                ) : <p className="texto-suave">Sem atendimento</p>}
              </div>
            );
          })}
        </section>
        <section className="painel">
          <h2>Adicionar período</h2>
          <form className="form" onSubmit={adicionar}>
            <Campo rotulo="Dia da semana">
              <select value={f.dia_semana} onChange={(e) => setF({ ...f, dia_semana: Number(e.target.value) })}>
                {DIAS_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </Campo>
            <div className="grade-campos">
              <Campo rotulo="Início"><input type="time" required value={f.hora_inicio} onChange={(e) => setF({ ...f, hora_inicio: e.target.value })} /></Campo>
              <Campo rotulo="Fim"><input type="time" required value={f.hora_fim} onChange={(e) => setF({ ...f, hora_fim: e.target.value })} /></Campo>
            </div>
            <Campo rotulo="Duração de cada consulta">
              <select value={f.duracao_min} onChange={(e) => setF({ ...f, duracao_min: Number(e.target.value) })}>
                {[15, 20, 30, 40, 45, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
              </select>
            </Campo>
            <Botao type="submit" carregando={executando}>Adicionar período</Botao>
          </form>
        </section>
      </div>
    </>
  );
}
