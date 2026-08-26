import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { BarrasComparadas, PALETA } from '../../components/graficos';
import {
  Aviso,
  Bloco,
  Carregando,
  Janela,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type {
  ContaAberta,
  HistoricoPagamentos,
  PagamentoFeito,
} from '../../lib/types';
import { DetalheDaConta } from './DetalheDaConta';
import { DetalheDoPagamento } from './DetalheDoPagamento';
import {
  SeletorDePeriodo,
  mesCorrente,
  type Janela as Periodo,
} from './HistoricoDePagamentos';

/** O que ainda vai sair, ou o que já saiu. */
type Recorte = 'abertas' | 'pagas';

/** O rótulo do que não foi classificado — e que por isso não está em barra nenhuma. */
const SEM_CATEGORIA = 'Sem categoria';

/**
 * Uma linha de dinheiro, seja ela conta em aberto ou pagamento feito.
 *
 * As duas respondem à mesma pergunta com a mesma forma — quanto, de quem, em
 * que categoria, e a que se referia —, e é isso que deixa o gráfico e a janela
 * de detalhe serem os mesmos para os dois lados. O registro original vai junto
 * porque é ele que a ficha abre no fim do caminho.
 */
interface LinhaDoDinheiro {
  chave: number;
  grupo: string;
  subcategoria: string;
  fornecedor: string;
  valor: number;
  data: string | null;
  /** O que o IXC guarda sobre o título — é o que diz de que compra ele é. */
  observacao: string | null;
  conta?: ContaAberta;
  pagamento?: PagamentoFeito;
}

interface FatiaDoGrupo {
  rotulo: string;
  total: number;
  linhas: LinhaDoDinheiro[];
}

/** Quantas fatias o gráfico mostra antes de juntar o resto. */
const TETO_DE_FATIAS = 10;

/**
 * Para onde está indo o dinheiro.
 *
 * É a pergunta que o painel existia para responder e respondia pela metade:
 * havia um gráfico do que se **deve**, nenhum do que já **saiu**, e nos dois
 * casos o número morria na barra — quem quisesse saber que contas somavam
 * aquilo tinha de sair daqui e procurar na lista, filtro por filtro.
 *
 * Aqui os dois lados usam o mesmo desenho: soma por categoria-mãe, porque é
 * assim que o cadastro está organizado e é assim que a pergunta se faz ("quanto
 * custa a frota?", e não "quanto custou a manutenção de veículos"); e cada
 * barra abre, mostrando as subcategorias que a compõem e, dentro delas, conta
 * por conta. O fim do caminho é a ficha de sempre.
 */
export function PraOndeVaiODinheiro({ contas }: { contas: ContaAberta[] }) {
  const [recorte, setRecorte] = useState<Recorte>('abertas');
  const [periodo, setPeriodo] = useState<Periodo>(() => mesCorrente(0));
  const [aberto, setAberto] = useState<string | null>(null);

  /*
   * O que já saiu só é lido quando alguém pede.
   *
   * É outra ida ao IXC, e ela é lenta: quem abre o painel para ver o que vence
   * esta semana não pode pagar por uma leitura que não pediu.
   */
  const pagos = useQuery({
    queryKey: ['pagamentos-feitos', periodo.de, periodo.ate],
    queryFn: async () =>
      (
        await api.get<HistoricoPagamentos>('/pagamentos-feitos', {
          params: { de: periodo.de, ate: periodo.ate },
        })
      ).data,
    enabled: recorte === 'pagas',
    retry: 0,
  });

  const linhas = useMemo<LinhaDoDinheiro[]>(() => {
    if (recorte === 'abertas') {
      return contas.map((c) => ({
        chave: c.idFnApagar,
        grupo: c.classificacao
          ? (c.classificacao.grupo?.nome ?? c.classificacao.nome)
          : SEM_CATEGORIA,
        subcategoria: c.classificacao?.nome ?? SEM_CATEGORIA,
        fornecedor: c.fornecedor.nome || `Fornecedor ${c.fornecedor.id ?? '?'}`,
        valor: c.valorAberto,
        data: c.vencimento,
        observacao: c.observacao,
        conta: c,
      }));
    }
    return (pagos.data?.pagamentos ?? []).map((p) => ({
      chave: p.idFnApagar,
      grupo: p.classificacao
        ? (p.classificacao.grupo?.nome ?? p.classificacao.nome)
        : SEM_CATEGORIA,
      subcategoria: p.classificacao?.nome ?? SEM_CATEGORIA,
      fornecedor: p.fornecedor.nome || `Fornecedor ${p.fornecedor.id ?? '?'}`,
      valor: p.valorPago,
      data: p.pagoEm,
      observacao: p.observacao,
      pagamento: p,
    }));
  }, [recorte, contas, pagos.data]);

  const fatias = useMemo(() => agruparPorGrupo(linhas), [linhas]);
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  const semCategoria = fatias.find((f) => f.rotulo === SEM_CATEGORIA);
  const escolhida = fatias.find((f) => f.rotulo === aberto);

  const carregando = recorte === 'pagas' && pagos.isLoading;

  return (
    <>
      <Bloco
        titulo="Para onde está indo o dinheiro"
        className="surgir surgir-4"
        acao={
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['abertas', 'A pagar'],
                ['pagas', 'Já pago'],
              ] as const
            ).map(([qual, rotulo]) => (
              <button
                key={qual}
                onClick={() => setRecorte(qual)}
                aria-pressed={recorte === qual}
                className={`btn btn-p ${
                  recorte === qual ? 'btn-acao' : 'btn-sutil'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        }
      >
        {/* O período é só do lado pago: o que está em aberto é o que está em
            aberto agora, e recortá-lo por data responderia outra pergunta. */}
        {recorte === 'pagas' && (
          <div className="mb-4">
            <SeletorDePeriodo periodo={periodo} onEscolher={setPeriodo} />
          </div>
        )}

        {carregando ? (
          <Carregando texto="Lendo os pagamentos no IXC…" />
        ) : recorte === 'pagas' && pagos.error ? (
          <Aviso tom="erro">
            Não deu para ler os pagamentos do IXC: {mensagemErro(pagos.error)}
          </Aviso>
        ) : fatias.length === 0 ? (
          <Vazio titulo="Nada para somar aqui">
            {recorte === 'abertas'
              ? 'Não há conta em aberto no IXC neste momento.'
              : 'O IXC não registra pagamento nenhum neste período.'}
          </Vazio>
        ) : (
          <>
            <BarrasComparadas
              itens={fatias.map((f, i) => ({
                rotulo: f.rotulo,
                valor: f.total,
                cor:
                  f.rotulo === SEM_CATEGORIA
                    ? 'var(--serie-4)'
                    : PALETA[i % PALETA.length],
                detalhe:
                  total > 0
                    ? `${f.linhas.length} tít. · ${Math.round((f.total / total) * 100)}%`
                    : `${f.linhas.length} tít.`,
              }))}
              onAbrir={setAberto}
            />
            <p className="ajuda">
              Clique numa barra para ver as contas que somam aquele valor.
              {semCategoria
                ? ` ${formatBRL(semCategoria.total)} em ${semCategoria.linhas.length} título(s) ainda sem classificação — esse dinheiro está na barra vermelha, e não espalhado nas outras.`
                : ''}
            </p>
          </>
        )}
      </Bloco>

      {escolhida && (
        <ContasDaFatia
          fatia={escolhida}
          recorte={recorte}
          periodo={periodo}
          onFechar={() => setAberto(null)}
        />
      )}
    </>
  );
}

/**
 * As contas que somam uma barra.
 *
 * Em dois níveis, porque a pergunta vem em dois: primeiro "de que subcategoria
 * é esse dinheiro" e só depois "que conta é essa". As subcategorias vêm
 * fechadas quando são muitas — abrir trinta linhas de uma vez devolveria a
 * mesma lista que o gráfico existe para resumir.
 */
function ContasDaFatia({
  fatia,
  recorte,
  periodo,
  onFechar,
}: {
  fatia: FatiaDoGrupo;
  recorte: Recorte;
  periodo: Periodo;
  onFechar: () => void;
}) {
  const [conta, setConta] = useState<ContaAberta | null>(null);
  const [pagamento, setPagamento] = useState<PagamentoFeito | null>(null);

  const porSubcategoria = useMemo(() => {
    const mapa = new Map<string, LinhaDoDinheiro[]>();
    for (const l of fatia.linhas) {
      const atual = mapa.get(l.subcategoria);
      if (atual) atual.push(l);
      else mapa.set(l.subcategoria, [l]);
    }
    return [...mapa.entries()]
      .map(([nome, linhas]) => ({
        nome,
        linhas: [...linhas].sort((a, b) => b.valor - a.valor),
        total: linhas.reduce((s, l) => s + l.valor, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [fatia]);

  /** Uma subcategoria só não precisa de sanfona: ela é a fatia inteira. */
  const [abertas, setAbertas] = useState<Set<string>>(
    () => new Set(porSubcategoria.length === 1 ? [porSubcategoria[0].nome] : []),
  );

  function alternar(nome: string) {
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(nome)) proximo.delete(nome);
      else proximo.add(nome);
      return proximo;
    });
  }

  /*
   * A janela da fatia some enquanto a ficha está aberta.
   *
   * Duas por cima da outra respondem as duas ao Esc, e quem fecha a ficha
   * fecharia junto a lista de onde veio — que é justamente para onde ela quer
   * voltar.
   */
  const vendoFicha = !!conta || !!pagamento;

  return (
    <>
      {!vendoFicha && (
      <Janela titulo={fatia.rotulo} onFechar={onFechar}>
        <div className="p-5 sm:p-6">
          <div className="rounded-2xl bg-tinta-50 p-5">
            <div className="text-sm text-tinta-500">
              {recorte === 'abertas'
                ? 'Em aberto nesta categoria'
                : `Pago nesta categoria — ${formatData(periodo.de)} a ${formatData(periodo.ate)}`}
            </div>
            <div className="valor mt-1 text-3xl">{formatBRL(fatia.total)}</div>
            <div className="num mt-0.5 text-sm text-tinta-500">
              {fatia.linhas.length} título(s) em {porSubcategoria.length}{' '}
              subcategoria(s)
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {porSubcategoria.map((sub) => (
              <div
                key={sub.nome}
                className="overflow-hidden rounded-xl border border-tinta-100"
              >
                <button
                  type="button"
                  onClick={() => alternar(sub.nome)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-tinta-50"
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="text-tinta-300"
                      title={abertas.has(sub.nome) ? 'Fechar' : 'Abrir'}
                    >
                      {abertas.has(sub.nome) ? '▾' : '▸'}
                    </span>
                    <span className="font-medium text-tinta-800">
                      {sub.nome}
                    </span>
                    <span className="text-xs text-tinta-400">
                      {sub.linhas.length} tít.
                    </span>
                  </span>
                  <span className="valor text-sm">{formatBRL(sub.total)}</span>
                </button>

                {abertas.has(sub.nome) && (
                  <table className="w-full text-sm">
                    <tbody>
                      {sub.linhas.map((l) => (
                        <tr key={l.chave} className="linha">
                          <td className="td">
                            <button
                              type="button"
                              onClick={() => {
                                if (l.conta) setConta(l.conta);
                                if (l.pagamento) setPagamento(l.pagamento);
                              }}
                              className="block text-left"
                              title="Abrir a ficha"
                            >
                              <span className="font-medium text-tinta-800 hover:text-brand-700 dark:hover:text-brand-300">
                                {l.fornecedor}
                              </span>
                              <span className="block text-xs text-tinta-400">
                                nº {l.chave} ·{' '}
                                {recorte === 'abertas' ? 'vence ' : 'pago em '}
                                {l.data ? formatData(l.data) : 'sem data'}
                              </span>
                              {/* A observação do IXC é o que responde "de que
                                  compra é este título" — sem ela a linha é um
                                  nome e um valor, e a resposta ficava a uma
                                  ficha de distância. Ela vai inteira, e não
                                  cortada: o número da parcela, quando existe,
                                  está no fim dela ("… (3/6)"). */}
                              <span
                                className={`mt-0.5 block text-xs ${
                                  l.observacao
                                    ? 'text-tinta-500'
                                    : 'italic text-tinta-300'
                                }`}
                              >
                                {l.observacao ?? 'sem observação no IXC'}
                              </span>
                            </button>
                          </td>
                          <td className="td whitespace-nowrap text-right">
                            <span className="valor">{formatBRL(l.valor)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>

          {fatia.rotulo === SEM_CATEGORIA && (
            <Aviso tom="atencao">
              Estas contas não estão em nenhuma categoria — por isso elas somam
              numa barra à parte, em vez de sumir do gráfico. Classifique-as na
              própria ficha, e elas passam a contar onde devem.
            </Aviso>
          )}

          <div className="mt-5 flex justify-end">
            <button onClick={onFechar} className="btn btn-neutro">
              Fechar
            </button>
          </div>
        </div>
      </Janela>
      )}

      {/* A ficha de sempre — a mesma da lista, com pagar, classificar e as
          notas anexadas. O caminho termina onde a pessoa já sabe agir. */}
      {conta && (
        <DetalheDaConta conta={conta} onFechar={() => setConta(null)} />
      )}
      {pagamento && (
        <DetalheDoPagamento
          pagamento={pagamento}
          onFechar={() => setPagamento(null)}
        />
      )}
    </>
  );
}

/**
 * Soma por categoria-mãe, da maior para a menor.
 *
 * O que não tem categoria vai para uma fatia própria, e não para fora do
 * gráfico: dinheiro que some da soma é a única coisa pior que dinheiro na
 * fatia errada. Passando do teto, o resto vira "Outras N" — que também abre,
 * com todas elas dentro.
 */
function agruparPorGrupo(linhas: LinhaDoDinheiro[]): FatiaDoGrupo[] {
  const mapa = new Map<string, LinhaDoDinheiro[]>();
  for (const l of linhas) {
    const atual = mapa.get(l.grupo);
    if (atual) atual.push(l);
    else mapa.set(l.grupo, [l]);
  }

  const fatias = [...mapa.entries()]
    .map(([rotulo, deles]) => ({
      rotulo,
      linhas: deles,
      total: deles.reduce((s, l) => s + l.valor, 0),
    }))
    .sort((a, b) => b.total - a.total);

  if (fatias.length <= TETO_DE_FATIAS) return fatias;

  const cabem = fatias.slice(0, TETO_DE_FATIAS);
  const resto = fatias.slice(TETO_DE_FATIAS);
  cabem.push({
    rotulo: `Outras ${resto.length}`,
    linhas: resto.flatMap((f) => f.linhas),
    total: resto.reduce((s, f) => s + f.total, 0),
  });
  return cabem;
}
