import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconeCalculo } from '../../components/icones';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  FotoAmpliada,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { CalculadoraDaGaveta } from './CalculadoraDaGaveta';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { reduzirFoto } from '../../lib/foto';
import { formatBRL, formatData } from '../../lib/format';
import type {
  CaixasDoFechamento,
  CategoriaDespesa,
  ContaDaRua,
  ExtratoDoCaixa,
  ItemDoHistorico,
  LancamentoDoCaixa,
  MovimentoLancado,
  SaidaAtrasada,
  TipoMovimentoDaRua,
} from '../../lib/types';

/** Uma nota de lançamento: a foto tirada, ou o recibo que o diarista assinou. */
interface NotaDoLancamento {
  id: string;
  createdAt: string;
  tipo: 'FOTO' | 'RECIBO';
  diariaId: string | null;
}

/** As abas da tela, no modelo da do IXC. */
type AbaDoCaixa = 'caixa' | 'conferir' | 'revisados' | 'historico';

/** Um fornecedor do IXC, como a busca desta tela o devolve. */
interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

/** Um fechamento já assinado, do jeito que o extrato o entrega. */
type FechamentoDoPeriodo = ExtratoDoCaixa['fechamentos'][number];

/** "AAAA-MM-DD" do dia local de um instante vindo do servidor. */
function diaDoISO(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Hoje, em "AAAA-MM-DD". */
function diaDeHoje(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** O dia anterior a um "AAAA-MM-DD", também em "AAAA-MM-DD". */
function diaAnterior(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  const p = (n: number) => String(n).padStart(2, '0');
  const s = new Date(a, m - 1, d - 1);
  return `${s.getFullYear()}-${p(s.getMonth() + 1)}-${p(s.getDate())}`;
}

/** O dia seguinte a um "AAAA-MM-DD", também em "AAAA-MM-DD". */
function diaSeguinte(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  const p = (n: number) => String(n).padStart(2, '0');
  const s = new Date(a, m - 1, d + 1);
  return `${s.getFullYear()}-${p(s.getMonth() + 1)}-${p(s.getDate())}`;
}

/**
 * Hoje dos dois lados, que é o recorte de quem bate o caixa todo dia.
 *
 * Era o mês corrente, e o mês corrente atropela o último fechamento assim que
 * ele termina no meio do mês — a tela abria pedindo um período que já estava
 * conferido pela metade. Quem quiser olhar a semana muda a data à mão.
 */
function hojeAteHoje(): { de: string; ate: string } {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { de: iso, ate: iso };
}

/**
 * Bater o caixa do dinheiro em mãos.
 *
 * A tela existe para substituir a folha de papel: as saídas do período vêm do
 * IXC, cada uma é conferida e ganha a foto da nota, e o que saiu com alguém e
 * ainda não voltou fica declarado — sem isso a contagem nunca fecha e a
 * explicação vive na memória de quem entregou.
 */
export function FechamentoCaixa() {
  const [caixaId, setCaixaId] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState(hojeAteHoje);

  const caixas = useQuery({
    queryKey: ['caixa', 'caixas'],
    queryFn: async () =>
      (await api.get<CaixasDoFechamento>('/caixa/caixas')).data,
  });

  // O caixa do dinheiro em mãos já vem escolhido: é ele que se bate quase
  // sempre, e quem quiser outro troca no seletor.
  useEffect(() => {
    if (caixaId === null && caixas.data) {
      setCaixaId(caixas.data.emUso ?? caixas.data.caixas[0]?.id ?? null);
    }
  }, [caixas.data, caixaId]);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Fechamento de Caixa"
        titulo="Bater o caixa"
        descricao="As saídas do período, uma a uma, com a foto da nota no lugar do papel. O que está na rua com alguém entra na conta."
      />

      <Bloco titulo="Que caixa, e de quando até quando" className="surgir mb-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="rotulo" htmlFor="caixa">
              Caixa
            </label>
            <select
              id="caixa"
              className="campo"
              value={caixaId ?? ''}
              disabled={caixas.isLoading}
              onChange={(e) => setCaixaId(Number(e.target.value) || null)}
            >
              <option value="">
                {caixas.isLoading ? 'lendo do IXC…' : 'Escolha o caixa'}
              </option>
              {(caixas.data?.caixas ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.id === caixas.data?.emUso ? ' — dinheiro em mãos' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="rotulo" htmlFor="de">
              De
            </label>
            <input
              id="de"
              type="date"
              className="campo"
              value={periodo.de}
              onChange={(e) =>
                setPeriodo((p) => ({ ...p, de: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="ate">
              Até
            </label>
            <input
              id="ate"
              type="date"
              className="campo"
              value={periodo.ate}
              onChange={(e) =>
                setPeriodo((p) => ({ ...p, ate: e.target.value }))
              }
            />
          </div>
        </div>

        {caixas.isError && (
          <p className="mt-3 text-sm text-rose-600">
            {mensagemErro(caixas.error)}
          </p>
        )}
        {caixas.data && caixas.data.caixas.length === 0 && (
          <p className="ajuda mt-3">
            Nenhum caixa veio do IXC. Confira em Configurações a tabela de
            contas de caixa.
          </p>
        )}
      </Bloco>

      {caixaId && periodo.de && periodo.ate ? (
        <Conferencia caixaId={caixaId} de={periodo.de} ate={periodo.ate} />
      ) : (
        <Vazio titulo="Escolha o caixa e o período">
          A conferência aparece aqui.
        </Vazio>
      )}
    </Pagina>
  );
}

function Conferencia({
  caixaId,
  de,
  ate,
}: {
  caixaId: number;
  de: string;
  ate: string;
}) {
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<AbaDoCaixa>('caixa');
  /** A calculadora da gaveta, aberta por cima de qualquer aba. */
  const [contando, setContando] = useState(false);
  /*
   * Dar por conferido é de ADMIN.
   *
   * A conferência é a assinatura de quem responde pelo caixa — quem opera o
   * dia a dia lança, fotografa e presta contas. O servidor recusa de todo
   * jeito; aqui o botão some, em vez de existir para dar erro.
   */
  const podeConferir = usuario?.role === 'ADMIN';
  /*
   * A lista abre nas saídas.
   *
   * Um caixa de provedor recebe muito mais do que paga — 109 recebimentos de
   * cliente para 52 saídas, no primeiro mês desta tela. Os recebimentos entram
   * no saldo e por isso continuam à mão, mas quem vem bater o caixa vem olhar
   * o que saiu: é disso que se pede nota, e é isso que o fechamento cobra.
   */
  const [soSaidas, setSoSaidas] = useState(true);

  const extrato = useQuery({
    queryKey: ['caixa', 'extrato', caixaId, de, ate],
    queryFn: async () =>
      (
        await api.get<ExtratoDoCaixa>(`/caixa/${caixaId}/extrato`, {
          params: { de, ate },
        })
      ).data,
  });

  const chaveDoExtrato = ['caixa', 'extrato', caixaId, de, ate];

  function recarregar() {
    setErro(null);
    void qc.invalidateQueries({ queryKey: ['caixa', 'extrato'] });
  }

  /**
   * Marcar um lançamento mexe só naquele lançamento, no cache.
   *
   * Antes disto cada clique invalidava o extrato inteiro, e o extrato é uma
   * leitura do IXC: conferir os 52 do mês custava 52 releituras da conta lá,
   * com a tela piscando em cada uma. O servidor já guardou a marca — o que
   * falta é a tela concordar com ele.
   */
  function marcarNoCache(idLancamento: number, conferido: boolean) {
    setErro(null);
    qc.setQueryData<ExtratoDoCaixa>(chaveDoExtrato, (atual) => {
      if (!atual) return atual;
      const lancamentos = atual.lancamentos.map((l) =>
        l.id === idLancamento ? { ...l, conferido } : l,
      );
      const conferidos = lancamentos.filter((l) => l.conferido).length;
      const saidasConferidas = lancamentos.filter(
        (l) => l.tipo === 'SAIDA' && l.conferido,
      ).length;
      return {
        ...atual,
        lancamentos,
        resumo: { ...atual.resumo, conferidos, saidasConferidas },
      };
    });
  }

  /** A foto entrou ou saiu: mesma ideia, sem reler o IXC. */
  function marcarNotaNoCache(idLancamento: number, qtdNotas: number) {
    setErro(null);
    qc.setQueryData<ExtratoDoCaixa>(chaveDoExtrato, (atual) =>
      atual
        ? {
            ...atual,
            lancamentos: atual.lancamentos.map((l) =>
              l.id === idLancamento ? { ...l, qtdNotas } : l,
            ),
          }
        : atual,
    );
  }

  const fechar = useMutation({
    mutationFn: async (dados: {
      observacao: string;
      saldoInicial?: number;
      saldoContado?: number;
    }) =>
      (
        await api.post('/caixa/fechar', {
          caixaId,
          de,
          ate,
          observacao: dados.observacao,
          saldoInicial: dados.saldoInicial,
          saldoContado: dados.saldoContado,
        })
      ).data,
    onSuccess: () => {
      recarregar();
      // Fechado, o período deixa de ser trabalho e vira registro: a tela leva
      // para onde ele passa a viver.
      setAba('historico');
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  if (extrato.isLoading) return <Carregando texto="Lendo o caixa no IXC…" />;
  if (extrato.isError) {
    return <Aviso tom="erro">{mensagemErro(extrato.error)}</Aviso>;
  }
  if (!extrato.data) return null;

  const { lancamentos, atrasados, naRua, resumo, fechamentos } = extrato.data;
  const faltam = resumo.qtdSaidas - resumo.saidasConferidas;
  const qtdSaidas = resumo.qtdSaidas;
  const qtdEntradas = lancamentos.length - qtdSaidas;
  const visiveis = soSaidas
    ? lancamentos.filter((l) => l.tipo === 'SAIDA')
    : lancamentos;
  /*
   * Duas áreas, e não uma coluna de marcados no meio da lista.
   *
   * A fila de cima é o que falta olhar; a de baixo, o que já passou. O que foi
   * revisado sai da frente em vez de virar uma linha apagada no meio das
   * outras — numa conferência de cinquenta saídas, achar a próxima é o gesto
   * que mais se repete, e ele fica mais curto a cada OK.
   */
  const aConferir = visiveis.filter((l) => !l.conferido);
  const revisados = visiveis.filter((l) => l.conferido);

  /*
   * O período pedido começa dentro de um que já foi fechado.
   *
   * É o estado em que a tela mais erra sozinha: ela abre no mês corrente, e um
   * fechamento que terminou no meio do mês faz o recorte padrão invadi-lo. Sem
   * distinguir isto de "nunca foi fechado", ela pedia o saldo inicial como se
   * fosse o primeiro de todos — e fechar assim recontaria dias já conferidos.
   */
  const invadeFechado =
    resumo.fechadoAte && de <= resumo.fechadoAte ? resumo.fechadoAte : null;

  /*
   * Dias entre o último fechamento e o início deste período.
   *
   * Não é erro — dá para olhar só uma sexta-feira sem querer fechá-la. Vira
   * erro na hora de fechar: o saldo inicial vem do fechamento anterior, e ele
   * não contém o movimento dos dias pulados. Fechar assim herdaria um saldo
   * que já não valia.
   */
  const buracoDesde =
    resumo.fechadoAte && de > diaSeguinte(resumo.fechadoAte)
      ? diaSeguinte(resumo.fechadoAte)
      : null;

  return (
    <>
      {/*
        As abas, no modelo da tela do IXC.

        Antes tudo vivia numa página só: os indicadores, o dinheiro na rua, a
        fila de conferir, os revisados e os fechamentos, um embaixo do outro.
        Conferir cinquenta saídas com o resto empurrando a lista para baixo é
        rolagem que não termina — e o que se faz numa aba não é o que se faz na
        outra: quem confere não está fechando o caixa, e quem procura um
        pagamento antigo não está conferindo nada.
      */}
      <Abas
        atual={aba}
        onTrocar={setAba}
        abas={[
          { id: 'caixa', rotulo: 'Caixa' },
          {
            id: 'conferir',
            rotulo: 'A conferir',
            selo: aConferir.length + atrasados.length || undefined,
          },
          { id: 'revisados', rotulo: 'Revisados', selo: revisados.length || undefined },
          { id: 'historico', rotulo: 'Histórico' },
        ]}
        acao={
          /*
           * Fora das abas, e não dentro de uma delas: contar a gaveta e dar
           * troco acontecem a qualquer hora do dia — no meio da conferência,
           * antes de fechar, ou sem nada disso. O ícone vem em âmbar, que
           * nesta tela não é usado em mais nada: é o botão que se procura com
           * o dinheiro na mão.
           */
          <button
            type="button"
            onClick={() => setContando(true)}
            className="btn btn-p btn-neutro gap-1.5"
            title="Conta as cédulas e moedas e compara com o esperado"
          >
            <IconeCalculo className="h-4 w-4 text-amber-500" />
            Contar a gaveta
          </button>
        }
      />

      {contando && (
        <CalculadoraDaGaveta
          caixaId={caixaId}
          esperado={resumo.saldoEsperado}
          onFechar={() => setContando(false)}
        />
      )}

      {erro && (
        <div className="mb-4">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}

      {aba === 'caixa' && (
        <>
          <div className="surgir surgir-1 mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Indicador
              rotulo="Saídas do período"
              valor={formatBRL(resumo.saidas)}
              detalhe={qtdSaidas === 1 ? '1 saída' : `${qtdSaidas} saídas`}
              acento
            />
            <Indicador
              rotulo="Entradas"
              valor={formatBRL(resumo.entradas)}
              detalhe={
                qtdEntradas === 0
                  ? 'nenhuma no período'
                  : qtdEntradas === 1
                    ? '1 entrada — reforço, devolução ou troco'
                    : `${qtdEntradas} entradas — reforço, devolução ou troco`
              }
            />
            {/*
              O que a gaveta deve ter agora — e não o que o recorte diz.

              Este é o único número da tela que não segue o "De": ele conta do
              último fechamento até aqui, passando por cima dos dias que
              ficaram fora do filtro. Se seguisse o recorte, mudaria de valor a
              cada data escolhida, e nenhuma das versões seria o dinheiro que
              está na gaveta. Por isso o detalhe diz desde quando ele conta.
            */}
            <Indicador
              rotulo="Saldo esperado na gaveta"
              valor={
                resumo.saldoEsperado === null
                  ? '—'
                  : formatBRL(resumo.saldoEsperado)
              }
              detalhe={
                resumo.saldoEsperado !== null && resumo.gavetaDesde
                  ? `de ${formatBRL(resumo.saldoInicial ?? 0)}, contando desde ${formatData(resumo.gavetaDesde)}`
                  : invadeFechado
                    ? `comece o período em ${formatData(diaSeguinte(invadeFechado))}`
                    : 'informe o saldo inicial ao fechar'
              }
              alerta={
                resumo.saldoEsperado !== null
                  ? undefined
                  : invadeFechado
                    ? `Já conferido até ${formatData(invadeFechado)}`
                    : 'Este caixa nunca foi fechado aqui'
              }
            />
            <Indicador
              rotulo="Na rua"
              valor={formatBRL(resumo.naRua)}
              detalhe={
                resumo.pessoasNaRua === 1
                  ? 'com 1 pessoa'
                  : `com ${resumo.pessoasNaRua} pessoas`
              }
              alerta={resumo.naRua > 0 ? 'Não está na gaveta' : undefined}
            />
          </div>

          <DinheiroNaRuaBloco
            caixaId={caixaId}
            itens={naRua}
            onMudou={recarregar}
          />

          {fechamentos.length > 0 && (
            <Bloco titulo="Fechamentos deste período" className="surgir mt-5">
              <ul className="lista-dividida">
                {fechamentos.map((f, i) => (
                  <LinhaDoFechamento
                    key={f.id}
                    fechamento={f}
                    /* Só o mais recente aceita correção — os de trás já têm
                       gente apoiada neles, e o servidor recusa de todo jeito. */
                    podeCorrigir={i === 0}
                    onCorrigido={recarregar}
                  />
                ))}
              </ul>
            </Bloco>
          )}
        </>
      )}

      {aba === 'conferir' && (
        <Bloco
          titulo={soSaidas ? 'Saídas a conferir' : 'Lançamentos a conferir'}
          semPadding
          className="surgir"
          acao={
            <div className="flex items-center gap-3">
              {faltam > 0 && (
                <Selo tom="atencao">
                  {faltam === 1 ? 'falta 1' : `faltam ${faltam}`}
                </Selo>
              )}
              <button
                type="button"
                onClick={() => setSoSaidas((v) => !v)}
                className="btn btn-p btn-sutil"
              >
                {soSaidas
                  ? `Mostrar as ${qtdEntradas} entradas também`
                  : 'Mostrar só as saídas'}
              </button>
            </div>
          }
        >
          {aConferir.length > 0 ? (
            <TabelaDeLancamentos
              caixaId={caixaId}
              itens={aConferir}
              revisados={false}
              podeConferir={podeConferir}
              onConferiu={marcarNoCache}
              onMudouNota={marcarNotaNoCache}
              onErro={setErro}
            />
          ) : (
            <Vazio titulo="Nada a conferir">
              {qtdSaidas === 0
                ? 'Não houve saída neste período.'
                : 'Todas as saídas do período já foram revisadas.'}
            </Vazio>
          )}

          {/* O que ficou para trás. Dentro da mesma aba, embaixo do período:
              é a mesma fila, e não outro assunto — só que de dias que a tela
              não mostra mais. */}
          {atrasados.length > 0 && (
            <div className="border-t border-tinta-200 px-4 pb-4 pt-4 sm:px-5">
              <Aviso tom="atencao">
                {atrasados.length === 1
                  ? '1 saída de dia anterior ainda espera conferência'
                  : `${atrasados.length} saídas de dias anteriores ainda esperam conferência`}{' '}
                — a nota do acerto da rua chegou depois que aquele dia passou.
              </Aviso>
              <ul className="lista-dividida">
                {atrasados.map((a) => (
                  <LinhaAtrasada
                    key={a.id}
                    item={a}
                    caixaId={caixaId}
                    podeConferir={podeConferir}
                    onConferiu={recarregar}
                    onErro={setErro}
                  />
                ))}
              </ul>
            </div>
          )}
        </Bloco>
      )}

      {aba === 'revisados' && (
        <Bloco
          titulo="Revisados"
          semPadding
          className="surgir"
          acao={
            revisados.length > 0 ? (
              <Selo tom="pago">
                {revisados.length === 1
                  ? '1 revisado'
                  : `${revisados.length} revisados`}
              </Selo>
            ) : undefined
          }
        >
          {revisados.length > 0 ? (
            <TabelaDeLancamentos
              caixaId={caixaId}
              itens={revisados}
              revisados
              podeConferir={podeConferir}
              onConferiu={marcarNoCache}
              onMudouNota={marcarNotaNoCache}
              onErro={setErro}
            />
          ) : (
            <Vazio titulo="Nada revisado ainda">
              Dê OK nas saídas da aba anterior; elas passam para cá.
            </Vazio>
          )}

          {/*
            É aqui que termina.
            
            Fechar mora no fim dos revisados porque é o gesto seguinte ao
            último OK: a lista acabou, o saldo esperado está na frente, conta-se
            a gaveta e compara-se. Na aba do resumo ele ficava longe do trabalho
            que o habilita, e dava para clicar sem ter olhado nada.
          */}
          {(revisados.length > 0 || qtdSaidas === 0) && (
            <Fechar
              faltam={faltam}
              naRua={resumo.naRua}
              semSaidas={qtdSaidas === 0}
              precisaSaldoInicial={resumo.saldoInicial === null}
              invadeFechado={invadeFechado}
              buracoDesde={buracoDesde}
              deDoPeriodo={de}
              saldoEsperado={resumo.saldoEsperado}
              pendente={fechar.isPending}
              onFechar={(dados) => fechar.mutate(dados)}
            />
          )}
        </Bloco>
      )}

      {aba === 'historico' && <Historico caixaId={caixaId} />}
    </>
  );
}

/** A barra de abas, no modelo da tela do IXC. */
function Abas<T extends string>({
  atual,
  abas,
  onTrocar,
  acao,
}: {
  atual: T;
  abas: Array<{ id: T; rotulo: string; selo?: number }>;
  onTrocar: (id: T) => void;
  /** O canto direito da barra, para o que serve à tela toda. */
  acao?: ReactNode;
}) {
  return (
    <div className="surgir mb-5 flex flex-wrap items-center gap-1 border-b border-tinta-200">
      {abas.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onTrocar(a.id)}
          className={
            'relative -mb-px rounded-t-xl border border-b-0 px-4 py-2 text-sm ' +
            (a.id === atual
              ? 'border-tinta-200 bg-papel font-medium text-tinta-800'
              : 'border-transparent text-tinta-500 hover:text-tinta-800')
          }
        >
          {a.rotulo}
          {a.selo !== undefined && (
            <span className="ml-2 rounded-full bg-tinta-200/70 px-2 py-0.5 text-xs text-tinta-600">
              {a.selo}
            </span>
          )}
        </button>
      ))}
      {acao && <div className="mb-1 ml-auto pl-2">{acao}</div>}
    </div>
  );
}

/**
 * O histórico: o que já foi fechado por aqui, período a período.
 *
 * Sem procura, ele mostra os fechamentos — que é como o caixa é lembrado
 * depois ("o de julho", "o da semana passada"), e não como uma lista corrida de
 * pagamentos sem começo nem fim. Cada um abre e mostra os números com que
 * fechou e o que foi conferido dentro dele.
 *
 * Com procura, o recorte some: quem digita o nome de um fornecedor está
 * procurando um pagamento, não um período, e sabe menos ainda em qual deles
 * ele caiu. Aí a busca varre tudo o que já passou pela conferência.
 *
 * Os dois lados leem só o que esta casa guardou — o retrato que a conferência
 * copiou do lançamento. Varrer o IXC mês a mês para achar um pagamento antigo é
 * a leitura que já derrubou esta página com 502.
 */
function Historico({ caixaId }: { caixaId: number }) {
  const [termo, setTermo] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [busca, setBusca] = useState('');

  // A busca só sai quando quem digita para: cada tecla aqui é uma consulta.
  useEffect(() => {
    const id = setTimeout(() => setBusca(termo.trim()), 400);
    return () => clearTimeout(id);
  }, [termo]);

  const procurando = !!(busca || de || ate);

  const achados = useQuery({
    queryKey: ['caixa', 'historico', caixaId, busca, de, ate],
    queryFn: async () =>
      (
        await api.get<ItemDoHistorico[]>(`/caixa/${caixaId}/historico`, {
          params: {
            busca: busca || undefined,
            de: de || undefined,
            ate: ate || undefined,
          },
        })
      ).data,
    enabled: procurando,
  });

  const fechamentos = useQuery({
    queryKey: ['caixa', 'fechamentos', caixaId],
    queryFn: async () =>
      (await api.get<FechamentoDoPeriodo[]>(`/caixa/${caixaId}/fechamentos`))
        .data,
  });

  return (
    <>
      <Bloco titulo="Procurar um pagamento" className="surgir mb-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="busca-historico">
              Histórico ou observação
            </label>
            <input
              id="busca-historico"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              className="campo"
              placeholder="nome do fornecedor, documento, o que estiver escrito…"
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="hist-de">
              De
            </label>
            <input
              id="hist-de"
              type="date"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              className="campo"
            />
          </div>
          <div>
            <label className="rotulo" htmlFor="hist-ate">
              Até
            </label>
            <input
              id="hist-ate"
              type="date"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              className="campo"
            />
          </div>
        </div>
        <p className="ajuda mt-2">
          A procura varre <strong>todos os períodos</strong>, fechados ou não —
          não só o que está aberto na tela. Em branco, os fechamentos aparecem
          um a um logo abaixo.
        </p>
        {procurando && (
          <button
            type="button"
            onClick={() => {
              setTermo('');
              setBusca('');
              setDe('');
              setAte('');
            }}
            className="btn btn-p btn-sutil mt-3"
          >
            Limpar a procura e voltar aos períodos
          </button>
        )}
      </Bloco>

      {procurando ? (
        <Bloco
          titulo="Achados em todos os períodos"
          semPadding
          className="surgir"
          acao={
            achados.data ? (
              <Selo tom="neutro">
                {achados.data.length === 1
                  ? '1 pagamento'
                  : `${achados.data.length} pagamentos`}
              </Selo>
            ) : undefined
          }
        >
          {achados.isLoading && <Carregando texto="Procurando…" />}
          {achados.isError && (
            <div className="p-4">
              <Aviso tom="erro">{mensagemErro(achados.error)}</Aviso>
            </div>
          )}
          {achados.data?.length === 0 && (
            <Vazio titulo="Nada encontrado">
              Nenhum pagamento conferido bate com esta procura.
            </Vazio>
          )}
          {!!achados.data?.length && (
            <ul className="lista-dividida px-5">
              {achados.data.map((h) => (
                <LinhaDoHistorico key={h.id} item={h} caixaId={caixaId} />
              ))}
            </ul>
          )}
        </Bloco>
      ) : (
        <Bloco titulo="Períodos fechados" className="surgir" semPadding>
          {fechamentos.isLoading && <Carregando texto="Lendo…" />}
          {fechamentos.data?.length === 0 && (
            <Vazio titulo="Nenhum período fechado ainda">
              Termine a conferência na aba <strong>Revisados</strong> e dê o
              período por conferido: ele passa a viver aqui.
            </Vazio>
          )}
          {!!fechamentos.data?.length && (
            <ul className="lista-dividida px-5">
              {fechamentos.data.map((f) => (
                <PeriodoFechado key={f.id} fechamento={f} caixaId={caixaId} />
              ))}
            </ul>
          )}
        </Bloco>
      )}
    </>
  );
}

/**
 * Um período fechado, com os números com que fechou e o que teve dentro.
 *
 * Os números são os do dia em que foi assinado — copiados, não recalculados: um
 * fechamento é o que se viu naquele dia, e lançamento que apareça no IXC
 * depois, com data de período já fechado, não reescreve o que foi assinado.
 */
function PeriodoFechado({
  fechamento: f,
  caixaId,
}: {
  fechamento: FechamentoDoPeriodo;
  caixaId: number;
}) {
  const [aberto, setAberto] = useState(false);

  /*
   * Rota própria do período, e não a procura com de/ate.
   *
   * As conferências do primeiro caixa batido guardaram só o número do
   * lançamento no IXC — o retrato (data, valor, histórico) passou a ser copiado
   * depois delas. Como a procura acha por data, o período abria dizendo "133
   * saídas conferidas" e listava seis. Esta rota completa o que falta lendo o
   * IXC uma vez, na janela do próprio período, e o que ela copia fica: a
   * segunda abertura já não lê nada.
   */
  const itens = useQuery({
    queryKey: ['caixa', 'historico', caixaId, 'periodo', f.id],
    queryFn: async () =>
      (
        await api.get<{ itens: ItemDoHistorico[]; completados: number }>(
          `/caixa/fechamentos/${f.id}/historico`,
        )
      ).data,
    // Só quando abre: são vários períodos na lista, e ninguém olha todos.
    enabled: aberto,
  });

  const calculado = Number(f.saldoFinal);
  const contado = f.saldoContado === null ? null : Number(f.saldoContado);
  const diferenca =
    contado === null ? null : Math.round((contado - calculado) * 100) / 100;

  return (
    <li className="py-3">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <span className="font-medium text-tinta-800">
            {formatData(f.de)} a {formatData(f.ate)}
          </span>
          <div className="text-xs text-tinta-400">
            {f.conferidos} saída(s) conferida(s)
            {f.observacao ? ` · ${f.observacao}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="valor">{formatBRL(contado ?? calculado)}</span>
          <span className="text-xs text-tinta-400">
            {contado === null ? 'calculados' : 'contados'} na gaveta
          </span>
          <span className="text-xs text-tinta-400">{aberto ? '▾' : '▸'}</span>
        </div>
      </button>

      {diferenca !== null && Math.abs(diferenca) >= 0.005 && (
        <div className="mt-1 text-xs text-amber-600">
          {diferenca > 0 ? 'Sobra' : 'Falta'} de {formatBRL(Math.abs(diferenca))}{' '}
          sobre os {formatBRL(calculado)} calculados.
        </div>
      )}

      {aberto && (
        <div className="mt-3">
          {/* Os números com que o período fechou. */}
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <NumeroDoFechamento
              rotulo="Abriu com"
              valor={Number(f.saldoInicial)}
            />
            <NumeroDoFechamento
              rotulo="Entradas"
              valor={Number(f.totalEntradas)}
            />
            <NumeroDoFechamento rotulo="Saídas" valor={Number(f.totalSaidas)} />
            <NumeroDoFechamento rotulo="Na rua" valor={Number(f.totalNaRua)} />
            <NumeroDoFechamento rotulo="Calculado" valor={calculado} />
            <NumeroDoFechamento
              rotulo="Contado"
              valor={contado}
              vazio="não contou"
            />
          </div>

          {itens.isLoading && (
            <Carregando texto="Lendo o período…" />
          )}
          {itens.data?.itens.length === 0 && (
            <p className="ajuda">
              Nenhum pagamento conferido caiu neste período.
            </p>
          )}
          {!!itens.data?.completados && (
            <p className="ajuda mb-2">
              {itens.data.completados === 1
                ? '1 conferência recuperou do IXC a data que não tinha guardado.'
                : `${itens.data.completados} conferências recuperaram do IXC a data que não tinham guardado.`}
            </p>
          )}
          {!!itens.data?.itens.length && (
            <ul className="lista-dividida">
              {itens.data.itens.map((h) => (
                <LinhaDoHistorico key={h.id} item={h} caixaId={caixaId} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function NumeroDoFechamento({
  rotulo,
  valor,
  vazio = '—',
}: {
  rotulo: string;
  valor: number | null;
  vazio?: string;
}) {
  return (
    <div className="rounded-xl border border-tinta-200 px-3 py-2">
      <div className="text-[0.7rem] uppercase tracking-wide text-tinta-400">
        {rotulo}
      </div>
      <div className="valor text-sm">
        {valor === null ? (
          <span className="text-tinta-400">{vazio}</span>
        ) : (
          formatBRL(valor)
        )}
      </div>
    </div>
  );
}

/**
 * Uma saída que ficou para trás, na fila de conferir.
 *
 * Confere pela mesma rota das outras — é o mesmo gesto e a mesma assinatura —,
 * e reenvia o retrato que já está guardado: quem confere aqui não tem o
 * lançamento do IXC na mão, tem a cópia que o acerto da rua deixou.
 */
function LinhaAtrasada({
  item,
  caixaId,
  podeConferir,
  onConferiu,
  onErro,
}: {
  item: SaidaAtrasada;
  caixaId: number;
  podeConferir: boolean;
  onConferiu: () => void;
  onErro: (mensagem: string) => void;
}) {
  const [verNotas, setVerNotas] = useState(false);

  const conferir = useMutation({
    mutationFn: async () => {
      await api.put(
        `/caixa/${caixaId}/lancamentos/${item.idLancamentoIxc}/conferir`,
        {
          conferido: true,
          dataLancamento: item.dataLancamento
            ? diaDoISO(item.dataLancamento)
            : undefined,
          valor: item.valor === null ? undefined : Number(item.valor),
          historico: item.historico ?? undefined,
        },
      );
    },
    onSuccess: onConferiu,
    onError: (e) => onErro(mensagemErro(e)),
  });

  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="num text-tinta-400">
            {item.dataLancamento ? formatData(item.dataLancamento) : '—'}
          </span>{' '}
          <span className="text-tinta-700">
            {item.historico || 'sem histórico'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="valor">
            {item.valor === null ? '—' : formatBRL(Number(item.valor))}
          </span>
          {item.qtdNotas > 0 && (
            <button
              type="button"
              onClick={() => setVerNotas((v) => !v)}
              className="btn btn-p btn-sutil"
            >
              {item.qtdNotas === 1 ? 'Ver nota' : `Ver ${item.qtdNotas} notas`}
            </button>
          )}
          {podeConferir && (
            <button
              type="button"
              onClick={() => conferir.mutate()}
              disabled={conferir.isPending}
              className="btn btn-p btn-pagar"
            >
              {conferir.isPending ? 'Conferindo…' : 'OK'}
            </button>
          )}
        </div>
      </div>
      {verNotas && (
        <NotasDoLancamento
          caixaId={caixaId}
          idLancamento={item.idLancamentoIxc}
          somenteLeitura
        />
      )}
    </li>
  );
}

function LinhaDoHistorico({
  item,
  caixaId,
}: {
  item: ItemDoHistorico;
  caixaId: number;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="num text-tinta-400">
            {item.dataLancamento ? formatData(item.dataLancamento) : '—'}
          </span>{' '}
          <span className="text-tinta-800">
            {item.historico || 'sem histórico'}
          </span>
          {item.observacao && (
            <div className="text-xs text-tinta-400">{item.observacao}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="valor">
            {item.valor === null ? '—' : formatBRL(Number(item.valor))}
          </span>
          {item.qtdNotas > 0 ? (
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              className="btn btn-p btn-ferramenta"
            >
              {aberto
                ? 'Fechar'
                : item.qtdNotas === 1
                  ? 'Ver nota'
                  : `Ver ${item.qtdNotas} notas`}
            </button>
          ) : (
            <span className="text-xs text-tinta-400">sem nota</span>
          )}
        </div>
      </div>
      {aberto && (
        <NotasDoLancamento
          caixaId={caixaId}
          idLancamento={item.idLancamentoIxc}
          somenteLeitura
        />
      )}
    </li>
  );
}

/** A mesma tabela nas duas abas: o que muda é a coluna da ação. */
function TabelaDeLancamentos({
  caixaId,
  itens,
  revisados,
  podeConferir,
  onConferiu,
  onMudouNota,
  onErro,
}: {
  caixaId: number;
  itens: LancamentoDoCaixa[];
  revisados: boolean;
  /** Dar por conferido é de ADMIN; fotografar é de quem opera o caixa. */
  podeConferir: boolean;
  onConferiu: (id: number, conferido: boolean) => void;
  onMudouNota: (id: number, qtdNotas: number) => void;
  onErro: (m: string) => void;
}) {
  /*
   * Uma saída de cada vez com as notas à mostra, e o estado mora aqui.
   *
   * A tira de miniaturas é alta: duas ou três abertas empurram a lista para
   * baixo e quem confere perde a linha em que estava. Morando na tabela, abrir
   * uma fecha a outra sozinha — e qualquer clique numa linha fecha a que
   * estiver aberta, que é o gesto de quem já olhou e quer a lista de volta.
   */
  const [comNotas, setComNotas] = useState<number | null>(null);

  return (
    <div className="overflow-x-auto rolagem-fina">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th">Data</th>
            <th className="th">Histórico</th>
            <th className="th text-right">Valor</th>
            <th className="th">Notas</th>
            <th className="th text-right">
              {revisados || !podeConferir ? '' : 'Conferir'}
            </th>
          </tr>
        </thead>
        <tbody>
          {itens.map((l) => (
            <LinhaDoLancamento
              key={l.id}
              caixaId={caixaId}
              lancamento={l}
              revisado={revisados}
              podeConferir={podeConferir}
              vendoNotas={comNotas === l.id}
              onVerNotas={(ver) => setComNotas(ver ? l.id : null)}
              onConferiu={onConferiu}
              onMudouNota={onMudouNota}
              onErro={onErro}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinhaDoLancamento({
  caixaId,
  lancamento: l,
  revisado,
  podeConferir,
  vendoNotas,
  onVerNotas,
  onConferiu,
  onMudouNota,
  onErro,
}: {
  caixaId: number;
  lancamento: LancamentoDoCaixa;
  revisado: boolean;
  podeConferir: boolean;
  /** Esta é a linha cujas notas estão à mostra. */
  vendoNotas: boolean;
  /** `false` fecha a tira de notas, seja de qual linha for. */
  onVerNotas: (ver: boolean) => void;
  onConferiu: (id: number, conferido: boolean) => void;
  onMudouNota: (id: number, qtdNotas: number) => void;
  onErro: (m: string) => void;
}) {

  /**
   * O retrato do lançamento vai junto do que se grava sobre ele.
   *
   * É ele que faz existir o histórico pesquisável meses depois: sem isso, a
   * conferência guardaria só "olhei este" e o número no IXC, e achar um
   * pagamento antigo exigiria varrer o IXC mês a mês.
   */
  const retrato = {
    dataLancamento: diaDoISO(l.data),
    valor: l.valor,
    historico: l.historico,
  };

  const conferir = useMutation({
    mutationFn: async (conferido: boolean) => {
      await api.put(`/caixa/${caixaId}/lancamentos/${l.id}/conferir`, {
        conferido,
        ...retrato,
      });
      return conferido;
    },
    onSuccess: (conferido) => onConferiu(l.id, conferido),
    onError: (e) => onErro(mensagemErro(e)),
  });

  const anexar = useMutation({
    mutationFn: async (notaFoto: string) =>
      (
        await api.post<{ qtdNotas: number }>(
          `/caixa/${caixaId}/lancamentos/${l.id}/notas`,
          { notaFoto, ...retrato },
        )
      ).data,
    onSuccess: (r) => {
      onMudouNota(l.id, r.qtdNotas);
      onVerNotas(true);
    },
    onError: (e) => onErro(mensagemErro(e)),
  });

  return (
    <>
      <tr
        className="linha"
        onClick={(e) => {
          /*
           * O clique num controle da linha é dele: "Ver notas" alterna, "+
           * foto" abre o seletor, "OK" confere. Fechar por cima desfaria os
           * três — e é justamente o botão de abrir que mais sofreria.
           */
          if ((e.target as HTMLElement).closest('button, label, a, input')) {
            return;
          }
          onVerNotas(false);
        }}
      >
        <td className="td num whitespace-nowrap">{formatData(l.data)}</td>
        <td className="td">
          {l.historico || <span className="text-tinta-400">sem histórico</span>}
          {l.tipo === 'ENTRADA' && (
            <Selo pequeno tom="pago">
              entrada
            </Selo>
          )}
          {/* O selo fica na linha, e não escondido num detalhe: um valor que
              não entra na conta precisa se anunciar onde a conta é lida. */}
          {l.foraDaGaveta && (
            <>
              <Selo
                pequeno
                tom="atencao"
                titulo={l.motivoForaDaGaveta ?? undefined}
              >
                fora da gaveta
              </Selo>
              {l.motivoForaDaGaveta && (
                <div className="text-xs text-tinta-400">
                  {l.motivoForaDaGaveta}
                </div>
              )}
            </>
          )}
        </td>
        <td className="td whitespace-nowrap text-right">
          <span className="valor">{formatBRL(l.valor)}</span>
        </td>
        <td className="td">
          <div className="flex flex-wrap items-center gap-2">
            {l.qtdNotas > 0 && (
              <button
                type="button"
                onClick={() => onVerNotas(!vendoNotas)}
                className="btn btn-p btn-ferramenta"
              >
                {vendoNotas
                  ? 'Fechar'
                  : l.qtdNotas === 1
                    ? 'Ver nota'
                    : `Ver ${l.qtdNotas} notas`}
              </button>
            )}
            {/* Anexar continua aparecendo com foto já anexada: uma nota nem
                sempre cabe numa foto só — cupom comprido, verso escrito, a
                foto tremida que pede a segunda. */}
            <EscolherFoto
              rotulo={l.qtdNotas > 0 ? '+ foto' : 'Anexar nota'}
              pendente={anexar.isPending}
              onEscolher={(dataUrl) => anexar.mutate(dataUrl)}
              onErro={onErro}
            />
            {/*
              Aqui ficava o botão de tirar um lançamento da conta da gaveta.

              Ele saiu da tela a pedido: é uma ferramenta de exceção, para o
              lançamento de acerto que corrige um saldo errado do outro lado, e
              um botão de um clique em toda linha convida a usá-la como atalho
              para qualquer diferença que não fecha — que é como uma contagem
              deixa de valer.

              O que ele fazia continua de pé: a coluna no banco, a conta do
              saldo que a respeita, o selo abaixo que mostra o que está fora e
              por quê, e a rota `PATCH .../fora-da-gaveta`. O que não existe
              mais é o caminho de um clique.
            */}
          </div>
        </td>
        <td className="td text-right">
          {/* Sem perfil para conferir, a coluna some em vez de mostrar um botão
              que o servidor vai recusar. */}
          {!podeConferir ? null : revisado ? (
            /* Desfazer: um OK dado por engano tem de ter volta, ou a
               conferência vira uma armadilha de um clique. */
            <button
              type="button"
              onClick={() => conferir.mutate(false)}
              disabled={conferir.isPending}
              className="btn btn-p btn-sutil"
              title="Devolve este lançamento para a aba de conferir"
            >
              Desfazer
            </button>
          ) : (
            <button
              type="button"
              onClick={() => conferir.mutate(true)}
              disabled={conferir.isPending}
              className="btn btn-p btn-pagar"
              title="Confere este lançamento e manda para os revisados"
            >
              {conferir.isPending ? '…' : 'OK'}
            </button>
          )}
        </td>
      </tr>
      {vendoNotas && (
        <tr>
          <td colSpan={5} className="bg-tinta-50/80 px-4 pb-4">
            <NotasDoLancamento
              caixaId={caixaId}
              idLancamento={l.id}
              onMudou={(qtd) => onMudouNota(l.id, qtd)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** O botão de escolher uma foto, com a redução feita antes do envio. */
function EscolherFoto({
  rotulo,
  pendente,
  onEscolher,
  onErro,
}: {
  rotulo: string;
  pendente: boolean;
  onEscolher: (dataUrl: string) => void;
  onErro: (m: string) => void;
}) {
  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // O input é limpo sempre: sem isso, escolher a mesma foto de novo depois de
    // um erro não dispara evento nenhum.
    e.target.value = '';
    if (!arquivo) return;
    try {
      onEscolher(await reduzirFoto(arquivo));
    } catch (err) {
      onErro(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <label
      className="btn btn-p btn-neutro w-fit cursor-pointer"
      title="Fotografe a nota ou escolha uma imagem já salva"
    >
      {pendente ? 'Enviando…' : rotulo}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={aoEscolher}
      />
    </label>
  );
}

/**
 * As fotos de um lançamento.
 *
 * A lista vem sem as imagens — só os números —, e cada imagem é pedida quando
 * vai aparecer. São centenas de KB cada: trazê-las todas de uma vez para
 * desenhar miniaturas é a diferença entre uma tela que abre e uma que trava no
 * celular de quem está no balcão.
 */
function NotasDoLancamento({
  caixaId,
  idLancamento,
  onMudou,
  somenteLeitura = false,
}: {
  caixaId: number;
  idLancamento: number;
  onMudou?: (qtdNotas: number) => void;
  somenteLeitura?: boolean;
}) {
  const qc = useQueryClient();
  const chave = ['caixa', 'notas', caixaId, idLancamento];
  /** Qual foto está aberta em tela cheia. */
  const [aberta, setAberta] = useState<string | null>(null);

  const notas = useQuery({
    queryKey: chave,
    queryFn: async () =>
      (
        await api.get<NotaDoLancamento[]>(
          `/caixa/${caixaId}/lancamentos/${idLancamento}/notas`,
        )
      ).data,
  });

  const apagar = useMutation({
    mutationFn: async (fotoId: string) => api.delete(`/caixa/notas/${fotoId}`),
    onSuccess: async () => {
      const { data } = await api.get<NotaDoLancamento[]>(
        `/caixa/${caixaId}/lancamentos/${idLancamento}/notas`,
      );
      qc.setQueryData(chave, data);
      onMudou?.(data.length);
    },
  });

  if (notas.isLoading) return <Carregando texto="Abrindo as fotos…" />;
  if (!notas.data?.length) {
    return <p className="ajuda pt-3">Nenhuma foto anexada.</p>;
  }

  /*
   * A sequência que as setas percorrem é a das fotos.
   *
   * O recibo assinado do diarista também é nota desta saída, mas é um PDF
   * montado na hora — não há imagem para pôr no lugar da anterior. Ele fica
   * de fora da caminhada e continua na tira, com o botão dele.
   */
  const fotos = notas.data.filter((n) => n.tipo !== 'RECIBO');
  const naSequencia = fotos.findIndex((n) => n.id === aberta);

  return (
    <div className="flex flex-wrap gap-3 pt-3">
      {notas.data.map((n, i) =>
        n.tipo === 'RECIBO' ? (
          <UmRecibo
            key={n.id}
            diariaId={n.diariaId!}
            numero={i + 1}
            total={notas.data.length}
            onDesligar={() => apagar.mutate(n.id)}
          />
        ) : (
          <UmaFoto
            key={n.id}
            fotoId={n.id}
            numero={i + 1}
            total={notas.data.length}
            onAbrir={() => setAberta(n.id)}
            onApagar={somenteLeitura ? undefined : () => apagar.mutate(n.id)}
          />
        ),
      )}

      {naSequencia >= 0 && (
        <NotaEmTelaCheia
          fotoId={fotos[naSequencia].id}
          /* O número é o da nota na tira inteira, recibo incluído: é assim
             que ela aparece embaixo da miniatura. */
          titulo={`Nota ${
            notas.data.findIndex((n) => n.id === fotos[naSequencia].id) + 1
          } de ${notas.data.length}`}
          onFechar={() => setAberta(null)}
          onAnterior={
            naSequencia > 0
              ? () => setAberta(fotos[naSequencia - 1].id)
              : undefined
          }
          onProxima={
            naSequencia < fotos.length - 1
              ? () => setAberta(fotos[naSequencia + 1].id)
              : undefined
          }
        />
      )}
    </div>
  );
}

/** A imagem de uma nota. A miniatura e a tela cheia leem a mesma consulta. */
function useFotoDaNota(fotoId: string) {
  return useQuery({
    queryKey: ['caixa', 'foto', fotoId],
    queryFn: async () =>
      (await api.get<{ foto: string | null }>(`/caixa/notas/${fotoId}`)).data,
  });
}

/**
 * A foto aberta em tela cheia, com as vizinhas a uma seta de distância.
 *
 * Mora no conjunto, e não na miniatura: passar de uma nota para a outra é
 * assunto da saída inteira. A imagem vem da mesma consulta que a miniatura já
 * fez — trocar de foto não espera rede.
 */
function NotaEmTelaCheia({
  fotoId,
  titulo,
  onFechar,
  onAnterior,
  onProxima,
}: {
  fotoId: string;
  titulo: string;
  onFechar: () => void;
  onAnterior?: () => void;
  onProxima?: () => void;
}) {
  const foto = useFotoDaNota(fotoId);
  if (!foto.data?.foto) return null;

  return (
    <FotoAmpliada
      src={foto.data.foto}
      titulo={titulo}
      onFechar={onFechar}
      onAnterior={onAnterior}
      onProxima={onProxima}
    />
  );
}

/**
 * O recibo assinado do diarista, valendo como nota deste pagamento.
 *
 * Ele não é copiado para a conferência: é montado na hora, do retrato congelado
 * da assinatura. Guardar uma cópia seria criar uma segunda verdade sobre o
 * mesmo pagamento — e reimprimir o de março tem de dar o mesmo papel que saiu
 * em março.
 */
function UmRecibo({
  diariaId,
  numero,
  total,
  onDesligar,
}: {
  diariaId: string;
  numero: number;
  total: number;
  /** Tira o recibo desta saída — ele volta a ficar sem lançamento. */
  onDesligar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);

  /*
   * O PDF vem pela API autenticada, e não por um `href` direto: o token vive
   * no cabeçalho, e uma aba aberta na mão chegaria lá sem ele.
   */
  const abrir = useMutation({
    mutationFn: async () => {
      const { data } = await api.get<Blob>(
        `/diarias/${diariaId}/recibo.pdf`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <div className="flex w-52 flex-col gap-1">
      <div className="text-xs text-tinta-400">
        {numero} de {total}
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-tinta-200 p-3">
        <Selo tom="pago">Recibo assinado</Selo>
        <p className="text-xs text-tinta-400">
          O diarista assinou o recibo deste pagamento; ele vale como a nota.
        </p>
        <button
          type="button"
          onClick={() => abrir.mutate()}
          disabled={abrir.isPending}
          className="btn btn-p btn-primario"
        >
          {abrir.isPending ? 'Abrindo…' : 'Ver o recibo'}
        </button>
        {/* O recibo é ligado à saída por valor, nome e dia — e onde a pessoa
            recebe todo mês o mesmo valor, a ligação pode cair na saída
            vizinha. Quem abre o recibo e vê outra data precisa poder
            desfazer: o recibo volta a ficar solto e é religado na próxima
            leitura do caixa, agora pelo dia certo. */}
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                'Tirar este recibo deste pagamento? Ele volta a ficar sem ' +
                  'lançamento e pode ser ligado ao pagamento certo. O recibo ' +
                  'assinado não é apagado.',
              )
            ) {
              onDesligar();
            }
          }}
          className="btn btn-p btn-sutil"
        >
          Não é deste pagamento
        </button>
        {erro && <p className="text-xs text-rose-600">{erro}</p>}
      </div>
    </div>
  );
}

function UmaFoto({
  fotoId,
  numero,
  total,
  onAbrir,
  onApagar,
}: {
  fotoId: string;
  numero: number;
  total: number;
  onAbrir: () => void;
  onApagar?: () => void;
}) {
  const foto = useFotoDaNota(fotoId);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs text-tinta-400">
        <span>
          {numero} de {total}
        </span>
        {onApagar && (
          <button type="button" onClick={onApagar} className="hover:text-rose-600">
            tirar
          </button>
        )}
      </div>
      {foto.isLoading ? (
        <div className="h-40 w-40 animate-pulse rounded-xl border border-tinta-200 bg-tinta-100" />
      ) : foto.data?.foto ? (
        /* A miniatura é o atalho; o que vale é o que ela abre. */
        <button
          type="button"
          onClick={onAbrir}
          title="Ver em tela cheia"
          className="cursor-zoom-in"
        >
          <img
            src={foto.data.foto}
            alt={`Nota ${numero} de ${total}`}
            className="max-h-64 rounded-xl border border-tinta-200"
          />
        </button>
      ) : (
        <p className="ajuda">A foto não está mais aqui.</p>
      )}
    </div>
  );
}

/**
 * O dinheiro que está com as pessoas.
 *
 * Fica acima da lista de lançamentos de propósito: é o valor que explica a
 * diferença entre o que a soma diz e o que existe na gaveta, e quem bate o
 * caixa precisa vê-lo antes de começar a riscar linha.
 */
function DinheiroNaRuaBloco({
  caixaId,
  itens,
  onMudou,
}: {
  caixaId: number;
  itens: ContaDaRua[];
  onMudou: () => void;
}) {
  const [pessoa, setPessoa] = useState('');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  /*
   * Guarda o id, e não a conta.
   *
   * O acerto é aos poucos: lançada uma nota parcial, o painel continua aberto e
   * precisa mostrar o saldo novo. Com o objeto guardado ele mostraria o saldo
   * de antes, e a pessoa lançaria o resto contra um número velho.
   */
  const [acertando, setAcertando] = useState<string | null>(null);
  /**
   * O que a despesa lançada deixou pendente no IXC.
   *
   * O acerto já foi registrado quando isto aparece — são recados sobre o título
   * lá (não ficou pago, a etiqueta não colou). Enterrá-los no console deixaria
   * uma conta em aberto no IXC que ninguém sabe que existe.
   */
  const [avisos, setAvisos] = useState<string[]>([]);

  const entregar = useMutation({
    mutationFn: async () =>
      api.post('/caixa/dinheiro-na-rua', {
        caixaId,
        pessoa,
        valor: Number(valor),
        motivo: motivo || undefined,
      }),
    onSuccess: () => {
      setPessoa('');
      setValor('');
      setMotivo('');
      setErro(null);
      onMudou();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const apagar = useMutation({
    mutationFn: async (id: string) => api.delete(`/caixa/dinheiro-na-rua/${id}`),
    onSuccess: onMudou,
    onError: (e) => setErro(mensagemErro(e)),
  });

  // O que está fora é a soma dos saldos, e não das entregas: quem já devolveu
  // metade não está com a metade.
  const total = useMemo(() => itens.reduce((s, i) => s + i.saldo, 0), [itens]);
  const podeEntregar = pessoa.trim().length >= 2 && Number(valor) > 0;
  const aConta = itens.find((i) => i.id === acertando) ?? null;

  return (
    <Bloco
      titulo="Dinheiro na rua"
      className="surgir surgir-2 mb-5"
      acao={
        total > 0 ? (
          <Selo tom="atencao">{formatBRL(total)} fora da gaveta</Selo>
        ) : undefined
      }
    >
      <p className="ajuda mb-3">
        O que está com alguém para pagar algo na rua. Enquanto estiver aqui, o
        valor não está na gaveta nem virou despesa — é ele que faz a contagem
        bater. A conta de cada um se acerta aos poucos: nota, troco, ou mais
        dinheiro para completar a compra.
      </p>

      {itens.length > 0 && (
        <ul className="lista-dividida mb-4">
          {itens.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <span className="font-medium text-tinta-800">{i.pessoa}</span>{' '}
                <span className="valor">{formatBRL(i.saldo)}</span>
                <span className="ml-2 text-xs text-tinta-400">
                  desde {formatData(i.entregueEm)}
                </span>
                {/* Entregou 204 e já acertou parte: dizer só o saldo esconderia
                    de onde ele veio. */}
                {i.movimentos.length > 0 && (
                  <span className="ml-2 text-xs text-tinta-400">
                    de {formatBRL(Number(i.valor))} entregues,{' '}
                    {i.movimentos.length}{' '}
                    {i.movimentos.length === 1 ? 'acerto' : 'acertos'}
                  </span>
                )}
                {i.motivo && (
                  <div className="text-xs text-tinta-400">{i.motivo}</div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setAcertando(i.id)}
                  className="btn btn-p btn-primario"
                  title="Lançar nota, troco ou mais dinheiro nesta conta"
                >
                  Acertar
                </button>
                <button
                  type="button"
                  onClick={() => apagar.mutate(i.id)}
                  disabled={apagar.isPending || i.movimentos.length > 0}
                  className="btn btn-p btn-sutil"
                  title={
                    i.movimentos.length > 0
                      ? 'Esta conta já tem acerto lançado'
                      : 'Lançado por engano'
                  }
                >
                  Apagar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="rotulo" htmlFor="pessoa">
            Com quem está
          </label>
          <input
            id="pessoa"
            value={pessoa}
            onChange={(e) => setPessoa(e.target.value)}
            placeholder="Ex.: Jeferson"
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="valor-rua">
            Quanto levou
          </label>
          <CampoDinheiro valor={valor} onChange={setValor} />
        </div>
        <div>
          <label className="rotulo" htmlFor="motivo">
            Para quê
          </label>
          <div className="flex gap-2">
            <input
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="opcional — peça de reposição, combustível…"
              className="campo flex-1"
            />
            <button
              type="button"
              onClick={() => entregar.mutate()}
              disabled={!podeEntregar || entregar.isPending}
              className="btn btn-primario shrink-0"
            >
              {entregar.isPending ? 'Anotando…' : 'Anotar saída'}
            </button>
          </div>
        </div>
      </div>

      {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}

      {avisos.length > 0 && (
        <div className="mt-3">
          <Aviso tom="atencao">
            <p className="font-medium">
              O acerto foi registrado, mas o IXC deixou pendências:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Aviso>
        </div>
      )}

      {aConta && (
        <AcertarConta
          conta={aConta}
          onLancado={(recados) => {
            setAvisos(recados);
            onMudou();
          }}
          onFechar={() => setAcertando(null)}
        />
      )}
    </Bloco>
  );
}

/**
 * Como cada acerto se chama e o que ele faz com os dois saldos.
 *
 * A ajuda diz o efeito na gaveta porque é o que confunde: a nota não mexe nela
 * — o dinheiro já saiu quando foi entregue —, enquanto troco e reforço mexem na
 * hora. Sem isso dito, o número da gaveta parece não responder ao lançamento.
 */
const TIPOS_DE_ACERTO: Array<{
  tipo: TipoMovimentoDaRua;
  rotulo: string;
  ajuda: string;
}> = [
  {
    tipo: 'NOTA',
    rotulo: 'Trouxe nota',
    ajuda:
      'Comprovou um gasto: vira conta a pagar no IXC. A gaveta não muda — este dinheiro já saiu dela quando foi entregue.',
  },
  {
    tipo: 'TROCO',
    rotulo: 'Devolveu dinheiro',
    ajuda: 'O dinheiro volta para a gaveta agora.',
  },
  {
    tipo: 'REFORCO',
    rotulo: 'Levou mais',
    ajuda: 'Sai mais dinheiro da gaveta agora, para completar a compra.',
  },
];

/**
 * Um acerto da conta de quem levou dinheiro.
 *
 * A conta raramente se resolve de uma vez: leva 204, traz nota de 100 e fica
 * com os outros 104 para a próxima compra; às vezes a compra passa do que ela
 * tem e mais dinheiro sai da gaveta. Cada um desses é um lançamento, e o painel
 * continua aberto enquanto sobrar saldo — zerou, ele some sozinho.
 */
function AcertarConta({
  conta,
  onLancado,
  onFechar,
}: {
  conta: ContaDaRua;
  onLancado: (avisos: string[]) => void;
  onFechar: () => void;
}) {
  const [tipo, setTipo] = useState<TipoMovimentoDaRua>('NOTA');
  const [valor, setValor] = useState('');
  /*
   * Hoje, e não o dia da entrega.
   *
   * O padrão era a data da entrega, e ele jogava o lançamento para trás — quase
   * sempre para dentro de um período já fechado, onde ele não mexia no saldo
   * desta tela. Quem devolve dinheiro devolve agora; a data só se muda quando a
   * compra de fato aconteceu noutro dia.
   */
  const [data, setData] = useState(diaDeHoje);
  /* Várias: uma nota nem sempre cabe numa foto só — cupom comprido, verso
     escrito, a foto tremida que pede a segunda tentativa. */
  const [fotos, setFotos] = useState<string[]>([]);
  /** Qual das fotos recém-tiradas está aberta em tela cheia. */
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // A despesa que a nota vira no IXC.
  const [lancarDespesa, setLancarDespesa] = useState(true);
  /** Quando ela já foi lançada lá por fora: o dia em que saiu do caixa do IXC. */
  const [gastoJaNoIxcEm, setGastoJaNoIxcEm] = useState('');
  const [termo, setTermo] = useState('');
  const [fornecedor, setFornecedor] = useState<FornecedorIxc | null>(null);
  /* O motivo da entrega já é a descrição da despesa nove vezes em dez. */
  const [descricao, setDescricao] = useState(conta.motivo ?? '');
  const [categoriaId, setCategoriaId] = useState('');

  const ehNota = tipo === 'NOTA';
  const comDespesa = ehNota && lancarDespesa;
  const quanto = Number(valor) || 0;
  /* Nota ou troco maior que o saldo deixaria a pessoa devendo negativo, e o
     negativo entraria no total da rua abatendo o saldo de quem realmente está
     com dinheiro. Reforço pode passar: ele é dinheiro saindo. */
  const passaDoSaldo = tipo !== 'REFORCO' && quanto - conta.saldo > 0.005;

  const falta =
    quanto <= 0
      ? 'Informe o valor deste lançamento.'
      : passaDoSaldo
        ? `${conta.pessoa} está com ${formatBRL(conta.saldo)}. Se saiu mais dinheiro, lance o reforço antes.`
        : !comDespesa
          ? null
          : !fornecedor
            ? 'Escolha quem recebeu o dinheiro.'
            : descricao.trim().length < 3
              ? 'Diga em que o dinheiro foi gasto.'
              : !data
                ? 'Informe o dia em que aconteceu.'
                : null;

  // A busca só sai depois que quem digita para: cada tecla aqui é uma consulta
  // ao IXC, que é lento e não é nosso.
  const [buscaEfetiva, setBuscaEfetiva] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setBuscaEfetiva(termo.trim()), 400);
    return () => clearTimeout(id);
  }, [termo]);

  const fornecedores = useQuery({
    queryKey: ['fornecedores-ixc', buscaEfetiva],
    queryFn: async () =>
      (
        await api.get<FornecedorIxc[]>('/fornecedores-ixc', {
          params: { busca: buscaEfetiva },
        })
      ).data,
    enabled: comDespesa && buscaEfetiva.length >= 2 && !fornecedor,
    retry: 0,
  });

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
    enabled: comDespesa,
  });

  const lancar = useMutation({
    mutationFn: async () =>
      (
        await api.post<MovimentoLancado>(
          `/caixa/dinheiro-na-rua/${conta.id}/movimento`,
          {
            tipo,
            valor: quanto,
            data,
            notasFoto: fotos.length ? fotos : undefined,
            despesa: comDespesa
              ? {
                  idFornecedorIxc: fornecedor!.idFornecedor,
                  fornecedorNome: fornecedor!.nome,
                  descricao: descricao.trim(),
                  pagoEm: data,
                  categoriaId: categoriaId || undefined,
                }
              : undefined,
            gastoJaNoIxcEm:
              ehNota && !lancarDespesa && gastoJaNoIxcEm
                ? gastoJaNoIxcEm
                : undefined,
          },
        )
      ).data,
    onSuccess: (feito) => {
      // Os campos se limpam para o próximo acerto; a conta continua aberta
      // enquanto sobrar saldo, e some da lista quando ele zera.
      setValor('');
      setFotos([]);
      setData(diaDeHoje());
      setFornecedor(null);
      setTermo('');
      setGastoJaNoIxcEm('');
      setErro(null);
      onLancado(feito.despesa?.avisos ?? []);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const desfazer = useMutation({
    mutationFn: async (id: string) => api.delete(`/caixa/movimentos-da-rua/${id}`),
    onSuccess: () => {
      setErro(null);
      onLancado([]);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const desfazerTudo = useMutation({
    mutationFn: async () =>
      (
        await api.delete<{ desfeitos: number; mantidos: string[] }>(
          `/caixa/dinheiro-na-rua/${conta.id}/acertos`,
        )
      ).data,
    onSuccess: (r) => {
      // O que não deu para desfazer volta nomeado: desfazer pela metade em
      // silêncio seria pior que não desfazer.
      setErro(r.mantidos.length ? r.mantidos.join(' ') : null);
      onLancado([]);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <div className="mt-4 rounded-2xl border border-brand-500/30 bg-brand-500/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-tinta-800">
          {conta.pessoa} está com{' '}
          <span className="valor">{formatBRL(conta.saldo)}</span>
          <span className="ml-2 text-xs font-normal text-tinta-400">
            de {formatBRL(Number(conta.valor))} entregues em{' '}
            {formatData(conta.entregueEm)}
          </span>
        </p>
        <div className="flex gap-2">
          {conta.movimentos.length > 0 && (
            <button
              type="button"
              onClick={() => desfazerTudo.mutate()}
              disabled={desfazerTudo.isPending}
              className="btn btn-p btn-sutil"
              title="Apaga todos os lançamentos e volta a conta ao valor entregue"
            >
              {desfazerTudo.isPending ? 'Desfazendo…' : 'Desfazer tudo'}
            </button>
          )}
          <button
            type="button"
            onClick={onFechar}
            className="btn btn-p btn-sutil"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* O que já foi lançado nesta conta. Sem isto, quem acerta em três
          etapas perde a conta do que já disse. */}
      {conta.movimentos.length > 0 && (
        <ul className="lista-dividida mb-3">
          {conta.movimentos.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm"
            >
              <div>
                <span className="font-medium text-tinta-800">
                  {m.tipo === 'NOTA'
                    ? 'Nota'
                    : m.tipo === 'TROCO'
                      ? 'Troco'
                      : 'Mais dinheiro'}
                </span>{' '}
                <span className="valor">{formatBRL(Number(m.valor))}</span>
                <span className="ml-2 text-xs text-tinta-400">
                  {formatData(m.data)}
                </span>
                {m.fornecedorNome && (
                  <span className="ml-2 text-xs text-tinta-400">
                    {m.fornecedorNome}
                  </span>
                )}
                {m.idFnApagarIxc && (
                  <span className="ml-2 text-xs text-emerald-600">
                    conta #{m.idFnApagarIxc} no IXC
                  </span>
                )}
                {m.observacao && (
                  <div className="text-xs text-tinta-400">{m.observacao}</div>
                )}
              </div>
              {/* Qualquer um, e não só o último: o saldo é uma soma, e some
                  qualquer parcela que se tire. O que virou título no IXC leva
                  o título junto — quando lá deixa. */}
              <button
                type="button"
                onClick={() => desfazer.mutate(m.id)}
                disabled={desfazer.isPending}
                className="btn btn-p btn-sutil"
                title={
                  m.idFnApagarIxc
                    ? `Apaga também a conta #${m.idFnApagarIxc} no IXC`
                    : 'Apaga este lançamento'
                }
              >
                Desfazer
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {TIPOS_DE_ACERTO.map((t) => (
          <button
            key={t.tipo}
            type="button"
            onClick={() => setTipo(t.tipo)}
            className={
              t.tipo === tipo ? 'btn btn-p btn-primario' : 'btn btn-p btn-sutil'
            }
            title={t.ajuda}
          >
            {t.rotulo}
          </button>
        ))}
      </div>
      <p className="ajuda mb-3">
        {TIPOS_DE_ACERTO.find((t) => t.tipo === tipo)?.ajuda}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="rotulo">Valor</label>
          <CampoDinheiro valor={valor} onChange={setValor} />
        </div>
        {/* Troco e reforço são de agora: o dinheiro está mudando de mão
            enquanto se digita. A nota pode ser de outro dia, porque a compra
            pode ter sido antes — e é a data dela que decide em que período a
            saída cai no IXC. */}
        {ehNota && (
          <div>
            <label className="rotulo" htmlFor="data-acerto">
              Dia da compra
            </label>
            <input
              id="data-acerto"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="campo"
            />
            <p className="ajuda">Pode ser uma data já passada.</p>
          </div>
        )}
        {ehNota && (
          <div>
            <label className="rotulo">Fotos da nota</label>
            <div className="flex flex-wrap items-center gap-2">
              {fotos.map((f, i) => (
                <div key={f.slice(-32) + i} className="relative">
                  {/* Antes de anexar, ver se a foto saiu legível — a
                      miniatura é cortada e pequena demais para dizer. */}
                  <button
                    type="button"
                    onClick={() => setAmpliada(i)}
                    title="Ver em tela cheia"
                    className="block cursor-zoom-in"
                  >
                    <img
                      src={f}
                      alt={`Nota ${i + 1}`}
                      className="h-[42px] w-16 rounded-lg border border-tinta-200 object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFotos((atual) => atual.filter((_, j) => j !== i))}
                    className="absolute -right-1 -top-1 rounded-full bg-tinta-800 px-1 text-xs text-papel"
                    title="Tirar esta foto"
                  >
                    ×
                  </button>
                  {ampliada === i && (
                    <FotoAmpliada
                      src={f}
                      titulo={`Nota ${i + 1} de ${fotos.length}`}
                      onFechar={() => setAmpliada(null)}
                      onAnterior={i > 0 ? () => setAmpliada(i - 1) : undefined}
                      onProxima={
                        i < fotos.length - 1
                          ? () => setAmpliada(i + 1)
                          : undefined
                      }
                    />
                  )}
                </div>
              ))}
              <label className="btn btn-p btn-neutro w-fit cursor-pointer">
                {fotos.length ? '+ foto' : 'Anexar foto'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={async (e) => {
                    const arquivo = e.target.files?.[0];
                    e.target.value = '';
                    if (!arquivo) return;
                    try {
                      const reduzida = await reduzirFoto(arquivo);
                      setFotos((atual) => [...atual, reduzida]);
                      setErro(null);
                    } catch (err) {
                      setErro(err instanceof Error ? err.message : String(err));
                    }
                  }}
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/*
        Onde o dinheiro foi gasto.

        Sem esta parte, a nota que a pessoa trouxe fica sabida só aqui: o
        dinheiro sai da gaveta e o financeiro da empresa nunca vê despesa
        nenhuma. Com ela, o gasto vira conta a pagar criada, aprovada e baixada
        no caixa de onde o dinheiro saiu — a saída que faltava no IXC.
      */}
      {ehNota && (
        <div className="mt-4 rounded-xl border border-tinta-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-tinta-800">
            <input
              type="checkbox"
              checked={lancarDespesa}
              onChange={(e) => setLancarDespesa(e.target.checked)}
            />
            Lançar a conta a pagar deste gasto
          </label>

          {!lancarDespesa ? (
            <>
              <p className="ajuda mt-1">
                Desmarcado, a nota fica registrada só aqui. Use assim quando a
                despesa já tiver sido lançada no IXC por outro caminho; senão o
                caixa de lá continua sem a saída.
              </p>

              {/* A data da saída lá é o que impede o dinheiro de ser
                  descontado duas vezes da gaveta.

                  O saldo esperado tira da conta o que foi entregue e devolve o
                  que a nota virou despesa — e essa devolução se guia por esta
                  data. Sem ela, a entrega desconta uma vez e a saída lançada no
                  IXC desconta de novo: R$ 300 entregues viram R$ 600 fora da
                  gaveta, e a contagem nunca fecha. */}
              <div className="mt-3">
                <label className="rotulo" htmlFor="gasto-ja-no-ixc">
                  Em que dia ela saiu do caixa no IXC{' '}
                  <span className="text-tinta-400">(opcional)</span>
                </label>
                <input
                  id="gasto-ja-no-ixc"
                  type="date"
                  value={gastoJaNoIxcEm}
                  onChange={(e) => setGastoJaNoIxcEm(e.target.value)}
                  className="campo max-w-xs"
                />
                <p className="ajuda">
                  {gastoJaNoIxcEm
                    ? 'A gaveta soma este gasto de volta no período desse dia, porque a saída do IXC já o desconta.'
                    : 'Sem esta data, o valor sai da gaveta duas vezes: uma pela entrega e outra pela saída que já está no IXC. Preencha com o dia da saída lá.'}
                </p>
              </div>
            </>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="rotulo" htmlFor="fornecedor-acerto">
                  Quem recebeu
                </label>
                {fornecedor ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-tinta-800">
                      {fornecedor.nome}
                    </span>
                    {fornecedor.cpfCnpj && (
                      <span className="text-xs text-tinta-400">
                        {fornecedor.cpfCnpj}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setFornecedor(null);
                        setTermo('');
                      }}
                      className="btn btn-p btn-sutil"
                    >
                      Trocar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      id="fornecedor-acerto"
                      value={termo}
                      onChange={(e) => setTermo(e.target.value)}
                      className="campo"
                      placeholder="nome, nome fantasia ou CPF/CNPJ"
                    />
                    {fornecedores.isFetching && (
                      <p className="ajuda">Procurando no IXC…</p>
                    )}
                    {fornecedores.data && fornecedores.data.length > 0 && (
                      <ul className="mt-1 max-h-44 overflow-auto rounded-xl border border-tinta-200">
                        {fornecedores.data.map((f) => (
                          <li key={f.idFornecedor}>
                            <button
                              type="button"
                              onClick={() => setFornecedor(f)}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-brand-500/10"
                            >
                              <span className="text-tinta-800">{f.nome}</span>
                              {f.nomeFantasia && (
                                <span className="text-tinta-400">
                                  {' '}
                                  — {f.nomeFantasia}
                                </span>
                              )}
                              {f.cpfCnpj && (
                                <span className="ml-2 text-xs text-tinta-400">
                                  {f.cpfCnpj}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* O cadastro é do IXC e continua sendo: criar fornecedor
                        daqui só para lançar uma nota encheria a base de lá de
                        duplicados. */}
                    {buscaEfetiva.length >= 2 &&
                      !fornecedores.isFetching &&
                      fornecedores.data?.length === 0 && (
                        <p className="ajuda">
                          Nenhum fornecedor com esse nome no IXC. Cadastre-o por
                          lá e volte aqui.
                        </p>
                      )}
                  </>
                )}
              </div>

              <div>
                <label className="rotulo" htmlFor="descricao-acerto">
                  Em que foi gasto
                </label>
                <input
                  id="descricao-acerto"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  className="campo"
                  placeholder="correia do gerador, combustível…"
                />
                <p className="ajuda">É o que aparece na conta a pagar do IXC.</p>
              </div>

              {/* A classificação é daqui, não do IXC: é por ela que o dashboard
                  separa os gastos, e a nota da rua conta como qualquer outra
                  despesa nessa separação. */}
              <div>
                <label className="rotulo" htmlFor="categoria-acerto">
                  Classificação
                </label>
                <SeletorDeCategoria
                  id="categoria-acerto"
                  categorias={categorias.data}
                  value={categoriaId}
                  vazio="Sem classificação"
                  carregando={categorias.isLoading}
                  onChange={setCategoriaId}
                />
              </div>

            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => lancar.mutate()}
          disabled={!!falta || lancar.isPending}
          className="btn btn-primario"
          title={
            falta ??
            (comDespesa
              ? 'Cria a conta a pagar, aprova e dá a baixa no caixa'
              : 'Lança o acerto nesta conta')
          }
        >
          {lancar.isPending
            ? comDespesa
              ? 'Lançando no IXC…'
              : 'Lançando…'
            : 'Finalizar'}
        </button>
        {falta ? (
          <span className="text-sm text-amber-600">{falta}</span>
        ) : (
          <span className="text-sm text-tinta-500">
            Sobram{' '}
            <span className="valor">
              {formatBRL(
                Math.round(
                  (conta.saldo + (tipo === 'REFORCO' ? quanto : -quanto)) * 100,
                ) / 100,
              )}
            </span>{' '}
            com {conta.pessoa} depois deste lançamento.
          </span>
        )}
      </div>

      {erro && <p className="mt-2 text-sm text-rose-600">{erro}</p>}
    </div>
  );
}

function Fechar({
  faltam,
  naRua,
  semSaidas,
  precisaSaldoInicial,
  invadeFechado,
  buracoDesde,
  deDoPeriodo,
  saldoEsperado,
  pendente,
  onFechar,
}: {
  faltam: number;
  naRua: number;
  /** Período sem saída nenhuma: não há o que conferir, e ainda assim fecha. */
  semSaidas: boolean;
  /** Primeiro fechamento deste caixa: alguém tem de dizer de onde parte. */
  precisaSaldoInicial: boolean;
  /** Até quando já está fechado, quando o período pedido invade esse trecho. */
  invadeFechado: string | null;
  /** Primeiro dia não conferido, quando o período começa depois dele. */
  buracoDesde: string | null;
  /** Início do período, para nomear o intervalo que ficou de fora. */
  deDoPeriodo: string;
  /** O que a soma diz que deve haver na gaveta, para comparar com a contagem. */
  saldoEsperado: number | null;
  pendente: boolean;
  onFechar: (dados: {
    observacao: string;
    saldoInicial?: number;
    saldoContado?: number;
  }) => void;
}) {
  const [observacao, setObservacao] = useState('');
  const [saldoInicial, setSaldoInicial] = useState('');
  const [saldoContado, setSaldoContado] = useState('');
  const faltaOSaldo =
    precisaSaldoInicial && !invadeFechado && saldoInicial.trim() === '';

  const contou = saldoContado.trim() !== '';
  /** Sobra (positiva) ou falta (negativa) entre o que existe e o que a soma diz. */
  const diferenca =
    contou && saldoEsperado !== null
      ? Math.round((Number(saldoContado) - saldoEsperado) * 100) / 100
      : null;

  return (
    /* Sem cartão próprio: ele já vive dentro do cartão dos revisados, e um
       cartão dentro do outro só empurraria o botão para longe da lista que o
       habilita. */
    <div className="border-t border-tinta-200 px-5 py-4">
      {/*
        O número que a contagem tem de encontrar, na frente de quem vai contar.
        
        É a conta inteira desta tela resumida numa linha: se a gaveta tiver isto,
        o período fecha limpo. Escondê-lo obrigaria a voltar à aba do resumo com
        o dinheiro na mão.
      */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rotulo mb-0">A gaveta deve ter</span>
        <span className="valor text-lg">
          {saldoEsperado === null ? '—' : formatBRL(saldoEsperado)}
        </span>
        <span className="text-sm text-tinta-400">
          {saldoEsperado === null
            ? 'enquanto faltar de onde partir, a conta não fecha'
            : 'conte o dinheiro e compare com este número'}
        </span>
      </div>

      {/* Recontar dias já conferidos somaria as mesmas saídas duas vezes, e o
          novo fechamento passaria a disputar com o antigo o posto de
          "anterior" do seguinte. O servidor recusa; a tela diz antes. */}
      {invadeFechado && (
        <div className="mb-3">
          <Aviso tom="atencao">
            Este caixa já está fechado até{' '}
            <strong>{formatData(invadeFechado)}</strong>. Mude o{' '}
            <strong>De</strong> para{' '}
            <strong>{formatData(diaSeguinte(invadeFechado))}</strong> — daí o
            saldo aparece sozinho, vindo do fechamento anterior.
          </Aviso>
        </div>
      )}

      {/* O saldo inicial vem do fechamento anterior, e ele não sabe o que
          aconteceu nos dias pulados: fechar assim herdaria um número que já
          não valia. */}
      {buracoDesde && (
        <div className="mb-3">
          <Aviso tom="atencao">
            Os dias de <strong>{formatData(buracoDesde)}</strong> a{' '}
            <strong>{formatData(diaAnterior(deDoPeriodo))}</strong> não estão
            neste período e nunca foram conferidos. Fechar assim deixaria o
            movimento deles fora da conta — comece o período em{' '}
            <strong>{formatData(buracoDesde)}</strong>.
          </Aviso>
        </div>
      )}

      {/* Só no primeiro fechamento deste caixa: do segundo em diante, o
          anterior diz de onde a gaveta parte. */}
      {precisaSaldoInicial && !invadeFechado && (
        <div className="mb-3">
          <label className="rotulo" htmlFor="saldo-inicial">
            Quanto havia na gaveta em {' '}
            {/* O rótulo diz o dia para ninguém informar o saldo de hoje. */}
            <span className="text-tinta-800">o início do período</span>
          </label>
          <div className="max-w-xs">
            <CampoDinheiro valor={saldoInicial} onChange={setSaldoInicial} />
          </div>
          <p className="ajuda">
            Este caixa nunca foi fechado por aqui, então a contagem precisa de
            um ponto de partida. Do próximo fechamento em diante ele vem
            sozinho, do anterior.
          </p>
        </div>
      )}

      {/* A contagem da gaveta. É ela que faz o fechamento valer alguma coisa:
          sem contar, o período fecha pelo cálculo, e cálculo não encontra
          dinheiro que sumiu nem dinheiro que apareceu. */}
      <div className="mb-3">
        <label className="rotulo" htmlFor="saldo-contado">
          Quanto há na gaveta agora, <span className="text-tinta-800">contado</span>
        </label>
        <div className="max-w-xs">
          <CampoDinheiro valor={saldoContado} onChange={setSaldoContado} />
        </div>
        {diferenca === null ? (
          <p className="ajuda">
            Conte o dinheiro que está na gaveta e escreva aqui. É este número
            que o próximo período usa como ponto de partida, e é comparando-o
            com o calculado que se descobre sobra ou falta. Em branco, o
            fechamento parte da soma — que foi o que fez o primeiro caixa fechar
            com R$ 0,00 e a gaveta cheia.
          </p>
        ) : Math.abs(diferenca) < 0.005 ? (
          <p className="mt-1 text-sm text-emerald-600">
            Bate com o esperado, {formatBRL(saldoEsperado ?? 0)}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-amber-600">
            {diferenca > 0 ? 'Sobra' : 'Falta'}{' '}
            <span className="valor">{formatBRL(Math.abs(diferenca))}</span> em
            relação aos {formatBRL(saldoEsperado ?? 0)} que a soma esperava. O
            fechamento guarda os dois, e o próximo período parte do contado.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="rotulo" htmlFor="obs-fechamento">
            Observação do fechamento
          </label>
          <input
            id="obs-fechamento"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
            placeholder="opcional — o que explica este período"
          />
        </div>
        <button
          type="button"
          onClick={() =>
            onFechar({
              observacao,
              saldoInicial: precisaSaldoInicial
                ? Number(saldoInicial) || 0
                : undefined,
              saldoContado: contou ? Number(saldoContado) || 0 : undefined,
            })
          }
          disabled={
            faltam > 0 ||
            faltaOSaldo ||
            !!invadeFechado ||
            !!buracoDesde ||
            pendente
          }
          className="btn btn-acao shrink-0"
          title={
            invadeFechado
              ? `Este período recomeça dentro do que já foi fechado até ${formatData(invadeFechado)}`
              : buracoDesde
                ? `Faltam os dias desde ${formatData(buracoDesde)}, que nunca foram conferidos`
                : faltam > 0
                  ? 'Confira todas as saídas antes de fechar'
                  : faltaOSaldo
                    ? 'Informe quanto havia na gaveta no início'
                    : 'Guarda os números deste período'
          }
        >
          {pendente ? 'Fechando…' : 'Dar o período por conferido'}
        </button>
      </div>

      <p className="ajuda mt-2">
        {faltam > 0 ? (
          <>
            {faltam === 1 ? 'Falta 1 saída' : `Faltam ${faltam} saídas`} por
            conferir. O fechamento diz "olhei tudo" — por isso ele espera. Os
            recebimentos entram no saldo, mas não seguram o fechamento.
          </>
        ) : semSaidas ? (
          'Nenhuma saída no período — dá para fechar assim mesmo.'
        ) : naRua > 0 ? (
          <>
            Fecha com <strong>{formatBRL(naRua)}</strong> ainda na rua. Isso não
            impede: o valor fica registrado no fechamento como parte da
            explicação.
          </>
        ) : (
          'Tudo conferido e nada na rua.'
        )}
      </p>
    </div>
  );
}

/**
 * Um fechamento já assinado, e o conserto da contagem.
 *
 * O primeiro caixa batido aqui fechou pelo cálculo e a gaveta tinha outro
 * valor — sem poder corrigir a contagem, o único caminho seria apagar um
 * fechamento assinado e refazê-lo. Só o mais recente aceita conserto: os de
 * trás já têm o período seguinte apoiado neles.
 */
function LinhaDoFechamento({
  fechamento: f,
  podeCorrigir,
  onCorrigido,
}: {
  fechamento: FechamentoDoPeriodo;
  podeCorrigir: boolean;
  onCorrigido: () => void;
}) {
  const [corrigindo, setCorrigindo] = useState(false);
  const [valor, setValor] = useState(f.saldoContado ?? '');
  const [erro, setErro] = useState<string | null>(null);

  const corrigir = useMutation({
    mutationFn: async () =>
      api.put(`/caixa/fechamentos/${f.id}/contagem`, {
        saldoContado: Number(valor) || 0,
      }),
    onSuccess: () => {
      setCorrigindo(false);
      setErro(null);
      onCorrigido();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const calculado = Number(f.saldoFinal);
  const contado = f.saldoContado === null ? null : Number(f.saldoContado);
  const diferenca =
    contado === null ? null : Math.round((contado - calculado) * 100) / 100;

  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-tinta-800">
            {formatData(f.de)} a {formatData(f.ate)}
          </span>{' '}
          — fechou com{' '}
          <span className="valor">{formatBRL(contado ?? calculado)}</span>{' '}
          {contado === null ? 'calculados' : 'contados'} na gaveta,{' '}
          {f.conferidos} saída(s) conferida(s) somando{' '}
          <span className="valor">{formatBRL(Number(f.totalSaidas))}</span>
          {Number(f.totalNaRua) > 0 && (
            <>
              , com{' '}
              <span className="valor">{formatBRL(Number(f.totalNaRua))}</span>{' '}
              ainda na rua
            </>
          )}
          {/* A diferença é o motivo de se bater caixa: dizer só o total
              contado esconderia justamente o que se foi procurar. */}
          {diferenca !== null && Math.abs(diferenca) >= 0.005 && (
            <div className="text-xs text-amber-600">
              {diferenca > 0 ? 'Sobra' : 'Falta'} de{' '}
              {formatBRL(Math.abs(diferenca))} sobre os{' '}
              {formatBRL(calculado)} calculados.
            </div>
          )}
          {contado === null && (
            <div className="text-xs text-tinta-400">
              Fechado sem contar a gaveta.
            </div>
          )}
          {f.observacao && (
            <div className="text-xs text-tinta-400">{f.observacao}</div>
          )}
        </div>

        {podeCorrigir && !corrigindo && (
          <button
            type="button"
            onClick={() => setCorrigindo(true)}
            className="btn btn-p btn-sutil shrink-0"
            title="Informa quanto havia de verdade na gaveta neste fechamento"
          >
            {contado === null ? 'Informar a contagem' : 'Corrigir a contagem'}
          </button>
        )}
      </div>

      {corrigindo && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="w-40">
            <label className="rotulo">Contado na gaveta</label>
            <CampoDinheiro valor={valor} onChange={setValor} />
          </div>
          <button
            type="button"
            onClick={() => corrigir.mutate()}
            disabled={valor.trim() === '' || corrigir.isPending}
            className="btn btn-p btn-primario"
          >
            {corrigir.isPending ? 'Gravando…' : 'Gravar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setCorrigindo(false);
              setErro(null);
            }}
            className="btn btn-p btn-sutil"
          >
            Cancelar
          </button>
          <p className="ajuda w-full">
            É deste número que o próximo período parte. A diferença contra o
            calculado fica registrada aqui, e morre neste fechamento em vez de
            andar para os seguintes.
          </p>
        </div>
      )}

      {erro && <p className="mt-1 text-sm text-rose-600">{erro}</p>}
    </li>
  );
}
