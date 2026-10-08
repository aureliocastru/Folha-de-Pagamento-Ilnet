import { estaClassificado, etiquetaDoTitulo } from '../lib/categorias';
import { formatBRL } from '../lib/format';
import type { EtiquetaDaConta, FatiaDoRateio } from '../lib/types';
import { Selo } from './ui';

/**
 * A categoria do título, no selo da linha.
 *
 * A fatura do cartão e a conta de várias notas falam pelas categorias de
 * dentro: todas na mesma, o selo é ela; em mais de uma, diz em quantas se
 * divide, e o nome de cada uma fica no título do selo.
 */
export function SeloDaCategoria({
  titulo,
  avisarSemCategoria = false,
}: {
  titulo: { classificacao: EtiquetaDaConta | null; rateio?: FatiaDoRateio[] };
  /** Mostra "sem classificação" quando falta — na lista do que ainda se paga. */
  avisarSemCategoria?: boolean;
}) {
  if (titulo.rateio && titulo.rateio.length > 1) {
    return (
      <Selo
        pequeno
        tom={estaClassificado(titulo) ? 'info' : 'atencao'}
        titulo={titulo.rateio
          .map((f) => `${f.classificacao?.nome ?? 'Sem categoria'}: ${formatBRL(f.valor)}`)
          .join(' · ')}
      >
        {titulo.rateio.length} categorias
      </Selo>
    );
  }

  const etiqueta = etiquetaDoTitulo(titulo);
  if (etiqueta) {
    return (
      <Selo pequeno tom="info" titulo={nomeCompleto(etiqueta)}>
        {etiqueta.nome}
      </Selo>
    );
  }

  return avisarSemCategoria ? (
    <Selo
      pequeno
      tom="atencao"
      titulo="Sem isto o débito fica de fora dos relatórios por categoria — clique para escolher"
    >
      sem classificação
    </Selo>
  ) : null;
}

/**
 * As categorias de dentro do título, na ficha dele: uma por linha, com quanto
 * cabe em cada uma quando são mais de uma.
 */
export function CategoriasDeDentro({ fatias }: { fatias: FatiaDoRateio[] }) {
  return (
    <ul className="space-y-0.5 text-sm text-tinta-700">
      {fatias.map((f, i) => (
        <li key={f.classificacao?.id ?? i} className="flex justify-between gap-3">
          <span>{f.classificacao ? nomeCompleto(f.classificacao) : 'Sem categoria'}</span>
          {fatias.length > 1 && <span className="valor">{formatBRL(f.valor)}</span>}
        </li>
      ))}
    </ul>
  );
}

function nomeCompleto(etiqueta: EtiquetaDaConta): string {
  return etiqueta.grupo ? `${etiqueta.grupo.nome} · ${etiqueta.nome}` : etiqueta.nome;
}
