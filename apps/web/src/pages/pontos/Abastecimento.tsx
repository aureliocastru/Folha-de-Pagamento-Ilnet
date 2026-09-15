import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent } from 'react';
import { Aviso, Carregando } from '../../components/ui';
import { mensagemErro } from '../../lib/api';
import { formatBRL } from '../../lib/format';
import { reduzirFoto } from '../../lib/foto';
import { apiPontos } from '../../lib/pontos';

export interface VeiculoDoPortal {
  id: string;
  apelido: string;
  tipo: string;
  placa: string | null;
  modelo: string | null;
  ultimoKm: number | null;
  ultimos: Array<{
    id: string;
    /** Null = o administrador ainda não conferiu a nota. */
    valor: number | null;
    km: number;
    data: string;
    lancadoPor: string;
    temFoto: boolean;
  }>;
}

export interface VeiculosDoResponsavel {
  nome: string;
  veiculos: VeiculoDoPortal[];
}

export interface DadosDoAbastecimento {
  veiculoId: string;
  km: number;
  foto: string;
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

/**
 * O abastecimento, lançado por quem anda com o veículo, na hora, no posto.
 *
 * Duas coisas e só: o km do painel e a foto da nota. O valor não se digita
 * aqui — o administrador o lê na nota, na conferência. O veículo já vem
 * escolhido quando é um só, e quase sempre é. Tudo grande, para o dedo e para
 * a luz do sol: é uma tela de posto de gasolina.
 */
export function FormularioDeAbastecimento({ chave, buscar, lancar: enviar }: FonteDoAbastecimento) {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: chave, queryFn: buscar, retry: 0 });
  const veiculos = consulta.data?.veiculos ?? [];

  const [veiculoId, setVeiculoId] = useState('');
  const [kmDigitado, setKmDigitado] = useState('');
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
  const kmNumero = kmDigitado ? Number(kmDigitado) : null;
  const kmAtras =
    veiculo?.ultimoKm != null && kmNumero != null && kmNumero < veiculo.ultimoKm;

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
    mutationFn: () => enviar({ veiculoId, km: kmNumero ?? 0, foto: foto ?? '' }),
    onSuccess: () => {
      setFeito(
        `Abastecimento lançado em ${veiculo?.apelido} com ${km(kmNumero ?? 0)}. A nota vai para a conferência.`,
      );
      setKmDigitado('');
      setFoto(null);
      void qc.invalidateQueries({ queryKey: chave });
    },
  });

  if (consulta.isLoading) return <Carregando texto="Buscando seus veículos…" />;
  if (consulta.isError) return <Aviso tom="erro">{mensagemErro(consulta.error)}</Aviso>;
  if (veiculos.length === 0) {
    return (
      <Aviso tom="info">
        Nenhum veículo está no seu nome. Peça ao administrador para colocar a moto ou
        o carro que você abastece como seu, na aba Veículos.
      </Aviso>
    );
  }

  const valido = !!veiculo && kmNumero != null && !kmAtras && !!foto;

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
            <p className="rotulo">Veículo</p>
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
                    {[v.modelo, v.placa].filter(Boolean).join(' · ') || '—'}
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

        <div>
          <div>
            <label className="rotulo" htmlFor="abast-km">
              Km do painel
            </label>
            <input
              id="abast-km"
              value={kmDigitado}
              onChange={(e) => setKmDigitado(e.target.value.replace(/\D/g, '').slice(0, 7))}
              inputMode="numeric"
              autoComplete="off"
              placeholder={veiculo?.ultimoKm != null ? `último: ${veiculo.ultimoKm}` : 'só os números'}
              className="campo num h-12 text-lg"
            />
            {kmAtras && veiculo?.ultimoKm != null && (
              <p className="mt-1 text-xs font-semibold text-rose-600">
                O último abastecimento foi com {km(veiculo.ultimoKm)}. Confira o painel.
              </p>
            )}
          </div>
        </div>

        {/* A foto da nota: obrigatória. Os dois caminhos sempre à vista — a
            câmera na hora, ou a foto que já está no celular. */}
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
              : kmNumero == null
                ? 'Digite o km'
                : !foto
                  ? 'Tire a foto da nota'
                  : 'Lançar abastecimento'}
        </button>
      </div>

      {veiculo && veiculo.ultimos.length > 0 && (
        <div className="card overflow-hidden">
          <p className="eyebrow px-4 pb-2 pt-4">Últimos abastecimentos de {veiculo.apelido}</p>
          <ul className="lista-dividida">
            {veiculo.ultimos.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <span className="block text-sm text-tinta-800">
                  {km(a.km)} ·{' '}
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
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
