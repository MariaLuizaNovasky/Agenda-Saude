import { useState, type FormEvent } from 'react';
import { api, type Documento } from '../api';
import { ModalDocumento } from '../components/DocumentoMedico';
import { Botao, Cabecalho, Carregando, Tag, useAcao, Vazio } from '../components/ui';
import { cpf, data, mascaraCpf } from '../formato';
import { useCarregar } from '../hooks';

// Farmácia (externo): registrar retirada de medicamento
export function Receitas() {
  const [termo, setTermo] = useState('');
  const [doc, setDoc] = useState<Documento | null>(null);
  const [executar, executando] = useAcao();
  const { dados: lista, erro, carregando, setDados: setLista } = useCarregar(
    () => api.get<Documento[]>('/documentos'),
  );

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    const busca = termo.replace(/\D/g, '');
    const r = await executar(() => api.get<Documento[]>(busca ? `/documentos?busca=${encodeURIComponent(busca)}` : '/documentos'));
    if (r) setLista(r);
  };

  return (
    <>
      <Cabecalho titulo="Retirada de receitas" descricao="Receitas disponíveis para retirada aparecem abaixo. Busque pelo CPF ou número para localizar receitas anteriores." />
      <form className="filtros" onSubmit={buscar}>
        <input className="busca-larga" inputMode="numeric" placeholder="CPF ou nº da receita" aria-label="CPF ou número da receita" value={termo.length > 6 ? mascaraCpf(termo) : termo} onChange={(e) => setTermo(e.target.value.replace(/\D/g, ''))} />
        <Botao type="submit" carregando={executando}>{termo ? 'Buscar' : 'Mostrar disponíveis'}</Botao>
      </form>
      {carregando ? <Carregando /> : erro ? (
        <Vazio titulo="Não foi possível carregar as receitas">{erro}</Vazio>
      ) : !lista?.length ? (
        <Vazio titulo={termo ? 'Nenhuma receita encontrada' : 'Nenhuma receita aguardando retirada'}>
          {termo ? 'Confira o CPF ou o número da receita.' : 'As receitas disponíveis para retirada aparecerão aqui.'}
        </Vazio>
      ) : (
        <table className="tabela">
          <thead><tr><th>Nº</th><th>Paciente</th><th>Prescrição</th><th>Emitida</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {lista.map((d) => (
              <tr key={d.id}>
                <td data-rotulo="Nº">{d.id}</td>
                <td data-rotulo="Paciente">{d.paciente_nome}<div className="texto-suave">{cpf(d.paciente_cpf)}</div></td>
                <td data-rotulo="Prescrição" className="celula-texto">{d.conteudo}<div className="texto-suave">{d.medico_nome}, CRM {d.crm}/{d.crm_uf}</div></td>
                <td data-rotulo="Emitida">{data(d.data_emissao)}</td>
                <td data-rotulo="Situação">{d.data_retirada ? <Tag tom="neutro">Retirada em {data(d.data_retirada)}</Tag> : <Tag tom="ok">Disponível</Tag>}</td>
                <td className="celula-acoes">
                  <Botao variante="texto" onClick={() => setDoc(d)}>Abrir</Botao>
                  {!d.data_retirada && (
                    <Botao carregando={executando} onClick={() => executar(() => api.post(`/documentos/${d.id}/retirada`), 'Retirada registrada.').then(() => buscar())}>Registrar retirada</Botao>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ModalDocumento doc={doc} aoFechar={() => setDoc(null)} />
    </>
  );
}
