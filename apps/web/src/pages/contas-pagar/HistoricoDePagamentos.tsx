import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  // `Janela` aqui é o período (ver o fim do arquivo); a do sistema muda de nome.
  Janela as JanelaDoSistema,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { abrirArquivo, motivoDoErroEmArquivo } from '../../lib/arquivo';
import { IconeCompartilhar, IconeFiltro } from '../../components/icones';
import { combina, semAcento, useTermoAdiado } from '../../lib/busca';
import { SeletorComBusca } from '../../components/SeletorComBusca';
import { formatBRL, formatData } from '../../lib/format';
import { TIPO_LABEL } from '../../lib/status';
import type { HistoricoPagamentos, PagamentoFeito } from '../../lib/types';
import { DetalheDoPagamento, PrazoDoPagamento } from './DetalheDoPagamento';
import { CampoDeData } from '../../components/CampoDeData';
import { SeloDaCategoria } from '../../components/SeloDaCategoria';

/**
 * O que a empresa já pagou, lido do IXC na hora.
 *
 * A outra metade da tela de contas em aberto, e da mesma tabela do IXC: título
 * pago não muda de lugar lá, ele ganha a baixa. A diferença é a pergunta. Lá se
 * pergunta "o que pagar agora"; aqui, "isto saiu mesmo?" — então a tela é
 * organizada em torno da conferência: o que não fecha no registro do IXC aparece
 * marcado, e há um recorte só para ele.
 *
 * O período não é enfeite de filtro: é o que torna a leitura possível. Histórico
 * de pagamento só acumula, e uma base com anos de movimento tem dezenas de
 * milhares de baixas — pedir "tudo" seria uma tela que nunca abre.
 */

/**
 * Os recortes da lista. Só dois além de "todos", e de propósito: são os que
 * respondem a uma pergunta de quem confere ("o que está torto?", "o que ficou
 * pela metade?"). Separar em dia de em atraso não era recorte, era estatística —
 * e cada linha já diz o seu prazo.
 */
type Recorte = 'todos' | 'ressalva' | 'parciais';

/**
 * A marca de UTF-8 que vai na frente do CSV: sem ela o Excel abre os acentos
 * errados ("ENERGISA CEARÃ"). Escrita pelo código do caractere de propósito —
 * solto no meio do arquivo ele é invisível no editor, e ninguém entende por que
 * a linha tem um espaço que não existe.
 */
const BOM_UTF8 = String.fromCharCode(0xfeff);

/**
 * Com ao menos isto digitado, a busca procura no histórico todo, e não só no
 * período. O mesmo mínimo da API (`historico-pagamentos.busca.ts`).
 */
const MINIMO_DA_BUSCA = 2;

/**
 * Os filtros de escolher, atrás do botão Filtrar: faixa de valor pago, de que
 * conta saiu, a forma e a categoria. Valem sobre o que já foi lido — nenhum
 * deles relê o IXC. O período mora na mesma janela, mas à parte: trocá-lo lê.
 */
interface Filtros {
  /** Valor pago mínimo e máximo, como o `CampoDinheiro` os dá ("2107.03" ou ""). */
  valorDe: string;
  valorAte: string;
  conta: string;
  forma: string;
  categoria: string;
}

const SEM_FILTROS: Filtros = { valorDe: '', valorAte: '', conta: '', forma: '', categoria: '' };

/** A conta de onde saiu, como a coluna "Saiu de" a escreve. */
function contaDe(p: PagamentoFeito): string {
  return p.caixa.nome ?? (p.caixa.id ? `caixa ${p.caixa.id}` : '');
}

/** O que há para escolher em cada lista: só o que aparece no período lido. */
function opcoesDe(pagamentos: PagamentoFeito[], ler: (p: PagamentoFeito) => string | null | undefined) {
  return [...new Set(pagamentos.map((p) => ler(p) ?? '').filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
}

/** O que a busca procura em cada pagamento — a mesma lista que a API usa. */
function camposDaBusca(p: PagamentoFeito) {
  return [
    p.fornecedor.nome,
    p.documento,
    p.observacao,
    p.formaPagamento,
    p.caixa.nome,
    p.classificacao?.nome,
    p.origem?.beneficiario,
    /*
     * O valor também se procura — é por ele que se acha o pagamento de que
     * só se lembra o número. Escrito como a tela o mostra: a busca ignora
     * ponto e vírgula (ver `semSeparador`), então "2330", "2.330" e
     * "2330,00" acham a mesma linha.
     */
    formatBRL(p.valorPago),
    formatBRL(p.valor),
  ];
}

/** Do pagamento mais recente para o mais antigo, como a API ordena. */
function ordenarPorPagamento(pagamentos: PagamentoFeito[]): PagamentoFeito[] {
  return [...pagamentos].sort(
    (a, b) =>
      b.pagoEm.localeCompare(a.pagoEm) ||
      b.registradoEm.localeCompare(a.registradoEm) ||
      (b.horaDoRegistro ?? '').localeCompare(a.horaDoRegistro ?? '') ||
      b.idFnApagar - a.idFnApagar,
  );
}

export function HistoricoDePagamentos() {
  const [periodo, setPeriodo] = useState(ultimosDias(30));
  const [recorte, setRecorte] = useState<Recorte>('todos');
  const [busca, setBusca] = useState('');
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTROS);
  /** A janela do Filtrar está aberta? */
  const [filtrando, setFiltrando] = useState(false);
  /** Pagamento cuja ficha estamos olhando. */
  const [detalhando, setDetalhando] = useState<PagamentoFeito | null>(null);

  /*
   * Quantos filtros estão ligados além do padrão, para o botão contar. O
   * período só entra quando não é um dos atalhos: o atalho escolhido já
   * aparece aceso na tela.
   */
  const periodoProprio = !atalhosDoPeriodo().some(
    (a) => a.janela.de === periodo.de && a.janela.ate === periodo.ate,
  );
  const ligados =
    (periodoProprio ? 1 : 0) +
    (filtros.valorDe || filtros.valorAte ? 1 : 0) +
    (filtros.conta ? 1 : 0) +
    (filtros.forma ? 1 : 0) +
    (filtros.categoria ? 1 : 0);

  function limparTudo() {
    setRecorte('todos');
    setBusca('');
    setFiltros(SEM_FILTROS);
    if (periodoProprio) setPeriodo(ultimosDias(30));
  }

  /*
   * A busca procura no histórico todo, e não só no período: quem procura um
   * pagamento quase nunca sabe o mês dele. Ela espera quem digita parar, para
   * não virar uma consulta ao IXC por tecla.
   */
  const termo = useTermoAdiado(busca);
  // As duas pontas: apagando a busca, o período volta na hora, sem esperar.
  const noHistorico =
    semAcento(termo).length >= MINIMO_DA_BUSCA &&
    semAcento(busca.trim()).length >= MINIMO_DA_BUSCA;

  /*
   * O servidor guarda a última leitura do IXC e a devolve na hora. O botão
   * Atualizar é o único que pede a leitura de agora, e espera por ela.
   */
  const lerAgora = useRef(false);

  const consulta = useQuery({
    queryKey: ['pagamentos-feitos', periodo.de, periodo.ate],
    queryFn: async () => {
      const atualizar = lerAgora.current;
      lerAgora.current = false;
      return (
        await api.get<HistoricoPagamentos>('/pagamentos-feitos', {
          params: {
            de: periodo.de,
            ate: periodo.ate,
            ...(atualizar ? { atualizar: '1' } : {}),
          },
        })
      ).data;
    },
    // A mesma do painel: ir e voltar entre as telas não relê.
    staleTime: 5 * 60 * 1000,
    // Sem retentativa automática, como na lista de contas em aberto: quando o
    // IXC não responde ele costuma não responder por 30 segundos até estourar o
    // tempo, e tentar de novo por baixo dobraria a espera com a tela parada.
    retry: 0,
  });

  const consultaBusca = useQuery({
    queryKey: ['pagamentos-feitos', 'busca', termo],
    queryFn: async () =>
      (
        await api.get<HistoricoPagamentos>('/pagamentos-feitos', {
          params: { busca: termo },
        })
      ).data,
    enabled: noHistorico,
    staleTime: 5 * 60 * 1000,
    retry: 0,
    // Enquanto a busca nova não chega, a anterior fica — peneirada pelo que
    // já está digitado — em vez de a lista sumir a cada palavra.
    placeholderData: (anterior) => anterior,
  });

  const daBusca = noHistorico ? consultaBusca.data : undefined;
  /** De onde vêm a hora da leitura, os avisos e o "como foi lido". */
  const dados = daBusca ?? consulta.data;
  const procurando = noHistorico && (consultaBusca.isFetching || termo !== busca.trim());
  const atualizando = noHistorico ? consultaBusca.isFetching : consulta.isFetching;

  /*
   * O que a lista mostra antes dos filtros. Com a busca, é o que ela achou no
   * histórico, mais o que bate no período e ela não traz — o que se acha pela
   * categoria daqui ou pelo nome na folha, que o IXC não conhece. Antes de a
   * busca chegar, é o período: o que já está carregado aparece na hora.
   */
  const base = useMemo(() => {
    const doPeriodo = consulta.data?.pagamentos ?? [];
    if (!daBusca) return doPeriodo;
    const vistos = new Set(daBusca.pagamentos.map((p) => p.idFnApagar));
    const extras = doPeriodo.filter(
      (p) => !vistos.has(p.idFnApagar) && combina(camposDaBusca(p), semAcento(termo)),
    );
    return extras.length ? ordenarPorPagamento([...daBusca.pagamentos, ...extras]) : daBusca.pagamentos;
  }, [consulta.data, daBusca, termo]);

  const pagamentos = useMemo(
    () => filtrar(base, recorte, busca, filtros),
    [base, recorte, busca, filtros],
  );

  const opcoes = useMemo(
    () => ({
      contas: opcoesDe(base, contaDe),
      formas: opcoesDe(base, (p) => p.formaPagamento),
      categorias: opcoesDe(base, (p) => p.classificacao?.nome),
    }),
    [base],
  );

  /** Os números dos dois recortes, contados do que está carregado. */
  const resumo = useMemo(
    () => ({
      comRessalva: base.filter((p) => !p.conferencia.fecha && !p.conferencia.conferidoPor).length,
      parciais: base.filter((p) => p.parcial).length,
    }),
    [base],
  );
  const comFiltro = recorte !== 'todos' || !!busca || ligados > 0;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Histórico"
        titulo="Pagamentos feitos"
        acoes={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                baixarCsv(
                  pagamentos,
                  noHistorico
                    ? `pagamentos-busca-${semAcento(termo).replace(/[^a-z0-9]+/g, '-')}`
                    : `pagamentos-${periodo.de}-a-${periodo.ate}`,
                )
              }
              disabled={pagamentos.length === 0}
              className="btn btn-neutro"
              title="Baixa a lista à vista, com os filtros aplicados, para conferir na planilha"
            >
              Baixar CSV
            </button>
            <button
              onClick={() => {
                if (noHistorico) {
                  void consultaBusca.refetch();
                  return;
                }
                lerAgora.current = true;
                void consulta.refetch();
              }}
              disabled={atualizando}
              className="btn btn-acao"
            >
              {atualizando ? 'Lendo o IXC…' : 'Atualizar'}
            </button>
          </div>
        }
      />

      <SeletorDePeriodo periodo={periodo} onEscolher={setPeriodo} semDatas />

      {consulta.error && !daBusca && (
        <Aviso tom="erro">
          Não deu para ler os pagamentos do IXC: {mensagemErro(consulta.error)}
          {consulta.data
            ? ' Os números abaixo são da última leitura que deu certo.'
            : ''}
        </Aviso>
      )}

      {noHistorico && consultaBusca.error && (
        <Aviso tom="erro">
          Não deu para procurar no histórico do IXC: {mensagemErro(consultaBusca.error)}
        </Aviso>
      )}

      {(dados?.avisos ?? []).map((aviso) => (
        <Aviso key={aviso} tom="atencao">
          {aviso}
        </Aviso>
      ))}

      {/*
        Sem cartões de resumo em cima: quem abre esta tela vem atrás de um
        pagamento, não de um total. O que os cartões somavam continua à mão —
        o filtro de conferência e o de parciais ficaram como botões, e cada
        linha já diz na cara se foi em dia, em atraso ou se tem algo torto.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por fornecedor, documento, forma de pagamento ou observação"
          className="campo max-w-md"
          autoComplete="off"
        />
        {/*
          Os filtros de escolher ficam atrás de um botão: à mostra, eram uma
          faixa inteira de campos em cima da lista. O botão diz quantos estão
          ligados, e o "Limpar filtros" ao lado desliga tudo de uma vez.
        */}
        <button
          type="button"
          onClick={() => setFiltrando(true)}
          className={`btn btn-p inline-flex items-center gap-1.5 ${
            ligados > 0 ? 'btn-acao' : 'btn-neutro'
          }`}
          aria-label={ligados > 0 ? `Filtrar — ${ligados} ligado${ligados === 1 ? '' : 's'}` : 'Filtrar'}
        >
          <IconeFiltro className="h-3.5 w-3.5" />
          Filtrar
          {ligados > 0 && (
            <span className="num rounded-full bg-white/25 px-1.5 text-[11px] font-semibold leading-4">
              {ligados}
            </span>
          )}
        </button>
        {resumo.comRessalva > 0 && (
          <button
            onClick={() =>
              setRecorte(recorte === 'ressalva' ? 'todos' : 'ressalva')
            }
            className={`btn btn-p ${
              recorte === 'ressalva' ? 'btn-acao' : 'btn-sutil'
            }`}
            title="Pagamentos cujo registro no IXC não fecha: status parado, valor sem informação, baixa com auditoria reprovada. Os que alguém já conferiu saem desta conta."
          >
            Só os que pedem conferência ({resumo.comRessalva})
          </button>
        )}
        {resumo.parciais > 0 && (
          <button
            onClick={() =>
              setRecorte(recorte === 'parciais' ? 'todos' : 'parciais')
            }
            className={`btn btn-p ${
              recorte === 'parciais' ? 'btn-acao' : 'btn-sutil'
            }`}
          >
            Só os parciais ({resumo.parciais})
          </button>
        )}
        {comFiltro && (
          <button onClick={limparTudo} className="btn btn-neutro btn-p">
            Limpar filtros
          </button>
        )}
        {dados && (
          <span className="ml-auto text-right text-xs text-tinta-400">
            {procurando ? (
              <span className="mr-3 text-tinta-600">Procurando em todo o histórico…</span>
            ) : (
              comFiltro &&
              pagamentos.length > 0 && (
                <span className="num mr-3 text-tinta-600">
                  {pagamentos.length} pagamento{pagamentos.length === 1 ? '' : 's'} ·{' '}
                  {formatBRL(pagamentos.reduce((soma, p) => soma + p.valorPago, 0))}
                  {daBusca ? ' · em todo o histórico' : ''}
                </span>
              )
            )}
            Lido do IXC às {formatHora(dados.lidoEm)}
          </span>
        )}
      </div>

      <Bloco semPadding>
        {/*
          A ordem destes casos importa: só dá para dizer "nada foi pago" depois
          de a leitura ter chegado. Sem esse cuidado, todo instante em que o IXC
          falha ou demora viraria um "não saiu nada no período" — e quem confere
          pagamento acreditaria. Com a busca é igual: enquanto ela procura no
          histórico, "nenhum" ainda não é resposta.
        */}
        {!dados ? (
          consulta.error ? (
            <Vazio titulo="Não deu para ler o IXC">
              Os pagamentos ficam no IXC e ele não respondeu agora, então não há
              o que mostrar — o que não quer dizer que nada tenha sido pago.
              Tente de novo em Atualizar.
            </Vazio>
          ) : (
            <Carregando texto="Lendo os pagamentos no IXC…" />
          )
        ) : pagamentos.length === 0 && procurando ? (
          <Carregando texto="Procurando em todo o histórico…" />
        ) : pagamentos.length === 0 ? (
          <Vazio titulo="Nenhum pagamento aqui">
            {daBusca
              ? base.length
                ? 'Nenhum pagamento da busca bate com o filtro. Tente "Limpar filtros".'
                : `Nada com "${termo}" em todo o histórico do IXC.`
              : dados.pagamentos.length
                ? 'Nenhum pagamento bate com o filtro. Tente "Limpar filtros".'
                : 'O IXC não registra baixa nenhuma neste período. Se você esperava ver um pagamento aqui, amplie as datas — a data que conta é a da baixa, não a do vencimento.'}
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Pago em</th>
                  <th className="th">Fornecedor</th>
                  <th className="th">Documento</th>
                  <th className="th">Saiu de</th>
                  <th className="th text-right">Valor pago</th>
                </tr>
              </thead>
              <tbody>
                {pagamentos.map((p) => (
                  <Linha
                    key={p.idFnApagar}
                    pagamento={p}
                    onVerFicha={() => setDetalhando(p)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {dados && <p className="ajuda mt-3">{dados.comoFoiLido}</p>}

      {filtrando && (
        <JanelaDeFiltros
          periodo={periodo}
          filtros={filtros}
          opcoes={opcoes}
          comBusca={noHistorico}
          onAplicar={(novoPeriodo, novosFiltros) => {
            setPeriodo(novoPeriodo);
            setFiltros(novosFiltros);
            setFiltrando(false);
          }}
          onFechar={() => setFiltrando(false)}
        />
      )}

      {detalhando && (
        <DetalheDoPagamento
          pagamento={detalhando}
          onFechar={() => setDetalhando(null)}
        />
      )}
    </Pagina>
  );
}

/**
 * A janela do Filtrar: o período e os filtros de escolher, um campo por linha.
 *
 * Mexe num rascunho, e a lista só muda no "Filtrar" — trocar o período relê o
 * IXC, e não vale reler a cada dia digitado no meio do caminho. "Limpar" volta
 * tudo ao padrão (últimos 30 dias, sem filtro) e já aplica.
 */
function JanelaDeFiltros({
  periodo,
  filtros,
  opcoes,
  comBusca,
  onAplicar,
  onFechar,
}: {
  periodo: Janela;
  filtros: Filtros;
  opcoes: { contas: string[]; formas: string[]; categorias: string[] };
  /** A busca está procurando no histórico todo: as datas não valem para ela. */
  comBusca: boolean;
  onAplicar: (periodo: Janela, filtros: Filtros) => void;
  onFechar: () => void;
}) {
  const [de, setDe] = useState(periodo.de);
  const [ate, setAte] = useState(periodo.ate);
  const [rascunho, setRascunho] = useState(filtros);
  const mudar = (parte: Partial<Filtros>) => setRascunho((f) => ({ ...f, ...parte }));

  return (
    <JanelaDoSistema titulo="Filtrar pagamentos" onFechar={onFechar}>
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="rotulo" htmlFor="filtro-de">
            Pago de
          </label>
          <CampoDeData
            id="filtro-de"
            valor={de}
            max={ate}
            onChange={(valor) => valor && setDe(valor)}
            className="campo num"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="filtro-ate">
            Pago até
          </label>
          <CampoDeData
            id="filtro-ate"
            valor={ate}
            min={de}
            onChange={(valor) => valor && setAte(valor)}
            className="campo num"
          />
          {comBusca && <p className="ajuda">Com a busca preenchida, vale todo o histórico.</p>}
        </div>
        <div>
          <label className="rotulo" htmlFor="filtro-valor-de">
            Valor pago de
          </label>
          <CampoDinheiro
            id="filtro-valor-de"
            valor={rascunho.valorDe}
            onChange={(v) => mudar({ valorDe: v })}
            className="campo num"
            placeholder="0,00"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="filtro-valor-ate">
            Valor pago até
          </label>
          <CampoDinheiro
            id="filtro-valor-ate"
            valor={rascunho.valorAte}
            onChange={(v) => mudar({ valorAte: v })}
            className="campo num"
            placeholder="0,00"
          />
        </div>
        <Escolha
          id="filtro-conta"
          rotulo="Saiu de"
          todas="Todas as contas"
          valor={rascunho.conta}
          opcoes={opcoes.contas}
          onChange={(conta) => mudar({ conta })}
        />
        <Escolha
          id="filtro-forma"
          rotulo="Forma"
          todas="Todas as formas"
          valor={rascunho.forma}
          opcoes={opcoes.formas}
          onChange={(forma) => mudar({ forma })}
        />
        <Escolha
          id="filtro-categoria"
          rotulo="Categoria"
          todas="Todas as categorias"
          valor={rascunho.categoria}
          opcoes={opcoes.categorias}
          onChange={(categoria) => mudar({ categoria })}
        />
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onAplicar(ultimosDias(30), SEM_FILTROS)}
          className="btn btn-neutro"
        >
          Limpar
        </button>
        <button
          type="button"
          onClick={() => onAplicar(de <= ate ? { de, ate } : { de: ate, ate: de }, rascunho)}
          className="btn btn-acao"
        >
          Filtrar
        </button>
      </div>
    </JanelaDoSistema>
  );
}

/**
 * Uma lista de escolher da janela de filtros, com busca: a de categorias cresce
 * com o histórico. Some quando não há o que escolher.
 */
function Escolha({
  id,
  rotulo,
  todas,
  valor,
  opcoes,
  onChange,
}: {
  id: string;
  rotulo: string;
  todas: string;
  valor: string;
  opcoes: string[];
  onChange: (valor: string) => void;
}) {
  if (opcoes.length < 2 && !valor) return null;
  return (
    <div>
      <label className="rotulo" htmlFor={id}>
        {rotulo}
      </label>
      <SeletorComBusca
        id={id}
        opcoes={opcoes.map((o) => ({ valor: o, rotulo: o }))}
        value={valor}
        onChange={onChange}
        vazio={todas}
        className="min-w-0"
      />
    </div>
  );
}

/** Os atalhos do período: as perguntas de sempre, a um toque. */
function atalhosDoPeriodo(): Array<{ rotulo: string; janela: Janela }> {
  return [
    { rotulo: 'Últimos 30 dias', janela: ultimosDias(30) },
    { rotulo: 'Este mês', janela: mesCorrente(0) },
    { rotulo: 'Mês passado', janela: mesCorrente(-1) },
    { rotulo: 'Este ano', janela: anoCorrente() },
  ];
}

/**
 * O período, com os atalhos que respondem às perguntas de sempre: "saiu o de
 * ontem?", "quanto pagamos este mês?", "fecha o mês passado?". As datas soltas
 * ficam ao lado para quem procura um pagamento específico — ou, com
 * `semDatas`, dentro do Filtrar de quem chama.
 */
export function SeletorDePeriodo({
  periodo,
  onEscolher,
  semDatas = false,
}: {
  periodo: Janela;
  onEscolher: (janela: Janela) => void;
  semDatas?: boolean;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-2">
        {atalhosDoPeriodo().map(({ rotulo, janela }) => {
          const ativo = janela.de === periodo.de && janela.ate === periodo.ate;
          return (
            <button
              key={rotulo}
              onClick={() => onEscolher(janela)}
              className={`btn btn-p ${ativo ? 'btn-acao' : 'btn-sutil'}`}
            >
              {rotulo}
            </button>
          );
        })}
      </div>

      {!semDatas && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-2 text-xs text-tinta-500">
            De
            <CampoDeData
              valor={periodo.de}
              max={periodo.ate}
              onChange={(valorNovo) => valorNovo && onEscolher({ ...periodo, de: valorNovo })}
              className="campo num w-[10.5rem]"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-tinta-500">
            até
            <CampoDeData
              valor={periodo.ate}
              min={periodo.de}
              onChange={(valorNovo) => valorNovo && onEscolher({ ...periodo, ate: valorNovo })}
              className="campo num w-[10.5rem]"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Linha({
  pagamento,
  onVerFicha,
}: {
  pagamento: PagamentoFeito;
  onVerFicha: () => void;
}) {
  // Verde é o pagamento que fecha; âmbar, o que tem ressalva. A cor aparece na
  // barra da esquerda — que se enxerga correndo o olho pela lista — e o selo diz
  // em palavras o que ela significa, porque cor sozinha não serve a quem não a
  // distingue.
  const barra =
    pagamento.conferencia.fecha || pagamento.conferencia.conferidoPor
      ? 'border-emerald-500'
      : 'border-amber-400';

  return (
    <tr
      onClick={onVerFicha}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onVerFicha();
        }
      }}
      title="Abrir a ficha deste pagamento"
      className="linha cursor-pointer focus:bg-brand-500/10 focus:outline-none"
    >
      <td className={`td whitespace-nowrap border-l-4 ${barra}`}>
        <div className="num text-tinta-700">{formatData(pagamento.pagoEm)}</div>
        <PrazoDoPagamento pagamento={pagamento} pequeno />
      </td>
      <td className="td">
        <div className="text-tinta-800">
          {pagamento.fornecedor.nome ||
            `Fornecedor ${pagamento.fornecedor.id ?? '?'}`}
        </div>
        {(pagamento.observacao || pagamento.parcela) && (
          <div className="mt-0.5 max-w-lg truncate text-xs text-tinta-400">
            {pagamento.observacao}
            {/* Qual das parcelas era esta — escrito no próprio título, e não
                deduzido. Num financiamento pago há anos, é o que diferencia
                doze linhas iguais do mesmo banco. */}
            {pagamento.parcela && (
              <span className="num ml-1.5 text-tinta-500">
                parcela {pagamento.parcela.posicao}/{pagamento.parcela.total}
              </span>
            )}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {!pagamento.conferencia.fecha &&
            (pagamento.conferencia.conferidoPor ? (
              /* Já olhado: o selo conta quem olhou, e o aviso para de chamar.
                 O que estava torto no IXC continua torto — o que mudou é que
                 esta casa já sabe disso. */
              <Selo
                pequeno
                tom="pago"
                titulo={`Conferido por ${pagamento.conferencia.conferidoPor}. Ressalva: ${pagamento.conferencia.ressalvas.join(' · ')}`}
              >
                conferido
              </Selo>
            ) : (
              <Selo
                pequeno
                tom="atencao"
                titulo={pagamento.conferencia.ressalvas.join(' · ')}
              >
                {pagamento.parcial ? 'parcial' : 'confira'}
              </Selo>
            ))}
          <SeloDaCategoria titulo={pagamento} />
          {pagamento.origem && (
            <Selo
              pequeno
              tom="marca"
              titulo="Este pagamento nasceu na Folha de Pagamento — é a mesma saída, não uma a mais"
            >
              Folha · {TIPO_LABEL[pagamento.origem.tipo] ?? pagamento.origem.tipo}
              {pagamento.origem.beneficiario
                ? ` · ${pagamento.origem.beneficiario}`
                : ''}
            </Selo>
          )}
        </div>
      </td>
      <td className="td num text-tinta-500">{pagamento.documento ?? '—'}</td>
      <td className="td text-tinta-500">
        {pagamento.caixa.nome ??
          (pagamento.caixa.id ? `caixa ${pagamento.caixa.id}` : '—')}
        {pagamento.formaPagamento && (
          <div className="text-xs text-tinta-400">
            {pagamento.formaPagamento}
          </div>
        )}
      </td>
      <td className="td text-right">
        <span className="valor">{formatBRL(pagamento.valorPago)}</span>
        {/* Título e pagamento diferentes contam metade da história cada um:
            juros e multa fizeram sair mais, desconto ou parcial fizeram sair
            menos. */}
        {Math.abs(pagamento.valor - pagamento.valorPago) > 0.005 && (
          <div className="num text-xs text-tinta-400">
            título de {formatBRL(pagamento.valor)}
          </div>
        )}
        {/* O comprovante do banco, quando saiu pelo ModoBank daqui; nos outros,
            o recibo que esta casa emite do registro do IXC. */}
        {pagamento.comprovanteDoBanco ? (
          <CompartilharPdf
            pagamento={pagamento}
            caminho={`/contas-abertas/${pagamento.idFnApagar}/banco/comprovante`}
            rotulo="Comprovante"
            titulo="Mandar o comprovante do banco (WhatsApp, e-mail)"
          />
        ) : (
          <CompartilharPdf
            pagamento={pagamento}
            caminho={`/pagamentos-feitos/${pagamento.idFnApagar}/recibo`}
            rotulo="Recibo"
            titulo="Mandar o recibo deste pagamento (WhatsApp, e-mail)"
          />
        )}
      </td>
    </tr>
  );
}

/** O aparelho manda PDF pelo Compartilhar? No celular quase sempre; no computador, depende. */
function compartilhaPdf(): boolean {
  if (typeof navigator.canShare !== 'function') return false;
  const teste = new File([''], 'comprovante.pdf', { type: 'application/pdf' });
  return navigator.canShare({ files: [teste] });
}

/**
 * O comprovante do ModoBank, ou o recibo, mandado direto da linha — sem abrir
 * a ficha.
 *
 * Onde o aparelho compartilha PDF, abre o Compartilhar (WhatsApp, e-mail). O
 * iPhone só aceita o Compartilhar colado no toque, e o arquivo chega depois:
 * recusado, o botão vira "Compartilhar" com o arquivo já baixado, e o segundo
 * toque vai na hora — o mesmo das notas do título. Onde não compartilha, o PDF
 * abre numa aba.
 */
function CompartilharPdf({
  pagamento,
  caminho,
  rotulo,
  titulo,
}: {
  pagamento: PagamentoFeito;
  caminho: string;
  rotulo: string;
  titulo: string;
}) {
  const [pronto, setPronto] = useState<File | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // "Comprovante Construcenter 23-10-2026.pdf": a barra da data não cabe em nome de arquivo.
  const nome =
    `${rotulo} ${pagamento.fornecedor.nome || pagamento.idFnApagar} ${formatData(pagamento.pagoEm)}`
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim() + '.pdf';

  function compartilhar(arquivo: File) {
    navigator.share({ files: [arquivo], title: arquivo.name }).catch((e: unknown) => {
      // Fechar a janela sem escolher ninguém não é erro.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // O toque já passou: o arquivo fica pronto para o próximo.
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        setPronto(arquivo);
        return;
      }
      setErro('O aparelho não deixou compartilhar. Abra a ficha e salve o PDF.');
    });
  }

  async function aoTocar(e: React.MouseEvent) {
    // A linha inteira abre a ficha: o botão não.
    e.stopPropagation();
    setErro(null);
    if (pronto) {
      compartilhar(pronto);
      return;
    }
    if (!compartilhaPdf()) {
      abrirArquivo(caminho, nome).catch((err: unknown) => setErro(mensagemErro(err)));
      return;
    }
    setBaixando(true);
    try {
      const res = await api.get(caminho, { responseType: 'blob' });
      compartilhar(new File([res.data as BlobPart], nome, { type: 'application/pdf' }));
    } catch (err) {
      setErro(await motivoDoErroEmArquivo(err));
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="mt-1 flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={(e) => void aoTocar(e)}
        onKeyDown={(e) => e.stopPropagation()}
        disabled={baixando}
        title={titulo}
        className={`btn btn-p inline-flex items-center gap-1.5 ${
          pronto ? 'btn-pagar' : 'btn-neutro'
        }`}
      >
        <IconeCompartilhar className="h-3.5 w-3.5" />
        {baixando ? 'Baixando…' : pronto ? 'Compartilhar' : rotulo}
      </button>
      {erro && <span className="max-w-[220px] text-xs text-rose-600">{erro}</span>}
    </div>
  );
}

function filtrar(
  pagamentos: PagamentoFeito[],
  recorte: Recorte,
  busca: string,
  filtros: Filtros,
): PagamentoFeito[] {
  // Sem acento dos dois lados: quem procura o posto escreve "sao domin", e o
  // que está guardado é "Posto São Domingos". Comparando cru, a tela dizia
  // "nenhum pagamento aqui" para uma lista cheia deles.
  const termo = semAcento(busca.trim());

  return pagamentos.filter((p) => {
    const passaRecorte =
      recorte === 'todos' ||
      (recorte === 'ressalva' && !p.conferencia.fecha && !p.conferencia.conferidoPor) ||
      (recorte === 'parciais' && p.parcial);
    if (!passaRecorte) return false;

    // Meio centavo de folga: os valores chegam do IXC em ponto flutuante.
    if (filtros.valorDe && p.valorPago < Number(filtros.valorDe) - 0.005) return false;
    if (filtros.valorAte && p.valorPago > Number(filtros.valorAte) + 0.005) return false;
    if (filtros.conta && contaDe(p) !== filtros.conta) return false;
    if (filtros.forma && p.formaPagamento !== filtros.forma) return false;
    if (filtros.categoria && p.classificacao?.nome !== filtros.categoria) return false;

    return combina(camposDaBusca(p), termo);
  });
}

/**
 * Baixa a lista à vista em CSV — com os filtros aplicados, que é o que se está
 * olhando.
 *
 * Ponto e vírgula como separador e vírgula decimal de propósito: é assim que o
 * Excel em português abre o arquivo com as colunas já separadas. Com vírgula,
 * cada valor em reais quebraria a linha em duas colunas.
 */
function baixarCsv(pagamentos: PagamentoFeito[], nome: string): void {
  const colunas = [
    'Pago em',
    'Lancado no IXC em',
    'Vencimento',
    'Dias de atraso',
    'Fornecedor',
    'Documento',
    'Valor do titulo',
    'Valor pago',
    'Juros',
    'Multa',
    'Desconto',
    'Ainda em aberto',
    'Forma de pagamento',
    'Caixa',
    'Categoria',
    'Classificacao',
    // A categoria de cima vai em coluna separada de propósito: é por ela que
    // uma tabela dinâmica soma "quanto custou a frota" sem ter de reconhecer,
    // no texto, quais linhas falam de veículo.
    'Categoria-mae',
    'Titulo no IXC',
    'Status no IXC',
    'Conferencia',
    'Observacao',
  ];

  const linhas = pagamentos.map((p) => [
    formatData(p.pagoEm),
    formatData(p.registradoEm),
    p.vencimento ? formatData(p.vencimento) : '',
    p.diasDeAtraso === null ? '' : String(p.diasDeAtraso),
    p.fornecedor.nome,
    p.documento ?? '',
    numero(p.valor),
    numero(p.valorPago),
    numero(p.juros),
    numero(p.multa),
    numero(p.desconto),
    numero(p.valorAberto),
    p.formaPagamento ?? '',
    p.caixa.nome ?? (p.caixa.id ? `caixa ${p.caixa.id}` : ''),
    p.categoria.nome ?? '',
    p.classificacao?.nome ?? '',
    p.classificacao?.grupo?.nome ?? '',
    String(p.idFnApagar),
    p.statusNoIxc ?? '',
    p.conferencia.fecha ? 'fecha' : p.conferencia.ressalvas.join(' | '),
    p.observacao ?? '',
  ]);

  const csv = [colunas, ...linhas]
    .map((linha) => linha.map(escapar).join(';'))
    .join('\r\n');

  const blob = new Blob([BOM_UTF8 + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${nome}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapar(valor: string): string {
  const limpo = valor.replace(/"/g, '""');
  return /[";\r\n]/.test(limpo) ? `"${limpo}"` : limpo;
}

/** Número com vírgula decimal, como a planilha em português espera. */
function numero(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

/** Um período em datas ISO, do jeito que o input date e a API usam. */
export interface Janela {
  de: string;
  ate: string;
}

export function ultimosDias(dias: number): Janela {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - (dias - 1));
  return { de: iso(inicio), ate: iso(hoje) };
}

/** O mês corrente, ou um mês para trás com `deslocamento = -1`. */
export function mesCorrente(deslocamento: number): Janela {
  const hoje = new Date();
  const primeiro = new Date(
    hoje.getFullYear(),
    hoje.getMonth() + deslocamento,
    1,
  );
  const ultimo = new Date(
    hoje.getFullYear(),
    hoje.getMonth() + deslocamento + 1,
    0,
  );
  // No mês corrente não faz sentido pedir até o dia 31 que ainda não chegou.
  return {
    de: iso(primeiro),
    ate: iso(ultimo.getTime() > hoje.getTime() ? hoje : ultimo),
  };
}

function anoCorrente(): Janela {
  const hoje = new Date();
  return { de: iso(new Date(hoje.getFullYear(), 0, 1)), ate: iso(hoje) };
}

/** A data no formato do input date e da API — no fuso de quem está olhando. */
function iso(data: Date): string {
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${m}-${d}`;
}

function formatHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(
    new Date(iso),
  );
}
