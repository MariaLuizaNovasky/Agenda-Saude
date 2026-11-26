import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, baixarArquivo, type Consulta, type Documento, type Exame, type StatusConsulta, type TipoConsulta } from '../api';
import { ModalDocumento } from '../components/DocumentoMedico';
import { Abas, Aviso, Botao, Campo, Carregando, StatusConsultaTag, Tag, useAcao, useToast } from '../components/ui';
import { data, dataHora, hora, idade, minutosDesde, TIPO } from '../formato';
import { useAgora, useCarregar, useEventos } from '../hooks';
import { STATUS_EXAME, TOM_EXAME } from './Historico';

interface Historico {
  paciente: { id: number; nome: string; telefone: string; cpf: string; data_nascimento: string; convenio_nome: string | null; numero_carteirinha: string | null };
  prontuario: { id: number; alergias: string | null; observacoes: string | null };
  consultas: { id: number; data_hora: string; tipo: TipoConsulta; status: StatusConsulta; anotacoes: string | null; medico_nome: string }[];
  exames: Exame[];
  documentos: Documento[];
}

// Realizar atendimento: prontuário, receita/atestado, exames (com prazo de retorno), finalizar
export function Atendimento() {
  const id = Number(useParams().id);
  const navegar = useNavigate();
  const agora = useAgora();
  const consulta = useCarregar(() => api.get<Consulta>(`/consultas/${id}`), [id]);
  const pid = consulta.dados?.paciente_id;
  const hist = useCarregar(() => (pid ? api.get<Historico>(`/pacientes/${pid}/historico`) : Promise.resolve(null)), [pid]);
  useEventos(['fila'], consulta.recarregar);
  const [executar, executando] = useAcao();
  const toast = useToast();

  const [anotacoes, setAnotacoes] = useState('');
  const [pront, setPront] = useState({ alergias: '', observacoes: '' });
  const [aba, setAba] = useState<'documento' | 'exame'>('documento');
  const [abaHist, setAbaHist] = useState<'consultas' | 'exames' | 'documentos'>('consultas');
  const [doc, setDoc] = useState<Documento | null>(null);
  const [novoDoc, setNovoDoc] = useState({ tipo: 'RECEITA' as 'RECEITA' | 'ATESTADO', conteudo: '', dias: '', cid: '', cidAutorizado: false });
  const [novoExame, setNovoExame] = useState({ tipo: '', prazo: '30' });

  useEffect(() => { setAnotacoes(consulta.dados?.anotacoes ?? ''); }, [consulta.dados?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hist.dados) setPront({ alergias: hist.dados.prontuario.alergias ?? '', observacoes: hist.dados.prontuario.observacoes ?? '' });
  }, [hist.dados]);

  if (consulta.carregando) return <Carregando />;
  if (consulta.erro || !consulta.dados) return <Aviso tom="erro">{consulta.erro ?? 'Consulta não encontrada.'}</Aviso>;
  const c = consulta.dados;
  const emAndamento = c.status === 'EM_ATENDIMENTO';
  const podeRegistrar = emAndamento || c.status === 'FINALIZADA';
  const h = hist.dados;
  const desta = (lista: { consulta_id: number | null }[] | undefined) => lista?.filter((x) => x.consulta_id === c.id) ?? [];
  const recarregarTudo = () => { consulta.recarregar(); hist.recarregar(); };

  const emitir = async (e: FormEvent) => {
    e.preventDefault();
    let conteudo = novoDoc.conteudo.trim();
    if (novoDoc.tipo === 'ATESTADO') {
      if (!novoDoc.dias.trim()) {
        toast('Campo Vazio', 'erro');
        return;
      }
      const dias = Number(novoDoc.dias);
      if (!Number.isInteger(dias) || dias < 1) {
        toast('Informe uma quantidade válida de dias de afastamento.', 'erro');
        return;
      }
      const cid = novoDoc.cidAutorizado ? novoDoc.cid.trim() : '';
      if (novoDoc.cidAutorizado && !cid) {
        toast('Campo Vazio', 'erro');
        return;
      }
      conteudo = [`Dias de afastamento: ${dias}`, ...(cid ? [`CID: ${cid}`] : [])].join('\n');
    } else if (!conteudo) {
      toast('Campo Vazio', 'erro');
      return;
    }
    const r = await executar(() => api.post<Documento>('/documentos', { consulta_id: c.id, tipo: novoDoc.tipo, conteudo }), `${novoDoc.tipo === 'RECEITA' ? 'Receita emitida' : 'Atestado emitido'}.`);
    if (r) {
      setNovoDoc({ tipo: novoDoc.tipo, conteudo: '', dias: '', cid: '', cidAutorizado: false });
      hist.recarregar();
      setDoc(r);
    }
  };
  const solicitar = async (e: FormEvent) => {
    e.preventDefault();
    const r = await executar(
      () => api.post('/exames', { consulta_id: c.id, tipo: novoExame.tipo, prazo_retorno_dias: novoExame.prazo ? Number(novoExame.prazo) : null }),
      'Exame solicitado. O laboratório já pode registrar a coleta.',
    );
    if (r) { setNovoExame({ tipo: '', prazo: novoExame.prazo }); hist.recarregar(); }
  };

  return (
    <>
      <Link to="/atendimentos" className="voltar">Meus atendimentos</Link>
      <header className="paciente-cabecalho">
        <div>
          <h1>{c.paciente_nome}</h1>
          {h?.paciente && (
            <p className="texto-suave">
              {idade(h.paciente.data_nascimento)} anos, {h.paciente.convenio_nome ? `convênio ${h.paciente.convenio_nome}` : 'particular'}. {TIPO[c.tipo]} marcada para {dataHora(c.data_hora)}.
            </p>
          )}
          {h?.prontuario.alergias && <p className="alergia">Alergias: {h.prontuario.alergias}</p>}
        </div>
        <div className="paciente-acoes">
          <StatusConsultaTag status={c.status} />
          {emAndamento && <span className="texto-suave">há {minutosDesde(c.iniciada_em, agora)} min</span>}
          {c.status === 'EM_ESPERA' && (
            <Botao carregando={executando} onClick={() => executar(() => api.post(`/consultas/${c.id}/iniciar`), 'Atendimento iniciado.').then(recarregarTudo)}>Iniciar atendimento</Botao>
          )}
          {emAndamento && (
            <>
              <Botao variante="texto" carregando={executando} onClick={() => executar(() => api.post(`/consultas/${c.id}/voltar-fila`), 'Paciente voltou para a fila.').then(() => navegar('/atendimentos'))}>Voltar à fila</Botao>
              <Botao
                carregando={executando}
                onClick={async () => {
                  const r = await executar(() => api.post(`/consultas/${c.id}/finalizar`, { anotacoes }), 'Atendimento finalizado.');
                  if (r) navegar('/atendimentos');
                }}
              >
                Finalizar atendimento
              </Botao>
            </>
          )}
        </div>
      </header>

      {!podeRegistrar && c.status !== 'EM_ESPERA' && <Aviso tom="info">O paciente ainda não está na fila. A recepção precisa confirmar a presença.</Aviso>}

      <div className="colunas">
        <section className="painel">
          <h2>Anotações desta consulta</h2>
          <textarea className="area-grande" rows={8} disabled={!podeRegistrar} placeholder="Queixa, exame físico, conduta…" value={anotacoes} onChange={(e) => setAnotacoes(e.target.value)} />
          {podeRegistrar && (
            <Botao variante="secundario" carregando={executando} onClick={() => executar(() => api.put(`/consultas/${c.id}/anotacoes`, { anotacoes }), 'Anotações salvas.')}>Salvar anotações</Botao>
          )}

          <h2 className="subtitulo">Prontuário</h2>
          <form
            className="form"
            onSubmit={(e) => { e.preventDefault(); executar(() => api.put(`/pacientes/${c.paciente_id}/prontuario`, pront), 'Prontuário atualizado.').then(hist.recarregar); }}
          >
            <Campo rotulo="Alergias">
              <input value={pront.alergias} onChange={(e) => setPront({ ...pront, alergias: e.target.value })} placeholder="Nenhuma conhecida" />
            </Campo>
            <Campo rotulo="Observações permanentes" dica="Doenças crônicas, medicamentos de uso contínuo, cirurgias.">
              <textarea rows={3} value={pront.observacoes} onChange={(e) => setPront({ ...pront, observacoes: e.target.value })} />
            </Campo>
            <Botao type="submit" variante="secundario" carregando={executando}>Salvar prontuário</Botao>
          </form>
        </section>

        <section className="painel">
          <Abas valor={aba} aoMudar={setAba} opcoes={[{ valor: 'documento', rotulo: 'Receita ou atestado' }, { valor: 'exame', rotulo: 'Pedir exame' }]} />
          {!podeRegistrar ? (
            <p className="texto-suave">Inicie o atendimento para emitir documentos e pedir exames.</p>
          ) : aba === 'documento' ? (
            <form className="form" onSubmit={emitir}>
              <Campo rotulo="Documento">
                <select value={novoDoc.tipo} onChange={(e) => setNovoDoc({ ...novoDoc, tipo: e.target.value as 'RECEITA' | 'ATESTADO' })}>
                  <option value="RECEITA">Receita</option>
                  <option value="ATESTADO">Atestado</option>
                </select>
              </Campo>
              {novoDoc.tipo === 'RECEITA' ? (
                <Campo rotulo="Conteúdo" dica="Medicamento, dose, posologia e duração.">
                  <textarea rows={4} value={novoDoc.conteudo} onChange={(e) => setNovoDoc({ ...novoDoc, conteudo: e.target.value })} />
                </Campo>
              ) : (
                <>
                  <Campo rotulo="Dias de afastamento">
                    <input type="text" inputMode="numeric" value={novoDoc.dias} onChange={(e) => setNovoDoc({ ...novoDoc, dias: e.target.value })} />
                  </Campo>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={novoDoc.cidAutorizado}
                      onChange={(e) => setNovoDoc({ ...novoDoc, cidAutorizado: e.target.checked, cid: e.target.checked ? novoDoc.cid : '' })}
                    />
                    Paciente autorizou incluir o CID no atestado
                  </label>
                  {novoDoc.cidAutorizado && (
                    <Campo rotulo="CID" dica="O CID só será incluído no documento com a autorização do paciente.">
                      <input value={novoDoc.cid} onChange={(e) => setNovoDoc({ ...novoDoc, cid: e.target.value })} />
                    </Campo>
                  )}
                </>
              )}
              <Botao type="submit" carregando={executando}>{novoDoc.tipo === 'RECEITA' ? 'Emitir receita' : 'Emitir atestado'}</Botao>
            </form>
          ) : (
            <form className="form" onSubmit={solicitar}>
              <Campo rotulo="Exame">
                <input required list="exames-comuns" value={novoExame.tipo} onChange={(e) => setNovoExame({ ...novoExame, tipo: e.target.value })} />
                <datalist id="exames-comuns">
                  {['Hemograma completo', 'Glicemia em jejum', 'Colesterol total e frações', 'Eletrocardiograma', 'Ecocardiograma', 'Raio-X de tórax', 'Urina tipo 1', 'TSH e T4 livre'].map((x) => <option key={x} value={x} />)}
                </datalist>
              </Campo>
              <Campo rotulo="Prazo para o retorno (dias)" dica="Contado a partir do resultado. Deixe vazio se não precisar de retorno.">
                <input type="number" min={1} max={365} value={novoExame.prazo} onChange={(e) => setNovoExame({ ...novoExame, prazo: e.target.value })} />
              </Campo>
              <Botao type="submit" carregando={executando}>Pedir exame</Botao>
            </form>
          )}

          {(desta(h?.documentos).length > 0 || desta(h?.exames).length > 0) && (
            <>
              <h3 className="subtitulo">Registrado nesta consulta</h3>
              <ul className="lista">
                {(desta(h?.documentos) as Documento[]).map((d) => (
                  <li key={`d${d.id}`} className="lista-item">
                    <span>{d.tipo === 'RECEITA' ? 'Receita' : 'Atestado'} nº {d.id}</span>
                    <Botao variante="texto" onClick={() => setDoc(d)}>Abrir</Botao>
                  </li>
                ))}
                {(desta(h?.exames) as Exame[]).map((e) => (
                  <li key={`e${e.id}`} className="lista-item">
                    <span>{e.tipo}{e.prazo_retorno_dias ? `, retorno em até ${e.prazo_retorno_dias} dias` : ''}</span>
                    <Tag tom={TOM_EXAME[e.status]}>{STATUS_EXAME[e.status]}</Tag>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {h && (
        <section className="painel">
          <h2>Histórico do paciente</h2>
          <Abas
            valor={abaHist}
            aoMudar={setAbaHist}
            opcoes={[
              { valor: 'consultas', rotulo: 'Consultas', contagem: h.consultas.filter((x) => x.id !== c.id).length },
              { valor: 'exames', rotulo: 'Exames', contagem: h.exames.length },
              { valor: 'documentos', rotulo: 'Receitas e atestados', contagem: h.documentos.length },
            ]}
          />
          {abaHist === 'consultas' && (
            <ul className="linha-tempo">
              {h.consultas.filter((x) => x.id !== c.id).map((x) => (
                <li key={x.id}>
                  <div className="lt-cabecalho">
                    <strong>{data(x.data_hora)} {hora(x.data_hora)}</strong> {TIPO[x.tipo]} com {x.medico_nome} <StatusConsultaTag status={x.status} />
                  </div>
                  {x.anotacoes && <p>{x.anotacoes}</p>}
                </li>
              ))}
            </ul>
          )}
          {abaHist === 'exames' && (
            <ul className="lista">
              {h.exames.map((e) => (
                <li key={e.id} className="lista-item">
                  <span><strong>{e.tipo}</strong> pedido em {data(e.data_solicitacao)}{e.data_resultado ? `, resultado em ${data(e.data_resultado)}` : ''}</span>
                  <span className="lista-acoes">
                    <Tag tom={TOM_EXAME[e.status]}>{STATUS_EXAME[e.status]}</Tag>
                    {e.arquivo_resultado && <Botao variante="texto" onClick={() => executar(() => baixarArquivo(`/exames/${e.id}/arquivo`, e.arquivo_nome ?? 'resultado'))}>Baixar</Botao>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {abaHist === 'documentos' && (
            <ul className="lista">
              {h.documentos.map((d) => (
                <li key={d.id} className="lista-item">
                  <span><strong>{d.tipo === 'RECEITA' ? 'Receita' : 'Atestado'}</strong> de {data(d.data_emissao)}, {d.medico_nome}</span>
                  <Botao variante="texto" onClick={() => setDoc(d)}>Abrir</Botao>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ModalDocumento doc={doc} aoFechar={() => setDoc(null)} />
    </>
  );
}
