import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  LeitorDeCodigo,
  type AlvoDaLeitura,
} from '../../components/LeitorDeCodigo';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { formatBRL, formatData } from '../../lib/format';
import type { CategoriaDespesa } from '../../lib/types';

/** Um fornecedor do IXC, como a busca por nome o devolve. */
interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

/** Um cartão cadastrado, como a API o devolve. */
interface CartaoCredito {
  id: string;
  apelido: string;
  final: string | null;
  idFornecedorIxc: number;
  fornecedorNome: string;
  diaDeVencimento: number;
  contaContabil: number | null;
  contaPagamento: number | null;
  tipoPagamentoIxc: string | null;
  categoriaId: string | null;
  ativo: boolean;
}

/** Uma linha da fatura: a parcela de uma compra que cai neste mês. */
interface ItemDaFatura {
  compraId: string;
  descricao: string;
  parcela: number;
  parcelas: number;
  valor: number;
  valorTotal: number;
  parcelaInicial: number;
  primeiraFatura: string;
}

/** A conta a pagar em que a fatura virou. */
interface FaturaLancada {
  id: string;
  idFnApagarIxc: number | null;
  valor: number;
  dataVencimento: string;
  status: string;
  pagoEm: string | null;
}

interface ResumoDaFatura {
  competencia: string;
  total: number;
  lancada: FaturaLancada | null;
}

interface CartaoDoMes {
  cartao: CartaoCredito;
  itens: ItemDaFatura[];
  total: number;
  lancada: FaturaLancada | null;
  vencimentoSugerido: string;
  faturas: ResumoDaFatura[];
  comprometidoDepois: number;
}

interface RespostaDoMes {
  competencia: string;
  cartoes: CartaoDoMes[];
}

interface ContaDePagamentoIxc {
  id: number;
  nome: string;
  ativa: boolean;
  usual: boolean;
}

interface ContaDoPlano {
  id: number;
  nome: string;
}

/** O que a tela precisa saber da configuração para dizer qual é o padrão. */
interface ConfigDaCasa {
  contaPagamentoId: number;
  contaContabilAvulso: number;
}

/**
 * Cartão de Crédito — a fatura de cada cartão, compra por compra.
 *
 * A fatura é uma conta só no IXC: um título para o banco, no dia em que ela
 * vence. Por dentro ela é um punhado de compras, e boa parte delas parcelada —
 * a compra de dez vezes de março ainda está na fatura de novembro. Aqui cada
 * compra é lançada uma vez, com o número de parcelas, e cada parcela aparece
 * sozinha na fatura em que cai. No mês do vencimento, a soma vira a conta a
 * pagar.
 *
 * O mês da tela é o do **vencimento** da fatura — é o que o banco imprime no
 * alto dela ("fatura de outubro"), e é o que se procura com o papel na mão.
 */
export function CartoesCredito() {
  const queryClient = useQueryClient();
  const [competencia, setCompetencia] = useState(mesAtual);
  const [cadastrando, setCadastrando] = useState(false);
  const [editando, setEditando] = useState<CartaoCredito | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const lista = useQuery({
    queryKey: ['cartoes-credito', competencia],
    queryFn: async () =>
      (
        await api.get<RespostaDoMes>('/cartoes-credito', {
          params: { competencia },
        })
      ).data,
    retry: 0,
    // Trocar de mês não pisca a tela vazia: o mês anterior fica até o novo
    // chegar.
    placeholderData: (anterior) => anterior,
  });

  const cartoes = lista.data?.cartoes ?? [];
  const ativos = cartoes.filter((c) => c.cartao.ativo);
  const desligados = cartoes.filter((c) => !c.cartao.ativo);

  const religar = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/cartoes-credito/${id}`, { ativo: true });
    },
    onSuccess: invalidar,
    onError: (err) => avisar(mensagemErro(err), true),
  });

  function invalidar() {
    void queryClient.invalidateQueries({ queryKey: ['cartoes-credito'] });
    void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
  }

  function avisar(mensagem: string, houveErro = false) {
    setErro(houveErro);
    setAviso(mensagem);
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a pagar"
        titulo="Cartão de Crédito"
        descricao="Cada compra que vem na fatura, à vista ou parcelada. No mês do vencimento, a fatura vira uma conta a pagar só, no valor da soma."
        acoes={
          <button onClick={() => setCadastrando(true)} className="btn btn-acao">
            Cadastrar cartão
          </button>
        }
      />

      {aviso && (
        <Aviso
          tom={erro ? 'erro' : 'pago'}
          acao={
            <button
              onClick={() => setAviso(null)}
              className="btn btn-sutil btn-p"
            >
              Fechar
            </button>
          }
        >
          {aviso}
        </Aviso>
      )}

      {lista.error && (
        <Aviso tom="erro">
          Não deu para ler os cartões: {mensagemErro(lista.error)}
        </Aviso>
      )}

      {/* O mês da fatura. As setas porque o gesto mais comum é andar um mês —
          conferir a que passou, adiantar a que vem. */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="rotulo" htmlFor="competencia-cartao">
            Fatura que vence em
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCompetencia((c) => somarMeses(c, -1))}
              className="btn btn-neutro btn-p"
              aria-label="Mês anterior"
              title="Fatura do mês anterior"
            >
              ‹
            </button>
            <input
              id="competencia-cartao"
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value || mesAtual())}
              className="campo max-w-[180px]"
            />
            <button
              type="button"
              onClick={() => setCompetencia((c) => somarMeses(c, 1))}
              className="btn btn-neutro btn-p"
              aria-label="Próximo mês"
              title="Fatura do mês seguinte"
            >
              ›
            </button>
          </div>
        </div>
        <p className="mb-2 text-xs text-tinta-400">
          O mês em que a fatura vence — é o que vem escrito no alto dela.
        </p>
      </div>

      {lista.isLoading ? (
        <Bloco semPadding>
          <Carregando texto="Lendo os cartões…" />
        </Bloco>
      ) : cartoes.length === 0 ? (
        <Bloco semPadding>
          <Vazio titulo="Nenhum cartão cadastrado ainda">
            Cadastre o cartão com o banco e o dia em que a fatura vence. Depois
            é só lançar cada compra que vier nela.
          </Vazio>
        </Bloco>
      ) : (
        <div className="space-y-5">
          {ativos.map((dados) => (
            <FaturaDoCartao
              key={dados.cartao.id}
              dados={dados}
              competencia={competencia}
              onMudarMes={setCompetencia}
              onEditar={() => setEditando(dados.cartao)}
              onAviso={avisar}
              onMudou={invalidar}
            />
          ))}
        </div>
      )}

      {/* Desligado não some de vez: a lista curta embaixo é o caminho de
          volta, sem precisar lembrar que ele existia. */}
      {desligados.length > 0 && (
        <div className="mt-6">
          <p className="eyebrow mb-2">Cartões desligados</p>
          <div className="flex flex-wrap gap-2">
            {desligados.map(({ cartao }) => (
              <div
                key={cartao.id}
                className="flex items-center gap-2 rounded-xl border border-tinta-200 px-3 py-1.5 text-sm text-tinta-500"
              >
                {nomeDoCartao(cartao)}
                <button
                  onClick={() => religar.mutate(cartao.id)}
                  disabled={religar.isPending}
                  className="btn btn-sutil btn-p"
                >
                  Religar
                </button>
                <button
                  onClick={() => setEditando(cartao)}
                  className="btn btn-sutil btn-p"
                >
                  Editar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="ajuda">
        A conta nasce no IXC já aprovada, com a lista das compras na observação.
        Depois de lançada, a fatura não muda de valor: uma compra esquecida
        entra na fatura seguinte — ou o título é excluído em Em aberto e a
        fatura gerada de novo.
      </p>

      {(cadastrando || editando) && (
        <CadastroDoCartao
          cartao={editando}
          onFechar={() => {
            setCadastrando(false);
            setEditando(null);
          }}
          onPronto={(mensagem) => {
            avisar(mensagem);
            setCadastrando(false);
            setEditando(null);
            invalidar();
          }}
        />
      )}
    </Pagina>
  );
}

/**
 * Um cartão e a fatura do mês: as faturas vizinhas de relance, as compras
 * desta, o campo para lançar a próxima e o botão que a faz virar conta.
 */
function FaturaDoCartao({
  dados,
  competencia,
  onMudarMes,
  onEditar,
  onAviso,
  onMudou,
}: {
  dados: CartaoDoMes;
  competencia: string;
  onMudarMes: (competencia: string) => void;
  onEditar: () => void;
  onAviso: (mensagem: string, erro?: boolean) => void;
  onMudou: () => void;
}) {
  const { cartao, itens, total, lancada, faturas, comprometidoDepois } = dados;
  /** A compra carregada no formulário para corrigir. */
  const [corrigindo, setCorrigindo] = useState<ItemDaFatura | null>(null);
  const [vencimento, setVencimento] = useState('');
  const [codigo, setCodigo] = useState('');
  const [lendo, setLendo] = useState<AlvoDaLeitura | null>(null);

  /*
   * Trocar de mês limpa o que estava digitado para gerar e a correção aberta.
   * O vencimento de outubro digitado aqui não pode ir parar na fatura de
   * novembro com um clique distraído.
   */
  useEffect(() => {
    setVencimento('');
    setCodigo('');
    setCorrigindo(null);
  }, [competencia]);

  const remover = useMutation({
    mutationFn: async (compraId: string) => {
      await api.delete(`/cartoes-credito/compras/${compraId}`);
    },
    onSuccess: onMudou,
    onError: (err) => onAviso(mensagemErro(err), true),
  });

  const gerar = useMutation({
    mutationFn: async () =>
      (
        await api.post<{
          conta: { idFnApagarIxc: number | null };
          total: number;
          itens: number;
        }>(`/cartoes-credito/${cartao.id}/gerar`, {
          competencia,
          dataVencimento: vencimento || undefined,
          codigo: codigo.trim() || undefined,
        })
      ).data,
    onSuccess: (r) => {
      onAviso(
        `Fatura de ${mesPorExtenso(competencia)} do ${cartao.apelido} lançada ` +
          `no IXC: ${formatBRL(r.total)} em ${r.itens} compra(s)` +
          (r.conta.idFnApagarIxc ? ` — título ${r.conta.idFnApagarIxc}.` : '.'),
      );
      setVencimento('');
      setCodigo('');
      onMudou();
    },
    onError: (err) => onAviso(mensagemErro(err), true),
  });

  const paga = !!lancada && (!!lancada.pagoEm || lancada.status === 'PAGO');
  const passou = competencia < mesAtual();

  return (
    <section className="card overflow-hidden">
      {/* Quem é o cartão, numa linha só: é o que distingue dois cartões do
          mesmo banco quando há mais de um na tela. */}
      <div className="faixa-titulo flex flex-wrap items-center justify-between gap-2 px-3.5 py-3 md:px-5">
        <div className="min-w-0">
          <h2 className="titulo-bloco">{nomeDoCartao(cartao)}</h2>
          <p className="text-xs text-tinta-400">
            {cartao.fornecedorNome} · vence todo dia {cartao.diaDeVencimento}
          </p>
        </div>
        <button onClick={onEditar} className="btn btn-sutil btn-p">
          Editar cartão
        </button>
      </div>

      {/*
        As faturas vizinhas, de relance. É a pergunta que se faz antes de pagar
        qualquer uma — quanto já está comprometido nas próximas? — e o caminho
        mais curto até elas: um clique no mês.
      */}
      <div className="flex gap-2 overflow-x-auto rolagem-fina border-b border-tinta-100 px-3.5 py-3 md:px-5">
        {faturas.map((f) => (
          <ChipDaFatura
            key={f.competencia}
            fatura={f}
            escolhida={f.competencia === competencia}
            onClick={() => onMudarMes(f.competencia)}
          />
        ))}
      </div>

      <div className="overflow-x-auto rolagem-fina">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <colgroup>
            <col className="w-[50%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead>
            <tr>
              <th className="th">Compra</th>
              <th className="th">Parcela</th>
              <th className="th text-right">Nesta fatura</th>
              <th className="th text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && (
              <tr>
                <td colSpan={4} className="td text-center text-tinta-400">
                  Nenhuma compra nesta fatura ainda.
                </td>
              </tr>
            )}
            {itens.map((i) => (
              <tr
                key={i.compraId}
                className={`linha ${corrigindo?.compraId === i.compraId ? 'bg-brand-500/5' : ''}`}
              >
                <td className="td">
                  <div className="truncate text-tinta-800" title={i.descricao}>
                    {i.descricao}
                  </div>
                  {i.parcelas > 1 && (
                    <div className="num text-[11px] text-tinta-400">
                      compra de {formatBRL(i.valorTotal)}
                      {i.parcela < i.parcelas &&
                        ` · até ${rotuloDoMes(
                          somarMeses(competencia, i.parcelas - i.parcela),
                        )}`}
                    </div>
                  )}
                </td>
                <td className="td num text-tinta-600">
                  {i.parcelas > 1 ? `${i.parcela}/${i.parcelas}` : 'à vista'}
                </td>
                <td className="td text-right">
                  <span
                    className={`valor ${i.valor < 0 ? 'text-emerald-600 dark:text-emerald-300' : ''}`}
                  >
                    {formatBRL(i.valor)}
                  </span>
                  {i.valor < 0 && (
                    <div className="text-[11px] text-emerald-600 dark:text-emerald-300">
                      estorno
                    </div>
                  )}
                </td>
                <td className="td text-right">
                  {lancada ? (
                    <span className="text-xs text-tinta-400">—</span>
                  ) : (
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setCorrigindo(i)}
                        className="btn btn-neutro btn-p"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              i.parcelas > 1
                                ? `Apagar "${i.descricao}"? Sai desta fatura e de todas as outras em que a compra tem parcela.`
                                : `Apagar "${i.descricao}" da fatura?`,
                            )
                          ) {
                            remover.mutate(i.compraId);
                          }
                        }}
                        disabled={remover.isPending}
                        className="btn btn-perigo btn-p"
                      >
                        Apagar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Fatura lançada não recebe compra: o título do IXC já tem o valor
          dela. O formulário some e diz para onde vai a compra esquecida. */}
      {lancada ? (
        <p className="border-t border-tinta-100 px-3.5 py-3 text-xs text-tinta-400 md:px-5">
          Esta fatura já virou conta a pagar. Compra esquecida entra na de{' '}
          <button
            type="button"
            onClick={() => onMudarMes(somarMeses(competencia, 1))}
            className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            {mesPorExtenso(somarMeses(competencia, 1))}
          </button>
          .
        </p>
      ) : (
        <FormularioDaCompra
          key={corrigindo?.compraId ?? 'nova'}
          cartaoId={cartao.id}
          competencia={competencia}
          corrigindo={corrigindo}
          onCancelar={() => setCorrigindo(null)}
          onPronto={() => {
            setCorrigindo(null);
            onMudou();
          }}
          onErro={(mensagem) => onAviso(mensagem, true)}
        />
      )}

      {/* O pé da fatura: a soma, e o que ela virou (ou o botão que a faz virar). */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-tinta-200 bg-tinta-50 px-3.5 py-4 md:px-5">
        <div>
          <p className="eyebrow">Total da fatura</p>
          <p className="num mt-1 font-display text-[22px] font-semibold leading-none text-tinta-900">
            {formatBRL(total)}
          </p>
          {comprometidoDepois > 0 && (
            <p className="mt-1.5 text-[11px] text-tinta-400">
              + {formatBRL(comprometidoDepois)} já comprometidos nas faturas
              seguintes
            </p>
          )}
        </div>

        {lancada ? (
          <div className="text-right">
            <Selo tom={paga ? 'pago' : 'marca'} ponto>
              {paga ? 'paga' : 'lançada no IXC'}
            </Selo>
            <p className="num mt-1.5 text-xs text-tinta-500">
              {lancada.idFnApagarIxc
                ? `título ${lancada.idFnApagarIxc}`
                : 'ainda sem número do IXC'}{' '}
              · {formatBRL(lancada.valor)} · vence{' '}
              {formatData(lancada.dataVencimento)}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="rotulo" htmlFor={`venc-${cartao.id}`}>
                Vencimento
              </label>
              <input
                id={`venc-${cartao.id}`}
                type="date"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                className="campo py-1.5"
              />
              {!vencimento && (
                <p className="mt-1 text-[11px] text-tinta-400">
                  em branco: {formatData(dados.vencimentoSugerido)}
                </p>
              )}
            </div>
            {/* O código com que a fatura se paga. Sem ele a conta chega ao IXC
                sem como ser paga — e a fatura do cartão é das que não podem
                atrasar. */}
            <div className="min-w-[240px]">
              <label className="rotulo" htmlFor={`cod-${cartao.id}`}>
                Código de pagamento
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id={`cod-${cartao.id}`}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  className="campo num min-w-0 flex-1 py-1.5 text-xs"
                  placeholder="boleto ou PIX (opcional)"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setLendo('boleto')}
                  title="Ler o código de barras com a câmera"
                  className="btn btn-ferramenta btn-p shrink-0"
                >
                  Boleto
                </button>
                <button
                  type="button"
                  onClick={() => setLendo('pix')}
                  title="Ler o QR do PIX com a câmera"
                  className="btn btn-ferramenta btn-p shrink-0"
                >
                  QR
                </button>
              </div>
              {codigo.trim() !== '' && (
                <p className="mt-1 text-[11px] text-tinta-400">
                  {classificarCodigo(codigo)}
                </p>
              )}
            </div>
            <button
              onClick={() => gerar.mutate()}
              disabled={gerar.isPending || !(total > 0)}
              className="btn btn-primario"
              title={
                total > 0
                  ? 'Cria no IXC uma conta a pagar só, no valor da soma, já aprovada'
                  : 'Lance as compras da fatura primeiro'
              }
            >
              {gerar.isPending
                ? 'Lançando no IXC…'
                : `Gerar conta a pagar — ${formatBRL(total)}`}
            </button>
          </div>
        )}
      </div>

      {!lancada && passou && total > 0 && (
        <p className="border-t border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-800 dark:text-amber-200 md:px-5">
          Esta fatura é de um mês que já passou e ainda não virou conta a pagar.
        </p>
      )}

      {lendo && (
        <LeitorDeCodigo
          alvo={lendo}
          onLido={(lido) => {
            setCodigo(lido);
            setLendo(null);
          }}
          onFechar={() => setLendo(null)}
        />
      )}
    </section>
  );
}

/** Uma fatura na fita de meses: o mês, a soma e em que pé ela está. */
function ChipDaFatura({
  fatura,
  escolhida,
  onClick,
}: {
  fatura: ResumoDaFatura;
  escolhida: boolean;
  onClick: () => void;
}) {
  const { lancada, total, competencia } = fatura;
  const paga = !!lancada && (!!lancada.pagoEm || lancada.status === 'PAGO');
  const [texto, cor] = lancada
    ? paga
      ? ['paga', 'text-emerald-600 dark:text-emerald-300']
      : ['lançada', 'text-brand-700 dark:text-brand-300']
    : total > 0
      ? competencia < mesAtual()
        ? ['não lançada', 'text-amber-600 dark:text-amber-300']
        : ['em aberto', 'text-tinta-400']
      : ['vazia', 'text-tinta-300'];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={escolhida}
      aria-label={`Fatura de ${mesPorExtenso(competencia)}: ${texto}`}
      className={`min-w-[104px] shrink-0 rounded-xl border px-3 py-2 text-left transition ${
        escolhida
          ? 'border-brand-400 bg-brand-500/10 ring-1 ring-brand-300'
          : 'border-tinta-200 hover:border-brand-300 hover:bg-brand-500/5'
      }`}
    >
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-tinta-500">
        {rotuloDoMes(competencia)}
      </span>
      <span className="valor block text-[13px]">
        {lancada ? formatBRL(lancada.valor) : total ? formatBRL(total) : '—'}
      </span>
      <span className={`block text-[10px] font-semibold ${cor}`}>{texto}</span>
    </button>
  );
}

/**
 * O formulário de uma compra — o mesmo para lançar e para corrigir.
 *
 * Fica colado embaixo da lista, e não numa janela: uma fatura tem vinte
 * linhas, e o gesto é digitar uma, Enter, a próxima. O valor pedido é o da
 * parcela, porque é o que a fatura imprime ("03/10 R$ 89,90"); quem tiver o
 * total na mão troca o seletor.
 *
 * "Parcela 3 de 10" diz que a compra já vinha sendo paga: as parcelas 1 e 2
 * ficaram em faturas anteriores, fora daqui, e as de 4 a 10 aparecem sozinhas
 * nas próximas.
 */
function FormularioDaCompra({
  cartaoId,
  competencia,
  corrigindo,
  onCancelar,
  onPronto,
  onErro,
}: {
  cartaoId: string;
  competencia: string;
  corrigindo: ItemDaFatura | null;
  onCancelar: () => void;
  onPronto: () => void;
  onErro: (mensagem: string) => void;
}) {
  const [descricao, setDescricao] = useState(corrigindo?.descricao ?? '');
  // Na correção o valor volta como total: é o que está gravado, e o que não
  // perde centavo ao reabrir uma compra de R$ 100 em três.
  const [valor, setValor] = useState(
    corrigindo ? String(Math.abs(corrigindo.valorTotal)) : '',
  );
  const [valorDe, setValorDe] = useState<'PARCELA' | 'TOTAL'>(
    corrigindo ? 'TOTAL' : 'PARCELA',
  );
  const [estorno, setEstorno] = useState(
    corrigindo ? corrigindo.valorTotal < 0 : false,
  );
  const [parcela, setParcela] = useState(String(corrigindo?.parcela ?? 1));
  const [parcelas, setParcelas] = useState(String(corrigindo?.parcelas ?? 1));
  const campoDescricao = useRef<HTMLInputElement>(null);

  const n = Number(parcelas);
  const p = Number(parcela);
  const v = Number(valor);
  const parcelado = n > 1;

  const valido =
    descricao.trim().length > 0 &&
    v > 0 &&
    Number.isInteger(n) &&
    n >= 1 &&
    n <= 99 &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= n;

  const salvar = useMutation({
    mutationFn: async () => {
      const assinado = estorno ? -v : v;
      if (corrigindo) {
        /*
         * A âncora da compra não se move à toa. O que se vê é a parcela deste
         * mês; o que se grava é em que fatura cai a primeira parcela
         * cadastrada. Se a parcela deste mês não mudou, a âncora continua a
         * mesma — e as parcelas de faturas anteriores continuam onde estavam.
         */
        const inicial = Math.min(corrigindo.parcelaInicial, p);
        await api.patch(`/cartoes-credito/compras/${corrigindo.compraId}`, {
          descricao: descricao.trim(),
          valor: assinado,
          valorDe: parcelado ? valorDe : 'TOTAL',
          parcelas: n,
          parcelaInicial: inicial,
          primeiraFatura: somarMeses(competencia, -(p - inicial)),
        });
      } else {
        await api.post(`/cartoes-credito/${cartaoId}/compras`, {
          descricao: descricao.trim(),
          valor: assinado,
          valorDe: parcelado ? valorDe : 'TOTAL',
          parcelas: n,
          parcelaInicial: p,
          primeiraFatura: competencia,
        });
      }
    },
    onSuccess: () => {
      if (!corrigindo) {
        setDescricao('');
        setValor('');
        setEstorno(false);
        setParcela('1');
        setParcelas('1');
        campoDescricao.current?.focus();
      }
      onPronto();
    },
    onError: (err) => onErro(mensagemErro(err)),
  });

  function enviar() {
    if (valido && !salvar.isPending) salvar.mutate();
  }

  /** O que a compra vai virar, dito antes de salvar. */
  const valorDaParcela = parcelado
    ? valorDe === 'PARCELA'
      ? v
      : v / n
    : v;
  const totalDaCompra = parcelado && valorDe === 'PARCELA' ? v * n : v;

  return (
    <div
      className={`border-t px-3.5 py-3 md:px-5 ${
        corrigindo
          ? 'border-brand-300 bg-brand-500/5'
          : 'border-tinta-100'
      }`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
          e.preventDefault();
          enviar();
        }
      }}
    >
      <p className="eyebrow mb-2">
        {corrigindo ? `Corrigindo "${corrigindo.descricao}"` : 'Lançar compra'}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="rotulo" htmlFor={`desc-${cartaoId}`}>
            O que veio na fatura
          </label>
          <input
            id={`desc-${cartaoId}`}
            ref={campoDescricao}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="campo py-1.5"
            placeholder="Posto Ipiranga, Amazon, anuidade…"
            autoComplete="off"
          />
        </div>

        <div className="w-[88px]">
          <label className="rotulo" htmlFor={`parc-${cartaoId}`}>
            Parcela
          </label>
          <div className="flex items-center gap-1">
            <input
              id={`parc-${cartaoId}`}
              type="number"
              min={1}
              max={99}
              value={parcela}
              onChange={(e) => setParcela(e.target.value)}
              className="campo num w-10 px-1.5 py-1.5 text-center"
              title="Que parcela vem nesta fatura"
            />
            <span className="text-xs text-tinta-400">de</span>
          </div>
        </div>
        <div className="w-[64px]">
          <label className="rotulo" htmlFor={`qtd-${cartaoId}`}>
            Vezes
          </label>
          <input
            id={`qtd-${cartaoId}`}
            type="number"
            min={1}
            max={99}
            value={parcelas}
            onChange={(e) => setParcelas(e.target.value)}
            className="campo num px-1.5 py-1.5 text-center"
            title="Em quantas vezes a compra foi dividida (1 = à vista)"
          />
        </div>

        <div className="w-[140px]">
          <label className="rotulo" htmlFor={`valor-${cartaoId}`}>
            {parcelado ? (valorDe === 'PARCELA' ? 'Valor da parcela' : 'Valor total') : 'Valor'}
          </label>
          <CampoDinheiro
            id={`valor-${cartaoId}`}
            valor={valor}
            onChange={setValor}
            className="campo py-1.5 text-right"
          />
        </div>

        {parcelado && (
          <div>
            <label className="rotulo" htmlFor={`de-${cartaoId}`}>
              O valor é
            </label>
            <select
              id={`de-${cartaoId}`}
              value={valorDe}
              onChange={(e) => setValorDe(e.target.value as 'PARCELA' | 'TOTAL')}
              className="campo py-1.5"
            >
              <option value="PARCELA">de cada parcela</option>
              <option value="TOTAL">da compra inteira</option>
            </select>
          </div>
        )}

        <label
          className="mb-2 flex items-center gap-1.5 text-xs text-tinta-500"
          title="Crédito na fatura: abate da soma"
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-brand-600"
            checked={estorno}
            onChange={(e) => setEstorno(e.target.checked)}
          />
          estorno
        </label>

        <div className="flex gap-1.5">
          {corrigindo && (
            <button onClick={onCancelar} className="btn btn-sutil">
              Cancelar
            </button>
          )}
          <button
            onClick={enviar}
            disabled={!valido || salvar.isPending}
            className="btn btn-primario"
          >
            {salvar.isPending ? 'Salvando…' : corrigindo ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>

      {/* A conta dita em voz alta: é aqui que se pega a parcela digitada no
          campo do total, antes de ela virar dez faturas erradas. */}
      {parcelado && v > 0 && p >= 1 && p <= n && (
        <p className="num mt-2 text-[11px] text-tinta-400">
          {n}× de {formatBRL(valorDaParcela)} = {formatBRL(totalDaCompra)}.
          {p > 1 && ` As parcelas 1 a ${p - 1} ficaram em faturas anteriores.`}
          {p < n
            ? ` Parcela ${p} nesta fatura, a última em ${rotuloDoMes(somarMeses(competencia, n - p))}.`
            : ' Esta é a última parcela.'}
        </p>
      )}
      {parcelado && p > n && (
        <p className="mt-2 text-[11px] font-semibold text-amber-600">
          A parcela desta fatura não pode passar do número de vezes.
        </p>
      )}
    </div>
  );
}

/**
 * O cadastro de um cartão — o mesmo formulário para criar e para editar.
 *
 * Só o que não muda de uma fatura para a outra: de que banco, que dia vence,
 * em que conta a despesa entra. Desligar e apagar moram no rodapé da edição,
 * longe do trabalho de todo mês.
 */
function CadastroDoCartao({
  cartao,
  onFechar,
  onPronto,
}: {
  cartao: CartaoCredito | null;
  onFechar: () => void;
  onPronto: (mensagem: string) => void;
}) {
  const editando = !!cartao;
  const [apelido, setApelido] = useState(cartao?.apelido ?? '');
  const [final, setFinal] = useState(cartao?.final ?? '');
  const [diaDeVencimento, setDiaDeVencimento] = useState(
    String(cartao?.diaDeVencimento ?? ''),
  );
  const [contaContabil, setContaContabil] = useState(
    cartao?.contaContabil ? String(cartao.contaContabil) : '',
  );
  const [contaPagamento, setContaPagamento] = useState(
    cartao?.contaPagamento ? String(cartao.contaPagamento) : '',
  );
  const [tipoPagamento, setTipoPagamento] = useState(
    cartao?.tipoPagamentoIxc ?? 'Boleto',
  );
  const [categoriaId, setCategoriaId] = useState(cartao?.categoriaId ?? '');

  const [fornecedor, setFornecedor] = useState<{
    id: number;
    nome: string;
  } | null>(
    cartao ? { id: cartao.idFornecedorIxc, nome: cartao.fornecedorNome } : null,
  );
  const [termo, setTermo] = useState('');
  // Cada tecla aqui seria uma consulta ao IXC, que é lento e não é nosso.
  const buscaEfetiva = useTermoAdiado(termo);

  const fornecedores = useQuery({
    queryKey: ['fornecedores-ixc', buscaEfetiva],
    queryFn: async () =>
      (
        await api.get<FornecedorIxc[]>('/fornecedores-ixc', {
          params: { busca: buscaEfetiva },
        })
      ).data,
    enabled: buscaEfetiva.length >= 2 && !fornecedor,
    retry: 0,
  });

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  const config = useQuery({
    queryKey: ['config-financeira'],
    queryFn: async () =>
      (await api.get<ConfigDaCasa>('/config-financeira')).data,
    retry: 0,
  });

  const contasIxc = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (
        await api.get<ContaDePagamentoIxc[]>(
          '/contas-abertas/contas-pagamento',
        )
      ).data,
  });

  const plano = useQuery({
    queryKey: ['plano-de-contas'],
    queryFn: async () =>
      (await api.get<ContaDoPlano[]>('/contas-abertas/plano-de-contas')).data,
    retry: 0,
  });

  const salvar = useMutation({
    mutationFn: async (extra: Record<string, unknown> = {}) => {
      const dados = {
        apelido: apelido.trim(),
        final: final.replace(/\D/g, ''),
        idFornecedorIxc: fornecedor!.id,
        fornecedorNome: fornecedor!.nome,
        diaDeVencimento: Number(diaDeVencimento),
        contaContabil: contaContabil ? Number(contaContabil) : undefined,
        contaPagamento: contaPagamento ? Number(contaPagamento) : undefined,
        tipoPagamentoIxc: tipoPagamento.trim() || undefined,
        categoriaId: categoriaId || null,
        ...extra,
      };
      if (cartao) await api.patch(`/cartoes-credito/${cartao.id}`, dados);
      else await api.post('/cartoes-credito', dados);
    },
    onSuccess: (_r, extra) =>
      onPronto(
        extra && 'ativo' in extra
          ? `${apelido.trim()} desligado. As faturas já lançadas continuam no IXC.`
          : editando
            ? `${apelido.trim()} atualizado.`
            : `${apelido.trim()} cadastrado. Agora é lançar as compras da fatura.`,
      ),
  });

  const apagar = useMutation({
    mutationFn: async () => {
      await api.delete(`/cartoes-credito/${cartao!.id}`);
    },
    onSuccess: () =>
      onPronto(
        `${cartao!.apelido} apagado. As faturas já lançadas continuam no IXC.`,
      ),
  });

  const podeSalvar =
    apelido.trim().length >= 2 &&
    !!fornecedor &&
    Number(diaDeVencimento) >= 1 &&
    Number(diaDeVencimento) <= 31 &&
    /^(\d{4})?$/.test(final.replace(/\D/g, ''));

  return (
    <Janela
      titulo={editando ? `Editar — ${cartao!.apelido}` : 'Cadastrar cartão'}
      onFechar={onFechar}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="cartao-apelido">
            Nome do cartão
          </label>
          <input
            id="cartao-apelido"
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            className="campo"
            placeholder="Sicoob Visa, Nubank da loja…"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="cartao-final">
            Final (4 últimos dígitos)
          </label>
          <input
            id="cartao-final"
            value={final}
            onChange={(e) => setFinal(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="campo num"
            inputMode="numeric"
            placeholder="opcional"
            autoComplete="off"
          />
        </div>

        {/* Quem recebe a fatura: o banco, no cadastro de fornecedores do IXC. */}
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="cartao-fornecedor">
            Banco (fornecedor no IXC)
          </label>
          {fornecedor ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-tinta-50 px-3 py-2">
              <span className="text-tinta-800">{fornecedor.nome}</span>
              <span className="num text-xs text-tinta-400">
                código {fornecedor.id}
              </span>
              <button
                onClick={() => {
                  setFornecedor(null);
                  setTermo('');
                }}
                className="btn btn-sutil btn-p ml-auto"
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <input
                id="cartao-fornecedor"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                className="campo"
                placeholder="Nome, razão social ou CNPJ do banco"
                autoComplete="off"
              />
              {fornecedores.isLoading && (
                <p className="ajuda">Procurando no IXC…</p>
              )}
              {fornecedores.data && fornecedores.data.length === 0 && (
                <p className="ajuda">Nenhum fornecedor com esse nome no IXC.</p>
              )}
              {fornecedores.data && fornecedores.data.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                  {fornecedores.data.map((f) => (
                    <button
                      key={f.idFornecedor}
                      onClick={() =>
                        setFornecedor({ id: f.idFornecedor, nome: f.nome })
                      }
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-tinta-50"
                    >
                      <span className="text-tinta-800">{f.nome}</span>
                      <span className="num ml-2 text-xs text-tinta-400">
                        {f.idFornecedor}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="rotulo" htmlFor="cartao-vencimento">
            Dia em que a fatura vence
          </label>
          <input
            id="cartao-vencimento"
            type="number"
            min={1}
            max={31}
            value={diaDeVencimento}
            onChange={(e) => setDiaDeVencimento(e.target.value)}
            className="campo num"
          />
          <p className="ajuda">
            É o vencimento da conta gerada. Caindo em fim de semana ou feriado,
            anda para o próximo dia útil.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="cartao-tipo">
            Tipo de pagamento
          </label>
          <select
            id="cartao-tipo"
            value={tipoPagamento}
            onChange={(e) => setTipoPagamento(e.target.value)}
            className="campo"
          >
            {['Boleto', 'Pix', 'Débito em conta', 'Transferência'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <p className="ajuda">
            O código colado na hora de gerar manda sobre este: boleto vai como
            Boleto, QR do PIX vai como Pix.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="cartao-contabil">
            Conta contábil no IXC
          </label>
          <select
            id="cartao-contabil"
            value={contaContabil}
            onChange={(e) => setContaContabil(e.target.value)}
            className="campo"
            disabled={plano.isLoading}
          >
            <option value="">
              {nomeDaContaContabilPadrao(config.data, plano.data)}
            </option>
            {(plano.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} — {p.nome}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="rotulo" htmlFor="cartao-conta-pagamento">
            Conta de pagamento
          </label>
          <select
            id="cartao-conta-pagamento"
            value={contaPagamento}
            onChange={(e) => setContaPagamento(e.target.value)}
            className="campo"
            disabled={contasIxc.isLoading}
          >
            <option value="">
              {nomeDaContaDePagamentoPadrao(config.data, contasIxc.data)}
            </option>
            {(contasIxc.data ?? [])
              .filter((c) => c.usual || c.ativa)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="cartao-categoria">
            Categoria
          </label>
          <SeletorDeCategoria
            id="cartao-categoria"
            categorias={categorias.data ?? []}
            value={categoriaId}
            onChange={setCategoriaId}
            vazio="Sem categoria"
            carregando={categorias.isLoading}
          />
        </div>
      </div>

      {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}
      {apagar.isError && <Aviso tom="erro">{mensagemErro(apagar.error)}</Aviso>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-tinta-200 pt-4">
        <div className="flex flex-wrap gap-2">
          {editando && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      `Apagar ${cartao!.apelido}? As compras lançadas nele somem ` +
                        'junto; as faturas que já viraram conta continuam no IXC. ' +
                        'Desligar guarda o histórico.',
                    )
                  ) {
                    apagar.mutate();
                  }
                }}
                disabled={apagar.isPending}
                className="btn btn-perigo"
              >
                Apagar cartão
              </button>
              {cartao!.ativo && (
                <button
                  type="button"
                  onClick={() => salvar.mutate({ ativo: false })}
                  disabled={!podeSalvar || salvar.isPending}
                  className="btn btn-neutro"
                  title="Some da tela; o que já foi lançado continua lá"
                >
                  Desligar
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            onClick={() => salvar.mutate({})}
            disabled={!podeSalvar || salvar.isPending}
            className="btn btn-primario"
          >
            {salvar.isPending
              ? 'Salvando…'
              : editando
                ? 'Salvar'
                : 'Cadastrar cartão'}
          </button>
        </div>
      </div>
    </Janela>
  );
}

/** "Sicoob Visa · final 1234". */
function nomeDoCartao(cartao: CartaoCredito): string {
  return cartao.final ? `${cartao.apelido} · final ${cartao.final}` : cartao.apelido;
}

/**
 * O que o código colado parece ser — a mesma leitura que o servidor faz, dita
 * na hora de digitar.
 */
function classificarCodigo(codigo: string): string {
  const texto = codigo.trim();
  if (/^000201/.test(texto) || /br\.gov\.bcb\.pix/i.test(texto)) {
    return 'PIX copia e cola — a conta vai como Pix';
  }
  const digitos = texto.replace(/\D/g, '');
  if ([44, 47, 48].includes(digitos.length)) {
    return `boleto de ${digitos.length} dígitos — a conta vai como Boleto`;
  }
  return `não parece boleto (44, 47 ou 48 dígitos — este tem ${digitos.length}) nem PIX copia e cola`;
}

function nomeDaContaContabilPadrao(
  config: ConfigDaCasa | undefined,
  plano: ContaDoPlano[] | undefined,
): string {
  if (!config) return 'Padrão das Configurações';
  const conta = plano?.find((p) => p.id === config.contaContabilAvulso);
  return conta
    ? `Padrão — ${conta.id} ${conta.nome}`
    : `Padrão — conta ${config.contaContabilAvulso}`;
}

function nomeDaContaDePagamentoPadrao(
  config: ConfigDaCasa | undefined,
  contas: ContaDePagamentoIxc[] | undefined,
): string {
  if (!config) return 'Padrão das Configurações';
  const conta = contas?.find((c) => c.id === config.contaPagamentoId);
  return conta
    ? `Padrão — ${conta.nome}`
    : `Padrão — conta ${config.contaPagamentoId}`;
}

/** "AAAA-MM" do mês corrente. */
function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-11" + 3 → "2027-02". */
function somarMeses(competencia: string, meses: number): string {
  const [ano, mes] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "2026-10" → "out/26". */
function rotuloDoMes(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  return `${MESES[mes - 1]?.slice(0, 3) ?? competencia}/${String(ano).slice(2)}`;
}

/** "2026-10" → "outubro/2026". */
function mesPorExtenso(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  return `${MESES[mes - 1] ?? competencia}/${ano}`;
}
