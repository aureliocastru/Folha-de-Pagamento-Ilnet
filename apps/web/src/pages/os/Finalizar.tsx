import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AssinaturaCanvas, type AssinaturaCanvasRef } from '../../components/AssinaturaCanvas';
import { Aviso, Carregando, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { reduzirFoto } from '../../lib/foto';
import {
  FINALIZACAO_LABEL,
  SITUACAO_LABEL,
  SITUACAO_TOM,
  TIPO_LABEL,
  TIPO_TOM,
  ehAssinatura,
  identificacaoDaPeca,
  quantidadeComUnidade,
  quemAssinou,
  type ArquivoDaOs,
  type OsAberta,
  type ParaFinalizar,
  type ResultadoDaFinalizacao,
} from '../../lib/os';

/**
 * Finalizar a OS pelo celular: um passo a passo curto, inspirado no
 * "finalizar wizard" do IXC.
 *
 * 1. **Relato** — o relatório do que foi feito e, se o técnico quiser, a hora
 *    em que o serviço começou (sem ela, vale a da primeira anotação na OS).
 *    Resposta padrão e diagnóstico não se perguntam aqui.
 * 2. **Fotos** — tiradas na hora ou escolhidas da galeria, quantas o técnico
 *    quiser, cada uma com a sua descrição. Vão direto para a aba "Arquivos" da
 *    OS no IXC, uma por vez, no toque de anexar; nada fica guardado aqui.
 * 3. **Assinatura do cliente** — no quadro, em tela cheia, com o nome de quem
 *    assina. Vai direto para os arquivos da OS no IXC, como a do app do IXC.
 *    No assunto que não a exige, o técnico pode dizer por que não houve.
 * 4. **Conferir e finalizar** — o resumo, com o que ainda não foi ao IXC (vai
 *    antes do fechamento), e a localização do celular.
 *
 * O que cada OS pede vem do assunto no IXC: o aparelho ou o produto exigido,
 * quantas fotos, a assinatura. O assunto que exige equipe ou diagnóstico se
 * finaliza pelo IXC, e a tela diz isso antes de o técnico preencher nada.
 */
export function CampoFinalizar() {
  const { osId } = useParams<{ osId: string }>();
  const id = Number(osId);
  const qc = useQueryClient();
  const [passo, setPasso] = useState<'relato' | 'fotos' | 'assinatura' | 'conferir'>('relato');
  const [relato, setRelato] = useState('');
  const [inicio, setInicio] = useState('');
  const [fotos, setFotos] = useState<FotoParaAnexar[]>([]);
  const [assinadaPor, setAssinadaPor] = useState<string | null>(null);
  const [semAssinatura, setSemAssinatura] = useState<string | null>(null);
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
  const podeFinalizar = !!dados.data && !dados.data.recusa;
  /** A aba "Arquivos" da OS no IXC: as fotos anexadas, e o que já estava lá. */
  const arquivos = useQuery({
    queryKey: ['minhas-os', id, 'arquivos'],
    queryFn: async () => (await api.get<ArquivoDaOs[]>(`/minhas-os/${id}/arquivos`)).data,
    enabled: id > 0 && podeFinalizar,
    retry: 0,
  });
  // Desde que a tela abre, e não só no último passo: o GPS leva tempo para
  // achar os satélites, e enquanto o técnico escreve o relato ele vai afinando.
  const [gps, gpsDeNovo] = useGps(podeFinalizar && !resultado);

  // Uma vez só, quando chega: a finalização que voltou (recusada, esperando um
  // item) volta como estava; a nova começa em branco.
  useEffect(() => {
    const antes = dados.data?.finalizacao;
    if (!dados.data || preenchido.current) return;
    preenchido.current = true;
    if (!antes) return;
    setRelato(antes.relato);
    setInicio(paraCampoDeHora(antes.inicio));
    setAssinadaPor(antes.assinadaPor);
    setSemAssinatura(antes.semAssinatura);
  }, [dados.data]);

  const finalizar = useMutation({
    mutationFn: async () =>
      (
        await api.post<ResultadoDaFinalizacao>(`/minhas-os/${id}/finalizar`, {
          relato,
          inicio: inicio ? new Date(inicio).toISOString() : undefined,
          gps:
            gps.estado === 'ok' || gps.estado === 'melhorando'
              ? { latitude: gps.latitude, longitude: gps.longitude, precisao: gps.precisao, em: gps.em }
              : undefined,
          assinadaPor: assinadaPor ?? undefined,
          semAssinatura: assinadaPor ? undefined : (semAssinatura ?? undefined),
        })
      ).data,
    onSuccess: setResultado,
    onSettled: () => void qc.invalidateQueries({ queryKey: ['minhas-os'] }),
  });

  if (!(id > 0)) return null;
  const os = aberta.data?.os;
  const d = dados.data;
  // A hora do começo é opcional; dita, tem de ser uma hora de verdade.
  const inicioValido = !inicio || !Number.isNaN(new Date(inicio).getTime());
  const podeContinuar = relato.trim().length >= 5 && inicioValido;

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
          <ol className="grid grid-cols-4 gap-1.5 text-[12px] font-medium leading-tight">
            {[
              { qual: 'relato', rotulo: 'Relato' },
              { qual: 'fotos', rotulo: 'Fotos' },
              { qual: 'assinatura', rotulo: 'Assinatura' },
              { qual: 'conferir', rotulo: 'Conferir' },
            ].map((p, i) => (
              <li
                key={p.qual}
                className={`rounded-lg px-2 py-1.5 text-center ${
                  passo === p.qual
                    ? 'bg-brand-500/10 text-brand-800 dark:text-brand-200'
                    : 'bg-tinta-100 text-tinta-500'
                }`}
              >
                <span className="block text-[10px] opacity-70">{i + 1}</span>
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
                <label className="rotulo" htmlFor="fin-relato">
                  Relatório
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
                  O serviço começou em (opcional)
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
                <p className="mt-1 text-[12px] text-tinta-400">
                  Em branco, vale a hora da primeira anotação nesta OS — ou a de agora.
                </p>
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
              osId={id}
              fotos={fotos}
              onFotos={setFotos}
              arquivos={arquivos}
              exigidas={d.assunto.fotosExigidas}
              onVoltar={() => setPasso('relato')}
              onContinuar={() => setPasso('assinatura')}
            />
          ) : passo === 'assinatura' ? (
            <PassoDaAssinatura
              osId={id}
              cliente={os?.cliente ?? null}
              arquivos={arquivos}
              obrigatoria={d.assunto.assinaturaObrigatoria}
              assinadaPor={assinadaPor}
              semAssinatura={semAssinatura}
              onAssinada={(nome) => {
                setAssinadaPor(nome);
                setSemAssinatura(null);
              }}
              onSemAssinatura={(motivo) => {
                setSemAssinatura(motivo);
                if (motivo) setAssinadaPor(null);
              }}
              onVoltar={() => setPasso('fotos')}
              onContinuar={() => setPasso('conferir')}
            />
          ) : (
            <Conferir
              aberta={aberta.data}
              para={d}
              relato={relato}
              inicio={inicio}
              arquivos={arquivos.data}
              assinadaPor={assinadaPor}
              semAssinatura={semAssinatura}
              gps={gps}
              onGpsDeNovo={gpsDeNovo}
              enviando={finalizar.isPending}
              erro={finalizar.error ? mensagemErro(finalizar.error) : null}
              onVoltar={() => {
                finalizar.reset();
                setPasso('assinatura');
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
 * A foto da OS não precisa ser lida a caneta como a da nota: 1920px dão para
 * ler o medidor e a etiqueta, e abaixo de 900 KB ela sobe pelo sinal da casa
 * do cliente.
 */
const FOTO_DA_OS = { ladoMaior: 1920, teto: 900 * 1024 };

/** Uma foto escolhida e ainda não anexada: a imagem e o que o técnico escreveu dela. */
interface FotoParaAnexar {
  chave: number;
  foto: string;
  descricao: string;
  erro: string | null;
}

/**
 * Tirar na hora ou escolher da galeria, escrever o que cada foto mostra, e
 * anexar. Cada uma vai num pedido só dela, direto para a aba "Arquivos" da OS
 * no IXC — a que foi sai da lista daqui e aparece na de lá; a que falhou fica,
 * com o motivo, para tentar de novo.
 */
function PassoDasFotos({
  osId,
  fotos,
  onFotos,
  arquivos,
  exigidas,
  onVoltar,
  onContinuar,
}: {
  osId: number;
  fotos: FotoParaAnexar[];
  onFotos: (fotos: FotoParaAnexar[]) => void;
  arquivos: UseQueryResult<ArquivoDaOs[]>;
  exigidas: number;
  onVoltar: () => void;
  onContinuar: () => void;
}) {
  const qc = useQueryClient();
  const [preparando, setPreparando] = useState(0);
  const [anexando, setAnexando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const proxima = useRef(1);
  // A lista de agora: cada foto chega depois de uma espera, e outra pode ter
  // entrado, saído ou ganhado descrição enquanto isso.
  const atual = useRef({ fotos, onFotos });
  atual.current = { fotos, onFotos };

  const naOs = arquivos.data ?? [];
  // Sem a lista do IXC não dá para contar: quem decide é a API, ao finalizar.
  // A assinatura fica na mesma aba, mas não é foto.
  const faltam = arquivos.data ? Math.max(0, exigidas - naOs.filter((a) => !ehAssinatura(a)).length) : 0;
  const ocupado = anexando !== null;

  /** Muda uma foto da lista (ou a tira, com null). */
  function mudar(chave: number, mudanca: Partial<FotoParaAnexar> | null) {
    const { fotos: agora, onFotos: avisar } = atual.current;
    avisar(
      mudanca === null
        ? agora.filter((f) => f.chave !== chave)
        : agora.map((f) => (f.chave === chave ? { ...f, ...mudanca } : f)),
    );
  }

  async function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const escolhidos = [...(e.target.files ?? [])];
    // Limpo sempre: sem isso, escolher a mesma foto de novo não dispara nada.
    e.target.value = '';
    if (escolhidos.length === 0) return;
    setErro(null);
    setPreparando((n) => n + escolhidos.length);
    // Uma de cada vez: várias fotos da câmera abertas juntas derrubam o
    // navegador de um celular mais simples.
    for (const arquivo of escolhidos) {
      try {
        const foto = await reduzirFoto(arquivo, FOTO_DA_OS);
        const { fotos: agora, onFotos: avisar } = atual.current;
        if (!agora.some((f) => f.foto === foto)) {
          avisar([...agora, { chave: proxima.current++, foto, descricao: '', erro: null }]);
        }
      } catch (err) {
        setErro(err instanceof Error ? err.message : String(err));
      } finally {
        setPreparando((n) => n - 1);
      }
    }
  }

  /** Na ordem, uma por vez. A primeira que falha para a fila — sem sinal, as outras falhariam igual. */
  async function anexar() {
    setErro(null);
    for (const f of atual.current.fotos) {
      setAnexando(f.chave);
      try {
        const { data } = await api.post<ArquivoDaOs>(`/minhas-os/${osId}/fotos`, {
          foto: f.foto,
          descricao: f.descricao.trim() || undefined,
        });
        qc.setQueryData<ArquivoDaOs[]>(['minhas-os', osId, 'arquivos'], (lista) => [...(lista ?? []), data]);
        mudar(f.chave, null);
      } catch (err) {
        mudar(f.chave, { erro: mensagemErro(err) });
        break;
      }
    }
    setAnexando(null);
    // Relida do IXC: é a lista de lá que conta para o assunto.
    void qc.invalidateQueries({ queryKey: ['minhas-os', osId, 'arquivos'] });
  }

  return (
    <div className="card space-y-4 p-4">
      <h2 className="text-[15px] font-semibold text-tinta-800">Fotos do serviço</h2>

      {(fotos.length > 0 || preparando > 0) && (
        <ul className="space-y-2">
          {fotos.map((f, i) => (
            <li key={f.chave} className="flex gap-3 rounded-xl border border-tinta-200 p-2">
              <img
                src={f.foto}
                alt={f.descricao || `Foto ${i + 1}`}
                className="h-20 w-20 shrink-0 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                <label className="text-[12px] font-medium text-tinta-500" htmlFor={`foto-${f.chave}`}>
                  O que a foto mostra
                </label>
                <input
                  id={`foto-${f.chave}`}
                  value={f.descricao}
                  onChange={(e) => mudar(f.chave, { descricao: e.target.value.slice(0, 100), erro: null })}
                  disabled={ocupado}
                  placeholder="Ex.: sinal na ONU, caixa CTO"
                  className="campo mt-0.5"
                />
                {anexando === f.chave && <p className="mt-1 text-[12px] text-tinta-500">Anexando na OS…</p>}
                {f.erro && <p className="mt-1 text-[12px] text-rose-600 dark:text-rose-300">{f.erro}</p>}
              </div>
              <button
                type="button"
                onClick={() => mudar(f.chave, null)}
                disabled={ocupado}
                aria-label={`Tirar a foto ${i + 1}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tinta-100 text-lg leading-none text-tinta-600"
              >
                ×
              </button>
            </li>
          ))}
          {Array.from({ length: preparando }, (_, i) => (
            <li
              key={`p${i}`}
              className="flex h-24 items-center justify-center rounded-xl border border-dashed border-tinta-300 text-[12px] text-tinta-400"
            >
              Preparando a foto…
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className={`btn btn-neutro h-12 justify-center text-base ${ocupado ? 'opacity-50' : 'cursor-pointer'}`}>
          Tirar foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={aoEscolher}
            disabled={ocupado}
          />
        </label>
        <label className={`btn btn-neutro h-12 justify-center text-base ${ocupado ? 'opacity-50' : 'cursor-pointer'}`}>
          Da galeria
          {/* Da galeria dá para marcar várias de uma vez. */}
          <input type="file" accept="image/*" multiple className="hidden" onChange={aoEscolher} disabled={ocupado} />
        </label>
      </div>

      {fotos.length > 0 && (
        <button
          type="button"
          onClick={() => void anexar()}
          disabled={ocupado || preparando > 0}
          className="btn btn-primario w-full justify-center py-3"
        >
          {ocupado
            ? 'Anexando na OS…'
            : `Anexar ${fotos.length > 1 ? `as ${fotos.length} fotos` : 'a foto'} na OS do IXC`}
        </button>
      )}
      {erro && <p className="text-[12px] text-rose-600 dark:text-rose-300">{erro}</p>}

      <section>
        <h3 className="eyebrow mb-1">Nos arquivos da OS no IXC</h3>
        {arquivos.isLoading ? (
          <p className="text-[13px] text-tinta-500">Lendo os arquivos da OS…</p>
        ) : arquivos.isError ? (
          <p className="text-[13px] text-rose-600 dark:text-rose-300">
            Não consegui ler os arquivos da OS: {mensagemErro(arquivos.error)}
          </p>
        ) : naOs.length === 0 ? (
          <p className="text-[13px] text-tinta-500">Nenhum arquivo ainda.</p>
        ) : (
          <ul className="space-y-1 text-[13px] text-tinta-700">
            {naOs.map((a) => (
              <li key={a.id} className="flex gap-1.5">
                <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                <span className="min-w-0 break-words">{a.descricao}</span>
              </li>
            ))}
          </ul>
        )}
        {faltam > 0 && (
          <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
            Falta{faltam > 1 ? 'm' : ''} {faltam} para o que o assunto pede.
          </p>
        )}
      </section>

      {fotos.length > 0 && !ocupado && (
        <p className="text-[12px] text-tinta-500">
          Anexe as fotos acima, ou tire as que não quer, para seguir.
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onVoltar} disabled={ocupado} className="btn btn-sutil">
          Voltar
        </button>
        <button
          type="button"
          disabled={fotos.length > 0 || preparando > 0 || ocupado || faltam > 0}
          onClick={onContinuar}
          className="btn btn-primario flex-1 justify-center py-3"
        >
          {naOs.length === 0 && fotos.length === 0 && exigidas === 0 ? 'Continuar sem fotos' : 'Continuar'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A assinatura do cliente
// ---------------------------------------------------------------------------

/** Os motivos de sempre para o cliente não assinar; "Outro" abre o campo. */
const MOTIVOS_SEM_ASSINATURA = ['Não estava em casa', 'Não quis assinar'];

/**
 * O cliente assina no quadro — o mesmo da APR, com a tela cheia para quem
 * precisa de espaço — e a assinatura vai direto para os arquivos da OS no IXC,
 * com o nome, a hora e a OS carimbados embaixo. Nada fica guardado aqui.
 *
 * A que já está na OS (colhida antes, ou pelo app do IXC) vale: o técnico só
 * confirma. No assunto que não exige assinatura, ele pode dizer por que não
 * houve, e o motivo vai na mensagem do fechamento.
 */
function PassoDaAssinatura({
  osId,
  cliente,
  arquivos,
  obrigatoria,
  assinadaPor,
  semAssinatura,
  onAssinada,
  onSemAssinatura,
  onVoltar,
  onContinuar,
}: {
  osId: number;
  cliente: string | null;
  arquivos: UseQueryResult<ArquivoDaOs[]>;
  obrigatoria: boolean;
  assinadaPor: string | null;
  semAssinatura: string | null;
  /** Null quando a assinatura da OS não diz de quem é (a do app do IXC). */
  onAssinada: (nome: string | null) => void;
  onSemAssinatura: (motivo: string | null) => void;
  onVoltar: () => void;
  onContinuar: () => void;
}) {
  const qc = useQueryClient();
  const controle = useRef<AssinaturaCanvasRef>(null);
  const [nome, setNome] = useState(assinadaPor ?? cliente ?? '');
  const [temTraco, setTemTraco] = useState(false);
  const [colherDeNovo, setColherDeNovo] = useState(false);
  const [modo, setModo] = useState<'assinar' | 'sem'>(semAssinatura && !obrigatoria ? 'sem' : 'assinar');
  const motivoConhecido = !semAssinatura || MOTIVOS_SEM_ASSINATURA.includes(semAssinatura);
  const [escolha, setEscolha] = useState(motivoConhecido ? (semAssinatura ?? '') : 'outro');
  const [outro, setOutro] = useState(motivoConhecido ? '' : (semAssinatura ?? ''));

  const naOs = (arquivos.data ?? []).filter(ehAssinatura);
  const ultima = naOs[naOs.length - 1] ?? null;
  const assinada = !!ultima && !colherDeNovo;
  const quem = assinadaPor ?? (ultima ? quemAssinou(ultima) : null);
  const motivo = (escolha === 'outro' ? outro : escolha).trim();

  const anexar = useMutation({
    mutationFn: async () => {
      const png = controle.current?.exportar();
      if (!png) throw new Error('O cliente ainda não assinou no quadro.');
      const quemAssina = nome.trim();
      const carimbada = await carimbarAssinatura(png, [quemAssina, `${agoraNaTela()} · OS ${osId}`]);
      return (
        await api.post<ArquivoDaOs>(`/minhas-os/${osId}/assinatura`, { assinatura: carimbada, nome: quemAssina })
      ).data;
    },
    onSuccess: (arquivo) => {
      qc.setQueryData<ArquivoDaOs[]>(['minhas-os', osId, 'arquivos'], (lista) => [...(lista ?? []), arquivo]);
      // Relida do IXC: é a lista de lá que a API confere ao finalizar.
      void qc.invalidateQueries({ queryKey: ['minhas-os', osId, 'arquivos'] });
      onAssinada(nome.trim());
      setColherDeNovo(false);
    },
  });

  const podeSeguir = assinada || (!obrigatoria && modo === 'sem' && motivo.length >= 3);

  function continuar() {
    if (assinada) onAssinada(quem);
    else onSemAssinatura(motivo);
    onContinuar();
  }

  return (
    <div className="card space-y-4 p-4">
      <div>
        <h2 className="text-[15px] font-semibold text-tinta-800">Assinatura do cliente</h2>
        <p className="mt-0.5 text-[13px] text-tinta-500">
          {obrigatoria
            ? 'O assunto exige a assinatura do cliente para finalizar.'
            : 'Peça para o cliente assinar. Se não der, diga por quê.'}{' '}
          Ela vai direto para os arquivos da OS no IXC.
        </p>
      </div>

      {arquivos.isError && (
        <p className="text-[13px] text-rose-600 dark:text-rose-300">
          Não consegui ler os arquivos da OS: {mensagemErro(arquivos.error)}
        </p>
      )}

      {assinada ? (
        <div className="space-y-2 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          <p>
            ✓ Assinada{quem ? ` por ${quem}` : ''} — está nos arquivos da OS no IXC.
          </p>
          <button
            type="button"
            onClick={() => {
              setColherDeNovo(true);
              setModo('assinar');
            }}
            className="btn btn-sutil btn-p"
          >
            Colher de novo
          </button>
        </div>
      ) : modo === 'assinar' ? (
        <div className="space-y-3">
          <div>
            <label className="rotulo" htmlFor="assinatura-nome">
              Nome de quem assina
            </label>
            <input
              id="assinatura-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value.slice(0, 80))}
              disabled={anexar.isPending}
              placeholder="Nem sempre é o titular"
              className="campo"
            />
          </div>
          <AssinaturaCanvas
            controle={controle}
            onMudou={setTemTraco}
            disabled={anexar.isPending}
            titulo={nome.trim() || 'Assinatura do cliente'}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => controle.current?.limpar()}
              disabled={!temTraco || anexar.isPending}
              className="btn btn-sutil"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => anexar.mutate()}
              disabled={!temTraco || nome.trim().length < 3 || anexar.isPending}
              className="btn btn-primario flex-1 justify-center py-3"
            >
              {anexar.isPending ? 'Anexando na OS…' : 'Anexar a assinatura na OS'}
            </button>
          </div>
          {nome.trim().length < 3 && temTraco && (
            <p className="text-[12px] text-amber-700 dark:text-amber-300">Escreva o nome de quem assinou.</p>
          )}
          {anexar.error && (
            <p className="text-[12px] text-rose-600 dark:text-rose-300">{mensagemErro(anexar.error)}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {colherDeNovo && (
              <button
                type="button"
                onClick={() => setColherDeNovo(false)}
                className="text-[13px] font-medium text-tinta-500 underline"
              >
                Manter a que já está na OS
              </button>
            )}
            {!obrigatoria && (
              <button
                type="button"
                onClick={() => setModo('sem')}
                className="text-[13px] font-medium text-tinta-500 underline"
              >
                O cliente não vai assinar
              </button>
            )}
          </div>
        </div>
      ) : (
        <fieldset className="space-y-2">
          <legend className="rotulo">Por que o cliente não assinou</legend>
          {[...MOTIVOS_SEM_ASSINATURA, 'outro'].map((m) => (
            <label key={m} className="flex items-center gap-2 text-[14px] text-tinta-700">
              <input
                type="radio"
                name="sem-assinatura"
                checked={escolha === m}
                onChange={() => setEscolha(m)}
              />
              {m === 'outro' ? 'Outro motivo' : m}
            </label>
          ))}
          {escolha === 'outro' && (
            <input
              value={outro}
              onChange={(e) => setOutro(e.target.value.slice(0, 300))}
              placeholder="Diga o motivo"
              className="campo"
              aria-label="Outro motivo"
            />
          )}
          <button
            type="button"
            onClick={() => setModo('assinar')}
            className="text-[13px] font-medium text-tinta-500 underline"
          >
            Voltar a assinar
          </button>
        </fieldset>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onVoltar} disabled={anexar.isPending} className="btn btn-sutil">
          Voltar
        </button>
        <button
          type="button"
          disabled={!podeSeguir || anexar.isPending}
          onClick={continuar}
          className="btn btn-primario flex-1 justify-center py-3"
        >
          {podeSeguir ? 'Continuar' : obrigatoria ? 'Falta a assinatura' : 'Assine ou diga por quê'}
        </button>
      </div>
    </div>
  );
}

/**
 * A assinatura com o nome, a hora e a OS embaixo, em fundo branco: quem abre o
 * arquivo no IXC vê de quem é e quando, sem depender da descrição.
 */
function carimbarAssinatura(png: string, linhas: string[]): Promise<string> {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onerror = () => erro(new Error('Não consegui preparar a assinatura. Tente de novo.'));
    img.onload = () => {
      const escala = Math.min(1, 1200 / img.width);
      const largura = Math.round(img.width * escala);
      const altura = Math.round(img.height * escala);
      const fonte = Math.max(16, Math.round(largura / 34));
      const rodape = Math.round(fonte * (1.5 * linhas.length + 1));
      const canvas = document.createElement('canvas');
      canvas.width = largura;
      canvas.height = altura + rodape;
      const ctx = canvas.getContext('2d');
      if (!ctx) return ok(png);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, largura, altura);
      // A linha da assinatura, e o carimbo embaixo dela.
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = Math.max(1, fonte / 14);
      ctx.beginPath();
      ctx.moveTo(largura * 0.08, altura);
      ctx.lineTo(largura * 0.92, altura);
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.font = `${fonte}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      linhas.forEach((linha, i) => ctx.fillText(linha, largura / 2, altura + fonte * (0.6 + 1.5 * i), largura * 0.92));
      ok(canvas.toDataURL('image/png'));
    };
    img.src = png;
  });
}

/** "23/10/2026 14:32", no fuso do celular. */
function agoraNaTela(): string {
  return new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Conferir e finalizar
// ---------------------------------------------------------------------------

/** O resumo antes de mandar: o que vai ao IXC, e em que ordem. */
function Conferir({
  aberta,
  para,
  relato,
  inicio,
  arquivos,
  assinadaPor,
  semAssinatura,
  gps,
  onGpsDeNovo,
  enviando,
  erro,
  onVoltar,
  onFinalizar,
}: {
  aberta: OsAberta;
  para: ParaFinalizar;
  relato: string;
  inicio: string;
  /** A aba "Arquivos" da OS no IXC; indefinida quando não deu para ler. */
  arquivos: ArquivoDaOs[] | undefined;
  assinadaPor: string | null;
  semAssinatura: string | null;
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
  const esperandoGps =
    gps.estado === 'pegando' || (gps.estado === 'melhorando' && gps.precisao > PRECISAO_ACEITAVEL);

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="eyebrow mb-2">Relatório</h2>
        {inicio && (
          <p className="mb-2 text-[13px] text-tinta-600">Serviço de {horaNaTela(inicio)} até agora</p>
        )}
        <p className="whitespace-pre-line rounded-lg bg-realce px-3 py-2 text-[13px] text-tinta-700">
          {relato}
        </p>
      </section>

      <section className="card p-4">
        <h2 className="eyebrow mb-1">Assinatura do cliente</h2>
        <p className="text-[13px] text-tinta-700">
          {arquivos?.some(ehAssinatura)
            ? `Assinada${assinadaPor ? ` por ${assinadaPor}` : ''} — está nos arquivos da OS.`
            : semAssinatura
              ? `O cliente não assinou: ${semAssinatura}. Vai assim na mensagem do fechamento.`
              : 'Sem assinatura.'}
        </p>
      </section>

      <section className="card p-4">
        <h2 className="eyebrow mb-2">Arquivos da OS no IXC</h2>
        {!arquivos ? (
          <p className="text-[13px] text-tinta-500">Não deu para ler os arquivos da OS no IXC.</p>
        ) : arquivos.length === 0 ? (
          <p className="text-[13px] text-tinta-500">Nenhum arquivo na OS.</p>
        ) : (
          <ul className="space-y-1 text-[13px] text-tinta-700">
            {arquivos.map((a) => (
              <li key={a.id} className="flex gap-1.5">
                <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                <span className="min-w-0 break-words">{a.descricao}</span>
              </li>
            ))}
          </ul>
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
            ? 'Finalizando no IXC…'
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
