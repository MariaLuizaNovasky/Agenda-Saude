// Cliente HTTP da API do Agenda-Saúde
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export type Perfil = 'PACIENTE' | 'MEDICO' | 'RECEPCIONISTA' | 'ADMIN' | 'FINANCEIRO' | 'LABORATORIO' | 'FARMACIA';

export type StatusConsulta = 'AGENDADA' | 'CONFIRMADA' | 'EM_ESPERA' | 'EM_ATENDIMENTO' | 'FINALIZADA' | 'CANCELADA' | 'FALTOU';
export type TipoConsulta = 'NORMAL' | 'ENCAIXE' | 'RETORNO';

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  telefone: string | null;
  tipo: Perfil;
  troca_senha_obrigatoria: boolean;
  cpf?: string | null;
  data_nascimento?: string | null;
  convenio_id?: number | null;
  convenio_nome?: string | null;
  numero_carteirinha?: string | null;
  crm?: string | null;
  crm_uf?: string | null;
  crm_verificado?: number | null;
}

export interface Consulta {
  id: number;
  paciente_id: number;
  medico_id: number;
  data_hora: string;
  tipo: TipoConsulta;
  status: StatusConsulta;
  check_in_em: string | null;
  atraso_min: number;
  anotacoes: string | null;
  motivo_cancelamento: string | null;
  iniciada_em: string | null;
  finalizada_em: string | null;
  paciente_nome: string;
  paciente_telefone: string | null;
  paciente_cpf: string;
  medico_nome: string;
  crm: string;
  crm_uf: string;
  especialidades: string | null;
  posicao?: number | null;
  previsao?: string;
}

export interface Especialidade { id: number; nome: string; total_medicos?: number }
export interface Convenio { id: number; nome: string; registro_ans: string }
export interface Medico {
  id: number;
  nome: string;
  crm: string;
  crm_uf: string;
  crm_verificado: number;
  especialidades: string | null;
  especialidade_ids: string | null;
  atraso_hoje: number | null;
}
export interface Paciente {
  id: number;
  nome: string;
  email: string;
  telefone: string | null;
  ativo: number;
  cpf: string;
  data_nascimento: string;
  convenio_id: number | null;
  convenio_nome: string | null;
  numero_carteirinha: string | null;
}
export interface Horario { data_hora: string; livre: boolean }
export interface Disponibilidade { id: number; medico_id: number; dia_semana: number; hora_inicio: string; hora_fim: string; duracao_min: number }
export interface Exame {
  id: number;
  prontuario_id: number;
  consulta_id: number;
  tipo: string;
  status: 'SOLICITADO' | 'COLETADO' | 'CONCLUIDO';
  data_solicitacao: string;
  data_resultado: string | null;
  arquivo_resultado: string | null;
  arquivo_nome: string | null;
  prazo_retorno_dias: number | null;
  data_limite_retorno: string | null;
  paciente_id: number;
  paciente_nome: string;
  paciente_cpf: string;
  medico_id: number;
  medico_nome: string;
}
export interface Documento {
  id: number;
  consulta_id: number | null;
  tipo: 'RECEITA' | 'ATESTADO';
  conteudo: string;
  data_emissao: string;
  data_retirada: string | null;
  paciente_id: number;
  paciente_nome: string;
  paciente_cpf: string;
  medico_nome: string | null;
  crm: string | null;
  crm_uf: string | null;
}
export interface Boleto {
  id: number;
  consulta_id: number;
  convenio_id: number | null;
  valor: number;
  vencimento: string;
  status: 'PENDENTE' | 'PAGO' | 'CANCELADO';
  data_hora: string;
  consulta_tipo: TipoConsulta;
  paciente_nome: string;
  paciente_cpf: string;
  medico_nome: string;
  convenio_nome: string | null;
  vencido: number;
}
export interface ItemListaEspera {
  id: number;
  paciente_id: number;
  especialidade_id: number;
  especialidade_nome: string;
  paciente_nome: string;
  paciente_telefone: string | null;
  data_solicitacao: string;
  prioridade: number;
  observacao: string | null;
}
export interface Notificacao { id: number; titulo: string; mensagem: string; link: string | null; lida: number; criado_em: string }

export class ErroApi extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const CHAVE_TOKEN = 'agenda-saude:token';
let token: string | null = null;
try {
  token = localStorage.getItem(CHAVE_TOKEN);
} catch {
  token = null;
}

export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(CHAVE_TOKEN, t);
    else localStorage.removeItem(CHAVE_TOKEN);
  } catch {
    /* armazenamento indisponível: a sessão fica só em memória */
  }
}

let aoExpirar: (() => void) | null = null;
export const definirAoExpirar = (fn: () => void) => {
  aoExpirar = fn;
};

async function req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (corpo instanceof FormData) body = corpo;
  else if (corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  let resp: Response;
  try {
    resp = await fetch(`${API_URL}/api${caminho}`, { method: metodo, headers, body });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor. Verifique se a API está rodando.');
  }
  const dados = resp.headers.get('content-type')?.includes('application/json') ? await resp.json() : null;
  if (!resp.ok) {
    if (resp.status === 401 && token && caminho !== '/auth/login') aoExpirar?.();
    throw new ErroApi(resp.status, dados?.erro ?? `Erro ${resp.status}`);
  }
  return dados as T;
}

export const api = {
  get: <T>(c: string) => req<T>('GET', c),
  post: <T>(c: string, corpo?: unknown) => req<T>('POST', c, corpo ?? {}),
  put: <T>(c: string, corpo?: unknown) => req<T>('PUT', c, corpo ?? {}),
  del: <T>(c: string) => req<T>('DELETE', c),
};

/** Monta query string ignorando valores vazios. */
export function qs(params: Record<string, string | number | undefined | null | false>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v));
  const r = s.toString();
  return r ? `?${r}` : '';
}

/** Baixa um arquivo autenticado (resultado de exame). */
export async function baixarArquivo(caminho: string, nome: string) {
  const resp = await fetch(`${API_URL}/api${caminho}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!resp.ok) {
    const d = await resp.json().catch(() => null);
    throw new ErroApi(resp.status, d?.erro ?? 'Não foi possível baixar o arquivo.');
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
