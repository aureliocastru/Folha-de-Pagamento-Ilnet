import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Aviso, Carregando, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import {
  AUTORIZACAO_ONU_LABEL,
  AUTORIZACAO_ONU_TOM,
  dataHoraDoIxc,
  type AutorizacaoDeOnu,
  type CaixaDaFibra,
  type OnuDaOs,
  type OnuDoIxc,
  type OnuPendente,
  type PortaDaCaixa,
  type PreparoDaOnu,
  type SinalDaOnu,
} from '../../lib/os';

/**
 * Autorizar ONU pela OS (pedido de 27/11/2026) — o "Autorizar ONUs" do IXC no
 * celular do técnico.
 *
 * O mesmo caminho de lá: escolher a OLT e consultar o que está plugado sem
 * autorização; tocar na ONU da etiqueta; completar a caixa, a porta, o perfil e
 * a VLAN; e "Autorizar", que cria o cadastro em Clientes Fibra e faz o "Gravar
 * no dispositivo". O login e o contrato são os da OS — não se escolhe cliente
 * aqui. O formulário já vem preenchido como o NOC preencheria: a caixa e a
 * porta do login, a VLAN do PON, o perfil que o modelo usa.
 */
export function CampoOnuDaOs() {
  const { osId } = useParams<{ osId: string }>();
  const id = Number(osId);
  const qc = useQueryClient();
  const chave = ['minhas-os', id, 'onu'];
  const [escolhida, setEscolhida] = useState<OnuPendente | null>(null);
  const [resultado, setResultado] = useState<AutorizacaoDeOnu | null>(null);

  const onu = useQuery({
    queryKey: chave,
    queryFn: async () => (await api.get<OnuDaOs>(`/minhas-os/${id}/onu`)).data,
    enabled: id > 0,
    retry: 0,
  });

  if (!(id > 0)) return null;
  const d = onu.data;

  function autorizou(r: AutorizacaoDeOnu) {
    setResultado(r);
    setEscolhida(null);
    void qc.invalidateQueries({ queryKey: chave });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="space-y-5 pb-16">
      <Link
        to={`/campo/os/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-tinta-500 hover:text-tinta-800"
      >
        ‹ OS {id}
      </Link>

      <div>
        <p className="eyebrow mb-1">OS {id}</p>
        <h1 className="titulo-pagina">Autorizar ONU</h1>
        {d?.login?.usuario && (
          <p className="mt-0.5 text-[15px] font-medium text-tinta-700">{d.login.usuario}</p>
        )}
      </div>

      {onu.isLoading && <Carregando texto="Lendo o login, as ONUs dele e as OLTs no IXC…" />}
      {onu.isError && <Aviso tom="erro">{mensagemErro(onu.error)}</Aviso>}

      {resultado && <ResultadoDaAutorizacao osId={id} r={resultado} />}

      {d && (
        <>
          {d.motivo && <Aviso tom="atencao">{d.motivo}</Aviso>}

          <OnusDoLogin osId={id} onus={d.onus} />

          {!d.motivo &&
            (escolhida ? (
              <FormularioDaOnu
                osId={id}
                pendente={escolhida}
                login={d.login}
                onVoltar={() => setEscolhida(null)}
                onAutorizou={autorizou}
              />
            ) : (
              <ConsultaDaOlt
                osId={id}
                olts={d.olts}
                oltSugerida={d.oltSugerida}
                onEscolher={(p) => {
                  setResultado(null);
                  setEscolhida(p);
                }}
              />
            ))}

          {d.autorizacoes.length > 0 && (
            <section className="space-y-2">
              <h2 className="eyebrow">Autorizadas por esta OS</h2>
              <ul className="card lista-dividida">
                {d.autorizacoes.map((a) => (
                  <li key={a.id} className="space-y-1 px-4 py-3 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <Selo tom={AUTORIZACAO_ONU_TOM[a.situacao]} pequeno>
                        {AUTORIZACAO_ONU_LABEL[a.situacao]}
                      </Selo>
                      <span className="num font-semibold text-tinta-800">{a.mac}</span>
                      <span className="text-tinta-400">{a.modelo}</span>
                    </div>
                    <p className="text-tinta-500">
                      {a.olt} · PON {a.ponid} · {a.caixa ?? 'caixa'} porta {a.porta} · VLAN {a.vlan}
                    </p>
                    <p className="text-[12px] text-tinta-400">
                      {a.registradoPor}, {new Date(a.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {a.macAnterior && ` · no lugar da ${a.macAnterior}`}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** O que a OLT respondeu, como o IXC guarda no "Gravar no dispositivo". */
function ResultadoDaAutorizacao({ osId, r }: { osId: number; r: AutorizacaoDeOnu }) {
  const titulo: Record<AutorizacaoDeOnu['situacao'], string> = {
    GRAVANDO: 'A ONU está indo à OLT.',
    AUTORIZADA: `ONU ${r.mac} autorizada na OLT.`,
    RECUSADA: `A ONU ${r.mac} não foi autorizada.`,
    INCERTA: `Não deu para saber se a ONU ${r.mac} foi autorizada. Confira no IXC (Clientes Fibra) antes de tentar de novo.`,
  };
  return (
    <section
      className={`space-y-2 rounded-xl border px-4 py-3 ${
        r.situacao === 'AUTORIZADA'
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
          : r.situacao === 'RECUSADA'
            ? 'border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10'
            : 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
      }`}
    >
      <p className="text-sm font-semibold text-tinta-900">{titulo[r.situacao]}</p>
      {r.retorno && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-papel/70 px-3 py-2 font-mono text-[11px] leading-snug text-tinta-700">
          {r.retorno}
        </pre>
      )}
      {r.situacao === 'AUTORIZADA' && r.fibraId && <LerSinal osId={osId} fibraId={r.fibraId} />}
    </section>
  );
}

/** As ONUs que o IXC já tem no login da OS, com o sinal. */
function OnusDoLogin({ osId, onus }: { osId: number; onus: OnuDoIxc[] }) {
  return (
    <section className="card p-4">
      <h2 className="eyebrow mb-2.5">ONU deste login no IXC</h2>
      {onus.length === 0 ? (
        <p className="text-[13px] text-tinta-500">Nenhuma ONU cadastrada neste login ainda.</p>
      ) : (
        <ul className="space-y-3">
          {onus.map((o) => (
            <li key={o.id} className="space-y-1 text-[13px]">
              <p className="flex flex-wrap items-center gap-2">
                <span className="num font-semibold text-tinta-900">{o.mac}</span>
                {o.modelo && <span className="text-tinta-400">{o.modelo}</span>}
                {!o.naOlt && (
                  <Selo tom="atencao" pequeno>
                    nunca gravada na OLT
                  </Selo>
                )}
              </p>
              <p className="text-tinta-500">
                {[o.olt, o.ponid && `PON ${o.ponid}`, o.porta && `porta ${o.porta}`, o.vlan && `VLAN ${o.vlan}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <Sinal sinal={o.sinal} />
              <LerSinal osId={osId} fibraId={o.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Sinal({ sinal, agora = false }: { sinal: SinalDaOnu; agora?: boolean }) {
  if (!sinal.rx && !sinal.tx) return <p className="text-[12px] text-tinta-400">Sinal ainda não lido.</p>;
  return (
    <p className="text-[13px] text-tinta-700">
      <span className="num font-semibold">RX {sinal.rx ?? '—'} dBm</span>
      <span className="num text-tinta-500"> · TX {sinal.tx ?? '—'} dBm</span>
      {sinal.em && (
        <span className="text-[12px] text-tinta-400"> · {agora ? 'lido agora' : dataHoraDoIxc(sinal.em)}</span>
      )}
    </p>
  );
}

/** O "Potência" do IXC: lê o sinal da ONU na OLT, agora. */
function LerSinal({ osId, fibraId }: { osId: number; fibraId: number }) {
  const ler = useMutation({
    mutationFn: async () =>
      (await api.post<{ sinal: SinalDaOnu; aviso: string | null }>(`/minhas-os/${osId}/onu/${fibraId}/sinal`)).data,
  });
  return (
    <div className="space-y-1">
      {ler.data && <Sinal sinal={ler.data.sinal} agora />}
      {ler.data?.aviso && <p className="text-[12px] text-amber-700 dark:text-amber-300">{ler.data.aviso}</p>}
      {ler.error && <p className="text-[12px] text-rose-700 dark:text-rose-300">{mensagemErro(ler.error)}</p>}
      <button
        type="button"
        onClick={() => ler.mutate()}
        disabled={ler.isPending}
        className="text-[13px] font-semibold text-brand-700 underline dark:text-brand-300"
      >
        {ler.isPending ? 'Lendo na OLT…' : 'Ler o sinal agora'}
      </button>
    </div>
  );
}

/**
 * O "Consultar" do IXC: as ONUs plugadas e sem autorização na OLT. Começa na
 * OLT da caixa do login; "Todas" serve a quem não sabe de qual OLT é a caixa.
 */
function ConsultaDaOlt({
  osId,
  olts,
  oltSugerida,
  onEscolher,
}: {
  osId: number;
  olts: OnuDaOs['olts'];
  oltSugerida: number | null;
  onEscolher: (p: OnuPendente) => void;
}) {
  const [olt, setOlt] = useState<string>(oltSugerida ? String(oltSugerida) : '');
  const [filtro, setFiltro] = useState('');
  const consultar = useMutation({
    mutationFn: async () =>
      (
        await api.get<{ pendentes: OnuPendente[]; falhas: Array<{ olt: string; motivo: string }> }>(
          `/minhas-os/${osId}/onu/pendentes`,
          { params: olt ? { olt } : {} },
        )
      ).data,
  });

  const pendentes = consultar.data?.pendentes ?? [];
  const termo = filtro.trim().toLowerCase();
  const vistas = termo ? pendentes.filter((p) => p.mac.toLowerCase().includes(termo)) : pendentes;

  return (
    <section className="card space-y-3 p-4">
      <h2 className="eyebrow">ONUs não autorizadas</h2>
      <div>
        <label className="rotulo" htmlFor="olt">
          OLT
        </label>
        <select id="olt" className="campo" value={olt} onChange={(e) => setOlt(e.target.value)}>
          <option value="">Todas as OLTs</option>
          {olts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={() => consultar.mutate()}
        disabled={consultar.isPending}
        className="btn btn-primario w-full justify-center py-3"
      >
        {consultar.isPending ? 'Consultando a OLT…' : consultar.data ? 'Consultar de novo' : 'Consultar'}
      </button>

      {consultar.error && <Aviso tom="erro">{mensagemErro(consultar.error)}</Aviso>}
      {consultar.data?.falhas.map((f) => (
        <Aviso key={f.olt} tom="atencao">
          {f.olt} não respondeu: {f.motivo}
        </Aviso>
      ))}

      {consultar.data && pendentes.length === 0 && (
        <p className="rounded-xl border border-dashed border-tinta-300 px-4 py-4 text-center text-[13px] text-tinta-500">
          Nenhuma ONU esperando autorização{olt ? ' nesta OLT' : ''}. Confira se a ONU está ligada, com a fibra
          conectada e a luz PON acesa, e consulte de novo.
        </p>
      )}

      {pendentes.length > 0 && (
        <>
          {pendentes.length > 4 && (
            <div>
              <label className="rotulo" htmlFor="filtro-serial">
                Serial da etiqueta
              </label>
              <input
                id="filtro-serial"
                className="campo num"
                placeholder="Os últimos dígitos, ex.: 17f0"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}
          <p className="ajuda">Toque na ONU cujo serial está na etiqueta dela.</p>
          <ul className="space-y-2">
            {vistas.map((p) => (
              <li key={p.chave}>
                <button
                  type="button"
                  onClick={() => onEscolher(p)}
                  className="w-full rounded-xl border border-tinta-200 bg-papel px-4 py-3 text-left transition hover:border-brand-400"
                >
                  <span className="num block text-base font-semibold text-tinta-900">{p.mac}</span>
                  <span className="block text-[13px] text-tinta-500">
                    {p.modelo} · {p.olt} · slot {p.slot} PON {p.pon}
                  </span>
                </button>
              </li>
            ))}
            {vistas.length === 0 && (
              <li className="text-[13px] text-tinta-500">Nenhum serial com "{filtro.trim()}".</li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

type Destino = { tipo: 'substituir'; id: number } | { tipo: 'adicional' } | null;

/**
 * O formulário do IXC para a ONU escolhida. O que a OLT disse (serial,
 * modelo, PON) não se edita; o resto vem sugerido e se troca.
 */
function FormularioDaOnu({
  osId,
  pendente,
  login,
  onVoltar,
  onAutorizou,
}: {
  osId: number;
  pendente: OnuPendente;
  login: OnuDaOs['login'];
  onVoltar: () => void;
  onAutorizou: (r: AutorizacaoDeOnu) => void;
}) {
  const preparo = useQuery({
    queryKey: ['minhas-os', osId, 'onu', 'preparar', pendente.chave],
    queryFn: async () =>
      (
        await api.get<PreparoDaOnu>(`/minhas-os/${osId}/onu/preparar`, {
          params: { olt: pendente.oltId, chave: pendente.chave },
        })
      ).data,
    retry: 0,
  });

  const [caixa, setCaixa] = useState<CaixaDaFibra | null>(null);
  const [portas, setPortas] = useState<PortaDaCaixa[]>([]);
  const [porta, setPorta] = useState<number | null>(null);
  const [perfilId, setPerfilId] = useState('');
  const [vlan, setVlan] = useState('');
  const [destino, setDestino] = useState<Destino>(null);
  const [mudanca, setMudanca] = useState(false);
  const [trocandoCaixa, setTrocandoCaixa] = useState(false);

  // O formulário começa com o que o servidor sugeriu, uma vez.
  const p = preparo.data;
  useEffect(() => {
    if (!p) return;
    setCaixa(p.caixa);
    setPortas(p.portas);
    setPorta(p.portaSugerida);
    setPerfilId(p.perfilSugerido ? String(p.perfilSugerido) : '');
    setVlan(p.vlanSugerida ?? '');
    setDestino(!p.jaCadastrada && p.doLogin.length === 1 ? { tipo: 'substituir', id: p.doLogin[0].id } : null);
    setTrocandoCaixa(!p.caixa);
  }, [p]);

  const autorizar = useMutation({
    mutationFn: async () =>
      (
        await api.post<AutorizacaoDeOnu>(`/minhas-os/${osId}/onu/autorizar`, {
          oltId: pendente.oltId,
          chave: pendente.chave,
          caixaId: caixa?.id,
          porta,
          perfilId: Number(perfilId),
          vlan: vlan.trim(),
          substituirId: destino?.tipo === 'substituir' ? destino.id : undefined,
          adicional: destino?.tipo === 'adicional' ? true : undefined,
          confirmarMudanca: mudanca || undefined,
        })
      ).data,
    onSuccess: onAutorizou,
  });

  if (preparo.isLoading) return <Carregando texto="Conferindo a ONU na OLT e lendo os perfis…" />;
  if (preparo.isError || !p) {
    return (
      <section className="space-y-3">
        <Aviso tom="erro">{mensagemErro(preparo.error)}</Aviso>
        <button type="button" onClick={onVoltar} className="btn btn-neutro w-full justify-center">
          Voltar à consulta
        </button>
      </section>
    );
  }

  const deOutro = p.jaCadastrada && login && p.jaCadastrada.loginId !== login.id ? p.jaCadastrada : null;
  const precisaDestino = !p.jaCadastrada && p.doLogin.length > 0;
  const ocupante = portas.find((x) => x.porta === porta && x.loginId && x.loginId !== login?.id);
  const falta = [
    (!caixa || trocandoCaixa) && 'a caixa',
    !porta && 'a porta',
    !perfilId && 'o perfil',
    !/^\d{1,4}$/.test(vlan.trim()) && 'a VLAN',
    precisaDestino && !destino && 'se a ONU substitui a antiga',
    deOutro && !mudanca && 'que a ONU passa para este cliente',
  ].filter(Boolean) as string[];

  function confirmar() {
    const perfil = p?.perfis.find((x) => String(x.id) === perfilId)?.nome ?? perfilId;
    const linhas = [
      `Autorizar a ONU ${pendente.mac} na ${pendente.olt}?`,
      `${caixa?.nome} porta ${porta} · ${perfil} · VLAN ${vlan.trim()}`,
      destino?.tipo === 'substituir' &&
        `A ONU ${p?.doLogin.find((o) => o.id === destino.id)?.mac} sai da OLT e o cadastro dela passa para esta.`,
      ocupante && `A porta ${porta} está com ${ocupante.ocupadaPor} no IXC.`,
    ].filter(Boolean);
    if (window.confirm(linhas.join('\n\n'))) autorizar.mutate();
  }

  return (
    <section className="space-y-4">
      <div className="card p-4">
        <h2 className="eyebrow mb-2.5">A ONU, como a OLT diz</h2>
        <dl className="space-y-1.5 text-[13px]">
          <Linha rotulo="MAC/Serial" valor={pendente.mac} num />
          <Linha rotulo="Modelo" valor={pendente.modelo} />
          <Linha rotulo="Transmissor" valor={pendente.olt} />
          <Linha rotulo="PON ID" valor={`${pendente.ponid} (slot ${pendente.slot}, PON ${pendente.pon})`} num />
          <Linha rotulo="Login" valor={login?.usuario} />
          <Linha rotulo="Contrato" valor={login ? String(login.contratoId) : null} num />
        </dl>
      </div>

      {p.jaCadastrada && !deOutro && (
        <Aviso tom="info">
          Esta ONU já tem cadastro neste login no IXC (nº {p.jaCadastrada.id}). Ele é reaproveitado: sai da posição
          antiga na OLT e grava nesta.
        </Aviso>
      )}
      {deOutro && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <p>
            <strong>Esta ONU está cadastrada no IXC para {deOutro.nome ?? `o login ${deOutro.loginId}`}</strong>
            {deOutro.olt ? ` (${deOutro.olt}, PON ${deOutro.ponid})` : ''}. Autorizar aqui tira ela de lá e passa para
            este cliente.
          </p>
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={mudanca} onChange={(e) => setMudanca(e.target.checked)} />
            A ONU é deste cliente agora
          </label>
        </section>
      )}

      {precisaDestino && (
        <section className="card space-y-2 p-4">
          <h2 className="eyebrow">Este login já tem ONU</h2>
          {p.doLogin.map((o) => (
            <Escolha
              key={o.id}
              marcada={destino?.tipo === 'substituir' && destino.id === o.id}
              onEscolher={() => setDestino({ tipo: 'substituir', id: o.id })}
            >
              <strong>Substitui a {o.mac}</strong> {o.modelo && `(${o.modelo})`} — a antiga sai da OLT e o cadastro dela
              passa para esta.
            </Escolha>
          ))}
          <Escolha marcada={destino?.tipo === 'adicional'} onEscolher={() => setDestino({ tipo: 'adicional' })}>
            <strong>É mais uma ONU</strong> deste login — a antiga continua.
          </Escolha>
        </section>
      )}

      <section className="card space-y-4 p-4">
        <div>
          <p className="rotulo">Caixa FTTH</p>
          {caixa && !trocandoCaixa ? (
            <p className="flex flex-wrap items-center justify-between gap-2 text-[15px] font-semibold text-tinta-900">
              {caixa.nome}
              <button
                type="button"
                onClick={() => setTrocandoCaixa(true)}
                className="text-[13px] font-semibold text-brand-700 underline dark:text-brand-300"
              >
                Trocar caixa
              </button>
            </p>
          ) : (
            <>
              <BuscaDeCaixa
                osId={osId}
                onEscolher={(c, ps) => {
                  setCaixa(c);
                  setPortas(ps);
                  setPorta(null);
                  setTrocandoCaixa(false);
                }}
              />
              {caixa && (
                <button
                  type="button"
                  onClick={() => setTrocandoCaixa(false)}
                  className="mt-2 text-[13px] font-semibold text-brand-700 underline dark:text-brand-300"
                >
                  Manter {caixa.nome}
                </button>
              )}
            </>
          )}
          {caixa && caixa.oltId && caixa.oltId !== pendente.oltId && (
            <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
              No IXC esta caixa é de outra OLT. Confira se é a caixa certa.
            </p>
          )}
        </div>

        {caixa && !trocandoCaixa && (
          <div>
            <p className="rotulo">Porta</p>
            {portas.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {portas.map((x) => {
                  const minha = x.loginId !== null && x.loginId === login?.id;
                  const ocupada = x.loginId !== null && !minha;
                  return (
                    <button
                      key={x.porta}
                      type="button"
                      onClick={() => setPorta(x.porta)}
                      aria-pressed={porta === x.porta}
                      title={x.ocupadaPor ?? undefined}
                      className={`rounded-xl border px-1 py-2 text-center transition ${
                        porta === x.porta
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : ocupada
                            ? 'border-tinta-200 bg-realce text-tinta-400'
                            : 'border-tinta-200 bg-papel text-tinta-800'
                      }`}
                    >
                      <span className="num block text-base font-semibold">{x.porta}</span>
                      <span className="block truncate text-[10px]">
                        {minha ? 'deste login' : ocupada ? primeiraParte(x.ocupadaPor) : 'livre'}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                className="campo num"
                inputMode="numeric"
                value={porta ?? ''}
                onChange={(e) => setPorta(Number(e.target.value.replace(/\D/g, '')) || null)}
              />
            )}
            {ocupante && (
              <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
                No IXC a porta {porta} está com {ocupante.ocupadaPor}.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="rotulo" htmlFor="perfil">
            Perfil
          </label>
          <select id="perfil" className="campo" value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
            <option value="">Escolha o perfil</option>
            {p.perfis.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome}
                {x.id === p.perfilSugerido ? ' (o que este modelo usa)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="rotulo" htmlFor="vlan">
            VLAN
          </label>
          <input
            id="vlan"
            className="campo num"
            inputMode="numeric"
            value={vlan}
            onChange={(e) => setVlan(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          {p.vlanSugerida && vlan.trim() !== p.vlanSugerida && (
            <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
              As ONUs deste PON usam a VLAN {p.vlanSugerida}.
            </p>
          )}
        </div>
      </section>

      {autorizar.error && <Aviso tom="erro">{mensagemErro(autorizar.error)}</Aviso>}
      {falta.length > 0 && <p className="ajuda">Falta {juntar(falta)}.</p>}

      <button
        type="button"
        onClick={confirmar}
        disabled={falta.length > 0 || autorizar.isPending}
        className="btn btn-primario w-full justify-center py-3.5 text-base"
      >
        {autorizar.isPending ? 'Gravando na OLT…' : 'Autorizar ONU'}
      </button>
      <button type="button" onClick={onVoltar} className="btn btn-neutro w-full justify-center">
        Escolher outra ONU
      </button>
    </section>
  );
}

/** A busca de caixa pelo nome escrito nela ("R63", "CTO10"). */
function BuscaDeCaixa({
  osId,
  onEscolher,
}: {
  osId: number;
  onEscolher: (c: CaixaDaFibra, portas: PortaDaCaixa[]) => void;
}) {
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setTermo(busca.trim()), 350);
    return () => window.clearTimeout(t);
  }, [busca]);

  const caixas = useQuery({
    queryKey: ['minhas-os', osId, 'onu', 'caixas', termo],
    queryFn: async () =>
      (await api.get<CaixaDaFibra[]>(`/minhas-os/${osId}/onu/caixas`, { params: { busca: termo } })).data,
    enabled: termo.length >= 2,
    retry: 0,
  });
  const escolher = useMutation({
    mutationFn: async (c: CaixaDaFibra) =>
      (await api.get<{ caixa: CaixaDaFibra; portas: PortaDaCaixa[] }>(`/minhas-os/${osId}/onu/caixas/${c.id}/portas`))
        .data,
    onSuccess: (r) => onEscolher(r.caixa, r.portas),
  });
  const lista = useMemo(() => caixas.data ?? [], [caixas.data]);

  return (
    <div className="space-y-2">
      <input
        className="campo"
        placeholder="O nome da caixa, ex.: R63_CTO10"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        autoComplete="off"
      />
      {caixas.isFetching && <p className="ajuda">Procurando no IXC…</p>}
      {caixas.error && <p className="text-[12px] text-rose-700">{mensagemErro(caixas.error)}</p>}
      {escolher.error && <p className="text-[12px] text-rose-700">{mensagemErro(escolher.error)}</p>}
      {termo.length >= 2 && !caixas.isFetching && lista.length === 0 && (
        <p className="ajuda">Nenhuma caixa com "{termo}".</p>
      )}
      <ul className="space-y-1.5">
        {lista.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => escolher.mutate(c)}
              disabled={escolher.isPending}
              className="w-full rounded-lg border border-tinta-200 bg-papel px-3 py-2 text-left text-[14px] font-medium text-tinta-800 hover:border-brand-400"
            >
              {c.nome}
              {c.capacidade && <span className="text-[12px] text-tinta-400"> · {c.capacidade} portas</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Escolha({
  marcada,
  onEscolher,
  children,
}: {
  marcada: boolean;
  onEscolher: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onEscolher}
      aria-pressed={marcada}
      className={`w-full rounded-xl border px-3 py-2.5 text-left text-[13px] transition ${
        marcada ? 'border-brand-600 bg-brand-50 text-tinta-900 dark:bg-brand-500/10' : 'border-tinta-200 bg-papel text-tinta-700'
      }`}
    >
      {children}
    </button>
  );
}

function Linha({ rotulo, valor, num = false }: { rotulo: string; valor: ReactNode; num?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-tinta-400">{rotulo}</dt>
      <dd className={`min-w-0 flex-1 break-words text-tinta-800 ${num ? 'num' : ''}`}>{valor || '—'}</dd>
    </div>
  );
}

/** "maria.souza@ilnet.com.br" → "maria.souza": cabe no botão da porta. */
function primeiraParte(login: string | null): string {
  return (login ?? '').split('@')[0] || 'ocupada';
}

function juntar(itens: string[]): string {
  return itens.length <= 1 ? (itens[0] ?? '') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}
