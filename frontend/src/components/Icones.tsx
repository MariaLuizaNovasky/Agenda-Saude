/* Ícones, enfeites e símbolo da marca. Só visual: nenhum dado ou lógica aqui. */
import type React from 'react';

export function Simbolo({ tamanho = 18 }: { tamanho?: number }) {
  return (
    <span className="marca-simbolo" aria-hidden>
      <svg viewBox="0 0 24 24" width={tamanho} height={tamanho}>
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" style={{ color: 'var(--marca-tinta)' }} />
      </svg>
    </span>
  );
}

/** Estrelinha de quatro pontas, só enfeite. */
export function Estrela({ style, tamanho = 22 }: { style?: React.CSSProperties; tamanho?: number }) {
  return (
    <svg className="estrela" viewBox="0 0 24 24" width={tamanho} height={tamanho} style={style} aria-hidden>
      <path d="M12 0c.9 6.5 5 10.9 12 12-7 1.1-11.1 5.5-12 12-.9-6.5-5-10.9-12-12C7 10.9 11.1 6.5 12 0z" fill="currentColor" />
    </svg>
  );
}

export function Bolinha({ cor, tamanho, style }: { cor: string; tamanho: number; style?: React.CSSProperties }) {
  return <span className="bolinha" aria-hidden style={{ background: cor, width: tamanho, height: tamanho, ...style }} />;
}

/** Seta diagonal (↘) usada no círculo de atalho. */
export function SetaDiagonal() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M7 7l10 10M17 9v8H9" />
    </svg>
  );
}

/** Traços (24×24) de cada ícone do menu, por rota. */
const TRACOS: Record<string, string> = {
  '/inicio': 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z',
  '/agendar': 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8.5 4v4M15.5 4v4M12 13v4M10 15h4',
  '/consultas': 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8.5 4v4M15.5 4v4M8 14h3M8 17h6',
  '/agenda': 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8.5 4v4M15.5 4v4M8 14h3M8 17h6',
  '/fila': 'M6 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3.5 19v-4a2.5 2.5 0 0 1 5 0v4M9.5 19v-4a2.5 2.5 0 0 1 5 0v4M15.5 19v-4a2.5 2.5 0 0 1 5 0v4',
  '/historico': 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3h3M12 8v4.5l3 1.8',
  '/lista-espera': 'M7 3.5h10M7 20.5h10M8 3.5c0 4 8 4.5 8 8.5s-8 4.5-8 8.5M16 3.5c0 2.2-2 3.4-4 4.6',
  '/boletos': 'M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3zM9 8h6M9 11.5h6M9 15h3.5',
  '/retornos': 'M9 14 4.5 9.5 9 5M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3',
  '/pacientes': 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20a7 7 0 0 1 14 0',
  '/dashboard': 'M4 20h16M7 20v-6M12 20V8M17 20v-9',
  '/usuarios': 'M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM3 20a6 6 0 0 1 12 0M16.5 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.5V20',
  '/cadastros': 'M5 4.5h10.5L19 8v11.5H5zM15 4.5V8.5h4M8.5 12.5h7M8.5 16h5',
  '/relatorios': 'M6 3.5h8.5L18 7v13.5H6zM14 3.5V7.5h4M9 17v-3M12 17v-6M15 17v-2',
  '/atendimentos': 'M7 4v5a4 4 0 0 0 8 0V4M7 4H5.5M15 4h1.5M11 13v2.5a4.5 4.5 0 0 0 9 0v-1M20 14.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  '/disponibilidade': 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 2',
  '/exames': 'M9.5 3.5h5M10.5 3.5v6L5.5 18a1.7 1.7 0 0 0 1.5 2.5h10a1.7 1.7 0 0 0 1.5-2.5l-5-8.5v-6M8 14.5h8',
  '/receitas': 'M10.2 4.8a4 4 0 0 1 5.7 5.7l-5.4 5.4a4 4 0 0 1-5.7-5.7zM7.5 7.5l5.7 5.7',
  '/ajuda': 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.5A2.5 2.5 0 0 1 4 13zM8 8h8M8 11.5h5',
  '/avaliacoes': 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
};

export function IconeMenu({ rota }: { rota: string }) {
  const d = TRACOS[rota];
  if (!d) return null;
  return (
    <svg className="menu-icone" viewBox="0 0 24 24" aria-hidden>
      <path d={d} />
    </svg>
  );
}
