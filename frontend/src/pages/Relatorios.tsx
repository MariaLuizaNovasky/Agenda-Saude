import { useState } from 'react';
import { api, qs } from '../api';
import { Abas, Cabecalho, Campo, Carregando, Vazio } from '../components/ui';
import { data, hojeISO, hora, PERFIL, somarDias } from '../formato';
import { useCarregar } from '../hooks';
import type { Perfil } from '../api';

interface LinhaRelatorio { medico_nome: string; total: number; finalizadas: number; canceladas: number; faltas: number; encaixes: number; retornos: number; espera_media_min: number | null }
interface Log { id: number; usuario_nome: string | null; usuario_tipo: Perfil | null; entidade: string; registro_id: number | null; acao: string; detalhes: string | null; data_hora: string }

const ACOES: Record<string, string> = {
  LOGIN: 'Entrou no sistema', CADASTRO_PACIENTE: 'Criou a própria conta', AGENDOU: 'Agendou', REAGENDOU: 'Remarcou', CANCELOU: 'Cancelou',
  CHECK_IN: 'Fez check-in', CONFIRMOU_PRESENCA: 'Confirmou presença', MARCOU_FALTA: 'Registrou falta', INICIOU_ATENDIMENTO: 'Iniciou atendimento',
  FINALIZOU_ATENDIMENTO: 'Finalizou atendimento', VOLTOU_FILA: 'Devolveu à fila', INFORMOU_ATRASO: 'Informou atraso', EMITIU: 'Emitiu documento',
  SOLICITOU: 'Pediu exame', ATUALIZOU_STATUS: 'Atualizou exame', ANEXOU_RESULTADO: 'Anexou resultado', REGISTROU_RETIRADA: 'Registrou retirada',
  GEROU: 'Gerou boleto', DEU_BAIXA: 'Deu baixa', CRIOU_USUARIO: 'Criou usuário', EDITOU_USUARIO: 'Editou usuário', GEROU_SENHA_TEMPORARIA: 'Gerou senha temporária',
  PEDIU_RECUPERACAO_SENHA: 'Pediu nova senha', ALTEROU_SENHA: 'Alterou a senha', CRIOU: 'Criou', EDITOU: 'Editou', EXCLUIU: 'Excluiu', ATUALIZOU: 'Atualizou',
};

// Visualizar relatórios e histórico de alterações
export function Relatorios() {
  const [aba, setAba] = useState<'consultas' | 'log'>('consultas');
  const [inicio, setInicio] = useState(somarDias(hojeISO(), -30));
  const [fim, setFim] = useState(hojeISO());
  const [entidade, setEntidade] = useState('');
  const rel = useCarregar(() => (aba === 'consultas' ? api.get<LinhaRelatorio[]>(`/relatorios/consultas${qs({ inicio, fim })}`) : Promise.resolve([])), [aba, inicio, fim]);
  const log = useCarregar(() => (aba === 'log' ? api.get<Log[]>(`/relatorios/log${qs({ entidade })}`) : Promise.resolve([])), [aba, entidade]);

  const tot = rel.dados?.reduce((a, l) => ({ total: a.total + l.total, finalizadas: a.finalizadas + l.finalizadas, faltas: a.faltas + l.faltas, canceladas: a.canceladas + l.canceladas }), { total: 0, finalizadas: 0, faltas: 0, canceladas: 0 });

  return (
    <>
      <Cabecalho titulo="Relatórios" />
      <Abas valor={aba} aoMudar={setAba} opcoes={[{ valor: 'consultas', rotulo: 'Consultas por médico' }, { valor: 'log', rotulo: 'Histórico de alterações' }]} />
      {aba === 'consultas' ? (
        <>
          <div className="filtros">
            <Campo rotulo="De"><input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></Campo>
            <Campo rotulo="Até"><input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
          </div>
          {rel.carregando ? <Carregando /> : !rel.dados?.length ? <Vazio titulo="Nenhuma consulta no período" /> : (
            <table className="tabela">
              <thead><tr><th>Médico</th><th className="num">Total</th><th className="num">Finalizadas</th><th className="num">Faltas</th><th className="num">Canceladas</th><th className="num">Encaixes</th><th className="num">Retornos</th><th className="num">Espera média</th></tr></thead>
              <tbody>
                {rel.dados.map((l) => (
                  <tr key={l.medico_nome}>
                    <td data-rotulo="Médico"><strong>{l.medico_nome}</strong></td>
                    <td data-rotulo="Total" className="num">{l.total}</td>
                    <td data-rotulo="Finalizadas" className="num">{l.finalizadas}</td>
                    <td data-rotulo="Faltas" className="num">{l.faltas}</td>
                    <td data-rotulo="Canceladas" className="num">{l.canceladas}</td>
                    <td data-rotulo="Encaixes" className="num">{l.encaixes}</td>
                    <td data-rotulo="Retornos" className="num">{l.retornos}</td>
                    <td data-rotulo="Espera média" className="num">{l.espera_media_min != null ? `${l.espera_media_min} min` : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {tot && (
                <tfoot><tr><td>Total</td><td className="num">{tot.total}</td><td className="num">{tot.finalizadas}</td><td className="num">{tot.faltas}</td><td className="num">{tot.canceladas}</td><td colSpan={3} /></tr></tfoot>
              )}
            </table>
          )}
        </>
      ) : (
        <>
          <div className="filtros">
            <select aria-label="Área" value={entidade} onChange={(e) => setEntidade(e.target.value)}>
              <option value="">Todas as áreas</option>
              {['consultas', 'usuarios', 'pacientes', 'exames', 'documentos_medicos', 'boletos', 'prontuarios', 'lista_espera', 'disponibilidades', 'especialidades', 'convenios'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}
            </select>
          </div>
          {log.carregando ? <Carregando /> : !log.dados?.length ? <Vazio titulo="Nenhum registro" /> : (
            <table className="tabela tabela-compacta">
              <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Registro</th></tr></thead>
              <tbody>
                {log.dados.map((l) => (
                  <tr key={l.id}>
                    <td data-rotulo="Quando">{data(l.data_hora)} {hora(l.data_hora)}</td>
                    <td data-rotulo="Quem">{l.usuario_nome ?? 'Sistema'}{l.usuario_tipo && <div className="texto-suave">{PERFIL[l.usuario_tipo]}</div>}</td>
                    <td data-rotulo="O quê">{ACOES[l.acao] ?? l.acao}</td>
                    <td data-rotulo="Registro" className="texto-suave">{l.entidade.replace('_', ' ')}{l.registro_id ? ` nº ${l.registro_id}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
