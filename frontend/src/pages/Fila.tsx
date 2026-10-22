import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Consulta } from '../api';
import { useUsuario } from '../auth';
import { Botao, Cabecalho, Campo, Carregando, Modal, Tag, useAcao, Vazio } from '../components/ui';
import { hora, minutosDesde, TIPO } from '../formato';
import { useAgora, useCarregar, useEventos } from '../hooks';

export function Fila() {
  const u = useUsuario();
  return u.tipo === 'PACIENTE' ? <FilaPaciente /> : <FilaRecepcao />;
}

/* ----------------------------- paciente ----------------------------- */

interface MinhaFila {
  consulta_id: number;
  medico_nome: string;
  data_hora: string;
  status: Consulta['status'];
  tipo: Consulta['tipo'];
  atraso_min: number;
  previsao: string;
  posicao: number | null;
  pessoas_na_frente: number | null;
  total_em_espera: number;
  medico_atendendo: boolean;
}

// Acompanhar fila de atendimento em tempo real
function FilaPaciente() {
  const { dados, carregando, recarregar } = useCarregar(() => api.get<MinhaFila[]>('/fila/minha'));
  useEventos(['fila'], recarregar);
  const [executar, executando] = useAcao();

  if (carregando) return <Carregando />;
  return (
    <>
      <Cabecalho titulo="Fila de atendimento" descricao="Esta tela se atualiza sozinha quando a fila anda." />
      {!dados?.length ? (
        <Vazio titulo="Você não tem consulta hoje">
          A fila aparece aqui no dia da consulta. <Link to="/consultas">Ver minhas consultas</Link>
        </Vazio>
      ) : (
        dados.map((f) => (
          <section key={f.consulta_id} className={`senha senha-${f.status.toLowerCase()}`} aria-live="polite">
            <div className="senha-placa">
              {f.status === 'EM_ATENDIMENTO' ? (
                <>
                  <span className="senha-numero senha-numero-texto">Sua vez</span>
                  <span className="senha-legenda">Dirija-se ao consultório</span>
                </>
              ) : f.status === 'EM_ESPERA' ? (
                <>
                  <span className="senha-numero">{f.posicao}º</span>
                  <span className="senha-legenda">{f.pessoas_na_frente === 0 ? 'Você é o próximo' : `${f.pessoas_na_frente} ${f.pessoas_na_frente === 1 ? 'pessoa' : 'pessoas'} na sua frente`}</span>
                </>
              ) : (
                <>
                  <span className="senha-numero senha-numero-texto">{f.status === 'CONFIRMADA' ? 'Aguarde' : 'Check-in'}</span>
                  <span className="senha-legenda">{f.status === 'CONFIRMADA' ? 'A recepção vai confirmar sua presença' : 'Faça o check-in ao chegar'}</span>
                </>
              )}
            </div>
            <div className="senha-detalhes">
              <p className="senha-medico">{TIPO[f.tipo]} com {f.medico_nome}</p>
              <dl className="dados">
                <div><dt>Horário marcado</dt><dd>{hora(f.data_hora)}</dd></div>
                <div><dt>Previsão</dt><dd>{hora(f.previsao)}</dd></div>
                <div><dt>Atraso do médico</dt><dd>{f.atraso_min ? `${f.atraso_min} min` : 'No horário'}</dd></div>
                <div><dt>Pacientes aguardando</dt><dd>{f.total_em_espera}</dd></div>
              </dl>
              {f.status === 'AGENDADA' && (
                <Botao carregando={executando} onClick={() => executar(() => api.post(`/consultas/${f.consulta_id}/checkin`), 'Check-in feito.').then(recarregar)}>
                  Fazer check-in
                </Botao>
              )}
            </div>
          </section>
        ))
      )}
    </>
  );
}

/* ----------------------------- recepção ----------------------------- */

interface Grupo { medico_id: number; medico_nome: string; atraso_min: number; itens: Consulta[] }

// Gerenciar fila (situação do atendimento e atrasos)
function FilaRecepcao() {
  const { dados, carregando, recarregar } = useCarregar(() => api.get<{ data: string; grupos: Grupo[] }>('/fila'));
  useEventos(['fila'], recarregar);
  const agora = useAgora();
  const [executar, executando] = useAcao();
  const [atraso, setAtraso] = useState<Grupo | null>(null);
  const [minutos, setMinutos] = useState(0);

  const acao = (caminho: string, msg: string) => executar(() => api.post(caminho), msg).then(recarregar);

  if (carregando) return <Carregando />;
  return (
    <>
      <Cabecalho titulo="Fila de hoje" descricao="Atualiza em tempo real em todas as telas abertas." />
      {!dados?.grupos.length ? (
        <Vazio titulo="Ninguém na fila agora">As consultas de hoje aparecem aqui conforme os pacientes chegam.</Vazio>
      ) : (
        <div className="quadro">
          {dados.grupos.map((g) => {
            const atendendo = g.itens.find((i) => i.status === 'EM_ATENDIMENTO');
            const espera = g.itens.filter((i) => i.status === 'EM_ESPERA');
            const chegaram = g.itens.filter((i) => i.status === 'CONFIRMADA');
            const aChegar = g.itens.filter((i) => i.status === 'AGENDADA');
            return (
              <section key={g.medico_id} className="coluna-fila">
                <header className="coluna-cabecalho">
                  <h2>{g.medico_nome}</h2>
                  <div className="coluna-meta">
                    {g.atraso_min > 0 ? <Tag tom="alerta">{g.atraso_min} min de atraso</Tag> : <Tag tom="ok">No horário</Tag>}
                    <Botao variante="texto" onClick={() => { setAtraso(g); setMinutos(g.atraso_min); }}>Informar atraso</Botao>
                  </div>
                </header>

                <div className={`consultorio ${atendendo ? 'consultorio-ocupado' : ''}`}>
                  <h3>{atendendo ? 'No consultório agora' : 'Consultório livre'}</h3>
                  {atendendo ? (
                    <div className="fila-item fila-item-atual">
                      <div>
                        <strong>{atendendo.paciente_nome}</strong>
                        <span className="texto-suave">em atendimento há {minutosDesde(atendendo.iniciada_em, agora)} min</span>
                      </div>
                      <Botao variante="texto" carregando={executando} onClick={() => acao(`/consultas/${atendendo.id}/voltar-fila`, 'Paciente voltou para a fila.')}>Voltar à fila</Botao>
                    </div>
                  ) : (
                    <p className="texto-suave">{espera.length ? 'O médico pode chamar o próximo.' : 'Ninguém aguardando por enquanto.'}</p>
                  )}
                </div>

                <div className="fila-bloco">
                  <h3>Na fila ({espera.length})</h3>
                  {espera.length ? (
                    <ol className="fila-lista">
                      {espera.map((i) => (
                        <li key={i.id} className="fila-item">
                          <span className="fila-pos">{i.posicao}</span>
                          <div>
                            <strong>{i.paciente_nome}</strong>
                            <span className="texto-suave">
                              marcado {hora(i.data_hora)}{i.tipo !== 'NORMAL' && ` (${TIPO[i.tipo].toLowerCase()})`}, esperando há {minutosDesde(i.check_in_em, agora)} min
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="texto-suave">Ninguém aguardando</p>
                  )}
                </div>

                {chegaram.length > 0 && (
                  <div className="fila-bloco fila-bloco-atencao">
                    <h3>Fizeram check-in pelo celular</h3>
                    {chegaram.map((i) => (
                      <div key={i.id} className="fila-item">
                        <div>
                          <strong>{i.paciente_nome}</strong>
                          <span className="texto-suave">marcado {hora(i.data_hora)}, chegou {hora(i.check_in_em)}</span>
                        </div>
                        <Botao carregando={executando} onClick={() => acao(`/consultas/${i.id}/confirmar-presenca`, `${i.paciente_nome} entrou na fila.`)}>Confirmar</Botao>
                      </div>
                    ))}
                  </div>
                )}

                {aChegar.length > 0 && (
                  <div className="fila-bloco">
                    <h3>Ainda não chegaram</h3>
                    {aChegar.map((i) => {
                      const passou = minutosDesde(i.data_hora, agora) > 0;
                      return (
                        <div key={i.id} className="fila-item">
                          <div>
                            <strong>{i.paciente_nome}</strong>
                            <span className="texto-suave">{hora(i.data_hora)}</span>
                          </div>
                          <div className="fila-item-acoes">
                            <Botao variante="secundario" carregando={executando} onClick={() => acao(`/consultas/${i.id}/confirmar-presenca`, `${i.paciente_nome} entrou na fila.`)}>Chegou</Botao>
                            {passou && <Botao variante="texto" carregando={executando} onClick={() => acao(`/consultas/${i.id}/faltou`, 'Falta registrada.')}>Faltou</Botao>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <footer className="coluna-rodape">
                  {g.itens.filter((i) => i.status !== 'AGENDADA').length} de {g.itens.length} pacientes já chegaram
                  <div className="chegada" aria-hidden>
                    <span style={{ width: `${(g.itens.filter((i) => i.status !== 'AGENDADA').length / Math.max(1, g.itens.length)) * 100}%` }} />
                  </div>
                </footer>
              </section>
            );
          })}
        </div>
      )}

      <Modal aberto={!!atraso} aoFechar={() => setAtraso(null)} titulo={`Atraso de ${atraso?.medico_nome ?? ''}`}>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await executar(() => api.post(`/medicos/${atraso!.medico_id}/atraso`, { minutos }), 'Atraso informado. Os pacientes foram avisados.');
            if (r) { setAtraso(null); recarregar(); }
          }}
        >
          <p className="texto-suave">Vale para as consultas de hoje que ainda não começaram. Os pacientes recebem um aviso.</p>
          <Campo rotulo="Atraso estimado (minutos)" dica="Use 0 quando o médico voltar ao horário.">
            <input type="number" min={0} max={480} step={5} value={minutos} onChange={(e) => setMinutos(Number(e.target.value))} />
          </Campo>
          <div className="modal-acoes">
            <Botao type="button" variante="secundario" onClick={() => setAtraso(null)}>Voltar</Botao>
            <Botao type="submit" carregando={executando}>Informar atraso</Botao>
          </div>
        </form>
      </Modal>
    </>
  );
}
