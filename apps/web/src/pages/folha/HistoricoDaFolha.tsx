import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
  type Tom,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTermoAdiado } from '../../lib/busca';
import { nomeDoMes } from '../../lib/folha';
import { formatBRL, formatData } from '../../lib/format';
import { acessosDoUsuario } from '../../lib/modulos';
import { TIPO_LABEL } from '../../lib/status';
import type {
  ContaAberta,
  ContasAbertas,
  ContaPagar,
  Paginado,
  ResumoSincronizacao,
} from '../../lib/types';
import { PagarEmMaos, SeloNoBanco } from '../contas-pagar/AcoesDaConta';

/** Os grupos da lista — a API junta as situações de cada um. */
const GRUPOS = [
  ['todos', 'Todos'],
  ['a-pagar', 'A pagar'],
  ['pagas', 'Pagos'],
  ['problema', 'Com problema'],
] as const;
type Grupo = (typeof GRUPOS)[number][0];

const POR_PAGINA = 100;

/**
 * O histórico dos pagamentos da folha: quem recebeu, quanto, de quê e quando.
 *
 * Era a tela de "Pagamentos da Folha", com as etapas, a caixa de marcar em
 * cada linha e cinco botões por conta. Desde que a Gerar Folha passou a gerar
 * e pagar no mesmo botão (23/10/2026), o que sobra para cá é consultar — por
 * mês, sem muita coisa. O único botão que ficou é o Pagar do que ainda não
 * saiu, para a conta não ficar presa se a janela de pagar foi fechada.
 *
 * A situação se acerta sozinha: pagar por aqui ou pelo banco já traz a nova, e
 * ao abrir a tela confere o que ainda não fechou com o IXC.
 */
export function HistoricoDaFolha() {
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const podePagar = acessosDoUsuario(usuario).includes('contas-pagar');
  const [grupo, setGrupo] = useState<Grupo>('todos');
  const [busca, setBusca] = useState('');
  const buscaAtiva = useTermoAdiado(busca);
  const [pagando, setPagando] = useState<ContaAberta[] | null>(null);

  const lista = useInfiniteQuery({
    queryKey: ['contas-pagar', 'historico', grupo, buscaAtiva],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Paginado<ContaPagar>>('/contas-pagar', {
          params: {
            page: pageParam,
            pageSize: POR_PAGINA,
            ...(grupo !== 'todos' ? { grupo } : {}),
            ...(buscaAtiva ? { busca: buscaAtiva } : {}),
          },
        })
      ).data,
    getNextPageParam: (ultima) =>
      ultima.page < ultima.totalPages ? ultima.page + 1 : undefined,
  });
  const contas = lista.data?.pages.flatMap((p) => p.itens) ?? [];
  const total = lista.data?.pages[0]?.total ?? 0;

  /*
   * Ao abrir, confere com o IXC o que ainda não fechou: o pagamento feito
   * direto lá (fora daqui) também aparece pago, sem botão de "Verificar".
   * Perfil que só vê recebe 403 — e a lista fica como está.
   */
  const conferir = useMutation({
    mutationFn: async () =>
      (await api.post<ResumoSincronizacao>('/contas-pagar/sincronizar-pendentes')).data,
    onSuccess: (r) => {
      if (r.atualizadas > 0 || r.removidas > 0) {
        void qc.invalidateQueries({ queryKey: ['contas-pagar'] });
      }
    },
  });
  useEffect(() => {
    conferir.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Os títulos em aberto, para o Pagar do que ainda não saiu e o selo do banco.
  const temAPagar = contas.some((c) => aPagar(c));
  const abertas = useQuery({
    queryKey: ['contas-abertas'],
    queryFn: async () => (await api.get<ContasAbertas>('/contas-abertas')).data,
    enabled: podePagar && temAPagar,
    retry: 0,
  });
  const titulos = new Map((abertas.data?.contas ?? []).map((t) => [t.idFnApagar, t]));
  const tituloDe = (c: ContaPagar) =>
    c.idFnApagarIxc === null ? undefined : titulos.get(c.idFnApagarIxc);

  // Por mês: o cabeçalho de cada um diz quanto saiu e quantos pagamentos.
  const meses: Array<{ mes: string; contas: ContaPagar[] }> = [];
  for (const c of contas) {
    const mes = c.competencia ?? c.createdAt.slice(0, 7);
    const atual = meses[meses.length - 1];
    if (atual?.mes === mes) atual.contas.push(c);
    else meses.push({ mes, contas: [c] });
  }

  return (
    <Pagina>
      <CabecalhoPagina secao="Folha de pagamento" titulo="Histórico da folha" />

      {conferir.isError && <Aviso tom="erro">{mensagemErro(conferir.error)}</Aviso>}

      <div className="surgir mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, apelido ou CPF…"
          className="campo max-w-xs"
          autoComplete="off"
        />
        {GRUPOS.map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setGrupo(valor)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              grupo === valor
                ? 'bg-barra text-white'
                : 'border border-tinta-200 bg-papel text-tinta-600 hover:border-tinta-300'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <Bloco className="surgir surgir-2" semPadding>
        {lista.isLoading && <Carregando />}
        {lista.isError && (
          <Vazio titulo="Não deu para ler o histórico">{mensagemErro(lista.error)}</Vazio>
        )}
        {!lista.isLoading && !lista.isError && contas.length === 0 && (
          <Vazio titulo="Nenhum pagamento aqui">
            Os pagamentos aparecem depois que a folha é gerada.
          </Vazio>
        )}

        {meses.length > 0 && (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Quem</th>
                  <th className="th">Data</th>
                  <th className="th text-right">Valor</th>
                  <th className="th">Situação</th>
                </tr>
              </thead>
              {meses.map(({ mes, contas: doMes }) => (
                <tbody key={mes}>
                  <tr>
                    <td colSpan={4} className="bg-tinta-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-tinta-500">
                      {nomeDoMes(mes)}
                      <span className="num ml-2 font-normal normal-case tracking-normal text-tinta-400">
                        {formatBRL(doMes.reduce((s, c) => s + Number(c.valor), 0))} ·{' '}
                        {doMes.length} pagamento(s)
                      </span>
                    </td>
                  </tr>
                  {doMes.map((c) => (
                    <Linha
                      key={c.id}
                      conta={c}
                      titulo={tituloDe(c)}
                      podePagar={podePagar}
                      onPagar={(t) => setPagando([t])}
                    />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}

        {contas.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-tinta-100 px-5 py-3 text-sm text-tinta-500">
            <span className="num">
              {contas.length} de {total}
            </span>
            {lista.hasNextPage && (
              <button
                type="button"
                onClick={() => void lista.fetchNextPage()}
                disabled={lista.isFetchingNextPage}
                className="btn btn-neutro btn-p"
              >
                {lista.isFetchingNextPage ? 'Carregando…' : 'Ver mais'}
              </button>
            )}
          </div>
        )}
      </Bloco>

      {pagando && (
        <PagarEmMaos
          contas={pagando}
          onPagas={() => void qc.invalidateQueries({ queryKey: ['contas-pagar'] })}
          onFechar={() => setPagando(null)}
        />
      )}
    </Pagina>
  );
}

/** Ainda não saiu, e não deu errado: é o que pode ser pago daqui. */
function aPagar(c: ContaPagar): boolean {
  return !['PAGO', 'REPROVADO', 'CANCELADO', 'ERRO'].includes(c.status);
}

/** A situação em uma palavra — as sete do IXC viram quatro. */
function situacao(c: ContaPagar): { tom: Tom; texto: string; titulo?: string } {
  if (c.status === 'PAGO') {
    return { tom: 'pago', texto: c.pagoEm ? `pago em ${formatData(c.pagoEm)}` : 'pago' };
  }
  if (c.status === 'ERRO') return { tom: 'erro', texto: 'erro', titulo: c.erro ?? undefined };
  if (c.status === 'REPROVADO') return { tom: 'erro', texto: 'reprovado' };
  if (c.status === 'CANCELADO') return { tom: 'neutro', texto: 'cancelado' };
  return { tom: 'atencao', texto: 'a pagar' };
}

function Linha({
  conta: c,
  titulo,
  podePagar,
  onPagar,
}: {
  conta: ContaPagar;
  titulo: ContaAberta | undefined;
  podePagar: boolean;
  onPagar: (titulo: ContaAberta) => void;
}) {
  const qc = useQueryClient();
  // A conta que não chegou ao IXC: mandar de novo, sem gerar outra.
  const reenviar = useMutation({
    mutationFn: async () => (await api.post(`/contas-pagar/${c.id}/enviar`)).data,
    onSettled: () => void qc.invalidateQueries({ queryKey: ['contas-pagar'] }),
  });
  const s = situacao(c);
  const noBanco = aPagar(c) && titulo?.noBanco && titulo.noBanco.situacao !== 'RECUSADO';
  const pagavel = podePagar && aPagar(c) && !!titulo && !noBanco;
  return (
    <tr className="linha">
      <td className="td">
        <div className="font-medium text-tinta-900">{c.beneficiarioNome}</div>
        <div className="text-xs text-tinta-400">{TIPO_LABEL[c.tipo]}</div>
      </td>
      <td className="td num whitespace-nowrap text-tinta-500">
        {formatData(c.pagoEm ?? c.dataEmissao)}
      </td>
      <td className="td text-right">
        <span className="valor">{formatBRL(c.valor)}</span>
      </td>
      <td className="td">
        <div className="flex flex-wrap items-center gap-1.5">
          {noBanco && titulo?.noBanco && c.idFnApagarIxc !== null ? (
            <SeloNoBanco noBanco={titulo.noBanco} idFnApagar={c.idFnApagarIxc} />
          ) : (
            <Selo pequeno tom={s.tom} titulo={s.titulo}>
              {s.texto}
            </Selo>
          )}
          {c.status === 'ERRO' && (
            <button
              type="button"
              onClick={() => reenviar.mutate()}
              disabled={reenviar.isPending}
              className="btn btn-neutro btn-p"
              title={c.erro ?? undefined}
            >
              {reenviar.isPending ? 'Reenviando…' : 'Reenviar'}
            </button>
          )}
          {reenviar.isError && (
            <span className="text-xs text-rose-600">{mensagemErro(reenviar.error)}</span>
          )}
          {pagavel && titulo && (
            <button
              type="button"
              onClick={() => onPagar(titulo)}
              className="btn btn-pagar btn-p"
            >
              Pagar
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
