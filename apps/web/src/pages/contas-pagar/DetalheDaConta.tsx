import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { NotasDoTitulo } from '../../components/NotasDoTitulo';
import { Aviso, Carregando, Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import { formatBRL, formatData } from '../../lib/format';
import { TIPO_LABEL } from '../../lib/status';
import type {
  CategoriaDespesa,
  ContaAberta,
  DetalheDoTitulo,
  FormaDePagar,
  ResultadoDoPagamento,
} from '../../lib/types';

/**
 * A ficha de um débito: o que é, de quem, quanto, quando vence — e, no fim,
 * por que ele aparece nesta lista.
 *
 * Essa última parte não é enfeite técnico. O nome das colunas do `fn_apagar`
 * muda entre versões do IXC e a documentação não fecha a lista; o filtro desta
 * seção já errou duas vezes por isso, e nas duas a resposta estava num campo
 * que ninguém conseguia ver. Aqui os campos que decidem aparecem com o valor
 * que veio do IXC, então discordar do filtro deixa de ser palavra contra
 * palavra.
 */
export function DetalheDaConta({
  conta,
  onFechar,
  onRepetir,
}: {
  conta: ContaAberta;
  onFechar: () => void;
  /** Abre a tela que transforma esta conta em despesa mensal. */
  onRepetir?: () => void;
}) {
  const queryClient = useQueryClient();
  const [copiado, setCopiado] = useState(false);
  const [verTudo, setVerTudo] = useState(false);
  /** A parte técnica só aparece quando alguém vai investigar. */
  const [verTecnico, setVerTecnico] = useState(false);
  const [categoriaId, setCategoriaId] = useState(conta.classificacao?.id ?? '');

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  /**
   * Etiqueta o débito. A lista inteira é recarregada depois porque é dela que
   * o dashboard tira os agrupamentos — deixar as duas telas discordando sobre em
   * que categoria está um gasto seria pior que não ter categoria.
   */
  const classificar = useMutation({
    mutationFn: async (categoriaId: string | null) => {
      await api.put(`/contas-abertas/${conta.idFnApagar}/categoria`, {
        categoriaId,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['categorias-despesa'] });
    },
  });

  const detalhe = useQuery({
    queryKey: ['conta-bruta', conta.idFnApagar],
    queryFn: async () =>
      (
        await api.get<DetalheDoTitulo>(
          `/contas-abertas/${conta.idFnApagar}/bruto`,
        )
      ).data,
    // Só vai ao IXC quando alguém abre a parte técnica: abrir a ficha para
    // pagar não precisa de uma leitura a mais num sistema lento.
    enabled: verTecnico,
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

  const parcial = conta.valor > conta.valorAberto + 0.005;

  return (
    <Janela titulo="Detalhe do débito" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        {/* --- O essencial, do tamanho de quem confere de longe --- */}
        <div className="rounded-2xl bg-tinta-50 p-5">
          <div className="text-sm text-tinta-500">Devido a</div>
          <div className="font-display text-lg font-semibold text-tinta-900">
            {conta.fornecedor.nome || `Fornecedor ${conta.fornecedor.id ?? '?'}`}
          </div>
          <div className="valor mt-2 text-3xl">
            {formatBRL(conta.valorAberto)}
          </div>
          {parcial && (
            <div className="num mt-0.5 text-sm text-tinta-500">
              de {formatBRL(conta.valor)} — o resto já foi pago
            </div>
          )}
          <div className="mt-3">
            <PrazoDoDebito conta={conta} />
          </div>
        </div>

        <PagarConta conta={conta} onPago={onFechar} />

        <div className="mt-5 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Dado rotulo="Vencimento">
            {conta.vencimento ? formatData(conta.vencimento) : 'sem data no IXC'}
          </Dado>
          <Dado rotulo="Emissão">
            {conta.emissao ? formatData(conta.emissao) : '—'}
          </Dado>
          <Dado rotulo="Documento">{conta.documento ?? '—'}</Dado>
          <Dado rotulo="Título no IXC">nº {conta.idFnApagar}</Dado>
          <Dado rotulo="Categoria da despesa">
            {conta.categoria.nome ??
              (conta.categoria.id ? `conta ${conta.categoria.id}` : '—')}
          </Dado>
          <Dado rotulo="Auditoria">
            {conta.statusAuditoria === 'A'
              ? 'aprovada'
              : conta.statusAuditoria === 'R'
                ? 'reprovada'
                : conta.statusAuditoria === 'C'
                  ? 'cancelada'
                  : 'não auditada'}
          </Dado>
        </div>

        {/* A etiqueta é nossa e é o eixo dos relatórios — por isso ela fica
            logo abaixo do essencial, e não perdida no fim da ficha. */}
        <div className="mt-5 rounded-2xl border border-tinta-100 p-4">
          <label className="rotulo" htmlFor="categoria">
            A que se refere este débito
          </label>
          {/* A escolha é guardada aqui além de ir para a API: a lista de trás
              é recarregada depois de salvar, e até ela voltar o `conta` que
              chegou por prop ainda é o antigo — sem este estado, o campo
              voltaria sozinho para a opção anterior na frente de quem acabou
              de escolher. */}
          <SeletorDeCategoria
            id="categoria"
            categorias={categorias.data}
            value={categoriaId}
            vazio="Sem classificação"
            ajuda="Ela entra no cadastro e já fica valendo para este débito."
            carregando={categorias.isLoading}
            desabilitado={classificar.isPending}
            onChange={(id) => {
              setCategoriaId(id);
              classificar.mutate(id || null);
            }}
          />
          <p className="ajuda">
            {classificar.isPending
              ? 'Salvando…'
              : conta.categoria.nome
                ? `No IXC este título está na conta de despesa "${conta.categoria.nome}".`
                : 'É por esta escolha que o dashboard separa os gastos: ele soma pela categoria e destrincha pela subcategoria. Fica guardada aqui — o IXC não tem onde recebê-la.'}
          </p>
          {classificar.isError && (
            <p className="mt-2 text-sm text-rose-700">
              {mensagemErro(classificar.error)}
            </p>
          )}
        </div>

        {conta.observacao && (
          <div className="mt-4">
            <div className="rotulo">Observação no IXC</div>
            <p className="text-sm text-tinta-700">{conta.observacao}</p>
          </div>
        )}

        {/* A foto do cupom sobe junto com a conta, na hora de lançar — e é
            aqui que ela é procurada depois. Sem este bloco, a ficha do débito
            era a única tela do caminho que não sabia dizer se a nota subiu. */}
        <NotasDoTitulo idFnApagar={conta.idFnApagar} />

        {conta.origem && (
          <div className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            Esta conta nasceu no módulo Folha de Pagamento —{' '}
            {TIPO_LABEL[conta.origem.tipo] ?? conta.origem.tipo}
            {conta.origem.beneficiario ? ` de ${conta.origem.beneficiario}` : ''}
            . É a mesma dívida, não uma a mais.
          </div>
        )}

        {/*
          Os campos crus do IXC ficam atrás de um botão. Eles existem para
          responder "por que esta conta aparece aqui?" quando o filtro erra —
          já salvaram duas investigações —, mas isso é conserto, não trabalho
          do dia: aberto por padrão, ocupava a ficha inteira com uma tabela
          técnica entre quem paga e o que ele precisa ver.
        */}
        <div className="mt-5 border-t border-tinta-100 pt-4">
          <button
            onClick={() => setVerTecnico((v) => !v)}
            className="btn btn-sutil btn-p"
          >
            {verTecnico
              ? 'Esconder os campos do IXC'
              : 'Ver os campos crus do IXC (diagnóstico)'}
          </button>
        </div>

        {verTecnico && (
        <div className="mt-4 border-t border-tinta-100 pt-4">
          <div className="rotulo">Por que este débito aparece aqui</div>

          {detalhe.isLoading && <Carregando texto="Lendo o título no IXC…" />}

          {detalhe.error && (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {mensagemErro(detalhe.error)}
            </p>
          )}

          {detalhe.data && (
            <>
              <p className="mb-3 text-xs leading-relaxed text-tinta-500">
                {detalhe.data.filtro.aberta
                  ? 'O IXC devolveu este título com saldo a pagar e sem marca de pagamento ou cancelamento. Se ele não deveria estar aqui, é um dos campos abaixo que está sendo lido diferente do que o IXC entende.'
                  : `Este título ficou de fora da lista (${detalhe.data.filtro.motivo?.motivo}).`}
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
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {/* Serviço mensal quase sempre se descobre olhando uma conta que já
              chegou — é aqui que dá para dizer "essa se repete" sem ter de
              lançá-la de novo. */}
          {onRepetir && conta.fornecedor.id && (
            <button onClick={onRepetir} className="btn btn-neutro mr-auto">
              Repetir todo mês
            </button>
          )}
          <button onClick={onFechar} className="btn btn-neutro">
            Fechar
          </button>
        </div>
      </div>
    </Janela>
  );
}

/**
 * Pagar esta conta, daqui.
 *
 * São dois caminhos, e a diferença é de onde sai o dinheiro. **Pelo banco**
 * aprova o título na auditoria do IXC e o deixa pronto para o pagamento sair
 * por lá — nada se move agora. **Em mãos** aprova e dá a baixa na conta do
 * caixa: a conta fica paga no IXC no ato, porque o dinheiro já saiu da gaveta.
 *
 * O botão pede confirmação antes de mandar. É a única tela do app que tira
 * dinheiro do caixa da empresa sem passar pelo IXC, e um clique errado aqui
 * custa uma ida ao IXC para estornar.
 */
function PagarConta({
  conta,
  onPago,
}: {
  conta: ContaAberta;
  onPago: () => void;
}) {
  const queryClient = useQueryClient();
  const [forma, setForma] = useState<FormaDePagar>('BANCO');
  const [data, setData] = useState(hojeISO);
  const [confirmando, setConfirmando] = useState(false);
  const [feito, setFeito] = useState<ResultadoDoPagamento | null>(null);

  const pagar = useMutation({
    mutationFn: async () => {
      const { data: r } = await api.post<ResultadoDoPagamento>(
        `/contas-abertas/${conta.idFnApagar}/pagar`,
        { forma, ...(forma === 'EM_MAOS' ? { data } : {}) },
      );
      return r;
    },
    onSuccess: (r) => {
      setFeito(r);
      setConfirmando(false);
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
    },
    onError: () => setConfirmando(false),
  });

  if (feito) {
    return (
      <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <p className="font-semibold text-emerald-800 dark:text-emerald-200">
          {feito.paga
            ? `Pago — ${formatBRL(feito.valor)} baixado no IXC`
            : 'Aprovado no IXC, pronto para o banco pagar'}
        </p>
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
          {feito.paga
            ? 'O título consta quitado no IXC. Estornar, se precisar, é por lá.'
            : 'O título passou pela auditoria e está liberado. O pagamento em si sai no fluxo do banco, no IXC.'}
        </p>
        {feito.avisos.map((a) => (
          <p key={a} className="mt-2 text-sm text-amber-700 dark:text-amber-300">
            {a}
          </p>
        ))}
        <button onClick={onPago} className="btn btn-neutro btn-p mt-3">
          Fechar
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-2xl border border-tinta-100 p-4">
      <div className="rotulo">Pagar esta conta</div>

      <div className="mt-1 flex flex-wrap gap-2">
        <BotaoForma
          ativo={forma === 'BANCO'}
          onClick={() => {
            setForma('BANCO');
            setConfirmando(false);
          }}
          titulo="Pelo banco"
          nota="Aprova no IXC e deixa pronta"
        />
        <BotaoForma
          ativo={forma === 'EM_MAOS'}
          onClick={() => {
            setForma('EM_MAOS');
            setConfirmando(false);
          }}
          titulo="Em mãos"
          nota="Sai do caixa e já quita no IXC"
        />
      </div>

      {forma === 'EM_MAOS' && (
        <div className="mt-3 max-w-[200px]">
          <label className="rotulo" htmlFor="data-pagamento">
            Dia em que saiu
          </label>
          <input
            id="data-pagamento"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="campo"
          />
        </div>
      )}

      {pagar.isError && (
        <Aviso tom="erro">{mensagemErro(pagar.error)}</Aviso>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirmando ? (
          <>
            <button
              onClick={() => pagar.mutate()}
              disabled={pagar.isPending}
              className="btn btn-p bg-rose-600 text-white hover:bg-rose-500"
            >
              {pagar.isPending
                ? 'Enviando ao IXC…'
                : forma === 'EM_MAOS'
                  ? `Confirmar: pagar ${formatBRL(conta.valorAberto)} do caixa`
                  : `Confirmar: aprovar ${formatBRL(conta.valorAberto)}`}
            </button>
            <button
              onClick={() => setConfirmando(false)}
              className="btn btn-sutil btn-p"
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmando(true)}
            className="btn btn-primario btn-p"
          >
            Pagar {formatBRL(conta.valorAberto)}
          </button>
        )}
        <span className="text-xs text-tinta-400">
          {forma === 'EM_MAOS'
            ? 'O dinheiro sai da conta de caixa configurada e a conta fica paga no IXC.'
            : 'Só aprova na auditoria do IXC. O dinheiro sai pelo banco, por lá.'}
        </span>
      </div>
    </div>
  );
}

function BotaoForma({
  ativo,
  onClick,
  titulo,
  nota,
}: {
  ativo: boolean;
  onClick: () => void;
  titulo: string;
  nota: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={`rounded-xl border px-3 py-2 text-left transition ${
        ativo
          ? 'border-brand-400 bg-brand-50 dark:bg-brand-500/10'
          : 'border-tinta-200 hover:border-tinta-300'
      }`}
    >
      <span
        className={`block text-sm font-semibold ${
          ativo ? 'text-brand-800 dark:text-brand-200' : 'text-tinta-700'
        }`}
      >
        {titulo}
      </span>
      <span className="block text-[11px] text-tinta-400">{nota}</span>
    </button>
  );
}

function hojeISO(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="item-dividido py-2.5">
      <div className="text-xs text-tinta-400">{rotulo}</div>
      <div className="text-sm text-tinta-800">{children}</div>
    </div>
  );
}

/** O mesmo semáforo da lista: vermelho venceu, amarelo hoje, verde no prazo. */
function PrazoDoDebito({ conta }: { conta: ContaAberta }) {
  const dias = conta.diasParaVencer;
  if (dias === null) {
    return (
      <Selo tom="neutro" titulo="Sem data de vencimento no IXC">
        sem data de vencimento
      </Selo>
    );
  }
  if (dias < 0) {
    const atraso = Math.abs(dias);
    return (
      <Selo tom="erro">
        {atraso === 1 ? 'venceu ontem' : `${atraso} dias em atraso`}
      </Selo>
    );
  }
  if (dias === 0) return <Selo tom="atencao">vence hoje</Selo>;
  return (
    <Selo tom="pago">
      {dias === 1 ? 'vence amanhã' : `vence em ${dias} dias`}
    </Selo>
  );
}
