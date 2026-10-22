import { useState, type FormEvent } from 'react';
import { api, type Paciente } from '../api';
import { CamposPaciente, pacienteVazio, type DadosPaciente } from '../components/CamposPaciente';
import { Botao, Cabecalho, Campo, Carregando, Modal, useAcao, Vazio } from '../components/ui';
import { cpf, data, idade } from '../formato';
import { useCarregar } from '../hooks';

// Gerenciar cadastro de pacientes (recepção)
export function Pacientes() {
  const [busca, setBusca] = useState('');
  const { dados, carregando, recarregar } = useCarregar(() => api.get<Paciente[]>(`/pacientes?busca=${encodeURIComponent(busca)}`), [busca]);
  const [editando, setEditando] = useState<Paciente | 'novo' | null>(null);

  return (
    <>
      <Cabecalho titulo="Pacientes" acoes={<Botao onClick={() => setEditando('novo')}>Cadastrar paciente</Botao>} />
      <div className="filtros">
        <input type="search" className="busca-larga" placeholder="Buscar por nome, CPF ou e-mail" aria-label="Buscar paciente" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {carregando ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio titulo="Nenhum paciente encontrado" />
      ) : (
        <table className="tabela">
          <thead><tr><th>Nome</th><th>CPF</th><th>Nascimento</th><th>Contato</th><th>Convênio</th><th /></tr></thead>
          <tbody>
            {dados.map((p) => (
              <tr key={p.id}>
                <td data-rotulo="Nome"><strong>{p.nome}</strong></td>
                <td data-rotulo="CPF">{cpf(p.cpf)}</td>
                <td data-rotulo="Nascimento">{data(p.data_nascimento)} ({idade(p.data_nascimento)} anos)</td>
                <td data-rotulo="Contato">{p.telefone}<div className="texto-suave">{p.email}</div></td>
                <td data-rotulo="Convênio">{p.convenio_nome ? `${p.convenio_nome}, ${p.numero_carteirinha}` : 'Particular'}</td>
                <td className="celula-acoes"><Botao variante="secundario" onClick={() => setEditando(p)}>Editar</Botao></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ModalPaciente paciente={editando} aoFechar={() => setEditando(null)} aoConcluir={() => { setEditando(null); recarregar(); }} />
    </>
  );
}

function ModalPaciente({ paciente, aoFechar, aoConcluir }: { paciente: Paciente | 'novo' | null; aoFechar: () => void; aoConcluir: () => void }) {
  const novo = paciente === 'novo';
  const [chave, setChave] = useState<string | null>(null);
  const [dados, setDados] = useState<DadosPaciente>(pacienteVazio);
  const [senha, setSenha] = useState('');
  const [executar, executando] = useAcao();

  const k = paciente === null ? null : novo ? 'novo' : String(paciente.id);
  if (k !== chave) {
    setChave(k);
    setSenha('');
    setDados(
      paciente && paciente !== 'novo'
        ? { nome: paciente.nome, email: paciente.email, telefone: paciente.telefone ?? '', cpf: paciente.cpf, data_nascimento: paciente.data_nascimento, convenio_id: paciente.convenio_id, numero_carteirinha: paciente.numero_carteirinha ?? '' }
        : pacienteVazio,
    );
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const corpo = { ...dados, numero_carteirinha: dados.numero_carteirinha || null };
    const r = novo
      ? await executar(() => api.post('/pacientes', { ...corpo, senha_temporaria: senha }), 'Paciente cadastrado. Informe a senha temporária a ele.')
      : await executar(() => api.put(`/pacientes/${(paciente as Paciente).id}`, corpo), 'Cadastro atualizado.');
    if (r) aoConcluir();
  };

  return (
    <Modal aberto={paciente !== null} aoFechar={aoFechar} titulo={novo ? 'Cadastrar paciente' : 'Editar paciente'} largo>
      <form className="form" onSubmit={enviar}>
        <CamposPaciente valor={dados} aoMudar={setDados} />
        {novo && (
          <Campo rotulo="Senha temporária" dica="O paciente cria a própria senha no primeiro acesso. Mínimo de 8 caracteres, com letras e números.">
            <input required minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} />
          </Campo>
        )}
        <div className="modal-acoes">
          <Botao type="button" variante="secundario" onClick={aoFechar}>Voltar</Botao>
          <Botao type="submit" carregando={executando}>{novo ? 'Cadastrar' : 'Salvar'}</Botao>
        </div>
      </form>
    </Modal>
  );
}
