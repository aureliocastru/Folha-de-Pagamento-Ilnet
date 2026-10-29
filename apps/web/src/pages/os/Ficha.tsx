import { useQuery } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Aviso, Carregando, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import {
  PRIORIDADE_LABEL,
  PRIORIDADE_TOM,
  dataHoraDoIxc,
  type FichaDaOs,
  type TelefoneDoCliente,
} from '../../lib/os';

/**
 * A ficha da OS, no celular do técnico: o que ele lê antes de começar.
 *
 * É o papel que o IXC imprime ("matricial modelo 1") virado tela — ninguém
 * imprime nada, e o técnico que ia até a base buscar a folha agora abre isto
 * no portão do cliente. Mais o que o papel não faz: o telefone é um toque para
 * ligar ou chamar no WhatsApp, e o endereço é um toque para abrir o mapa ou
 * traçar a rota.
 *
 * Tudo vem do IXC na hora (`GET /minhas-os/:id/ficha`) e nada se guarda: o
 * telefone que o atendimento acabou de corrigir e o login que caiu agora são o
 * motivo de o técnico abrir esta tela.
 */
export function CampoFichaDaOs() {
  const { osId } = useParams<{ osId: string }>();
  const id = Number(osId);
  const ficha = useQuery({
    queryKey: ['minhas-os', id, 'ficha'],
    queryFn: async () => (await api.get<FichaDaOs>(`/minhas-os/${id}/ficha`)).data,
    enabled: id > 0,
    retry: 0,
  });

  if (!(id > 0)) return null;
  const f = ficha.data;
  const cliente = f?.cliente ?? null;
  const telefone = cliente?.telefones[0] ?? null;

  return (
    <div className="space-y-5 pb-10">
      <Link
        to={`/campo/os/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-tinta-500 hover:text-tinta-800"
      >
        ‹ OS {id}
      </Link>

      <div>
        <p className="eyebrow mb-1">Ficha da OS {id}</p>
        <h1 className="titulo-pagina">{f?.os.assunto ?? 'Ordem de serviço'}</h1>
        {cliente && <p className="mt-0.5 text-[15px] font-medium text-tinta-700">{cliente.nome}</p>}
      </div>

      {ficha.isLoading && <Carregando texto="Lendo o cliente, o contrato e o login no IXC…" />}
      {ficha.isError && <Aviso tom="erro">{mensagemErro(ficha.error)}</Aviso>}

      {f && (
        <>
          {cliente?.alerta && (
            <Aviso tom="atencao">
              <strong>Aviso do cadastro:</strong> {cliente.alerta}
            </Aviso>
          )}

          {/* As três coisas que se faz com a ficha na mão, no alto e grandes. */}
          <div className="grid grid-cols-3 gap-2">
            <AcaoGrande href={telefone && `tel:+${comPais(telefone.digitos)}`} rotulo="Ligar" />
            <AcaoGrande
              href={telefone && `https://wa.me/${comPais(telefone.digitos)}`}
              rotulo="WhatsApp"
              externo
            />
            <AcaoGrande href={linkDoMapa(f)} rotulo="Mapa" externo />
          </div>

          <Bloco titulo="O serviço">
            <Linha rotulo="Assunto" valor={f.os.assunto} />
            <Linha
              rotulo="Situação"
              valor={
                <span className="flex flex-wrap items-center gap-1.5">
                  <Selo tom={f.os.status === 'F' ? 'neutro' : 'info'} ponto>
                    {f.os.statusNome}
                  </Selo>
                  {f.os.prioridade && (
                    <Selo tom={PRIORIDADE_TOM[f.os.prioridade]} pequeno>
                      {PRIORIDADE_LABEL[f.os.prioridade]}
                    </Selo>
                  )}
                </span>
              }
            />
            <Linha rotulo="Aberta em" valor={dataHoraDoIxc(f.os.abertura)} />
            {f.os.agenda && <Linha rotulo="Agendada" valor={dataHoraDoIxc(f.os.agenda)} />}
            <Linha rotulo="Protocolo" valor={f.os.protocolo} num />
            <Linha rotulo="Filial" valor={f.os.filial} />
            {f.os.mensagem && (
              <div className="pt-1">
                <p className="eyebrow mb-1">O que o atendimento escreveu</p>
                <p className="whitespace-pre-line rounded-lg bg-realce px-3 py-2 text-[13px] leading-relaxed text-tinta-700">
                  {f.os.mensagem}
                </p>
              </div>
            )}
          </Bloco>

          <Bloco titulo="Cliente">
            {cliente ? (
              <>
                <Linha rotulo="Nome" valor={cliente.nome} />
                <Linha
                  rotulo={cliente.tipoPessoa === 'J' ? 'CNPJ' : 'CPF'}
                  valor={cliente.documento}
                  num
                />
                <Linha rotulo="Código no IXC" valor={String(cliente.id)} num />
                {cliente.contato && <Linha rotulo="Falar com" valor={cliente.contato} />}
                {cliente.email && <Linha rotulo="E-mail" valor={cliente.email} />}
                {cliente.telefones.length === 0 ? (
                  <Linha rotulo="Telefone" valor={null} />
                ) : (
                  cliente.telefones.map((t) => <LinhaDoTelefone key={t.digitos} telefone={t} />)
                )}
                {cliente.observacao && <Linha rotulo="Observação" valor={cliente.observacao} />}
              </>
            ) : (
              <p className="text-[13px] text-tinta-500">
                Esta OS não é de cliente — é de estrutura da rede.
              </p>
            )}
          </Bloco>

          <Bloco titulo="Onde">
            <Linha rotulo="Endereço" valor={f.endereco.linha} />
            {(f.endereco.cidade || f.endereco.uf) && (
              <Linha
                rotulo="Cidade"
                valor={[f.endereco.cidade, f.endereco.uf].filter(Boolean).join(' — ')}
              />
            )}
            {f.endereco.cep && <Linha rotulo="CEP" valor={f.endereco.cep} num />}
            {f.endereco.referencia && <Linha rotulo="Referência" valor={f.endereco.referencia} />}
            {f.endereco.coordenada && (
              <Linha
                rotulo="No mapa"
                valor={
                  <span className="num">
                    {f.endereco.coordenada.latitude.toFixed(6)},{' '}
                    {f.endereco.coordenada.longitude.toFixed(6)}
                  </span>
                }
              />
            )}
            <BotoesDoMapa ficha={f} />
          </Bloco>

          {f.contrato && (
            <Bloco titulo="Contrato">
              <Linha rotulo="Plano" valor={f.contrato.plano} />
              <Linha
                rotulo="Situação"
                valor={
                  f.contrato.statusNome ? (
                    <Selo tom={f.contrato.status === 'A' ? 'pago' : 'atencao'} pequeno>
                      contrato {f.contrato.statusNome}
                    </Selo>
                  ) : null
                }
              />
              <Linha rotulo="Ativo desde" valor={dataHoraDoIxc(f.contrato.ativacao)} />
              <Linha rotulo="Número" valor={String(f.contrato.id)} num />
              {f.contrato.observacao && <Linha rotulo="Observação" valor={f.contrato.observacao} />}
            </Bloco>
          )}

          {f.login && (
            <Bloco titulo="Login do cliente">
              <Linha rotulo="Usuário" valor={f.login.usuario} />
              <Linha
                rotulo="Situação"
                valor={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Selo tom={f.login.ativo ? 'pago' : 'erro'} pequeno>
                      {f.login.ativo ? 'ativo' : 'inativo'}
                    </Selo>
                    <Selo tom={f.login.online ? 'pago' : 'atencao'} ponto>
                      {f.login.online ? 'conectado agora' : 'fora do ar'}
                    </Selo>
                  </span>
                }
              />
              {(f.login.caixa || f.login.porta) && (
                <Linha
                  rotulo="Caixa e porta"
                  valor={
                    <span className="num">
                      {[f.login.caixa && `caixa ${f.login.caixa}`, f.login.porta && `porta ${f.login.porta}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  }
                />
              )}
              {f.login.onu && <Linha rotulo="ONU" valor={f.login.onu} num />}
              {f.login.mac && <Linha rotulo="MAC" valor={f.login.mac} num />}
              {f.login.ip && <Linha rotulo="IP" valor={f.login.ip} num />}
              {f.login.sinal && <Linha rotulo="Sinal do último atendimento" valor={f.login.sinal} />}
              {!f.login.online && f.login.ultimaConexao && (
                <Linha rotulo="Última conexão" valor={dataHoraDoIxc(f.login.ultimaConexao)} />
              )}
            </Bloco>
          )}

          <p className="ajuda">
            As mesmas informações do papel da OS no IXC, lidas de lá agora. Nada daqui muda nada no
            IXC.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * O mapa e a rota. Nenhum dos dois aparece quando não há nem ponto no IXC nem
 * endereço escrito — um botão que abre o mapa em lugar nenhum é pior que
 * nenhum botão.
 */
function BotoesDoMapa({ ficha }: { ficha: FichaDaOs }) {
  const mapa = linkDoMapa(ficha);
  const rota = linkDaRota(ficha);
  if (!mapa && !rota) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {mapa && (
        <a href={mapa} target="_blank" rel="noreferrer" className="btn btn-neutro btn-p">
          Ver no mapa
        </a>
      )}
      {rota && (
        <a href={rota} target="_blank" rel="noreferrer" className="btn btn-neutro btn-p">
          Traçar rota
        </a>
      )}
    </div>
  );
}

/**
 * Um dos três botões do alto. Sem o número do cliente ou sem o ponto no mapa
 * ele aparece apagado em vez de desaparecer: o lugar dos três não muda de uma
 * OS para outra, e o técnico aprende onde cada um fica.
 */
function AcaoGrande({
  href,
  rotulo,
  externo = false,
}: {
  href: string | null;
  rotulo: string;
  externo?: boolean;
}) {
  if (!href) {
    return (
      <span className="btn btn-neutro w-full cursor-not-allowed justify-center py-3 opacity-50">
        {rotulo}
      </span>
    );
  }
  return (
    <a
      href={href}
      {...(externo ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="btn btn-neutro w-full justify-center py-3"
    >
      {rotulo}
    </a>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="eyebrow mb-2.5">{titulo}</h2>
      <dl className="space-y-1.5 text-[13px]">{children}</dl>
    </section>
  );
}

function Linha({
  rotulo,
  valor,
  num = false,
}: {
  rotulo: string;
  valor: ReactNode;
  num?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-tinta-400">{rotulo}</dt>
      <dd className={`min-w-0 flex-1 break-words text-tinta-800 ${num ? 'num' : ''}`}>
        {valor || '—'}
      </dd>
    </div>
  );
}

/** Um telefone do cliente: o número para ligar, e o atalho do WhatsApp ao lado. */
function LinhaDoTelefone({ telefone: t }: { telefone: TelefoneDoCliente }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-tinta-400">{t.rotulo}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <a href={`tel:+${comPais(t.digitos)}`} className="num font-medium text-brand-700 underline dark:text-brand-300">
          {t.numero}
        </a>
        <a
          href={`https://wa.me/${comPais(t.digitos)}`}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] font-semibold text-emerald-700 underline dark:text-emerald-300"
        >
          WhatsApp
        </a>
      </dd>
    </div>
  );
}

/** Os dígitos com o 55 do Brasil na frente — é o que `tel:` e `wa.me` querem. */
function comPais(digitos: string): string {
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

/**
 * O endereço no mapa: pelo ponto do IXC quando ele tem um, e pela busca do
 * endereço escrito quando não — "ver onde é" não pode depender de alguém ter
 * marcado o cliente no mapa.
 */
function linkDoMapa(f: FichaDaOs): string | null {
  const c = f.endereco.coordenada;
  if (c) return `https://www.google.com/maps?q=${c.latitude},${c.longitude}`;
  const busca = enderecoEscrito(f);
  return busca ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}` : null;
}

/** A rota até lá, a partir de onde o celular está. */
function linkDaRota(f: FichaDaOs): string | null {
  const c = f.endereco.coordenada;
  const destino = c ? `${c.latitude},${c.longitude}` : enderecoEscrito(f);
  return destino
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`
    : null;
}

function enderecoEscrito(f: FichaDaOs): string | null {
  const partes = [f.endereco.linha, f.endereco.cidade, f.endereco.uf, f.endereco.cep].filter(Boolean);
  return partes.length ? partes.join(', ') : null;
}
