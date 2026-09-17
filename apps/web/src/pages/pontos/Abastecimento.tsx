import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent } from 'react';
import { Aviso, Carregando } from '../../components/ui';
import { mensagemErro } from '../../lib/api';
import { formatBRL, formatConsumo } from '../../lib/format';
import { reduzirFoto } from '../../lib/foto';
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
}

export interface DadosDoAbastecimento {
  veiculoId: string;
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

const km = (n: number) => `${n.toLocaleString('pt-BR')} km`;
const horas = (n: number) => `${n.toLocaleString('pt-BR')} h`;
const litrosEscritos = (n: number) =>
  `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L`;

const COMBUSTIVEL_NOME: Record<string, string> = {
  DIESEL_S500: 'Diesel S500',
  DIESEL_S10: 'Diesel S10',
  GASOLINA: 'Gasolina',
  ETANOL: 'Etanol',
  ARLA: 'Arla',
};

/** Só os números, com vírgula: é assim que a bomba escreve os litros. */
function soLitros(texto: string): string {
  return texto.replace(/[^\d,.]/g, '').replace('.', ',').slice(0, 7);
}

const paraNumero = (texto: string) => Number(texto.replace(',', '.'));

/**
 * O abastecimento, lançado por quem anda com o veículo, na hora, no posto.
 *
 * São três coisas que acontecem aqui, e a tela vira de acordo com o que está
 * escolhido:
 *
 * - **o carro no posto**: o km do painel e a foto da nota, como sempre foi;
 * - **o galão no posto**: quantos litros entraram e a foto da nota — galão não
 *   tem painel, tem estoque;
 * - **o galão na máquina**: quantos litros saíram e o horímetro da máquina. Não
 *   há nota nenhuma aqui: aquele diesel já foi pago no dia em que o galão foi
 *   enchido, e o que a máquina custou sai do preço do litro que está dentro
 *   dele.
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
  const [medidorDigitado, setMedidorDigitado] = useState('');
  const [litrosDigitados, setLitrosDigitados] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
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
  const ehMaquina = destino?.tipo === 'MAQUINA';
  /** O galão não tem painel; a máquina conta horas; o resto conta km. */
  const pedeMedidor = tirandoDoGalao ? !!destino : !ehGalao;
  const pedeFoto = !tirandoDoGalao;
  const pedeLitros = ehGalao || tirandoDoGalao;

  const medidorAnterior = tirandoDoGalao
    ? ehMaquina
      ? (destino?.ultimoHorimetro ?? null)
      : (destino?.ultimoKm ?? null)
    : (veiculo?.ultimoKm ?? null);

  const medidorNumero = medidorDigitado ? Number(medidorDigitado) : null;
  const medidorAtras =
    medidorAnterior != null && medidorNumero != null && medidorNumero < medidorAnterior;

  const litros = litrosDigitados ? paraNumero(litrosDigitados) : null;
  const estoque = veiculo?.estoque ?? null;
  const passaDoEstoque =
    tirandoDoGalao && litros != null && estoque != null && litros > estoque.litros;

  // Trocar de veículo recomeça a tela: o km do carro não é o litro do galão.
  useEffect(() => {
    setModo('posto');
    setDestinoId('');
    setMedidorDigitado('');
    setLitrosDigitados('');
  }, [veiculoId]);

  async function aoEscolherFoto(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // Limpo sempre: sem isso, escolher a mesma foto de novo não dispara nada.
    e.target.value = '';
    if (!arquivo) return;
    setErroFoto(null);
    setPreparandoFoto(true);
    try {
      setFoto(await reduzirFoto(arquivo));
    } catch (err) {
      setErroFoto(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparandoFoto(false);
    }
  }

  const lancar = useMutation({
    mutationFn: () =>
      enviar({
        veiculoId: tirandoDoGalao ? destinoId : veiculoId,
        ...(tirandoDoGalao ? { galaoId: veiculoId } : {}),
        ...(pedeMedidor
          ? ehMaquina
            ? { horimetro: medidorNumero ?? 0 }
            : { km: medidorNumero ?? 0 }
          : {}),
        ...(litros != null ? { litros } : {}),
        ...(pedeFoto ? { foto: foto ?? '' } : {}),
      }),
    onSuccess: () => {
      setFeito(
        tirandoDoGalao
          ? `${litrosEscritos(litros ?? 0)} do ${veiculo?.apelido} em ${destino?.apelido}.`
          : ehGalao
            ? `${veiculo?.apelido} enchido com ${litrosEscritos(litros ?? 0)}. A nota vai para a conferência.`
            : `Abastecimento lançado em ${veiculo?.apelido} com ${km(medidorNumero ?? 0)}. A nota vai para a conferência.`,
      );
      setMedidorDigitado('');
      setLitrosDigitados('');
      setFoto(null);
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
    (!pedeMedidor || (medidorNumero != null && !medidorAtras)) &&
    (!pedeLitros || (litros != null && litros > 0)) &&
    !passaDoEstoque &&
    (!tirandoDoGalao || !!destinoId) &&
    (!pedeFoto || !!foto);

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
          <p className="rounded-xl bg-tinta-100/70 px-3 py-2 text-sm text-tinta-600">
            Está fazendo{' '}
            <strong className="num text-tinta-900">
              {formatConsumo(veiculo.consumo.medio, veiculo.consumo.unidade)}
            </strong>
            {veiculo.consumo.ultimo != null && (
              <>
                {' '}· no último trecho,{' '}
                <strong className="num text-tinta-900">
                  {formatConsumo(veiculo.consumo.ultimo, veiculo.consumo.unidade)}
                </strong>
              </>
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
                  ['saida', 'Pus numa máquina'],
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

        {/* Para qual máquina foram os litros. */}
        {tirandoDoGalao && (
          <div>
            <label className="rotulo" htmlFor="abast-destino">
              Em qual máquina
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
            </select>
          </div>
        )}

        {pedeLitros && (
          <div>
            <label className="rotulo" htmlFor="abast-litros">
              Litros
            </label>
            <input
              id="abast-litros"
              value={litrosDigitados}
              onChange={(e) => setLitrosDigitados(soLitros(e.target.value))}
              inputMode="decimal"
              autoComplete="off"
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
              onChange={(e) => setMedidorDigitado(e.target.value.replace(/\D/g, '').slice(0, 7))}
              inputMode="numeric"
              autoComplete="off"
              placeholder={medidorAnterior != null ? `último: ${medidorAnterior}` : 'só os números'}
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
            {foto ? (
              <div className="flex items-start gap-3">
                <img
                  src={foto}
                  alt="Foto da nota que vai junto"
                  className="h-28 w-28 rounded-xl border border-tinta-200 object-cover"
                />
                <button type="button" onClick={() => setFoto(null)} className="btn btn-sutil btn-p text-rose-600">
                  Trocar a foto
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="btn btn-neutro h-12 cursor-pointer text-base">
                  {preparandoFoto ? 'Preparando…' : 'Tirar foto'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={aoEscolherFoto}
                    disabled={preparandoFoto}
                  />
                </label>
                <label className="btn btn-neutro h-12 cursor-pointer text-base">
                  Anexar
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={aoEscolherFoto}
                    disabled={preparandoFoto}
                  />
                </label>
              </div>
            )}
            {erroFoto && <p className="mt-1.5 text-xs text-rose-600">{erroFoto}</p>}
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
                ? 'Escolha a máquina'
                : pedeLitros && litros == null
                  ? 'Digite os litros'
                  : pedeMedidor && medidorNumero == null
                    ? ehMaquina
                      ? 'Digite o horímetro'
                      : 'Digite o km'
                    : pedeFoto && !foto
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
