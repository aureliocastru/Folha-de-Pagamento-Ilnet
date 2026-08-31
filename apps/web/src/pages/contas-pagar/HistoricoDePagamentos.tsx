import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { combina, semAcento } from '../../lib/busca';
import { formatBRL, formatData } from '../../lib/format';
import { TIPO_LABEL } from '../../lib/status';
import type { HistoricoPagamentos, PagamentoFeito } from '../../lib/types';
import { DetalheDoPagamento, PrazoDoPagamento } from './DetalheDoPagamento';

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

export function HistoricoDePagamentos() {
  const [periodo, setPeriodo] = useState(ultimosDias(30));
  const [recorte, setRecorte] = useState<Recorte>('todos');
  const [busca, setBusca] = useState('');
  /** Pagamento cuja ficha estamos olhando. */
  const [detalhando, setDetalhando] = useState<PagamentoFeito | null>(null);

  const consulta = useQuery({
    queryKey: ['pagamentos-feitos', periodo.de, periodo.ate],
    queryFn: async () =>
      (
        await api.get<HistoricoPagamentos>('/pagamentos-feitos', {
          params: { de: periodo.de, ate: periodo.ate },
        })
      ).data,
    // Sem retentativa automática, como na lista de contas em aberto: quando o
    // IXC não responde ele costuma não responder por 30 segundos até estourar o
    // tempo, e tentar de novo por baixo dobraria a espera com a tela parada.
    retry: 0,
  });

  const pagamentos = useMemo(
    () => filtrar(consulta.data?.pagamentos ?? [], recorte, busca),
    [consulta.data, recorte, busca],
  );

  const resumo = consulta.data?.resumo;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Histórico"
        titulo="Pagamentos feitos"
        descricao="Tudo que já saiu, lido do IXC na hora. Esta tela é de leitura: dar baixa, estornar e cancelar continua sendo no IXC."
        acoes={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => baixarCsv(pagamentos, periodo)}
              disabled={pagamentos.length === 0}
              className="btn btn-neutro"
              title="Baixa a lista à vista, com os filtros aplicados, para conferir na planilha"
            >
              Baixar CSV
            </button>
            <button
              onClick={() => consulta.refetch()}
              disabled={consulta.isFetching}
              className="btn btn-acao"
            >
              {consulta.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
            </button>
          </div>
        }
      />

      <SeletorDePeriodo periodo={periodo} onEscolher={setPeriodo} />

      {consulta.error && (
        <Aviso tom="erro">
          Não deu para ler os pagamentos do IXC: {mensagemErro(consulta.error)}
          {consulta.data
            ? ' Os números abaixo são da última leitura que deu certo.'
            : ''}
        </Aviso>
      )}

      {(consulta.data?.avisos ?? []).map((aviso) => (
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
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por fornecedor, documento, forma de pagamento ou observação"
          className="campo max-w-md"
        />
        {resumo && resumo.comRessalva.quantidade > 0 && (
          <button
            onClick={() =>
              setRecorte(recorte === 'ressalva' ? 'todos' : 'ressalva')
            }
            className={`btn btn-p ${
              recorte === 'ressalva' ? 'btn-acao' : 'btn-sutil'
            }`}
            title="Pagamentos cujo registro no IXC não fecha: status parado, valor sem informação, baixa com auditoria reprovada"
          >
            Só os que pedem conferência ({resumo.comRessalva.quantidade})
          </button>
        )}
        {resumo && resumo.parciais.quantidade > 0 && (
          <button
            onClick={() =>
              setRecorte(recorte === 'parciais' ? 'todos' : 'parciais')
            }
            className={`btn btn-p ${
              recorte === 'parciais' ? 'btn-acao' : 'btn-sutil'
            }`}
          >
            Só os parciais ({resumo.parciais.quantidade})
          </button>
        )}
        {(recorte !== 'todos' || busca) && (
          <button
            onClick={() => {
              setRecorte('todos');
              setBusca('');
            }}
            className="btn btn-sutil btn-p"
          >
            Limpar filtros
          </button>
        )}
        {consulta.data && (
          <span className="ml-auto text-xs text-tinta-400">
            Lido do IXC às {formatHora(consulta.data.lidoEm)}
          </span>
        )}
      </div>

      <Bloco semPadding>
        {/*
          A ordem destes casos importa: só dá para dizer "nada foi pago" depois
          de a leitura ter chegado. Sem esse cuidado, todo instante em que o IXC
          falha ou demora viraria um "não saiu nada no período" — e quem confere
          pagamento acreditaria.
        */}
        {!consulta.data ? (
          consulta.error ? (
            <Vazio titulo="Não deu para ler o IXC">
              Os pagamentos ficam no IXC e ele não respondeu agora, então não há
              o que mostrar — o que não quer dizer que nada tenha sido pago.
              Tente de novo em Atualizar.
            </Vazio>
          ) : (
            <Carregando texto="Lendo os pagamentos no IXC…" />
          )
        ) : pagamentos.length === 0 ? (
          <Vazio titulo="Nenhum pagamento aqui">
            {consulta.data.pagamentos.length
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

      {consulta.data && (
        <p className="ajuda mt-3">{consulta.data.comoFoiLido}</p>
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
 * O período, com os atalhos que respondem às perguntas de sempre: "saiu o de
 * ontem?", "quanto pagamos este mês?", "fecha o mês passado?". As datas soltas
 * ficam ao lado para quem procura um pagamento específico.
 */
export function SeletorDePeriodo({
  periodo,
  onEscolher,
}: {
  periodo: Janela;
  onEscolher: (janela: Janela) => void;
}) {
  const atalhos: Array<{ rotulo: string; janela: Janela }> = [
    { rotulo: 'Últimos 30 dias', janela: ultimosDias(30) },
    { rotulo: 'Este mês', janela: mesCorrente(0) },
    { rotulo: 'Mês passado', janela: mesCorrente(-1) },
    { rotulo: 'Este ano', janela: anoCorrente() },
  ];

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-2">
        {atalhos.map(({ rotulo, janela }) => {
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

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-tinta-500">
          De
          <input
            type="date"
            value={periodo.de}
            max={periodo.ate}
            onChange={(e) =>
              e.target.value && onEscolher({ ...periodo, de: e.target.value })
            }
            className="campo num ml-2 w-[10.5rem]"
          />
        </label>
        <label className="text-xs text-tinta-500">
          até
          <input
            type="date"
            value={periodo.ate}
            min={periodo.de}
            onChange={(e) =>
              e.target.value && onEscolher({ ...periodo, ate: e.target.value })
            }
            className="campo num ml-2 w-[10.5rem]"
          />
        </label>
      </div>
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
  const barra = pagamento.conferencia.fecha
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
      className="linha cursor-pointer focus:bg-brand-50 focus:outline-none"
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
          {!pagamento.conferencia.fecha && (
            <Selo
              pequeno
              tom="atencao"
              titulo={pagamento.conferencia.ressalvas.join(' · ')}
            >
              {pagamento.parcial ? 'parcial' : 'confira'}
            </Selo>
          )}
          {pagamento.classificacao && (
            <Selo
              pequeno
              tom="info"
              titulo={
                pagamento.classificacao.grupo
                  ? `${pagamento.classificacao.grupo.nome} · ${pagamento.classificacao.nome}`
                  : undefined
              }
            >
              {pagamento.classificacao.nome}
            </Selo>
          )}
          {pagamento.origem && (
            <Selo
              pequeno
              tom="marca"
              titulo="Este pagamento nasceu no módulo Folha de Pagamento — é a mesma saída, não uma a mais"
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
      </td>
    </tr>
  );
}

function filtrar(
  pagamentos: PagamentoFeito[],
  recorte: Recorte,
  busca: string,
): PagamentoFeito[] {
  // Sem acento dos dois lados: quem procura o posto escreve "sao domin", e o
  // que está guardado é "Posto São Domingos". Comparando cru, a tela dizia
  // "nenhum pagamento aqui" para uma lista cheia deles.
  const termo = semAcento(busca.trim());

  return pagamentos.filter((p) => {
    const passaRecorte =
      recorte === 'todos' ||
      (recorte === 'ressalva' && !p.conferencia.fecha) ||
      (recorte === 'parciais' && p.parcial);
    if (!passaRecorte) return false;

    return combina(
      [
        p.fornecedor.nome,
        p.documento,
        p.observacao,
        p.formaPagamento,
        p.caixa.nome,
        p.classificacao?.nome,
        p.origem?.beneficiario,
      ],
      termo,
    );
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
function baixarCsv(pagamentos: PagamentoFeito[], periodo: Janela): void {
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
  link.download = `pagamentos-${periodo.de}-a-${periodo.ate}.csv`;
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
