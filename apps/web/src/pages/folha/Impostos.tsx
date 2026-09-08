import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import {
  CLASSE_CURTA,
  CLASSE_LABEL,
  GUIAS_DO_MES,
  GUIAS_EVENTUAIS,
  TIPO_GUIA_LABEL,
  type ClasseTributo,
  type ContaDaGuia,
  type Guia,
  type ItemGuia,
  type LeituraDaGuia,
  type TipoGuia,
} from '../../lib/types';

const CLASSES: ClasseTributo[] = [
  'FOLHA_PATRONAL',
  'FOLHA_RETIDO',
  'FATURAMENTO',
];

const TOM_DA_CLASSE: Record<ClasseTributo, 'marca' | 'atencao' | 'neutro'> = {
  FOLHA_PATRONAL: 'marca',
  FOLHA_RETIDO: 'atencao',
  FATURAMENTO: 'neutro',
};

/** Ordem de leitura do conjunto do mês: os três fixos, depois os eventuais. */
const ORDEM_GUIA: TipoGuia[] = [...GUIAS_DO_MES, ...GUIAS_EVENTUAIS];

function formatComp(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${m[2]}/${m[1]}` : comp;
}

/** "A", "A e B", "A, B e C" — do jeito que se lê em voz alta. */
function emLista(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** As guias de um mês, e o que ainda não chegou. */
interface ConjuntoDoMes {
  competencia: string;
  guias: Guia[];
  total: number;
  faltando: TipoGuia[];
}

/**
 * As guias não são uma lista: são conjuntos mensais. Todo mês chegam as três
 * fixas — DARF do INSS, FGTS e DAS — mais o DARE do ICMS quando houve ICMS a
 * pagar. Agrupar por apuração é o que deixa ver, de relance, que o mês passado
 * está inteiro e que falta o FGTS deste.
 */
function agruparPorMes(guias: Guia[]): ConjuntoDoMes[] {
  const porMes = new Map<string, Guia[]>();
  for (const g of guias) {
    const doMes = porMes.get(g.competencia);
    if (doMes) doMes.push(g);
    else porMes.set(g.competencia, [g]);
  }

  return [...porMes.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([competencia, doMes]) => ({
      competencia,
      guias: [...doMes].sort(
        (a, b) => ORDEM_GUIA.indexOf(a.tipo) - ORDEM_GUIA.indexOf(b.tipo),
      ),
      total: doMes.reduce((s, g) => s + Number(g.valorTotal), 0),
      faltando: GUIAS_DO_MES.filter((t) => !doMes.some((g) => g.tipo === t)),
    }));
}

/**
 * As guias que a contabilidade manda todo mês. O PDF é lido aqui, mas nada é
 * gravado antes de alguém conferir na tela: leitor de PDF erra, e o número
 * daqui vai virar o gráfico de custo com pessoal.
 */
export function Impostos() {
  const qc = useQueryClient();
  const [leitura, setLeitura] = useState<LeituraDaGuia | null>(null);
  const [itens, setItens] = useState<ItemGuia[]>([]);
  const [feedback, setFeedback] = useState('');
  const [erro, setErro] = useState(false);
  /** Digitando a guia em vez de subir o PDF (o digitalizado não tem texto). */
  const [aMao, setAMao] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const guias = useQuery({
    queryKey: ['guias'],
    queryFn: async () => (await api.get<Guia[]>('/impostos/guias')).data,
  });

  function avisar(texto: string, ruim = false) {
    setFeedback(texto);
    setErro(ruim);
  }

  const ler = useMutation({
    mutationFn: async (arquivo: File) => {
      const form = new FormData();
      form.append('arquivo', arquivo);
      const { data } = await api.post<LeituraDaGuia>('/impostos/guias/ler', form);
      return data;
    },
    onSuccess: (data) => {
      setLeitura(data);
      setItens(data.guia.itens);
      avisar('');
    },
    onError: (err) => {
      setLeitura(null);
      avisar(mensagemErro(err), true);
    },
  });

  const gravar = useMutation({
    mutationFn: async () => {
      if (!leitura) throw new Error('Nada para gravar');
      const { data } = await api.post<Guia>('/impostos/guias', {
        ...leitura.guia,
        itens: itens.map(({ codigo, denominacao, valor, classe }) => ({
          codigo: codigo ?? undefined,
          denominacao,
          valor,
          classe,
        })),
        arquivoNome: leitura.arquivoNome,
        textoOriginal: leitura.textoOriginal,
      });
      return data;
    },
    onSuccess: (guia) => {
      avisar(avisoDoLancamento(guia), !!guia.avisoConta);
      cancelar();
      qc.invalidateQueries({ queryKey: ['guias'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      // A guia entrou na fila de pagamento: a lista de contas em aberto e o
      // painel mudaram de valor neste instante.
      qc.invalidateQueries({ queryKey: ['contas-abertas'] });
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  /** Qual guia está esperando a conta a pagar sair — para o botão daquela linha. */
  const [gerandoId, setGerandoId] = useState<string | null>(null);

  /**
   * Gera a conta a pagar de uma guia que ainda não tem.
   *
   * Existe para as guias lançadas antes desta tela e para o mês em que o IXC
   * não respondeu na hora: o lançamento novo já sai com a conta.
   */
  const gerarConta = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<ContaDaGuia>(`/impostos/guias/${id}/conta-a-pagar`, {}))
        .data,
    onSuccess: (conta) => {
      avisar(
        conta.jaExistia
          ? `Esta guia já estava na fila: título ${conta.idFnApagarIxc ?? '—'} no IXC.`
          : `Conta a pagar de ${formatBRL(conta.valor)} lançada para ` +
              `${conta.fornecedor.nome}, vencendo em ${formatData(conta.vencimento)}` +
              (conta.aviso ? `. ${conta.aviso}` : '.'),
        !!conta.aviso,
      );
      setGerandoId(null);
      qc.invalidateQueries({ queryKey: ['guias'] });
      qc.invalidateQueries({ queryKey: ['contas-abertas'] });
    },
    onError: (err) => {
      setGerandoId(null);
      avisar(mensagemErro(err), true);
    },
  });

  /**
   * O mesmo POST do fluxo do PDF — só que a leitura veio dos olhos de quem
   * está com o papel na mão. Vale para a guia digitalizada, que não tem texto.
   */
  const gravarAMao = useMutation({
    mutationFn: async (guia: Record<string, unknown>) =>
      (await api.post<Guia>('/impostos/guias', guia)).data,
    onSuccess: (guia) => {
      avisar(avisoDoLancamento(guia, 'à mão'), !!guia.avisoConta);
      setAMao(false);
      qc.invalidateQueries({ queryKey: ['guias'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => api.delete(`/impostos/guias/${id}`),
    onSuccess: () => {
      avisar('Guia apagada.');
      qc.invalidateQueries({ queryKey: ['guias'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  function cancelar() {
    setLeitura(null);
    setItens([]);
    if (inputArquivo.current) inputArquivo.current.value = '';
  }

  const soma = itens.reduce((s, i) => s + i.valor, 0);
  const bate = leitura ? Math.abs(soma - leitura.guia.valorTotal) < 0.01 : false;
  const incertos = itens.filter((i) => i.classeIncerta).length;

  const meses = agruparPorMes(guias.data ?? []);
  // O mês do arquivo aberto, do jeito que ele vai ficar depois de gravado.
  const conjuntoDaLeitura = leitura
    ? (meses.find((m) => m.competencia === leitura.guia.competencia) ?? {
        competencia: leitura.guia.competencia,
        guias: [],
        total: 0,
        faltando: GUIAS_DO_MES,
      })
    : null;
  const faltaDepoisDesta =
    conjuntoDaLeitura?.faltando.filter((t) => t !== leitura?.guia.tipo) ?? [];

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Impostos"
        titulo="Guias da contabilidade"
        descricao="Todo mês chega um conjunto de 3 a 4 arquivos: DARF do INSS, FGTS, DAS do Simples e, quando houve ICMS a pagar, o DARE. Jogue o PDF aqui — o app lê, diz de que mês ele é, você confere, e só então o valor entra no custo com pessoal."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <Bloco
        titulo="Lançar uma guia"
        className="surgir"
        acao={
          <button
            onClick={() => {
              setAMao((v) => !v);
              cancelar();
            }}
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            {aMao ? 'Voltar a subir o PDF' : 'Digitar à mão'}
          </button>
        }
      >
        {aMao ? (
          <LancamentoAMao
            ocupado={gravarAMao.isPending}
            onGravar={(guia) => gravarAMao.mutate(guia)}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={inputArquivo}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  if (arquivo) ler.mutate(arquivo);
                }}
                className="block w-full max-w-md text-sm text-tinta-500 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-700"
              />
              {ler.isPending && (
                <span className="text-sm text-tinta-400">Lendo o PDF…</span>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-tinta-500">
              Entende DARF previdenciário, guia do FGTS Digital, DAS do Simples
              Nacional e DARE do ICMS. Precisa ser o PDF original da
              contabilidade: quando o arquivo é digitalizado (uma foto dentro do
              PDF), não há texto para ler — aí use “Digitar à mão”.
            </p>
          </>
        )}
      </Bloco>

      {leitura && (
        <Bloco
          titulo={`Confira antes de gravar — ${TIPO_GUIA_LABEL[leitura.guia.tipo]}`}
          className="surgir mt-6"
        >
          {conjuntoDaLeitura && (
            <Aviso tom="marca">
              <span>
                Este arquivo é do conjunto de{' '}
                <strong className="num">
                  {formatComp(conjuntoDaLeitura.competencia)}
                </strong>
                {conjuntoDaLeitura.guias.length === 0
                  ? ' — é a primeira guia deste mês.'
                  : ` — já estão lançadas ${emLista(
                      conjuntoDaLeitura.guias.map((g) => TIPO_GUIA_LABEL[g.tipo]),
                    )}.`}
                {faltaDepoisDesta.length > 0 &&
                  ` Depois desta ainda falta ${emLista(
                    faltaDepoisDesta.map((t) => TIPO_GUIA_LABEL[t]),
                  )}.`}
              </span>
            </Aviso>
          )}
          {leitura.jaExiste && (
            <Aviso tom="erro">
              Esta guia já foi lançada (
              {formatComp(leitura.jaExiste.competencia)},{' '}
              {formatBRL(leitura.jaExiste.valorTotal)}). Gravar de novo contaria
              o mesmo imposto duas vezes — apague a anterior se quiser
              substituir.
            </Aviso>
          )}
          {leitura.divergencia && (
            <Aviso tom="erro">
              {leitura.divergencia} Confira o papel antes de gravar: pode ter
              escapado uma linha.
            </Aviso>
          )}
          {incertos > 0 && (
            <Aviso tom="atencao">
              {incertos === 1
                ? 'Um item tem código que eu não conheço'
                : `${incertos} itens têm código que eu não conheço`}{' '}
              — classifiquei no palpite. Confira a coluna "Conta como" antes de
              gravar.
            </Aviso>
          )}

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Leitura rotulo="Apuração" valor={formatComp(leitura.guia.competencia)} />
            <Leitura rotulo="Vencimento" valor={formatData(leitura.guia.vencimento)} />
            <Leitura rotulo="Total" valor={formatBRL(leitura.guia.valorTotal)} forte />
            <Leitura
              rotulo="Documento"
              valor={leitura.guia.numeroDocumento ?? '—'}
            />
            <Leitura
              rotulo={leitura.guia.trabalhadores ? 'Trabalhadores' : 'CNPJ'}
              valor={
                leitura.guia.trabalhadores
                  ? String(leitura.guia.trabalhadores)
                  : (leitura.guia.cnpj ?? '—')
              }
            />
          </div>

          <div className="mt-5 overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-tinta-100">
                  <th className="th">Código</th>
                  <th className="th">Denominação</th>
                  <th className="th text-right">Valor</th>
                  <th className="th">Conta como</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item, i) => (
                  <tr key={`${item.codigo ?? 'x'}-${i}`} className="linha">
                    <td className="td num text-tinta-500">{item.codigo ?? '—'}</td>
                    <td className="td text-tinta-800">
                      {item.denominacao}
                      {item.classeIncerta && (
                        <Selo pequeno tom="atencao">
                          código novo
                        </Selo>
                      )}
                    </td>
                    <td className="td text-right">
                      <span className="valor">{formatBRL(item.valor)}</span>
                    </td>
                    <td className="td">
                      <select
                        value={item.classe}
                        onChange={(e) =>
                          setItens(
                            itens.map((it, j) =>
                              j === i
                                ? {
                                    ...it,
                                    classe: e.target.value as ClasseTributo,
                                    classeIncerta: false,
                                  }
                                : it,
                            ),
                          )
                        }
                        className="campo py-1.5 text-xs"
                      >
                        {CLASSES.map((c) => (
                          <option key={c} value={c}>
                            {CLASSE_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-4">
            <button
              onClick={() => gravar.mutate()}
              disabled={!bate || gravar.isPending || !!leitura.jaExiste}
              className="btn btn-primario"
            >
              {gravar.isPending ? 'Gravando…' : 'Confirmar e gravar'}
            </button>
            <button onClick={cancelar} className="btn btn-neutro">
              Cancelar
            </button>
            <span className="text-sm text-tinta-500">
              Soma dos itens{' '}
              <strong className="valor text-[15px]">{formatBRL(soma)}</strong>
              {!bate && (
                <span className="text-rose-600">
                  {' '}
                  — não bate com o total do documento
                </span>
              )}
            </span>
          </div>
        </Bloco>
      )}

      <Bloco
        titulo="Guias lançadas, mês a mês"
        className="surgir surgir-2 mt-6"
        semPadding
      >
        {guias.isLoading ? (
          <Carregando />
        ) : meses.length === 0 ? (
          <Vazio titulo="Nenhuma guia lançada ainda">
            Suba o primeiro PDF acima e o imposto passa a aparecer na dashboard.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-tinta-200">
                  <th className="th">Guia</th>
                  <th className="th">Vencimento</th>
                  <th className="th">Composição</th>
                  <th className="th">Conta a pagar</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              {meses.map((mes) => (
                <tbody key={mes.competencia}>
                  <CabecalhoDoMes mes={mes} />
                  {mes.guias.map((g) => (
                    <tr key={g.id} className="linha">
                      <td className="td font-medium text-tinta-800">
                        {TIPO_GUIA_LABEL[g.tipo]}
                        {g.trabalhadores != null && (
                          <div className="text-xs text-tinta-400">
                            {g.trabalhadores} trabalhadores
                          </div>
                        )}
                      </td>
                      <td className="td num text-tinta-500">
                        {formatData(g.vencimento)}
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1.5">
                          {resumirClasses(g.itens).map(([classe, valor]) => (
                            <Selo
                              key={classe}
                              pequeno
                              tom={TOM_DA_CLASSE[classe]}
                            >
                              {CLASSE_CURTA[classe]} {formatBRL(valor)}
                            </Selo>
                          ))}
                        </div>
                      </td>
                      <td className="td">
                        <SituacaoDaConta
                          guia={g}
                          gerando={gerarConta.isPending && gerandoId === g.id}
                          onGerar={() => {
                            setGerandoId(g.id);
                            gerarConta.mutate(g.id);
                          }}
                        />
                      </td>
                      <td className="td text-right">
                        <span className="valor">{formatBRL(g.valorTotal)}</span>
                      </td>
                      <td className="td text-right">
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                `Apagar a guia de ${TIPO_GUIA_LABEL[g.tipo]} de ${formatComp(g.competencia)}?\n\nEla sai do custo com pessoal na dashboard.`,
                              )
                            ) {
                              excluir.mutate(g.id);
                            }
                          }}
                          className="btn btn-perigo btn-p"
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Bloco>
    </Pagina>
  );
}

/**
 * O que dizer depois de lançar a guia.
 *
 * A conta a pagar sai junto, e é ela que interessa a quem paga — dizer só
 * "guia lançada" esconderia o que acabou de entrar na fila do dia 20. Quando
 * ela não saiu, o motivo vem no mesmo aviso: a guia está gravada, o imposto
 * continua vencendo, e alguém precisa saber disso agora.
 */
function avisoDoLancamento(guia: Guia, como = ''): string {
  const nome = `Guia de ${TIPO_GUIA_LABEL[guia.tipo]} de ${formatComp(guia.competencia)}`;
  const lancada = `${nome} lançada${como ? ` ${como}` : ''}`;

  if (guia.avisoConta) {
    return `${lancada}, mas ela não virou conta a pagar: ${guia.avisoConta}`;
  }
  if (!guia.conta) return `${lancada}.`;

  return (
    `${lancada}, e já virou conta a pagar de ${formatBRL(guia.conta.valor)} ` +
    `para ${guia.conta.fornecedor.nome}, vencendo em ${formatData(guia.conta.vencimento)}` +
    (guia.conta.aviso ? `. ${guia.conta.aviso}` : '.')
  );
}

/**
 * Se a guia já está na fila de pagamento — e, quando não está, o botão que a
 * põe lá.
 *
 * O número do título no IXC fica visível porque é por ele que se acha a conta
 * do outro lado: sem isso, conferir se o imposto foi pago vira caça pelo valor
 * numa lista de centenas.
 */
function SituacaoDaConta({
  guia,
  gerando,
  onGerar,
}: {
  guia: Guia;
  gerando: boolean;
  onGerar: () => void;
}) {
  if (!guia.contaPagar) {
    return (
      <button
        onClick={onGerar}
        disabled={gerando}
        className="btn btn-neutro btn-p"
        title="Lança esta guia como conta a pagar no IXC, com o vencimento e o código de pagamento que vieram no PDF"
      >
        {gerando ? 'Lançando…' : 'Gerar conta a pagar'}
      </button>
    );
  }

  const paga = !!guia.contaPagar.pagoEm;
  return (
    <div className="flex flex-col gap-0.5">
      <Selo pequeno tom={paga ? 'pago' : 'info'}>
        {paga ? 'paga' : 'na fila de pagamento'}
      </Selo>
      <span className="num text-xs text-tinta-400">
        {guia.contaPagar.idFnApagarIxc
          ? `título ${guia.contaPagar.idFnApagarIxc} no IXC`
          : 'ainda sem número do IXC'}
      </span>
    </div>
  );
}

/** A composição que cada tipo de guia costuma ter, já classificada. */
const COMPOSICAO_PADRAO: Record<TipoGuia, ItemGuia[]> = {
  DARE_ICMS: [
    { codigo: '101', denominacao: 'ICMS — DARE estadual', valor: 0, classe: 'FATURAMENTO' },
  ],
  DARF_INSS: [
    { codigo: '1082', denominacao: 'CP descontada do segurado', valor: 0, classe: 'FOLHA_RETIDO' },
  ],
  FGTS: [
    { codigo: null, denominacao: 'FGTS mensal', valor: 0, classe: 'FOLHA_PATRONAL' },
    { codigo: null, denominacao: 'Consignado retido do trabalhador', valor: 0, classe: 'FOLHA_RETIDO' },
  ],
  DAS_SIMPLES: [
    { codigo: '1006', denominacao: 'INSS — Simples Nacional', valor: 0, classe: 'FOLHA_PATRONAL' },
    { codigo: null, denominacao: 'Demais tributos do DAS', valor: 0, classe: 'FATURAMENTO' },
  ],
  OUTRA: [{ codigo: null, denominacao: '', valor: 0, classe: 'FATURAMENTO' }],
};

/**
 * Digitar a guia em vez de subir o PDF.
 *
 * Existe porque a contabilidade às vezes manda o documento digitalizado — uma
 * foto dentro do PDF, sem texto nenhum para ler. Ler aquilo com OCR seria
 * adivinhar dígito de imposto, e errar ali é pior do que digitar: quem tem o
 * papel na mão lê melhor que qualquer palpite.
 *
 * A composição já vem classificada por tipo de guia, porque é ela — e não o
 * total — que decide o que é custo com pessoal.
 */
function LancamentoAMao({
  ocupado,
  onGravar,
}: {
  ocupado: boolean;
  onGravar: (guia: Record<string, unknown>) => void;
}) {
  const [tipo, setTipo] = useState<TipoGuia>('DARE_ICMS');
  const [competencia, setCompetencia] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [arquivoNome, setArquivoNome] = useState('');
  const [itens, setItens] = useState<ItemGuia[]>(COMPOSICAO_PADRAO.DARE_ICMS);

  function trocarTipo(novo: TipoGuia) {
    setTipo(novo);
    setItens(COMPOSICAO_PADRAO[novo].map((i) => ({ ...i })));
  }

  function alterarItem(i: number, mudanca: Partial<ItemGuia>) {
    setItens(itens.map((item, j) => (j === i ? { ...item, ...mudanca } : item)));
  }

  const total = itens.reduce((s, i) => s + (Number(i.valor) || 0), 0);
  const semDenominacao = itens.some((i) => i.denominacao.trim().length < 2);
  const valido =
    /^\d{4}-\d{2}$/.test(competencia) &&
    !!vencimento &&
    total >= 0.01 &&
    !semDenominacao;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="rotulo">Guia</label>
          <select
            value={tipo}
            onChange={(e) => trocarTipo(e.target.value as TipoGuia)}
            className="campo"
          >
            {ORDEM_GUIA.map((t) => (
              <option key={t} value={t}>
                {TIPO_GUIA_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo">Apuração — o mês do conjunto</label>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo">Vencimento</label>
          <input
            type="date"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo">Número do documento</label>
          <input
            value={numeroDocumento}
            onChange={(e) => setNumeroDocumento(e.target.value)}
            className="campo"
            placeholder="Opcional"
            autoComplete="off"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="rotulo">Nome do arquivo — para reencontrar depois</label>
          <input
            value={arquivoNome}
            onChange={(e) => setArquivoNome(e.target.value)}
            className="campo"
            placeholder="Ex.: ICMS DIFAL - 05.2026.pdf"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rolagem-fina">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-tinta-100">
              <th className="th">Código</th>
              <th className="th">Denominação</th>
              <th className="th">Valor</th>
              <th className="th">Conta como</th>
              <th className="th text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item, i) => (
              <tr key={i} className="linha">
                <td className="td">
                  <input
                    value={item.codigo ?? ''}
                    onChange={(e) =>
                      alterarItem(i, { codigo: e.target.value || null })
                    }
                    className="campo w-24 py-1.5 text-xs"
                    autoComplete="off"
                  />
                </td>
                <td className="td">
                  <input
                    value={item.denominacao}
                    onChange={(e) =>
                      alterarItem(i, { denominacao: e.target.value })
                    }
                    className="campo py-1.5 text-xs"
                    placeholder="O que esse valor é"
                    autoComplete="off"
                  />
                </td>
                <td className="td">
                  <CampoDinheiro
                    valor={item.valor ? String(item.valor) : ''}
                    onChange={(v) => alterarItem(i, { valor: Number(v) || 0 })}
                    className="campo w-32 py-1.5 text-xs"
                  />
                </td>
                <td className="td">
                  <select
                    value={item.classe}
                    onChange={(e) =>
                      alterarItem(i, { classe: e.target.value as ClasseTributo })
                    }
                    className="campo py-1.5 text-xs"
                  >
                    {CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {CLASSE_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="td text-right">
                  {itens.length > 1 && (
                    <button
                      onClick={() =>
                        setItens(itens.filter((_, j) => j !== i))
                      }
                      className="btn btn-perigo btn-p"
                    >
                      Tirar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={() =>
          setItens([
            ...itens,
            { codigo: null, denominacao: '', valor: 0, classe: 'FATURAMENTO' },
          ])
        }
        className="btn btn-neutro btn-p mt-3"
      >
        + Outra linha
      </button>

      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-4">
        <button
          onClick={() =>
            onGravar({
              tipo,
              competencia,
              vencimento,
              valorTotal: total,
              numeroDocumento: numeroDocumento || undefined,
              arquivoNome: arquivoNome.trim() || 'Lançada à mão',
              itens: itens.map(({ codigo, denominacao, valor, classe }) => ({
                codigo: codigo ?? undefined,
                denominacao,
                valor,
                classe,
              })),
            })
          }
          disabled={!valido || ocupado}
          className="btn btn-primario"
        >
          {ocupado ? 'Gravando…' : 'Gravar guia'}
        </button>
        <span className="text-sm text-tinta-500">
          Total da guia{' '}
          <strong className="valor text-[15px]">{formatBRL(total)}</strong>
        </span>
        {semDenominacao && (
          <span className="text-sm text-rose-600">
            Toda linha precisa dizer o que é.
          </span>
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-tinta-500">
        A coluna “conta como” é o que faz o número significar alguma coisa: só o
        patronal entra no custo com pessoal. O retido é dinheiro do trabalhador
        passando pela conta da empresa, e o de faturamento não tem a ver com
        gente.
      </p>
    </>
  );
}

/**
 * A faixa que abre o conjunto do mês. É ela que responde "de que mês é este
 * arquivo" sem obrigar a ler a data de cada linha — e diz na mesma altura o que
 * ainda não chegou daquele mês.
 */
function CabecalhoDoMes({ mes }: { mes: ConjuntoDoMes }) {
  return (
    <tr className="border-t border-tinta-100 bg-tinta-50">
      <td colSpan={5} className="px-5 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span className="font-display num text-sm font-semibold text-tinta-800">
            {formatComp(mes.competencia)}
          </span>
          <span className="text-xs text-tinta-400">
            {mes.guias.length} arquivo(s) · {formatBRL(mes.total)}
          </span>
          {mes.faltando.length === 0 ? (
            <Selo pequeno tom="pago">
              conjunto completo
            </Selo>
          ) : (
            mes.faltando.map((t) => (
              <Selo key={t} pequeno tom="atencao">
                falta {TIPO_GUIA_LABEL[t]}
              </Selo>
            ))
          )}
        </div>
      </td>
    </tr>
  );
}

/** Quanto cada classe pesou dentro de uma guia. */
function resumirClasses(itens: ItemGuia[]): [ClasseTributo, number][] {
  const soma = new Map<ClasseTributo, number>();
  for (const item of itens) {
    soma.set(item.classe, (soma.get(item.classe) ?? 0) + Number(item.valor));
  }
  return CLASSES.filter((c) => (soma.get(c) ?? 0) > 0).map((c) => [
    c,
    soma.get(c) ?? 0,
  ]);
}

function Leitura({
  rotulo,
  valor,
  forte,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
}) {
  return (
    <div>
      <div className="rotulo">{rotulo}</div>
      <div
        className={
          forte
            ? 'font-display text-lg font-semibold num text-tinta-800'
            : 'num text-sm text-tinta-700'
        }
      >
        {valor}
      </div>
    </div>
  );
}
