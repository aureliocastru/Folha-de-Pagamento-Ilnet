import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Aviso, Carregando, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { reduzirFoto } from '../../lib/foto';
import {
  FINALIZACAO_LABEL,
  FOTOS_POR_FINALIZACAO,
  SITUACAO_LABEL,
  SITUACAO_TOM,
  TIPO_LABEL,
  TIPO_TOM,
  identificacaoDaPeca,
  quantidadeComUnidade,
  type OsAberta,
  type ParaFinalizar,
  type ResultadoDaFinalizacao,
} from '../../lib/os';

/**
 * Finalizar a OS pelo celular: um passo a passo curto, inspirado no
 * "finalizar wizard" do IXC.
 *
 * 1. **O que foi feito** — a resposta padrão (a do assunto já vem escolhida, e
 *    o texto dela vai para o relato, como no IXC), o diagnóstico, o relato e a
 *    hora em que o serviço começou.
 * 2. **Fotos** — tiradas na hora ou escolhidas da galeria, quantas o técnico
 *    quiser (até o teto). Vão anexadas na OS do IXC antes do fechamento.
 * 3. **Conferir e finalizar** — o resumo, com o que ainda não foi ao IXC (vai
 *    antes do fechamento), e a localização do celular.
 *
 * O que cada OS pede vem do assunto no IXC: o diagnóstico obrigatório, o
 * aparelho ou o produto exigido, quantas fotos. O assunto que exige equipe
 * ainda se finaliza pelo IXC, e a tela diz isso antes de o técnico preencher
 * nada.
 */
export function CampoFinalizar() {
  const { osId } = useParams<{ osId: string }>();
  const id = Number(osId);
  const qc = useQueryClient();
  const [passo, setPasso] = useState<'relato' | 'fotos' | 'conferir'>('relato');
  const [respostaId, setRespostaId] = useState<number | null>(null);
  const [diagnosticoId, setDiagnosticoId] = useState<number | null>(null);
  const [relato, setRelato] = useState('');
  const [inicio, setInicio] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);
  const [resultado, setResultado] = useState<ResultadoDaFinalizacao | null>(null);
  const preenchido = useRef(false);

  const aberta = useQuery({
    queryKey: ['minhas-os', id],
    queryFn: async () => (await api.get<OsAberta>(`/minhas-os/${id}`)).data,
    enabled: id > 0,
    retry: 0,
  });
  const dados = useQuery({
    queryKey: ['minhas-os', id, 'finalizar'],
    queryFn: async () => (await api.get<ParaFinalizar>(`/minhas-os/${id}/finalizar`)).data,
    enabled: id > 0,
    retry: 0,
  });
  // Desde que a tela abre, e não só no último passo: o GPS leva tempo para
  // achar os satélites, e enquanto o técnico escreve o relato ele vai afinando.
  const [gps, gpsDeNovo] = useGps(!!dados.data && !dados.data.recusa && !resultado);

  // Uma vez só, quando chega: a finalização que voltou (recusada, esperando um
  // item) volta como estava; a nova começa com o que o assunto sugere.
  useEffect(() => {
    const d = dados.data;
    if (!d || preenchido.current) return;
    preenchido.current = true;
    const antes = d.finalizacao;
    if (antes) {
      setRespostaId(antes.respostaId);
      setDiagnosticoId(antes.diagnosticoId);
      setRelato(antes.relato);
      setInicio(paraCampoDeHora(antes.inicio));
      return;
    }
    const sugerida = d.respostas.find((r) => r.id === d.sugestao.respostaId);
    setRespostaId(sugerida?.id ?? null);
    setRelato(sugerida?.texto ?? '');
    setInicio(d.sugestao.inicio ? paraCampoDeHora(d.sugestao.inicio) : '');
  }, [dados.data]);

  const finalizar = useMutation({
    mutationFn: async () =>
      (
        await api.post<ResultadoDaFinalizacao>(`/minhas-os/${id}/finalizar`, {
          respostaId: respostaId ?? undefined,
          diagnosticoId: diagnosticoId ?? undefined,
          relato,
          inicio: new Date(inicio).toISOString(),
          gps:
            gps.estado === 'ok' || gps.estado === 'melhorando'
              ? { latitude: gps.latitude, longitude: gps.longitude, precisao: gps.precisao, em: gps.em }
              : undefined,
          fotos,
        })
      ).data,
    onSuccess: setResultado,
    onSettled: () => void qc.invalidateQueries({ queryKey: ['minhas-os'] }),
  });

  if (!(id > 0)) return null;
  const os = aberta.data?.os;
  const d = dados.data;
  const respostas = d?.respostas ?? [];
  /** As fotos de uma tentativa anterior, que ficaram guardadas e vão junto. */
  const guardadas = d?.finalizacao?.fotos.total ?? 0;

  /** Trocar a resposta troca o texto — só se o relato ainda é o texto da anterior. */
  function escolherResposta(novaId: number | null) {
    const anterior = respostas.find((r) => r.id === respostaId)?.texto ?? '';
    const nova = respostas.find((r) => r.id === novaId)?.texto ?? '';
    if (!relato.trim() || relato.trim() === anterior.trim()) setRelato(nova);
    setRespostaId(novaId);
  }

  const faltaDiagnostico = !!d?.assunto.diagnosticoObrigatorio && diagnosticoId === null;
  const inicioValido = !!inicio && !Number.isNaN(new Date(inicio).getTime());
  const podeContinuar = relato.trim().length >= 5 && inicioValido && !faltaDiagnostico;

  return (
    <div className="space-y-5 pb-10">
      <Link
        to={`/campo/os/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-tinta-500 hover:text-tinta-800"
      >
        ‹ OS {id}
      </Link>

      <div>
        <p className="eyebrow mb-1">Finalizar OS {id}</p>
        <h1 className="titulo-pagina">{d?.assunto.nome ?? os?.assunto ?? 'Ordem de serviço'}</h1>
        {os?.cliente && <p className="mt-0.5 text-[14px] text-tinta-600">{os.cliente}</p>}
      </div>

      {(dados.isLoading || aberta.isLoading) && <Carregando texto="Lendo a OS e o assunto no IXC…" />}
      {dados.isError && <Aviso tom="erro">{mensagemErro(dados.error)}</Aviso>}
      {aberta.isError && <Aviso tom="erro">{mensagemErro(aberta.error)}</Aviso>}

      {resultado ? (
        <Resultado osId={id} resultado={resultado} />
      ) : d?.recusa ? (
        <>
          <Aviso tom="atencao">{d.recusa}</Aviso>
          <Link to={`/campo/os/${id}`} className="btn btn-neutro w-full justify-center">
            Voltar à OS
          </Link>
        </>
      ) : d && aberta.data ? (
        <>
          <ol className="flex gap-2 text-[12px] font-medium">
            {[
              { qual: 'relato', rotulo: '1 · O que foi feito' },
              { qual: 'fotos', rotulo: '2 · Fotos' },
              { qual: 'conferir', rotulo: '3 · Conferir' },
            ].map((p) => (
              <li
                key={p.qual}
                className={`flex-1 rounded-lg px-3 py-2 ${
                  passo === p.qual
                    ? 'bg-brand-500/10 text-brand-800 dark:text-brand-200'
                    : 'bg-tinta-100 text-tinta-500'
                }`}
              >
                {p.rotulo}
              </li>
            ))}
          </ol>

          {d.finalizacao?.erro && (
            <Aviso tom={d.finalizacao.situacao === 'FALHOU' ? 'erro' : 'atencao'}>
              <strong>{FINALIZACAO_LABEL[d.finalizacao.situacao]}:</strong> {d.finalizacao.erro}
            </Aviso>
          )}

          {passo === 'relato' ? (
            <div className="card space-y-4 p-4">
              <div>
                <label className="rotulo" htmlFor="fin-resposta">
                  Resposta padrão
                </label>
                <select
                  id="fin-resposta"
                  value={respostaId ?? ''}
                  onChange={(e) => escolherResposta(e.target.value ? Number(e.target.value) : null)}
                  className="campo"
                >
                  <option value="">Nenhuma</option>
                  {respostas.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="rotulo" htmlFor="fin-diagnostico">
                  Diagnóstico {d.assunto.diagnosticoObrigatorio ? '(obrigatório)' : '(opcional)'}
                </label>
                <select
                  id="fin-diagnostico"
                  value={diagnosticoId ?? ''}
                  onChange={(e) => setDiagnosticoId(e.target.value ? Number(e.target.value) : null)}
                  className="campo"
                >
                  <option value="">{d.assunto.diagnosticoObrigatorio ? 'Escolha…' : 'Nenhum'}</option>
                  {d.diagnosticos.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="rotulo" htmlFor="fin-relato">
                  O que foi feito
                </label>
                <textarea
                  id="fin-relato"
                  value={relato}
                  onChange={(e) => setRelato(e.target.value.slice(0, 2000))}
                  rows={5}
                  className="campo"
                  placeholder="Ex.: troquei a ONU, refiz o conector na caixa, sinal -19 dBm, cliente navegando."
                />
              </div>

              <div>
                <label className="rotulo" htmlFor="fin-inicio">
                  O serviço começou em
                </label>
                <input
                  id="fin-inicio"
                  type="datetime-local"
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                  min={os?.abertura ? os.abertura.replace(' ', 'T').slice(0, 16) : undefined}
                  max={paraCampoDeHora(new Date().toISOString())}
                  className="campo"
                />
                {d.sugestao.inicio && !d.finalizacao && (
                  <p className="mt-1 text-[12px] text-tinta-400">
                    Já vem com a hora da primeira anotação nesta OS. Corrija se começou antes.
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={!podeContinuar}
                onClick={() => setPasso('fotos')}
                className="btn btn-primario w-full justify-center py-3"
              >
                Continuar
              </button>
            </div>
          ) : passo === 'fotos' ? (
            <PassoDasFotos
              fotos={fotos}
              onFotos={setFotos}
              guardadas={guardadas}
              exigidas={d.assunto.fotosExigidas}
              onVoltar={() => setPasso('relato')}
              onContinuar={() => setPasso('conferir')}
            />
          ) : (
            <Conferir
              aberta={aberta.data}
              para={d}
              resposta={respostas.find((r) => r.id === respostaId)?.nome ?? null}
              diagnostico={d.diagnosticos.find((x) => x.id === diagnosticoId)?.nome ?? null}
              relato={relato}
              inicio={inicio}
              fotos={fotos}
              guardadas={guardadas}
              gps={gps}
              onGpsDeNovo={gpsDeNovo}
              enviando={finalizar.isPending}
              erro={finalizar.error ? mensagemErro(finalizar.error) : null}
              onVoltar={() => {
                finalizar.reset();
                setPasso('fotos');
              }}
              onFinalizar={() => finalizar.mutate()}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// As fotos
// ---------------------------------------------------------------------------

/**
 * A foto da OS não precisa ser lida a caneta como a da nota, e vão até dez
 * pelo sinal da casa do cliente: 1920px dão para ler o medidor e a etiqueta, e
 * abaixo de 900 KB as dez sobem num pedido só.
 */
const FOTO_DA_OS = { ladoMaior: 1920, teto: 900 * 1024 };

/**
 * Tirar na hora ou escolher da galeria — quantas o técnico quiser, até o
 * teto. As de uma tentativa anterior já estão guardadas e contam junto.
 */
function PassoDasFotos({
  fotos,
  onFotos,
  guardadas,
  exigidas,
  onVoltar,
  onContinuar,
}: {
  fotos: string[];
  onFotos: (fotos: string[]) => void;
  guardadas: number;
  exigidas: number;
  onVoltar: () => void;
  onContinuar: () => void;
}) {
  const [preparando, setPreparando] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  // As fotos de agora: cada uma chega depois de uma espera, e outra pode ter
  // saído ou entrado enquanto isso.
  const atual = useRef({ fotos, onFotos });
  atual.current = { fotos, onFotos };

  const total = guardadas + fotos.length;
  const cabem = FOTOS_POR_FINALIZACAO - total;
  const faltam = Math.max(0, exigidas - total);

  async function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = [...(e.target.files ?? [])];
    // Limpo sempre: sem isso, escolher a mesma foto de novo não dispara nada.
    e.target.value = '';
    const vagas = FOTOS_POR_FINALIZACAO - guardadas - atual.current.fotos.length - preparando;
    const escolhidas = arquivos.slice(0, Math.max(0, vagas));
    setErro(
      arquivos.length > escolhidas.length
        ? `Cabem ${FOTOS_POR_FINALIZACAO} fotos: ${arquivos.length - escolhidas.length} ficaram de fora.`
        : null,
    );
    if (escolhidas.length === 0) return;
    setPreparando((n) => n + escolhidas.length);
    // Uma de cada vez: dez fotos da câmera abertas juntas derrubam o navegador
    // de um celular mais simples.
    for (const arquivo of escolhidas) {
      try {
        const foto = await reduzirFoto(arquivo, FOTO_DA_OS);
        const { fotos: agora, onFotos: avisar } = atual.current;
        if (!agora.includes(foto)) avisar([...agora, foto]);
      } catch (err) {
        setErro(err instanceof Error ? err.message : String(err));
      } finally {
        setPreparando((n) => n - 1);
      }
    }
  }

  return (
    <div className="card space-y-4 p-4">
      <div>
        <h2 className="text-[15px] font-semibold text-tinta-800">Fotos do serviço</h2>
        <p className="mt-0.5 text-[13px] text-tinta-500">
          {exigidas > 0
            ? `O assunto pede ${exigidas > 1 ? `${exigidas} fotos` : '1 foto'}. Pode pôr mais, se quiser.`
            : 'Ponha as que quiser: a instalação, a caixa, o sinal no medidor, a etiqueta do aparelho.'}{' '}
          Vão anexadas na OS do IXC.
        </p>
      </div>

      {guardadas > 0 && (
        <p className="rounded-lg bg-realce px-3 py-2 text-[13px] text-tinta-600">
          {guardadas > 1 ? `${guardadas} fotos já estão guardadas` : '1 foto já está guardada'} da tentativa
          anterior, e {guardadas > 1 ? 'vão' : 'vai'} junto.
        </p>
      )}

      {(fotos.length > 0 || preparando > 0) && (
        <ul className="grid grid-cols-3 gap-2">
          {fotos.map((foto, i) => (
            <li key={i} className="relative">
              <img
                src={foto}
                alt={`Foto ${guardadas + i + 1}`}
                className="aspect-square w-full rounded-xl border border-tinta-200 object-cover"
              />
              <button
                type="button"
                onClick={() => onFotos(fotos.filter((_, j) => j !== i))}
                aria-label={`Tirar a foto ${guardadas + i + 1}`}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white"
              >
                ×
              </button>
            </li>
          ))}
          {Array.from({ length: preparando }, (_, i) => (
            <li
              key={`p${i}`}
              className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-tinta-300 text-[12px] text-tinta-400"
            >
              Preparando…
            </li>
          ))}
        </ul>
      )}

      {cabem - preparando > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="btn btn-neutro h-12 cursor-pointer justify-center text-base">
            Tirar foto
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={aoEscolher} />
          </label>
          <label className="btn btn-neutro h-12 cursor-pointer justify-center text-base">
            Da galeria
            {/* Da galeria dá para marcar várias de uma vez. */}
            <input type="file" accept="image/*" multiple className="hidden" onChange={aoEscolher} />
          </label>
        </div>
      ) : (
        <p className="text-[13px] text-tinta-500">Chegou ao teto de {FOTOS_POR_FINALIZACAO} fotos.</p>
      )}

      <p className="text-[12px] text-tinta-400">
        {total} de {FOTOS_POR_FINALIZACAO} fotos
        {faltam > 0 && <span className="text-amber-700 dark:text-amber-300"> · faltam {faltam}</span>}
      </p>
      {erro && <p className="text-[12px] text-rose-600 dark:text-rose-300">{erro}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onVoltar} className="btn btn-sutil">
          Voltar
        </button>
        <button
          type="button"
          disabled={faltam > 0 || preparando > 0}
          onClick={onContinuar}
          className="btn btn-primario flex-1 justify-center py-3"
        >
          {preparando > 0 ? 'Preparando as fotos…' : total === 0 ? 'Continuar sem fotos' : 'Continuar'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conferir e finalizar
// ---------------------------------------------------------------------------

/** O resumo antes de mandar: o que vai ao IXC, e em que ordem. */
function Conferir({
  aberta,
  para,
  resposta,
  diagnostico,
  relato,
  inicio,
  fotos,
  guardadas,
  gps,
  onGpsDeNovo,
  enviando,
  erro,
  onVoltar,
  onFinalizar,
}: {
  aberta: OsAberta;
  para: ParaFinalizar;
  resposta: string | null;
  diagnostico: string | null;
  relato: string;
  inicio: string;
  fotos: string[];
  guardadas: number;
  gps: EstadoDoGps;
  onGpsDeNovo: () => void;
  enviando: boolean;
  erro: string | null;
  onVoltar: () => void;
  onFinalizar: () => void;
}) {
  const itens = aberta.itens;
  const aindaVao = itens.filter((i) => i.situacao === 'PENDENTE' || i.situacao === 'FALHOU').length;
  const travados = itens.filter((i) => i.situacao === 'CONFERIR' || i.situacao === 'GRAVANDO').length;
  const { aparelhosExigidos, produtosExigidos } = para.assunto;
  const totalDeFotos = guardadas + fotos.length;
  const esperandoGps =
    gps.estado === 'pegando' || (gps.estado === 'melhorando' && gps.precisao > PRECISAO_ACEITAVEL);

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="eyebrow mb-2">Relato</h2>
        <dl className="space-y-1 text-[13px]">
          {resposta && (
            <div className="flex gap-2">
              <dt className="text-tinta-400">Resposta</dt>
              <dd className="text-tinta-800">{resposta}</dd>
            </div>
          )}
          {diagnostico && (
            <div className="flex gap-2">
              <dt className="text-tinta-400">Diagnóstico</dt>
              <dd className="text-tinta-800">{diagnostico}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="text-tinta-400">Serviço</dt>
            <dd className="text-tinta-800">de {horaNaTela(inicio)} até agora</dd>
          </div>
        </dl>
        <p className="mt-2 whitespace-pre-line rounded-lg bg-realce px-3 py-2 text-[13px] text-tinta-700">
          {relato}
        </p>
      </section>

      <section className="card p-4">
        <h2 className="eyebrow mb-2">Fotos</h2>
        {totalDeFotos === 0 ? (
          <p className="text-[13px] text-tinta-500">Nenhuma foto.</p>
        ) : (
          <>
            {fotos.length > 0 && (
              <div className="mb-2 flex gap-1.5 overflow-x-auto">
                {fotos.map((foto, i) => (
                  <img
                    key={i}
                    src={foto}
                    alt={`Foto ${guardadas + i + 1}`}
                    className="h-16 w-16 shrink-0 rounded-lg border border-tinta-200 object-cover"
                  />
                ))}
              </div>
            )}
            <p className="text-[13px] text-tinta-600">
              {totalDeFotos > 1 ? `${totalDeFotos} fotos vão anexadas` : '1 foto vai anexada'} na OS do IXC, antes
              do fechamento
              {guardadas > 0 && ` (${guardadas} já guardada${guardadas > 1 ? 's' : ''} da tentativa anterior)`}.
            </p>
          </>
        )}
      </section>

      <section className="card p-4">
        <h2 className="eyebrow mb-2">Aparelhos e material</h2>
        {itens.length === 0 ? (
          <p className="text-[13px] text-tinta-500">Nada anotado nesta OS.</p>
        ) : (
          <ul className="space-y-2">
            {itens.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-1.5 text-[13px]">
                <Selo tom={TIPO_TOM[i.tipo]} pequeno>
                  {TIPO_LABEL[i.tipo]}
                </Selo>
                <span className="text-tinta-800">{i.descricao}</span>
                <span className="text-tinta-500">
                  {i.tipo === 'MATERIAL' ? quantidadeComUnidade(i.quantidade, i.unidade) : identificacaoDaPeca(i)}
                </span>
                {i.situacao !== 'GRAVADO' && (
                  <Selo tom={SITUACAO_TOM[i.situacao]} pequeno ponto>
                    {SITUACAO_LABEL[i.situacao]}
                  </Selo>
                )}
              </li>
            ))}
          </ul>
        )}
        {aindaVao > 0 && (
          <p className="mt-3 text-[12px] text-amber-700 dark:text-amber-300">
            {aindaVao} ite{aindaVao > 1 ? 'ns ainda não foram' : 'm ainda não foi'} ao IXC: vão antes de
            fechar a OS. Se o IXC recusar algum, a OS não fecha e a finalização fica esperando.
          </p>
        )}
        {travados > 0 && (
          <p className="mt-3 text-[12px] text-rose-600 dark:text-rose-300">
            {travados} ite{travados > 1 ? 'ns esperam' : 'm espera'} a base conferir no IXC. A finalização
            fica guardada e a base fecha a OS depois de conferir.
          </p>
        )}
        {(aparelhosExigidos > 0 || produtosExigidos > 0) && (
          <p className="mt-3 text-[12px] text-tinta-500">
            O assunto pede
            {aparelhosExigidos > 0 && ` ${aparelhosExigidos} aparelho(s) em comodato`}
            {aparelhosExigidos > 0 && produtosExigidos > 0 && ' e'}
            {produtosExigidos > 0 && ` ${produtosExigidos} produto(s)`} na OS.
          </p>
        )}
      </section>

      <Localizacao gps={gps} onDeNovo={onGpsDeNovo} />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="flex gap-2">
        <button type="button" onClick={onVoltar} disabled={enviando} className="btn btn-sutil">
          Voltar
        </button>
        <button
          type="button"
          onClick={onFinalizar}
          disabled={enviando || esperandoGps}
          className="btn btn-primario flex-1 justify-center py-3 text-base"
        >
          {enviando
            ? totalDeFotos > 0
              ? 'Mandando as fotos e finalizando…'
              : 'Finalizando no IXC…'
            : esperandoGps
              ? 'Esperando a localização…'
              : 'Finalizar no IXC'}
        </button>
      </div>
    </div>
  );
}

/** Onde o celular está, com quanto de precisão — e o que fazer quando é pouca. */
function Localizacao({ gps, onDeNovo }: { gps: EstadoDoGps; onDeNovo: () => void }) {
  const leitura = gps.estado === 'ok' || gps.estado === 'melhorando' ? gps : null;
  const fraca = gps.estado === 'ok' && gps.precisao > PRECISAO_ACEITAVEL;
  return (
    <section className="card p-4">
      <h2 className="eyebrow mb-1">Localização</h2>
      <p className="text-[13px] text-tinta-600">
        {gps.estado === 'pegando' && 'Procurando o GPS…'}
        {gps.estado === 'melhorando' && `Afinando a precisão: ± ${Math.round(gps.precisao)} m até agora…`}
        {gps.estado === 'ok' &&
          `Pronta, com precisão de ± ${Math.round(gps.precisao)} m. Vai junto com a finalização.`}
        {gps.estado === 'sem' && `${gps.motivo} A OS se finaliza sem ela.`}
        {leitura && (
          <>
            {' '}
            <a
              href={`https://www.google.com/maps?q=${leitura.latitude},${leitura.longitude}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Ver no mapa
            </a>
          </>
        )}
      </p>
      {leitura && leitura.precisao > PRECISAO_APROXIMADA && (
        <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
          O celular está dando só a localização aproximada. Nas permissões do navegador, ligue a
          “localização precisa” e toque em “Pegar de novo”.
        </p>
      )}
      {leitura && fraca && leitura.precisao <= PRECISAO_APROXIMADA && (
        <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
          Ainda imprecisa. Fora da casa, longe do telhado, o GPS pega melhor.
        </p>
      )}
      {(fraca || gps.estado === 'sem') && (
        <button type="button" onClick={onDeNovo} className="btn btn-sutil btn-p mt-2">
          Pegar de novo
        </button>
      )}
    </section>
  );
}

/** Depois de mandar: fechou, ou por que não. */
function Resultado({ osId, resultado }: { osId: number; resultado: ResultadoDaFinalizacao }) {
  const f = resultado.finalizacao;
  const fechou = f.situacao === 'GRAVADO';
  return (
    <div className="space-y-3">
      <Aviso tom={fechou ? (f.aviso ? 'atencao' : 'pago') : f.situacao === 'PENDENTE' ? 'atencao' : 'erro'}>
        <strong>{fechou ? 'OS finalizada no IXC.' : `${FINALIZACAO_LABEL[f.situacao]}.`}</strong>{' '}
        {f.erro ?? f.aviso ?? ''}
      </Aviso>
      {resultado.itens.gravados > 0 && (
        <p className="text-[13px] text-tinta-500">
          {resultado.itens.gravados} ite{resultado.itens.gravados > 1 ? 'ns foram' : 'm foi'} ao IXC antes do
          fechamento.
        </p>
      )}
      {f.fotos.total > 0 && (
        <p className="text-[13px] text-tinta-500">
          {f.fotos.enviadas === f.fotos.total
            ? `${f.fotos.total > 1 ? `As ${f.fotos.total} fotos estão` : 'A foto está'} na OS do IXC.`
            : `${f.fotos.enviadas} de ${f.fotos.total} fotos foram à OS do IXC; as outras ficam guardadas e vão no próximo envio.`}
        </p>
      )}
      <Link
        to={fechou ? '/campo/os' : `/campo/os/${osId}`}
        className="btn btn-primario w-full justify-center py-3"
      >
        {fechou ? 'Voltar às minhas OS' : 'Voltar à OS'}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A localização do celular
// ---------------------------------------------------------------------------

type EstadoDoGps =
  | { estado: 'pegando' }
  | { estado: 'melhorando' | 'ok'; latitude: number; longitude: number; precisao: number; em: string }
  | { estado: 'sem'; motivo: string };

/** Abaixo disto a leitura é boa: para de procurar. Em metros. */
const PRECISAO_BOA = 15;
/** Acima disto, o botão de finalizar espera o GPS afinar — até o tempo acabar. */
const PRECISAO_ACEITAVEL = 50;
/** Acima disto, não é GPS: é a "localização aproximada" do celular. */
const PRECISAO_APROXIMADA = 500;
/** Quanto tempo se procura uma leitura melhor. */
const PROCURA_MS = 60_000;

/**
 * A localização, acompanhada — e não a primeira que o celular dá.
 *
 * A primeira resposta quase sempre vem da antena ou do Wi-Fi, com centenas de
 * metros de erro, e o `getCurrentPosition` parava nela; o `maximumAge` de um
 * minuto ainda aceitava uma leitura velha, de outro lugar. Agora se ouve o GPS
 * (`watchPosition`, sem leitura guardada) e fica a mais precisa, até chegar a
 * 15 m ou passar um minuto. Sem permissão, segue sem ela.
 *
 * Devolve também o "pegar de novo", para quando a melhor ainda foi ruim.
 */
function useGps(ativo: boolean): [EstadoDoGps, () => void] {
  const [gps, setGps] = useState<EstadoDoGps>({ estado: 'pegando' });
  const [vez, setVez] = useState(0);
  useEffect(() => {
    if (!ativo) return;
    if (!('geolocation' in navigator)) {
      setGps({ estado: 'sem', motivo: 'Este navegador não dá a localização.' });
      return;
    }
    setGps({ estado: 'pegando' });
    let melhor: GeolocationPosition | null = null;
    let acabou = false;
    // O vigia e o prazo são criados logo abaixo; quem chama isto são as
    // respostas do GPS e a limpeza do efeito, que só vêm depois.
    const parar = () => {
      acabou = true;
      navigator.geolocation.clearWatch(vigia);
      clearTimeout(prazo);
    };
    const leitura = (p: GeolocationPosition, estado: 'melhorando' | 'ok'): EstadoDoGps => ({
      estado,
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      precisao: p.coords.accuracy,
      em: new Date(p.timestamp).toISOString(),
    });

    const vigia = navigator.geolocation.watchPosition(
      (p) => {
        if (acabou || (melhor && p.coords.accuracy >= melhor.coords.accuracy)) return;
        melhor = p;
        if (p.coords.accuracy <= PRECISAO_BOA) {
          parar();
          setGps(leitura(p, 'ok'));
        } else {
          setGps(leitura(p, 'melhorando'));
        }
      },
      (e) => {
        // Sem sinal de satélite por um tempo o vigia continua tentando; só a
        // permissão negada encerra.
        if (acabou || e.code !== e.PERMISSION_DENIED) return;
        parar();
        setGps({ estado: 'sem', motivo: 'O celular não deu permissão para a localização.' });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: PROCURA_MS },
    );
    const prazo = setTimeout(() => {
      if (acabou) return;
      parar();
      setGps(melhor ? leitura(melhor, 'ok') : { estado: 'sem', motivo: 'O GPS não respondeu.' });
    }, PROCURA_MS);
    return parar;
  }, [ativo, vez]);
  return [gps, () => setVez((v) => v + 1)];
}

// ---------------------------------------------------------------------------
// Miudezas
// ---------------------------------------------------------------------------

/** "AAAA-MM-DDTHH:mm" no fuso do celular — o que o campo espera. */
function paraCampoDeHora(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** O valor do campo de hora, como se lê: "22/10 08:30". */
function horaNaTela(campo: string): string {
  const d = new Date(campo);
  if (Number.isNaN(d.getTime())) return campo;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
