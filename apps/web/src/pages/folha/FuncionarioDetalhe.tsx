import { CalendarioDeFaltas } from '../../components/CalendarioDeFaltas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Bloco,
  CampoDinheiro,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { baseDaFolha, rotuloParcelaAtual, usaValorAReceber } from '../../lib/folha';
import { formatBRL, formatData } from '../../lib/format';
import { SENTIDO_CURTO, SENTIDO_TOM, TIPO_LABEL } from '../../lib/status';
import { TIPOS_CHAVE_PIX } from '../../lib/types';
import type {
  FuncionarioDetalhe as TFunc,
  Lancamento,
  TipoLancamento,
  ValeComSaldo,
  VariavelMes,
} from '../../lib/types';

export function FuncionarioDetalhe() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [observacoes, setObservacoes] = useState('');
  const [apelido, setApelido] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [tipoChavePix, setTipoChavePix] = useState('');
  const [salvo, setSalvo] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['funcionario', id],
    queryFn: async () => (await api.get<TFunc>(`/funcionarios/${id}`)).data,
    enabled: !!id,
  });

  useEffect(() => {
    if (data) {
      setObservacoes(data.observacoes ?? '');
      setApelido(data.apelido ?? '');
      setChavePix(data.chavePix ?? '');
      setTipoChavePix(data.tipoChavePix ?? '');
    }
  }, [data]);

  const salvar = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/funcionarios/${id}`, {
          observacoes,
          apelido,
          chavePix,
          tipoChavePix,
        })
      ).data,
    onSuccess: () => {
      setSalvo(true);
      qc.invalidateQueries({ queryKey: ['funcionario', id] });
      setTimeout(() => setSalvo(false), 2500);
    },
  });

  if (isLoading)
    return (
      <Pagina>
        <Carregando />
      </Pagina>
    );
  if (isError)
    return (
      <Pagina>
        <div className="card p-6 text-sm text-rose-600">
          {mensagemErro(error)}
        </div>
      </Pagina>
    );
  if (!data) return null;

  return (
    <Pagina>
      <header className="surgir mb-8">
        <Link
          to="/folha/funcionarios"
          className="eyebrow inline-flex items-center gap-1.5 transition hover:text-tinta-700"
        >
          ← Funcionários
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="titulo-pagina">{data.nome}</h1>
          {data.apelido && (
            <span className="text-lg text-tinta-400">“{data.apelido}”</span>
          )}
          <Selo tom={data.ativo ? 'pago' : 'neutro'} ponto>
            {data.ativo ? 'Ativo' : 'Inativo'}
          </Selo>
          {data.ixcId && (
            <span className="num text-xs text-tinta-300">IXC {data.ixcId}</span>
          )}
        </div>
        <p className="mt-2 text-sm text-tinta-500">
          Base da folha{' '}
          <strong className="valor text-[15px]">
            {formatBRL(baseDaFolha(data))}
          </strong>
          {usaValorAReceber(data) && (
            <span className="text-tinta-400">
              {' '}
              · salário base {formatBRL(data.salarioBase)}
            </span>
          )}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <Bloco titulo="Cadastro no IXC" className="surgir surgir-1">
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <Campo rotulo="CPF/CNPJ" valor={data.cpfCnpj} mono />
              <Campo rotulo="E-mail" valor={data.email} />
              <Campo rotulo="Telefone" valor={data.telefone} mono />
              <Campo rotulo="Função" valor={data.funcao} />
              <Campo rotulo="Departamento" valor={data.departamento} />
              <Campo rotulo="Admissão" valor={formatData(data.dataAdmissao)} />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 border-t border-tinta-100 pt-5 sm:grid-cols-2">
              <Campo rotulo="Banco" valor={data.banco} />
              <Campo rotulo="Agência" valor={data.agencia} mono />
              <Campo rotulo="Conta" valor={data.conta} mono />
              <Campo rotulo="Chave PIX" valor={data.chavePix} mono />
              <Campo
                rotulo="Tipo da chave"
                valor={data.tipoChavePix ?? 'pelo formato da chave'}
              />
            </div>
          </Bloco>

          <ConfigFolhaBloco data={data} funcionarioId={id!} />

          <VariaveisMesBloco
            funcionarioId={id!}
            variaveis={data.variaveisMes ?? []}
            valorPorVendaPadrao={data.valorPorVenda ?? null}
            carteiraAssinada={!!data.carteiraAssinada}
          />

          {/* Só sem carteira assinada: com carteira, quem desconta falta é a
              contabilidade na folha oficial, e marcar aqui tiraria o mesmo dia
              duas vezes da mesma pessoa. */}
          {!data.carteiraAssinada && (
            <CalendarioDeFaltas funcionarioId={id!} nome={data.nome} />
          )}

          <ValesBloco funcionarioId={id!} />

          <LancamentosBloco funcionarioId={id!} lancamentos={data.lancamentos} />

          <Bloco titulo="Adiantamentos vindos do IXC" semPadding>
            {data.adiantamentos.length === 0 ? (
              <Vazio titulo="Nenhum adiantamento sincronizado" />
            ) : (
              <div className="overflow-x-auto rolagem-fina">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t border-tinta-200">
                      <th className="th">Data</th>
                      <th className="th">Descrição</th>
                      <th className="th text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.adiantamentos.map((a) => (
                      <tr key={a.id} className="linha">
                        <td className="td num text-tinta-500">
                          {formatData(a.data)}
                        </td>
                        <td className="td">{a.descricao}</td>
                        <td className="td text-right">
                          <span className="valor">{formatBRL(a.valor)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Bloco>
        </section>

        <section className="space-y-4">
          <Bloco titulo="Notas internas" className="surgir surgir-2">
            <label className="rotulo" htmlFor="apelido">
              Apelido
            </label>
            <input
              id="apelido"
              value={apelido}
              onChange={(e) => setApelido(e.target.value)}
              className="campo mb-1"
              placeholder="Como todo mundo chama"
            />
            <p className="mb-4 text-xs leading-snug text-tinta-400">
              É por ele que a busca acha a pessoa — aqui, na folha e nos
              pagamentos. O IXC não tem esse campo; ele é só daqui.
            </p>
            <label className="rotulo" htmlFor="pix">
              Chave PIX (complementar)
            </label>
            <input
              id="pix"
              value={chavePix}
              onChange={(e) => setChavePix(e.target.value)}
              className="campo mb-4"
            />
            <label className="rotulo" htmlFor="tipo-pix">
              Tipo da chave
            </label>
            <select
              id="tipo-pix"
              value={tipoChavePix}
              onChange={(e) => setTipoChavePix(e.target.value)}
              className="campo mb-1"
            >
              <option value="">Pelo formato da chave</option>
              {TIPOS_CHAVE_PIX.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <p className="mb-4 text-xs leading-snug text-tinta-400">
              É o que a conta a pagar marca no IXC. Vem do tipo preferencial do
              fornecedor a cada sincronização — mexa aqui só para corrigir.
            </p>
            <label className="rotulo" htmlFor="obs">
              Observações
            </label>
            <textarea
              id="obs"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={5}
              className="campo resize-y"
              placeholder="Contexto que não cabe no IXC."
            />
            <button
              onClick={() => salvar.mutate()}
              disabled={salvar.isPending}
              className="btn btn-primario mt-4 w-full"
            >
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </button>
            {salvo && (
              <p className="mt-2 text-center text-xs font-semibold text-emerald-600">
                Salvo.
              </p>
            )}
          </Bloco>
        </section>
      </div>
    </Pagina>
  );
}

function Campo({
  rotulo,
  valor,
  mono = false,
}: {
  rotulo: string;
  valor: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-tinta-400">
        {rotulo}
      </div>
      <div className={`mt-0.5 text-sm text-tinta-800 ${mono ? 'num' : ''}`}>
        {valor || <span className="text-tinta-300">—</span>}
      </div>
    </div>
  );
}

// --- Configuração da folha (flags + salário) ---
function ConfigFolhaBloco({
  data,
  funcionarioId,
}: {
  data: TFunc;
  funcionarioId: string;
}) {
  const qc = useQueryClient();
  const [clt, setClt] = useState(!!data.clt);
  const [carteira, setCarteira] = useState(!!data.carteiraAssinada);
  const [recebeAdto, setRecebeAdto] = useState(!!data.recebeAdiantamento);
  const [salario, setSalario] = useState(String(data.salarioBase ?? '0'));
  const [aReceber, setAReceber] = useState(data.valorAReceberFolha ?? '');
  const [valorAdto, setValorAdto] = useState(data.valorAdiantamento ?? '');
  const [comissao, setComissao] = useState(() =>
    opcaoComissao(data.valorPorVenda),
  );
  const [comissaoOutro, setComissaoOutro] = useState(() =>
    opcaoComissao(data.valorPorVenda) === 'outro'
      ? String(Number(data.valorPorVenda))
      : '',
  );
  const [ok, setOk] = useState(false);

  const valorPorVenda = comissao === 'outro' ? comissaoOutro : comissao;

  const salvar = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/funcionarios/${funcionarioId}`, {
          clt,
          carteiraAssinada: carteira,
          recebeAdiantamento: recebeAdto,
          salarioBase: Number(salario),
          // Só faz sentido para carteira assinada; sem ela, limpa.
          valorAReceberFolha: carteira ? aReceber : '',
          valorAdiantamento: recebeAdto ? valorAdto : '',
          valorPorVenda,
        })
      ).data,
    onSuccess: () => {
      setOk(true);
      qc.invalidateQueries({ queryKey: ['funcionario', funcionarioId] });
      setTimeout(() => setOk(false), 2000);
    },
  });

  return (
    <Bloco titulo="Configuração da folha" className="surgir surgir-2">
      <div className="space-y-3">
        <Marcador
          checked={clt}
          onChange={(v) => {
            setClt(v);
            if (!v) setCarteira(false);
          }}
        >
          Contratado como CLT
        </Marcador>
        <Marcador
          checked={carteira}
          disabled={!clt}
          onChange={setCarteira}
        >
          Carteira assinada — a contabilidade já desconta o adiantamento
        </Marcador>
        {clt && !carteira && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
            CLT com carteira ainda não assinada: o adiantamento do dia 25
            continua sendo descontado do saldo salarial. Marque “Carteira
            assinada” quando o registro sair.
          </p>
        )}
        {carteira && (
          <p className="rounded-xl border border-tinta-200 bg-tinta-50 px-3.5 py-2.5 text-xs leading-relaxed text-tinta-600">
            O salário oficial sai pela contabilidade. Preencha{' '}
            <strong>A receber na folha</strong> com o que a empresa paga por
            aqui — é esse valor que serve de base para o saldo salarial, no
            lugar do salário base. O adiantamento do dia 25 continua saindo dos
            40% do salário base.
          </p>
        )}
        <Marcador checked={recebeAdto} onChange={setRecebeAdto}>
          Recebe adiantamento no dia 25
        </Marcador>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-4 border-t border-tinta-100 pt-5">
        <div>
          <label className="rotulo">Salário base (R$)</label>
          <CampoDinheiro
            valor={salario}
            onChange={setSalario}
            className="campo w-40"
          />
        </div>
        {carteira && (
          <div>
            <label className="rotulo">A receber na folha (R$)</label>
            <CampoDinheiro
              valor={aReceber}
              onChange={setAReceber}
              placeholder="vazio = salário base"
              className="campo w-44"
            />
          </div>
        )}
        {recebeAdto && (
          <div>
            <label className="rotulo">Valor do dia 25 (R$)</label>
            <CampoDinheiro
              valor={valorAdto}
              onChange={setValorAdto}
              placeholder="vazio = 40% do salário base"
              className="campo w-40"
            />
          </div>
        )}
        <div>
          <label className="rotulo">Comissão por venda</label>
          <select
            value={comissao}
            onChange={(e) => setComissao(e.target.value)}
            className="campo w-48"
          >
            <option value="">Não comissiona</option>
            <option value="5">R$ 5,00 por venda</option>
            <option value="50">R$ 50,00 por venda</option>
            <option value="outro">Outro valor…</option>
          </select>
        </div>
        {comissao === 'outro' && (
          <div>
            <label className="rotulo">Valor por venda (R$)</label>
            <CampoDinheiro
              valor={comissaoOutro}
              onChange={setComissaoOutro}
              className="campo w-40"
            />
          </div>
        )}
        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        {ok && (
          <span className="text-xs font-semibold text-emerald-600">Salvo.</span>
        )}
      </div>
    </Bloco>
  );
}

function Marcador({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 text-sm ${
        disabled ? 'text-tinta-300' : 'cursor-pointer text-tinta-700'
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5 accent-brand-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

/** Qual opção do select representa o valor por venda salvo. */
function opcaoComissao(valor: string | null | undefined): string {
  const n = Number(valor ?? 0);
  if (!n) return '';
  if (n === 5) return '5';
  if (n === 50) return '50';
  return 'outro';
}

/** "AAAA-MM" do mês passado — é o mês trabalhado que a folha atual paga. */
function mesTrabalhadoPadrao(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// --- Vendas e horas extras do mês trabalhado ---
function VariaveisMesBloco({
  funcionarioId,
  variaveis,
  valorPorVendaPadrao,
  carteiraAssinada,
}: {
  funcionarioId: string;
  variaveis: VariavelMes[];
  valorPorVendaPadrao: string | null;
  carteiraAssinada: boolean;
}) {
  const qc = useQueryClient();
  const [competencia, setCompetencia] = useState(mesTrabalhadoPadrao());
  const [vendas, setVendas] = useState('');
  const [valorVenda, setValorVenda] = useState('');
  const [horasExtras, setHorasExtras] = useState('');
  const [observacao, setObservacao] = useState('');
  const [ok, setOk] = useState(false);

  const doMes = useMemo(
    () => variaveis.find((v) => v.competencia === competencia) ?? null,
    [variaveis, competencia],
  );

  // Trocar de mês carrega o que já estava lançado nele (ou limpa o formulário).
  useEffect(() => {
    setVendas(doMes && doMes.vendas ? String(doMes.vendas) : '');
    setValorVenda(doMes?.valorPorVenda ? String(Number(doMes.valorPorVenda)) : '');
    setHorasExtras(
      doMes && Number(doMes.horasExtras) ? String(Number(doMes.horasExtras)) : '',
    );
    setObservacao(doMes?.observacao ?? '');
  }, [doMes]);

  const salvar = useMutation({
    mutationFn: async () =>
      (
        await api.put(`/funcionarios/${funcionarioId}/variaveis`, {
          competencia,
          vendas: Number(vendas) || 0,
          valorPorVenda: valorVenda,
          horasExtras: carteiraAssinada ? 0 : Number(horasExtras) || 0,
          observacao,
        })
      ).data,
    onSuccess: () => {
      setOk(true);
      qc.invalidateQueries({ queryKey: ['funcionario', funcionarioId] });
      setTimeout(() => setOk(false), 2000);
    },
  });

  const remover = useMutation({
    mutationFn: async (comp: string) =>
      (await api.delete(`/funcionarios/${funcionarioId}/variaveis/${comp}`)).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['funcionario', funcionarioId] }),
  });

  const unitario = Number(valorVenda) || Number(valorPorVendaPadrao ?? 0);
  const comissaoPrevista = (Number(vendas) || 0) * unitario;

  return (
    <Bloco titulo="Vendas e horas extras do mês" className="surgir surgir-3">
      <p className="mb-4 text-xs leading-relaxed text-tinta-500">
        Lançamento por <strong>mês trabalhado</strong>: o que você registrar em{' '}
        <span className="num">{formatComp(competencia)}</span> entra no saldo
        salarial da folha do mês seguinte, detalhado na observação da conta a
        pagar.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="rotulo">Mês trabalhado</label>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo">Vendas no mês</label>
          <input
            type="number"
            min={0}
            value={vendas}
            onChange={(e) => setVendas(e.target.value)}
            placeholder="0"
            className="campo w-28"
          />
        </div>
        <div>
          <label className="rotulo">Valor por venda (R$)</label>
          <CampoDinheiro
            valor={valorVenda}
            onChange={setValorVenda}
            placeholder={
              valorPorVendaPadrao
                ? `padrão ${formatBRL(valorPorVendaPadrao)}`
                : 'sem padrão'
            }
            className="campo w-40"
          />
        </div>
        {!carteiraAssinada && (
          <div>
            <label className="rotulo">Horas extras (R$)</label>
            <CampoDinheiro
              valor={horasExtras}
              onChange={setHorasExtras}
              placeholder="0,00"
              className="campo w-36"
            />
          </div>
        )}
        <div className="min-w-[160px] flex-1">
          <label className="rotulo">Observação</label>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
          />
        </div>
        <button
          onClick={() => salvar.mutate()}
          disabled={salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar mês'}
        </button>
        {ok && (
          <span className="text-xs font-semibold text-emerald-600">Salvo.</span>
        )}
      </div>

      {carteiraAssinada && (
        <p className="mt-4 rounded-xl border border-tinta-200 bg-tinta-50 px-3.5 py-2.5 text-xs text-tinta-600">
          Carteira assinada: as horas extras saem pela contabilidade, então não
          entram no cálculo daqui.
        </p>
      )}
      {comissaoPrevista > 0 && (
        <p className="mt-4 text-sm text-tinta-600">
          Comissão de {formatComp(competencia)}:{' '}
          <strong className="valor text-[15px]">
            {formatBRL(comissaoPrevista)}
          </strong>{' '}
          <span className="num text-tinta-400">
            ({vendas} × {formatBRL(unitario)})
          </span>
        </p>
      )}

      {variaveis.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-xl ring-1 ring-tinta-100">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th !py-2">Mês</th>
                <th className="th !py-2 text-right">Vendas</th>
                <th className="th !py-2 text-right">Comissão</th>
                <th className="th !py-2 text-right">Horas extras</th>
                <th className="th !py-2"></th>
              </tr>
            </thead>
            <tbody>
              {variaveis.map((v) => {
                const unit = Number(v.valorPorVenda ?? valorPorVendaPadrao ?? 0);
                return (
                  <tr key={v.id} className="border-t border-tinta-100">
                    <td className="td num !py-2">{formatComp(v.competencia)}</td>
                    <td className="td num !py-2 text-right">{v.vendas}</td>
                    <td className="td !py-2 text-right">
                      <span className="valor text-[13px]">
                        {formatBRL(v.vendas * unit)}
                      </span>
                    </td>
                    <td className="td !py-2 text-right">
                      <span className="valor text-[13px]">
                        {formatBRL(v.horasExtras)}
                      </span>
                    </td>
                    <td className="td !py-2 text-right">
                      <button
                        onClick={() => remover.mutate(v.competencia)}
                        className="text-xs font-semibold text-rose-500 hover:underline"
                      >
                        remover
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Bloco>
  );
}

// --- Vales e acertos desta pessoa ---
function ValesBloco({ funcionarioId }: { funcionarioId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['vales', 'funcionario', funcionarioId],
    queryFn: async () =>
      (
        await api.get<ValeComSaldo[]>('/vales', {
          params: { funcionarioId, situacao: 'TODOS' },
        })
      ).data,
  });

  /*
   * O vale quitado sai da lista, pelo mesmo motivo do avulso já descontado: a
   * ficha responde "o que ainda pesa nesta pessoa". Quitado não pesa mais, e
   * ficava aqui só engordando a tabela — quem batia o olho somava saldos que
   * já não existiam. O cancelado fica, apagado: ele não foi pago, foi desfeito,
   * e sumir com ele esconderia a decisão de alguém.
   *
   * A história completa continua a um clique, em Vales e acertos.
   */
  const naFicha = (data ?? []).filter((v) => !v.quitado);
  const abertos = naFicha.filter((v) => !v.vale.cancelado);
  const quitados = (data ?? []).length - naFicha.length;

  return (
    <Bloco
      titulo="Vales e acertos"
      className="surgir surgir-4"
      acao={
        <Link
          to="/folha/vales"
          className="text-xs font-semibold text-brand-700 hover:underline"
        >
          Registrar
        </Link>
      }
    >
      {isLoading && <p className="text-sm text-tinta-400">Carregando…</p>}
      {data && naFicha.length === 0 && (
        <p className="text-sm text-tinta-400">
          {quitados > 0
            ? 'Nada em aberto — o que havia já foi quitado.'
            : 'Nenhum vale ou acerto registrado.'}
        </p>
      )}
      {naFicha.length > 0 && (
        <div className="overflow-hidden rounded-xl ring-1 ring-tinta-100">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th !py-2">Descrição</th>
                <th className="th !py-2 text-center">Parcela</th>
                <th className="th !py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {naFicha.map((v) => (
                <tr
                  key={v.vale.id}
                  className={`border-t border-tinta-100 ${
                    v.vale.cancelado ? 'opacity-45' : ''
                  }`}
                >
                  <td className="td !py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {v.vale.descricao}
                      <Selo tom={SENTIDO_TOM[v.vale.sentido]} pequeno>
                        {SENTIDO_CURTO[v.vale.sentido]}
                      </Selo>
                      {!v.vale.descontarDaFolha && (
                        <Selo pequeno>fora da folha</Selo>
                      )}
                    </div>
                  </td>
                  <td className="td num !py-2 text-center text-tinta-600">
                    {rotuloParcelaAtual(v)}
                  </td>
                  <td className="td !py-2 text-right">
                    <span className="valor text-[13px]">
                      {formatBRL(v.saldo)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(abertos.length > 0 || quitados > 0) && (
        <p className="mt-3 text-xs text-tinta-400">
          {abertos.length} em aberto
          {quitados > 0 &&
            ` · ${quitados} já quitado${quitados > 1 ? 's' : ''}, fora desta lista`}
        </p>
      )}
    </Bloco>
  );
}

// --- Lançamentos: fixos (todo mês) e avulsos (só numa competência) ---
function LancamentosBloco({
  funcionarioId,
  lancamentos,
}: {
  funcionarioId: string;
  lancamentos: Lancamento[];
}) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<TipoLancamento>('DESCONTO');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [competencia, setCompetencia] = useState('');
  /** null = o formulário está criando; id = está editando aquela linha. */
  const [editandoId, setEditandoId] = useState<string | null>(null);

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['funcionario', funcionarioId] });
  }

  function limpar() {
    setEditandoId(null);
    setTipo('DESCONTO');
    setDescricao('');
    setValor('');
    setCompetencia('');
  }

  /*
   * Editar é o mesmo formulário de baixo, não um formulário à parte.
   *
   * São os mesmos quatro campos, com as mesmas regras — repeti-los espremidos
   * dentro da linha da tabela seria manter duas cópias da mesma coisa, e a
   * segunda desalinha na primeira mudança. Em troca, a linha que está no
   * formulário fica marcada: formulário preenchido sem dono visível é como se
   * edita a linha errada.
   */
  function abrirEdicao(l: Lancamento) {
    setEditandoId(l.id);
    setTipo(l.tipo);
    setDescricao(l.descricao);
    setValor(l.valor);
    setCompetencia(l.competencia ?? '');
  }

  const corpo = () => ({
    tipo,
    descricao,
    valor: Number(valor),
    ...(competencia ? { competencia } : {}),
  });

  const adicionar = useMutation({
    mutationFn: async () =>
      (await api.post(`/funcionarios/${funcionarioId}/lancamentos`, corpo())).data,
    onSuccess: () => {
      limpar();
      invalidar();
    },
  });

  const salvar = useMutation({
    mutationFn: async () =>
      (await api.put(`/funcionarios/lancamentos/${editandoId}`, corpo())).data,
    onSuccess: () => {
      limpar();
      invalidar();
    },
  });

  const remover = useMutation({
    mutationFn: async (lancId: string) =>
      (await api.delete(`/funcionarios/lancamentos/${lancId}`)).data,
    onSuccess: (_dados, lancId) => {
      // Removida a linha que estava no formulário, ele fica sem dono.
      if (lancId === editandoId) limpar();
      invalidar();
    },
  });

  const editando = editandoId !== null;
  const incompleto = descricao.trim().length < 2 || Number(valor) <= 0;
  const emCurso = adicionar.isPending || salvar.isPending;
  /* A trava de mês fechado mora na API, que é quem sabe se a folha saiu. Sem
     mostrar o que ela respondeu, o botão não faz nada e não diz por quê. */
  const erro = adicionar.error ?? salvar.error ?? remover.error;

  return (
    <Bloco titulo="Lançamentos fixos e avulsos" className="surgir surgir-4">
      {/* Mesma régua do bloco de vendas: mês trabalhado. Um mês de trabalho é
          pago em dois pedaços, e é por isso que o mês do pagamento não serve
          de referência aqui. */}
      <p className="mb-4 text-xs leading-relaxed text-tinta-500">
        O mês é o <strong>trabalhado</strong>, como nas vendas — quem trabalhou
        em agosto recebe no dia 25 de agosto e no quinto dia de setembro, e o
        lançamento acompanha os dois. Deixe vazio para valer{' '}
        <strong>todo mês</strong>. Mês já fechado não aceita lançamento novo:
        ele não seria pago.
      </p>
      {lancamentos.length === 0 ? (
        <p className="mb-4 text-sm text-tinta-400">
          Nenhum lançamento. Bônus fixo entra todo mês; avulso, só no mês
          trabalhado escolhido.
        </p>
      ) : (
        <div className="mb-5 overflow-hidden rounded-xl ring-1 ring-tinta-100">
          <table className="w-full text-sm">
            <tbody>
              {lancamentos.map((l) => (
                <tr
                  key={l.id}
                  className={`border-t border-tinta-100 first:border-0 ${
                    l.id === editandoId ? 'bg-tinta-50' : ''
                  }`}
                >
                  <td className="td !py-2.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-tinta-400">
                      {TIPO_LABEL[l.tipo]}
                    </span>
                  </td>
                  <td className="td !py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {l.descricao}
                      <Selo tom={l.competencia ? 'atencao' : 'info'} pequeno>
                        {l.competencia
                          ? `avulso ${formatComp(l.competencia)}`
                          : 'fixo'}
                      </Selo>
                    </div>
                  </td>
                  <td className="td !py-2.5 text-right">
                    <span className="valor">{formatBRL(l.valor)}</span>
                  </td>
                  <td className="td !py-2.5 text-right">
                    <button
                      onClick={() =>
                        l.id === editandoId ? limpar() : abrirEdicao(l)
                      }
                      className="text-xs font-semibold text-tinta-500 hover:underline"
                    >
                      {l.id === editandoId ? 'cancelar' : 'editar'}
                    </button>
                  </td>
                  <td className="td !py-2.5 text-right">
                    <button
                      onClick={() => remover.mutate(l.id)}
                      className="text-xs font-semibold text-rose-500 hover:underline"
                    >
                      remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <p className="mb-3 text-xs font-semibold text-tinta-600">
          Editando o lançamento marcado acima.{' '}
          <button onClick={limpar} className="underline">
            cancelar
          </button>
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="rotulo">Tipo</label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoLancamento)}
            className="campo w-auto"
          >
            <option value="DESCONTO">Desconto</option>
            <option value="ADIANTAMENTO">Adiantamento</option>
            <option value="BONUS">Bônus</option>
          </select>
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="rotulo">Descrição</label>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: bônus técnico"
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo">Valor (R$)</label>
          <CampoDinheiro
            valor={valor}
            onChange={setValor}
            className="campo w-32"
          />
        </div>
        <div>
          <label className="rotulo">Mês trabalhado (vazio = todo mês)</label>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="campo"
          />
        </div>
        <button
          onClick={() => (editando ? salvar.mutate() : adicionar.mutate())}
          disabled={emCurso || incompleto}
          className={editando ? 'btn btn-primario' : 'btn btn-neutro'}
        >
          {editando ? (salvar.isPending ? 'Salvando…' : 'Salvar') : 'Adicionar'}
        </button>
      </div>

      {erro && <p className="mt-3 text-sm text-rose-600">{mensagemErro(erro)}</p>}
    </Bloco>
  );
}

function formatComp(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${m[2]}/${m[1]}` : comp;
}
