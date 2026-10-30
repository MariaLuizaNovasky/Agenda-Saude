import { useEffect, useState, type FormEvent } from 'react';
import { api, type Consulta } from '../api';
import { useUsuario } from '../auth';
import { Botao, Cabecalho, Campo, Carregando, Vazio, useToast } from '../components/ui';
import { data, hora, TIPO } from '../formato';
import { useCarregar } from '../hooks';

interface AvaliacaoConsulta {
  consultaId: number;
  medicoNota: number;
  atendimentoNota: number;
  comentario: string;
  criadaEm: string;
}

interface RascunhoAvaliacao {
  medicoNota: number;
  atendimentoNota: number;
  comentario: string;
}

const chaveAvaliacoes = (pacienteId: string) => `agenda-saude:avaliacoes:${pacienteId}`;

function ehAvaliacao(item: unknown): item is AvaliacaoConsulta {
  if (!item || typeof item !== 'object') return false;
  const avaliacao = item as Record<string, unknown>;
  return typeof avaliacao.consultaId === 'number'
    && typeof avaliacao.medicoNota === 'number'
    && avaliacao.medicoNota >= 1 && avaliacao.medicoNota <= 5
    && typeof avaliacao.atendimentoNota === 'number'
    && avaliacao.atendimentoNota >= 1 && avaliacao.atendimentoNota <= 5
    && typeof avaliacao.comentario === 'string'
    && typeof avaliacao.criadaEm === 'string';
}

function lerAvaliacoes(pacienteId: string) {
  const bruto = localStorage.getItem(chaveAvaliacoes(pacienteId));
  if (!bruto) return [] as AvaliacaoConsulta[];
  const dados: unknown = JSON.parse(bruto);
  if (!Array.isArray(dados) || !dados.every(ehAvaliacao)) {
    throw new Error('As avaliações salvas estão em formato inválido.');
  }
  return dados;
}

export function Avaliacoes() {
  const usuario = useUsuario();
  const toast = useToast();
  const consultas = useCarregar(() => api.get<Consulta[]>('/consultas?ordem=desc'));
  const [avaliacoes, setAvaliacoes] = useState<AvaliacaoConsulta[]>([]);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<number, RascunhoAvaliacao>>({});

  useEffect(() => {
    try {
      const salvas = lerAvaliacoes(usuario.id);
      setAvaliacoes(salvas);
      setRascunhos(Object.fromEntries(salvas.map((avaliacao) => [
        avaliacao.consultaId,
        {
          medicoNota: avaliacao.medicoNota,
          atendimentoNota: avaliacao.atendimentoNota,
          comentario: avaliacao.comentario,
        },
      ])));
    } catch (e) {
      setErroLocal(e instanceof Error ? e.message : 'Não foi possível ler as avaliações salvas.');
    }
  }, [usuario.id]);

  const finalizadas = (consultas.dados ?? []).filter((consulta) => consulta.status === 'FINALIZADA');
  const atualizada = (id: number): RascunhoAvaliacao => rascunhos[id] ?? { medicoNota: 0, atendimentoNota: 0, comentario: '' };

  const definirNota = (consultaId: number, campo: 'medicoNota' | 'atendimentoNota', nota: number) => {
    setRascunhos((atuais) => ({
      ...atuais,
      [consultaId]: { ...atualizada(consultaId), [campo]: nota },
    }));
  };

  const avaliar = (evento: FormEvent<HTMLFormElement>, consulta: Consulta) => {
    evento.preventDefault();
    const rascunho = atualizada(consulta.id);
    if (!rascunho.medicoNota || !rascunho.atendimentoNota) {
      toast('Selecione uma nota para o médico e para o atendimento.', 'erro');
      return;
    }
    const avaliacao: AvaliacaoConsulta = {
      consultaId: consulta.id,
      ...rascunho,
      criadaEm: new Date().toISOString(),
    };
    const novas = [...avaliacoes.filter((item) => item.consultaId !== consulta.id), avaliacao];
    try {
      localStorage.setItem(chaveAvaliacoes(usuario.id), JSON.stringify(novas));
      setAvaliacoes(novas);
      window.dispatchEvent(new Event('agenda-saude:formulario-salvo'));
      toast('Avaliação salva. Obrigado pelo retorno!');
    } catch {
      toast('Não foi possível salvar a avaliação neste navegador.', 'erro');
    }
  };

  return (
    <>
      <Cabecalho titulo="Avaliações" descricao="Conte como foi o atendimento e avalie a experiência com o profissional." />
      {erroLocal && <div className="aviso aviso-erro" role="alert">{erroLocal}</div>}
      {consultas.erro && <div className="aviso aviso-erro" role="alert">{consultas.erro}</div>}
      {consultas.carregando ? <Carregando /> : !finalizadas.length ? (
        <Vazio titulo="Ainda não há consultas para avaliar">
          As avaliações ficam disponíveis após a conclusão de uma consulta.
        </Vazio>
      ) : (
        <ul className="avaliacoes-lista">
          {finalizadas.map((consulta) => {
            const rascunho = atualizada(consulta.id);
            const salva = avaliacoes.some((avaliacao) => avaliacao.consultaId === consulta.id);
            return (
              <li className="painel avaliacao-card" key={consulta.id}>
                <header className="avaliacao-consulta">
                  <div>
                    <h2>{consulta.medico_nome}</h2>
                    <p className="texto-suave">{TIPO[consulta.tipo]} · {data(consulta.data_hora)} às {hora(consulta.data_hora)}</p>
                  </div>
                  {salva && <span className="tag tag-tom-ok">Avaliada</span>}
                </header>
                <form className="form" onSubmit={(evento) => avaliar(evento, consulta)}>
                  <fieldset className="avaliacao-nota">
                    <legend>Avalie o médico</legend>
                    <p className="texto-suave">Atenção, clareza e confiança durante a consulta.</p>
                    <Estrelas nome={`Médico ${consulta.medico_nome}`} valor={rascunho.medicoNota} aoSelecionar={(nota) => definirNota(consulta.id, 'medicoNota', nota)} />
                  </fieldset>
                  <fieldset className="avaliacao-nota">
                    <legend>Avalie o atendimento</legend>
                    <p className="texto-suave">Recepção, organização e experiência geral.</p>
                    <Estrelas nome={`Atendimento ${consulta.medico_nome}`} valor={rascunho.atendimentoNota} aoSelecionar={(nota) => definirNota(consulta.id, 'atendimentoNota', nota)} />
                  </fieldset>
                  <Campo rotulo="Comentário (opcional)">
                    <textarea
                      value={rascunho.comentario}
                      onChange={(evento) => setRascunhos((atuais) => ({
                        ...atuais,
                        [consulta.id]: { ...atualizada(consulta.id), comentario: evento.target.value },
                      }))}
                      rows={3}
                      maxLength={800}
                    />
                  </Campo>
                  <Botao type="submit">{salva ? 'Atualizar avaliação' : 'Enviar avaliação'}</Botao>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      <p className="texto-suave ajuda-local">As avaliações ficam salvas apenas neste navegador, pois esta etapa foi implementada somente no frontend.</p>
    </>
  );
}

function Estrelas({ nome, valor, aoSelecionar }: { nome: string; valor: number; aoSelecionar: (nota: number) => void }) {
  return (
    <div className="avaliacao-estrelas" role="radiogroup" aria-label={nome}>
      {[1, 2, 3, 4, 5].map((nota) => (
        <button
          className={nota <= valor ? 'selecionada' : ''}
          type="button"
          role="radio"
          aria-checked={nota === valor}
          aria-label={`${nota} de 5 estrelas`}
          key={nota}
          onClick={() => aoSelecionar(nota)}
        >
          ★
        </button>
      ))}
      <span>{valor ? `${valor} de 5` : 'Selecione uma nota'}</span>
    </div>
  );
}
