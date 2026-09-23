import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Aviso, Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { ContaAberta } from '../../lib/types';
import { FormularioEmPassos } from '../../components/FormularioEmPassos';

/**
 * Transforma uma conta que já está no IXC numa despesa que se repete todo mês.
 *
 * O trabalho de verdade aqui não é criar a regra — é o que vem junto: quem
 * pagava um serviço mensal antes disto existir costuma ter lançado as próximas
 * de uma vez, com o mesmo valor e o mesmo fornecedor. Se a regra passar a
 * gerar por cima delas, o mês terá duas contas do mesmo serviço. Por isso a
 * tela procura essas irmãs futuras e oferece apagá-las na mesma confirmação.
 */
export function TornarRecorrente({
  conta,
  /** Todas as contas em aberto — é aqui que se acham as irmãs futuras. */
  todas,
  onFechar,
}: {
  conta: ContaAberta;
  todas: ContaAberta[];
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [apagarIrmas, setApagarIrmas] = useState(true);
  const [soDiasUteis, setSoDiasUteis] = useState(true);
  const [feito, setFeito] = useState<{ apagadas: number } | null>(null);

  /**
   * As próximas do mesmo fornecedor, mesmo valor, vencendo depois desta. É o
   * desenho de um serviço mensal lançado de uma vez — a regra vai cobrir
   * exatamente esses meses.
   */
  const irmas = todas.filter(
    (c) =>
      c.idFnApagar !== conta.idFnApagar &&
      c.fornecedor.id === conta.fornecedor.id &&
      Math.abs(c.valorAberto - conta.valorAberto) < 0.005 &&
      !!c.vencimento &&
      !!conta.vencimento &&
      String(c.vencimento).slice(0, 10) > String(conta.vencimento).slice(0, 10),
  );

  const proximoVencimento = mesSeguinte(
    String(conta.vencimento ?? '').slice(0, 10),
  );

  const ativar = useMutation({
    mutationFn: async () => {
      await api.post('/recorrentes', {
        idFornecedorIxc: conta.fornecedor.id,
        fornecedorNome: conta.fornecedor.nome,
        valor: conta.valorAberto,
        observacao: conta.observacao || conta.fornecedor.nome,
        proximoVencimento,
        categoriaId: conta.classificacao?.id ?? undefined,
        apenasDiasUteis: soDiasUteis,
      });

      let apagadas = 0;
      if (apagarIrmas && irmas.length > 0) {
        const { data } = await api.post<{ apagados: number[] }>(
          '/contas-abertas/excluir-lote',
          { idsFnApagar: irmas.map((c) => c.idFnApagar) },
        );
        apagadas = data.apagados.length;
      }
      return { apagadas };
    },
    onSuccess: (r) => {
      setFeito(r);
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['recorrentes'] });
    },
  });

  if (feito) {
    return (
      <Janela titulo="Repetição ligada" onFechar={onFechar}>
        <p className="font-display text-lg font-semibold text-tinta-900">
          {conta.fornecedor.nome} passa a se repetir todo mês
        </p>
        <p className="mt-1 text-sm text-tinta-500">
          A próxima conta nasce sozinha no IXC em torno de{' '}
          {formatarDia(proximoVencimento)}, cinco dias antes de vencer.
          {feito.apagadas > 0 &&
            ` ${feito.apagadas} conta(s) futuras iguais foram apagadas, para não duplicar o mês.`}
        </p>
        <div className="mt-5 flex justify-end">
          <button onClick={onFechar} className="btn btn-primario">
            Fechar
          </button>
        </div>
      </Janela>
    );
  }

  return (
    <Janela titulo="Repetir todo mês" onFechar={onFechar}>
      <FormularioEmPassos>
      <div className="rounded-2xl bg-tinta-50 p-4">
        <div className="text-sm text-tinta-500">Vai se repetir</div>
        <div className="font-display text-lg font-semibold text-tinta-900">
          {conta.fornecedor.nome}
        </div>
        <div className="valor mt-1 text-2xl">
          {formatBRL(conta.valorAberto)} <span className="text-base">/mês</span>
        </div>
        <p className="mt-2 text-sm text-tinta-500">
          Esta conta continua como está. A partir dela, todo mês uma nova nasce
          no IXC <strong>5 dias antes de vencer</strong>, já aprovada — a
          próxima vencendo em {formatarDia(proximoVencimento)}.
        </p>

        <label className="mt-3 flex w-fit items-center gap-2 text-sm text-tinta-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={soDiasUteis}
            onChange={(e) => setSoDiasUteis(e.target.checked)}
          />
          Só em dia útil — vencimento em fim de semana ou feriado nacional passa
          para o próximo dia em que o banco abre
        </label>
      </div>

      {/* As irmãs futuras: o ponto que liga as duas pontas. */}
      {irmas.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Achei {irmas.length} conta(s) futuras iguais a esta
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Mesmo fornecedor, mesmo valor, vencendo depois. Se elas ficarem, o
            mês vai ter duas contas do mesmo serviço — a que já existe e a que a
            repetição vai gerar.
          </p>

          <div className="mt-3 max-h-40 overflow-y-auto rolagem-fina rounded-lg bg-papel/60">
            {irmas.map((c) => (
              <div
                key={c.idFnApagar}
                className="item-dividido flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
              >
                <span className="num text-tinta-600">
                  {c.vencimento ? formatData(c.vencimento) : '—'}
                </span>
                <span className="truncate text-xs text-tinta-500">
                  {c.observacao}
                </span>
                <span className="valor whitespace-nowrap">
                  {formatBRL(c.valorAberto)}
                </span>
              </div>
            ))}
          </div>

          <label className="mt-3 flex w-fit items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-600"
              checked={apagarIrmas}
              onChange={(e) => setApagarIrmas(e.target.checked)}
            />
            Apagar essas {irmas.length} no IXC — a repetição cobre esses meses
          </label>
        </div>
      )}

      {ativar.isError && <Aviso tom="erro">{mensagemErro(ativar.error)}</Aviso>}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-tinta-400">
          Dá para mudar o valor, desligar ou apagar em Recorrentes.
        </span>
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => ativar.mutate()}
          disabled={ativar.isPending}
          className="btn btn-primario"
        >
          {ativar.isPending
            ? 'Ligando…'
            : irmas.length > 0 && apagarIrmas
              ? `Repetir e apagar ${irmas.length}`
              : 'Repetir todo mês'}
        </button>
      </div>

      {!conta.fornecedor.id && (
        <p className="mt-3 text-sm text-rose-600">
          Esta conta não traz o código do fornecedor no IXC, e sem ele não dá
          para gerar as próximas. <Selo pequeno tom="erro">sem fornecedor</Selo>
        </p>
      )}
      </FormularioEmPassos>
    </Janela>
  );
}

/** O mesmo dia do mês que vem; dia 31 em mês de 30 cai no último dia dele. */
function mesSeguinte(iso: string): string {
  if (!iso) return '';
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  const ultimoDoProximo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(ano, mes, Math.min(dia, ultimoDoProximo)));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function formatarDia(iso: string): string {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}
