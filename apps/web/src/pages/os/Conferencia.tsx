import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { abrirArquivo } from '../../lib/arquivo';
import {
  MOTIVOS_DE_PROBLEMA,
  SITUACAO_DA_CONFERENCIA,
  diaNaTela,
  horaDoIxc,
  type ConferenciaNaTela,
  type DiaNaConferencia,
  type FilaDaConferencia,
  type OsNaConferencia,
  type OsParaConferir,
  type ProblemaNaTela,
  type Sinal,
} from '../../lib/conferencia';
import { ehAssinatura, type ArquivoDaOs } from '../../lib/os';

/**
 * A conferência das OS fechadas, pelo chefe do almoxarifado.
 *
 * Dia a dia: toda OS que um técnico de campo fechou no IXC — pelo app de lá,
 * pelo atendimento ou por aqui — aparece na fila do dia em que fechou. O
 * sistema olha antes e põe no topo as que têm aviso (sem foto, instalação sem
 * aparelho, aparelho em outro contrato, retirada não baixada). O chefe abre, vê as fotos, os aparelhos da OS e o comodato do
 * contrato lado a lado, e diz: conferida, ou com problema (com o motivo).
 *
 * O problema volta para o técnico, que vê no celular e responde. Quem conferiu
 * marca resolvida depois — e o relatório do mês conta quem acertou de primeira.
 */
export function Conferencia() {
  const [aba, setAba] = useState<'dia' | 'problemas'>('dia');
  const [dia, setDia] = useState<string | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);
  const [mostrar, setMostrar] = useState<'pendentes' | 'todas'>('pendentes');

  const fila = useQuery({
    queryKey: ['os', 'conferencia', 'fila'],
    queryFn: async () => (await api.get<FilaDaConferencia>('/os/conferencia')).data,
  });
  // A tela abre no dia mais antigo que ainda falta conferir.
  useEffect(() => {
    if (dia || !fila.data) return;
    setDia(fila.data.primeiroPendente ?? fila.data.dias[0]?.dia ?? null);
  }, [fila.data, dia]);

  const doDia = useQuery({
    queryKey: ['os', 'conferencia', 'dia', dia],
    queryFn: async () => (await api.get<DiaNaConferencia>(`/os/conferencia/dia/${dia}`)).data,
    enabled: !!dia && aba === 'dia',
  });
  const problemas = useQuery({
    queryKey: ['os', 'conferencia', 'problemas'],
    queryFn: async () => (await api.get<ProblemaNaTela[]>('/os/conferencia/problemas')).data,
    enabled: aba === 'problemas',
  });

  const visiveis = useMemo(
    () =>
      (doDia.data?.os ?? []).filter(
        (o) => mostrar === 'todas' || !o.conferencia || o.conferencia.situacao === 'PROBLEMA',
      ),
    [doDia.data, mostrar],
  );

  /** A próxima da fila que ainda falta conferir, depois desta. */
  function proximaDepois(osId: number): number | null {
    const lista = doDia.data?.os ?? [];
    const i = lista.findIndex((o) => o.id === osId);
    const depois = [...lista.slice(i + 1), ...lista.slice(0, Math.max(i, 0))];
    return depois.find((o) => !o.conferencia && o.id !== osId)?.id ?? null;
  }

  const problemasAbertos = fila.data?.problemasAbertos ?? 0;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Ordens de Serviço"
        titulo="Conferência"
        acoes={
          <div className="flex rounded-xl border border-tinta-200 p-0.5">
            {[
              { valor: 'dia' as const, rotulo: 'Do dia' },
              { valor: 'problemas' as const, rotulo: `Com problema${problemasAbertos ? ` (${problemasAbertos})` : ''}` },
            ].map((o) => (
              <button
                key={o.valor}
                type="button"
                onClick={() => {
                  setAba(o.valor);
                  setAberta(null);
                }}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${
                  aba === o.valor ? 'bg-brand-500/10 text-brand-800 dark:text-brand-200' : 'text-tinta-500'
                }`}
              >
                {o.rotulo}
              </button>
            ))}
          </div>
        }
      />

      {fila.isError && <Aviso tom="erro">{mensagemErro(fila.error)}</Aviso>}

      {aba === 'dia' && fila.data && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {[...fila.data.dias].reverse().map((d) => (
            <button
              key={d.dia}
              type="button"
              onClick={() => {
                setDia(d.dia);
                setAberta(null);
              }}
              className={`shrink-0 rounded-xl border px-3 py-1.5 text-left text-[12px] ${
                dia === d.dia
                  ? 'border-brand-400 bg-brand-500/10 text-brand-800 dark:text-brand-200'
                  : 'border-tinta-200 text-tinta-600'
              }`}
            >
              <span className="block font-medium capitalize">{diaNaTela(d.dia)}</span>
              <span className={d.pendentes ? 'text-amber-700 dark:text-amber-300' : 'text-tinta-400'}>
                {d.total === 0 ? 'nenhuma' : d.pendentes ? `${d.pendentes} de ${d.total} faltam` : `${d.total} conferidas`}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className={aberta ? 'hidden lg:block' : ''}>
          {aba === 'dia' ? (
            <ListaDoDia
              carregando={doDia.isLoading || (!dia && fila.isLoading)}
              erro={doDia.isError ? mensagemErro(doDia.error) : null}
              dia={doDia.data ?? null}
              visiveis={visiveis}
              mostrar={mostrar}
              onMostrar={setMostrar}
              aberta={aberta}
              onAbrir={setAberta}
            />
          ) : (
            <ListaDeProblemas
              carregando={problemas.isLoading}
              erro={problemas.isError ? mensagemErro(problemas.error) : null}
              problemas={problemas.data ?? []}
              aberta={aberta}
              onAbrir={setAberta}
            />
          )}
        </div>

        <div className={aberta ? '' : 'hidden lg:block'}>
          {aberta ? (
            <DetalheDaOs
              key={aberta}
              osId={aberta}
              onVoltar={() => setAberta(null)}
              onProxima={() => setAberta(aba === 'dia' ? proximaDepois(aberta) : null)}
            />
          ) : (
            <Bloco>
              <Vazio titulo="Escolha uma OS na lista">
                As com aviso estão no topo de cada técnico. Abra, confira as fotos e os aparelhos, e diga se
                está certa.
              </Vazio>
            </Bloco>
          )}
        </div>
      </div>
    </Pagina>
  );
}

// ---------------------------------------------------------------------------
// As listas
// ---------------------------------------------------------------------------

function ListaDoDia({
  carregando,
  erro,
  dia,
  visiveis,
  mostrar,
  onMostrar,
  aberta,
  onAbrir,
}: {
  carregando: boolean;
  erro: string | null;
  dia: DiaNaConferencia | null;
  visiveis: OsNaConferencia[];
  mostrar: 'pendentes' | 'todas';
  onMostrar: (m: 'pendentes' | 'todas') => void;
  aberta: number | null;
  onAbrir: (osId: number) => void;
}) {
  const total = dia?.os.length ?? 0;
  const conferidas = dia?.os.filter((o) => o.conferencia).length ?? 0;
  const porTecnico = new Map<string, OsNaConferencia[]>();
  for (const o of visiveis) porTecnico.set(o.tecnico, [...(porTecnico.get(o.tecnico) ?? []), o]);

  return (
    <Bloco semPadding>
      <div className="space-y-2 border-b border-tinta-100 px-4 py-3">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-medium text-tinta-700">
            {conferidas} de {total} conferidas
          </span>
          <div className="flex rounded-lg border border-tinta-200 p-0.5 text-[12px]">
            {(['pendentes', 'todas'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onMostrar(m)}
                className={`rounded-md px-2 py-0.5 ${mostrar === m ? 'bg-tinta-100 text-tinta-800' : 'text-tinta-500'}`}
              >
                {m === 'pendentes' ? 'Faltam' : 'Todas'}
              </button>
            ))}
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-tinta-100">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: total ? `${Math.round((conferidas / total) * 100)}%` : '0%' }}
          />
        </div>
      </div>

      {carregando && <Carregando texto="Lendo as OS do dia no IXC…" />}
      {erro && <div className="p-4"><Aviso tom="erro">{erro}</Aviso></div>}
      {!carregando && !erro && visiveis.length === 0 && (
        <Vazio titulo={total === 0 ? 'Nenhuma OS de campo fechou neste dia' : 'Tudo conferido neste dia'} />
      )}

      {[...porTecnico.entries()].map(([tecnico, lista]) => (
        <div key={tecnico}>
          <p className="bg-realce px-4 py-1.5 text-[12px] font-medium text-tinta-500">
            {tecnico} · {lista.filter((o) => !o.conferencia).length} faltam
          </p>
          <ul className="lista-dividida">
            {lista.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onAbrir(o.id)}
                  className={`block w-full px-4 py-2.5 text-left transition hover:bg-brand-500/5 ${
                    aberta === o.id ? 'bg-brand-500/10' : ''
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] font-semibold text-tinta-800">OS {o.id}</span>
                    <span className="text-[12px] text-tinta-400">{horaDoIxc(o.fechamento)}</span>
                  </div>
                  <p className="truncate text-[13px] text-tinta-500">
                    {[o.assunto, o.cliente].filter(Boolean).join(' · ')}
                  </p>
                  <SelosDaOs os={o} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Bloco>
  );
}

/** A situação da conferência e os avisos, em selos pequenos. */
function SelosDaOs({ os }: { os: OsNaConferencia }) {
  const c = os.conferencia;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {c && (
        <Selo tom={SITUACAO_DA_CONFERENCIA[c.situacao].tom} pequeno>
          {SITUACAO_DA_CONFERENCIA[c.situacao].rotulo}
        </Selo>
      )}
      {os.erroDeLeitura && (
        <Selo tom="atencao" pequeno>
          Não lida do IXC
        </Selo>
      )}
      {os.sinais.slice(0, 2).map((s) => (
        <Selo key={s.codigo + s.texto} tom={s.gravidade === 'PROBLEMA' ? 'erro' : 'atencao'} pequeno>
          {s.texto}
        </Selo>
      ))}
      {os.sinais.length > 2 && (
        <Selo tom="neutro" pequeno>
          +{os.sinais.length - 2}
        </Selo>
      )}
      {!c && os.sinais.length === 0 && !os.erroDeLeitura && (
        <Selo tom="pago" pequeno>
          Sem aviso
        </Selo>
      )}
    </div>
  );
}

function ListaDeProblemas({
  carregando,
  erro,
  problemas,
  aberta,
  onAbrir,
}: {
  carregando: boolean;
  erro: string | null;
  problemas: ProblemaNaTela[];
  aberta: number | null;
  onAbrir: (osId: number) => void;
}) {
  return (
    <Bloco semPadding titulo="Com problema aberto">
      {carregando && <Carregando />}
      {erro && <div className="p-4"><Aviso tom="erro">{erro}</Aviso></div>}
      {!carregando && !erro && problemas.length === 0 && (
        <Vazio titulo="Nenhum problema aberto">As OS marcadas com problema aparecem aqui até serem resolvidas.</Vazio>
      )}
      <ul className="lista-dividida">
        {problemas.map((p) => (
          <li key={p.osIxcId}>
            <button
              type="button"
              onClick={() => onAbrir(p.osIxcId)}
              className={`block w-full px-4 py-2.5 text-left transition hover:bg-brand-500/5 ${
                aberta === p.osIxcId ? 'bg-brand-500/10' : ''
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] font-semibold text-tinta-800">OS {p.osIxcId}</span>
                <span className="text-[12px] capitalize text-tinta-400">{diaNaTela(p.dia)}</span>
              </div>
              <p className="truncate text-[13px] text-tinta-500">
                {[p.tecnico, p.assunto, p.cliente].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-0.5 text-[13px] text-rose-700 dark:text-rose-300">{p.motivoTexto}</p>
              {p.respostaDoTecnico && (
                <div className="mt-1">
                  <Selo tom="info" pequeno ponto>
                    O técnico respondeu
                  </Selo>
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// A OS aberta
// ---------------------------------------------------------------------------

function DetalheDaOs({
  osId,
  onVoltar,
  onProxima,
}: {
  osId: number;
  onVoltar: () => void;
  onProxima: () => void;
}) {
  const qc = useQueryClient();
  const [ampliada, setAmpliada] = useState<ArquivoDaOs | null>(null);
  const os = useQuery({
    queryKey: ['os', 'conferencia', 'os', osId],
    queryFn: async () => (await api.get<OsParaConferir>(`/os/conferencia/os/${osId}`)).data,
  });

  const conferir = useMutation({
    mutationFn: async (p: { situacao: 'CONFERIDA' | 'PROBLEMA'; motivo?: string; observacao?: string; proxima?: boolean }) =>
      (
        await api.post<ConferenciaNaTela>(`/os/conferencia/os/${osId}`, {
          situacao: p.situacao,
          motivo: p.motivo,
          observacao: p.observacao,
        })
      ).data,
    onSuccess: (_, p) => {
      void qc.invalidateQueries({ queryKey: ['os', 'conferencia'] });
      if (p.proxima) onProxima();
    },
  });

  if (os.isLoading) {
    return (
      <Bloco>
        <Carregando texto="Lendo a OS, as fotos e o comodato no IXC…" />
      </Bloco>
    );
  }
  if (os.isError || !os.data) {
    return (
      <Bloco>
        <Aviso tom="erro">{mensagemErro(os.error)}</Aviso>
        <button type="button" onClick={onVoltar} className="btn btn-sutil">
          Voltar à lista
        </button>
      </Bloco>
    );
  }

  const o = os.data;
  const fotos = o.arquivos.filter((a) => a.classificacao !== 'O');
  const pdfs = o.arquivos.filter((a) => a.classificacao === 'O');
  const contratoDoAparelho = (contratoId: number) => contratoId > 0 && contratoId !== o.contratoId;

  return (
    <div className="space-y-4">
      <Bloco>
        <button type="button" onClick={onVoltar} className="mb-2 text-[13px] font-medium text-tinta-500 lg:hidden">
          ‹ Voltar à lista
        </button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-tinta-800">
              OS {o.id}
              {o.assunto ? ` · ${o.assunto}` : ''}
            </h2>
            <p className="text-[13px] text-tinta-500">
              {[o.cliente, `contrato ${o.contratoId}`, o.tecnico, `fechada ${diaNaTela(o.dia)} ${horaDoIxc(o.fechamento)}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {o.endereco && <p className="text-[12px] text-tinta-400">{o.endereco}</p>}
          </div>
          {o.conferencia && (
            <Selo tom={SITUACAO_DA_CONFERENCIA[o.conferencia.situacao].tom}>
              {SITUACAO_DA_CONFERENCIA[o.conferencia.situacao].rotulo}
            </Selo>
          )}
        </div>
        {o.sinais.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {o.sinais.map((s) => (
              <LinhaDoSinal key={s.codigo + s.texto} sinal={s} />
            ))}
          </ul>
        )}
      </Bloco>

      <Bloco titulo={`Fotos e assinatura (${fotos.length})`}>
        {fotos.length === 0 ? (
          <p className="text-[13px] text-tinta-500">Nenhuma foto nos arquivos da OS.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {fotos.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setAmpliada(a)} className="block w-full text-left">
                  <ImagemDaApi
                    caminho={`/os/conferencia/arquivos/${a.id}`}
                    alt={a.descricao}
                    className={`aspect-square w-full rounded-xl border border-tinta-200 ${
                      ehAssinatura(a) ? 'bg-white object-contain' : 'object-cover'
                    }`}
                  />
                  <span className="mt-1 block truncate text-[12px] text-tinta-600">{a.descricao}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {pdfs.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => void abrirArquivo(`/os/conferencia/arquivos/${a.id}`, `os-${o.id}.pdf`)}
            className="mt-2 text-[13px] font-medium text-brand-700 underline dark:text-brand-300"
          >
            {a.descricao} (PDF)
          </button>
        ))}
      </Bloco>

      <div className="grid gap-4 xl:grid-cols-2">
        <Bloco titulo="Aparelhos que a OS pôs em comodato">
          {o.aparelhos.length === 0 ? (
            <p className="text-[13px] text-tinta-500">Nenhum.</p>
          ) : (
            <ul className="space-y-2">
              {o.aparelhos.map((a) => (
                <li key={a.id} className="text-[13px]">
                  <p className="font-medium text-tinta-800">{a.descricao ?? `Produto ${a.produtoId}`}</p>
                  <p className="text-tinta-500">
                    {[
                      a.numeroSerie && `série ${a.numeroSerie}`,
                      a.mac && `MAC ${a.mac}`,
                      a.numeroPatrimonial && `patrimônio ${a.numeroPatrimonial}`,
                      a.status === 'D' ? 'devolvido' : 'emprestado',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {contratoDoAparelho(a.contratoId) && (
                    <p className="text-rose-700 dark:text-rose-300">Foi para o contrato {a.contratoId}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Bloco>

        <Bloco titulo={`Comodato do contrato ${o.contratoId} agora`}>
          {o.comodatoDoContrato.length === 0 ? (
            <p className="text-[13px] text-tinta-500">Nenhum aparelho emprestado.</p>
          ) : (
            <ul className="space-y-2">
              {o.comodatoDoContrato.map((c) => (
                <li key={c.comodatoId} className="text-[13px]">
                  <p className="font-medium text-tinta-800">{c.descricao ?? `Produto ${c.produtoId}`}</p>
                  <p className="text-tinta-500">
                    {[
                      c.numeroSerie && `série ${c.numeroSerie}`,
                      c.mac && `MAC ${c.mac}`,
                      c.numeroPatrimonial && `patrimônio ${c.numeroPatrimonial}`,
                      c.desde && `desde ${c.desde.split('-').reverse().join('/')}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Bloco>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Bloco titulo="Relatório do técnico">
          <p className="whitespace-pre-line text-[13px] text-tinta-700">{o.relatorio ?? 'Sem relatório.'}</p>
          {o.mensagem && (
            <p className="mt-2 whitespace-pre-line text-[12px] text-tinta-400">Abertura: {o.mensagem}</p>
          )}
        </Bloco>

        <Bloco titulo="Material e localização">
          {o.materiais.length === 0 ? (
            <p className="text-[13px] text-tinta-500">Nenhum material lançado na OS.</p>
          ) : (
            <ul className="space-y-0.5 text-[13px] text-tinta-700">
              {o.materiais.map((m) => (
                <li key={m.id}>
                  {m.quantidade.toLocaleString('pt-BR')} {m.unidade ?? ''} · {m.descricao ?? `Produto ${m.produtoId}`}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[13px] text-tinta-600">
            {o.fechamentoGps ? (
              <>
                Onde a OS fechou{o.fechamentoGps.em ? ` (${horaDoIxc(o.fechamentoGps.em)})` : ''}:{' '}
                <a
                  href={`https://www.google.com/maps?q=${o.fechamentoGps.latitude},${o.fechamentoGps.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Ver no mapa
                </a>
              </>
            ) : (
              'Sem o GPS do fechamento.'
            )}
          </p>
          {o.itensDoApp.length > 0 && (
            <div className="mt-3">
              <p className="text-[12px] font-medium text-tinta-500">Anotado no celular daqui</p>
              <ul className="text-[13px] text-tinta-700">
                {o.itensDoApp.map((i, n) => (
                  <li key={n}>
                    {i.descricao}
                    {i.situacao !== 'GRAVADO' && <span className="text-rose-600"> · {i.situacao.toLowerCase()}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Bloco>
      </div>

      <Veredito
        conferencia={o.conferencia}
        enviando={conferir.isPending}
        erro={conferir.error ? mensagemErro(conferir.error) : null}
        onConferida={(observacao, proxima) => conferir.mutate({ situacao: 'CONFERIDA', observacao, proxima })}
        onProblema={(motivo, observacao) => conferir.mutate({ situacao: 'PROBLEMA', motivo, observacao })}
      />

      {ampliada && (
        <div
          role="dialog"
          aria-label={ampliada.descricao}
          onClick={() => setAmpliada(null)}
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
        >
          <ImagemDaApi
            caminho={`/os/conferencia/arquivos/${ampliada.id}`}
            alt={ampliada.descricao}
            className="max-h-[85vh] max-w-full rounded-lg bg-white object-contain"
          />
          <p className="text-[14px] text-white">{ampliada.descricao} · toque para fechar</p>
        </div>
      )}
    </div>
  );
}

function LinhaDoSinal({ sinal }: { sinal: Sinal }) {
  const problema = sinal.gravidade === 'PROBLEMA';
  return (
    <li
      className={`rounded-lg px-3 py-1.5 text-[13px] ${
        problema
          ? 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200'
          : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'
      }`}
    >
      {sinal.texto}
    </li>
  );
}

/** Os botões do veredito, e o que já se decidiu. */
function Veredito({
  conferencia: c,
  enviando,
  erro,
  onConferida,
  onProblema,
}: {
  conferencia: ConferenciaNaTela | null;
  enviando: boolean;
  erro: string | null;
  onConferida: (observacao: string | undefined, proxima: boolean) => void;
  onProblema: (motivo: string, observacao: string | undefined) => void;
}) {
  const [problema, setProblema] = useState(false);
  const [motivo, setMotivo] = useState(c?.motivo ?? '');
  const [observacao, setObservacao] = useState('');
  const [resolucao, setResolucao] = useState('');
  const obs = observacao.trim() || undefined;
  const podeMarcarProblema = !!motivo && (motivo !== 'OUTRO' || observacao.trim().length >= 3);

  return (
    <Bloco titulo="Conferência">
      {c?.situacao === 'PROBLEMA' && !problema && (
        <div className="mb-3 space-y-1 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
          <p>
            <strong>Com problema:</strong> {c.motivoTexto}
            {c.observacao ? ` — ${c.observacao}` : ''}
          </p>
          <p className="text-[12px] opacity-80">
            {c.conferidaPor}, {quando(c.conferidaEm)}
          </p>
          {c.respostaDoTecnico ? (
            <p className="rounded-md bg-papel px-2 py-1 text-tinta-700">
              <strong>O técnico respondeu</strong> ({quando(c.respondidaEm)}): {c.respostaDoTecnico}
            </p>
          ) : (
            <p className="text-[12px] opacity-80">O técnico ainda não respondeu.</p>
          )}
        </div>
      )}
      {(c?.situacao === 'CONFERIDA' || c?.situacao === 'RESOLVIDA') && !problema && (
        <p className="mb-3 text-[13px] text-tinta-600">
          {c.situacao === 'RESOLVIDA'
            ? `Teve problema (${c.motivoTexto}) e foi resolvida por ${c.resolvidaPor}, ${quando(c.resolvidaEm)}${c.resolucao ? ` — ${c.resolucao}` : ''}.`
            : `Conferida por ${c.conferidaPor}, ${quando(c.conferidaEm)}${c.observacao ? ` — ${c.observacao}` : ''}.`}
        </p>
      )}

      {problema ? (
        <div className="space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="rotulo">O que está errado</legend>
            {MOTIVOS_DE_PROBLEMA.map((m) => (
              <label key={m.codigo} className="flex items-center gap-2 text-[14px] text-tinta-700">
                <input
                  type="radio"
                  name="motivo"
                  checked={motivo === m.codigo}
                  onChange={() => setMotivo(m.codigo)}
                />
                {m.texto}
              </label>
            ))}
          </fieldset>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value.slice(0, 1000))}
            rows={3}
            className="campo"
            placeholder={motivo === 'OUTRO' ? 'Diga qual é o problema' : 'O que o técnico precisa saber (opcional)'}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setProblema(false)} disabled={enviando} className="btn btn-sutil">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                onProblema(motivo, obs);
                setProblema(false);
              }}
              disabled={!podeMarcarProblema || enviando}
              className="btn btn-perigo flex-1 justify-center"
            >
              {enviando ? 'Salvando…' : 'Marcar com problema'}
            </button>
          </div>
        </div>
      ) : c?.situacao === 'PROBLEMA' ? (
        <div className="space-y-2">
          <input
            value={resolucao}
            onChange={(e) => setResolucao(e.target.value.slice(0, 1000))}
            className="campo"
            placeholder="Como se resolveu (opcional)"
            aria-label="Como se resolveu"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onConferida(resolucao.trim() || undefined, false)}
              disabled={enviando}
              className="btn btn-primario flex-1 justify-center"
            >
              {enviando ? 'Salvando…' : 'Resolvida'}
            </button>
            <button type="button" onClick={() => setProblema(true)} disabled={enviando} className="btn btn-sutil">
              Mudar o motivo
            </button>
          </div>
        </div>
      ) : c ? (
        <button type="button" onClick={() => setProblema(true)} disabled={enviando} className="btn btn-sutil">
          Reabrir com problema
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onConferida(undefined, true)}
            disabled={enviando}
            className="btn btn-primario flex-1 justify-center py-3"
          >
            {enviando ? 'Salvando…' : 'Conferida e próxima'}
          </button>
          <button
            type="button"
            onClick={() => setProblema(true)}
            disabled={enviando}
            className="btn btn-sutil flex-1 justify-center py-3 text-rose-700 dark:text-rose-300"
          >
            Com problema…
          </button>
        </div>
      )}
      {erro && <p className="mt-2 text-[13px] text-rose-600 dark:text-rose-300">{erro}</p>}
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// Miudezas
// ---------------------------------------------------------------------------

/**
 * Uma imagem que só sai com login: buscada com o token e mostrada de um
 * endereço temporário (ver `abrirArquivo`). Guardada pelo React Query — a
 * miniatura e a ampliada são a mesma busca.
 */
function ImagemDaApi({ caminho, alt, className }: { caminho: string; alt: string; className?: string }) {
  const arquivo = useQuery({
    queryKey: ['os', 'conferencia', 'imagem', caminho],
    queryFn: async () => (await api.get<Blob>(caminho, { responseType: 'blob' })).data,
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!arquivo.data) return;
    const u = URL.createObjectURL(arquivo.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [arquivo.data]);

  if (arquivo.isError) {
    return (
      <div className={`flex items-center justify-center bg-tinta-100 text-[12px] text-tinta-500 ${className ?? ''}`}>
        Não abriu
      </div>
    );
  }
  if (!url) return <div className={`animate-pulse bg-tinta-100 ${className ?? ''}`} />;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}

/** "23/10 14:32". */
function quando(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
