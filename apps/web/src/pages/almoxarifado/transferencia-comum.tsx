import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Aviso } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import type {
  AndamentoDaTransferencia,
  ConteudoDoAlmoxarifado,
  PatrimonioDoAlmoxarifado,
} from '../../lib/types';
import { quantidade } from './ProdutoNoIxc';

/**
 * O que a janela "Mover tudo" e a tela "Transferir" têm em comum: ler o que
 * um almoxarifado tem, acompanhar a transferência rodando no servidor e
 * mostrar o resultado.
 */

/** O que o almoxarifado tem agora, lido do IXC — sem guardar: a lista tem de ser a de agora. */
export function useConteudo(almoxId: number | null) {
  return useQuery({
    queryKey: ['almoxarifado', 'conteudo', almoxId],
    queryFn: async () =>
      (await api.get<ConteudoDoAlmoxarifado>(`/almoxarifado/almoxarifados/${almoxId}/conteudo`))
        .data,
    enabled: !!almoxId,
    staleTime: 0,
  });
}

/**
 * A transferência rodando: relê a cada segundo e meio enquanto roda, e chama
 * `onTerminou` uma vez quando para (bem ou mal) — o saldo mudou no IXC.
 */
export function useAndamento(id: string | null, onTerminou: () => void) {
  const q = useQuery({
    queryKey: ['almoxarifado', 'transferencia', id],
    queryFn: async () =>
      (await api.get<AndamentoDaTransferencia>(`/almoxarifado/transferencias/${id}`)).data,
    enabled: !!id,
    refetchInterval: (query) =>
      !query.state.data || query.state.data.status === 'rodando' ? 1500 : false,
    // Quem troca de aba no meio de uma transferência grande volta com o
    // resultado pronto — e o aviso de "terminou" (que relê o estoque) já dado.
    refetchIntervalInBackground: true,
  });
  const avisado = useRef(false);
  const status = q.data?.status;
  useEffect(() => {
    if (status && status !== 'rodando' && !avisado.current) {
      avisado.current = true;
      onTerminou();
    }
  }, [status, onTerminou]);
  return q;
}

/** "nº 00123 · MAC AA:BB:… · série ZTEG…" — o mesmo texto que o servidor usa. */
export function identificacao(p: PatrimonioDoAlmoxarifado): string {
  const partes = [
    p.numeroPatrimonial && `nº ${p.numeroPatrimonial}`,
    p.mac && `MAC ${p.mac}`,
    p.numeroSerie && `série ${p.numeroSerie}`,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : `patrimônio #${p.patrimonioId}`;
}

/**
 * MAC, número e série do jeito que o leitor ou o dedo mandam — "aa-bb-cc",
 * "AABBCC", " aa:bb:cc " — viram a mesma coisa para comparar.
 */
export function normalizarCodigo(t: string | null | undefined): string {
  return String(t ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/** A peça cujo MAC, número patrimonial ou série é exatamente o que foi bipado. */
export function pecaDoCodigo(
  pecas: PatrimonioDoAlmoxarifado[],
  codigo: string,
): PatrimonioDoAlmoxarifado | undefined {
  const c = normalizarCodigo(codigo);
  if (c.length < 3) return undefined;
  return pecas.find(
    (p) =>
      normalizarCodigo(p.mac) === c ||
      normalizarCodigo(p.numeroPatrimonial) === c ||
      normalizarCodigo(p.numeroSerie) === c,
  );
}

export function Andamento({
  a,
  erro,
  onFechar,
}: {
  a: AndamentoDaTransferencia;
  erro: unknown;
  onFechar: () => void;
}) {
  const pct = a.total > 0 ? Math.round((a.feitos / a.total) * 100) : 100;

  return (
    <div>
      <p className="mb-2 text-sm text-tinta-600">
        {a.de.nome} → <strong>{a.para.nome}</strong> · transferência{' '}
        <span className="num">#{a.transferenciaId}</span> no IXC
      </p>

      <div className="mb-1 h-2 overflow-hidden rounded-full bg-tinta-100">
        <div
          className={`h-full transition-all ${
            a.status === 'falhou' ? 'bg-rose-500' : 'bg-brand-600'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mb-4 text-[12px] text-tinta-400">
        {a.status === 'rodando'
          ? `${a.feitos} de ${a.total} — pode fechar, a transferência continua no servidor.`
          : `${a.feitos} de ${a.total}`}
      </p>

      {erro ? <Aviso tom="erro">{mensagemErro(erro)}</Aviso> : null}
      {a.status === 'falhou' && (
        <Aviso tom="erro">
          A transferência parou no meio ({a.erro}). O que foi movido está na transferência #
          {a.transferenciaId} do IXC.
        </Aviso>
      )}

      {a.status === 'terminou' && (
        <Aviso tom={a.falharam.length === 0 ? 'pago' : 'atencao'}>
          {a.movidos.length} {a.movidos.length === 1 ? 'item movido' : 'itens movidos'} para{' '}
          {a.para.nome}.
          {a.falharam.length > 0 && ` O IXC recusou ${a.falharam.length} (abaixo).`}
          {a.restouNaOrigem !== null &&
            a.restouNaOrigem > 0 &&
            ` Relido agora, ${a.restouNaOrigem} ainda aparece(m) em ${a.de.nome} — confira a transferência no IXC.`}
        </Aviso>
      )}

      {a.falharam.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-sm font-semibold text-rose-700 dark:text-rose-300">
            Recusados pelo IXC
          </p>
          <ListaDeItens
            itens={a.falharam.map((f) => ({
              chave: f.chave,
              nome: `${f.descricao} (${f.detalhe})`,
              detalhe: f.motivo,
            }))}
          />
        </div>
      )}

      {a.status !== 'rodando' && a.movidos.length > 0 && (
        <details className="mb-3">
          <summary className="cursor-pointer text-sm font-semibold text-tinta-700">
            O que foi ({a.movidos.length})
          </summary>
          <div className="mt-2">
            <ListaDeItens
              itens={a.movidos.map((m) => ({ chave: m.chave, nome: m.descricao, detalhe: m.detalhe }))}
            />
          </div>
        </details>
      )}

      {a.status !== 'rodando' && a.deFora.length > 0 && <FicamDeFora itens={a.deFora} />}

      {a.status !== 'rodando' && (
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onFechar} className="btn btn-primario">
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}

export function FicamDeFora({ itens }: { itens: ConteudoDoAlmoxarifado['deFora'] }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-sm font-semibold text-amber-700 dark:text-amber-300">
        Ficam ({itens.length}) — não vão por transferência
      </p>
      <ListaDeItens
        itens={itens.map((i, n) => ({
          chave: `${i.produtoId}-${n}`,
          nome: i.descricao,
          detalhe: `${quantidade(i.saldo)} ${i.unidade ?? ''} · ${i.motivo}`,
        }))}
      />
    </div>
  );
}

export function ListaDeItens({
  itens,
}: {
  itens: Array<{ chave: string | number; nome: string; detalhe: string }>;
}) {
  return (
    <div className="max-h-60 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
      {itens.map((i) => (
        <div
          key={i.chave}
          className="flex items-baseline justify-between gap-3 border-b border-tinta-100 px-3 py-1.5 text-[13px] last:border-b-0"
        >
          <span className="min-w-0 truncate text-tinta-800" title={i.nome}>
            {i.nome}
          </span>
          <span className="max-w-[55%] text-right text-[12px] text-tinta-500">{i.detalhe}</span>
        </div>
      ))}
    </div>
  );
}
