import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Aviso, Carregando, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import {
  FINALIZACAO_LABEL,
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
 * 2. **Conferir e finalizar** — o resumo, com o que ainda não foi ao IXC (vai
 *    antes do fechamento), e a localização do celular.
 *
 * O que cada OS pede vem do assunto no IXC: o diagnóstico obrigatório, o
 * aparelho ou o produto exigido. O assunto que exige foto ou equipe ainda se
 * finaliza pelo IXC, e a tela diz isso antes de o técnico preencher nada.
 */
export function CampoFinalizar() {
  const { osId } = useParams<{ osId: string }>();
  const id = Number(osId);
  const qc = useQueryClient();
  const [passo, setPasso] = useState<'relato' | 'conferir'>('relato');
  const [respostaId, setRespostaId] = useState<number | null>(null);
  const [diagnosticoId, setDiagnosticoId] = useState<number | null>(null);
  const [relato, setRelato] = useState('');
  const [inicio, setInicio] = useState('');
  const [resultado, setResultado] = useState<ResultadoDaFinalizacao | null>(null);
  const preenchido = useRef(false);
  const gps = useGps(passo === 'conferir' && !resultado);

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
            gps.estado === 'ok'
              ? { latitude: gps.latitude, longitude: gps.longitude, precisao: gps.precisao, em: gps.em }
              : undefined,
        })
      ).data,
    onSuccess: setResultado,
    onSettled: () => void qc.invalidateQueries({ queryKey: ['minhas-os'] }),
  });

  if (!(id > 0)) return null;
  const os = aberta.data?.os;
  const d = dados.data;
  const respostas = d?.respostas ?? [];

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
              { qual: 'conferir', rotulo: '2 · Conferir e finalizar' },
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
                onClick={() => setPasso('conferir')}
                className="btn btn-primario w-full justify-center py-3"
              >
                Continuar
              </button>
            </div>
          ) : (
            <Conferir
              aberta={aberta.data}
              para={d}
              resposta={respostas.find((r) => r.id === respostaId)?.nome ?? null}
              diagnostico={d.diagnosticos.find((x) => x.id === diagnosticoId)?.nome ?? null}
              relato={relato}
              inicio={inicio}
              gps={gps}
              enviando={finalizar.isPending}
              erro={finalizar.error ? mensagemErro(finalizar.error) : null}
              onVoltar={() => {
                finalizar.reset();
                setPasso('relato');
              }}
              onFinalizar={() => finalizar.mutate()}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

/** O resumo antes de mandar: o que vai ao IXC, e em que ordem. */
function Conferir({
  aberta,
  para,
  resposta,
  diagnostico,
  relato,
  inicio,
  gps,
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
  gps: EstadoDoGps;
  enviando: boolean;
  erro: string | null;
  onVoltar: () => void;
  onFinalizar: () => void;
}) {
  const itens = aberta.itens;
  const aindaVao = itens.filter((i) => i.situacao === 'PENDENTE' || i.situacao === 'FALHOU').length;
  const travados = itens.filter((i) => i.situacao === 'CONFERIR' || i.situacao === 'GRAVANDO').length;
  const { aparelhosExigidos, produtosExigidos } = para.assunto;

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

      <section className="card p-4">
        <h2 className="eyebrow mb-1">Localização</h2>
        <p className="text-[13px] text-tinta-600">
          {gps.estado === 'pegando' && 'Pegando a localização do celular…'}
          {gps.estado === 'ok' && `Pronta (precisão de ${Math.round(gps.precisao)} m). Vai junto com a finalização.`}
          {gps.estado === 'sem' && `${gps.motivo} A OS se finaliza sem ela.`}
        </p>
      </section>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="flex gap-2">
        <button type="button" onClick={onVoltar} disabled={enviando} className="btn btn-sutil">
          Voltar
        </button>
        <button
          type="button"
          onClick={onFinalizar}
          disabled={enviando || gps.estado === 'pegando'}
          className="btn btn-primario flex-1 justify-center py-3 text-base"
        >
          {enviando
            ? 'Finalizando no IXC…'
            : gps.estado === 'pegando'
              ? 'Esperando a localização…'
              : 'Finalizar no IXC'}
        </button>
      </div>
    </div>
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
  | { estado: 'ok'; latitude: number; longitude: number; precisao: number; em: string }
  | { estado: 'sem'; motivo: string };

/**
 * A localização, pedida quando o passo de conferir abre — e não no toque de
 * finalizar, para o técnico não esperar o GPS com o dedo no botão. Sem
 * permissão ou sem resposta em 15 segundos, segue sem ela.
 */
function useGps(ativo: boolean): EstadoDoGps {
  const [gps, setGps] = useState<EstadoDoGps>({ estado: 'pegando' });
  useEffect(() => {
    if (!ativo) return;
    if (!('geolocation' in navigator)) {
      setGps({ estado: 'sem', motivo: 'Este navegador não dá a localização.' });
      return;
    }
    let vivo = true;
    setGps({ estado: 'pegando' });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!vivo) return;
        setGps({
          estado: 'ok',
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          precisao: p.coords.accuracy,
          em: new Date(p.timestamp).toISOString(),
        });
      },
      (e) => {
        if (!vivo) return;
        setGps({
          estado: 'sem',
          motivo:
            e.code === e.PERMISSION_DENIED
              ? 'O celular não deu permissão para a localização.'
              : 'O GPS não respondeu.',
        });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
    return () => {
      vivo = false;
    };
  }, [ativo]);
  return gps;
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
