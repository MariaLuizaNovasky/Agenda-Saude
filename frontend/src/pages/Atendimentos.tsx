import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Consulta } from '../api';
import { useUsuario } from '../auth';
import { Botao, Cabecalho, Campo, Carregando, Modal, Tag, useAcao, Vazio } from '../components/ui';
import { hora, minutosDesde, TIPO } from '../formato';
import { useAgora, useCarregar, useEventos } from '../hooks';

interface Grupo { medico_id: number; atraso_min: number; itens: Consulta[] }

// Médico: visualizar fila, realizar atendimento (iniciar), informar atraso
export function Atendimentos() {
  const u = useUsuario();
  const navegar = useNavigate();
  const { dados, carregando, recarregar } = useCarregar(() => api.get<{ grupos: Grupo[] }>('/fila'));
  useEventos(['fila'], recarregar);
  const agora = useAgora();
  const [executar, executando] = useAcao();
  const [atrasoAberto, setAtrasoAberto] = useState(false);
  const [minutos, setMinutos] = useState(0);

  if (carregando) return <Carregando />;
  const g = dados?.grupos[0];
  const itens = g?.itens ?? [];
  const atual = itens.find((i) => i.status === 'EM_ATENDIMENTO');
  const fila = itens.filter((i) => i.status === 'EM_ESPERA');
  const proximo = fila[0];
  const aChegar = itens.filter((i) => ['AGENDADA', 'CONFIRMADA'].includes(i.status));

  const chamar = async (c: Consulta) => {
    const r = await executar(() => api.post(`/consultas/${c.id}/iniciar`), `Atendimento de ${c.paciente_nome} iniciado.`);
    if (r) navegar(`/atendimento/${c.id}`);
  };

  return (
    <>
      <Cabecalho
        titulo="Meus atendimentos"
        descricao="Pacientes de hoje, na ordem da fila. Atualiza sozinho."
        acoes={
          <>
            {g && g.atraso_min > 0 && <Tag tom="alerta">{g.atraso_min} min de atraso</Tag>}
            <Botao variante="secundario" onClick={() => { setMinutos(g?.atraso_min ?? 0); setAtrasoAberto(true); }}>Informar atraso</Botao>
          </>
        }
      />

      {atual ? (
        <section className="destaque">
          <div className="destaque-quando">
            <span className="destaque-dia">Em atendimento</span>
            <span className="destaque-hora">{minutosDesde(atual.iniciada_em, agora)} min</span>
          </div>
          <div className="destaque-info">
            <p className="destaque-titulo">{atual.paciente_nome}</p>
            <p className="texto-suave">{TIPO[atual.tipo]} marcada às {hora(atual.data_hora)}</p>
          </div>
          <div className="destaque-acoes">
            <Link className="btn btn-primario" to={`/atendimento/${atual.id}`}>Continuar atendimento</Link>
          </div>
        </section>
      ) : proximo ? (
        <section className="destaque">
          <div className="destaque-quando">
            <span className="destaque-dia">Próximo</span>
            <span className="destaque-hora">{hora(proximo.data_hora)}</span>
          </div>
          <div className="destaque-info">
            <p className="destaque-titulo">{proximo.paciente_nome}</p>
            <p className="texto-suave">{TIPO[proximo.tipo]}, esperando há {minutosDesde(proximo.check_in_em, agora)} min</p>
          </div>
          <div className="destaque-acoes">
            <Botao carregando={executando} onClick={() => chamar(proximo)}>Chamar e iniciar</Botao>
          </div>
        </section>
      ) : (
        <Vazio titulo="Ninguém aguardando agora">Quando a recepção confirmar a presença de um paciente, ele aparece aqui.</Vazio>
      )}

      <div className="colunas">
        <section className="painel">
          <h2>Na fila ({fila.length})</h2>
          {fila.length ? (
            <ol className="fila-lista">
              {fila.map((i) => (
                <li key={i.id} className="fila-item">
                  <span className="fila-pos">{i.posicao}</span>
                  <div>
                    <strong>{i.paciente_nome}</strong>
                    <span className="texto-suave">marcado {hora(i.data_hora)}{i.tipo !== 'NORMAL' ? ` (${TIPO[i.tipo].toLowerCase()})` : ''}, esperando há {minutosDesde(i.check_in_em, agora)} min</span>
                  </div>
                  {!atual && <Botao variante="secundario" carregando={executando} onClick={() => chamar(i)}>Chamar</Botao>}
                </li>
              ))}
            </ol>
          ) : <p className="texto-suave">Ninguém aguardando.</p>}
        </section>
        <section className="painel">
          <h2>Ainda não chegaram ({aChegar.length})</h2>
          {aChegar.length ? (
            <ul className="lista">
              {aChegar.map((i) => (
                <li key={i.id} className="lista-item">
                  <span><strong>{hora(i.data_hora)}</strong> {i.paciente_nome}</span>
                  {i.status === 'CONFIRMADA' && <Tag tom="info">Check-in feito</Tag>}
                </li>
              ))}
            </ul>
          ) : <p className="texto-suave">Todos os pacientes de hoje já chegaram.</p>}
          <Link to="/agenda">Ver agenda completa</Link>
        </section>
      </div>

      <Modal aberto={atrasoAberto} aoFechar={() => setAtrasoAberto(false)} titulo="Informar atraso">
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await executar(() => api.post(`/medicos/${u.id}/atraso`, { minutos }), 'Atraso informado. Os pacientes foram avisados.');
            if (r) { setAtrasoAberto(false); recarregar(); }
          }}
        >
          <p className="texto-suave">Os pacientes de hoje que ainda não foram atendidos recebem um aviso com a nova previsão.</p>
          <Campo rotulo="Atraso estimado (minutos)" dica="Use 0 quando voltar ao horário.">
            <input type="number" min={0} max={480} step={5} value={minutos} onChange={(e) => setMinutos(Number(e.target.value))} />
          </Campo>
          <div className="modal-acoes">
            <Botao type="button" variante="secundario" onClick={() => setAtrasoAberto(false)}>Voltar</Botao>
            <Botao type="submit" carregando={executando}>Informar atraso</Botao>
          </div>
        </form>
      </Modal>
    </>
  );
}
