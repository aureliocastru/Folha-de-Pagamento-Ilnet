import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import type {
  CaixasIxc,
  CategoriaDespesa,
  ConfigFinanceira,
} from '../../lib/types';

export function Configuracoes() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigFinanceira | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const { data } = useQuery({
    queryKey: ['config-financeira'],
    queryFn: async () =>
      (await api.get<ConfigFinanceira>('/config-financeira')).data,
  });

  /** As categorias de despesa, para escolher a que a folha carimba. */
  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  /**
   * Etiqueta de uma vez a folha que ficou sem categoria — a que foi paga antes
   * de esta regra existir.
   */
  const etiquetarFolha = useMutation({
    mutationFn: async () =>
      (
        await api.post<{
          etiquetadas: number;
          daFolha: number;
          semCategoria: boolean;
        }>('/contas-pagar/etiquetar-folha')
      ).data,
    onSuccess: () => {
      // Os números do painel e a contagem de "em uso" da categoria mudam com
      // isto: deixá-los como estavam faria a tela discordar do que acabou de
      // acontecer.
      void qc.invalidateQueries({ queryKey: ['categorias-despesa'] });
      void qc.invalidateQueries({ queryKey: ['pagamentos-feitos'] });
      void qc.invalidateQueries({ queryKey: ['contas-abertas'] });
    },
  });

  const salvar = useMutation({
    mutationFn: async () => (await api.put('/config-financeira', form)).data,
    onSuccess: () => {
      setErro(false);
      setFeedback('Configurações salvas.');
      qc.invalidateQueries({ queryKey: ['config-financeira'] });
      setTimeout(() => setFeedback(null), 2500);
    },
    onError: (err) => {
      setErro(true);
      setFeedback(mensagemErro(err));
    },
  });

  if (!form)
    return (
      <Pagina>
        <Carregando />
      </Pagina>
    );

  function num<K extends keyof ConfigFinanceira>(k: K, v: string) {
    setForm((f) => (f ? { ...f, [k]: Number(v) } : f));
  }
  function txt<K extends keyof ConfigFinanceira>(k: K, v: string) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Configurações"
        titulo="Parâmetros da integração"
        descricao="Tudo o que a folha usa para montar uma conta a pagar no IXC. Mexer aqui muda as próximas gerações, não o que já foi enviado."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <div className="max-w-3xl space-y-4">
        <Bloco titulo="IDs da integração" className="surgir surgir-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CampoNum
              label="Conta de Pagamento — banco (id_contas)"
              valor={form.contaPagamentoId}
              onChange={(v) => num('contaPagamentoId', v)}
            />
            <CampoNum
              label="Conta de Pagamento — caixa (em mãos)"
              valor={form.contaPagamentoCaixaId}
              onChange={(v) => num('contaPagamentoCaixaId', v)}
            />
            <CampoNum
              label="Filial (filial_id)"
              valor={form.filialId}
              onChange={(v) => num('filialId', v)}
            />
            <CampoNum
              label="Cidade padrão do fornecedor"
              valor={form.cidadePadraoId}
              onChange={(v) => num('cidadePadraoId', v)}
            />
            <CampoNum
              label="Adiantamento do dia 25 (% do salário base)"
              valor={form.percentualAdiantamento}
              onChange={(v) => num('percentualAdiantamento', v)}
            />
            <div className="sm:col-span-2">
              <label className="rotulo">Tipo de pagamento no fn_apagar</label>
              <input
                value={form.tipoPagamentoPadrao}
                onChange={(e) => txt('tipoPagamentoPadrao', e.target.value)}
                className="campo"
                placeholder='O rótulo exato do seu IXC, ex.: "Pix"'
              />
            </div>
          </div>
        </Bloco>

        <Bloco titulo="Quem paga, no recibo" className="surgir surgir-2">
          <p className="mb-4 text-xs leading-relaxed text-tinta-500">
            Sai impresso no recibo que o diarista assina quando recebe em mãos.
            Um recibo que não diz quem entregou o dinheiro não prova nada — e o
            que já foi assinado guarda o nome de então, não muda com isto.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="rotulo">Razão social</label>
              <input
                value={form.empresaNome}
                onChange={(e) => txt('empresaNome', e.target.value)}
                className="campo"
                placeholder="ILNET"
              />
            </div>
            <div>
              <label className="rotulo">CNPJ</label>
              <input
                value={form.empresaCnpj}
                onChange={(e) => txt('empresaCnpj', e.target.value)}
                className="campo num"
                placeholder="00.000.000/0001-00"
              />
            </div>
          </div>
        </Bloco>

        <Bloco titulo="Tipo da chave Pix" className="surgir surgir-2">
          <p className="mb-4 text-xs leading-relaxed text-tinta-500">
            Na conta a pagar do IXC, o rádio “Tipo da chave Pix” precisa vir
            marcado — sem ele o banco recusa o PIX. Como o nome dessa coluna
            muda de um IXC para outro, o app <strong>aprende sozinho</strong>{' '}
            olhando as contas que já existem por lá, e{' '}
            <strong>guarda o que aprendeu</strong> — um tipo de cada vez, à
            medida que aparece exemplo de cada um. Só preencha abaixo se o rádio
            continuar em branco; o detalhe do que ele viu está em{' '}
            <span className="num">/api/contas-pagar/diagnostico-pix</span>.
          </p>

          <div className="mb-4 rounded-lg bg-tinta-50 px-3 py-2.5 text-xs leading-relaxed text-tinta-600">
            <span className="rotulo">Já decorado</span>
            {form.pixCampoTipoChaveAprendido ? (
              <div className="mt-1">
                Coluna{' '}
                <span className="num text-tinta-800">
                  {form.pixCampoTipoChaveAprendido}
                </span>
                {form.pixCodigosTipoChaveAprendidos ? (
                  <>
                    {' '}
                    — códigos{' '}
                    <span className="num text-tinta-800">
                      {form.pixCodigosTipoChaveAprendidos}
                    </span>
                  </>
                ) : (
                  ' — nenhum código ainda'
                )}
              </div>
            ) : (
              <div className="mt-1">
                Nada ainda. O app procura na primeira conta a pagar com PIX que
                gerar; se não houver exemplo no IXC daquele tipo de chave, marque
                o tipo à mão numa conta lá e reenvie — ele aprende e não pergunta
                de novo.
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="rotulo">Coluna do tipo da chave</label>
              <input
                value={form.pixCampoTipoChave}
                onChange={(e) => txt('pixCampoTipoChave', e.target.value)}
                className="campo"
                placeholder="vazio = aprender sozinho"
              />
            </div>
            <div>
              <label className="rotulo">Código de cada tipo</label>
              <input
                value={form.pixCodigosTipoChave}
                onChange={(e) => txt('pixCodigosTipoChave', e.target.value)}
                className="campo"
                placeholder="Ex.: Celular=C,E-mail=E,CPF/CNPJ=D"
              />
            </div>
          </div>
        </Bloco>

        <Bloco titulo="Contas contábeis" className="surgir surgir-2">
          <p className="mb-4 text-xs text-tinta-500">
            É o <span className="num">id_conta</span> do planejamento analítico
            — o que separa salário de bônus no relatório do IXC.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CampoNum
              label="Salário"
              valor={form.contaContabilSalario}
              onChange={(v) => num('contaContabilSalario', v)}
            />
            <CampoNum
              label="Adiantamento"
              valor={form.contaContabilAdiantamento}
              onChange={(v) => num('contaContabilAdiantamento', v)}
            />
            <CampoNum
              label="Bônus"
              valor={form.contaContabilBonus}
              onChange={(v) => num('contaContabilBonus', v)}
            />
            <CampoNum
              label="Férias"
              valor={form.contaContabilFerias}
              onChange={(v) => num('contaContabilFerias', v)}
            />
            <CampoNum
              label="Diária"
              valor={form.contaContabilDiaria}
              onChange={(v) => num('contaContabilDiaria', v)}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-tinta-400">
            As contas da diária e das férias nascem iguais à do salário.
            Confirme com quem cuida da contabilidade se elas devem entrar em
            conta própria.
          </p>

          {/* A conta contábil acima é do IXC; esta é a etiqueta da casa, a que
              separa os números do painel. Fica no mesmo bloco porque respondem
              à mesma pergunta — "onde este gasto entra?" —, uma de cada lado. */}
          <div className="mt-5 border-t border-tinta-100 pt-4">
            <label className="rotulo" htmlFor="categoria-da-folha">
              Categoria dos pagamentos da folha
            </label>
            <select
              id="categoria-da-folha"
              value={form.categoriaFolhaId ?? ''}
              disabled={categorias.isLoading}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, categoriaFolhaId: e.target.value || null } : f,
                )
              }
              className="campo max-w-sm"
            >
              <option value="">Sem etiqueta (a folha nasce sem categoria)</option>
              {(categorias.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.pai ? `${c.pai.nome} · ${c.nome}` : c.nome}
                </option>
              ))}
            </select>
            <p className="ajuda">
              Salário, férias, adiantamento e bônus saem etiquetados com ela
              sozinhos — são dezenas de contas por mês, e sem isto o maior gasto
              da empresa fica fora dos gráficos por categoria. Diária e avulso
              não entram: a categoria deles é escolhida na própria tela.
            </p>

            {/* O acerto do que ficou para trás é botão, e não mágica no
                arranque: conta enviada antes desta regra existir não aparece em
                lugar nenhum reclamando: quem olha o painel só vê um número
                menor do que devia. Aqui ele roda quando alguém manda e diz
                quantas etiquetou — e rodar de novo não estraga nada. */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => etiquetarFolha.mutate()}
                disabled={etiquetarFolha.isPending || !form.categoriaFolhaId}
                className="btn btn-neutro"
              >
                {etiquetarFolha.isPending
                  ? 'Etiquetando…'
                  : 'Etiquetar a folha que está sem categoria'}
              </button>
              {etiquetarFolha.data && (
                <span className="text-sm text-tinta-500">
                  {/* Zero conta da folha não é "tudo certo": é o filtro não
                      achando nada, e a frase precisa dizer isso — senão o
                      botão responde "nada a fazer" para um problema. */}
                  {etiquetarFolha.data.semCategoria
                    ? 'Escolha a categoria acima e salve antes.'
                    : etiquetarFolha.data.daFolha === 0
                      ? 'Não achei conta nenhuma da folha com número no IXC — não há o que etiquetar.'
                      : etiquetarFolha.data.etiquetadas === 0
                        ? `Nada a fazer — as ${etiquetarFolha.data.daFolha} conta(s) da folha já estão etiquetadas.`
                        : `${etiquetarFolha.data.etiquetadas} conta(s) etiquetadas, de ${etiquetarFolha.data.daFolha} da folha.`}
                </span>
              )}
              {etiquetarFolha.isError && (
                <span className="text-sm text-rose-600">
                  {mensagemErro(etiquetarFolha.error)}
                </span>
              )}
            </div>
          </div>
        </Bloco>

        <CaixaEmMaos form={form} num={num} txt={txt} />

        <Bloco titulo="Quem conta como funcionário" className="surgir surgir-3">
          <p className="mb-4 text-xs leading-relaxed text-tinta-500">
            Fornecedor ativo com “Contribuinte ICMS” = Isento entra na folha.
            Confira o resultado antes de importar.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="rotulo">Campo do ICMS</label>
              <input
                value={form.fornecedorCampoIcms}
                onChange={(e) => txt('fornecedorCampoIcms', e.target.value)}
                className="campo"
                placeholder="vazio = detectar"
              />
            </div>
            <div>
              <label className="rotulo">Valores que significam Isento</label>
              <input
                value={form.fornecedorIcmsIsento}
                onChange={(e) => txt('fornecedorIcmsIsento', e.target.value)}
                className="campo"
                placeholder="Ex.: I,ISENTO"
              />
            </div>
            <div>
              <label className="rotulo">Tabela dos dados bancários</label>
              <input
                value={form.fornecedorTabelaBanco}
                onChange={(e) => txt('fornecedorTabelaBanco', e.target.value)}
                className="campo"
                placeholder="vazio = descobrir"
              />
            </div>
          </div>
        </Bloco>

        <Bloco titulo="Quem conta como diarista" className="surgir surgir-3">
          <p className="mb-4 text-xs leading-relaxed text-tinta-500">
            Fornecedor ativo com “Tipo de pessoa” = Estrangeiro é diarista. Quem
            já é funcionário fica de fora — é um ou outro, nunca os dois. O
            código que o seu IXC usa para “Estrangeiro” não é documentado:
            confira na prévia (<span className="num">/api/sync/diaristas/preview</span>)
            antes de importar.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="rotulo">Campo do tipo de pessoa</label>
              <input
                value={form.fornecedorCampoTipoPessoa}
                onChange={(e) =>
                  txt('fornecedorCampoTipoPessoa', e.target.value)
                }
                className="campo"
                placeholder="vazio = detectar"
              />
            </div>
            <div>
              <label className="rotulo">
                Valores que significam Estrangeiro
              </label>
              <input
                value={form.fornecedorTipoEstrangeiro}
                onChange={(e) =>
                  txt('fornecedorTipoEstrangeiro', e.target.value)
                }
                className="campo"
                placeholder="Ex.: E,ESTRANGEIRO"
              />
            </div>
          </div>
        </Bloco>

        <Bloco titulo="Observação de cada pagamento" className="surgir surgir-4">
          <p className="mb-4 text-xs text-tinta-500">
            É o texto que a pessoa vê no IXC.{' '}
            <span className="num">{'{competencia}'}</span> vira MM/AAAA.
          </p>
          <div className="space-y-4">
            <CampoTxt
              label="Salário"
              valor={form.obsSalarioTemplate}
              onChange={(v) => txt('obsSalarioTemplate', v)}
            />
            <CampoTxt
              label="Adiantamento"
              valor={form.obsAdiantamentoTemplate}
              onChange={(v) => txt('obsAdiantamentoTemplate', v)}
            />
            <CampoTxt
              label="Bônus"
              valor={form.obsBonusTemplate}
              onChange={(v) => txt('obsBonusTemplate', v)}
            />
            <CampoTxt
              label="Férias"
              valor={form.obsFeriasTemplate}
              onChange={(v) => txt('obsFeriasTemplate', v)}
            />
          </div>
        </Bloco>

        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </div>
    </Pagina>
  );
}

/**
 * O caminho antigo do dinheiro pago em mãos: escrever a saída direto na
 * movimentação financeira do IXC. Hoje quem recebe em mãos vira conta a pagar
 * na conta do caixa (o campo lá em cima), e nada disto é usado para pagar.
 *
 * Continua aqui porque as diárias e os pagamentos em mãos de antes ficaram
 * pendentes "fora do caixa", e fechá-los pelo botão "Lançar no caixa" ainda
 * passa por estes campos.
 */
function CaixaEmMaos({
  form,
  num,
  txt,
}: {
  form: ConfigFinanceira;
  num: (k: keyof ConfigFinanceira, v: string) => void;
  txt: (k: keyof ConfigFinanceira, v: string) => void;
}) {
  const [ver, setVer] = useState(false);
  const caixas = useQuery({
    queryKey: ['caixas-ixc'],
    queryFn: async () =>
      (await api.get<CaixasIxc>('/config-financeira/caixas')).data,
    enabled: ver,
  });

  return (
    <Bloco
      titulo="Caixa dos pagamentos em mãos antigos"
      className="surgir surgir-3"
    >
      <p className="mb-4 text-xs leading-relaxed text-tinta-500">
        Só para fechar o que ficou pendente: pagamento em mãos hoje vira conta a
        pagar na conta do caixa, lá em cima. Estes campos servem ao botão
        “Lançar no caixa” das diárias e dos avulsos que ficaram “fora do caixa”.
        Deixe o código em <span className="num">0</span> para o app procurar pelo
        nome.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CampoNum
          label="Código do caixa (0 = pelo nome)"
          valor={form.caixaEmMaosId}
          onChange={(v) => num('caixaEmMaosId', v)}
        />
        <div className="sm:col-span-2">
          <label className="rotulo">Nome do caixa no IXC</label>
          <input
            value={form.caixaEmMaosNome}
            onChange={(e) => txt('caixaEmMaosNome', e.target.value)}
            className="campo"
            placeholder="Ex.: CX - Werick"
          />
        </div>
        <div>
          <label className="rotulo">Tabela de contas/caixas</label>
          <input
            value={form.caixaTabelaContas}
            onChange={(e) => txt('caixaTabelaContas', e.target.value)}
            className="campo"
            placeholder="vazio = descobrir"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="rotulo">Tabela da movimentação financeira</label>
          <input
            value={form.caixaTabelaMovimento}
            onChange={(e) => txt('caixaTabelaMovimento', e.target.value)}
            className="campo"
            placeholder="vazio = descobrir"
          />
        </div>
      </div>

      <div className="mt-4 border-t border-tinta-100 pt-4">
        <button onClick={() => setVer(true)} className="btn btn-neutro btn-p">
          {caixas.isFetching ? 'Consultando o IXC…' : 'Ver os caixas do IXC'}
        </button>

        {ver && caixas.data && (
          <div className="mt-3 text-sm">
            {caixas.data.tabela === null ? (
              <p className="text-rose-600">
                Não encontrei a tabela de contas/caixas no seu IXC. Peça o nome
                dela ao suporte e informe no campo acima.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-tinta-400">
                  Lidos da tabela{' '}
                  <span className="num">{caixas.data.tabela}</span>
                  {caixas.data.emUso
                    ? ` · em uso hoje: código ${caixas.data.emUso}`
                    : ` · nenhum caixa casou com "${caixas.data.nomeProcurado}"`}
                </p>
                <div className="max-h-64 overflow-y-auto rolagem-fina rounded-lg ring-1 ring-tinta-100">
                  <table className="w-full text-sm">
                    <tbody>
                      {caixas.data.caixas.map((c) => (
                        <tr key={c.id} className="linha">
                          <td className="td num w-20 text-tinta-500">{c.id}</td>
                          <td className="td">{c.nome}</td>
                          <td className="td text-xs text-tinta-400">
                            {c.tipo ?? ''}
                          </td>
                          <td className="td text-right">
                            <button
                              onClick={() => num('caixaEmMaosId', String(c.id))}
                              className="btn btn-sutil btn-p"
                            >
                              Usar este
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Bloco>
  );
}

function CampoNum({
  label,
  valor,
  onChange,
}: {
  label: string;
  valor: number;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="rotulo">{label}</label>
      <input
        type="number"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="campo"
      />
    </div>
  );
}

function CampoTxt({
  label,
  valor,
  onChange,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="rotulo">{label}</label>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="campo"
      />
    </div>
  );
}
