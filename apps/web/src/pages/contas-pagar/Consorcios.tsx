import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import { Aviso, CampoDinheiro, Janela, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { formatBRL, formatData } from '../../lib/format';
import type { CategoriaDespesa } from '../../lib/types';
import type { Recorrente, RecorrenteComResumo } from './Recorrentes';

/** Um fornecedor achado no IXC pela busca. */
interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

const TIPOS_DE_PAGAMENTO = [
  'Boleto',
  'Pix',
  'Débito em conta',
  'Transferência',
  'Dinheiro',
];

/** O que falta de um consórcio, contado do jeito que a rotina vai gerar. */
export function andamento(r: Recorrente) {
  const total = r.totalParcelas ?? 0;
  const porMes = Math.max(1, r.parcelasPorMes);
  const faltam = Math.max(0, total - r.parcelasLancadas);
  // As que ainda cabem no vencimento de agora (uma das duas pode já ter saído).
  const noProximo = Math.min(porMes - r.lancadasNoMes, faltam);
  const numeros = Array.from(
    { length: noProximo },
    (_, i) => r.parcelasLancadas + i + 1,
  );
  const mesesDepois = Math.ceil((faltam - noProximo) / porMes);
  const iso = String(r.proximoVencimento).slice(0, 10);
  return {
    total,
    porMes,
    faltam,
    quitado: faltam === 0,
    numeros,
    ultimaEm: faltam > 0 ? somarMeses(iso, mesesDepois, r.diaDoVencimento) : null,
  };
}

/**
 * Os consórcios: a despesa que se repete todo mês, mas acaba.
 *
 * Cartão em vez de tabela: o que importa aqui é quanto falta, e uma barra diz
 * isso num relance — e cartão cabe na tela do celular sem rolar de lado.
 */
export function ListaDeConsorcios({
  itens,
  ocupado,
  onEditar,
  onLigar,
  onApagar,
}: {
  itens: RecorrenteComResumo[];
  ocupado: boolean;
  onEditar: (r: Recorrente) => void;
  onLigar: (r: Recorrente) => void;
  onApagar: (r: Recorrente) => void;
}) {
  if (itens.length === 0) {
    return (
      <Vazio titulo="Nenhum consórcio cadastrado">
        Cadastre em "Novo consórcio" — ou, se ele já está nas mensais, use "É
        consórcio" na linha dele.
      </Vazio>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 md:p-4">
      {itens.map(({ recorrente: r, diasParaGerar }) => {
        const a = andamento(r);
        const pagas = r.parcelasLancadas;
        const pct = a.total ? Math.round((pagas / a.total) * 100) : 0;
        return (
          <div
            key={r.id}
            className={`min-w-0 rounded-2xl border border-tinta-100 bg-papel p-4 ${
              r.ativa || a.quitado ? '' : 'opacity-60'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-tinta-900">
                  {r.fornecedorNome}
                </div>
                <div className="text-xs text-tinta-500">
                  {r.observacao}
                  {r.diaDoVencimento ? ` · todo dia ${r.diaDoVencimento}` : ''}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="valor">{formatBRL(Number(r.valor))}</div>
                {a.porMes > 1 && (
                  <div className="text-[11px] text-tinta-500">
                    × {a.porMes} ={' '}
                    <span className="valor">
                      {formatBRL(Number(r.valor) * a.porMes)}
                    </span>
                    /mês
                  </div>
                )}
              </div>
            </div>

            {/* Quanto já foi, quanto falta. */}
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-tinta-100">
                <div
                  className={`h-full rounded-full ${a.quitado ? 'bg-emerald-500' : 'bg-brand-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-tinta-500">
                <span>
                  <strong className="num text-tinta-800">{pagas}</strong> de{' '}
                  <span className="num">{a.total}</span> parcelas
                  {a.porMes > 1 ? ` · ${a.porMes} por mês` : ''}
                </span>
                {a.quitado ? (
                  <Selo pequeno tom="pago">
                    quitado
                  </Selo>
                ) : (
                  <span>
                    faltam <strong className="num text-tinta-800">{a.faltam}</strong>
                    {a.ultimaEm && ` · última em ${mesAno(a.ultimaEm)}`}
                  </span>
                )}
              </div>
            </div>

            {!a.quitado && (
              <div className="mt-3 rounded-xl bg-tinta-50 px-3 py-2 text-xs text-tinta-600">
                {a.numeros.length > 1 ? 'Parcelas ' : 'Parcela '}
                <strong className="num text-tinta-800">
                  {juntar(a.numeros)}
                </strong>{' '}
                {a.numeros.length > 1 ? 'vencem' : 'vence'}{' '}
                <strong className="num text-tinta-800">
                  {formatData(r.proximoVencimento)}
                </strong>
                {' · '}
                {!r.ativa ? (
                  'desligado, não vai gerar'
                ) : diasParaGerar <= 0 ? (
                  <Selo pequeno tom="atencao">
                    nasce na próxima rodada
                  </Selo>
                ) : (
                  `nasce no IXC em ${diasParaGerar} dia(s)`
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {!r.ativa && !a.quitado && (
                <Selo pequeno tom="neutro">
                  desligado
                </Selo>
              )}
              {r.ultimoErro && (
                <Selo pequeno tom="erro" titulo={r.ultimoErro}>
                  a última falhou
                </Selo>
              )}
              <div className="ml-auto flex flex-wrap justify-end gap-1.5">
                <button
                  onClick={() => onEditar(r)}
                  className="btn btn-neutro btn-p"
                >
                  Editar
                </button>
                {!a.quitado && (
                  <button
                    onClick={() => onLigar(r)}
                    disabled={ocupado}
                    className="btn btn-sutil btn-p"
                    title={
                      r.ativa
                        ? 'Para de gerar; o que já gerou continua lá'
                        : 'Volta a gerar todo mês'
                    }
                  >
                    {r.ativa ? 'Desligar' : 'Religar'}
                  </button>
                )}
                <button
                  onClick={() => onApagar(r)}
                  className="btn btn-perigo btn-p"
                >
                  Apagar
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Cadastro do consórcio — novo, editado, ou uma mensal que vira consórcio.
 *
 * A pergunta que decide tudo é "quantas já saíram": dela sai o número da
 * próxima parcela e quando ele acaba. As que já estão lançadas no IXC, mesmo
 * sem pagar, contam — senão a rotina lança de novo uma que já existe.
 */
export function CadastroDoConsorcio({
  base,
  todas,
  onFechar,
  onPronto,
}: {
  /** A recorrente editada ou convertida; sem ela, é um consórcio novo. */
  base: Recorrente | null;
  todas: RecorrenteComResumo[];
  onFechar: () => void;
  onPronto: (mensagem: string) => void;
}) {
  const convertendo = !!base && base.totalParcelas == null;
  const editando = !!base && !convertendo;

  const [fornecedor, setFornecedor] = useState<{ id: number; nome: string } | null>(
    base ? { id: base.idFornecedorIxc, nome: base.fornecedorNome } : null,
  );
  const [termo, setTermo] = useState('');
  const buscaEfetiva = useTermoAdiado(termo);

  const [observacao, setObservacao] = useState(base?.observacao ?? '');
  const [valor, setValor] = useState(base ? String(Number(base.valor)) : '');
  const [dia, setDia] = useState(
    base
      ? String(base.diaDoVencimento ?? Number(String(base.proximoVencimento).slice(8, 10)))
      : '',
  );
  /** A data escrita à mão ganha do dia; sem ela, a data segue o dia. */
  const [vencimentoEscrito, setVencimentoEscrito] = useState(
    base ? String(base.proximoVencimento).slice(0, 10) : '',
  );
  const [total, setTotal] = useState(base?.totalParcelas ? String(base.totalParcelas) : '');
  const [lancadas, setLancadas] = useState(editando ? String(base.parcelasLancadas) : '');
  const [porMes, setPorMes] = useState(String(editando ? base.parcelasPorMes : 1));
  const [categoriaId, setCategoriaId] = useState(base?.categoriaId ?? '');
  const [tipoPagamento, setTipoPagamento] = useState(base?.tipoPagamentoIxc ?? 'Boleto');
  const [soDiasUteis, setSoDiasUteis] = useState(base?.apenasDiasUteis ?? true);

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

  const nDia = Number(dia);
  const diaValido = Number.isInteger(nDia) && nDia >= 1 && nDia <= 31;
  const vencimento = vencimentoEscrito || (diaValido ? proximaData(nDia) : '');
  const nTotal = Number(total);
  const nLancadas = Number(lancadas || 0);
  const nPorMes = Number(porMes);

  /*
   * As outras repetições do mesmo fornecedor. É o desenho da Canopus antes
   * disto: duas mensais, uma para cada parcela do mês. Ficando, cada mês teria
   * as parcelas do consórcio e mais as delas.
   */
  const irmas = fornecedor
    ? todas
        .map((i) => i.recorrente)
        .filter(
          (r) =>
            r.id !== base?.id &&
            r.idFornecedorIxc === fornecedor.id &&
            r.ativa &&
            r.totalParcelas == null,
        )
    : [];
  const [apagar, setApagar] = useState<Set<string> | null>(null);
  const marcadas = apagar ?? new Set(irmas.map((r) => r.id));

  const previa =
    nTotal >= 2 && nLancadas >= 0 && nLancadas <= nTotal && nPorMes >= 1 && vencimento
      ? andamento({
          ...(base ?? ({} as Recorrente)),
          totalParcelas: nTotal,
          parcelasLancadas: nLancadas,
          parcelasPorMes: nPorMes,
          // Se a contagem e a data ficaram como estavam, vale o que já nasceu
          // no mês; mexer nelas recomeça o mês (é o que o servidor faz).
          lancadasNoMes:
            editando &&
            nLancadas === base.parcelasLancadas &&
            vencimento === String(base.proximoVencimento).slice(0, 10)
              ? base.lancadasNoMes
              : 0,
          proximoVencimento: vencimento,
          diaDoVencimento: diaValido ? nDia : null,
        })
      : null;

  const podeSalvar =
    !!fornecedor &&
    Number(valor) > 0 &&
    diaValido &&
    Number.isInteger(nTotal) &&
    nTotal >= 2 &&
    nTotal <= 360 &&
    Number.isInteger(nLancadas) &&
    nLancadas >= 0 &&
    nLancadas <= nTotal &&
    nPorMes >= 1 &&
    !!vencimento;

  const salvar = useMutation({
    mutationFn: async () => {
      const obs = observacao.trim();
      const dados = {
        valor: Number(valor),
        // Sem descrição, a do IXC diz o que é: "nem me pergunta".
        observacao: obs.length >= 3 ? obs : `Consórcio ${fornecedor!.nome}`,
        proximoVencimento: vencimento,
        diaDoVencimento: nDia,
        totalParcelas: nTotal,
        parcelasLancadas: nLancadas,
        parcelasPorMes: nPorMes,
        categoriaId: categoriaId || null,
        tipoPagamentoIxc: tipoPagamento.trim() || undefined,
        apenasDiasUteis: soDiasUteis,
      };
      if (base) {
        await api.patch(`/recorrentes/${base.id}`, dados);
      } else {
        await api.post('/recorrentes', {
          ...dados,
          idFornecedorIxc: fornecedor!.id,
          fornecedorNome: fornecedor!.nome,
        });
      }

      let apagadas = 0;
      for (const r of irmas) {
        if (!marcadas.has(r.id)) continue;
        await api.delete(`/recorrentes/${r.id}`);
        apagadas += 1;
      }
      return apagadas;
    },
    onSuccess: (apagadas) =>
      onPronto(
        (editando
          ? `Consórcio de ${fornecedor!.nome} atualizado.`
          : `${fornecedor!.nome} ${convertendo ? 'virou consórcio' : 'cadastrado como consórcio'}. As parcelas nascem no IXC 5 dias antes de vencer.`) +
          (apagadas > 0
            ? ` ${apagadas} repetição(ões) mensal(is) do mesmo fornecedor apagada(s).`
            : ''),
      ),
  });

  return (
    <Janela
      titulo={
        editando
          ? `Editar consórcio — ${base.fornecedorNome}`
          : convertendo
            ? 'Transformar em consórcio'
            : 'Novo consórcio'
      }
      onFechar={onFechar}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="co-fornecedor">
            Fornecedor no IXC
          </label>
          {fornecedor ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-tinta-50 px-3 py-2">
              <span className="min-w-0 text-tinta-800">{fornecedor.nome}</span>
              <span className="num text-xs text-tinta-400">
                código {fornecedor.id}
              </span>
              {/* Na edição o fornecedor fica: trocar de credor é outro consórcio. */}
              {!base && (
                <button
                  onClick={() => {
                    setFornecedor(null);
                    setTermo('');
                    setApagar(null);
                  }}
                  className="btn btn-sutil btn-p ml-auto"
                >
                  Trocar
                </button>
              )}
            </div>
          ) : (
            <>
              <input
                id="co-fornecedor"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                className="campo"
                placeholder="Nome, nome fantasia ou CPF/CNPJ"
                autoComplete="off"
                autoFocus
              />
              {fornecedores.isFetching && (
                <p className="ajuda">Procurando no IXC…</p>
              )}
              {fornecedores.error && (
                <p className="ajuda text-rose-600">
                  {mensagemErro(fornecedores.error)}
                </p>
              )}
              {fornecedores.data && fornecedores.data.length === 0 && (
                <p className="ajuda">
                  Nenhum fornecedor ativo com esse nome no IXC.
                </p>
              )}
              {!!fornecedores.data?.length && (
                <div className="mt-2 max-h-48 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                  {fornecedores.data.map((f) => (
                    <button
                      key={f.idFornecedor}
                      onClick={() =>
                        setFornecedor({ id: f.idFornecedor, nome: f.nome })
                      }
                      className="item-dividido flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-tinta-50"
                    >
                      <span className="min-w-0 truncate text-sm text-tinta-800">
                        {f.nome}
                      </span>
                      <span className="num shrink-0 text-xs text-tinta-400">
                        {f.cpfCnpj ?? `nº ${f.idFornecedor}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="co-obs">
            Descrição (vai na conta do IXC)
          </label>
          <input
            id="co-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
            placeholder={
              fornecedor ? `Consórcio ${fornecedor.nome}` : 'Consórcio caçamba'
            }
            autoComplete="off"
          />
          <p className="ajuda">
            Cada conta sai com o número da parcela no fim: "(12/60)".
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="co-valor">
            Valor de cada parcela
          </label>
          <CampoDinheiro id="co-valor" valor={valor} onChange={setValor} />
        </div>

        <div>
          <label className="rotulo" htmlFor="co-por-mes">
            Parcelas por mês
          </label>
          <select
            id="co-por-mes"
            value={porMes}
            onChange={(e) => setPorMes(e.target.value)}
            className="campo"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1 por mês' : `${n} por mês (vencem juntas)`}
              </option>
            ))}
          </select>
          {nPorMes > 1 && Number(valor) > 0 && (
            <p className="ajuda">
              {nPorMes} contas no mesmo dia, somando{' '}
              {formatBRL(Number(valor) * nPorMes)} por mês.
            </p>
          )}
        </div>

        <div>
          <label className="rotulo" htmlFor="co-dia">
            Vence todo dia
          </label>
          <input
            id="co-dia"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className="campo num"
            placeholder="14"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="co-vencimento">
            Próxima parcela a gerar vence em
          </label>
          <input
            id="co-vencimento"
            type="date"
            value={vencimento}
            onChange={(e) => setVencimentoEscrito(e.target.value)}
            className="campo"
          />
          <p className="ajuda">
            Se a deste mês já está lançada no IXC, deixe a do mês que vem.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="co-total">
            Quantidade de parcelas
          </label>
          <input
            id="co-total"
            type="number"
            inputMode="numeric"
            min={2}
            max={360}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="campo num"
            placeholder="60"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="co-lancadas">
            Quantas já foram pagas
          </label>
          <input
            id="co-lancadas"
            type="number"
            inputMode="numeric"
            min={0}
            max={360}
            value={lancadas}
            onChange={(e) => setLancadas(e.target.value)}
            className="campo num"
            placeholder="0"
          />
          <p className="ajuda">
            Conte também as que já estão lançadas no IXC esperando pagamento.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="co-tipo">
            Tipo de pagamento
          </label>
          <select
            id="co-tipo"
            value={tipoPagamento}
            onChange={(e) => setTipoPagamento(e.target.value)}
            className="campo"
          >
            {(TIPOS_DE_PAGAMENTO.includes(tipoPagamento)
              ? TIPOS_DE_PAGAMENTO
              : [tipoPagamento, ...TIPOS_DE_PAGAMENTO]
            ).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="rotulo" htmlFor="co-categoria">
            Categoria
          </label>
          <SeletorDeCategoria
            id="co-categoria"
            categorias={categorias.data ?? []}
            value={categoriaId}
            onChange={setCategoriaId}
            vazio="Sem categoria"
            carregando={categorias.isLoading}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-tinta-700 sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={soDiasUteis}
            onChange={(e) => setSoDiasUteis(e.target.checked)}
          />
          Só em dia útil — fim de semana ou feriado passa para o próximo dia
        </label>
      </div>

      {/* O que vai acontecer, antes de acontecer. */}
      {previa && (
        <div className="mt-4 rounded-2xl bg-tinta-50 p-4 text-sm text-tinta-600">
          {previa.quitado ? (
            <>Todas as parcelas já saíram — este consórcio não gera mais nada.</>
          ) : (
            <>
              {previa.numeros.length > 1 ? 'As parcelas ' : 'A parcela '}
              <strong className="num text-tinta-900">
                {juntar(previa.numeros)}
              </strong>{' '}
              de {previa.total} {previa.numeros.length > 1 ? 'vencem' : 'vence'}{' '}
              <strong className="num text-tinta-900">
                {formatData(vencimento)}
              </strong>{' '}
              e {previa.numeros.length > 1 ? 'nascem' : 'nasce'} no IXC 5 dias
              antes. Faltam <strong className="num">{previa.faltam}</strong>
              {previa.ultimaEm && <> — a última em {mesAno(previa.ultimaEm)}</>}
              ; depois dela o consórcio para sozinho.
            </>
          )}
        </div>
      )}

      {irmas.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {fornecedor!.nome} já tem {irmas.length} repetição(ões) mensal(is)
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Se ficarem, cada mês vai ter as parcelas do consórcio e mais as
            delas. As marcadas são apagadas ao salvar — as contas que já
            geraram continuam no IXC.
          </p>
          <div className="mt-2 space-y-1">
            {irmas.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-amber-600"
                  checked={marcadas.has(r.id)}
                  onChange={(e) => {
                    const novo = new Set(marcadas);
                    if (e.target.checked) novo.add(r.id);
                    else novo.delete(r.id);
                    setApagar(novo);
                  }}
                />
                <span className="min-w-0 truncate">
                  {r.observacao} · {formatBRL(Number(r.valor))} · próxima{' '}
                  {formatData(r.proximoVencimento)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {salvar.isError && <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => salvar.mutate()}
          disabled={!podeSalvar || salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending
            ? 'Salvando…'
            : editando
              ? 'Salvar'
              : convertendo
                ? 'Virar consórcio'
                : 'Cadastrar consórcio'}
        </button>
      </div>
    </Janela>
  );
}

/** A próxima vez que o dia cai depois de hoje ("todo dia 14" num dia 14 = mês que vem). */
function proximaData(dia: number): string {
  const agora = new Date();
  const hoje = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
  let ano = agora.getFullYear();
  let mes = agora.getMonth();
  for (;;) {
    const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    const d = Date.UTC(ano, mes, Math.min(dia, ultimo));
    if (d > hoje) return new Date(d).toISOString().slice(0, 10);
    mes += 1;
    if (mes > 11) {
      mes = 0;
      ano += 1;
    }
  }
}

/** `meses` depois de `iso`, voltando ao dia combinado quando o mês cabe. */
function somarMeses(iso: string, meses: number, dia: number | null): string {
  const [ano, mes, d] = iso.split('-').map(Number);
  const alvo = dia ?? d;
  const ultimo = new Date(Date.UTC(ano, mes - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes - 1 + meses, Math.min(alvo, ultimo)))
    .toISOString()
    .slice(0, 10);
}

function mesAno(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** [12, 13] → "12 e 13"; [12, 13, 14] → "12, 13 e 14". */
function juntar(numeros: number[]): string {
  if (numeros.length <= 1) return numeros.join('');
  return `${numeros.slice(0, -1).join(', ')} e ${numeros[numeros.length - 1]}`;
}
