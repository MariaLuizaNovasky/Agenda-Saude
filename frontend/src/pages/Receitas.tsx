import { useState, type FormEvent } from 'react';
import { api, type Documento } from '../api';
import { ModalDocumento } from '../components/DocumentoMedico';
import { Botao, Cabecalho, Tag, useAcao, Vazio } from '../components/ui';
import { cpf, data, mascaraCpf } from '../formato';

// Farmácia (externo): registrar retirada de medicamento
export function Receitas() {
  const [termo, setTermo] = useState('');
  const [lista, setLista] = useState<Documento[] | null>(null);
  const [doc, setDoc] = useState<Documento | null>(null);
  const [executar, executando] = useAcao();

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    const r = await executar(() => api.get<Documento[]>(`/documentos?busca=${encodeURIComponent(termo)}`));
    if (r) setLista(r);
  };

  return (
    <>
      <Cabecalho titulo="Retirada de receitas" descricao="Busque pelo CPF do paciente ou pelo número impresso na receita." />
      <form className="filtros" onSubmit={buscar}>
        <input className="busca-larga" required inputMode="numeric" placeholder="CPF ou nº da receita" aria-label="CPF ou número da receita" value={termo.length > 6 ? mascaraCpf(termo) : termo} onChange={(e) => setTermo(e.target.value.replace(/\D/g, ''))} />
        <Botao type="submit" carregando={executando}>Buscar</Botao>
      </form>
      {lista && (!lista.length ? (
        <Vazio titulo="Nenhuma receita encontrada">Confira o CPF ou o número da receita.</Vazio>
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
      ))}
      <ModalDocumento doc={doc} aoFechar={() => setDoc(null)} />
    </>
  );
}
