import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { NotasDoTitulo } from '../../components/NotasDoTitulo';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import { Carregando, Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatBRL, formatData } from '../../lib/format';
import { TIPO_LABEL } from '../../lib/status';
import type {
  CategoriaDespesa,
  DetalheDoTitulo,
  PagamentoFeito,
} from '../../lib/types';

/**
 * A ficha de um pagamento: quanto saiu, quando, de qual caixa — e, no fim, o
 * registro do IXC por inteiro.
 *
 * A ordem é a de quem confere: primeiro o que se quer conferir (valor e dia),
 * depois se o IXC confirma isso sem contradição, e só então os campos crus. Para
 * um pagamento que fecha, as duas primeiras partes bastam e ninguém precisa
 * descer; para o que não fecha, o campo que decidiu está logo abaixo, com o
 * valor que veio do IXC — discordar deixa de ser palavra contra palavra.
 */
export function DetalheDoPagamento({
  pagamento,
  onFechar,
}: {
  pagamento: PagamentoFeito;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [verTudo, setVerTudo] = useState(false);

  // A mesma leitura crua da ficha do débito: é o mesmo título no IXC, pago em
  // vez de aberto. Para um pagamento, o "por que ficou fora das contas em
  // aberto" que ela devolve é exatamente a confirmação da baixa.
  const detalhe = useQuery({
    queryKey: ['conta-bruta', pagamento.idFnApagar],
    queryFn: async () =>
      (
        await api.get<DetalheDoTitulo>(
          `/contas-abertas/${pagamento.idFnApagar}/bruto`,
        )
      ).data,
    retry: 0,
  });

  const campos = Object.entries(detalhe.data?.campos ?? {})
    .map(([campo, valor]) => ({ campo, valor: String(valor ?? '') }))
    .filter((c) => c.valor.trim() && c.valor.trim() !== '0')
    .sort((a, b) => a.campo.localeCompare(b.campo));

  async function copiar() {
    await navigator.clipboard.writeText(
      JSON.stringify(detalhe.data?.campos ?? {}, null, 2),
    );
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  const extras = pagamento.juros + pagamento.multa;

  return (
    <Janela titulo="Detalhe do pagamento" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        {/* --- O que saiu, do tamanho de quem confere de longe --- */}
        <div className="rounded-2xl bg-tinta-50 p-5">
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

        {/* --- O IXC confirma? --- */}
        <div className="mt-5">
          {pagamento.conferencia.fecha ? (
            <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              O registro do IXC confirma este pagamento: título baixado, valor
              batendo com o que era devido e sem marca de estorno.
            </div>
          ) : (
            <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">
                O registro deste pagamento pede uma olhada:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {pagamento.conferencia.ressalvas.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Dado rotulo="Data do pagamento">
            {formatData(pagamento.pagoEm)}
            {/* De onde a data saiu não é detalhe técnico: é o que separa o
                pagamento atrasado do lançamento atrasado, e é por ela que se
                acha o registro na tela do IXC. */}
            <span className="ml-1 text-xs text-tinta-400">
              {pagamento.fonteDaData === 'baixa'
                ? `(informada na baixa${
                    pagamento.baixaNoIxc ? ` nº ${pagamento.baixaNoIxc}` : ''
                  })`
                : pagamento.fonteDaData === 'debito'
                  ? `(${pagamento.campoDoDia} — o dia informado na baixa, que o IXC mostra como "Data pagamento")`
                  : `(${pagamento.campoDoDia ?? pagamento.campoDaBaixa} — o dia em que a baixa foi registrada)`}
            </span>
          </Dado>
          {/* Só quando os dois dias diferem: repetir a mesma data em dois
              campos faria procurar diferença onde não há. */}
          {pagamento.registradoEm.slice(0, 10) !==
            pagamento.pagoEm.slice(0, 10) && (
            <Dado rotulo="Lançado no IXC em">
              {formatData(pagamento.registradoEm)}
              <span className="ml-1 text-xs text-tinta-400">
                (o dia do registro, não o do dinheiro)
              </span>
            </Dado>
          )}
          <Dado rotulo="Vencimento">
            {pagamento.vencimento
              ? formatData(pagamento.vencimento)
              : 'sem data no IXC'}
          </Dado>
          <Dado rotulo="Valor do título">{formatBRL(pagamento.valor)}</Dado>
          <Dado rotulo="Saiu do caixa">{formatBRL(pagamento.valorPago)}</Dado>
          {extras > 0 && (
            <Dado rotulo="Juros e multa">
              {formatBRL(extras)}
              <span className="ml-1 text-xs text-tinta-400">
                (o preço do atraso)
              </span>
            </Dado>
          )}
          {pagamento.desconto > 0 && (
            <Dado rotulo="Desconto">{formatBRL(pagamento.desconto)}</Dado>
          )}
          {pagamento.parcial && (
            <Dado rotulo="Ainda em aberto">
              {formatBRL(pagamento.valorAberto)}
            </Dado>
          )}
          <Dado rotulo="De onde saiu">
            {pagamento.caixa.nome ??
              (pagamento.caixa.id ? `caixa ${pagamento.caixa.id}` : '—')}
          </Dado>
          <Dado rotulo="Forma de pagamento">
            {pagamento.formaPagamento ?? '—'}
          </Dado>
          <Dado rotulo="Documento">{pagamento.documento ?? '—'}</Dado>
          <Dado rotulo="Título no IXC">nº {pagamento.idFnApagar}</Dado>
          <Dado rotulo="Emissão">
            {pagamento.emissao ? formatData(pagamento.emissao) : '—'}
          </Dado>
          <Dado rotulo="Categoria da despesa">
            {pagamento.categoria.nome ??
              (pagamento.categoria.id ? `conta ${pagamento.categoria.id}` : '—')}
          </Dado>
          <Dado rotulo="Classificação daqui">
            <ClassificacaoDoPagamento pagamento={pagamento} />
          </Dado>
          <Dado rotulo="Status no IXC">
            {pagamento.statusEhDePago
              ? `${pagamento.statusNoIxc} — pago`
              : `${pagamento.statusNoIxc ?? '—'} (baixado mesmo assim)`}
          </Dado>
          <Dado rotulo="Auditoria">
            {pagamento.statusAuditoria === 'A'
              ? 'aprovada'
              : pagamento.statusAuditoria === 'R'
                ? 'reprovada'
                : pagamento.statusAuditoria === 'C'
                  ? 'cancelada'
                  : 'não auditada'}
          </Dado>
          {pagamento.baixadoPor && (
            <Dado rotulo="Baixado por">{pagamento.baixadoPor}</Dado>
          )}
        </div>

        {pagamento.observacao && (
          <div className="mt-4">
            <div className="rotulo">Observação no IXC</div>
            <p className="text-sm text-tinta-700">{pagamento.observacao}</p>
          </div>
        )}

        <NotasDoTitulo idFnApagar={pagamento.idFnApagar} />

        {pagamento.origem && (
          <div className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            Este pagamento nasceu no módulo Folha de Pagamento —{' '}
            {TIPO_LABEL[pagamento.origem.tipo] ?? pagamento.origem.tipo}
            {pagamento.origem.beneficiario
              ? ` de ${pagamento.origem.beneficiario}`
              : ''}
            . É a mesma saída, não uma a mais.
          </div>
        )}

        {/* --- O registro cru, para quem precisa cavar --- */}
        <div className="mt-6 border-t border-tinta-100 pt-5">
          <div className="rotulo">O que o IXC guarda deste título</div>

          {detalhe.isLoading && <Carregando texto="Lendo o título no IXC…" />}

          {detalhe.error && (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {mensagemErro(detalhe.error)}
            </p>
          )}

          {detalhe.data && (
            <>
              <p className="mb-3 text-xs leading-relaxed text-tinta-500">
                Os campos que decidem se um título ainda é dívida, com o valor
                que veio do IXC — a mesma leitura da ficha do débito, do outro
                lado.{' '}
                {pagamento.parcial
                  ? 'Neste aqui os dois convivem: a baixa confirma o que já saiu e o saldo mantém o título na lista de contas em aberto.'
                  : 'É por eles que este título saiu da lista de contas em aberto.'}
              </p>

              <div className="overflow-hidden rounded-xl border border-tinta-100">
                <table className="w-full text-sm">
                  <tbody>
                    {detalhe.data.filtro.olhou.map((c) => (
                      <tr key={c.campo} className="linha">
                        <td className="td num w-2/5 align-top text-xs text-tinta-500">
                          {c.campo}
                          <div className="mt-0.5 text-[11px] text-tinta-300">
                            {c.nota}
                          </div>
                        </td>
                        <td className="td break-all align-top font-semibold text-tinta-800">
                          {c.valor}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setVerTudo((v) => !v)}
                  className="btn btn-sutil btn-p"
                >
                  {verTudo
                    ? 'Esconder os demais campos'
                    : `Ver todos os ${campos.length} campos do IXC`}
                </button>
                <button onClick={copiar} className="btn btn-neutro btn-p">
                  {copiado ? 'Copiado!' : 'Copiar tudo'}
                </button>
              </div>

              {verTudo && (
                <div className="mt-3 max-h-[40vh] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                  <table className="w-full text-sm">
                    <tbody>
                      {campos.map(({ campo, valor }) => (
                        <tr key={campo} className="linha">
                          <td className="td num w-2/5 align-top text-xs text-tinta-500">
                            {campo}
                          </td>
                          <td className="td break-all align-top text-tinta-800">
                            {valor}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

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
    <div className="border-b border-tinta-100 py-2.5 last:border-0">
      <div className="text-xs text-tinta-400">{rotulo}</div>
      <div className="text-sm text-tinta-800">{children}</div>
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
    <div className="mt-0.5">
      <SeletorDeCategoria
        categorias={categorias.data}
        value={categoriaId}
        vazio="Sem classificação"
        carregando={categorias.isLoading}
        desabilitado={reclassificar.isPending}
        className="campo max-w-xs py-1 text-sm"
        title="Trocar a etiqueta deste pagamento"
        onChange={(id) => {
          // Guardado aqui além de ir para a API: a lista de trás só volta
          // depois, e até lá o `pagamento` que chegou por prop ainda é o
          // antigo — sem este estado, o campo voltaria sozinho para a opção
          // anterior na frente de quem acabou de escolher.
          setCategoriaId(id);
          reclassificar.mutate(id || null);
        }}
      />
      <p className="ajuda">
        {reclassificar.isPending
          ? 'Salvando…'
          : reclassificar.isSuccess
            ? 'Etiqueta trocada — o painel do mês já conta este gasto na fatia nova.'
            : 'Trocar aqui muda a fatia deste gasto no painel, inclusive em mês já fechado.'}
      </p>
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
