import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAssistente } from '../../components/Assistente';
import { FotoDaNota } from '../../components/FotoDaNota';
import { NotasDoTitulo } from '../../components/NotasDoTitulo';
import { FotoDoPonto } from '../../components/PainelDePontos';
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
import { combina } from '../../lib/busca';
import {
  formatBRL,
  formatConsumo,
  formatData,
  formatMedidor,
  medidorLimpo,
  medidorNumero,
} from '../../lib/format';
import { juntarFotos } from '../../lib/foto';
import { ManutencaoDoVeiculo } from './ManutencaoDoVeiculo';
import { NovaDespesa } from './NovaDespesa';
import { FormularioEmPassos } from '../../components/FormularioEmPassos';

type TipoVeiculo =
  | 'MOTO'
  | 'CARRO'
  | 'CAMINHONETE'
  | 'CAMINHAO'
  | 'MAQUINA'
  | 'GALAO'
  | 'OUTRO';

const TIPOS: Array<{ valor: TipoVeiculo; rotulo: string }> = [
  { valor: 'MOTO', rotulo: 'Moto' },
  { valor: 'CARRO', rotulo: 'Carro' },
  { valor: 'CAMINHONETE', rotulo: 'Caminhonete' },
  { valor: 'CAMINHAO', rotulo: 'Caminhão' },
  { valor: 'MAQUINA', rotulo: 'Máquina (horímetro)' },
  { valor: 'GALAO', rotulo: 'Galão de combustível' },
  { valor: 'OUTRO', rotulo: 'Outro' },
];

type Combustivel = 'DIESEL_S500' | 'DIESEL_S10' | 'GASOLINA' | 'ETANOL' | 'ARLA';

const COMBUSTIVEIS: Array<{ valor: Combustivel; rotulo: string }> = [
  { valor: 'DIESEL_S500', rotulo: 'Diesel S500' },
  { valor: 'DIESEL_S10', rotulo: 'Diesel S10' },
  { valor: 'GASOLINA', rotulo: 'Gasolina' },
  { valor: 'ETANOL', rotulo: 'Etanol' },
  { valor: 'ARLA', rotulo: 'Arla' },
];

const rotuloDoCombustivel = (c: Combustivel | null) =>
  COMBUSTIVEIS.find((x) => x.valor === c)?.rotulo ?? null;

/**
 * A média que o veículo está fazendo: km por litro, ou litros por hora nas
 * máquinas. O galão não tem — ele não anda.
 */
interface Consumo {
  medio: number | null;
  /** Só o trecho entre os dois últimos abastecimentos. */
  ultimo: number | null;
  unidade: 'km_por_litro' | 'litros_por_hora';
  /** Quantos abastecimentos entraram na conta. */
  base: number;
  /** A média que se espera dele, cadastrada na ficha. */
  ideal: number | null;
  /** A média está pior do que a esperada — é o amarelo da tela. */
  irregular: boolean;
  /** O último trecho está pior, mesmo com a média geral de pé. */
  ultimoIrregular: boolean;
}

/** O que há dentro de um galão, e por quanto saiu o litro. */
interface EstoqueDoGalao {
  litros: number;
  precoPorLitro: number | null;
  valor: number | null;
  litrosSemValor: number;
}

const rotuloDoTipo = (t: TipoVeiculo) => TIPOS.find((x) => x.valor === t)?.rotulo ?? t;

interface VeiculoNaLista {
  id: string;
  apelido: string;
  tipo: TipoVeiculo;
  placa: string | null;
  modelo: string | null;
  ano: number | null;
  observacao: string | null;
  ativo: boolean;
  /**
   * Quem anda com ele e o abastece. Pode ser mais de um. `login`: não é
   * funcionário — o dono, o administrador —, e fica pelo login.
   */
  responsaveis: Array<{ id: string; nome: string; login?: boolean }>;
  gasto: number;
  emAberto: number;
  quantidade: number;
  ultimoGasto: string | null;
  combustivel: number;
  abastecimentos: number;
  abastecimentosAConferir: number;
  /** O que ele põe no tanque; no galão, o que ele carrega. */
  tipoCombustivel: Combustivel | null;
  capacidadeLitros: number | null;
  /** Só os galões têm. */
  estoque: EstoqueDoGalao | null;
  ultimoKm: number | null;
  ultimoHorimetro: number | null;
  consumo: Consumo | null;
  /** A média que se espera dele. Em branco, nada de alerta. */
  consumoIdeal: number | null;
  /** Quantas trocas da manutenção estão vencidas ou perto. Só na lista. */
  manutencao?: { vencidos: number; perto: number };
}

interface Abastecimento {
  id: string;
  /** Null = na conferência: o valor da nota ainda não foi posto. */
  valor: number | null;
  km: number | null;
  /** As horas do horímetro, nas máquinas. */
  horimetro: number | null;
  litros: number | null;
  /** De qual galão saíram estes litros. Null = veio do posto, com nota. */
  galao: { id: string; apelido: string } | null;
  data: string;
  lancadoPor: string;
  temFoto: boolean;
  conferidoPor: string | null;
}

interface AbastecimentoAConferir extends Abastecimento {
  veiculo: { id: string; apelido: string; placa: string | null };
}

interface Ficha {
  veiculo: VeiculoNaLista;
  gastos: Array<{
    contaId: string;
    idFnApagarIxc: number | null;
    fornecedor: string;
    observacao: string;
    valor: number;
    vencimento: string;
    situacao: 'paga' | 'em aberto' | 'nao enviada' | 'cancelada';
    categoria: { id: string; nome: string; grupo: { id: string; nome: string } | null } | null;
  }>;
  porCategoria: Array<{ nome: string; valor: number }>;
  combustivel: {
    total: number;
    quantidade: number;
    aConferir: number;
    litros: number;
    ultimoKm: number | null;
    kmRodados: number | null;
    custoPorKm: number | null;
    ultimoHorimetro: number | null;
    horasTrabalhadas: number | null;
    custoPorHora: number | null;
    consumo: Consumo;
  };
  abastecimentos: Abastecimento[];
  /** Só no galão: o que saiu dele — para a frota, ou para outro destino escrito. */
  saidas?: Array<
    Abastecimento & {
      veiculo: { id: string; apelido: string; placa: string | null } | null;
      /** "roçadeira", "sítio" — quando não foi para um veículo da frota. */
      outroDestino: string | null;
    }
  >;
}

const km = (n: number) => `${formatMedidor(n)} km`;
/** O horímetro como no painel da máquina, com o ponto do décimo: "1252.6 h". */
const horas = (n: number) => `${formatMedidor(n, true)} h`;

/**
 * O que se sabe deste lançamento: os litros, o km, as horas — o que houver.
 *
 * Nem todo abastecimento tem as três coisas: o galão não tem painel, a máquina
 * conta horas e o carro conta km. Escrever só o que existe é o que faz a linha
 * do galão não dizer "0 km".
 */
function medida(a: Pick<Abastecimento, 'km' | 'horimetro' | 'litros'>): string {
  return (
    [
      a.litros != null ? litros(a.litros) : null,
      a.km != null ? km(a.km) : null,
      a.horimetro != null ? horas(a.horimetro) : null,
    ]
      .filter(Boolean)
      .join(' · ') || '—'
  );
}
const litros = (n: number) =>
  `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L`;

/** "Honda CG 160 · 2022 · ABC1D23" — o que distingue duas motos iguais. */
function identificacao(
  v: Pick<
    VeiculoNaLista,
    'tipo' | 'modelo' | 'ano' | 'placa' | 'tipoCombustivel' | 'capacidadeLitros'
  >,
): string {
  // No galão a placa não existe: o que o distingue é o que ele carrega.
  if (v.tipo === 'GALAO') {
    return [
      'Galão',
      rotuloDoCombustivel(v.tipoCombustivel),
      v.capacidadeLitros ? `${v.capacidadeLitros} L` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return [rotuloDoTipo(v.tipo), v.modelo, v.ano, v.placa].filter(Boolean).join(' · ');
}

/**
 * A média do veículo na lista, e o amarelo quando ela cai.
 *
 * O número sozinho não diz nada a quem não decorou o que cada carro faz — é a
 * média esperada, cadastrada na ficha, que transforma "6,2 km/L" em "este
 * carro está bebendo mais do que devia". Sem ela cadastrada, fica só o número.
 *
 * Amarelo, e não vermelho: consumo que caiu é coisa para olhar (pneu murcho,
 * filtro sujo, bico entupido, combustível sumindo), não é erro do sistema.
 */
function MediaDoVeiculo({ veiculo: v }: { veiculo: VeiculoNaLista }) {
  const c = v.consumo;
  if (v.tipo === 'GALAO') {
    // O galão não anda: o que sai dele vira consumo de quem o bebeu.
    return <span className="text-tinta-400">—</span>;
  }
  if (!c || c.medio == null) {
    return (
      <span className="block text-xs text-tinta-400">
        {c && c.base === 1
          ? 'falta o segundo abastecimento'
          : 'sem abastecimento com medidor'}
      </span>
    );
  }

  const amarelo = 'text-amber-600 dark:text-amber-300';
  return (
    <>
      <span className={`valor block text-base ${c.irregular ? amarelo : 'text-tinta-800'}`}>
        {formatConsumo(c.medio, c.unidade)}
      </span>
      {c.ideal != null ? (
        c.irregular ? (
          <span className={`block text-xs font-semibold ${amarelo}`}>
            consumo irregular · esperado {formatConsumo(c.ideal, c.unidade)}
          </span>
        ) : c.ultimoIrregular && c.ultimo != null ? (
          <span className={`block text-xs font-semibold ${amarelo}`}>
            último trecho: {formatConsumo(c.ultimo, c.unidade)}
          </span>
        ) : (
          <span className="block text-xs text-tinta-400">
            esperado {formatConsumo(c.ideal, c.unidade)}
          </span>
        )
      ) : (
        <span className="block text-xs text-tinta-400">
          {c.base} abastecimento(s)
        </span>
      )}
    </>
  );
}

/**
 * Onde a busca da frota procura: o nome, a placa (com ou sem traço), o modelo,
 * o tipo, o combustível e quem anda com ele — "hilux", "snf6", "moto",
 * "diesel", "anderson".
 */
function camposDaBusca(v: VeiculoNaLista) {
  return [
    v.apelido,
    v.placa,
    v.modelo,
    v.ano,
    rotuloDoTipo(v.tipo),
    rotuloDoCombustivel(v.tipoCombustivel),
    ...v.responsaveis.map((r) => r.nome),
  ];
}

/** "Anderson", "Anderson e Cainan", "Anderson, Cainan e Blane". */
function nomesDosResponsaveis(lista: Array<{ nome: string }>): string {
  const nomes = lista.map((r) => r.nome);
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/**
 * Veículos — a frota e o que cada um já custou.
 *
 * Duas somas por veículo, lado a lado e nunca misturadas: **peças e serviços**,
 * que são as contas a pagar lançadas com o veículo marcado, e **combustível**,
 * que é o que quem anda com ele lança pelo portal do CPF. O combustível é
 * controle — o posto manda a fatura da semana, com desconto, e é ela que se
 * paga —, então somá-lo às contas contaria o mesmo dinheiro duas vezes.
 */
export function Veiculos() {
  const [cadastrando, setCadastrando] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const lista = useQuery({
    queryKey: ['veiculos', 'todos'],
    queryFn: async () => (await api.get<VeiculoNaLista[]>('/veiculos')).data,
  });

  const veiculos = lista.data ?? [];
  const achados = veiculos.filter((v) => combina(camposDaBusca(v), busca));
  const ativos = veiculos.filter((v) => v.ativo);
  const totalGasto = veiculos.reduce((s, v) => s + v.gasto, 0);
  const totalCombustivel = veiculos.reduce((s, v) => s + v.combustivel, 0);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Veículos"
        titulo="A frota"
        acoes={
          <button onClick={() => setCadastrando(true)} className="btn btn-primario">
            Cadastrar veículo
          </button>
        }
      />

      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}

      <ConferenciaDeAbastecimentos onAbrirVeiculo={setAbertoId} />

      {veiculos.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-3">
          <Indicador
            rotulo="Veículos"
            valor={ativos.length}
            detalhe={
              veiculos.length > ativos.length
                ? `${veiculos.length - ativos.length} desligado(s)`
                : 'na frota'
            }
          />
          <Indicador
            rotulo="Peças e serviços"
            valor={formatBRL(totalGasto)}
            detalhe="contas lançadas com o veículo marcado"
            acento
          />
          <Indicador
            rotulo="Combustível"
            valor={formatBRL(totalCombustivel)}
            detalhe="abastecimentos lançados no portal"
          />
        </div>
      )}

      {veiculos.length > 0 && (
        <input
          type="search"
          className="campo mb-3 max-w-xs"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar pelo nome, placa, modelo ou motorista"
          aria-label="Procurar veículo"
          autoComplete="off"
        />
      )}

      <Bloco semPadding>
        {lista.isLoading ? (
          <Carregando />
        ) : veiculos.length === 0 ? (
          <Vazio titulo="Nenhum veículo cadastrado">
            Cadastre as motos, os carros e as máquinas. Depois, no "Lançar conta",
            dá para marcar em qual deles foi o gasto.
          </Vazio>
        ) : achados.length === 0 ? (
          <Vazio titulo="Nenhum veículo com essa busca">
            Nada com "{busca.trim()}" no nome, na placa, no modelo ou em quem anda com
            ele.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Veículo</th>
                  {/* A média entrou no lugar do responsável: quem anda com o
                      veículo se vê (e se troca) dentro da ficha dele, e o que
                      esta tela precisa responder de relance é se ele está
                      bebendo mais do que devia. */}
                  <th className="th">Média</th>
                  <th className="th text-right">Peças e serviços</th>
                  <th className="th text-right">Combustível</th>
                </tr>
              </thead>
              <tbody>
                {achados.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => setAbertoId(v.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAbertoId(v.id);
                      }
                    }}
                    title={`Abrir a ficha de ${v.apelido}`}
                    className={`linha cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${
                      v.ativo ? '' : 'opacity-50'
                    }`}
                  >
                    <td className="td">
                      <span className="block font-display text-base font-semibold leading-tight text-tinta-900">
                        {v.apelido}
                        <span className="ml-1.5 font-sans font-normal text-tinta-300">&rsaquo;</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-tinta-400">{identificacao(v)}</span>
                      {/* A troca vencida aparece na lista, sem precisar abrir a ficha. */}
                      {v.ativo && (v.manutencao?.vencidos ?? 0) + (v.manutencao?.perto ?? 0) > 0 && (
                        <span className="mt-1 inline-block">
                          <Selo pequeno tom={v.manutencao!.vencidos > 0 ? 'erro' : 'atencao'}>
                            {v.manutencao!.vencidos > 0
                              ? `${v.manutencao!.vencidos} troca(s) vencida(s)`
                              : `${v.manutencao!.perto} troca(s) perto`}
                          </Selo>
                        </span>
                      )}
                      {!v.ativo && (
                        <span className="mt-1 inline-block">
                          <Selo pequeno tom="neutro">
                            desligado
                          </Selo>
                        </span>
                      )}
                    </td>
                    <td className="td">
                      <MediaDoVeiculo veiculo={v} />
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <span className="valor">{formatBRL(v.gasto)}</span>
                      <span className="block text-xs text-tinta-400">
                        {v.quantidade} lançamento(s)
                        {v.emAberto > 0 && ` · ${formatBRL(v.emAberto)} em aberto`}
                      </span>
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      {/* No galão o número que importa não é o gasto, é o que
                          ainda está lá dentro: o gasto acontece quando o
                          combustível entra na máquina. */}
                      {v.estoque ? (
                        <>
                          <span className="valor">{litros(v.estoque.litros)}</span>
                          <span className="block text-xs text-tinta-400">
                            no galão
                            {v.estoque.precoPorLitro != null &&
                              ` · ${formatBRL(v.estoque.precoPorLitro)} o litro`}
                          </span>
                          <span className="block text-xs text-tinta-400">
                            {formatBRL(v.combustivel)} comprados
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="valor">{formatBRL(v.combustivel)}</span>
                          <span className="block text-xs text-tinta-400">
                            {v.abastecimentos} abastecimento(s)
                            {v.ultimoKm != null && ` · ${km(v.ultimoKm)}`}
                            {v.ultimoHorimetro != null && ` · ${horas(v.ultimoHorimetro)}`}
                          </span>
                        </>
                      )}
                      {v.abastecimentosAConferir > 0 && (
                        <span className="block text-xs font-semibold text-amber-600 dark:text-amber-300">
                          {v.abastecimentosAConferir} a conferir
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {cadastrando && <FormularioDoVeiculo onFechar={() => setCadastrando(false)} />}
      {abertoId && <FichaDoVeiculo id={abertoId} onFechar={() => setAbertoId(null)} />}
    </Pagina>
  );
}

/**
 * A conferência: os abastecimentos que chegaram só com o km e a foto, de todos
 * os veículos, esperando o valor da nota.
 *
 * Fica no alto da aba, e só aparece quando há o que conferir. Nada aqui paga
 * nada: o valor é controle — o dinheiro sai pela fatura do posto.
 */
function ConferenciaDeAbastecimentos({ onAbrirVeiculo }: { onAbrirVeiculo: (id: string) => void }) {
  const fila = useQuery({
    queryKey: ['veiculos', 'a-conferir'],
    queryFn: async () =>
      (await api.get<AbastecimentoAConferir[]>('/veiculos/abastecimentos/a-conferir')).data,
  });

  const itens = fila.data ?? [];
  if (itens.length === 0) return null;

  return (
    <div className="mb-4">
      <Bloco titulo={`Conferência de abastecimentos · ${itens.length}`} semPadding>
        <p className="px-4 pt-3 text-xs text-tinta-500 sm:px-5">
          Lançados só com o km e a foto da nota. Abra a foto, leia o valor e salve — é
          controle, nada é pago por aqui.
        </p>
        <ul className="lista-dividida mt-2">
          {itens.map((a) => (
            <LinhaAConferir key={a.id} abastecimento={a} onAbrirVeiculo={onAbrirVeiculo} />
          ))}
        </ul>
      </Bloco>
    </div>
  );
}

function LinhaAConferir({
  abastecimento: a,
  onAbrirVeiculo,
}: {
  abastecimento: AbastecimentoAConferir;
  onAbrirVeiculo: (id: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onAbrirVeiculo(a.veiculo.id)}
          className="block text-left font-display text-base font-semibold text-tinta-900 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {a.veiculo.apelido}
          {a.veiculo.placa && (
            <span className="ml-1.5 text-xs font-normal text-tinta-400">{a.veiculo.placa}</span>
          )}
        </button>
        <span className="block text-sm text-tinta-700">{medida(a)}</span>
        <span className="block text-[11px] text-tinta-400">
          {dataEHora(a.data)} · {a.lancadoPor}
        </span>
        {a.temFoto && <FotoDoAbastecimento id={a.id} conferir={a} />}
      </span>
      <ValorDaNota abastecimento={a} />
    </li>
  );
}

/**
 * O campo de pôr (ou corrigir) o valor lido na nota.
 *
 * Aparece em dois lugares: na linha da fila e, `naFoto`, no rodapé da nota
 * aberta em tela cheia — que é onde o valor de verdade se lê, ampliado. Lá o
 * botão fecha a foto ao salvar: o trabalho daquela nota acabou.
 */
function ValorDaNota({
  abastecimento,
  naFoto = false,
  aoSalvar,
}: {
  abastecimento: Abastecimento;
  /** Sobre a tinta escura da foto em tela cheia: campo maior, rótulo claro. */
  naFoto?: boolean;
  aoSalvar?: () => void;
}) {
  const qc = useQueryClient();
  const [valor, setValor] = useState(
    abastecimento.valor != null ? abastecimento.valor.toFixed(2) : '',
  );
  /*
   * Os litros também se leem na nota, e é a mesma linha do papel: "45,99 Lts
   * de Gasolina C — 6,86 — 312,79". Quem abastece nem sempre olha a bomba, e
   * sem os litros não há média de consumo nenhuma — a conferência é a última
   * chance de pegá-los, com o papel à vista.
   */
  const [litros, setLitros] = useState(
    abastecimento.litros != null ? abastecimento.litros.toFixed(2) : '',
  );

  const salvar = useMutation({
    mutationFn: async () => {
      await api.patch(`/veiculos/abastecimentos/${abastecimento.id}`, {
        valor: Number(valor),
        // Em branco não mexe nos litros que já estavam lá.
        litros: litros ? Number(litros) : undefined,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['veiculos'] });
      aoSalvar?.();
    },
  });

  return (
    <span className={`flex flex-col gap-1 ${naFoto ? 'w-full' : 'items-end'}`}>
      <span className="flex flex-wrap items-center justify-end gap-2">
        {naFoto && (
          <label
            htmlFor={`valor-da-nota-${abastecimento.id}`}
            className="mr-auto text-sm font-semibold text-white/80"
          >
            Valor da nota
          </label>
        )}
        <span className="flex items-center gap-1.5">
          <CampoDinheiro
            id={`litros-da-nota-${abastecimento.id}`}
            valor={litros}
            onChange={setLitros}
            casas={2}
            placeholder="litros"
            className={`campo num text-right ${naFoto ? 'h-11 w-24 text-base' : 'w-20 py-1.5'}`}
          />
          <span className={`text-xs ${naFoto ? 'text-white/60' : 'text-tinta-400'}`}>L</span>
        </span>
        <CampoDinheiro
          id={naFoto ? `valor-da-nota-${abastecimento.id}` : undefined}
          valor={valor}
          onChange={setValor}
          className={`campo num text-right ${naFoto ? 'h-11 w-40 text-base' : 'w-32 py-1.5'}`}
          placeholder="valor da nota"
        />
        <button
          type="button"
          onClick={() => salvar.mutate()}
          disabled={!(Number(valor) > 0) || salvar.isPending}
          className={`btn btn-primario ${naFoto ? 'h-11 px-5' : 'btn-p'}`}
        >
          {salvar.isPending ? 'Salvando…' : naFoto ? 'Salvar e fechar' : 'Salvar'}
        </button>
      </span>
      {salvar.isError && (
        <span className={`text-xs ${naFoto ? 'text-rose-300' : 'text-rose-600'}`}>
          {mensagemErro(salvar.error)}
        </span>
      )}
    </span>
  );
}

function FotoDoAbastecimento({
  id,
  conferir,
}: {
  id: string;
  /**
   * O abastecimento que espera o valor. Presente, a nota em tela cheia leva o
   * campo no rodapé — lê-se o número ampliado e digita-se ali mesmo, sem
   * fechar a foto para procurar o campo na linha.
   */
  conferir?: Abastecimento;
}) {
  return (
    <FotoDoPonto
      chave={['veiculos', 'abastecimento', 'foto', id]}
      titulo="Nota do posto"
      buscar={async () =>
        (await api.get<{ foto: string }>(`/veiculos/abastecimentos/${id}/foto`)).data.foto
      }
      acao={
        conferir &&
        ((fechar) => <ValorDaNota abastecimento={conferir} naFoto aoSalvar={fechar} />)
      }
    />
  );
}

/**
 * A nota anexada a uma conta, aberta sob demanda.
 *
 * Sob demanda porque ler o anexo é uma ida ao IXC, e a ficha de um veículo com
 * vinte contas faria vinte delas só para desenhar a lista.
 */
function NotaDaConta({ idFnApagar }: { idFnApagar: number }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
      >
        {aberta ? 'Esconder a nota' : 'Ver a nota'}
      </button>
      {aberta && <NotasDoTitulo idFnApagar={idFnApagar} />}
    </>
  );
}

const dataEHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Lançar um abastecimento pela ficha: o km, a foto e, se já estiver à mão, o valor. */
function LancarAbastecimento({
  veiculo,
  onFechar,
}: {
  veiculo: VeiculoNaLista;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [medidorDigitado, setMedidorDigitado] = useState('');
  const [litrosDigitados, setLitrosDigitados] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);
  const [valor, setValor] = useState('');

  // O galão não tem painel; a máquina conta horas; o resto conta km.
  const ehGalao = veiculo.tipo === 'GALAO';
  const ehMaquina = veiculo.tipo === 'MAQUINA';
  const anterior = ehMaquina ? veiculo.ultimoHorimetro : veiculo.ultimoKm;

  const medidor = medidorNumero(medidorDigitado);
  const medidorAtras = anterior != null && medidor != null && medidor < anterior;
  // O campo guarda o canônico ("45.59"): a vírgula é só o que se vê.
  const litrosNumero = litrosDigitados ? Number(litrosDigitados) : null;

  const lancar = useMutation({
    mutationFn: async () => {
      await api.post(`/veiculos/${veiculo.id}/abastecimentos`, {
        ...(ehGalao ? {} : ehMaquina ? { horimetro: medidor } : { km: medidor }),
        ...(litrosNumero ? { litros: litrosNumero } : {}),
        foto: await juntarFotos(fotos),
        valor: Number(valor) > 0 ? Number(valor) : undefined,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['veiculos'] });
      onFechar();
    },
  });

  const valido =
    (ehGalao || (medidor != null && !medidorAtras)) &&
    (!ehGalao || (litrosNumero != null && litrosNumero > 0)) &&
    fotos.length > 0;

  return (
    <Janela titulo={`Abastecimento — ${veiculo.apelido}`} onFechar={onFechar}>
      <FormularioEmPassos>
      <div className="grid gap-4 sm:grid-cols-2">
        {!ehGalao && (
          <div>
            <label className="rotulo" htmlFor="abast-km-sistema">
              {ehMaquina ? 'Horímetro da máquina' : 'Km do painel'}
            </label>
            <input
              id="abast-km-sistema"
              value={medidorDigitado}
              onChange={(e) => setMedidorDigitado(medidorLimpo(e.target.value, ehMaquina))}
              inputMode={ehMaquina ? 'decimal' : 'numeric'}
              autoComplete="off"
              autoFocus
              placeholder={
                anterior != null
                  ? `último: ${formatMedidor(anterior, ehMaquina)}`
                  : ehMaquina
                    ? 'as horas do painel, com o ponto: 1261.9'
                    : 'só os números'
              }
              className="campo num"
            />
            {medidorAtras && anterior != null && (
              <p className="mt-1 text-xs font-semibold text-rose-600">
                O último abastecimento foi com {ehMaquina ? horas(anterior) : km(anterior)}.
                Confira o painel.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="rotulo" htmlFor="abast-litros-sistema">
            Litros
          </label>
          {/* Como o dinheiro: teclou 4559, está escrito 45,59. */}
          <CampoDinheiro
            id="abast-litros-sistema"
            valor={litrosDigitados}
            onChange={setLitrosDigitados}
            casas={2}
            placeholder={
              ehGalao
                ? veiculo.capacidadeLitros
                  ? `cabe ${veiculo.capacidadeLitros} L`
                  : 'quantos litros'
                : 'opcional'
            }
            className="campo num"
          />
          {ehGalao && (
            <p className="ajuda">É o estoque do galão: sem isto não há de onde tirar.</p>
          )}
        </div>
        <div>
          <label className="rotulo" htmlFor="abast-valor-sistema">
            Valor da nota
          </label>
          <CampoDinheiro
            id="abast-valor-sistema"
            valor={valor}
            onChange={setValor}
            placeholder="opcional"
          />
          <p className="ajuda">Em branco, vai para a conferência.</p>
        </div>
      </div>
      <p className="rotulo mt-4">Foto da nota</p>
      <FotoDaNota fotos={fotos} onFotos={setFotos} />

      {lancar.isError && <Aviso tom="erro">{mensagemErro(lancar.error)}</Aviso>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => lancar.mutate()}
          disabled={!valido || lancar.isPending}
          className="btn btn-primario"
        >
          {lancar.isPending ? 'Enviando…' : 'Lançar abastecimento'}
        </button>
      </div>
      </FormularioEmPassos>
    </Janela>
  );
}

/**
 * A ficha de um veículo: as duas somas, o que foi para cada categoria, cada
 * conta e cada abastecimento — e os botões de lançar uma conta ou um
 * abastecimento nele.
 */
function FichaDoVeiculo({ id, onFechar }: { id: string; onFechar: () => void }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [lancando, setLancando] = useState(false);
  const [abastecendo, setAbastecendo] = useState(false);
  const [manutencao, setManutencao] = useState(false);

  const ficha = useQuery({
    queryKey: ['veiculos', 'ficha', id],
    queryFn: async () => (await api.get<Ficha>(`/veiculos/${id}`)).data,
  });

  // O resumo da manutenção, para o botão dizer se há troca vencida. É a mesma
  // leitura que a área de manutenção faz: abrir o botão já a encontra pronta.
  const alertas = useQuery({
    queryKey: ['veiculos', 'manutencao', id],
    queryFn: async () =>
      (
        await api.get<{ resumo: { vencidos: number; perto: number; semRegistro: number } }>(
          `/veiculos/${id}/manutencao`,
        )
      ).data,
    enabled: !!ficha.data && ficha.data.veiculo.tipo !== 'GALAO',
  });

  const apagarAbastecimento = useMutation({
    mutationFn: async (abastecimentoId: string) => {
      await api.delete(`/veiculos/abastecimentos/${abastecimentoId}`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['veiculos'] }),
  });

  if (lancando && ficha.data) {
    return (
      <NovaDespesa
        veiculoInicial={{ id, apelido: ficha.data.veiculo.apelido }}
        onFechar={() => setLancando(false)}
      />
    );
  }
  if (abastecendo && ficha.data) {
    return (
      <LancarAbastecimento veiculo={ficha.data.veiculo} onFechar={() => setAbastecendo(false)} />
    );
  }
  if (manutencao) {
    return <ManutencaoDoVeiculo veiculoId={id} onFechar={() => setManutencao(false)} />;
  }
  if (editando && ficha.data) {
    return (
      <FormularioDoVeiculo
        veiculo={ficha.data.veiculo}
        onFechar={() => setEditando(false)}
        onApagado={onFechar}
      />
    );
  }

  const d = ficha.data;

  return (
    <Janela titulo={d?.veiculo.apelido ?? 'Veículo'} onFechar={onFechar}>
      {ficha.isLoading ? (
        <Carregando />
      ) : ficha.isError || !d ? (
        <Aviso tom="erro">{mensagemErro(ficha.error)}</Aviso>
      ) : (
        <>
          <p className="mb-4 text-[13px] text-tinta-500">
            {identificacao(d.veiculo)}
            {d.veiculo.responsaveis.length > 0 &&
              ` · com ${nomesDosResponsaveis(d.veiculo.responsaveis)}`}
            {!d.veiculo.ativo && ' · desligado'}
          </p>

          <div className="mb-4 flex flex-wrap gap-2">
            <button onClick={() => setLancando(true)} className="btn btn-primario">
              Lançar conta neste veículo
            </button>
            {d?.veiculo.ativo && (
              <button onClick={() => setAbastecendo(true)} className="btn btn-neutro">
                Lançar abastecimento
              </button>
            )}
            <button onClick={() => setEditando(true)} className="btn btn-neutro">
              Editar
            </button>
            {/* O galão não anda: não tem óleo, pneu nem correia. */}
            {d.veiculo.tipo !== 'GALAO' && (
              <button
                onClick={() => setManutencao(true)}
                className="btn btn-neutro"
                title="Óleo, filtros, pneus, correia: quando foi a última troca e quanto falta para a próxima"
              >
                Manutenção
                {alertas.data && alertas.data.resumo.vencidos > 0 ? (
                  <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
                    {alertas.data.resumo.vencidos}
                  </span>
                ) : alertas.data && alertas.data.resumo.perto > 0 ? (
                  <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                    {alertas.data.resumo.perto}
                  </span>
                ) : null}
              </button>
            )}
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-tinta-50 p-4">
              <p className="eyebrow">Peças e serviços</p>
              <p className="valor mt-1 text-2xl">{formatBRL(d.veiculo.gasto)}</p>
              <p className="mt-0.5 text-xs text-tinta-500">
                {d.veiculo.quantidade} conta(s)
                {d.veiculo.emAberto > 0 && ` · ${formatBRL(d.veiculo.emAberto)} ainda em aberto`}
              </p>
            </div>
            {/*
             * No galão a pergunta é outra: não é quanto ele gastou, é quanto
             * ainda há dentro dele e por quanto saiu o litro — o gasto só
             * acontece quando o combustível entra numa máquina.
             */}
            {d.veiculo.estoque ? (
              <div className="rounded-2xl bg-tinta-50 p-4">
                <p className="eyebrow">No galão</p>
                <p className="valor mt-1 text-2xl">{litros(d.veiculo.estoque.litros)}</p>
                <p className="mt-0.5 text-xs text-tinta-500">
                  {d.veiculo.estoque.precoPorLitro != null
                    ? `${formatBRL(d.veiculo.estoque.precoPorLitro)} o litro · ${formatBRL(d.veiculo.estoque.valor ?? 0)} parados aí`
                    : 'sem nota conferida ainda: o preço do litro não dá para saber'}
                </p>
                <p className="mt-0.5 text-xs text-tinta-500">
                  {formatBRL(d.combustivel.total)} comprados em{' '}
                  {d.combustivel.quantidade} ida(s) ao posto
                </p>
                {d.veiculo.estoque.litrosSemValor > 0 && (
                  <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-300">
                    {litros(d.veiculo.estoque.litrosSemValor)} com a nota na conferência
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-tinta-50 p-4">
                <p className="eyebrow">Combustível</p>
                <p className="valor mt-1 text-2xl">{formatBRL(d.combustivel.total)}</p>
                <p className="mt-0.5 text-xs text-tinta-500">
                  {d.combustivel.quantidade} abastecimento(s)
                  {d.combustivel.litros > 0 && ` · ${litros(d.combustivel.litros)}`}
                  {d.combustivel.ultimoKm != null && ` · último com ${km(d.combustivel.ultimoKm)}`}
                  {d.combustivel.ultimoHorimetro != null &&
                    ` · último com ${horas(d.combustivel.ultimoHorimetro)}`}
                  {d.combustivel.custoPorKm != null &&
                    ` · ${formatBRL(d.combustivel.custoPorKm)} por km`}
                  {d.combustivel.custoPorHora != null &&
                    ` · ${formatBRL(d.combustivel.custoPorHora)} por hora`}
                </p>
                {d.combustivel.aConferir > 0 && (
                  <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-300">
                    {d.combustivel.aConferir} na conferência, fora do total
                  </p>
                )}
              </div>
            )}

            {/*
             * A média, num cartão só dela.
             *
             * É o número que diz se o veículo está bem, e ele não sai de soma
             * nenhuma: cada abastecimento novo o refaz. O galão não entra —
             * ele não anda, e o que sai dele vira consumo de quem o bebeu.
             */}
            {d.veiculo.tipo !== 'GALAO' && (
              <div className="rounded-2xl bg-tinta-50 p-4 sm:col-span-2">
                <p className="eyebrow">Média de consumo</p>
                {d.combustivel.consumo.medio != null ? (
                  <>
                    <p
                      className={`valor mt-1 text-2xl ${
                        d.combustivel.consumo.irregular
                          ? 'text-amber-600 dark:text-amber-300'
                          : ''
                      }`}
                    >
                      {formatConsumo(
                        d.combustivel.consumo.medio,
                        d.combustivel.consumo.unidade,
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-tinta-500">
                      de {d.combustivel.consumo.base} abastecimento(s) com medidor
                      {d.combustivel.consumo.ultimo != null &&
                        ` · no último trecho, ${formatConsumo(
                          d.combustivel.consumo.ultimo,
                          d.combustivel.consumo.unidade,
                        )}`}
                      {d.combustivel.consumo.ideal != null &&
                        ` · esperado ${formatConsumo(
                          d.combustivel.consumo.ideal,
                          d.combustivel.consumo.unidade,
                        )}`}
                    </p>
                    {/* O amarelo do consumo irregular, com o que olhar. */}
                    {(d.combustivel.consumo.irregular ||
                      d.combustivel.consumo.ultimoIrregular) &&
                      d.combustivel.consumo.ideal != null && (
                        <p className="mt-1.5 text-xs font-semibold text-amber-600 dark:text-amber-300">
                          Consumo irregular:{' '}
                          {d.combustivel.consumo.irregular
                            ? 'a média está pior do que a esperada'
                            : 'o último trecho veio pior do que o esperado'}
                          . Vale olhar pneu, filtro e por onde o combustível está
                          indo.
                        </p>
                      )}
                    {d.combustivel.consumo.ideal == null && (
                      <p className="mt-1.5 text-xs text-tinta-400">
                        Diga em "Editar" a média que se espera dele, e esta tela
                        avisa sozinha quando ela cair.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="valor mt-1 text-2xl text-tinta-300">—</p>
                    <p className="mt-0.5 text-xs text-tinta-500">
                      A média nasce do segundo abastecimento: é a distância entre
                      dois deles, pelos litros que entraram no caminho. Lance com o{' '}
                      {d.veiculo.tipo === 'MAQUINA' ? 'horímetro' : 'km'} e os litros,
                      e ela aparece aqui.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {d.porCategoria.length > 0 && (
            <div className="mb-5">
              <p className="eyebrow mb-2">Para onde foi</p>
              <ul className="lista-dividida rounded-xl border border-tinta-200">
                {d.porCategoria.map((c) => (
                  <li key={c.nome} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-tinta-700">{c.nome}</span>
                    <span className="valor">{formatBRL(c.valor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="eyebrow mb-2">Contas lançadas</p>
          {d.gastos.length === 0 ? (
            <p className="mb-5 text-sm text-tinta-400">
              Nenhuma conta ainda. Use "Lançar conta neste veículo", ou marque o veículo
              no "Lançar conta" da tela Em aberto.
            </p>
          ) : (
            <ul className="lista-dividida mb-5 rounded-xl border border-tinta-200">
              {d.gastos.map((g) => (
                <li key={g.contaId} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm text-tinta-800">{g.observacao}</span>
                    <span className="block text-[11px] text-tinta-400">
                      {formatData(g.vencimento)} · {g.fornecedor}
                      {g.idFnApagarIxc ? ` · título ${g.idFnApagarIxc}` : ''}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Selo pequeno tom={g.categoria ? 'info' : 'atencao'}>
                        {g.categoria?.nome ?? 'sem categoria'}
                      </Selo>
                      <Selo
                        pequeno
                        tom={
                          g.situacao === 'paga'
                            ? 'pago'
                            : g.situacao === 'em aberto'
                              ? 'neutro'
                              : 'erro'
                        }
                      >
                        {g.situacao === 'nao enviada' ? 'não chegou ao IXC' : g.situacao}
                      </Selo>
                    </span>
                    {/* A nota que se anexou ao lançar a conta mora no IXC, e é
                        de lá que ela volta — quem anexou o cupom vem procurá-lo
                        aqui, na ficha do veículo. */}
                    {g.idFnApagarIxc != null && <NotaDaConta idFnApagar={g.idFnApagarIxc} />}
                  </span>
                  <span
                    className={`valor whitespace-nowrap ${
                      g.situacao === 'cancelada' || g.situacao === 'nao enviada'
                        ? 'text-tinta-400 line-through'
                        : ''
                    }`}
                  >
                    {formatBRL(g.valor)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="eyebrow mb-2">Abastecimentos</p>
          {d.abastecimentos.length === 0 ? (
            <p className="text-sm text-tinta-400">
              Nenhum ainda. Use "Lançar abastecimento" aqui em cima
              {d.veiculo.responsaveis.length > 0
                ? `, ou ${nomesDosResponsaveis(d.veiculo.responsaveis)} ${
                    d.veiculo.responsaveis.length > 1 ? 'lançam' : 'lança'
                  } pelo celular.`
                : ' — ou escolha os responsáveis em Editar, e eles lançam pelo celular.'}
            </p>
          ) : (
            <ul className="lista-dividida rounded-xl border border-tinta-200">
              {d.abastecimentos.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-tinta-800">
                      {medida(a)} ·{' '}
                      {a.valor != null ? (
                        <span className="valor">{formatBRL(a.valor)}</span>
                      ) : (
                        <span className="font-semibold text-amber-600 dark:text-amber-300">
                          na conferência
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-tinta-400">
                      {dataEHora(a.data)} · {a.lancadoPor}
                      {a.conferidoPor && a.conferidoPor !== a.lancadoPor && ` · conferido por ${a.conferidoPor}`}
                    </span>
                    {a.temFoto && <FotoDoAbastecimento id={a.id} conferir={a} />}
                  </span>
                  <span className="flex flex-col items-end gap-2">
                    {/* Com valor, dá para corrigir; sem, é a conferência ali mesmo. */}
                    <ValorDaNota abastecimento={a} />
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Apagar o abastecimento de ${medida(a)}?`)) {
                          apagarAbastecimento.mutate(a.id);
                        }
                      }}
                      disabled={apagarAbastecimento.isPending}
                      className="btn btn-sutil btn-p text-rose-600"
                    >
                      Apagar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {apagarAbastecimento.isError && (
            <Aviso tom="erro">{mensagemErro(apagarAbastecimento.error)}</Aviso>
          )}

          {/* O que saiu do galão, e para onde: a máquina da frota ou o destino
              escrito — a roçadeira, o sítio. O valor é o do litro que estava
              dentro dele, e não de nota nenhuma. */}
          {d.veiculo.tipo === 'GALAO' && (
            <>
              <p className="eyebrow mb-2 mt-5">Saídas do galão</p>
              {!d.saidas?.length ? (
                <p className="text-sm text-tinta-400">
                  Nada saiu dele ainda. A saída se lança pelo portal ou pela Minha área,
                  em "Tirei do galão".
                </p>
              ) : (
                <ul className="lista-dividida rounded-xl border border-tinta-200">
                  {d.saidas.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-tinta-800">
                          {s.veiculo ? (
                            <strong>{s.veiculo.apelido}</strong>
                          ) : (
                            <>
                              <strong>{s.outroDestino}</strong>{' '}
                              <span className="text-xs text-tinta-400">(fora da frota)</span>
                            </>
                          )}{' '}
                          · {medida(s)}
                          {s.valor != null && (
                            <>
                              {' '}· <span className="valor">{formatBRL(s.valor)}</span>
                            </>
                          )}
                        </span>
                        <span className="block text-[11px] text-tinta-400">
                          {dataEHora(s.data)} · {s.lancadoPor}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            confirm(
                              `Apagar a saída de ${medida(s)} para ${s.veiculo?.apelido ?? s.outroDestino}? Os litros voltam para o galão.`,
                            )
                          ) {
                            apagarAbastecimento.mutate(s.id);
                          }
                        }}
                        disabled={apagarAbastecimento.isPending}
                        className="btn btn-sutil btn-p text-rose-600"
                      >
                        Apagar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </Janela>
  );
}

/** Quem pode ficar com um veículo: funcionário, ou login de quem não é um. */
interface Candidato {
  id: string;
  nome: string;
  apelido: string | null;
  /** O dono, o administrador: não estão na folha, e ficam pelo login. */
  login?: boolean;
}

/**
 * Quem abastece este veículo — um, ou quantos forem.
 *
 * Quem já está fica à vista, em cima, cada um com o seu "×"; a lista de baixo
 * só oferece quem ainda não entrou. Não é um `select` de vários: segurar Ctrl
 * para marcar dois nomes não existe no celular, e é do celular que se mexe
 * nisto no pátio.
 *
 * Os funcionários vêm primeiro; embaixo, os logins de quem não é funcionário
 * — o dono, o administrador —, que abastecem pelo cartão da tela de módulos.
 */
function EscolherResponsaveis({
  escolhidos,
  candidatos,
  carregando,
  onMudar,
}: {
  escolhidos: string[];
  candidatos: Candidato[];
  carregando: boolean;
  onMudar: (ids: string[]) => void;
}) {
  const porId = new Map(candidatos.map((f) => [f.id, f]));
  const faltam = candidatos.filter((f) => !escolhidos.includes(f.id));
  const funcionarios = faltam.filter((f) => !f.login);
  const logins = faltam.filter((f) => f.login);

  return (
    <>
      {escolhidos.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {escolhidos.map((id) => {
            const f = porId.get(id);
            return (
              <button
                key={id}
                type="button"
                title="Tirar deste veículo"
                onClick={() => onMudar(escolhidos.filter((x) => x !== id))}
                className="rounded-full border border-emerald-300 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:border-rose-300 hover:bg-rose-500/10 hover:text-rose-700 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:border-rose-500/40 dark:hover:text-rose-300"
              >
                {f ? nomeDoFuncionario(f) : 'Responsável'}
                <span aria-hidden className="ml-1.5 font-sans">
                  ×
                </span>
              </button>
            );
          })}
        </div>
      )}
      <select
        id="vei-responsavel"
        // Volta sempre ao vazio: o que foi escolhido virou chip ali em cima.
        value=""
        onChange={(e) => {
          if (e.target.value) onMudar([...escolhidos, e.target.value]);
        }}
        className="campo"
        disabled={carregando || faltam.length === 0}
      >
        <option value="">
          {carregando
            ? 'Carregando…'
            : faltam.length === 0
              ? escolhidos.length === 0
                ? 'Nenhum funcionário para escolher'
                : 'Todos já estão neste veículo'
              : escolhidos.length === 0
                ? 'Ninguém — escolha quem abastece…'
                : 'Pôr mais um…'}
        </option>
        {funcionarios.length > 0 && (
          <optgroup label="Funcionários">
            {funcionarios.map((f) => (
              <option key={f.id} value={f.id}>
                {nomeDoFuncionario(f)}
              </option>
            ))}
          </optgroup>
        )}
        {logins.length > 0 && (
          <optgroup label="Logins de quem não é funcionário">
            {logins.map((f) => (
              <option key={f.id} value={f.id}>
                {nomeDoFuncionario(f)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </>
  );
}

const nomeDoFuncionario = (f: Candidato) =>
  f.login ? `${f.nome} (login)` : f.apelido ? `${f.apelido} (${f.nome})` : f.nome;

/** Cadastrar um veículo, ou editar, desligar e apagar um que já existe. */
function FormularioDoVeiculo({
  veiculo,
  onFechar,
  onApagado,
}: {
  veiculo?: VeiculoNaLista;
  onFechar: () => void;
  onApagado?: () => void;
}) {
  const qc = useQueryClient();
  const [apelido, setApelido] = useState(veiculo?.apelido ?? '');
  const [tipo, setTipo] = useState<TipoVeiculo>(veiculo?.tipo ?? 'MOTO');
  const [placa, setPlaca] = useState(veiculo?.placa ?? '');
  const [modelo, setModelo] = useState(veiculo?.modelo ?? '');
  const [ano, setAno] = useState(veiculo?.ano ? String(veiculo.ano) : '');
  const [combustivel, setCombustivel] = useState<Combustivel | ''>(
    veiculo?.tipoCombustivel ?? '',
  );
  const [capacidade, setCapacidade] = useState(
    veiculo?.capacidadeLitros ? String(veiculo.capacidadeLitros) : '',
  );
  const [responsaveisIds, setResponsaveisIds] = useState<string[]>(
    veiculo?.responsaveis.map((r) => r.id) ?? [],
  );
  const [consumoIdeal, setConsumoIdeal] = useState(
    veiculo?.consumoIdeal != null ? veiculo.consumoIdeal.toFixed(2) : '',
  );
  const [observacao, setObservacao] = useState(veiculo?.observacao ?? '');

  const responsaveis = useQuery({
    queryKey: ['veiculos', 'responsaveis'],
    queryFn: async () =>
      (
        await api.get<Candidato[]>('/veiculos/responsaveis')
      ).data,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['veiculos'] });
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const dados = {
        apelido: apelido.trim(),
        tipo,
        placa: placa.trim() || (veiculo ? null : undefined),
        modelo: modelo.trim() || (veiculo ? null : undefined),
        ano: ano ? Number(ano) : veiculo ? null : undefined,
        combustivel: combustivel || (veiculo ? null : undefined),
        capacidadeLitros: capacidade
          ? Number(capacidade)
          : veiculo
            ? null
            : undefined,
        responsaveisIds,
        consumoIdeal: consumoIdeal ? Number(consumoIdeal) : veiculo ? null : undefined,
        observacao: observacao.trim() || (veiculo ? null : undefined),
      };
      if (veiculo) await api.patch(`/veiculos/${veiculo.id}`, dados);
      else await api.post('/veiculos', dados);
    },
    onSuccess: () => {
      recarregar();
      onFechar();
    },
  });

  const ligar = useMutation({
    mutationFn: async (ativo: boolean) => {
      await api.patch(`/veiculos/${veiculo!.id}`, { ativo });
    },
    onSuccess: () => {
      recarregar();
      onFechar();
    },
  });

  const apagar = useMutation({
    mutationFn: async () => {
      await api.delete(`/veiculos/${veiculo!.id}`);
    },
    onSuccess: () => {
      recarregar();
      onFechar();
      onApagado?.();
    },
  });

  const ehGalao = tipo === 'GALAO';
  const ehMaquina = tipo === 'MAQUINA';
  const valido = apelido.trim().length >= 2 && (!ano || /^\d{4}$/.test(ano));
  const erro = salvar.error ?? ligar.error ?? apagar.error;

  /* No celular, uma pergunta por vez; no computador, a ficha inteira. */
  const a = useAssistente([
    {
      rotulo: 'Nome e tipo',
      resumo: [apelido.trim() || null, rotuloDoTipo(tipo)].filter(Boolean).join(' · '),
      falta: apelido.trim().length >= 2 ? undefined : 'Diga como vocês chamam este veículo.',
    },
    {
      rotulo: ehGalao ? 'O que ele carrega' : 'Placa, combustível e modelo',
      resumo: ehGalao
        ? [rotuloDoCombustivel(combustivel || null), capacidade ? `${capacidade} L` : null]
            .filter(Boolean)
            .join(' · ')
        : [placa.trim() || null, rotuloDoCombustivel(combustivel || null), modelo.trim() || null]
            .filter(Boolean)
            .join(' · '),
    },
    {
      rotulo: 'Média esperada',
      pular: ehGalao,
      resumo: consumoIdeal || undefined,
    },
    {
      rotulo: 'Quem abastece',
      resumo: responsaveisIds.length
        ? `${responsaveisIds.length} responsável(is)`
        : undefined,
    },
    { rotulo: 'Observação', resumo: observacao.trim() || undefined },
  ]);

  return (
    <Janela titulo={veiculo ? `Editar — ${veiculo.apelido}` : 'Cadastrar veículo'} onFechar={onFechar}>
      {a.cabecalho}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {a.mostrar(0) && (
        <>
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="vei-apelido">
            Como vocês chamam
          </label>
          <input
            id="vei-apelido"
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            className="campo"
            placeholder="Moto do almoxarifado, Hilux, Trator"
            autoComplete="off"
            autoFocus
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="vei-tipo">
            Tipo
          </label>
          <select
            id="vei-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoVeiculo)}
            className="campo"
          >
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </div>
        </>
        )}

        {/*
         * O galão não tem placa nem modelo: o que ele tem é o que carrega e
         * quanto cabe. São esses dois campos que ocupam o lugar.
         */}
        {a.mostrar(1) && (
        <>
        {ehGalao ? (
          <div>
            <label className="rotulo" htmlFor="vei-capacidade">
              Cabem quantos litros
            </label>
            <input
              id="vei-capacidade"
              value={capacidade}
              onChange={(e) => setCapacidade(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="campo num"
              inputMode="numeric"
              placeholder="200"
              autoComplete="off"
            />
          </div>
        ) : (
          <div>
            <label className="rotulo" htmlFor="vei-placa">
              Placa
            </label>
            <input
              id="vei-placa"
              value={placa}
              onChange={(e) => setPlaca(e.target.value.toUpperCase().slice(0, 8))}
              className="campo num uppercase"
              placeholder="opcional"
              autoComplete="off"
            />
          </div>
        )}

        <div>
          <label className="rotulo" htmlFor="vei-combustivel">
            {ehGalao ? 'O que ele carrega' : 'Combustível'}
          </label>
          <select
            id="vei-combustivel"
            value={combustivel}
            onChange={(e) => setCombustivel(e.target.value as Combustivel | '')}
            className="campo"
          >
            <option value="">{ehGalao ? 'Escolha…' : 'Não informado'}</option>
            {COMBUSTIVEIS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.rotulo}
              </option>
            ))}
          </select>
          {ehGalao && (
            <p className="ajuda">
              Um galão, um combustível: é dele que sai o preço do litro que a máquina
              consome.
            </p>
          )}
        </div>
        <div>
          <label className="rotulo" htmlFor="vei-modelo">
            Marca e modelo
          </label>
          <input
            id="vei-modelo"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            className="campo"
            placeholder="Honda CG 160"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="vei-ano">
            Ano
          </label>
          <input
            id="vei-ano"
            value={ano}
            onChange={(e) => setAno(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="campo num"
            inputMode="numeric"
            placeholder="opcional"
            autoComplete="off"
          />
        </div>
        </>
        )}

        {/*
         * A média esperada não é cálculo: é o que a casa sabe do veículo. Com
         * ela, a lista acende o amarelo sozinha quando a média de verdade cai.
         * O galão não tem: ele não anda.
         */}
        {a.mostrar(2) && !ehGalao && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="vei-consumo-ideal">
              {ehMaquina
                ? 'Média esperada (litros por hora)'
                : 'Média esperada (km por litro)'}
            </label>
            <CampoDinheiro
              id="vei-consumo-ideal"
              valor={consumoIdeal}
              onChange={setConsumoIdeal}
              casas={2}
              placeholder={ehMaquina ? 'quantos litros por hora' : 'quantos km por litro'}
              className="campo num w-40"
            />
            <p className="ajuda">
              {ehMaquina
                ? 'Comendo mais litros por hora do que isto, a lista marca o veículo de amarelo: consumo irregular.'
                : 'Fazendo menos km por litro do que isto, a lista marca o veículo de amarelo: consumo irregular.'}
            </p>
          </div>
        )}

        {a.mostrar(3) && (
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="vei-responsavel">
            Responsáveis (quem abastece)
          </label>
          <EscolherResponsaveis
            escolhidos={responsaveisIds}
            candidatos={responsaveis.data ?? []}
            carregando={responsaveis.isLoading}
            onMudar={setResponsaveisIds}
          />
          <p className="ajuda">
            Cada um deles lança o abastecimento deste veículo, com o km e a foto da
            nota: o funcionário pelo portal, com o CPF, ou pelo login; quem não é
            funcionário (o dono, o administrador), pelo cartão Abastecimento da tela
            de módulos. Pode ser mais de um — o carro de dois, a máquina que troca de
            operador.
          </p>
        </div>
        )}
        {a.mostrar(4) && (
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="vei-obs">
            Observação
          </label>
          <input
            id="vei-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
            placeholder="opcional"
            autoComplete="off"
          />
        </div>
        )}
      </div>

      {a.resumo}
      {a.barra}

      {erro && <Aviso tom="erro">{mensagemErro(erro)}</Aviso>}

      {a.mostrarAcao && (
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {veiculo && (
          <span className="mr-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => ligar.mutate(!veiculo.ativo)}
              disabled={ligar.isPending}
              className="btn btn-sutil btn-p"
              title={
                veiculo.ativo
                  ? 'Vendido ou parado: sai da escolha no lançamento, o histórico fica'
                  : 'Volta para a escolha no lançamento'
              }
            >
              {veiculo.ativo ? 'Desligar' : 'Religar'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Apagar ${veiculo.apelido}? Só dá se ele não tiver nenhum gasto.`)) {
                  apagar.mutate();
                }
              }}
              disabled={apagar.isPending}
              className="btn btn-sutil btn-p text-rose-600"
            >
              Apagar
            </button>
          </span>
        )}
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => salvar.mutate()}
          disabled={!valido || salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : veiculo ? 'Salvar' : 'Cadastrar'}
        </button>
      </div>
      )}
    </Janela>
  );
}
