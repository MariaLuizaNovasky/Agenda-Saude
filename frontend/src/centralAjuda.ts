import type { Perfil } from './api';

export type StatusSolicitacao = 'ABERTA' | 'EM_ATENDIMENTO' | 'AGUARDANDO_PACIENTE' | 'RESOLVIDA';
export type NivelSolicitacao = 'RECEPCAO' | 'ADMIN';

export interface MensagemSolicitacao {
  id: string;
  autorId: number;
  autorNome: string;
  perfil: Perfil;
  texto: string;
  criadaEm: string;
}

export interface SolicitacaoAjuda {
  id: string;
  pacienteId: number;
  pacienteNome: string;
  assunto: string;
  categoria: string;
  mensagemInicial: string;
  criadaEm: string;
  status: StatusSolicitacao;
  nivel: NivelSolicitacao;
  mensagens: MensagemSolicitacao[];
}

const CHAVE_SOLICITACOES = 'agenda-saude:central-ajuda';
const EVENTO_SOLICITACOES = 'agenda-saude:central-ajuda-atualizada';

const ehObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null;

function ehMensagem(valor: unknown): valor is MensagemSolicitacao {
  if (!ehObjeto(valor)) return false;
  return typeof valor.id === 'string'
    && typeof valor.autorId === 'number'
    && typeof valor.autorNome === 'string'
    && ['PACIENTE', 'MEDICO', 'RECEPCIONISTA', 'ADMIN', 'FINANCEIRO', 'LABORATORIO', 'FARMACIA'].includes(String(valor.perfil))
    && typeof valor.texto === 'string'
    && typeof valor.criadaEm === 'string';
}

function ehSolicitacao(valor: unknown): valor is SolicitacaoAjuda {
  if (!ehObjeto(valor)) return false;
  return typeof valor.id === 'string'
    && typeof valor.pacienteId === 'number'
    && typeof valor.pacienteNome === 'string'
    && typeof valor.assunto === 'string'
    && typeof valor.categoria === 'string'
    && typeof valor.mensagemInicial === 'string'
    && typeof valor.criadaEm === 'string'
    && ['ABERTA', 'EM_ATENDIMENTO', 'AGUARDANDO_PACIENTE', 'RESOLVIDA'].includes(String(valor.status))
    && ['RECEPCAO', 'ADMIN'].includes(String(valor.nivel))
    && Array.isArray(valor.mensagens)
    && valor.mensagens.every(ehMensagem);
}

export function lerSolicitacoes(): SolicitacaoAjuda[] {
  const bruto = localStorage.getItem(CHAVE_SOLICITACOES);
  if (!bruto) return [];
  const dados: unknown = JSON.parse(bruto);
  if (!Array.isArray(dados) || !dados.every(ehSolicitacao)) {
    throw new Error('Os dados da central de ajuda estão em formato inválido.');
  }
  return dados;
}

export function salvarSolicitacoes(solicitacoes: SolicitacaoAjuda[]) {
  localStorage.setItem(CHAVE_SOLICITACOES, JSON.stringify(solicitacoes));
  window.dispatchEvent(new Event(EVENTO_SOLICITACOES));
}

export function ouvirSolicitacoes(aoAtualizar: () => void) {
  const atualizar = () => aoAtualizar();
  window.addEventListener(EVENTO_SOLICITACOES, atualizar);
  window.addEventListener('storage', atualizar);
  return () => {
    window.removeEventListener(EVENTO_SOLICITACOES, atualizar);
    window.removeEventListener('storage', atualizar);
  };
}

export const nomeStatusSolicitacao: Record<StatusSolicitacao, string> = {
  ABERTA: 'Aberta',
  EM_ATENDIMENTO: 'Em atendimento',
  AGUARDANDO_PACIENTE: 'Aguardando paciente',
  RESOLVIDA: 'Resolvida',
};
