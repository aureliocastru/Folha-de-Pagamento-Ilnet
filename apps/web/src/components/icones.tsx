import type { ComponentType } from 'react';

/**
 * Traço de 1.7 para casar com o peso do texto da interface. Os mesmos ícones
 * servem ao menu lateral e aos cartões da tela de módulos, por isso vivem aqui
 * e não dentro de uma tela.
 */
export type IconeProps = { className?: string };
export type Icone = ComponentType<IconeProps>;

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconePainel({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function IconePessoas({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.5A5.5 5.5 0 0 1 20.5 20" />
    </svg>
  );
}

/** Um dia marcado no calendário: o trabalho que se conta por diária. */
export function IconeDia({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3M16 3v3" />
      <circle cx="12" cy="14.5" r="2" />
    </svg>
  );
}

export function IconeMoeda({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.5a2.6 2.6 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.8 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.6 2.6 0 0 1-2.5-1.5" />
      <path d="M12 6.2v1.8M12 16v1.8" />
    </svg>
  );
}

/** Sol: o descanso a que a pessoa tem direito. */
export function IconeSol({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2" />
      <path d="M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </svg>
  );
}

/** Calendário com a seta que volta: a conta que se repete todo mês. */
export function IconeCalendarioVolta({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3M16 3v3" />
      <path d="M9 15.5a3 3 0 1 0 1-2.6" />
      <path d="M9.4 12.2v2.2h2.2" />
    </svg>
  );
}

/** Lua: o tema escuro, para quem fecha o mês depois que o sol se pôs. */
export function IconeLua({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z" />
    </svg>
  );
}

export function IconeCalculo({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 7.5h8" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" />
    </svg>
  );
}

/** A seta que volta uma tela. */
export function IconeVoltar({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M15 5.5 8.5 12l6.5 6.5" />
    </svg>
  );
}

/** Uma pasta de arquivo: a estante de documentos do RH. */
export function IconePasta({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 8a2 2 0 0 1 2-2h3.1l1.9 2.3h8a2 2 0 0 1 2 2v7.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/**
 * Um prédio de janelas: a empresa, e não uma pessoa da casa.
 *
 * O menu do RH lista gente; a pasta da empresa fica no meio deles e precisa se
 * distinguir de relance. Pasta amarela ali diria "mais uma pasta", que é o que
 * ela justamente não é.
 */
export function IconePredio({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 20.5V5.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v15" />
      <path d="M15.5 10.5h2a2 2 0 0 1 2 2v8" />
      <path d="M3 20.5h18" />
      <path d="M8 7.5h1.5M8 11h1.5M8 14.5h1.5M12 7.5h1.5M12 11h1.5M12 14.5h1.5" />
    </svg>
  );
}

/** Uma folha de papel com a ponta dobrada: um documento guardado. */
export function IconeDocumento({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M8.5 13.5h7M8.5 16.5h4.5" />
    </svg>
  );
}

export function IconeSaida({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10.5h19" />
      <path d="M6.5 15h3" />
    </svg>
  );
}

export function IconeRecibo({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 3.5h14v17l-2.3-1.6-2.3 1.6-2.4-1.6L9.6 20.5 7.3 19 5 20.5z" />
      <path d="M9 8.5h6M9 12.5h6" />
    </svg>
  );
}

/** Guia de imposto: papel timbrado com o código de barras embaixo. */
export function IconeGuia({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5.5 2.5h13v19h-13z" />
      <path d="M9 7h6M9 10.5h6" />
      <path d="M9 16v2.5M11.5 16v2.5M14 16v2.5" />
    </svg>
  );
}

export function IconeChave({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.9 12.1 8.1-8.1" />
      <path d="m17 6 2.5 2.5" />
      <path d="m14.5 8.5 2.5 2.5" />
    </svg>
  );
}

export function IconeEngrenagem({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  );
}

/** Quatro quadrados iguais: o conjunto dos módulos, nenhum em destaque. */
export function IconeGrade({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </svg>
  );
}

/** Etiqueta com o furo do barbante: a categoria pendurada num gasto. */
export function IconeEtiqueta({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20.5 12.4 12.4 20.5a2 2 0 0 1-2.8 0l-6.1-6.1a2 2 0 0 1-.6-1.5l.3-6.2a2 2 0 0 1 1.9-1.9l6.2-.3a2 2 0 0 1 1.5.6l6.1 6.1a2 2 0 0 1 0 2.8z" />
      <circle cx="8.2" cy="8.2" r="1.4" />
    </svg>
  );
}

/** Duas setas em sentidos opostos: o dinheiro que troca de conta. */
export function IconeTransferencia({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 8.5h13" />
      <path d="m13.5 5 3.5 3.5-3.5 3.5" />
      <path d="M20 15.5H7" />
      <path d="M10.5 12 7 15.5l3.5 3.5" />
    </svg>
  );
}

/** Cadeado fechado: a tela que só abre com senha. */
export function IconeCadeado({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}

/** Gaveta de dinheiro, com a fresta e o puxador: o caixa que se bate. */
export function IconeCaixa({ className }: IconeProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="7.5" width="19" height="12" rx="2" />
      <path d="M2.5 11.5h19" />
      <path d="M10 15.5h4" />
      <path d="M6.5 7.5 8 4.5h8l1.5 3" />
    </svg>
  );
}

