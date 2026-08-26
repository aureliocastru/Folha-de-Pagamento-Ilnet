import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarrasComparadas,
  BarrasEmpilhadas,
  PALETA,
  type SerieGrafico,
} from '../../components/graficos';
import {
  Bloco,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { mesAnterior, mesAtual, mesSeguinte, nomeDoMes } from '../../lib/folha';
import { formatBRL, formatData } from '../../lib/format';
import { STATUS_LABEL, STATUS_TOM, TIPO_LABEL } from '../../lib/status';
import type { Dashboard as TDashboard, TipoLancamento } from '../../lib/types';

/**
 * Qual mês de trabalho a tela abre mostrando: o anterior.
 *
 * O mês corrente é sempre incompleto aqui — a folha dele só vai ser paga no
 * começo do mês que vem. Abrir nele mostraria um custo perto de zero todo dia
 * 1º, e quem olha entenderia que a empresa parou de gastar.
 */
function mesTrabalhadoInicial(): string {
  return mesAnterior(mesAtual());
}

function formatComp(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${m[2]}/${m[1]}` : comp;
}

/** Quantos meses as séries cobrem. Um mês só vira leitura do mês fechado. */
const PERIODOS = [1, 3, 6, 12];

/** Do que a empresa gasta com gente — ordem fixa, do maior ao mais eventual. */
const SERIES_CUSTO: SerieGrafico[] = [
  { chave: 'folha', rotulo: 'Folha', cor: PALETA[0] },
  { chave: 'diaristas', rotulo: 'Diaristas', cor: PALETA[1] },
  { chave: 'encargos', rotulo: 'Encargos patronais', cor: PALETA[2] },
];

const SERIES_TIPO: SerieGrafico[] = [
  { chave: 'salario', rotulo: 'Salário', cor: PALETA[0] },
  { chave: 'ferias', rotulo: 'Férias', cor: PALETA[5] },
  { chave: 'adiantamento', rotulo: 'Adiantamento', cor: PALETA[1] },
  { chave: 'bonus', rotulo: 'Bônus', cor: PALETA[2] },
  { chave: 'diaria', rotulo: 'Diária', cor: PALETA[3] },
  { chave: 'avulso', rotulo: 'Avulso', cor: PALETA[4] },
];

/**
 * Mesma cor para o mesmo tipo em toda a tela: o bônus é azul na barra do mês e
 * azul na repartição. Cor segue a coisa, nunca a posição no ranking.
 *
 * Parcial porque este painel é o da folha: a despesa lançada à mão (energia,
 * aluguel) não é custo de folha e a API já a deixa de fora — se um dia chegar
 * aqui, sai em cinza em vez de derrubar a tela.
 */
const COR_DO_TIPO: Partial<Record<TipoLancamento, string>> = {
  SALARIO: PALETA[0],
  FERIAS: PALETA[5],
  ADIANTAMENTO: PALETA[1],
  BONUS: PALETA[2],
  DIARIA: PALETA[3],
  AVULSO: PALETA[4],
  DESCONTO: PALETA[4],
};

/** Cinza discreto para tipo sem cor própria nesta tela. */
const COR_SEM_TIPO = '#93A2BD';

const SERIES_IMPOSTO: SerieGrafico[] = [
  { chave: 'folhaPatronal', rotulo: 'Patronal (custo)', cor: PALETA[0] },
  { chave: 'folhaRetido', rotulo: 'Retido (repasse)', cor: PALETA[1] },
  { chave: 'faturamento', rotulo: 'Sobre faturamento', cor: PALETA[2] },
];

export function Dashboard() {
  const [competencia, setCompetencia] = useState(mesTrabalhadoInicial());
  const [meses, setMeses] = useState(12);
  /** Cartão cujo detalhamento está aberto (null = nenhum). */
  const [aberto, setAberto] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard', competencia, meses],
    queryFn: async () =>
      (
        await api.get<TDashboard>('/dashboard', {
          params: { competencia, meses },
        })
      ).data,
    // É a tela que fica aberta o dia todo, enquanto o dinheiro anda em outro
    // lugar (a auditoria do IXC, o retorno do banco). Voltar para ela relê os
    // números em vez de mostrar a foto de quando a aba foi aberta.
    refetchOnWindowFocus: true,
  });

  const f = data?.funcionarios;
  const folha = data?.folha;
  const vales = data?.vales;

  // Números do mês em foco, que é sobre o que os cartões falam.
  const custoDoMes = data?.custoPessoal.find((c) => c.competencia === competencia);
  const tiposDoMes = data?.serieTipos.find((t) => t.competencia === competencia);
  const diariasDoMes = data?.diaristas.serie.find(
    (d) => d.competencia === competencia,
  );
  const avulsosDoMes = data?.avulsos.serie.find(
    (a) => a.competencia === competencia,
  );
  const vendasDoMes = data?.vendas.serie.find(
    (v) => v.competencia === competencia,
  );
  const impostoDoMes = data?.impostos.serie.find(
    (i) => i.competencia === competencia,
  );
  const semGuia = (data?.impostos.guias.length ?? 0) === 0;

  /**
   * Os seis números do topo, cada um com o que o explica por dentro.
   *
   * O detalhe sai da letra miúda embaixo do valor e vira painel: cabia uma
   * linha, e o que responde "de onde vem esse número" nunca cabia em uma.
   */
  const cartoes: Cartao[] = [
    {
      chave: 'custo',
      rotulo: `Custo com pessoal em ${formatComp(competencia)}`,
      valor: custoDoMes?.total ?? 0,
      acento: true,
      nota: 'Tudo que a empresa gastou com gente neste mês trabalhado — é a soma dos outros cartões. O INSS descontado do trabalhador fica fora: é dinheiro dele passando pela conta da empresa.',
      linhas: [
        { rotulo: 'Salário', valor: tiposDoMes?.salario ?? 0 },
        { rotulo: 'Adiantamento do dia 25', valor: tiposDoMes?.adiantamento ?? 0 },
        { rotulo: 'Bônus', valor: tiposDoMes?.bonus ?? 0 },
        { rotulo: 'Pagamentos avulsos', valor: tiposDoMes?.avulso ?? 0 },
        { rotulo: 'Diárias', valor: diariasDoMes?.valor ?? 0 },
        { rotulo: 'Encargos patronais', valor: impostoDoMes?.folhaPatronal ?? 0 },
      ],
    },
    {
      chave: 'diaristas',
      rotulo: 'Gasto com diaristas',
      valor: diariasDoMes?.valor ?? 0,
      alerta:
        diariasDoMes && diariasDoMes.aCaminho > 0
          ? `${formatBRL(diariasDoMes.aCaminho)} lançado, esperando o banco`
          : undefined,
      nota: 'Quem trabalha por dia, pelo dia em que trabalhou.',
      linhas: [
        { rotulo: 'Já saiu do caixa', valor: diariasDoMes?.pago ?? 0 },
        { rotulo: 'Lançado, esperando o banco', valor: diariasDoMes?.aCaminho ?? 0 },
        {
          rotulo: 'Travado no IXC (fora do gasto)',
          valor: diariasDoMes?.travado ?? 0,
          nota: diariasDoMes?.travadas
            ? `${diariasDoMes.travadas} diária(s) com a conta reprovada, recusada ou apagada`
            : undefined,
        },
        {
          rotulo: 'Diárias trabalhadas',
          contagem: `${diariasDoMes?.quantidade ?? 0} diária(s) · ${diariasDoMes?.pessoas ?? 0} pessoa(s)`,
        },
      ],
    },
    {
      chave: 'vendas',
      rotulo: 'Gasto com vendas',
      valor: vendasDoMes?.total ?? 0,
      nota: 'Comissão de quem vende: funcionário (dentro do salário), diarista e avulso (junto do pagamento). Conta o que ficou gravado no pagamento, e só depois que ele saiu.',
      // O que foi lançado e ainda não saiu não entra no número, e também não
      // pode sumir: é venda que a empresa já deve, e quem lançou precisa saber
      // que ela está ali esperando aprovação.
      alerta:
        data && data.vendas.aCaminho.vendas > 0
          ? `${data.vendas.aCaminho.vendas} venda(s), ${formatBRL(data.vendas.aCaminho.comissao)} de comissão esperando o pagamento sair`
          : undefined,
      linhas: [
        { rotulo: 'Dentro da folha', valor: vendasDoMes?.funcionarios ?? 0 },
        { rotulo: 'A diaristas e avulsos', valor: vendasDoMes?.foraDaFolha ?? 0 },
        {
          rotulo: 'Vendas no mês',
          contagem: `${vendasDoMes?.vendas ?? 0} venda(s)`,
        },
      ],
    },
    {
      chave: 'avulsos',
      rotulo: 'Pagamentos avulsos',
      valor: avulsosDoMes?.valor ?? 0,
      alerta:
        avulsosDoMes && avulsosDoMes.aCaminho > 0
          ? `${formatBRL(avulsosDoMes.aCaminho)} lançado, esperando o banco`
          : undefined,
      nota: 'Quem recebe sem estar na folha nem ser diarista — serviço pontual, patrocínio, ajuda de custo.',
      linhas: [
        { rotulo: 'Já saiu do caixa', valor: avulsosDoMes?.pago ?? 0 },
        { rotulo: 'Lançado, esperando o banco', valor: avulsosDoMes?.aCaminho ?? 0 },
        { rotulo: 'Travado no IXC (fora do gasto)', valor: avulsosDoMes?.travado ?? 0 },
        {
          rotulo: 'Pagamentos',
          contagem: `${avulsosDoMes?.quantidade ?? 0} pagamento(s) · ${avulsosDoMes?.pessoas ?? 0} pessoa(s)`,
        },
      ],
    },
    {
      chave: 'bonus',
      rotulo: 'Bônus pago',
      valor: tiposDoMes?.bonus ?? 0,
      nota: 'O bônus é um pagamento à parte do salário, e na empresa também conta como salário.',
      linhas: [
        { rotulo: 'Pago neste mês', valor: tiposDoMes?.bonus ?? 0 },
        {
          rotulo: 'Bônus fixos no cadastro',
          valor: f?.bonusFixoMensal ?? 0,
          nota:
            (f?.bonusFixoMensal ?? 0) > 0
              ? 'entram em toda folha, sem precisar lançar'
              : 'ninguém tem bônus fixo cadastrado',
        },
      ],
    },
    {
      chave: 'encargos',
      rotulo: 'Encargos patronais',
      valor: impostoDoMes?.folhaPatronal ?? 0,
      alerta: semGuia ? 'nenhuma guia lançada' : undefined,
      nota: 'Só o patronal é custo da empresa: FGTS e a parte patronal do INSS. O retido é do trabalhador, e o de faturamento não tem a ver com gente.',
      linhas: [
        { rotulo: 'Patronal (custo da empresa)', valor: impostoDoMes?.folhaPatronal ?? 0 },
        {
          rotulo: 'Retido do trabalhador (repasse)',
          valor: impostoDoMes?.folhaRetido ?? 0,
          nota: 'fica fora do custo com pessoal de propósito',
        },
        { rotulo: 'Sobre faturamento', valor: impostoDoMes?.faturamento ?? 0 },
        {
          rotulo: 'Guias lançadas no período',
          contagem: `${data?.impostos.guias.length ?? 0} guia(s)`,
        },
      ],
    },
  ];
  const cartaoAberto = cartoes.find((c) => c.chave === aberto);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Dashboard"
        titulo={`Trabalho de ${nomeDoMes(competencia)}`}
        descricao={`Quanto custou o mês trabalhado. A folha dele sai no começo de ${nomeDoMes(mesSeguinte(competencia))} — os valores aparecem aqui, no mês que eles pagaram. Diárias e pagamentos avulsos entram pelo dia em que saíram.`}
        acoes={
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="rotulo" htmlFor="competencia">
                Mês trabalhado
              </label>
              <input
                id="competencia"
                type="month"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                className="campo"
              />
            </div>
            <div>
              <span className="rotulo">Histórico</span>
              <div className="flex gap-1 rounded-xl bg-tinta-100 p-1">
                {PERIODOS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setMeses(n)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      meses === n
                        ? 'bg-papel text-tinta-800 shadow-aba'
                        : 'text-tinta-500 hover:text-tinta-700'
                    }`}
                  >
                    {n === 1 ? '1 mês' : `${n} meses`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        }
      />

      {isError && (
        <div className="card p-6 text-sm text-rose-600">
          {mensagemErro(error)}
        </div>
      )}
      {isLoading && (
        <div className="card">
          <Carregando />
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="surgir surgir-1 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cartoes.map((c) => (
              <Indicador
                key={c.chave}
                acento={c.acento}
                rotulo={c.rotulo}
                valor={formatBRL(c.valor)}
                alerta={c.alerta}
                aberto={aberto === c.chave}
                onClick={() =>
                  setAberto(aberto === c.chave ? null : c.chave)
                }
              />
            ))}
          </div>

          {cartaoAberto && (
            <DetalheDoCartao
              cartao={cartaoAberto}
              onFechar={() => setAberto(null)}
            />
          )}

          <div className="surgir surgir-2 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Bloco
              titulo={
                meses === 1
                  ? 'Custo com pessoal no mês'
                  : `Custo com pessoal — ${meses} meses`
              }
              className="lg:col-span-2"
            >
              <BarrasEmpilhadas
                meses={data.custoPessoal}
                series={SERIES_CUSTO}
                atual={competencia}
              />
              <p className="mt-3 text-xs leading-relaxed text-tinta-400">
                O INSS descontado do trabalhador fica fora: é dinheiro dele
                passando pela conta da empresa, e somar aqui contaria o mesmo
                salário duas vezes.
              </p>
            </Bloco>

            <Bloco titulo={`Para onde foi em ${formatComp(competencia)}`}>
              {folha && folha.porTipo.length > 0 ? (
                <BarrasComparadas
                  itens={folha.porTipo
                    .filter((t) => t.valor > 0)
                    .map((t) => ({
                      rotulo: TIPO_LABEL[t.tipo],
                      valor: t.valor,
                      cor: COR_DO_TIPO[t.tipo] ?? COR_SEM_TIPO,
                      detalhe: `${t.quantidade}×`,
                    }))}
                />
              ) : (
                <Vazio titulo="Nada gerado nesta competência">
                  Quando você calcular a folha, a repartição aparece aqui.{' '}
                  <Link
                    to="/folha/gerar-folha"
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    Gerar folha
                  </Link>
                </Vazio>
              )}
            </Bloco>
          </div>

          <div className="surgir surgir-3 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Bloco titulo="O que a folha pagou, mês a mês">
              <BarrasEmpilhadas
                meses={data.serieTipos}
                series={SERIES_TIPO}
                atual={competencia}
                altura="h-48"
              />
            </Bloco>

            <Bloco
              titulo="Impostos"
              acao={
                <Link
                  to="/folha/impostos"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  Lançar guia
                </Link>
              }
            >
              {semGuia ? (
                <Vazio titulo="Nenhuma guia lançada">
                  Suba o PDF do DARF, do FGTS, do DAS ou do DARE que a
                  contabilidade manda e o imposto entra aqui.{' '}
                  <Link
                    to="/folha/impostos"
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    Lançar a primeira
                  </Link>
                </Vazio>
              ) : (
                <>
                  <BarrasEmpilhadas
                    meses={data.impostos.serie}
                    series={SERIES_IMPOSTO}
                    atual={competencia}
                    altura="h-48"
                  />
                  <p className="mt-3 text-xs leading-relaxed text-tinta-400">
                    Só o patronal é custo da empresa. O retido é do trabalhador,
                    e o de faturamento não tem a ver com gente.
                  </p>
                </>
              )}
            </Bloco>
          </div>

          <div className="surgir surgir-3 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Bloco titulo="Diaristas">
              <BarrasEmpilhadas
                meses={data.diaristas.serie}
                series={[
                  { chave: 'valor', rotulo: 'Diárias', cor: PALETA[1] },
                ]}
                atual={competencia}
                altura="h-40"
              />
            </Bloco>

            <Bloco titulo={`Situação em ${formatComp(competencia)}`}>
              {folha && folha.porStatus.length > 0 ? (
                <div className="space-y-2.5">
                  {folha.porStatus.map((s) => (
                    <div
                      key={s.status}
                      className="flex items-center justify-between gap-3"
                    >
                      <Selo tom={STATUS_TOM[s.status]} ponto>
                        {STATUS_LABEL[s.status]}
                      </Selo>
                      <div className="flex items-baseline gap-3">
                        <span className="text-xs text-tinta-400">
                          {s.quantidade}
                        </span>
                        <span className="valor text-sm">
                          {formatBRL(s.valor)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Vazio titulo="Nada gerado nesta competência" />
              )}
            </Bloco>

            <Bloco
              titulo="Vales e acertos"
              acao={
                <Link
                  to="/folha/vales"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  Ver todos
                </Link>
              }
            >
              <div className="space-y-3">
                <SaldoVale
                  rotulo="Funcionários devem"
                  valor={formatBRL(vales?.saldoDevedor)}
                  tom="text-amber-700"
                />
                <SaldoVale
                  rotulo="Empresa deve"
                  valor={formatBRL(vales?.saldoAPagar)}
                  tom="text-emerald-700"
                />
                <div className="border-t border-tinta-100 pt-3">
                  <Linha
                    rotulo={`Desconta em ${formatComp(competencia)}`}
                    valor={formatBRL(vales?.descontoNaCompetencia)}
                  />
                  <Linha
                    rotulo={`Paga a mais em ${formatComp(competencia)}`}
                    valor={formatBRL(vales?.creditoNaCompetencia)}
                  />
                  <Linha
                    rotulo="Vales em aberto"
                    valor={String(vales?.valesEmAberto ?? 0)}
                  />
                </div>
              </div>
            </Bloco>
          </div>

          <div className="surgir surgir-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Bloco titulo="Pontos de atenção">
              <ul className="space-y-3">
                <Atencao
                  ok={(f?.semPix ?? 0) === 0}
                  para="/funcionarios"
                  texto={
                    (f?.semPix ?? 0) === 0
                      ? 'Todo mundo ativo tem chave PIX.'
                      : `${f?.semPix} pessoa(s) ativa(s) sem chave PIX — o pagamento não sai.`
                  }
                />
                <Atencao
                  ok={(folha?.comErro ?? 0) === 0}
                  para="/contas-pagar"
                  texto={
                    (folha?.comErro ?? 0) === 0
                      ? 'Nenhuma conta com erro no IXC.'
                      : `${formatBRL(folha?.comErro)} em contas que o IXC recusou — reenvie.`
                  }
                />
                <Atencao
                  ok={(folha?.emAberto ?? 0) === 0}
                  para="/contas-pagar"
                  texto={
                    (folha?.emAberto ?? 0) === 0
                      ? 'Nada pendente nesta competência.'
                      : `${formatBRL(folha?.emAberto)} esperando aprovação ou pagamento.`
                  }
                />
                <Atencao
                  ok={(diariasDoMes?.travadas ?? 0) === 0}
                  para="/diaristas"
                  texto={
                    (diariasDoMes?.travadas ?? 0) === 0
                      ? 'Nenhuma diária parada no meio do caminho.'
                      : `${diariasDoMes?.travadas} diária(s) com a conta a pagar reprovada, recusada ou apagada no IXC — fora do gasto do mês.`
                  }
                />
                <Atencao
                  ok={!semGuia}
                  para="/impostos"
                  texto={
                    semGuia
                      ? 'Nenhuma guia de imposto lançada — o custo com pessoal está incompleto.'
                      : `${data.impostos.guias.length} guia(s) lançada(s) no período.`
                  }
                />
              </ul>
              {data.ultimoSync && (
                <p className="mt-5 border-t border-tinta-100 pt-4 text-xs text-tinta-400">
                  Última sincronização com o IXC em{' '}
                  {formatData(
                    data.ultimoSync.concluidoEm ?? data.ultimoSync.iniciadoEm,
                  )}{' '}
                  · {data.ultimoSync.recurso} · {data.ultimoSync.totalLidos}{' '}
                  registro(s)
                </p>
              )}
            </Bloco>

            <Bloco titulo="Últimos lançamentos" className="lg:col-span-2" semPadding>
              {data.ultimasContas.length === 0 ? (
                <Vazio titulo="Nenhuma conta a pagar ainda">
                  Comece pela tela Gerar Folha.
                </Vazio>
              ) : (
                <div className="overflow-x-auto rolagem-fina">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-tinta-200">
                        <th className="th">Beneficiário</th>
                        <th className="th">Tipo</th>
                        <th className="th">Competência</th>
                        <th className="th">Situação</th>
                        <th className="th text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ultimasContas.map((c) => (
                        <tr key={c.id} className="linha">
                          <td className="td font-medium text-tinta-800">
                            {c.beneficiarioNome}
                          </td>
                          <td className="td text-tinta-500">
                            {TIPO_LABEL[c.tipo]}
                          </td>
                          <td className="td num text-tinta-500">
                            {c.competencia ? formatComp(c.competencia) : '—'}
                          </td>
                          <td className="td">
                            <Selo tom={STATUS_TOM[c.status]}>
                              {STATUS_LABEL[c.status]}
                            </Selo>
                          </td>
                          <td className="td text-right">
                            <span className="valor">{formatBRL(c.valor)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Bloco>
          </div>
        </div>
      )}
    </Pagina>
  );
}

/** Uma linha do detalhamento: ou um valor em reais, ou uma contagem. */
interface LinhaDetalhe {
  rotulo: string;
  valor?: number;
  /** Texto no lugar do valor, para o que não é dinheiro (quantidades). */
  contagem?: string;
  nota?: string;
}

interface Cartao {
  chave: string;
  rotulo: string;
  valor: number;
  acento?: boolean;
  alerta?: string;
  /** Uma frase dizendo o que aquele número é. */
  nota: string;
  linhas: LinhaDetalhe[];
}

/**
 * O que há dentro de um número do topo.
 *
 * Cada linha some quando é zero e não tem o que explicar — a lista completa de
 * zeros diria menos do que o cartão já diz. Sobrando nenhuma, a frase do topo
 * responde sozinha.
 */
function DetalheDoCartao({
  cartao,
  onFechar,
}: {
  cartao: Cartao;
  onFechar: () => void;
}) {
  const linhas = cartao.linhas.filter(
    (l) => l.contagem !== undefined || (l.valor ?? 0) !== 0 || l.nota,
  );

  return (
    <Bloco
      titulo={cartao.rotulo}
      className="surgir"
      acao={
        <button onClick={onFechar} className="btn btn-sutil btn-p">
          Fechar
        </button>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-tinta-500">{cartao.nota}</p>

      {linhas.length > 0 && (
        <div className="lista-dividida">
          {linhas.map((l) => (
            <div
              key={l.rotulo}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
            >
              <div>
                <span className="text-sm text-tinta-700">{l.rotulo}</span>
                {l.nota && (
                  <div className="text-xs text-tinta-400">{l.nota}</div>
                )}
              </div>
              <span className="valor text-[15px]">
                {l.contagem ?? formatBRL(l.valor ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between gap-4 border-t-2 border-tinta-200 pt-3">
        <span className="text-sm font-semibold text-tinta-800">Total</span>
        <span className="valor font-display text-xl">
          {formatBRL(cartao.valor)}
        </span>
      </div>
    </Bloco>
  );
}

function SaldoVale({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: string;
  tom: string;
}) {
  return (
    <div>
      <p className="text-xs text-tinta-400">{rotulo}</p>
      <p className={`font-display text-xl font-semibold num ${tom}`}>{valor}</p>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-tinta-500">{rotulo}</span>
      <span className="num font-medium text-tinta-800">{valor}</span>
    </div>
  );
}

function Atencao({
  ok,
  texto,
  para,
}: {
  ok: boolean;
  texto: string;
  para: string;
}) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
          ok ? 'bg-emerald-500' : 'bg-amber-500'
        }`}
      >
        {ok ? '✓' : '!'}
      </span>
      {ok ? (
        <span className="text-tinta-500">{texto}</span>
      ) : (
        <Link
          to={para}
          className="text-tinta-700 underline decoration-tinta-200 underline-offset-4 hover:decoration-tinta-400"
        >
          {texto}
        </Link>
      )}
    </li>
  );
}
