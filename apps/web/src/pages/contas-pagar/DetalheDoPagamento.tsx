import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AnexarNotaAoTitulo, NotasDoTitulo } from '../../components/NotasDoTitulo';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import { CategoriasDeDentro } from '../../components/SeloDaCategoria';
import { estaClassificado } from '../../lib/categorias';
import { Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBRL, formatData } from '../../lib/format';
import type { CategoriaDespesa, PagamentoFeito } from '../../lib/types';

/**
 * A ficha de um pagamento: quanto saiu, quando, de qual caixa, e o que ainda se
 * escreve nele depois de pago — o número da nota, a categoria e os anexos.
 *
 * O que se repete com o alto da ficha, ou que é igual em todo pagamento, não
 * entra: um parágrafo só aparece quando o registro do IXC não fecha.
 */
export function DetalheDoPagamento({
  pagamento,
  onFechar,
}: {
  pagamento: PagamentoFeito;
  onFechar: () => void;
}) {
  const qcConferencia = useQueryClient();

  /*
   * "Já conferi": a ressalva foi olhada e o pagamento está de pé.
   *
   * A ressalva nasce da leitura do IXC a cada abertura da tela — sem isto ela
   * voltava todo dia, mesmo depois de a pessoa ter ido ao IXC e concluído que
   * estava tudo certo. O que vai para o servidor é o texto que está aqui na
   * tela: se o IXC passar a apontar outra coisa, o aviso volta sozinho.
   */
  const conferir = useMutation({
    mutationFn: async (dar: boolean) => {
      const caminho = `/pagamentos-feitos/${pagamento.idFnApagar}/conferido`;
      if (!dar) return (await api.delete(caminho)).data;
      return (await api.post(caminho, { ressalvas: pagamento.conferencia.ressalvas })).data;
    },
    onSuccess: () =>
      void qcConferencia.invalidateQueries({ queryKey: ['pagamentos-feitos'] }),
  });

  const extras = pagamento.juros + pagamento.multa;

  return (
    <Janela titulo="Detalhe do pagamento" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        {/* --- O que saiu, do tamanho de quem confere de longe --- */}
        <div className="rounded-2xl bg-realce p-5">
          <div className="text-sm text-tinta-500">Pago a</div>
          <div className="font-display text-lg font-semibold text-tinta-900">
            {pagamento.fornecedor.nome ||
              `Fornecedor ${pagamento.fornecedor.id ?? '?'}`}
          </div>
          <div className="valor mt-2 text-3xl">
            {formatBRL(pagamento.valorPago)}
          </div>
          <div className="num mt-0.5 text-sm text-tinta-500">
            em {formatData(pagamento.pagoEm)}
            {pagamento.formaPagamento ? ` · ${pagamento.formaPagamento}` : ''}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <PrazoDoPagamento pagamento={pagamento} />
            {pagamento.parcial && (
              <Selo
                tom="atencao"
                titulo="O título continua na lista de contas em aberto pelo que falta"
              >
                pagamento parcial
              </Selo>
            )}
          </div>
        </div>

        {/* Só o que pede uma olhada: pagamento que fecha não tem o que dizer. */}
        {!pagamento.conferencia.fecha && (
          <div className="mt-4">
            <div
              className={`rounded-2xl px-4 py-3 text-sm ${
                pagamento.conferencia.conferidoPor
                  ? 'bg-tinta-100/70 text-tinta-700'
                  : 'bg-amber-50 text-amber-900'
              }`}
            >
              <p className="font-semibold">
                {pagamento.conferencia.conferidoPor
                  ? 'O registro deste pagamento tem ressalva, e ela já foi conferida:'
                  : 'O registro deste pagamento pede uma olhada:'}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {pagamento.conferencia.ressalvas.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>

              {/* A saída que faltava: conferi, está certo, para de me avisar.
                  O que fica guardado é o que foi conferido — ressalva nova no
                  IXC faz o aviso voltar. */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {pagamento.conferencia.conferidoPor ? (
                  <>
                    <span className="text-[13px]">
                      Conferido por {pagamento.conferencia.conferidoPor}
                      {pagamento.conferencia.conferidoEm &&
                        ` em ${formatData(pagamento.conferencia.conferidoEm)}`}
                      .
                    </span>
                    <button
                      type="button"
                      onClick={() => conferir.mutate(false)}
                      disabled={conferir.isPending}
                      className="btn btn-sutil btn-p"
                    >
                      Desfazer
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => conferir.mutate(true)}
                    disabled={conferir.isPending}
                    className="btn btn-neutro btn-p"
                    title="Some com o aviso desta ressalva. Ele volta se o IXC passar a apontar outra coisa."
                  >
                    {conferir.isPending ? 'Guardando…' : 'Já conferi, está certo'}
                  </button>
                )}
                {conferir.isError && (
                  <span className="text-[13px] text-rose-600">
                    {mensagemErro(conferir.error)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3">
          <NumeroDaNota idFnApagar={pagamento.idFnApagar} />
          <div>
            <div className="rotulo">Categoria</div>
            {/* Várias notas ou fatura: quem responde são as de dentro. */}
            {pagamento.rateio?.length && estaClassificado(pagamento) ? (
              <CategoriasDeDentro fatias={pagamento.rateio} />
            ) : (
              <ClassificacaoDoPagamento pagamento={pagamento} />
            )}
          </div>
        </div>

        <div className="mt-3">
          <Dado rotulo="Vencimento">
            {pagamento.vencimento ? formatData(pagamento.vencimento) : '—'}
          </Dado>
          <Dado rotulo="De onde saiu">
            {pagamento.caixa.nome ??
              (pagamento.caixa.id ? `caixa ${pagamento.caixa.id}` : '—')}
          </Dado>
          {/* Só o que difere do valor lá de cima. */}
          {Math.abs(pagamento.valor - pagamento.valorPago) >= 0.005 && (
            <Dado rotulo="Valor do título">{formatBRL(pagamento.valor)}</Dado>
          )}
          {extras > 0 && (
            <Dado rotulo="Juros e multa">{formatBRL(extras)}</Dado>
          )}
          {pagamento.desconto > 0 && (
            <Dado rotulo="Desconto">{formatBRL(pagamento.desconto)}</Dado>
          )}
          {pagamento.parcial && (
            <Dado rotulo="Ainda em aberto">
              {formatBRL(pagamento.valorAberto)}
            </Dado>
          )}
          {pagamento.documento && (
            <Dado rotulo="Documento">{pagamento.documento}</Dado>
          )}
          {pagamento.observacao && (
            <Dado rotulo="Observação">{pagamento.observacao}</Dado>
          )}
          <Dado rotulo="Título no IXC">nº {pagamento.idFnApagar}</Dado>
        </div>

        <NotasDoTitulo idFnApagar={pagamento.idFnApagar} />
        {/* A nota fiscal que chega depois de pago vai para o título no IXC —
            e de lá para a Contabilidade. */}
        <AnexarNotaAoTitulo
          idFnApagar={pagamento.idFnApagar}
          descricao={pagamento.observacao?.trim().slice(0, 80) || 'Nota fiscal'}
        />

        <div className="mt-6 flex justify-end">
          <button onClick={onFechar} className="btn btn-neutro">
            Fechar
          </button>
        </div>
      </div>
    </Janela>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-tinta-100 py-2 last:border-0">
      <div className="shrink-0 text-xs text-tinta-400">{rotulo}</div>
      <div className="min-w-0 break-words text-right text-sm text-tinta-800">{children}</div>
    </div>
  );
}

/**
 * O número da nota fiscal, o mesmo da conta — a Contabilidade o lê daqui, e por
 * isso ele continua editável depois de pago. Grava ao sair do campo.
 *
 * Sem a leitura não há campo: em branco por falha, sair dele apagaria o número.
 */
function NumeroDaNota({ idFnApagar }: { idFnApagar: number }) {
  const qc = useQueryClient();
  const chave = ['nota-fiscal', idFnApagar];
  /** O que está sendo digitado; null = ainda não mexeu. */
  const [digitado, setDigitado] = useState<string | null>(null);

  const nota = useQuery({
    queryKey: chave,
    queryFn: async () =>
      (await api.get<{ numero: string | null }>(`/contas-abertas/${idFnApagar}/nota-fiscal`)).data,
    retry: 0,
  });

  const gravar = useMutation({
    mutationFn: async (numero: string | null) =>
      (
        await api.put<{ numero: string | null; parcelas: number }>(
          `/contas-abertas/${idFnApagar}/nota-fiscal`,
          { numero },
        )
      ).data,
    onSuccess: (r) => {
      qc.setQueryData(chave, { numero: r.numero });
      // As outras parcelas da compra também podem ter recebido o número.
      void qc.invalidateQueries({ queryKey: ['nota-fiscal'] });
      void qc.invalidateQueries({ queryKey: ['contabilidade'] });
    },
  });

  if (nota.isError) {
    return <p className="text-sm text-rose-600">{mensagemErro(nota.error)}</p>;
  }

  const salvo = nota.data?.numero ?? '';
  const salvar = () => {
    const limpo = digitado?.trim() ?? salvo;
    if (limpo !== salvo) gravar.mutate(limpo || null);
  };

  return (
    <div>
      <label className="rotulo" htmlFor="numero-nf-pago">
        Nº da nota fiscal
      </label>
      <input
        id="numero-nf-pago"
        value={digitado ?? salvo}
        disabled={nota.isLoading}
        onChange={(e) => setDigitado(e.target.value)}
        onBlur={salvar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="campo num"
        maxLength={60}
        autoComplete="off"
      />
      {gravar.isPending && <p className="ajuda">Salvando…</p>}
      {gravar.isSuccess && (
        <p className="ajuda">
          {gravar.data.parcelas > 0
            ? `Salvo, também em ${gravar.data.parcelas} outra(s) parcela(s).`
            : 'Salvo.'}
        </p>
      )}
      {gravar.isError && (
        <p className="mt-1 text-sm text-rose-600">{mensagemErro(gravar.error)}</p>
      )}
    </div>
  );
}

/**
 * A etiqueta deste pagamento — e, para o administrador, a chance de trocá-la.
 *
 * Etiqueta errada num pagamento já feito não se conserta em lugar nenhum: a
 * tela de classificar é a das contas em aberto, e a conta paga saiu de lá. O
 * gasto ficava na fatia errada do painel para sempre, e a única saída era
 * lembrar de acertar antes de pagar — que é lembrar de uma coisa no pior
 * momento para lembrar dela.
 *
 * Só o administrador troca. A conta paga já entrou em relatório: o mês foi
 * fechado com ela naquela fatia, e alguém leu aquele número. Reclassificar
 * depois às vezes é exatamente o certo — a etiqueta estava errada —, mas é
 * decisão de quem responde pelo relatório, não de quem lança o dia a dia. Para
 * os demais a ficha continua o que era: a etiqueta escrita, sem campo nenhum.
 */
function ClassificacaoDoPagamento({ pagamento }: { pagamento: PagamentoFeito }) {
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const ehAdmin = usuario?.role === 'ADMIN';

  const [categoriaId, setCategoriaId] = useState(
    pagamento.classificacao?.id ?? '',
  );

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
    // A lista só é lida por quem pode escolher: para os demais este bloco é
    // texto, e uma consulta a mais na abertura de toda ficha não paga nada.
    enabled: ehAdmin,
  });

  const reclassificar = useMutation({
    mutationFn: async (id: string | null) => {
      await api.put(`/pagamentos/${pagamento.idFnApagar}/categoria`, {
        categoriaId: id,
      });
    },
    onSuccess: () => {
      // A lista de trás alimenta o painel do mês: sem recarregá-la, a ficha e
      // o gráfico passariam a discordar sobre em que fatia está este gasto.
      void qc.invalidateQueries({ queryKey: ['pagamentos-feitos'] });
      void qc.invalidateQueries({ queryKey: ['categorias-despesa'] });
    },
  });

  const escrita = pagamento.classificacao
    ? pagamento.classificacao.grupo
      ? `${pagamento.classificacao.grupo.nome} · ${pagamento.classificacao.nome}`
      : pagamento.classificacao.nome
    : 'sem classificação';

  if (!ehAdmin) return <>{escrita}</>;

  return (
    <div>
      <SeletorDeCategoria
        categorias={categorias.data}
        value={categoriaId}
        vazio="Sem classificação"
        carregando={categorias.isLoading}
        desabilitado={reclassificar.isPending}
        className="campo"
        title="Trocar a categoria deste pagamento"
        onChange={(id) => {
          // Guardado aqui além de ir para a API: a lista de trás só volta
          // depois, e até lá o `pagamento` que chegou por prop ainda é o
          // antigo — sem este estado, o campo voltaria sozinho para a opção
          // anterior na frente de quem acabou de escolher.
          setCategoriaId(id);
          reclassificar.mutate(id || null);
        }}
      />
      {reclassificar.isPending && <p className="ajuda">Salvando…</p>}
      {reclassificar.isSuccess && <p className="ajuda">Salvo.</p>}
      {reclassificar.isError && (
        <p className="mt-1 text-sm text-rose-600">
          {mensagemErro(reclassificar.error)}
        </p>
      )}
    </div>
  );
}

/**
 * Pagou em dia ou atrasado. É a régua da casa lida ao contrário da tela de
 * contas em aberto: lá o verde é "ainda dá tempo", aqui é "saiu no prazo".
 */
export function PrazoDoPagamento({
  pagamento,
  pequeno = false,
}: {
  pagamento: PagamentoFeito;
  pequeno?: boolean;
}) {
  const dias = pagamento.diasDeAtraso;

  if (dias === null) {
    return (
      <Selo
        pequeno={pequeno}
        tom="neutro"
        titulo="O título não tem vencimento no IXC, então não há como dizer se foi em dia"
      >
        sem vencimento
      </Selo>
    );
  }
  if (dias > 0) {
    /*
     * Só se acusa atraso com o dia do dinheiro na mão.
     *
     * Sem ele o que se tem é o dia em que a baixa foi registrada, e quem lança
     * dias depois de pagar via um vermelho que não era dele — a tela dizia
     * "pago 8 dias depois" de uma conta paga no vencimento. Nesse caso o selo
     * continua aparecendo (o título pode ter atrasado mesmo), mas diz o que
     * sabe: quem atrasou foi o lançamento.
     */
    const semODiaDoDinheiro = pagamento.fonteDaData === 'titulo';
    return (
      <Selo
        pequeno={pequeno}
        tom={semODiaDoDinheiro ? 'neutro' : 'erro'}
        titulo={
          semODiaDoDinheiro
            ? 'Contado pelo dia em que a baixa foi registrada no IXC, que pode ' +
              'ser depois do dia em que o dinheiro saiu — este título não traz ' +
              'o dia do débito e não achei a linha de baixa dele. Pode ter sido ' +
              'pago em dia'
            : undefined
        }
      >
        {semODiaDoDinheiro
          ? dias === 1
            ? 'lançado 1 dia depois'
            : `lançado ${dias} dias depois`
          : dias === 1
            ? 'pago 1 dia depois'
            : `pago ${dias} dias depois`}
      </Selo>
    );
  }
  if (dias === 0) {
    return (
      <Selo pequeno={pequeno} tom="pago">
        pago no vencimento
      </Selo>
    );
  }
  const adiantado = Math.abs(dias);
  return (
    <Selo pequeno={pequeno} tom="pago">
      {adiantado === 1 ? 'pago 1 dia antes' : `pago ${adiantado} dias antes`}
    </Selo>
  );
}
