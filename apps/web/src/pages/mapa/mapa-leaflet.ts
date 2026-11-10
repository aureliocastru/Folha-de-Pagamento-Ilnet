import L from 'leaflet';
// O agrupador é um script antigo: ele se pendura no `L` global, que o Leaflet
// põe na janela ao carregar. Por isso vem depois dele.
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import './mapa.css';
import {
  atrasoDaOs,
  corDoStatus,
  dataHoraCurta,
  distanciaKm,
  ESTADOS_DO_VEICULO,
  haQuanto,
  hora,
  ORIGEM_DA_POSICAO,
  textoKm,
  veiculosProximos,
  type OsNoMapa,
  type VeiculoNoMapa,
} from '../../lib/mapa';

type MarcadorDeOs = L.Marker & { os: OsNoMapa; atrasada: boolean; assinatura: string };
type MarcadorDeVeiculo = L.Marker & { veiculo: VeiculoNoMapa; assinatura: string };

/** O que o mapa pede à tela em volta dele. */
export interface AcoesDoMapa {
  /** Um popup abriu: a lista marca o item. */
  aoSelecionar(tipo: 'os' | 'veiculo', id: string): void;
  /** "Ver as OS do técnico", no popup do veículo. */
  aoFiltrarTecnico(tecnicoId: number): void;
}

const ICONE_VAN =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#fff" d="M2.5 6.5h11v8.5h-11zM13.5 9h4.2l3.3 3.6V15h-7.5z"/><circle cx="6.5" cy="16.2" r="2.1" fill="#fff" stroke="var(--cor)" stroke-width="1.4"/><circle cx="17" cy="16.2" r="2.1" fill="#fff" stroke="var(--cor)" stroke-width="1.4"/></svg>';

const PREFERENCIA_DA_CAMADA = 'mapa.camada';

function esc(valor: unknown): string {
  return String(valor ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function lerPreferencia(): string | null {
  try {
    return localStorage.getItem(PREFERENCIA_DA_CAMADA);
  } catch {
    return null;
  }
}

function gravarPreferencia(valor: string): void {
  try {
    localStorage.setItem(PREFERENCIA_DA_CAMADA, valor);
  } catch {
    // Sem armazenamento (aba anônima): a camada volta a ser a de ruas.
  }
}

function linhasDeDados(linhas: Array<[string, string | null | undefined]>): string {
  return linhas
    .filter(([, valor]) => valor)
    .map(([rotulo, valor]) => `<dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd>`)
    .join('');
}

/**
 * O mapa do Leaflet, com as OS e a frota — a parte que não é React.
 *
 * O Leaflet desenha direto na página, marcador por marcador; refazer tudo a
 * cada atualização da frota (de 15 em 15 segundos) faria o mapa piscar e
 * fechar o popup aberto. Aqui cada marcador é mexido só no que mudou: anda
 * para a posição nova, troca de cor quando o estado muda, sai quando o veículo
 * ou a OS some da lista.
 *
 * Os popups são HTML montado aqui, com tudo escapado; os botões deles avisam
 * pelo `data-acao`, lido num clique só no mapa inteiro.
 */
export class MapaDeServico {
  private readonly mapa: L.Map;
  private readonly grupoOs: L.MarkerClusterGroup;
  private readonly grupoRastro = L.layerGroup();
  private readonly grupoFrota = L.layerGroup();
  private readonly marcadoresOs = new Map<number, MarcadorDeOs>();
  private readonly marcadoresVeiculo = new Map<string, MarcadorDeVeiculo>();
  /** Todas as OS e todos os veículos, sem filtro — o popup conta e mede com eles. */
  private todasAsOs: OsNoMapa[] = [];
  private todosOsVeiculos: VeiculoNoMapa[] = [];
  /** O que está desenhado agora, para o "enquadrar tudo". */
  private pontosVisiveis: Array<[number, number]> = [];
  private pontosDaFrota: Array<[number, number]> = [];
  private readonly aoClicar: (e: MouseEvent) => void;
  /** A caixa do mapa mudou de tamanho — painel aberto, celular virado, cabeçalho que quebrou linha. */
  private readonly observador: ResizeObserver;

  constructor(
    private readonly elemento: HTMLElement,
    inicio: { centro: [number, number]; zoom: number },
    private acoes: AcoesDoMapa,
  ) {
    this.mapa = L.map(elemento, { zoomControl: false, worldCopyJump: true }).setView(
      inicio.centro,
      inicio.zoom,
    );
    L.control.zoom({ position: 'bottomright' }).addTo(this.mapa);

    const camadas: Record<string, L.TileLayer> = {
      Ruas: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }),
      Claro: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20,
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      }),
      Satélite: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: 'Imagens &copy; Esri' },
      ),
    };
    (camadas[lerPreferencia() ?? ''] ?? camadas.Ruas).addTo(this.mapa);
    this.mapa.on('baselayerchange', (e: L.LayersControlEvent) => gravarPreferencia(e.name));

    this.grupoOs = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 45,
      disableClusteringAtZoom: 18,
      chunkedLoading: true,
      // O grupo com uma OS atrasada dentro fica vermelho: de longe já se vê
      // onde tem gente esperando além da conta.
      iconCreateFunction: (cluster) => {
        const comAtraso = cluster
          .getAllChildMarkers()
          .some((m) => (m as MarcadorDeOs).atrasada);
        return L.divIcon({
          html: `<div>${cluster.getChildCount()}</div>`,
          className: `cluster-os${comAtraso ? ' com-atraso' : ''}`,
          iconSize: [40, 40],
        });
      },
    }).addTo(this.mapa);
    this.grupoRastro.addTo(this.mapa);
    this.grupoFrota.addTo(this.mapa);

    L.control
      .layers(
        camadas,
        { 'Ordens de serviço': this.grupoOs, Frota: this.grupoFrota, 'Rastro recente': this.grupoRastro },
        { position: 'topright' },
      )
      .addTo(this.mapa);

    const Enquadrar = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: () => {
        const caixa = L.DomUtil.create('div', 'leaflet-bar controle-enquadrar');
        const botao = L.DomUtil.create('a', '', caixa);
        botao.href = '#';
        botao.title = 'Enquadrar tudo';
        botao.setAttribute('role', 'button');
        botao.setAttribute('aria-label', 'Enquadrar todas as OS e veículos');
        botao.textContent = '⤢';
        L.DomEvent.disableClickPropagation(caixa);
        L.DomEvent.on(botao, 'click', (e) => {
          L.DomEvent.preventDefault(e);
          this.enquadrar();
        });
        return caixa;
      },
    });
    new Enquadrar().addTo(this.mapa);

    this.aoClicar = (e: MouseEvent) => {
      const alvo = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-acao]');
      if (!alvo) return;
      const { acao, id } = alvo.dataset;
      if (acao === 'veiculo' && id) this.abrirVeiculo(id);
      else if (acao === 'filtrar-tecnico' && id) this.acoes.aoFiltrarTecnico(Number(id));
    };
    elemento.addEventListener('click', this.aoClicar);

    // O Leaflet só mede a caixa quando a janela muda de tamanho. A caixa muda
    // sem a janela mudar (o painel da lista abre e fecha, o cabeçalho quebra
    // linha), e aí sobrava uma faixa cinza sem mapa no canto.
    this.observador = new ResizeObserver(() => this.mapa.invalidateSize());
    this.observador.observe(elemento);
  }

  trocarAcoes(acoes: AcoesDoMapa): void {
    this.acoes = acoes;
  }

  destruir(): void {
    this.observador.disconnect();
    this.elemento.removeEventListener('click', this.aoClicar);
    this.mapa.remove();
  }

  /** O mapa já tem tamanho de verdade? Aberto numa aba escondida, ele nasce com zero. */
  temTamanho(): boolean {
    const { x, y } = this.mapa.getSize();
    return x >= 100 && y >= 100;
  }

  /** Tudo o que se leu, sem filtro: o popup mede e conta com isso. */
  atualizarFontes(ordens: OsNoMapa[], veiculos: VeiculoNoMapa[]): void {
    this.todasAsOs = ordens;
    this.todosOsVeiculos = veiculos;
  }

  enquadrar(pontos?: Array<[number, number]>): void {
    const alvo = pontos ?? [...this.pontosVisiveis, ...this.pontosDaFrota];
    if (alvo.length === 0) return;
    this.mapa.fitBounds(L.latLngBounds(alvo), { padding: [40, 40], maxZoom: 15 });
  }

  // ---------------------------------------------------------------- OS

  private iconeDaOs(os: OsNoMapa, atrasada: boolean): L.DivIcon {
    const classes = ['pino-os', atrasada && 'atrasada', os.tipo === 'E' && 'estrutura']
      .filter(Boolean)
      .join(' ');
    return L.divIcon({
      className: classes,
      html: `<div class="gota" style="--cor:${corDoStatus(os.status)}"></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 29],
      popupAnchor: [0, -26],
    });
  }

  desenharOs(lista: OsNoMapa[], agora = Date.now()): void {
    const visiveis = lista.filter((os) => os.lat !== null && os.lng !== null);
    const ids = new Set(visiveis.map((os) => os.id));

    const sair: L.Marker[] = [];
    for (const [id, marcador] of this.marcadoresOs) {
      if (!ids.has(id)) {
        sair.push(marcador);
        this.marcadoresOs.delete(id);
      }
    }
    if (sair.length) this.grupoOs.removeLayers(sair);

    const entrar: L.Marker[] = [];
    for (const os of visiveis) {
      const atrasada = atrasoDaOs(os, agora) !== null;
      const assinatura = `${os.status}|${os.tipo}|${atrasada}`;
      let marcador = this.marcadoresOs.get(os.id);
      if (!marcador) {
        marcador = L.marker([os.lat as number, os.lng as number], {
          icon: this.iconeDaOs(os, atrasada),
          riseOnHover: true,
          keyboard: true,
          alt: `OS ${os.id}`,
        }) as MarcadorDeOs;
        const m = marcador;
        m.bindPopup(() => this.popupDaOs(m.os), { maxWidth: 340, minWidth: 260, autoPanPadding: [40, 40] });
        m.on('popupopen', () => this.acoes.aoSelecionar('os', String(m.os.id)));
        this.marcadoresOs.set(os.id, m);
        entrar.push(m);
      } else {
        if (marcador.assinatura !== assinatura) marcador.setIcon(this.iconeDaOs(os, atrasada));
        const atual = marcador.getLatLng();
        if (atual.lat !== os.lat || atual.lng !== os.lng) marcador.setLatLng([os.lat as number, os.lng as number]);
      }
      marcador.os = os;
      marcador.atrasada = atrasada;
      marcador.assinatura = assinatura;
    }
    if (entrar.length) this.grupoOs.addLayers(entrar);
    this.grupoOs.refreshClusters();
    for (const marcador of this.marcadoresOs.values()) {
      if (marcador.isPopupOpen()) marcador.getPopup()?.update();
    }
    this.pontosVisiveis = visiveis.map((os) => [os.lat as number, os.lng as number]);
  }

  private popupDaOs(os: OsNoMapa): string {
    const atraso = atrasoDaOs(os);
    const agenda = os.agenda
      ? `${dataHoraCurta(os.agenda)}${os.agendaFim ? ` até ${hora(os.agendaFim)}` : ''}`
      : null;
    const dados = linhasDeDados([
      ['Cliente', os.cliente ?? (os.tipo === 'E' ? 'OS de estrutura' : null)],
      ['Endereço', [os.endereco, os.cidade].filter(Boolean).join(' · ')],
      ['Técnico', os.tecnico ?? (os.tecnicoId ? `Colaborador ${os.tecnicoId}` : 'Sem técnico')],
      ['Prioridade', os.prioridade],
      ['Abertura', dataHoraCurta(os.abertura)],
      ['Agenda', agenda],
      ['Prazo SLA', dataHoraCurta(os.prazo)],
      ['Protocolo', os.protocolo],
    ]);

    const ponto: [number, number] = [os.lat as number, os.lng as number];
    const proximos = veiculosProximos(this.todosOsVeiculos, ponto, 3);
    // O carro do técnico da OS entra na lista mesmo longe: é a pergunta que
    // quem despacha faz primeiro.
    const doTecnico =
      os.tecnicoId !== null
        ? this.todosOsVeiculos.find((v) => v.tecnicoId === os.tecnicoId && v.lat !== null && v.lng !== null)
        : undefined;
    if (doTecnico && !proximos.some(({ v }) => v.id === doTecnico.id)) {
      proximos.push({ v: doTecnico, km: distanciaKm(ponto, [doTecnico.lat as number, doTecnico.lng as number]) });
    }
    const itens = proximos
      .map(({ v, km }) => {
        const ehDoTecnico = os.tecnicoId !== null && v.tecnicoId === os.tecnicoId;
        return `<li><button type="button" data-acao="veiculo" data-id="${esc(v.id)}">
          <span class="bolinha" style="--cor:${ESTADOS_DO_VEICULO[v.estado].cor}"></span>
          <span class="nome">${esc(v.nome)}${v.tecnico ? ` · ${esc(v.tecnico)}` : ''}</span>
          ${ehDoTecnico ? '<span class="tag">TÉCNICO DA OS</span>' : ''}
          <span class="dist">${textoKm(km)}</span>
        </button></li>`;
      })
      .join('');
    const secaoProximos = itens
      ? `<div class="pop-secao"><h4>Veículos mais perto (linha reta)</h4><ul class="pop-proximos">${itens}</ul></div>`
      : '';
    const origem = os.origemPosicao && os.origemPosicao !== 'os' ? ORIGEM_DA_POSICAO[os.origemPosicao] : null;

    return `
      <div class="pop-cabecalho">
        <div class="pop-titulo">OS ${esc(os.id)} · ${esc(os.assunto ?? 'Sem assunto')}</div>
        <span class="pop-status" style="--cor:${corDoStatus(os.status)}">${esc(os.statusNome)}</span>
      </div>
      ${atraso ? `<p class="pop-alerta">${atraso === 'agenda' ? 'O horário agendado já passou' : 'O prazo do SLA estourou'}</p>` : ''}
      <dl class="pop-dados">${dados}</dl>
      ${os.mensagem ? `<p class="pop-mensagem">${esc(os.mensagem)}</p>` : ''}
      ${origem ? `<div class="pop-nota">Posição aproximada, tirada do ${esc(origem)}.</div>` : ''}
      ${secaoProximos}
      <div class="pop-acoes">
        <a class="pop-botao" href="https://www.google.com/maps/dir/?api=1&amp;destination=${ponto[0]},${ponto[1]}" target="_blank" rel="noopener noreferrer">Como chegar</a>
      </div>`;
  }

  abrirOs(id: number): void {
    const marcador = this.marcadoresOs.get(id);
    if (!marcador) return;
    if (!this.mapa.hasLayer(this.grupoOs)) this.mapa.addLayer(this.grupoOs);
    this.grupoOs.zoomToShowLayer(marcador, () => marcador.openPopup());
  }

  // ---------------------------------------------------------------- Frota

  private iconeDoVeiculo(v: VeiculoNoMapa, classeExtra: string): L.DivIcon {
    const cor = ESTADOS_DO_VEICULO[v.estado].cor;
    const seta =
      v.estado === 'movimento'
        ? `<div class="seta" style="transform:rotate(${Math.round(v.curso)}deg)"></div>`
        : '';
    return L.divIcon({
      className: `marcador-veiculo${classeExtra}`,
      html: `<div class="veiculo" style="--cor:${cor}">${seta}<div class="disco">${ICONE_VAN}</div><span class="rotulo">${esc(v.nome)}</span></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18],
    });
  }

  /**
   * Desenha a frota. Com um técnico escolhido no filtro, o carro dele fica em
   * destaque e os outros esmaecem — se ele tiver carro; sem carro, ninguém
   * esmaece à toa.
   */
  desenharVeiculos(lista: VeiculoNoMapa[], tecnicoEscolhido: number | null): void {
    const visiveis = lista.filter((v) => v.lat !== null && v.lng !== null);
    const ids = new Set(visiveis.map((v) => v.id));
    for (const [id, marcador] of this.marcadoresVeiculo) {
      if (!ids.has(id)) {
        this.grupoFrota.removeLayer(marcador);
        this.marcadoresVeiculo.delete(id);
      }
    }

    const temCarro =
      tecnicoEscolhido !== null && this.todosOsVeiculos.some((v) => v.tecnicoId === tecnicoEscolhido);
    for (const v of visiveis) {
      const classeExtra = !temCarro ? '' : v.tecnicoId === tecnicoEscolhido ? ' destacado' : ' esmaecido';
      const assinatura = `${v.estado}|${Math.round(v.curso / 5)}|${v.nome}|${classeExtra}`;
      let marcador = this.marcadoresVeiculo.get(v.id);
      if (!marcador) {
        marcador = L.marker([v.lat as number, v.lng as number], {
          icon: this.iconeDoVeiculo(v, classeExtra),
          zIndexOffset: 1000,
          keyboard: true,
          alt: v.nome,
        }) as MarcadorDeVeiculo;
        const m = marcador;
        m.bindPopup(() => this.popupDoVeiculo(m.veiculo), { maxWidth: 320, minWidth: 240 });
        m.on('popupopen', () => this.acoes.aoSelecionar('veiculo', m.veiculo.id));
        m.addTo(this.grupoFrota);
        this.marcadoresVeiculo.set(v.id, m);
      } else {
        if (marcador.assinatura !== assinatura) marcador.setIcon(this.iconeDoVeiculo(v, classeExtra));
        const atual = marcador.getLatLng();
        if (atual.lat !== v.lat || atual.lng !== v.lng) marcador.setLatLng([v.lat as number, v.lng as number]);
      }
      marcador.veiculo = v;
      marcador.assinatura = assinatura;
    }

    this.grupoRastro.clearLayers();
    for (const v of visiveis) {
      if (v.rastro.length === 0) continue;
      L.polyline([...v.rastro, [v.lat as number, v.lng as number]], {
        color: ESTADOS_DO_VEICULO[v.estado].cor,
        weight: 3,
        opacity: 0.75,
        dashArray: '4 6',
        interactive: false,
      }).addTo(this.grupoRastro);
    }
    for (const marcador of this.marcadoresVeiculo.values()) {
      if (marcador.isPopupOpen()) marcador.getPopup()?.update();
    }
    this.pontosDaFrota = visiveis.map((v) => [v.lat as number, v.lng as number]);
  }

  private popupDoVeiculo(v: VeiculoNoMapa): string {
    const estado = ESTADOS_DO_VEICULO[v.estado];
    const dados = linhasDeDados([
      ['Placa', v.placa],
      ['Técnico', v.tecnico ?? (v.tecnicoId ? `Colaborador ${v.tecnicoId}` : null)],
      ['Equipe', v.equipe],
      ['Grupo', v.grupo],
      ['Motorista', v.motorista],
      ['Velocidade', v.estado === 'movimento' ? `${v.velocidade} km/h` : null],
      ['Parado há', v.estado === 'parado' ? v.tempoParado : null],
      ['Ignição', v.ignicao === null ? null : v.ignicao ? 'Ligada' : 'Desligada'],
      ['Última posição', v.horario ? `${haQuanto(v.horario)} (${dataHoraCurta(v.horario)})` : null],
      ['Endereço', v.endereco],
    ]);
    const osDoTecnico = v.tecnicoId !== null ? this.todasAsOs.filter((os) => os.tecnicoId === v.tecnicoId) : [];
    const acao =
      v.tecnicoId !== null
        ? `<div class="pop-acoes"><button type="button" class="pop-botao" data-acao="filtrar-tecnico" data-id="${esc(v.tecnicoId)}">
            ${osDoTecnico.length ? `Ver as ${osDoTecnico.length} OS do técnico` : 'O técnico não tem OS aberta'}</button></div>`
        : '<div class="pop-nota">Sem técnico ligado. Ligue em Rastreadores, no menu.</div>';

    return `
      <div class="pop-cabecalho">
        <div class="pop-titulo">${esc(v.nome)}</div>
        <span class="pop-status" style="--cor:${estado.cor}">${estado.nome}</span>
      </div>
      <dl class="pop-dados">${dados}</dl>
      ${acao}`;
  }

  abrirVeiculo(id: string): void {
    const marcador = this.marcadoresVeiculo.get(id);
    if (!marcador) return;
    if (!this.mapa.hasLayer(this.grupoFrota)) this.mapa.addLayer(this.grupoFrota);
    this.mapa.closePopup();
    const destino = marcador.getLatLng();
    if (this.mapa.getZoom() >= 15 && this.mapa.getBounds().pad(-0.1).contains(destino)) {
      marcador.openPopup();
      return;
    }
    this.mapa.once('moveend', () => marcador.openPopup());
    this.mapa.flyTo(destino, Math.max(this.mapa.getZoom(), 15), { duration: 0.6 });
  }

  fecharPopup(): void {
    this.mapa.closePopup();
  }
}
