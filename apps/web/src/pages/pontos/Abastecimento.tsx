import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FotoDaNota } from '../../components/FotoDaNota';
import { Aviso, CampoDinheiro, Carregando } from '../../components/ui';
import { mensagemErro } from '../../lib/api';
import {
  formatBRL,
  formatConsumo,
  formatMedidor,
  medidorLimpo,
  medidorNumero as numeroDoMedidor,
} from '../../lib/format';
import { juntarFotos } from '../../lib/foto';
import { apiPontos } from '../../lib/pontos';

export interface AbastecimentoDoPortal {
  id: string;
  /** Null = o administrador ainda não conferiu a nota. */
  valor: number | null;
  km: number | null;
  horimetro: number | null;
  litros: number | null;
  /** De qual galão saiu. Null = veio do posto. */
  galao: { id: string; apelido: string } | null;
  data: string;
  lancadoPor: string;
  temFoto: boolean;
}

/** O que há dentro de um galão, e por quanto saiu o litro. */
export interface EstoqueDoGalao {
  litros: number;
  precoPorLitro: number | null;
  valor: number | null;
  litrosSemValor: number;
}

/** A média que o veículo está fazendo. O galão não tem: ele não anda. */
export interface Consumo {
  medio: number | null;
  /** Só o trecho entre os dois últimos abastecimentos. */
  ultimo: number | null;
  unidade: 'km_por_litro' | 'litros_por_hora';
  base: number;
  /** A média que se espera dele, cadastrada na ficha. */
  ideal: number | null;
  /** A média está pior do que a esperada. */
  irregular: boolean;
  /** O último trecho está pior, mesmo com a média geral de pé. */
  ultimoIrregular: boolean;
}

export interface VeiculoDoPortal {
  id: string;
  apelido: string;
  tipo: string;
  placa: string | null;
  modelo: string | null;
  combustivel: string | null;
  capacidadeLitros: number | null;
  ultimoKm: number | null;
  ultimoHorimetro: number | null;
  /** Só os galões têm. */
  estoque: EstoqueDoGalao | null;
  /** A média dele, refeita a cada abastecimento. Null no galão. */
  consumo: Consumo | null;
  ultimos: AbastecimentoDoPortal[];
}

/** Para onde o combustível do galão pode ir: a frota que está ligada. */
export interface DestinoDoGalao {
  id: string;
  apelido: string;
  tipo: string;
  placa: string | null;
  ultimoKm: number | null;
  ultimoHorimetro: number | null;
}

export interface VeiculosDoResponsavel {
  nome: string;
  veiculos: VeiculoDoPortal[];
  destinos: DestinoDoGalao[];
  /** Os outros destinos já escritos numa saída de galão — o campo os sugere. */
  outrosDestinos?: string[];
}

export interface DadosDoAbastecimento {
  /** Na saída do galão para outro destino, não vai: quem diz é `outroDestino`. */
  veiculoId?: string;
  /** Na saída do galão, o que não é da frota: "roçadeira", "sítio". */
  outroDestino?: string;
  km?: number;
  horimetro?: number;
  litros?: number;
  /** Preenchido, estes litros saem deste galão e não do posto. */
  galaoId?: string;
  foto?: string;
}

/**
 * De onde vêm os veículos e para onde vai o lançamento.
 *
 * São duas portas para a mesma tela: o portal, que sabe quem é a pessoa pelo
 * CPF, e a tela do colaborador, que sabe pelo login. A tela não precisa saber
 * qual das duas a abriu.
 */
export interface FonteDoAbastecimento {
  chave: unknown[];
  buscar: () => Promise<VeiculosDoResponsavel>;
  lancar: (dados: DadosDoAbastecimento) => Promise<unknown>;
}

const chaveDoCpf = (cpf: string) => ['pontos', 'abastecimento', cpf];

async function veiculosDoCpf(cpf: string) {
  return (
    await apiPontos.post<VeiculosDoResponsavel>('/pontos/abastecimento/veiculos', { cpf })
  ).data;
}

/** Os veículos que estão no nome deste CPF. Vazio = ele não abastece nenhum. */
export function useVeiculosDoCpf(cpf: string, ativo = true) {
  return useQuery({
    queryKey: chaveDoCpf(cpf),
    queryFn: () => veiculosDoCpf(cpf),
    enabled: ativo && cpf.length === 11,
    retry: 0,
  });
}

/** O abastecimento de quem entrou no portal com o CPF. */
export function TelaDeAbastecimento({ cpf }: { cpf: string }) {
  return (
    <FormularioDeAbastecimento
      chave={chaveDoCpf(cpf)}
      buscar={() => veiculosDoCpf(cpf)}
      lancar={async (dados) => (await apiPontos.post('/pontos/abastecimento', { cpf, ...dados })).data}
    />
  );
}

const km = (n: number) => `${formatMedidor(n)} km`;
/** O horímetro como no painel da máquina, com o ponto do décimo: "1252.6 h". */
const horas = (n: number) => `${formatMedidor(n, true)} h`;
const litrosEscritos = (n: number) =>
  `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L`;

const COMBUSTIVEL_NOME: Record<string, string> = {
  DIESEL_S500: 'Diesel S500',
  DIESEL_S10: 'Diesel S10',
  GASOLINA: 'Gasolina',
  ETANOL: 'Etanol',
  ARLA: 'Arla',
};

/**
 * Os litros são digitados como o dinheiro: a vírgula se monta sozinha.
 *
 * No posto se tecla 4559 e sai "45,59" — ninguém procura a vírgula no teclado
 * do celular com a bomba na mão. O que o campo guarda é o canônico ("45.59"),
 * que é o que a API espera.
 */
const LITROS_COM_CASAS = 2;

/** A opção da lista de destinos que abre o campo de escrever. */
const OUTRO_DESTINO = 'outro';

/**
 * O abastecimento, lançado por quem anda com o veículo, na hora, no posto.
 *
 * São três coisas que acontecem aqui, e a tela vira de acordo com o que está
 * escolhido:
 *
 * - **o carro no posto**: o km do painel e a foto da nota, como sempre foi —
 *   ou o horímetro, quando quem foi ao posto é a máquina;
 * - **o galão no posto**: quantos litros entraram e a foto da nota — galão não
 *   tem painel, tem estoque;
 * - **o que sai do galão**: quantos litros saíram e para onde — a máquina da
 *   frota, com o horímetro dela, ou outro destino escrito (a roçadeira, o
 *   sítio), que não tem painel. Não há nota nenhuma aqui: aquele combustível
 *   já foi pago no dia em que o galão foi enchido, e o que a saída custou sai
 *   do preço do litro que está dentro dele.
 *
 * Tudo grande, para o dedo e para a luz do sol: é uma tela de posto de
 * gasolina, e às vezes de canteiro de obra.
 */
export function FormularioDeAbastecimento({ chave, buscar, lancar: enviar }: FonteDoAbastecimento) {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: chave, queryFn: buscar, retry: 0 });
  const veiculos = consulta.data?.veiculos ?? [];
  const destinos = consulta.data?.destinos ?? [];

  const [veiculoId, setVeiculoId] = useState('');
  /** No galão: encher no posto, ou despejar numa máquina. */
  const [modo, setModo] = useState<'posto' | 'saida'>('posto');
  const [destinoId, setDestinoId] = useState('');
  /** Escolhido "Outro destino": para onde foi, escrito. */
  const [outroDestino, setOutroDestino] = useState('');
  const [medidorDigitado, setMedidorDigitado] = useState('');
  const [litrosDigitados, setLitrosDigitados] = useState('');
  /** A nota e, se precisar, o visor da bomba: vão juntas, lado a lado. */
  const [fotos, setFotos] = useState<string[]>([]);
  const [feito, setFeito] = useState<string | null>(null);

  // Um veículo só: já vem escolhido. Perguntar qual, com uma opção, é um toque cobrado à toa.
  const unico = veiculos.length === 1 ? veiculos[0].id : null;
  useEffect(() => {
    if (!veiculoId && unico) setVeiculoId(unico);
  }, [unico, veiculoId]);

  const veiculo = veiculos.find((v) => v.id === veiculoId) ?? null;
  const ehGalao = veiculo?.tipo === 'GALAO';
  const tirandoDoGalao = ehGalao && modo === 'saida';

  // Quem recebe o combustível: a máquina escolhida, ou o próprio veículo.
  const destino = tirandoDoGalao ? (destinos.find((d) => d.id === destinoId) ?? null) : null;
  /** Saindo do galão para o que não é da frota — sem veículo, sem painel. */
  const paraOutroDestino = tirandoDoGalao && destinoId === OUTRO_DESTINO;
  const outroDestinoEscrito = outroDestino.trim();
  /** Quem recebe o combustível: a máquina que foi ao posto também é máquina. */
  const recebe = tirandoDoGalao ? destino : veiculo;
  const ehMaquina = recebe?.tipo === 'MAQUINA';
  /** O galão não tem painel; a máquina conta horas; o resto conta km. */
  const pedeMedidor = tirandoDoGalao ? !!destino : !ehGalao;
  const pedeFoto = !tirandoDoGalao;
  const pedeLitros = ehGalao || tirandoDoGalao;

  const medidorAnterior = ehMaquina
    ? (recebe?.ultimoHorimetro ?? null)
    : (recebe?.ultimoKm ?? null);

  const medidor = numeroDoMedidor(medidorDigitado);
  const medidorAtras =
    medidorAnterior != null && medidor != null && medidor < medidorAnterior;

  const litros = litrosDigitados ? Number(litrosDigitados) : null;
  const estoque = veiculo?.estoque ?? null;
  const passaDoEstoque =
    tirandoDoGalao && litros != null && estoque != null && litros > estoque.litros;

  // Trocar de veículo recomeça a tela: o km do carro não é o litro do galão.
  useEffect(() => {
    setModo('posto');
    setDestinoId('');
    setOutroDestino('');
    setMedidorDigitado('');
    setLitrosDigitados('');
  }, [veiculoId]);

  const lancar = useMutation({
    mutationFn: async () =>
      enviar({
        ...(paraOutroDestino
          ? { outroDestino: outroDestinoEscrito }
          : { veiculoId: tirandoDoGalao ? destinoId : veiculoId }),
        ...(tirandoDoGalao ? { galaoId: veiculoId } : {}),
        ...(pedeMedidor
          ? ehMaquina
            ? { horimetro: medidor ?? 0 }
            : { km: medidor ?? 0 }
          : {}),
        ...(litros != null ? { litros } : {}),
        ...(pedeFoto ? { foto: await juntarFotos(fotos) } : {}),
      }),
    onSuccess: () => {
      setFeito(
        tirandoDoGalao
          ? `${litrosEscritos(litros ?? 0)} do ${veiculo?.apelido} em ${
              paraOutroDestino ? outroDestinoEscrito : destino?.apelido
            }.`
          : ehGalao
            ? `${veiculo?.apelido} enchido com ${litrosEscritos(litros ?? 0)}. A nota vai para a conferência.`
            : `Abastecimento lançado em ${veiculo?.apelido} com ${
                ehMaquina ? horas(medidor ?? 0) : km(medidor ?? 0)
              }. A nota vai para a conferência.`,
      );
      setMedidorDigitado('');
      setLitrosDigitados('');
      setFotos([]);
      void qc.invalidateQueries({ queryKey: chave });
    },
  });

  if (consulta.isLoading) return <Carregando texto="Buscando seus veículos…" />;
  if (consulta.isError) return <Aviso tom="erro">{mensagemErro(consulta.error)}</Aviso>;
  if (veiculos.length === 0) {
    return (
      <Aviso tom="info">
        Nenhum veículo está no seu nome. Peça ao administrador para colocar a moto, o
        carro ou o galão que você abastece como seu, na aba Veículos.
      </Aviso>
    );
  }

  const valido =
    !!veiculo &&
    (!pedeMedidor || (medidor != null && !medidorAtras)) &&
    (!pedeLitros || (litros != null && litros > 0)) &&
    !passaDoEstoque &&
    (!tirandoDoGalao || (paraOutroDestino ? outroDestinoEscrito.length >= 2 : !!destinoId)) &&
    (!pedeFoto || fotos.length > 0);

  const rotuloDoMedidor = ehMaquina ? 'Horímetro da máquina' : 'Km do painel';

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow mb-1">Abastecimento</p>
        <h1 className="titulo-pagina">{consulta.data?.nome}</h1>
      </div>

      {feito && (
        <Aviso
          tom="pago"
          acao={
            <button onClick={() => setFeito(null)} className="btn btn-sutil btn-p">
              Ok
            </button>
          }
        >
          {feito}
        </Aviso>
      )}

      <div className="card space-y-4 p-4 sm:p-5">
        {/* O veículo: botões grandes, e não uma lista que abre — no posto, com uma
            mão ocupada, é um toque. */}
        {veiculos.length > 1 && (
          <div>
            <p className="rotulo">O que você abasteceu</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {veiculos.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVeiculoId(v.id)}
                  aria-pressed={v.id === veiculoId}
                  className={`rounded-xl border-2 px-3 py-2.5 text-left transition ${
                    v.id === veiculoId
                      ? 'border-brand-500 bg-brand-500/10'
                      : 'border-tinta-200'
                  }`}
                >
                  <span className="block font-semibold text-tinta-900">{v.apelido}</span>
                  <span className="block text-xs text-tinta-500">
                    {v.tipo === 'GALAO'
                      ? [
                          v.combustivel ? COMBUSTIVEL_NOME[v.combustivel] : 'Galão',
                          v.estoque ? `${litrosEscritos(v.estoque.litros)} dentro` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : [v.modelo, v.placa].filter(Boolean).join(' · ') || '—'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {veiculo && veiculos.length === 1 && (
          <div>
            <p className="font-display text-lg font-semibold text-tinta-900">{veiculo.apelido}</p>
            <p className="text-xs text-tinta-500">
              {[veiculo.modelo, veiculo.placa].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}

        {/*
          A média que ele está fazendo, para quem abastece.

          É aqui que ela é útil de verdade: quem põe o combustível é o primeiro
          a perceber que o carro passou a beber mais, e é a mesma pessoa que
          sabe dizer por quê — o pneu murcho, a estrada de terra da semana.
        */}
        {veiculo?.consumo?.medio != null && !tirandoDoGalao && (
          <p
            className={`rounded-xl px-3 py-2 text-sm ${
              veiculo.consumo.irregular || veiculo.consumo.ultimoIrregular
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : 'bg-tinta-100/70 text-tinta-600'
            }`}
          >
            Está fazendo{' '}
            <strong className="num">
              {formatConsumo(veiculo.consumo.medio, veiculo.consumo.unidade)}
            </strong>
            {veiculo.consumo.ultimo != null && (
              <>
                {' '}· no último trecho,{' '}
                <strong className="num">
                  {formatConsumo(veiculo.consumo.ultimo, veiculo.consumo.unidade)}
                </strong>
              </>
            )}
            {/* Quem abastece é quem pode dizer o porquê: a estrada de terra da
                semana, o pneu murcho, a carga que ele levou. */}
            {(veiculo.consumo.irregular || veiculo.consumo.ultimoIrregular) &&
              veiculo.consumo.ideal != null && (
                <span className="mt-1 block font-semibold">
                  Este veículo costuma fazer{' '}
                  {formatConsumo(veiculo.consumo.ideal, veiculo.consumo.unidade)} — avise
                  se notou alguma coisa nele.
                </span>
              )}
          </p>
        )}

        {/* O galão faz duas coisas opostas, e é preciso dizer qual delas é. */}
        {ehGalao && (
          <div>
            <p className="rotulo">O que aconteceu</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['posto', 'Enchi no posto'],
                  // Nem sempre é máquina: a roçadeira, o sítio — "Pra onde foi" diz.
                  ['saida', 'Tirei do galão'],
                ] as const
              ).map(([qual, rotulo]) => (
                <button
                  key={qual}
                  type="button"
                  onClick={() => setModo(qual)}
                  aria-pressed={modo === qual}
                  className={`h-12 rounded-xl border-2 text-base font-semibold transition ${
                    modo === qual
                      ? 'border-brand-500 bg-brand-500/10 text-tinta-900'
                      : 'border-tinta-200 text-tinta-600'
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            {estoque && (
              <p className="mt-1.5 text-xs text-tinta-500">
                No galão: <strong className="num">{litrosEscritos(estoque.litros)}</strong>
                {estoque.precoPorLitro != null && (
                  <> · {formatBRL(estoque.precoPorLitro)} o litro</>
                )}
                {estoque.litrosSemValor > 0 && (
                  <> · {litrosEscritos(estoque.litrosSemValor)} com a nota na conferência</>
                )}
              </p>
            )}
          </div>
        )}

        {/* Para onde foram os litros: a máquina da frota, ou outro destino
            escrito — a roçadeira, o cortador de grama, o sítio, a fazenda. */}
        {tirandoDoGalao && (
          <div>
            <label className="rotulo" htmlFor="abast-destino">
              Pra onde foi
            </label>
            <select
              id="abast-destino"
              value={destinoId}
              onChange={(e) => {
                setDestinoId(e.target.value);
                setMedidorDigitado('');
              }}
              className="campo h-12 text-base"
            >
              <option value="">Escolha…</option>
              {destinos.map((d) => (
                <option key={d.id} value={d.id}>
                  {[d.apelido, d.placa].filter(Boolean).join(' · ')}
                </option>
              ))}
              <option value={OUTRO_DESTINO}>Outro destino (escrever)…</option>
            </select>
            {paraOutroDestino && (
              <>
                <input
                  id="abast-outro-destino"
                  value={outroDestino}
                  onChange={(e) => setOutroDestino(e.target.value.slice(0, 80))}
                  className="campo mt-2 h-12 text-base"
                  placeholder="Roçadeira, cortador de grama, sítio, fazenda…"
                  aria-label="Outro destino"
                  list="abast-outros-destinos"
                  autoComplete="off"
                  autoFocus
                />
                <datalist id="abast-outros-destinos">
                  {(consulta.data?.outrosDestinos ?? []).map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-tinta-500">
                  O que não é veículo da frota não tem painel: vão só os litros.
                </p>
              </>
            )}
          </div>
        )}

        {pedeLitros && (
          <div>
            <label className="rotulo" htmlFor="abast-litros">
              Litros
            </label>
            <CampoDinheiro
              id="abast-litros"
              valor={litrosDigitados}
              onChange={setLitrosDigitados}
              casas={LITROS_COM_CASAS}
              placeholder={
                ehGalao && modo === 'posto' && veiculo?.capacidadeLitros
                  ? `cabe ${veiculo.capacidadeLitros} L`
                  : 'quantos litros'
              }
              className="campo num h-12 text-lg"
            />
            {passaDoEstoque && estoque && (
              <p className="mt-1 text-xs font-semibold text-rose-600">
                No galão há {litrosEscritos(estoque.litros)}. Não dá para tirar mais do
                que isso.
              </p>
            )}
          </div>
        )}

        {pedeMedidor && (
          <div>
            <label className="rotulo" htmlFor="abast-km">
              {rotuloDoMedidor}
            </label>
            <input
              id="abast-km"
              value={medidorDigitado}
              onChange={(e) => setMedidorDigitado(medidorLimpo(e.target.value, ehMaquina))}
              inputMode={ehMaquina ? 'decimal' : 'numeric'}
              autoComplete="off"
              placeholder={
                medidorAnterior != null
                  ? `último: ${formatMedidor(medidorAnterior, ehMaquina)}`
                  : ehMaquina
                    ? 'as horas do painel, com o ponto: 1261.9'
                    : 'só os números'
              }
              className="campo num h-12 text-lg"
            />
            {medidorAtras && medidorAnterior != null && (
              <p className="mt-1 text-xs font-semibold text-rose-600">
                O último abastecimento foi com{' '}
                {ehMaquina ? horas(medidorAnterior) : km(medidorAnterior)}. Confira o
                painel.
              </p>
            )}
          </div>
        )}

        {/* A foto da nota: obrigatória em toda compra. O que sai do galão não
            tem nota nenhuma — a nota dele já foi tirada no posto. */}
        {pedeFoto && (
          <div>
            <p className="rotulo">Foto da nota</p>
            <FotoDaNota fotos={fotos} onFotos={setFotos} grande />
          </div>
        )}

        {lancar.isError && <Aviso tom="erro">{mensagemErro(lancar.error)}</Aviso>}

        <button
          type="button"
          onClick={() => lancar.mutate()}
          disabled={!valido || lancar.isPending}
          className="btn btn-primario h-12 w-full text-base"
        >
          {lancar.isPending
            ? 'Enviando…'
            : !veiculo
              ? 'Escolha o veículo'
              : tirandoDoGalao && !destinoId
                ? 'Diga pra onde foi'
                : paraOutroDestino && outroDestinoEscrito.length < 2
                  ? 'Escreva o destino'
                : pedeLitros && litros == null
                  ? 'Digite os litros'
                  : pedeMedidor && medidor == null
                    ? ehMaquina
                      ? 'Digite o horímetro'
                      : 'Digite o km'
                    : pedeFoto && fotos.length === 0
                      ? 'Tire a foto da nota'
                      : tirandoDoGalao
                        ? 'Lançar saída do galão'
                        : 'Lançar abastecimento'}
        </button>
      </div>

      {veiculo && veiculo.ultimos.length > 0 && (
        <div className="card overflow-hidden">
          <p className="eyebrow px-4 pb-2 pt-4">Últimos lançamentos de {veiculo.apelido}</p>
          <ul className="lista-dividida">
            {veiculo.ultimos.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <span className="block text-sm text-tinta-800">
                  {[
                    a.litros != null ? litrosEscritos(a.litros) : null,
                    a.km != null ? km(a.km) : null,
                    a.horimetro != null ? horas(a.horimetro) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  ·{' '}
                  {a.valor != null ? (
                    <span className="valor">{formatBRL(a.valor)}</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-300">na conferência</span>
                  )}
                </span>
                <span className="block text-[11px] text-tinta-400">
                  {new Date(a.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                  {a.lancadoPor}
                  {/* A foto em si fica na ficha do veículo, no sistema: aqui
                      basta saber que a nota foi junto. */}
                  {a.temFoto && ' · nota anexada'}
                  {a.galao && ` · do ${a.galao.apelido}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
