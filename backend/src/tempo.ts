/**
 * Datas e horas no fuso da clínica (America/Sao_Paulo, sem horário de verão desde 2019: UTC-3).
 * O frontend trabalha com texto local "AAAA-MM-DDTHH:mm"; o banco guarda timestamptz.
 */
export const FUSO = '-03:00';
const OFFSET_MS = -3 * 60 * 60 * 1000;

const p2 = (n: number) => String(n).padStart(2, '0');

/** Converte um instante para o texto local "AAAA-MM-DDTHH:mm". */
function local(d: Date) {
  const x = new Date(d.getTime() + OFFSET_MS);
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`;
}

/** Agora, no horário local da clínica. */
export const agoraLocal = () => local(new Date());
/** Hoje (AAAA-MM-DD) no horário local da clínica. */
export const hojeLocal = () => agoraLocal().slice(0, 10);

/** Valor vindo do banco (timestamptz) -> "AAAA-MM-DDTHH:mm" local. */
export function deBanco(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; // coluna date: já é a data local
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : local(d);
}

/** "AAAA-MM-DDTHH:mm" local -> timestamptz com fuso, para gravar. */
export const paraBanco = (dataHora: string) => `${dataHora.slice(0, 16)}:00${FUSO}`;

/** Intervalo [início, fim) de um dia local, para filtros no banco. */
export function intervaloDia(data: string) {
  return { de: `${data}T00:00:00${FUSO}`, ate: `${somarDias(data, 1)}T00:00:00${FUSO}` };
}

export function somarDias(data: string, dias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sábado */
export const diaSemana = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();

export const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const hhmm = (min: number) => `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;

export function somarMinutos(dataHora: string, min: number) {
  const d = new Date(paraBanco(dataHora));
  return local(new Date(d.getTime() + min * 60000));
}

export const ehData = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const ehDataHora = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
