import { api, type Convenio } from '../api';
import { mascaraCpf, mascaraTelefone } from '../formato';
import { useCarregar } from '../hooks';
import { Campo } from './ui';

export interface DadosPaciente {
  nome: string;
  email: string;
  telefone: string;
  cpf: string;
  data_nascimento: string;
  convenio_id: number | null;
  numero_carteirinha: string;
}

export const pacienteVazio: DadosPaciente = { nome: '', email: '', telefone: '', cpf: '', data_nascimento: '', convenio_id: null, numero_carteirinha: '' };

/** Campos do cadastro de paciente (autocadastro e recepção). */
export function CamposPaciente({ valor, aoMudar, semEmail }: { valor: DadosPaciente; aoMudar: (v: DadosPaciente) => void; semEmail?: boolean }) {
  const convenios = useCarregar(() => api.get<Convenio[]>('/convenios'));
  const set = <K extends keyof DadosPaciente>(k: K, v: DadosPaciente[K]) => aoMudar({ ...valor, [k]: v });
  return (
    <div className="grade-campos">
      <Campo rotulo="Nome completo" largo>
        <input required autoComplete="name" value={valor.nome} onChange={(e) => set('nome', e.target.value)} />
      </Campo>
      {!semEmail && (
        <Campo rotulo="E-mail">
          <input type="email" required autoComplete="email" value={valor.email} onChange={(e) => set('email', e.target.value)} />
        </Campo>
      )}
      <Campo rotulo="Telefone">
        <input required inputMode="tel" autoComplete="tel" placeholder="(11) 90000-0000" value={valor.telefone} onChange={(e) => set('telefone', mascaraTelefone(e.target.value))} />
      </Campo>
      <Campo rotulo="CPF">
        <input required inputMode="numeric" placeholder="000.000.000-00" value={mascaraCpf(valor.cpf)} onChange={(e) => set('cpf', e.target.value.replace(/\D/g, ''))} />
      </Campo>
      <Campo rotulo="Data de nascimento">
        <input type="date" required max={new Date().toISOString().slice(0, 10)} value={valor.data_nascimento} onChange={(e) => set('data_nascimento', e.target.value)} />
      </Campo>
      <Campo rotulo="Convênio">
        <select value={valor.convenio_id ?? ''} onChange={(e) => set('convenio_id', e.target.value ? Number(e.target.value) : null)}>
          <option value="">Particular (sem convênio)</option>
          {convenios.dados?.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </Campo>
      {valor.convenio_id && (
        <Campo rotulo="Número da carteirinha">
          <input required value={valor.numero_carteirinha} onChange={(e) => set('numero_carteirinha', e.target.value)} />
        </Campo>
      )}
    </div>
  );
}
