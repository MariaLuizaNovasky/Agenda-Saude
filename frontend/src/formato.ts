import type { Perfil, StatusConsulta, TipoConsulta } from './api';

const p2 = (n: number) => String(n).padStart(2, '0');
export const hojeISO = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const somarDias = (iso: string, dias: number) => {
  const [a, m, d] = iso.split('-').map(Number);
  return hojeISO(new Date(a, m - 1, d + dias));
};
export const paraData = (iso: string) => {
  const [d, t = '00:00'] = iso.replace(' ', 'T').split('T');
  const [a, m, dia] = d.split('-').map(Number);
  const [h, mi, s = 0] = t.split(':').map(Number);
  return new Date(a, m - 1, dia, h, mi, s);
};

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 12/10/2026 */
export const data = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
/** 14:30 */
export const hora = (iso?: string | null) => (iso ? iso.replace(' ', 'T').slice(11, 16) : '—');
/** 12/10 às 14:30 */
export const dataHora = (iso?: string | null) => (iso ? `${data(iso).slice(0, 5)} às ${hora(iso)}` : '—');
/** sexta, 9 out */
export const diaExtenso = (iso: string) => {
  const d = paraData(iso);
  return `${DIAS[d.getDay()]}, ${d.getDate()} ${MESES[d.getMonth()]}`;
};
export const relativoDia = (iso: string) => {
  const d = iso.slice(0, 10);
  const h = hojeISO();
  if (d === h) return 'Hoje';
  if (d === somarDias(h, 1)) return 'Amanhã';
  if (d === somarDias(h, -1)) return 'Ontem';
  return diaExtenso(d);
};
export const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const cpf = (c?: string | null) => (c ? c.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—');
export const idade = (nasc?: string | null) => {
  if (!nasc) return null;
  const n = paraData(nasc);
  const h = new Date();
  let i = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) i--;
  return i;
};
export const minutosDesde = (iso: string | null, agora = new Date()) =>
  iso ? Math.max(0, Math.round((agora.getTime() - paraData(iso).getTime()) / 60000)) : 0;
export const primeiroNome = (n: string) => n.replace(/^(Dra?\.)\s+/, '$1 ').split(' ').slice(0, n.startsWith('Dr') ? 2 : 1).join(' ');

export function mascaraCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
export function mascaraTelefone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

export const STATUS: Record<StatusConsulta, string> = {
  AGENDADA: 'Agendada',
  CONFIRMADA: 'Check-in feito',
  EM_ESPERA: 'Na fila',
  EM_ATENDIMENTO: 'Em atendimento',
  FINALIZADA: 'Finalizada',
  CANCELADA: 'Cancelada',
  FALTOU: 'Faltou',
};
export const TIPO: Record<TipoConsulta, string> = { NORMAL: 'Consulta', ENCAIXE: 'Encaixe', RETORNO: 'Retorno' };
export const PERFIL: Record<Perfil, string> = {
  PACIENTE: 'Paciente',
  MEDICO: 'Médico',
  RECEPCIONISTA: 'Recepção',
  ADMIN: 'Administrador',
  FINANCEIRO: 'Financeiro',
  LABORATORIO: 'Laboratório',
  FARMACIA: 'Farmácia',
};
export const PRIORIDADE = ['Normal', 'Preferencial', 'Urgente'];
export const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
