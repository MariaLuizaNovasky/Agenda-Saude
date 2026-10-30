import { useState } from 'react';
import { api, baixarArquivo, type Documento, type Exame, type StatusConsulta, type TipoConsulta } from '../api';
import { useUsuario } from '../auth';
import { ModalDocumento } from '../components/DocumentoMedico';
import { Abas, Botao, Cabecalho, Carregando, StatusConsultaTag, Tag, useAcao, Vazio } from '../components/ui';
import { data, dataHora, TIPO } from '../formato';
import { useCarregar } from '../hooks';

interface Historico {
  consultas: { id: number; data_hora: string; tipo: TipoConsulta; status: StatusConsulta; medico_nome: string; motivo_cancelamento: string | null }[];
  exames: Exame[];
  documentos: Documento[];
}

export const STATUS_EXAME = { SOLICITADO: 'Solicitado', COLETADO: 'Coletado', CONCLUIDO: 'Resultado pronto' } as const;
export const TOM_EXAME = { SOLICITADO: 'neutro', COLETADO: 'info', CONCLUIDO: 'ok' } as const;

// Visualizar histórico (consultas, exames, receitas, atestados)
export function Historico() {
  const u = useUsuario();
  const { dados, carregando } = useCarregar(() => api.get<Historico>(`/pacientes/${u.id}/historico`));
  const [aba, setAba] = useState<'exames' | 'documentos' | 'consultas'>('exames');
  const [doc, setDoc] = useState<Documento | null>(null);
  const [executar] = useAcao();

  if (carregando || !dados) return <Carregando />;
  return (
    <>
      <Cabecalho titulo="Histórico" />
      <Abas
        valor={aba}
        aoMudar={setAba}
        opcoes={[
          { valor: 'exames', rotulo: 'Exames', contagem: dados.exames.length },
          { valor: 'documentos', rotulo: 'Receitas e atestados', contagem: dados.documentos.length },
          { valor: 'consultas', rotulo: 'Consultas', contagem: dados.consultas.length },
        ]}
      />
      {aba === 'exames' &&
        (dados.exames.length ? (
          <table className="tabela">
            <thead><tr><th>Exame</th><th>Pedido por</th><th>Pedido em</th><th>Situação</th><th>Retorno até</th><th /></tr></thead>
            <tbody>
              {dados.exames.map((e) => (
                <tr key={e.id}>
                  <td data-rotulo="Exame"><strong>{e.tipo}</strong></td>
                  <td data-rotulo="Pedido por">{e.medico_nome}</td>
                  <td data-rotulo="Pedido em">{data(e.data_solicitacao)}</td>
                  <td data-rotulo="Situação"><Tag tom={TOM_EXAME[e.status]}>{STATUS_EXAME[e.status]}</Tag></td>
                  <td data-rotulo="Retorno até">{e.data_limite_retorno ? data(e.data_limite_retorno) : '—'}</td>
                  <td>
                    {e.arquivo_resultado && (
                      <Botao variante="secundario" onClick={() => executar(() => baixarArquivo(`/exames/${e.id}/arquivo`, e.arquivo_nome ?? 'resultado'))}>Baixar resultado</Botao>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vazio titulo="Nenhum exame pedido" />)}
      {aba === 'documentos' &&
        (dados.documentos.length ? (
          <ul className="cartoes">
            {dados.documentos.map((d) => (
              <li key={d.id} className="cartao-doc">
                <div>
                  <p className="cc-titulo">{d.tipo === 'RECEITA' ? 'Receita' : 'Atestado'} de {data(d.data_emissao)}</p>
                  <p className="texto-suave">{d.medico_nome}</p>
                  <p className="cartao-doc-trecho">{d.conteudo}</p>
                </div>
                <div className="cc-acoes">
                  {d.tipo === 'RECEITA' && <Tag tom={d.data_retirada ? 'ok' : 'neutro'}>{d.data_retirada ? `Retirada em ${data(d.data_retirada)}` : 'Não retirada'}</Tag>}
                  <Botao variante="secundario" onClick={() => setDoc(d)}>Abrir</Botao>
                </div>
              </li>
            ))}
          </ul>
        ) : <Vazio titulo="Nenhuma receita ou atestado" />)}
      {aba === 'consultas' &&
        (dados.consultas.length ? (
          <table className="tabela">
            <thead><tr><th>Data</th><th>Tipo</th><th>Médico</th><th>Situação</th></tr></thead>
            <tbody>
              {dados.consultas.map((c) => (
                <tr key={c.id}>
                  <td data-rotulo="Data">{dataHora(c.data_hora)} de {c.data_hora.slice(0, 4)}</td>
                  <td data-rotulo="Tipo">{TIPO[c.tipo]}</td>
                  <td data-rotulo="Médico">{c.medico_nome}</td>
                  <td data-rotulo="Situação"><StatusConsultaTag status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Vazio titulo="Nenhuma consulta ainda" />)}
      <ModalDocumento doc={doc} aoFechar={() => setDoc(null)} />
    </>
  );
}
