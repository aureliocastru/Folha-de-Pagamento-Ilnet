import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  LeitorDeCodigo,
  type AlvoDaLeitura,
} from '../../components/LeitorDeCodigo';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Indicador,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { CategoriaDespesa } from '../../lib/types';

/** Um fornecedor do IXC, como a busca por nome o devolve. */
interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

/** Uma unidade consumidora cadastrada, como a API a devolve. */
interface ContaContrato {
  id: string;
  apelido: string;
  numero: string;
  idFornecedorIxc: number;
  fornecedorNome: string;
  diaDeChegada: number;
  diaDeVencimento: number;
  valorDeReferencia: string | null;
  contaContabil: number | null;
  contaPagamento: number | null;
  tipoPagamentoIxc: string | null;
  categoriaId: string | null;
  observacao: string | null;
  ativa: boolean;
}

/** O endereço e como ele está no mês pedido. */
interface ContaContratoDoMes {
  contrato: ContaContrato;
  gerada: {
    id: string;
    idFnApagarIxc: number | null;
    valor: number;
    dataVencimento: string;
    status: string;
    pagoEm: string | null;
  } | null;
  historico: Array<{ competencia: string; valor: number }>;
  media: number | null;
  /** Negativo = o dia em que ela costuma chegar já passou. Null = outro mês. */
  diasParaChegar: number | null;
}

interface RespostaDoMes {
  competencia: string;
  contas: ContaContratoDoMes[];
}

interface ContaDePagamentoIxc {
  id: number;
  nome: string;
  ativa: boolean;
  usual: boolean;
}

interface ContaDoPlano {
  id: number;
  nome: string;
}

/**
 * De quanto o valor precisa fugir da média para a tela estranhar. É o mesmo
 * limite do servidor: conta de luz varia sozinha com a estação, o que não é
 * normal é dobrar — e um zero a mais na digitação passa despercebido numa
 * lista de onze contas parecidas.
 */
const FORA_DO_PADRAO_ACIMA = 2;
const FORA_DO_PADRAO_ABAIXO = 0.5;

/**
 * Contas Contrato — a conta de luz de cada endereço da empresa.
 *
 * Todo mês chega um maço de faturas, uma por unidade consumidora, cada uma com
 * um valor diferente. O trabalho que esta tela substitui era lançar uma por uma
 * na tela de despesa: procurar o fornecedor, escolher a conta contábil,
 * escrever de que endereço era — onze vezes, e sem nada que dissesse qual das
 * onze tinha ficado para trás.
 *
 * Aqui o que se guarda é o que não muda (o endereço, o número da conta
 * contrato, para quem se paga, como a conta sai) e o que se digita é só o que
 * muda: quanto veio na fatura. O resto vira conta a pagar no IXC de uma vez,
 * pelo mesmo caminho de qualquer despesa lançada à mão.
 */
export function ContasContrato() {
  const queryClient = useQueryClient();
  const [competencia, setCompetencia] = useState(mesAtual);
  /** O que foi digitado em cada linha: `id da conta contrato` → valor. */
  const [valores, setValores] = useState<Record<string, string>>({});
  const [vencimentos, setVencimentos] = useState<Record<string, string>>({});
  /**
   * O código com que cada fatura se paga — a linha digitável do boleto ou o
   * copia e cola do PIX. Um campo só: é uma coisa só para quem digita (o que
   * veio impresso na conta), e quem distingue os dois é o servidor.
   */
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  /** A câmera aberta para ler o código de uma linha. */
  const [lendo, setLendo] = useState<{ id: string; alvo: AlvoDaLeitura } | null>(
    null,
  );
  const [cadastrando, setCadastrando] = useState(false);
  const [editando, setEditando] = useState<ContaContrato | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const lista = useQuery({
    queryKey: ['contas-contrato', competencia],
    queryFn: async () =>
      (
        await api.get<RespostaDoMes>('/contas-contrato', {
          params: { competencia },
        })
      ).data,
    retry: 0,
  });

  const contas = useMemo(() => lista.data?.contas ?? [], [lista.data]);
  const ativas = contas.filter((c) => c.contrato.ativa);
  const pendentes = ativas.filter((c) => !c.gerada);
  const lancadas = ativas.filter((c) => c.gerada);

  /** As linhas com valor digitado — é o que o botão de gerar vai mandar. */
  const preenchidas = pendentes.filter((c) => Number(valores[c.contrato.id]) > 0);
  const somaDigitada = preenchidas.reduce(
    (s, c) => s + Number(valores[c.contrato.id]),
    0,
  );
  const somaLancada = lancadas.reduce((s, c) => s + (c.gerada?.valor ?? 0), 0);

  /**
   * Trocar de mês limpa o que estava digitado.
   *
   * Sem isto, o valor escrito na linha do Lago Verde em agosto continuaria lá
   * ao abrir setembro, e um clique no "gerar todas" lançaria a fatura de agosto
   * no mês errado.
   */
  useEffect(() => {
    setValores({});
    setVencimentos({});
    setCodigos({});
  }, [competencia]);

  const gerar = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data } = await api.post<{
        geradas: Array<{ id: string; apelido: string; idFnApagarIxc: number | null }>;
        falhas: Array<{ id: string; apelido: string; erro: string }>;
        total: number;
      }>('/contas-contrato/gerar', {
        competencia,
        lancamentos: ids.map((id) => ({
          id,
          valor: Number(valores[id]),
          dataVencimento: vencimentos[id] || undefined,
          codigo: codigos[id]?.trim() || undefined,
        })),
      });
      return data;
    },
    onSuccess: (r) => {
      setErro(r.falhas.length > 0);
      setAviso(
        (r.geradas.length > 0
          ? `${r.geradas.length} conta(s) lançadas no IXC (${formatBRL(r.total)}): ` +
            `${r.geradas.map((g) => g.apelido).join(', ')}.`
          : 'Nenhuma conta foi lançada.') +
          (r.falhas.length
            ? ` Falharam: ${r.falhas.map((f) => `${f.apelido} (${f.erro})`).join('; ')}`
            : ''),
      );
      // O que deu certo sai dos campos; o que falhou continua digitado, para
      // não ter de escrever de novo o valor de uma fatura que já está na mão.
      setValores((atual) => {
        const proximo = { ...atual };
        for (const g of r.geradas) delete proximo[g.id];
        return proximo;
      });
      setCodigos((atual) => {
        const proximo = { ...atual };
        for (const g of r.geradas) delete proximo[g.id];
        return proximo;
      });
      invalidar();
    },
    onError: (err) => {
      setErro(true);
      setAviso(mensagemErro(err));
    },
  });

  const salvar = useMutation({
    mutationFn: async (args: { id: string; dados: Record<string, unknown> }) => {
      await api.patch(`/contas-contrato/${args.id}`, args.dados);
    },
    onSuccess: invalidar,
    onError: (err) => {
      setErro(true);
      setAviso(mensagemErro(err));
    },
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/contas-contrato/${id}`);
    },
    onSuccess: () => {
      setErro(false);
      setAviso(
        'Endereço apagado do cadastro. As contas que ele já gerou continuam ' +
          'no IXC.',
      );
      invalidar();
    },
    onError: (err) => {
      setErro(true);
      setAviso(mensagemErro(err));
    },
  });

  function invalidar() {
    void queryClient.invalidateQueries({ queryKey: ['contas-contrato'] });
    void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a pagar"
        titulo="Contas Contrato"
        descricao="A conta de luz de cada endereço. O cadastro guarda o que não muda; o valor da fatura se digita quando ela chega, e vira conta a pagar no IXC num clique."
        acoes={
          <button
            onClick={() => setCadastrando(true)}
            className="btn btn-acao"
          >
            Cadastrar endereço
          </button>
        }
      />

      {aviso && (
        <Aviso
          tom={erro ? 'erro' : 'pago'}
          acao={
            <button
              onClick={() => setAviso(null)}
              className="btn btn-sutil btn-p"
            >
              Fechar
            </button>
          }
        >
          {aviso}
        </Aviso>
      )}

      {lista.error && (
        <Aviso tom="erro">
          Não deu para ler o cadastro: {mensagemErro(lista.error)}
        </Aviso>
      )}

      {/* O mês de que se está falando. As faturas chegam juntas, mas a que
          atrasou é lançada depois — e é comum estar lançando o mês passado. */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="max-w-[200px]">
          <label className="rotulo" htmlFor="competencia-contratos">
            Mês das faturas
          </label>
          <input
            id="competencia-contratos"
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value || mesAtual())}
            className="campo"
          />
        </div>
        <p className="mb-2 text-xs text-tinta-400">
          É o mês a que a fatura se refere — não o dia em que ela vence. É por
          ele que a tela sabe o que já foi lançado.
        </p>
      </div>

      {ativas.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Indicador
            rotulo="Lançadas neste mês"
            valor={`${lancadas.length} de ${ativas.length}`}
            detalhe={
              pendentes.length === 0
                ? 'Todas as faturas do mês já viraram conta a pagar'
                : `${pendentes.length} endereço(s) ainda sem a conta do mês`
            }
            acento
          />
          <Indicador
            rotulo="Já lançado no mês"
            valor={formatBRL(somaLancada)}
            detalhe="A soma das faturas que já viraram conta a pagar no IXC"
          />
          <Indicador
            rotulo="Digitado e ainda não lançado"
            valor={formatBRL(somaDigitada)}
            detalhe={
              preenchidas.length
                ? `${preenchidas.length} fatura(s) prontas para gerar`
                : 'Digite o valor de cada fatura que chegou'
            }
          />
        </div>
      )}

      <Bloco semPadding>
        {lista.isLoading ? (
          <Carregando texto="Lendo o cadastro…" />
        ) : contas.length === 0 ? (
          <Vazio titulo="Nenhum endereço cadastrado ainda">
            Cadastre cada unidade consumidora com o número da conta contrato que
            está na fatura. Depois é só digitar o valor que chegou e gerar.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full min-w-[1180px] table-fixed text-sm">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[13%]" />
                <col className="w-[12%]" />
                <col className="w-[13%]" />
                <col className="w-[12%]" />
                <col className="w-[17%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="th">Endereço</th>
                  <th className="th">A fatura</th>
                  <th className="th text-right">Costuma vir</th>
                  <th className="th text-right">Valor desta</th>
                  <th className="th">Vence</th>
                  <th className="th">Código de pagamento</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {contas.map((linha) => (
                  <LinhaDoEndereco
                    key={linha.contrato.id}
                    linha={linha}
                    competencia={competencia}
                    valor={valores[linha.contrato.id] ?? ''}
                    vencimento={vencimentos[linha.contrato.id] ?? ''}
                    codigo={codigos[linha.contrato.id] ?? ''}
                    onValor={(v) =>
                      setValores((a) => ({ ...a, [linha.contrato.id]: v }))
                    }
                    onVencimento={(v) =>
                      setVencimentos((a) => ({ ...a, [linha.contrato.id]: v }))
                    }
                    onCodigo={(v) =>
                      setCodigos((a) => ({ ...a, [linha.contrato.id]: v }))
                    }
                    onLer={(alvo) => setLendo({ id: linha.contrato.id, alvo })}
                    onGerar={() => gerar.mutate([linha.contrato.id])}
                    gerando={gerar.isPending}
                    onEditar={() => setEditando(linha.contrato)}
                    onLigarDesligar={() =>
                      salvar.mutate({
                        id: linha.contrato.id,
                        dados: { ativa: !linha.contrato.ativa },
                      })
                    }
                    onApagar={() => {
                      if (
                        confirm(
                          `Apagar ${linha.contrato.apelido} do cadastro? As ` +
                            'contas já lançadas continuam no IXC.',
                        )
                      ) {
                        remover.mutate(linha.contrato.id);
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {/* O maço inteiro de uma vez: é como as faturas chegam, e digitar onze
          valores para clicar onze vezes seria trocar seis por meia dúzia. */}
      {preenchidas.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <span className="mr-auto text-sm text-tinta-500">
            {preenchidas.length} fatura(s) digitadas, somando{' '}
            <strong className="valor">{formatBRL(somaDigitada)}</strong>. Uma de
            cada vez no IXC — o que entrar fica, mesmo se a seguinte falhar.
          </span>
          <button
            onClick={() => gerar.mutate(preenchidas.map((c) => c.contrato.id))}
            disabled={gerar.isPending}
            className="btn btn-primario"
          >
            {gerar.isPending
              ? 'Lançando no IXC…'
              : `Gerar ${preenchidas.length} conta(s) — ${formatBRL(somaDigitada)}`}
          </button>
        </div>
      )}

      <p className="ajuda">
        Cada conta nasce no IXC já aprovada, com o número da conta contrato no
        campo do documento — é por ele que se acha, meses depois, de que
        endereço era uma conta paga. A mesma fatura não é lançada duas vezes: o
        par endereço + mês é conferido antes.
      </p>

      {lendo && (
        <LeitorDeCodigo
          alvo={lendo.alvo}
          onLido={(codigo) => {
            setCodigos((a) => ({ ...a, [lendo.id]: codigo }));
            setLendo(null);
          }}
          onFechar={() => setLendo(null)}
        />
      )}

      {(cadastrando || editando) && (
        <CadastroDoEndereco
          contrato={editando}
          onFechar={() => {
            setCadastrando(false);
            setEditando(null);
          }}
          onPronto={(mensagem) => {
            setErro(false);
            setAviso(mensagem);
            setCadastrando(false);
            setEditando(null);
            invalidar();
          }}
        />
      )}
    </Pagina>
  );
}

/** Uma linha da tabela: o endereço, o que se sabe dele e o que falta digitar. */
function LinhaDoEndereco({
  linha,
  competencia,
  valor,
  vencimento,
  codigo,
  onValor,
  onVencimento,
  onCodigo,
  onLer,
  onGerar,
  gerando,
  onEditar,
  onLigarDesligar,
  onApagar,
}: {
  linha: ContaContratoDoMes;
  competencia: string;
  valor: string;
  vencimento: string;
  codigo: string;
  onValor: (v: string) => void;
  onVencimento: (v: string) => void;
  onCodigo: (v: string) => void;
  onLer: (alvo: AlvoDaLeitura) => void;
  onGerar: () => void;
  gerando: boolean;
  onEditar: () => void;
  onLigarDesligar: () => void;
  onApagar: () => void;
}) {
  const { contrato: c, gerada, media, historico, diasParaChegar } = linha;
  const digitado = Number(valor) || 0;
  const estranho = foraDoPadrao(digitado, media);
  /** O dia de sempre daquele endereço, no mês escolhido. */
  const vencimentoSugerido = diaDaCompetencia(competencia, c.diaDeVencimento);

  return (
    <tr className={`linha ${c.ativa ? '' : 'opacity-50'}`}>
      <td className="td">
        <div className="text-tinta-800">{c.apelido}</div>
        <div className="num text-xs text-tinta-400">conta contrato {c.numero}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {!c.ativa && (
            <Selo pequeno tom="neutro">
              desligado
            </Selo>
          )}
          <span className="text-[11px] text-tinta-400">{c.fornecedorNome}</span>
        </div>
      </td>

      {/* Em que pé está a fatura deste mês: já virou conta, ou ainda se espera
          por ela. O "chega dia tal" é observação da casa, não promessa da
          distribuidora — mas é o que faz alguém notar a que não chegou. */}
      <td className="td">
        {gerada ? (
          <>
            <Selo pequeno tom="pago" ponto>
              lançada
            </Selo>
            <div className="mt-1 text-[11px] text-tinta-400">
              {gerada.idFnApagarIxc
                ? `título ${gerada.idFnApagarIxc} no IXC`
                : 'ainda sem número do IXC'}
            </div>
          </>
        ) : !c.ativa ? (
          <span className="text-tinta-400">—</span>
        ) : diasParaChegar === null ? (
          <Selo pequeno tom="neutro">
            falta lançar
          </Selo>
        ) : diasParaChegar > 0 ? (
          <>
            <Selo pequeno tom="info">
              chega em {diasParaChegar} dia(s)
            </Selo>
            <div className="mt-1 text-[11px] text-tinta-400">
              costuma chegar dia {c.diaDeChegada}
            </div>
          </>
        ) : (
          <>
            <Selo pequeno tom="atencao">
              já era para ter chegado
            </Selo>
            <div className="mt-1 text-[11px] text-tinta-400">
              chega dia {c.diaDeChegada} — há {Math.abs(diasParaChegar)} dia(s)
            </div>
          </>
        )}
      </td>

      {/* A média do que aquele endereço vem custando: é com ela que se percebe
          o zero a mais na digitação, ou a fatura que veio de outro imóvel. */}
      <td className="td text-right">
        {media === null ? (
          <span className="text-xs text-tinta-400">sem histórico</span>
        ) : (
          <>
            <span className="valor">{formatBRL(media)}</span>
            <div
              className="text-[11px] text-tinta-400"
              title={historico
                .map((h) => `${h.competencia}: ${formatBRL(h.valor)}`)
                .join(' · ')}
            >
              média de {historico.length} mês(es)
            </div>
          </>
        )}
      </td>

      <td className="td text-right">
        {gerada ? (
          <span className="valor">{formatBRL(gerada.valor)}</span>
        ) : (
          <>
            <CampoDinheiro
              valor={valor}
              onChange={onValor}
              className="campo py-1 text-right"
            />
            {estranho && (
              <div className="mt-1 text-[11px] font-semibold text-amber-600">
                {digitado > (media ?? 0)
                  ? 'muito acima da média — confira a fatura'
                  : 'muito abaixo da média — confira a fatura'}
              </div>
            )}
          </>
        )}
      </td>

      <td className="td num whitespace-nowrap text-tinta-600">
        {gerada ? (
          formatData(gerada.dataVencimento)
        ) : (
          <>
            <input
              type="date"
              value={vencimento}
              onChange={(e) => onVencimento(e.target.value)}
              className="campo py-1"
            />
            {/* Em branco, vale o dia de sempre — e ele anda para o próximo dia
                útil quando cai em sábado, domingo ou feriado. */}
            {!vencimento && (
              <div className="text-[11px] text-tinta-400">
                em branco: dia {c.diaDeVencimento} ({vencimentoSugerido})
              </div>
            )}
          </>
        )}
      </td>

      {/* O código com que a fatura se paga. Sem ele o título chega ao IXC sem
          como ser pago — some no meio dos outros e só reaparece vencido. A
          câmera está aqui porque a fatura costuma estar na mão de quem digita:
          ler o código de barras é mais rápido e não erra dígito. */}
      <td className="td">
        {gerada ? (
          <span className="text-xs text-tinta-400">—</span>
        ) : (
          <>
            <input
              value={codigo}
              onChange={(e) => onCodigo(e.target.value)}
              className="campo num py-1 text-xs"
              placeholder="boleto ou PIX copia e cola"
              title="A linha digitável do boleto (44, 47 ou 48 dígitos) ou o copia e cola do PIX. Em branco, a conta vai sem código."
            />
            <div className="mt-1 flex gap-1.5">
              <button
                type="button"
                onClick={() => onLer('boleto')}
                className="btn btn-sutil btn-p"
              >
                Ler boleto
              </button>
              <button
                type="button"
                onClick={() => onLer('pix')}
                className="btn btn-sutil btn-p"
              >
                Ler QR
              </button>
            </div>
            {codigo.trim() !== '' && (
              <div className="mt-1 text-[11px] text-tinta-400">
                {classificarCodigo(codigo)}
              </div>
            )}
          </>
        )}
      </td>

      <td className="td text-right">
        <div className="flex flex-wrap justify-end gap-1.5">
          {!gerada && c.ativa && (
            <button
              onClick={onGerar}
              disabled={gerando || !(digitado > 0)}
              className="btn btn-primario btn-p"
              title={
                digitado > 0
                  ? 'Cria a conta a pagar no IXC, já aprovada'
                  : 'Digite o valor que veio na fatura'
              }
            >
              Gerar
            </button>
          )}
          <button onClick={onEditar} className="btn btn-neutro btn-p">
            Editar
          </button>
          <button
            onClick={onLigarDesligar}
            className="btn btn-sutil btn-p"
            title={
              c.ativa
                ? 'Some da lista do mês; o que já foi lançado continua lá'
                : 'Volta para a lista do mês'
            }
          >
            {c.ativa ? 'Desligar' : 'Religar'}
          </button>
          <button onClick={onApagar} className="btn btn-perigo btn-p">
            Apagar
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * O cadastro de um endereço — o mesmo formulário para criar e para editar.
 *
 * O que se pergunta aqui é só o que não muda de um mês para o outro. O valor
 * da fatura não está no formulário de propósito: ele não é cadastro, é o que
 * chega escrito na conta.
 */
function CadastroDoEndereco({
  contrato,
  onFechar,
  onPronto,
}: {
  contrato: ContaContrato | null;
  onFechar: () => void;
  onPronto: (mensagem: string) => void;
}) {
  const editando = !!contrato;
  const [apelido, setApelido] = useState(contrato?.apelido ?? '');
  const [numero, setNumero] = useState(contrato?.numero ?? '');
  const [diaDeChegada, setDiaDeChegada] = useState(
    String(contrato?.diaDeChegada ?? ''),
  );
  const [diaDeVencimento, setDiaDeVencimento] = useState(
    String(contrato?.diaDeVencimento ?? ''),
  );
  const [contaContabil, setContaContabil] = useState(
    contrato?.contaContabil ? String(contrato.contaContabil) : '',
  );
  const [contaPagamento, setContaPagamento] = useState(
    contrato?.contaPagamento ? String(contrato.contaPagamento) : '',
  );
  const [tipoPagamento, setTipoPagamento] = useState(
    contrato?.tipoPagamentoIxc ?? 'Boleto',
  );
  const [categoriaId, setCategoriaId] = useState(contrato?.categoriaId ?? '');
  const [observacao, setObservacao] = useState(contrato?.observacao ?? '');

  /** Quem recebe. Na edição começa no que está gravado, sem nova busca. */
  const [fornecedor, setFornecedor] = useState<{
    id: number;
    nome: string;
  } | null>(
    contrato
      ? { id: contrato.idFornecedorIxc, nome: contrato.fornecedorNome }
      : null,
  );
  const [termo, setTermo] = useState('');
  const [buscaEfetiva, setBuscaEfetiva] = useState('');

  // Cada tecla aqui seria uma consulta ao IXC, que é lento e não é nosso.
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
    enabled: buscaEfetiva.length >= 2 && !fornecedor,
    retry: 0,
  });

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  const contasIxc = useQuery({
    queryKey: ['contas-pagamento'],
    queryFn: async () =>
      (
        await api.get<ContaDePagamentoIxc[]>(
          '/contas-abertas/contas-pagamento',
        )
      ).data,
  });

  const plano = useQuery({
    queryKey: ['plano-de-contas'],
    queryFn: async () =>
      (await api.get<ContaDoPlano[]>('/contas-abertas/plano-de-contas')).data,
    retry: 0,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const dados = {
        apelido: apelido.trim(),
        numero: numero.replace(/\D/g, ''),
        idFornecedorIxc: fornecedor!.id,
        fornecedorNome: fornecedor!.nome,
        diaDeChegada: Number(diaDeChegada),
        diaDeVencimento: Number(diaDeVencimento),
        contaContabil: contaContabil ? Number(contaContabil) : undefined,
        contaPagamento: contaPagamento ? Number(contaPagamento) : undefined,
        tipoPagamentoIxc: tipoPagamento.trim() || undefined,
        categoriaId: categoriaId || null,
        observacao: observacao.trim() || undefined,
      };
      if (contrato) await api.patch(`/contas-contrato/${contrato.id}`, dados);
      else await api.post('/contas-contrato', dados);
    },
    onSuccess: () =>
      onPronto(
        editando
          ? `${apelido.trim()} atualizado.`
          : `${apelido.trim()} cadastrado. Na próxima fatura é só digitar o valor.`,
      ),
  });

  const podeSalvar =
    apelido.trim().length >= 2 &&
    numero.replace(/\D/g, '').length >= 4 &&
    !!fornecedor &&
    Number(diaDeChegada) >= 1 &&
    Number(diaDeChegada) <= 31 &&
    Number(diaDeVencimento) >= 1 &&
    Number(diaDeVencimento) <= 31;

  return (
    <Janela
      titulo={editando ? `Editar — ${contrato!.apelido}` : 'Cadastrar endereço'}
      onFechar={onFechar}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="cc-apelido">
            Endereço (como a casa chama)
          </label>
          <input
            id="cc-apelido"
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            className="campo"
            placeholder="Lago Verde, Garagem, Loja…"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="cc-numero">
            Número da conta contrato
          </label>
          <input
            id="cc-numero"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="campo num"
            inputMode="numeric"
            placeholder="está no alto da fatura"
          />
          <p className="ajuda">
            É por ele que a fatura se acha no site da distribuidora — e é ele
            que vai no documento do título no IXC.
          </p>
        </div>

        {/* Quem recebe, no cadastro do IXC. Escolhido uma vez e guardado: é o
            mesmo para todos os endereços, e ninguém deveria procurá-lo de novo
            a cada conta. */}
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="cc-fornecedor">
            Quem recebe (fornecedor no IXC)
          </label>
          {fornecedor ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-tinta-50 px-3 py-2">
              <span className="text-tinta-800">{fornecedor.nome}</span>
              <span className="num text-xs text-tinta-400">
                código {fornecedor.id}
              </span>
              <button
                onClick={() => {
                  setFornecedor(null);
                  setTermo('');
                }}
                className="btn btn-sutil btn-p ml-auto"
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <input
                id="cc-fornecedor"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                className="campo"
                placeholder="Nome, razão social ou CNPJ da distribuidora"
              />
              {fornecedores.isLoading && (
                <p className="ajuda">Procurando no IXC…</p>
              )}
              {fornecedores.data && fornecedores.data.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                  {fornecedores.data.map((f) => (
                    <button
                      key={f.idFornecedor}
                      onClick={() =>
                        setFornecedor({ id: f.idFornecedor, nome: f.nome })
                      }
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-tinta-50"
                    >
                      <span className="text-tinta-800">{f.nome}</span>
                      <span className="num ml-2 text-xs text-tinta-400">
                        {f.idFornecedor}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className="rotulo" htmlFor="cc-chegada">
            Dia em que a fatura costuma chegar
          </label>
          <input
            id="cc-chegada"
            type="number"
            min={1}
            max={31}
            value={diaDeChegada}
            onChange={(e) => setDiaDeChegada(e.target.value)}
            className="campo num"
          />
          <p className="ajuda">
            Não é promessa da distribuidora: é o que se observou. Serve para a
            tela cobrar a fatura que não chegou.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="cc-vencimento">
            Dia em que costuma vencer
          </label>
          <input
            id="cc-vencimento"
            type="number"
            min={1}
            max={31}
            value={diaDeVencimento}
            onChange={(e) => setDiaDeVencimento(e.target.value)}
            className="campo num"
          />
          <p className="ajuda">
            É o vencimento sugerido na hora de gerar. Caindo em fim de semana ou
            feriado, anda para o próximo dia útil.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="cc-contabil">
            Conta contábil no IXC
          </label>
          <select
            id="cc-contabil"
            value={contaContabil}
            onChange={(e) => setContaContabil(e.target.value)}
            className="campo"
            disabled={plano.isLoading}
          >
            <option value="">Padrão das Configurações</option>
            {(plano.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} — {p.nome}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="rotulo" htmlFor="cc-conta-pagamento">
            Conta de pagamento
          </label>
          <select
            id="cc-conta-pagamento"
            value={contaPagamento}
            onChange={(e) => setContaPagamento(e.target.value)}
            className="campo"
            disabled={contasIxc.isLoading}
          >
            <option value="">Padrão das Configurações</option>
            {(contasIxc.data ?? [])
              .filter((c) => c.usual || c.ativa)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="rotulo" htmlFor="cc-tipo">
            Tipo de pagamento
          </label>
          <select
            id="cc-tipo"
            value={tipoPagamento}
            onChange={(e) => setTipoPagamento(e.target.value)}
            className="campo"
          >
            {['Boleto', 'Pix', 'Débito em conta', 'Transferência', 'Dinheiro'].map(
              (t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ),
            )}
          </select>
          <p className="ajuda">
            Conta de luz costuma vir em boleto — é o que decide como o IXC
            registra o pagamento.
          </p>
        </div>

        <div>
          <label className="rotulo" htmlFor="cc-categoria">
            Categoria
          </label>
          <SeletorDeCategoria
            id="cc-categoria"
            categorias={categorias.data ?? []}
            value={categoriaId}
            onChange={setCategoriaId}
            vazio="Sem categoria"
            carregando={categorias.isLoading}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="cc-obs">
            Observação (vai junto na conta gerada)
          </label>
          <input
            id="cc-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
            placeholder="Opcional — a observação já diz o endereço e o mês"
          />
        </div>
      </div>

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
              : 'Cadastrar endereço'}
        </button>
      </div>
    </Janela>
  );
}

/**
 * O que o código colado parece ser — a mesma leitura que o servidor faz, dita
 * na hora de digitar. Serve para pegar o copia e cola truncado antes de o
 * lançamento ir embora, e não depois, na recusa.
 */
function classificarCodigo(codigo: string): string {
  const texto = codigo.trim();
  if (/^000201/.test(texto) || /br\.gov\.bcb\.pix/i.test(texto)) {
    return 'PIX copia e cola — a conta vai como Pix';
  }
  const digitos = texto.replace(/\D/g, '');
  if ([44, 47, 48].includes(digitos.length)) {
    return `boleto de ${digitos.length} dígitos — a conta vai como Boleto`;
  }
  return `não parece boleto (44, 47 ou 48 dígitos — este tem ${digitos.length}) nem PIX copia e cola`;
}

/** O valor foge tanto do que o endereço custa que vale conferir a fatura. */
function foraDoPadrao(valor: number, media: number | null): boolean {
  if (!valor || media === null || media <= 0) return false;
  return (
    valor > media * FORA_DO_PADRAO_ACIMA || valor < media * FORA_DO_PADRAO_ABAIXO
  );
}

/** "AAAA-MM" do mês corrente. */
function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * "10/09/2026" — o dia de sempre daquele endereço, no mês escolhido, sem
 * estourar para o mês seguinte: dia 31 em fevereiro é o último dia de
 * fevereiro, e não 3 de março.
 */
function diaDaCompetencia(competencia: string, dia: number): string {
  const [ano, mes] = competencia.split('-').map(Number);
  if (!ano || !mes) return '';
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const escolhido = String(Math.min(dia, ultimoDia)).padStart(2, '0');
  return `${escolhido}/${String(mes).padStart(2, '0')}/${ano}`;
}
