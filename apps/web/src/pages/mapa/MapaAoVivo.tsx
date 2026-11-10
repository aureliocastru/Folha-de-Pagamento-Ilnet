import { useQuery } from '@tanstack/react-query';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Carregando, Pagina, Aviso } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { semAcento } from '../../lib/busca';
import { useCelular } from '../../lib/celular';
import {
  alternarFiltro,
  atrasoDaOs,
  CODIGOS_DE_ESTADO,
  CODIGOS_DE_STATUS,
  corDoStatus,
  dataHoraCurta,
  ESTADOS_DO_VEICULO,
  haQuanto,
  hora,
  ordenarOs,
  ordenarVeiculos,
  SEM_TECNICO,
  STATUS_DA_OS,
  type ConfigDoMapa,
  type EstadoDoVeiculo,
  type FrotaDoMapa,
  type OrdensDoMapa,
  type OsNoMapa,
  type VeiculoNoMapa,
} from '../../lib/mapa';
import { MapaDeServico } from './mapa-leaflet';

const NENHUMA_OS: OsNoMapa[] = [];
const NENHUM_VEICULO: VeiculoNoMapa[] = [];

/**
 * O mapa de serviço: as OS abertas do IXC e a frota em tempo real, na mesma
 * tela — o ILNET Service Map, trazido para dentro do sistema.
 *
 * A tela toda é o mapa. À esquerda, a lista do que está nele, com os filtros;
 * no celular essa lista é uma gaveta por cima do mapa. A frota atualiza de 15
 * em 15 segundos e as OS de minuto em minuto (o servidor diz), e só com a aba
 * à vista: em segundo plano, ninguém consulta nada.
 */
export function MapaAoVivo() {
  const config = useQuery({
    queryKey: ['mapa', 'config'],
    queryFn: async () => (await api.get<ConfigDoMapa>('/mapa/config')).data,
    // A configuração é do servidor: muda com um deploy, não durante o dia.
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (config.isPending) return <Carregando texto="Abrindo o mapa…" />;
  if (config.isError) {
    return (
      <Pagina>
        <Aviso tom="erro">Não deu para abrir o mapa: {mensagemErro(config.error)}</Aviso>
      </Pagina>
    );
  }
  return <TelaDoMapa config={config.data} />;
}

type Aba = 'ordens' | 'frota';

function TelaDoMapa({ config }: { config: ConfigDoMapa }) {
  const celular = useCelular();

  const ordens = useQuery({
    queryKey: ['mapa', 'ordens'],
    queryFn: async () => (await api.get<OrdensDoMapa>('/mapa/ordens')).data,
    enabled: config.fontes.ixc,
    refetchInterval: config.intervalos.os * 1000,
    refetchOnWindowFocus: true,
  });
  const frota = useQuery({
    queryKey: ['mapa', 'frota'],
    queryFn: async () => (await api.get<FrotaDoMapa>('/mapa/frota')).data,
    enabled: config.fontes.rastreio,
    refetchInterval: config.intervalos.frota * 1000,
    refetchOnWindowFocus: true,
  });
  const todasAsOs = ordens.data?.ordens ?? NENHUMA_OS;
  const todosOsVeiculos = frota.data?.veiculos ?? NENHUM_VEICULO;

  const [aba, setAba] = useState<Aba>('ordens');
  const [painelAberto, setPainelAberto] = useState(!celular);
  const [status, setStatus] = useState<Set<string>>(() => new Set(CODIGOS_DE_STATUS));
  const [tecnico, setTecnico] = useState('');
  const [assunto, setAssunto] = useState('');
  const [busca, setBusca] = useState('');
  const [soAtrasadas, setSoAtrasadas] = useState(false);
  const [estados, setEstados] = useState<Set<EstadoDoVeiculo>>(() => new Set(CODIGOS_DE_ESTADO));
  const [buscaFrota, setBuscaFrota] = useState('');
  const [selecionado, setSelecionado] = useState<{ tipo: 'os' | 'veiculo'; id: string } | null>(null);
  const [avisosFechados, setAvisosFechados] = useState<Set<string>>(() => new Set());
  const [enquadrarTecnico, setEnquadrarTecnico] = useState<number | null>(null);

  // O relógio da tela: a OS passa a "atrasada" sem esperar a próxima leitura.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const relogio = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(relogio);
  }, []);

  // Celular e computador têm a lista em lugares diferentes: virar a tela (ou
  // estreitar a janela) troca a gaveta pelo painel.
  useEffect(() => setPainelAberto(!celular), [celular]);

  const buscaAdiada = useDeferredValue(busca);
  const buscaFrotaAdiada = useDeferredValue(buscaFrota);

  const osFiltradas = useMemo(() => {
    const termo = semAcento(buscaAdiada.trim());
    const lista = todasAsOs.filter((os) => {
      if (STATUS_DA_OS[os.status] && !status.has(os.status)) return false;
      if (tecnico === SEM_TECNICO ? os.tecnicoId !== null : tecnico && String(os.tecnicoId) !== tecnico) {
        return false;
      }
      if (assunto && String(os.assuntoId) !== assunto) return false;
      if (soAtrasadas && !atrasoDaOs(os, agora)) return false;
      if (termo) {
        const texto = [os.id, os.protocolo, os.cliente, os.endereco, os.bairro, os.cidade, os.assunto, os.tecnico].join(' ');
        if (!semAcento(texto).includes(termo)) return false;
      }
      return true;
    });
    return ordenarOs(lista, agora);
  }, [todasAsOs, status, tecnico, assunto, soAtrasadas, buscaAdiada, agora]);

  const veiculosFiltrados = useMemo(() => {
    const termo = semAcento(buscaFrotaAdiada.trim());
    return ordenarVeiculos(
      todosOsVeiculos.filter(
        (v) =>
          estados.has(v.estado) &&
          (!termo || semAcento([v.nome, v.placa, v.tecnico, v.equipe, v.grupo, v.motorista].join(' ')).includes(termo)),
      ),
    );
  }, [todosOsVeiculos, estados, buscaFrotaAdiada]);

  const tecnicoEscolhido = tecnico && tecnico !== SEM_TECNICO ? Number(tecnico) : null;

  // ------------------------------------------------------------- o mapa

  const caixa = useRef<HTMLDivElement>(null);
  const [mapa, setMapa] = useState<MapaDeServico | null>(null);
  useEffect(() => {
    if (!caixa.current) return;
    const novo = new MapaDeServico(
      caixa.current,
      { centro: config.centro, zoom: config.zoom },
      { aoSelecionar: () => undefined, aoFiltrarTecnico: () => undefined },
    );
    setMapa(novo);
    return () => {
      novo.destruir();
      setMapa(null);
    };
  }, [config]);

  const filtrarPorTecnico = useCallback(
    (id: number) => {
      setTecnico(String(id));
      setAba('ordens');
      mapa?.fecharPopup();
      setEnquadrarTecnico(id);
    },
    [mapa],
  );
  useEffect(() => {
    mapa?.trocarAcoes({
      aoSelecionar: (tipo, id) => setSelecionado({ tipo, id }),
      aoFiltrarTecnico: filtrarPorTecnico,
    });
  }, [mapa, filtrarPorTecnico]);

  useEffect(() => {
    mapa?.atualizarFontes(todasAsOs, todosOsVeiculos);
  }, [mapa, todasAsOs, todosOsVeiculos]);
  useEffect(() => {
    mapa?.desenharOs(osFiltradas, agora);
  }, [mapa, osFiltradas, agora]);
  useEffect(() => {
    mapa?.desenharVeiculos(veiculosFiltrados, tecnicoEscolhido);
  }, [mapa, veiculosFiltrados, tecnicoEscolhido]);

  // Na primeira vez que os dados chegam, o mapa enquadra tudo. Espera as duas
  // fontes: enquadrar só a frota e depois saltar para as OS é pior que esperar.
  const esperando = (config.fontes.ixc && ordens.isPending) || (config.fontes.rastreio && frota.isPending);
  const jaEnquadrou = useRef(false);
  useEffect(() => {
    if (!mapa || jaEnquadrou.current || esperando) return;
    const pontos = [...todasAsOs, ...todosOsVeiculos]
      .filter((p) => p.lat !== null && p.lng !== null)
      .map((p) => [p.lat, p.lng] as [number, number]);
    // Aberto numa aba escondida, o mapa nasce sem tamanho, e o enquadramento
    // iria para o zoom máximo: fica para a próxima leitura.
    if (pontos.length === 0 || !mapa.temTamanho()) return;
    jaEnquadrou.current = true;
    mapa.enquadrar(pontos);
  }, [mapa, esperando, todasAsOs, todosOsVeiculos]);

  // "Ver as OS do técnico": depois que o filtro valeu, o mapa vai até elas e
  // até o carro dele.
  useEffect(() => {
    if (!mapa || enquadrarTecnico === null) return;
    const pontos = [
      ...osFiltradas.filter((os) => os.lat !== null && os.lng !== null).map((os) => [os.lat, os.lng]),
      ...todosOsVeiculos
        .filter((v) => v.tecnicoId === enquadrarTecnico && v.lat !== null && v.lng !== null)
        .map((v) => [v.lat, v.lng]),
    ] as Array<[number, number]>;
    mapa.enquadrar(pontos);
    setEnquadrarTecnico(null);
  }, [mapa, enquadrarTecnico, osFiltradas, todosOsVeiculos]);

  function abrirOs(id: number) {
    if (celular) setPainelAberto(false);
    setSelecionado({ tipo: 'os', id: String(id) });
    mapa?.abrirOs(id);
  }

  function abrirVeiculo(id: string) {
    if (celular) setPainelAberto(false);
    setSelecionado({ tipo: 'veiculo', id });
    mapa?.abrirVeiculo(id);
  }

  // ------------------------------------------------------------- números e avisos

  const atrasadas = useMemo(() => todasAsOs.filter((os) => atrasoDaOs(os, agora)).length, [todasAsOs, agora]);
  const porEstado = useMemo(() => {
    const contagem: Record<EstadoDoVeiculo, number> = { movimento: 0, parado: 0, offline: 0 };
    for (const v of todosOsVeiculos) contagem[v.estado] += 1;
    return contagem;
  }, [todosOsVeiculos]);

  const avisos = useMemo(() => {
    const lista: Array<{ texto: string; tom: 'erro' | 'leve' }> = [];
    for (const problema of config.problemas) lista.push({ texto: problema, tom: 'leve' });
    const fontes: Array<[string, typeof ordens | typeof frota]> = [
      ['as ordens de serviço (IXC)', ordens],
      ['a frota (rastreamento)', frota],
    ];
    for (const [nome, q] of fontes) {
      if (q.isError && !q.data) {
        lista.push({ texto: `Não foi possível ler ${nome}: ${mensagemErro(q.error)}`, tom: 'erro' });
      } else if (q.data?.erro) {
        lista.push({
          texto: `Não foi possível atualizar ${nome}: ${q.data.erro}. Mostrando o que veio às ${hora(q.data.atualizadoEm)}.`,
          tom: 'erro',
        });
      }
      for (const aviso of q.data?.avisos ?? []) lista.push({ texto: aviso, tom: 'leve' });
    }
    return lista.filter((a) => !avisosFechados.has(a.texto));
  }, [config.problemas, ordens, frota, avisosFechados]);

  const comErro = (ordens.isError || !!ordens.data?.erro) || (frota.isError || !!frota.data?.erro);
  const situacao = [
    frota.data ? `Frota ${hora(frota.data.atualizadoEm, true)}` : null,
    ordens.data ? `OS ${hora(ordens.data.atualizadoEm)}` : null,
  ].filter(Boolean);

  return (
    <div className={`flex flex-col ${celular ? 'h-[calc(100dvh-53px)]' : 'h-screen'}`}>
      {/* pr-12: o bloco de notas fica grudado na quina de cima. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-tinta-200 bg-papel py-2 pl-3 pr-12 md:pl-4">
        {/* Lista com marcadores, e não as três linhas: no celular o menu do
            módulo, logo acima, já é o de três linhas. */}
        <button
          type="button"
          onClick={() => setPainelAberto((a) => !a)}
          aria-expanded={painelAberto}
          aria-label={painelAberto ? 'Esconder a lista' : 'Mostrar a lista'}
          title={painelAberto ? 'Esconder a lista' : 'Mostrar a lista'}
          className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-sm font-semibold transition ${
            painelAberto
              ? 'border-brand-300 bg-brand-500/10 text-brand-700 dark:text-brand-300'
              : 'border-tinta-200 bg-tinta-50 text-tinta-600 hover:border-brand-300 hover:text-brand-700'
          }`}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 6h11M9 12h11M9 18h11" />
            <circle cx="4.5" cy="6" r="1" fill="currentColor" />
            <circle cx="4.5" cy="12" r="1" fill="currentColor" />
            <circle cx="4.5" cy="18" r="1" fill="currentColor" />
          </svg>
          Lista
        </button>
        <p className="eyebrow hidden lg:block">Mapa de Serviço</p>

        <ul
          className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Resumo"
        >
          <Numero rotulo="OS abertas" valor={ordens.data ? todasAsOs.length : null} />
          <Numero rotulo="Atrasadas" valor={ordens.data ? atrasadas : null} cor="text-rose-600 dark:text-rose-400" />
          {config.fontes.rastreio && (
            <>
              <Numero rotulo="Em movimento" valor={frota.data ? porEstado.movimento : null} cor="text-emerald-600 dark:text-emerald-400" />
              <Numero rotulo="Parados" valor={frota.data ? porEstado.parado : null} cor="text-amber-600 dark:text-amber-400" />
              <Numero rotulo="Offline" valor={frota.data ? porEstado.offline : null} cor="text-tinta-500" />
            </>
          )}
        </ul>

        <p className="hidden shrink-0 items-center gap-1.5 text-xs text-tinta-500 md:flex" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${comErro ? 'bg-rose-500' : 'bg-emerald-500'}`} />
          {situacao.length ? `Atualizado · ${situacao.join(' · ')}` : 'Carregando…'}
        </p>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {painelAberto && (
          <aside
            className={`flex min-h-0 flex-col border-r border-tinta-200 bg-papel ${
              celular ? 'absolute inset-y-0 left-0 z-[1100] w-[min(100%,420px)] shadow-2xl' : 'w-[360px] shrink-0'
            }`}
          >
            <div className="flex shrink-0 border-b border-tinta-200" role="tablist">
              <BotaoDaAba ativa={aba === 'ordens'} onClick={() => setAba('ordens')} quantos={osFiltradas.length}>
                Ordens
              </BotaoDaAba>
              <BotaoDaAba ativa={aba === 'frota'} onClick={() => setAba('frota')} quantos={veiculosFiltrados.length}>
                Frota
              </BotaoDaAba>
            </div>

            {aba === 'ordens' ? (
              <ListaDeOrdens
                carregando={config.fontes.ixc && ordens.isPending}
                semIxc={!config.fontes.ixc}
                todas={todasAsOs}
                filtradas={osFiltradas}
                agora={agora}
                busca={busca}
                onBusca={setBusca}
                status={status}
                onStatus={(codigo) => setStatus((atual) => alternarFiltro(atual, CODIGOS_DE_STATUS, codigo))}
                tecnico={tecnico}
                onTecnico={setTecnico}
                assunto={assunto}
                onAssunto={setAssunto}
                soAtrasadas={soAtrasadas}
                onSoAtrasadas={setSoAtrasadas}
                veiculos={todosOsVeiculos}
                selecionado={selecionado?.tipo === 'os' ? selecionado.id : null}
                onAbrir={abrirOs}
              />
            ) : (
              <ListaDaFrota
                configurado={config.fontes.rastreio}
                carregando={config.fontes.rastreio && frota.isPending}
                todos={todosOsVeiculos}
                filtrados={veiculosFiltrados}
                agora={agora}
                busca={buscaFrota}
                onBusca={setBuscaFrota}
                estados={estados}
                onEstado={(codigo) => setEstados((atual) => alternarFiltro(atual, CODIGOS_DE_ESTADO, codigo))}
                selecionado={selecionado?.tipo === 'veiculo' ? selecionado.id : null}
                onAbrir={abrirVeiculo}
              />
            )}
          </aside>
        )}

        <div className="relative min-w-0 flex-1">
          <div ref={caixa} className="mapa-de-servico absolute inset-0" aria-label="Mapa das ordens de serviço e da frota" />
          {avisos.length > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] grid w-[min(560px,calc(100%-120px))] -translate-x-1/2 gap-1.5 max-md:w-[calc(100%-24px)]">
              {avisos.map((a) => (
                <div
                  key={a.texto}
                  role="status"
                  className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] shadow-lg ${
                    a.tom === 'erro'
                      ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-950 dark:text-rose-200'
                      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950 dark:text-amber-200'
                  }`}
                >
                  <span className="min-w-0 flex-1">{a.texto}</span>
                  <button
                    type="button"
                    onClick={() => setAvisosFechados((f) => new Set(f).add(a.texto))}
                    aria-label="Fechar o aviso"
                    className="alvo-livre -mr-1 shrink-0 rounded px-1 leading-5 opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, cor = 'text-tinta-900' }: { rotulo: string; valor: number | null; cor?: string }) {
  return (
    <li className="flex shrink-0 items-baseline gap-1.5 rounded-lg border border-tinta-200 bg-tinta-50 px-2.5 py-1">
      <span className={`font-display text-base font-semibold tabular-nums ${cor}`}>{valor ?? '–'}</span>
      <span className="whitespace-nowrap text-[11px] text-tinta-500">{rotulo}</span>
    </li>
  );
}

function BotaoDaAba({
  ativa,
  onClick,
  quantos,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  quantos: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
        ativa ? 'border-brand-500 text-tinta-900' : 'border-transparent text-tinta-500 hover:text-tinta-800'
      }`}
    >
      {children}
      <span className="rounded-full bg-tinta-100 px-1.5 text-xs tabular-nums text-tinta-600">{quantos}</span>
    </button>
  );
}

/** O filtro em pílula: a bolinha da cor e quantos têm. */
function Pilula({
  cor,
  ligada,
  onClick,
  titulo,
  children,
}: {
  cor: string;
  ligada: boolean;
  onClick: () => void;
  titulo?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ligada}
      title={titulo}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
        ligada ? 'text-tinta-900' : 'border-tinta-200 text-tinta-400 hover:text-tinta-700'
      }`}
      style={ligada ? { borderColor: `${cor}99`, backgroundColor: `${cor}1f` } : undefined}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cor, opacity: ligada ? 1 : 0.45 }} />
      {children}
    </button>
  );
}

function ListaDeOrdens(p: {
  carregando: boolean;
  semIxc: boolean;
  todas: OsNoMapa[];
  filtradas: OsNoMapa[];
  agora: number;
  busca: string;
  onBusca: (v: string) => void;
  status: Set<string>;
  onStatus: (codigo: string) => void;
  tecnico: string;
  onTecnico: (v: string) => void;
  assunto: string;
  onAssunto: (v: string) => void;
  soAtrasadas: boolean;
  onSoAtrasadas: (v: boolean) => void;
  veiculos: VeiculoNoMapa[];
  selecionado: string | null;
  onAbrir: (id: number) => void;
}) {
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const os of p.todas) c[os.status] = (c[os.status] ?? 0) + 1;
    return c;
  }, [p.todas]);

  const { tecnicos, assuntos } = useMemo(() => {
    const tecnicos = new Map<string, string>();
    const assuntos = new Map<string, string>();
    for (const os of p.todas) {
      if (os.tecnicoId !== null) tecnicos.set(String(os.tecnicoId), os.tecnico ?? `Colaborador ${os.tecnicoId}`);
      if (os.assuntoId !== null) assuntos.set(String(os.assuntoId), os.assunto ?? `Assunto ${os.assuntoId}`);
    }
    // O técnico escolhido pelo popup de um carro pode não ter OS nenhuma.
    if (p.tecnico && p.tecnico !== SEM_TECNICO && !tecnicos.has(p.tecnico)) {
      const doCarro = p.veiculos.find((v) => String(v.tecnicoId) === p.tecnico);
      tecnicos.set(p.tecnico, doCarro?.tecnico ?? `Colaborador ${p.tecnico}`);
    }
    const porNome = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], 'pt-BR');
    return { tecnicos: [...tecnicos].sort(porNome), assuntos: [...assuntos].sort(porNome) };
  }, [p.todas, p.tecnico, p.veiculos]);

  const noMapa = p.filtradas.filter((os) => os.lat !== null && os.lng !== null);
  const semLugar = p.filtradas.filter((os) => os.lat === null || os.lng === null);

  if (p.semIxc) {
    return (
      <p className="px-4 py-8 text-center text-sm text-tinta-500">
        O IXC não está configurado no servidor (IXC_HOST e IXC_TOKEN).
      </p>
    );
  }

  return (
    <>
      <div className="grid shrink-0 gap-2.5 border-b border-tinta-200 p-3">
        <input
          type="search"
          className="campo"
          value={p.busca}
          onChange={(e) => p.onBusca(e.target.value)}
          placeholder="Buscar cliente, nº da OS, endereço…"
          autoComplete="off"
        />
        <div className="flex flex-wrap gap-1.5" aria-label="Filtrar pela situação">
          {CODIGOS_DE_STATUS.map((codigo) => (
            <Pilula
              key={codigo}
              cor={STATUS_DA_OS[codigo].cor}
              ligada={p.status.has(codigo)}
              onClick={() => p.onStatus(codigo)}
              titulo="O primeiro clique mostra só esta; os outros somam"
            >
              {STATUS_DA_OS[codigo].nome}
              <span className="tabular-nums opacity-70">{contagem[codigo] ?? 0}</span>
            </Pilula>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select className="campo" value={p.tecnico} onChange={(e) => p.onTecnico(e.target.value)} aria-label="Técnico">
            <option value="">Todos os técnicos</option>
            <option value={SEM_TECNICO}>— Sem técnico —</option>
            {tecnicos.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
          <select className="campo" value={p.assunto} onChange={(e) => p.onAssunto(e.target.value)} aria-label="Assunto">
            <option value="">Todos os assuntos</option>
            {assuntos.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-tinta-600">
          <input type="checkbox" checked={p.soAtrasadas} onChange={(e) => p.onSoAtrasadas(e.target.checked)} />
          Só as atrasadas
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 rolagem-fina">
        {p.carregando ? (
          <Carregando texto="Lendo as OS do IXC…" />
        ) : noMapa.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-tinta-500">Nenhuma OS no mapa com esses filtros.</p>
        ) : (
          noMapa.map((os) => (
            <ItemDaOs key={os.id} os={os} agora={p.agora} selecionado={p.selecionado === String(os.id)} onAbrir={() => p.onAbrir(os.id)} />
          ))
        )}
      </div>

      {semLugar.length > 0 && (
        <details className="flex max-h-[40%] shrink-0 flex-col overflow-y-auto border-t border-tinta-200 rolagem-fina">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-tinta-600">
            Sem localização <span className="rounded-full bg-tinta-100 px-1.5 text-xs tabular-nums">{semLugar.length}</span>
          </summary>
          <p className="mx-4 mb-1.5 text-xs text-tinta-500">
            Estas OS não têm coordenada na OS, no login, no contrato nem no cadastro do cliente. Corrija no IXC para
            elas aparecerem no mapa.
          </p>
          <div className="p-1.5">
            {semLugar.map((os) => (
              <ItemDaOs key={os.id} os={os} agora={p.agora} selecionado={false} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function ItemDaOs({
  os,
  agora,
  selecionado,
  onAbrir,
}: {
  os: OsNoMapa;
  agora: number;
  selecionado: boolean;
  onAbrir?: () => void;
}) {
  const cor = corDoStatus(os.status);
  const atraso = atrasoDaOs(os, agora);
  const lugar = [os.endereco, os.cidade].filter(Boolean).join(' · ') || 'sem endereço';
  const conteudo = (
    <>
      <span className="absolute bottom-2.5 left-1 top-2.5 w-[3px] rounded-full" style={{ backgroundColor: cor }} />
      <span className="flex items-center gap-2 font-semibold text-tinta-900">
        <span className="min-w-0 flex-1 truncate">
          {os.id} · {os.assunto ?? 'Sem assunto'}
        </span>
        {atraso && (
          <span className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
            Atrasada
          </span>
        )}
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: `${cor}26`, color: cor }}
        >
          {os.statusNome}
        </span>
      </span>
      <span className="mt-0.5 block truncate text-[12.5px] text-tinta-500">
        <b className="font-medium text-tinta-800">
          {os.cliente ?? (os.tipo === 'E' ? 'Estrutura' : 'Cliente não encontrado')}
        </b>{' '}
        · {lugar}
      </span>
      <span className="mt-0.5 block truncate text-[12.5px] text-tinta-500">
        {os.tecnico ?? 'Sem técnico'}
        {os.agenda ? ` · agenda ${dataHoraCurta(os.agenda)}` : ''}
      </span>
    </>
  );
  const classes = `relative mb-1 block w-full rounded-xl border py-2.5 pl-3.5 pr-2.5 text-left text-sm ${
    selecionado ? 'border-tinta-200 bg-tinta-100' : 'border-transparent'
  }`;
  return onAbrir ? (
    <button type="button" onClick={onAbrir} className={`${classes} hover:border-tinta-200 hover:bg-tinta-50`}>
      {conteudo}
    </button>
  ) : (
    <div className={classes}>{conteudo}</div>
  );
}

function ListaDaFrota(p: {
  configurado: boolean;
  carregando: boolean;
  todos: VeiculoNoMapa[];
  filtrados: VeiculoNoMapa[];
  agora: number;
  busca: string;
  onBusca: (v: string) => void;
  estados: Set<EstadoDoVeiculo>;
  onEstado: (codigo: EstadoDoVeiculo) => void;
  selecionado: string | null;
  onAbrir: (id: string) => void;
}) {
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of p.todos) c[v.estado] = (c[v.estado] ?? 0) + 1;
    return c;
  }, [p.todos]);

  if (!p.configurado) {
    return (
      <div className="px-4 py-8 text-center text-sm text-tinta-500">
        <p className="font-semibold text-tinta-700">O rastreador ainda não está ligado.</p>
        <p className="mx-auto mt-1.5 max-w-xs">
          O servidor precisa da chave da plataforma de rastreamento: RASTREIO_API_HASH, ou o e-mail e a senha da
          conta (RASTREIO_EMAIL e RASTREIO_SENHA). Até lá, o mapa mostra só as OS.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid shrink-0 gap-2.5 border-b border-tinta-200 p-3">
        <input
          type="search"
          className="campo"
          value={p.busca}
          onChange={(e) => p.onBusca(e.target.value)}
          placeholder="Buscar veículo, placa, técnico…"
          autoComplete="off"
        />
        <div className="flex flex-wrap gap-1.5" aria-label="Filtrar pelo estado">
          {CODIGOS_DE_ESTADO.map((codigo) => (
            <Pilula
              key={codigo}
              cor={ESTADOS_DO_VEICULO[codigo].cor}
              ligada={p.estados.has(codigo)}
              onClick={() => p.onEstado(codigo)}
            >
              {ESTADOS_DO_VEICULO[codigo].nome}
              <span className="tabular-nums opacity-70">{contagem[codigo] ?? 0}</span>
            </Pilula>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 rolagem-fina">
        {p.carregando ? (
          <Carregando texto="Lendo a frota…" />
        ) : p.filtrados.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-tinta-500">Nenhum veículo com esses filtros.</p>
        ) : (
          p.filtrados.map((v) => {
            const estado = ESTADOS_DO_VEICULO[v.estado];
            const semPosicao = v.lat === null || v.lng === null;
            const quem = [v.tecnico, v.equipe].filter(Boolean).join(' · ') || v.grupo || 'Sem técnico ligado';
            return (
              <button
                key={v.id}
                type="button"
                disabled={semPosicao}
                onClick={() => p.onAbrir(v.id)}
                className={`relative mb-1 block w-full rounded-xl border py-2.5 pl-3.5 pr-2.5 text-left text-sm hover:border-tinta-200 hover:bg-tinta-50 disabled:cursor-default disabled:opacity-60 ${
                  p.selecionado === v.id ? 'border-tinta-200 bg-tinta-100' : 'border-transparent'
                }`}
              >
                <span className="absolute bottom-2.5 left-1 top-2.5 w-[3px] rounded-full" style={{ backgroundColor: estado.cor }} />
                <span className="flex items-center gap-2 font-semibold text-tinta-900">
                  <span className="min-w-0 flex-1 truncate">
                    {v.nome}
                    {v.placa && <span className="ml-1.5 text-xs font-normal text-tinta-500">{v.placa}</span>}
                  </span>
                  {v.estado === 'movimento' ? (
                    <span className="shrink-0 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {v.velocidade} km/h
                    </span>
                  ) : (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: `${estado.cor}26`, color: estado.cor }}
                    >
                      {estado.nome}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-tinta-500">{quem}</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-tinta-500">
                  {semPosicao ? 'Sem posição · ' : ''}
                  {haQuanto(v.horario, p.agora)}
                </span>
              </button>
            );
          })
        )}
      </div>
      <p className="shrink-0 border-t border-tinta-200 px-4 py-2 text-xs text-tinta-500">
        Quem anda em cada carro se liga em{' '}
        <NavLink to="/mapa/rastreadores" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
          Rastreadores
        </NavLink>
        .
      </p>
    </>
  );
}
