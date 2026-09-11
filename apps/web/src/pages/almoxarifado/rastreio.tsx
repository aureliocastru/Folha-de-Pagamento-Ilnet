import { useQuery } from '@tanstack/react-query';
import { api, mensagemErro } from '../../lib/api';
import type { RastreioDoNegativo } from '../../lib/types';

/** Como `quantidade` de ProdutoNoIxc — repetida aqui porque ela importa este arquivo. */
function quantidade(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

/**
 * Em qual movimento do IXC o saldo ficou negativo — a saída, a transferência,
 * a OS. É o que diz se o certo é corrigir na origem (a transferência que saiu
 * do almoxarifado errado) ou lançar a entrada que faltou.
 */
export function OndeFicouNegativo({
  produtoId,
  almoxId,
}: {
  produtoId: number;
  almoxId: number;
}) {
  const r = useQuery({
    queryKey: ['almoxarifado', 'rastreio', produtoId, almoxId],
    queryFn: async () =>
      (
        await api.get<RastreioDoNegativo>(`/almoxarifado/produtos/${produtoId}/rastreio`, {
          params: { almox: almoxId },
        })
      ).data,
    staleTime: 60_000,
  });

  if (r.isLoading) return <span className="text-[12px] text-tinta-400">lendo os movimentos…</span>;
  if (r.isError) {
    return <span className="text-[12px] text-rose-600">{mensagemErro(r.error)}</span>;
  }
  const d = r.data;
  if (!d) return null;
  if (!d.ficouNegativoEm) {
    return (
      <span className="text-[12px] text-tinta-400">
        {d.incompleto
          ? 'histórico longo demais para ler inteiro'
          : `pelos movimentos o saldo é ${quantidade(d.saldoPelosMovimentos)}`}
      </span>
    );
  }
  const m = d.ficouNegativoEm;
  const depois = d.saidasDesde.length - 1;
  return (
    <span className="text-[12px] text-tinta-600">
      ficou negativo {m.data ? `em ${m.data}, ` : ''}na <strong>{m.referencia}</strong> (
      {quantidade(m.quantidade)} → {quantidade(m.saldoDepois)})
      {depois > 0 && `, e mais ${depois} ${depois === 1 ? 'saída' : 'saídas'} depois`}
      {d.incompleto && ' — histórico lido só em parte'}
    </span>
  );
}
