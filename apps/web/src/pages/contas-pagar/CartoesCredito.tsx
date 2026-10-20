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
import { CampoDeData } from '../../components/CampoDeData';
import { CamposDasContasDoIxc } from './ContasDoIxc';
import { FormularioEmPassos } from '../../components/FormularioEmPassos';

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
  /** O que cai nesta fatura, com o ajuste do mês quando há. */
  valor: number;
  /** O que cairia sem o ajuste: a parcela calculada, ou a mensalidade. */
  valorNormal: number;
  valorTotal: number;
  parcelaInicial: number;
  primeiraFatura: string;
  /** Cobra todo mês, sem parcelas, até ser encerrada. */
  assinatura: boolean;
  ultimaFatura: string | null;
  categoriaId: string | null;
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

/*
 * A compra aberta no Editar (ou o Lançar compra) vira um cartão solto da
 * lista: borda azul grossa, véu azul e sombra. Com só um véu de 5%, no tema
 * escuro não se via qual linha estava sendo mexida (15/10/2026).
 */
const CARTAO_ABERTO =
  'mx-2 my-2 overflow-hidden rounded-xl border-2 border-brand-500 bg-brand-500/10 shadow-lg ring-4 ring-brand-500/15 md:mx-3';

/*
 * Os botões desta tela com contorno que se vê de longe — a borda de 30% do
 * `btn-ferramenta`/`btn-alerta` sumia no fundo escuro. Como utilitários, eles
 * ganham da camada de componentes onde os `btn-*` moram.
 */
const CONTORNO_AZUL = 'border-brand-500/70 dark:border-brand-400/70';
const CONTORNO_VERMELHO = 'border-rose-500/70 dark:border-rose-400/70';
const CONTORNO_CINZA = 'border-tinta-400';

/** Os campos do formulário da compra: todos da mesma altura, letra menor. */
const CAMPO_DO_FORMULARIO = 'campo';

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
 * alto dela ("fatura de outubro"). Quem anda de mês são os meses no alto de
 * cada cartão: o seletor de mês que ficava acima deles dizia a mesma coisa
 * duas vezes, e a tela foi enxugada a pedido (15/10/2026, "tem muita
 * informação").
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

      {lista.isLoading ? (
        <Bloco semPadding>
          <Carregando texto="Lendo os cartões…" />
        </Bloco>
      ) : cartoes.length === 0 ? (
        <Bloco semPadding>
          <Vazio titulo="Cadastre o primeiro cartão." />
        </Bloco>
      ) : (
        /* Lado a lado na tela larga, e só com mais de um cartão: sozinho, ele
           fica com a largura toda. Cada um tem a sua altura (`items-start`)
           — o de fatura curta não estica para acompanhar o vizinho. */
        <div
          className={`grid grid-cols-1 items-start gap-5 ${
            ativos.length > 1 ? '2xl:grid-cols-2' : ''
          }`}
        >
          {ativos.map((dados) => (
            <FaturaDoCartao
              key={dados.cartao.id}
              ladoALado={ativos.length > 1}
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
                  className="btn btn-ok btn-p"
                >
                  Religar
                </button>
                <button
                  onClick={() => setEditando(cartao)}
                  className="btn btn-ferramenta btn-p"
                >
                  Editar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
 * Um cartão e a fatura do mês: os meses vizinhos no alto, uma linha por
 * compra, o total e o botão que a faz virar conta.
 *
 * Cada linha diz só o nome, a parcela, a categoria e o valor — o resto (o
 * total da compra, até quando vai, o valor de todo mês da assinatura) mora no
 * Editar, que abre embaixo da própria linha. O formulário de lançar e os
 * campos de gerar a conta também ficam fechados até alguém pedir: abertos o
 * tempo todo, eram metade da tela.
 */
function FaturaDoCartao({
  ladoALado,
  dados,
  competencia,
  onMudarMes,
  onEditar,
  onAviso,
  onMudou,
}: {
  /** Há outro cartão na tela: na tela larga, ele fica com meia largura. */
  ladoALado: boolean;
  dados: CartaoDoMes;
  competencia: string;
  onMudarMes: (competencia: string) => void;
  onEditar: () => void;
  onAviso: (mensagem: string, erro?: boolean) => void;
  onMudou: () => void;
}) {
  const { cartao, itens, total, lancada, faturas } = dados;
  /** A compra aberta no Editar, ou "nova" com o formulário de lançar aberto. */
  const [aberta, setAberta] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [vencimento, setVencimento] = useState('');
  const [codigo, setCodigo] = useState('');
  const [lendo, setLendo] = useState<AlvoDaLeitura | null>(null);

  /*
   * Trocar de mês fecha o que estava aberto. O vencimento de outubro digitado
   * aqui não pode ir parar na fatura de novembro com um clique distraído.
   */
  useEffect(() => {
    setAberta(null);
    setGerando(false);
    setVencimento('');
    setCodigo('');
  }, [competencia]);

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
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
          `no IXC: ${formatBRL(r.total)}` +
          (r.conta.idFnApagarIxc ? ` — título ${r.conta.idFnApagarIxc}.` : '.'),
      );
      setGerando(false);
      setVencimento('');
      setCodigo('');
      onMudou();
    },
    onError: (err) => onAviso(mensagemErro(err), true),
  });

  const paga = !!lancada && (!!lancada.pagoEm || lancada.status === 'PAGO');

  function formulario(corrigindo: ItemDaFatura | null) {
    return (
      <FormularioDaCompra
        key={corrigindo?.compraId ?? 'nova'}
        cartaoId={cartao.id}
        competencia={competencia}
        corrigindo={corrigindo}
        travada={!!lancada}
        categorias={categorias.data ?? []}
        carregandoCategorias={categorias.isLoading}
        onFechar={() => setAberta(null)}
        // Lançou ou salvou, fecha: o formulário aberto depois de "Adicionar"
        // parecia que a compra não tinha entrado (pedido de 15/10/2026).
        onPronto={() => {
          setAberta(null);
          onMudou();
        }}
        onErro={(mensagem) => onAviso(mensagem, true)}
      />
    );
  }

  return (
    <section className="card overflow-hidden">
      <div className="faixa-titulo flex items-center justify-between gap-2 px-3.5 py-3 md:px-5">
        <div className="min-w-0">
          <h2 className="titulo-bloco truncate">{nomeDoCartao(cartao)}</h2>
          <p className="text-xs text-tinta-400">
            vence dia {cartao.diaDeVencimento}
          </p>
        </div>
        <button onClick={onEditar} className="btn btn-sutil btn-p shrink-0">
          Editar cartão
        </button>
      </div>

      {/* Os meses vizinhos são o caminho até eles: um clique no mês. No
          celular quebram em três colunas, e não numa fita que rola para o
          lado — fita escondida é mês que ninguém vê. Lado a lado, o cartão
          fica com metade da largura, e os seis meses voltam a três colunas
          até a tela ter folga para eles numa linha só. */}
      <div
        className={`grid grid-cols-3 gap-2 border-b border-tinta-100 px-3.5 py-3 md:px-5 ${
          ladoALado
            ? 'md:grid-cols-6 2xl:grid-cols-3 min-[1800px]:grid-cols-6'
            : 'rolagem-fina md:flex md:overflow-x-auto'
        }`}
      >
        {faturas.map((f) => (
          <ChipDaFatura
            key={f.competencia}
            fatura={f}
            escolhida={f.competencia === competencia}
            onClick={() => onMudarMes(f.competencia)}
          />
        ))}
      </div>

      {/* Sem `divide-y`: o fio dele ganha da borda da linha aberta (o
          seletor é mais forte), e o cartão destacado perdia o pé. */}
      <ul>
        {itens.length === 0 && (
          <li className="px-3.5 py-4 text-sm text-tinta-400 md:px-5">
            Nenhuma compra nesta fatura.
          </li>
        )}
        {itens.map((i) => {
          const detalhe = detalheDoItem(i, categorias.data ?? []);
          const estaAberta = aberta === i.compraId;
          return (
            <li
              key={i.compraId}
              className={
                estaAberta
                  ? CARTAO_ABERTO
                  : 'border-b border-tinta-100 last:border-0'
              }
            >
              <div className="flex items-center gap-3 px-3.5 py-2.5 md:px-5">
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm ${estaAberta ? 'font-semibold text-tinta-900' : 'text-tinta-800'}`}
                    title={i.descricao}
                  >
                    {i.descricao}
                  </p>
                  {detalhe && (
                    <p className="num truncate text-[11px] text-tinta-400">
                      {detalhe}
                    </p>
                  )}
                </div>
                <span
                  className={`valor shrink-0 text-sm ${i.valor < 0 ? 'text-emerald-600 dark:text-emerald-300' : ''}`}
                >
                  {formatBRL(i.valor)}
                </span>
                {!estaAberta && (
                  <button
                    onClick={() => setAberta(i.compraId)}
                    className={`btn btn-ferramenta btn-p shrink-0 ${CONTORNO_AZUL}`}
                  >
                    Editar
                  </button>
                )}
              </div>
              {estaAberta && formulario(i)}
            </li>
          );
        })}
      </ul>

      {/* Fatura lançada não recebe compra: o título do IXC já tem o valor
          dela. A esquecida entra na fatura seguinte. */}
      {!lancada &&
        (aberta === 'nova' ? (
          <div className={CARTAO_ABERTO}>{formulario(null)}</div>
        ) : (
          <div className="border-t border-tinta-100 px-3.5 py-2.5 md:px-5">
            <button
              onClick={() => setAberta('nova')}
              className={`btn btn-ferramenta btn-p ${CONTORNO_AZUL}`}
            >
              + Lançar compra
            </button>
          </div>
        ))}

      <div className="border-t border-tinta-200 bg-tinta-50 px-3.5 py-4 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Total</p>
            <p className="num mt-1 font-display text-[22px] font-semibold leading-none text-tinta-900">
              {formatBRL(total)}
            </p>
          </div>

          {lancada ? (
            <div className="text-right">
              <Selo tom={paga ? 'pago' : 'marca'} ponto>
                {paga ? 'paga' : 'lançada no IXC'}
              </Selo>
              <p className="num mt-1.5 text-xs text-tinta-500">
                {lancada.idFnApagarIxc ? `título ${lancada.idFnApagarIxc} · ` : ''}
                vence {formatData(lancada.dataVencimento)}
              </p>
            </div>
          ) : (
            !gerando && (
              <button
                onClick={() => {
                  setVencimento(dados.vencimentoSugerido.slice(0, 10));
                  setGerando(true);
                }}
                disabled={!(total > 0)}
                className="btn btn-primario"
              >
                Gerar conta a pagar
              </button>
            )
          )}
        </div>

        {/* O vencimento já vem no dia do cadastro; o código com que a fatura
            se paga é o que falta para ela não chegar ao IXC sem como ser
            paga. */}
        {!lancada && gerando && (
          <div className="mt-4 grid max-w-2xl grid-cols-1 gap-2">
            <div>
              <label className="rotulo" htmlFor={`venc-${cartao.id}`}>
                Vencimento
              </label>
              <CampoDeData
                id={`venc-${cartao.id}`}
                valor={vencimento}
                onChange={setVencimento}
                className="campo"
              />
            </div>
            <div className="min-w-0">
              <label className="rotulo" htmlFor={`cod-${cartao.id}`}>
                Código de pagamento
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id={`cod-${cartao.id}`}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  className="campo num min-w-0 flex-1"
                  placeholder="boleto ou PIX"
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
            <div className="flex justify-end gap-1.5">
              <button
                onClick={() => setGerando(false)}
                className="btn btn-neutro"
              >
                Cancelar
              </button>
              <button
                onClick={() => gerar.mutate()}
                disabled={gerar.isPending}
                className="btn btn-primario"
              >
                {gerar.isPending ? 'Lançando no IXC…' : 'Lançar no IXC'}
              </button>
            </div>
          </div>
        )}
      </div>

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

/**
 * A linha miúda embaixo do nome: "2/10 · Empréstimos", "mensal ·
 * Assinaturas". À vista não diz nada — é o normal.
 */
function detalheDoItem(
  item: ItemDaFatura,
  categorias: CategoriaDespesa[],
): string {
  const partes: string[] = [];
  if (item.assinatura) partes.push('mensal');
  else if (item.parcelas > 1) partes.push(`${item.parcela}/${item.parcelas}`);
  const categoria = categorias.find((c) => c.id === item.categoriaId);
  if (categoria) partes.push(categoria.nome);
  return partes.join(' · ');
}

/**
 * Um mês na fita: o mês, a soma e — só quando foge do normal — em que pé
 * ela está. "Em aberto" e "vazia" ficavam escritos em todo mês e não diziam
 * nada que o valor já não dissesse.
 */
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
    : total > 0 && competencia < mesAtual()
      ? ['não lançada', 'text-amber-600 dark:text-amber-300']
      : [null, ''];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={escolhida}
      aria-label={`Fatura de ${mesPorExtenso(competencia)}${texto ? `: ${texto}` : ''}`}
      className={`min-w-0 shrink-0 rounded-xl border px-3 py-2 text-left transition md:min-w-[104px] ${
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
      {texto && (
        <span className={`block text-[10px] font-semibold ${cor}`}>{texto}</span>
      )}
    </button>
  );
}

/**
 * O formulário de uma compra — o mesmo para lançar e para corrigir.
 *
 * Lançar fica embaixo da lista, e não numa janela; salvou, fecha, e a compra
 * aparece na lista logo acima. Corrigir abre embaixo da
 * própria linha, com o Apagar (ou o Encerrar, da assinatura) junto — tirar da
 * linha os dois botões de cada compra foi metade do enxugamento.
 *
 * "Parcela 3 de 10" diz que a compra já vinha sendo paga: as parcelas 1 e 2
 * ficaram em faturas anteriores, fora daqui, e as de 4 a 10 aparecem sozinhas
 * nas próximas.
 *
 * Na assinatura corrigida, o valor é **o desta fatura**: o YouTube que veio
 * R$ 35,12 em vez de R$ 34,90 muda só este mês. "Daqui em diante" é o preço
 * que subiu de vez — vale desta fatura para a frente, e as de trás ficam.
 *
 * Fatura já lançada (`travada`) só troca a categoria: o valor do título do
 * IXC não muda por baixo dele.
 */
function FormularioDaCompra({
  cartaoId,
  competencia,
  corrigindo,
  travada,
  categorias,
  carregandoCategorias,
  onFechar,
  onPronto,
  onErro,
}: {
  cartaoId: string;
  competencia: string;
  corrigindo: ItemDaFatura | null;
  travada: boolean;
  categorias: CategoriaDespesa[];
  carregandoCategorias: boolean;
  onFechar: () => void;
  onPronto: () => void;
  onErro: (mensagem: string) => void;
}) {
  const [assinatura, setAssinatura] = useState(corrigindo?.assinatura ?? false);
  const [descricao, setDescricao] = useState(corrigindo?.descricao ?? '');
  /*
   * Na correção da compra o valor volta como total: é o que está gravado, e o
   * que não perde centavo ao reabrir uma compra de R$ 100 em três. Na da
   * assinatura, volta o desta fatura — é ele que se veio corrigir.
   */
  const [valor, setValor] = useState(
    corrigindo
      ? String(Math.abs(corrigindo.assinatura ? corrigindo.valor : corrigindo.valorTotal))
      : '',
  );
  const [valorDe, setValorDe] = useState<'PARCELA' | 'TOTAL'>(
    corrigindo ? 'TOTAL' : 'PARCELA',
  );
  const [estorno, setEstorno] = useState(
    corrigindo ? corrigindo.valorTotal < 0 : false,
  );
  const [daquiEmDiante, setDaquiEmDiante] = useState(false);
  /*
   * A parcela deste mês, na compra parcelada: a que veio com juro ou com o
   * centavo do banco muda só aqui, e o total da compra fica. É o que se vem
   * corrigir mês a mês, e por isso fica antes dos campos da compra.
   */
  const parcelaDoMes =
    !!corrigindo && !corrigindo.assinatura && corrigindo.parcelas > 1;
  const [valorMes, setValorMes] = useState(
    corrigindo ? String(Math.abs(corrigindo.valor)) : '',
  );
  const [parcela, setParcela] = useState(String(corrigindo?.parcela ?? 1));
  const [parcelas, setParcelas] = useState(String(corrigindo?.parcelas ?? 1));
  const [categoriaId, setCategoriaId] = useState(corrigindo?.categoriaId ?? '');
  const campoDescricao = useRef<HTMLInputElement>(null);

  const n = assinatura ? 1 : Number(parcelas);
  const p = assinatura ? 1 : Number(parcela);
  const v = Number(valor);
  const parcelado = n > 1;
  const vm = Number(valorMes);
  const mudouMes =
    parcelaDoMes &&
    Math.round(vm * 100) !== Math.round(Math.abs(corrigindo.valor) * 100);

  const valido =
    travada ||
    (descricao.trim().length > 0 &&
      v > 0 &&
      Number.isInteger(n) &&
      n >= 1 &&
      n <= 99 &&
      Number.isInteger(p) &&
      p >= 1 &&
      p <= n &&
      (!parcelaDoMes || vm > 0));

  const salvar = useMutation({
    mutationFn: async () => {
      const categoria = categoriaId || null;
      if (corrigindo && travada) {
        await api.patch(`/cartoes-credito/compras/${corrigindo.compraId}`, {
          categoriaId: categoria,
        });
      } else if (corrigindo?.assinatura) {
        await api.patch(`/cartoes-credito/compras/${corrigindo.compraId}`, {
          descricao: descricao.trim(),
          valor: v,
          valorDe: 'TOTAL',
          aPartirDe: competencia,
          soNesteMes: !daquiEmDiante,
          categoriaId: categoria,
        });
      } else if (corrigindo) {
        /*
         * A âncora da compra não se move à toa. O que se vê é a parcela deste
         * mês; o que se grava é em que fatura cai a primeira parcela
         * cadastrada. Se a parcela deste mês não mudou, a âncora continua a
         * mesma — e as parcelas de faturas anteriores continuam onde estavam.
         */
        const inicial = Math.min(corrigindo.parcelaInicial, p);
        await api.patch(`/cartoes-credito/compras/${corrigindo.compraId}`, {
          descricao: descricao.trim(),
          valor: estorno ? -v : v,
          valorDe: parcelado ? valorDe : 'TOTAL',
          parcelas: n,
          parcelaInicial: inicial,
          primeiraFatura: somarMeses(competencia, -(p - inicial)),
          categoriaId: categoria,
          // Só vai quando foi mexido: com o total trocado, a parcela do mês
          // que ficou como estava é recalculada, e não congelada no valor velho.
          ...(mudouMes
            ? { valorNoMes: estorno ? -vm : vm, aPartirDe: competencia }
            : {}),
        });
      } else {
        await api.post(`/cartoes-credito/${cartaoId}/compras`, {
          descricao: descricao.trim(),
          valor: assinatura ? v : estorno ? -v : v,
          valorDe: parcelado ? valorDe : 'TOTAL',
          parcelas: n,
          parcelaInicial: p,
          primeiraFatura: competencia,
          assinatura,
          categoriaId: categoria,
        });
      }
    },
    onSuccess: onPronto,
    onError: (err) => onErro(mensagemErro(err)),
  });

  /** A assinatura sai desta fatura e das seguintes; a compra sai inteira. */
  const tirar = useMutation({
    mutationFn: async (item: ItemDaFatura) => {
      if (item.assinatura) {
        await api.post(`/cartoes-credito/compras/${item.compraId}/encerrar`, {
          aPartirDe: competencia,
        });
      } else {
        await api.delete(`/cartoes-credito/compras/${item.compraId}`);
      }
    },
    onSuccess: onPronto,
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
      className={`px-3.5 py-3 md:px-5 ${
        corrigindo ? 'border-t border-brand-500/30' : ''
      }`}
      onKeyDown={(e) => {
        const alvo = e.target as HTMLElement;
        /*
         * Enter lança a linha — menos dentro do seletor de categoria, onde ele
         * escolhe a opção. A lista dele pode abrir fora deste bloco, e o
         * evento chega aqui mesmo assim: por isso a conferência do `contains`.
         */
        if (
          e.key === 'Enter' &&
          alvo.tagName !== 'BUTTON' &&
          e.currentTarget.contains(alvo) &&
          !alvo.closest('[data-seletor-categoria]')
        ) {
          e.preventDefault();
          enviar();
        }
      }}
    >
      {/* O tipo não muda na correção: compra e assinatura contam faturas de
          jeitos diferentes, e trocar uma pela outra é apagar e lançar. */}
      {!corrigindo && (
        <div
          role="radiogroup"
          aria-label="Tipo de lançamento"
          className="mb-2 inline-flex rounded-lg border border-tinta-200 p-0.5 text-xs"
        >
          {(
            [
              [false, 'Compra'],
              [true, 'Assinatura'],
            ] as const
          ).map(([ehAssinatura, rotulo]) => (
            <button
              key={rotulo}
              type="button"
              role="radio"
              aria-checked={assinatura === ehAssinatura}
              onClick={() => setAssinatura(ehAssinatura)}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                assinatura === ehAssinatura
                  ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                  : 'text-tinta-500 hover:text-tinta-700'
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      )}

      {/*
        Um campo por linha, como no resto do sistema: lado a lado, no meio
        cartão (dois cartões lado a lado), a fileira quebrava em qualquer
        ponto e cada linha ficava de um tamanho. Só "parcela 2 de 10" divide
        a linha, porque é um número só.
      */}
      <div className="grid max-w-2xl grid-cols-1 gap-2">
        {!travada && (
          <div>
            <label className="rotulo" htmlFor={`desc-${cartaoId}`}>
              Descrição
            </label>
            <input
              id={`desc-${cartaoId}`}
              ref={campoDescricao}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className={CAMPO_DO_FORMULARIO}
              placeholder={
                assinatura
                  ? 'ChatGPT, domínio, Google Workspace…'
                  : 'Posto Ipiranga, Amazon, anuidade…'
              }
              autoComplete="off"
              autoFocus={!corrigindo}
            />
          </div>
        )}

        <div className="min-w-0" data-seletor-categoria>
          <label className="rotulo" htmlFor={`cat-${cartaoId}`}>
            Categoria
          </label>
          <SeletorDeCategoria
            id={`cat-${cartaoId}`}
            categorias={categorias}
            value={categoriaId}
            onChange={setCategoriaId}
            vazio="Sem categoria"
            carregando={carregandoCategorias}
            className={CAMPO_DO_FORMULARIO}
          />
        </div>

        {!travada && parcelaDoMes && (
          <div className="min-w-0">
            <label className="rotulo" htmlFor={`mes-${cartaoId}`}>
              Valor em {rotuloDoMes(competencia)}
            </label>
            <CampoDinheiro
              id={`mes-${cartaoId}`}
              valor={valorMes}
              onChange={setValorMes}
              className={CAMPO_DO_FORMULARIO}
            />
          </div>
        )}

        {!travada && !assinatura && (
          <div className="min-w-0">
            <label className="rotulo" htmlFor={`parc-${cartaoId}`}>
              Parcela
            </label>
            <div className="flex items-center gap-1">
              <input
                id={`parc-${cartaoId}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={parcela}
                onChange={(e) => setParcela(e.target.value)}
                className={`${CAMPO_DO_FORMULARIO} num w-16 px-1.5 text-center`}
                title="Que parcela vem nesta fatura"
              />
              <span className="text-xs text-tinta-400">de</span>
              <input
                id={`qtd-${cartaoId}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
                className={`${CAMPO_DO_FORMULARIO} num w-16 px-1.5 text-center`}
                aria-label="Vezes"
                title="Em quantas vezes a compra foi dividida (1 = à vista)"
              />
            </div>
          </div>
        )}

        {!travada && (
          <div className="min-w-0">
            <label className="rotulo" htmlFor={`valor-${cartaoId}`}>
              {corrigindo?.assinatura
                ? daquiEmDiante
                  ? 'Valor por mês'
                  : `Valor em ${rotuloDoMes(competencia)}`
                : assinatura
                  ? 'Valor por mês'
                  : parcelado
                    ? valorDe === 'PARCELA'
                      ? 'Valor da parcela'
                      : 'Valor total'
                    : 'Valor'}
            </label>
            <CampoDinheiro
              id={`valor-${cartaoId}`}
              valor={valor}
              onChange={setValor}
              className={CAMPO_DO_FORMULARIO}
            />
          </div>
        )}

        {!travada && parcelado && (
          <div className="min-w-0">
            <label className="rotulo" htmlFor={`de-${cartaoId}`}>
              O valor é
            </label>
            <select
              id={`de-${cartaoId}`}
              value={valorDe}
              onChange={(e) => setValorDe(e.target.value as 'PARCELA' | 'TOTAL')}
              className={CAMPO_DO_FORMULARIO}
            >
              <option value="PARCELA">da parcela</option>
              <option value="TOTAL">da compra toda</option>
            </select>
          </div>
        )}
      </div>

      {/* As caixas de marcar ficam na linha de baixo, com a conta: dentro da
          grade elas ocupavam uma coluna inteira por uma palavra. Estorno que
          se repete todo mês não existe — o crédito entra como compra. */}
      {!travada && (!assinatura || corrigindo?.assinatura) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {!assinatura && (
            <label
              className="flex items-center gap-1.5 text-xs text-tinta-500"
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
          )}
          {corrigindo?.assinatura && (
            <label className="flex items-center gap-1.5 text-xs text-tinta-500">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brand-600"
                checked={daquiEmDiante}
                onChange={(e) => setDaquiEmDiante(e.target.checked)}
              />
              daqui em diante
            </label>
          )}
        </div>
      )}

      {/* A conta dita em voz alta: é aqui que se pega a parcela digitada no
          campo do total, antes de ela virar dez faturas erradas. */}
      {!travada && parcelado && v > 0 && p >= 1 && p <= n && (
        <p className="num mt-2 text-[11px] text-tinta-400">
          {n}× de {formatBRL(valorDaParcela)} = {formatBRL(totalDaCompra)}
          {p < n
            ? ` · última em ${rotuloDoMes(somarMeses(competencia, n - p))}`
            : ' · última parcela'}
        </p>
      )}
      {!travada && parcelado && p > n && (
        <p className="mt-2 text-[11px] font-semibold text-amber-600">
          A parcela não pode passar do número de vezes.
        </p>
      )}
      {!travada &&
        corrigindo &&
        (corrigindo.assinatura ? !daquiEmDiante : parcelaDoMes) &&
        Math.round(corrigindo.valor * 100) !==
          Math.round(corrigindo.valorNormal * 100) && (
          <p className="num mt-2 text-[11px] text-tinta-400">
            {corrigindo.assinatura ? 'Todo mês' : 'Parcela normal'}:{' '}
            {formatBRL(Math.abs(corrigindo.valorNormal))}
          </p>
        )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          {corrigindo && !travada && (
            <button
              onClick={() => {
                const pergunta = corrigindo.assinatura
                  ? `Encerrar "${corrigindo.descricao}" a partir de ${mesPorExtenso(competencia)}?`
                  : `Apagar "${corrigindo.descricao}"?`;
                if (confirm(pergunta)) tirar.mutate(corrigindo);
              }}
              disabled={tirar.isPending}
              className={`btn btn-alerta ${CONTORNO_VERMELHO}`}
            >
              {corrigindo.assinatura ? 'Encerrar' : 'Apagar'}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onFechar} className={`btn btn-neutro ${CONTORNO_CINZA}`}>
            {corrigindo ? 'Cancelar' : 'Fechar'}
          </button>
          <button
            onClick={enviar}
            disabled={!valido || salvar.isPending}
            className="btn btn-primario ring-2 ring-brand-400/40"
          >
            {salvar.isPending ? 'Salvando…' : corrigindo ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
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
      <FormularioEmPassos>
      <div className="grid max-w-2xl grid-cols-1 gap-3">
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
        <div>
          <label className="rotulo" htmlFor="cartao-fornecedor">
            Banco (fornecedor no IXC)
          </label>
          {fornecedor ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-realce px-3 py-2">
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
                type="search"
                placeholder="Razão social ou CNPJ do banco"
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
            inputMode="numeric"
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

        <CamposDasContasDoIxc
          prefixo="cartao"
          contaContabil={contaContabil}
          onContaContabil={setContaContabil}
          contaPagamento={contaPagamento}
          onContaPagamento={setContaPagamento}
        />

        {/* Sem categoria aqui: ela é de cada compra, e não do cartão — na
            mesma fatura vêm a moto, a anuidade e o ChatGPT. */}
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
      </FormularioEmPassos>
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
