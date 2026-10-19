import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CampoDeData } from '../../components/CampoDeData';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { abrirArquivo } from '../../lib/arquivo';
import { mesAtual } from '../../lib/folha';
import { formatBRL, formatData } from '../../lib/format';
import { lerComoDataUrl } from '../../lib/foto';
import type {
  ArquivoDoPatrocinado,
  ContratoDePatrocinio,
  FichaDoPatrocinado,
} from '../../lib/types';
import {
  CamposDoPatrocinado,
  EscolherFornecedor,
  SeloDoContrato,
  SeloDoPagamento,
  cadastroDe,
  corpoDoCadastro,
  emMegabytes,
  textoDaVigencia,
  type Cadastro,
  type FornecedorEscolhido,
} from './comum';
import { PagarPatrocinado, usePodePagar } from './Pagar';

/** O teto da API por arquivo (`LIMITE_DO_ARQUIVO`): recusar aqui poupa o envio. */
const LIMITE_BYTES = 15 * 1024 * 1024;

type Aba = 'dados' | 'pagamentos' | 'contrato' | 'arquivos';

/**
 * A ficha de um patrocinado: quem é e como falar com ele, o que já se mandou
 * (lido dos títulos do fornecedor dele no IXC), o contrato e os arquivos.
 */
export function PatrocinadoAberto() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [aba, setAba] = useState<Aba>('dados');
  const [editando, setEditando] = useState(false);
  const [trocandoFornecedor, setTrocandoFornecedor] = useState(false);
  const [pagando, setPagando] = useState(false);
  const podePagar = usePodePagar();
  const [aviso, setAviso] = useState<{ texto: string; ruim: boolean } | null>(
    () => (location.state as { aviso?: { texto: string; ruim: boolean } } | null)?.aviso ?? null,
  );

  const ficha = useQuery({
    queryKey: ['patrocinado', id],
    queryFn: async () => (await api.get<FichaDoPatrocinado>(`/patrocinios/${id}`)).data,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['patrocinado', id] });
    void qc.invalidateQueries({ queryKey: ['patrocinados'] });
  }

  const alternarAtivo = useMutation({
    mutationFn: async (ativo: boolean) => (await api.patch(`/patrocinios/${id}`, { ativo })).data,
    onSuccess: (_, ativo) => {
      setAviso({ texto: ativo ? 'Patrocínio reativado.' : 'Patrocínio encerrado.', ruim: false });
      recarregar();
    },
    onError: (e) => setAviso({ texto: mensagemErro(e), ruim: true }),
  });

  const apagar = useMutation({
    mutationFn: async () => (await api.delete(`/patrocinios/${id}`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['patrocinados'] });
      navigate('..', { relative: 'path' });
    },
    onError: (e) => setAviso({ texto: mensagemErro(e), ruim: true }),
  });

  if (ficha.isLoading) {
    return (
      <Pagina>
        <Carregando />
      </Pagina>
    );
  }
  if (ficha.isError || !ficha.data) {
    return (
      <Pagina>
        <Vazio titulo="Não deu para abrir este patrocinado">{mensagemErro(ficha.error)}</Vazio>
      </Pagina>
    );
  }

  const f = ficha.data;
  const p = f.patrocinado;
  const podeApagar = f.contratos.length === 0 && f.arquivos.length === 0;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Patrocínios"
        titulo={p.nome}
        voltar={() => navigate('..', { relative: 'path' })}
        acoes={
          <>
            {p.idFornecedorIxc && p.ativo && podePagar && (
              <button onClick={() => setPagando(true)} className="btn btn-pagar">
                Pagar
              </button>
            )}
            <button onClick={() => setEditando(true)} className="btn btn-neutro">
              Editar
            </button>
            <button
              onClick={() => {
                if (p.ativo && !confirm(`Encerrar o patrocínio de ${p.nome}? O histórico fica guardado.`)) return;
                alternarAtivo.mutate(!p.ativo);
              }}
              className="btn btn-sutil"
            >
              {p.ativo ? 'Encerrar' : 'Reativar'}
            </button>
            {podeApagar && (
              <button
                onClick={() => {
                  if (confirm(`Apagar o cadastro de ${p.nome}? Use só para o que foi cadastrado por engano.`)) {
                    apagar.mutate();
                  }
                }}
                className="btn btn-perigo"
              >
                Apagar
              </button>
            )}
          </>
        }
      />

      {aviso && <Aviso tom={aviso.ruim ? 'atencao' : 'marca'}>{aviso.texto}</Aviso>}
      {!p.ativo && <Aviso tom="neutro">Patrocínio encerrado. O histórico continua aqui.</Aviso>}
      {!p.idFornecedorIxc && (
        <Aviso
          tom="erro"
          acao={
            <button onClick={() => setTrocandoFornecedor(true)} className="btn btn-p btn-neutro">
              Ligar a um fornecedor
            </button>
          }
        >
          Este patrocinado não está ligado a nenhum fornecedor do IXC — não há por onde pagá-lo.
        </Aviso>
      )}
      {f.avisoPagamentos && <Aviso tom="atencao">{f.avisoPagamentos}</Aviso>}

      <div className="surgir mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Numero rotulo="Já mandado" valor={formatBRL(f.resumo.totalPago)} nota={`${f.resumo.quantidadePagos} pagamento(s)`} />
        <Numero
          rotulo="Em aberto"
          valor={formatBRL(f.resumo.totalEmAberto)}
          nota="Lançado no IXC, esperando ser pago"
        />
        <Numero
          rotulo="Último pagamento"
          valor={f.resumo.ultimoPagamento ? formatData(f.resumo.ultimoPagamento) : '—'}
        />
        <div className="card px-4 py-3">
          <div className="text-xs text-tinta-500">Contrato</div>
          <div className="mt-1.5">
            <SeloDoContrato situacao={f.contrato} />
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
        <BotaoDeAba atual={aba} aba="dados" onClick={setAba}>
          Dados e contato
        </BotaoDeAba>
        <BotaoDeAba atual={aba} aba="pagamentos" onClick={setAba}>
          Pagamentos ({f.pagamentos.length})
        </BotaoDeAba>
        <BotaoDeAba atual={aba} aba="contrato" onClick={setAba}>
          Contrato ({f.contratos.length})
        </BotaoDeAba>
        <BotaoDeAba atual={aba} aba="arquivos" onClick={setAba}>
          Arquivos ({f.arquivos.length})
        </BotaoDeAba>
      </div>

      {aba === 'dados' && <AbaDados ficha={f} onTrocarFornecedor={() => setTrocandoFornecedor(true)} />}
      {aba === 'pagamentos' && (
        <AbaPagamentos ficha={f} onPagar={podePagar && p.ativo ? () => setPagando(true) : undefined} />
      )}
      {aba === 'contrato' && <AbaContrato ficha={f} onMudou={recarregar} />}
      {aba === 'arquivos' && <AbaArquivos ficha={f} onMudou={recarregar} />}

      {editando && (
        <EditarPatrocinado
          ficha={f}
          onFechar={() => setEditando(false)}
          onSalvo={() => {
            setEditando(false);
            setAviso({ texto: 'Cadastro atualizado.', ruim: false });
            recarregar();
          }}
        />
      )}
      {trocandoFornecedor && (
        <TrocarFornecedor
          ficha={f}
          onFechar={() => setTrocandoFornecedor(false)}
          onSalvo={() => {
            setTrocandoFornecedor(false);
            setAviso({ texto: 'Agora ele recebe pelo fornecedor escolhido.', ruim: false });
            recarregar();
            void qc.invalidateQueries({ queryKey: ['patrocinio-pagamentos'] });
          }}
        />
      )}
      {pagando && (
        <PagarPatrocinado
          patrocinado={p}
          valor={faltaNoMes(f)}
          onFechar={() => setPagando(false)}
        />
      )}
    </Pagina>
  );
}

function BotaoDeAba({
  atual,
  aba,
  onClick,
  children,
}: {
  atual: Aba;
  aba: Aba;
  onClick: (a: Aba) => void;
  children: ReactNode;
}) {
  const ativa = atual === aba;
  return (
    <button
      role="tab"
      aria-selected={ativa}
      onClick={() => onClick(aba)}
      className={`btn btn-p ${ativa ? 'btn-primario' : 'btn-neutro'}`}
    >
      {children}
    </button>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-tinta-500">{rotulo}</div>
      <div className="valor mt-0.5 text-lg text-tinta-900">{valor}</div>
      {nota && <div className="text-xs text-tinta-400">{nota}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dados e contato
// ---------------------------------------------------------------------------

/**
 * O que falta mandar no mês de hoje: o combinado menos o que já saiu ou está
 * lançado. Já coberto, sugere o combinado inteiro — quem paga de novo no mesmo
 * mês costuma estar adiantando o próximo.
 */
function faltaNoMes(ficha: FichaDoPatrocinado): number | null {
  const combinado = Number(ficha.patrocinado.valorMensal ?? 0);
  if (combinado <= 0) return null;
  const mes = mesAtual();
  const lancado = ficha.pagamentos
    .filter((pg) => (pg.vencimento ?? pg.pagoEm)?.slice(0, 7) === mes)
    .reduce((t, pg) => t + pg.valor, 0);
  const falta = Math.round((combinado - lancado) * 100) / 100;
  return falta > 0 ? falta : combinado;
}

function AbaDados({ ficha, onTrocarFornecedor }: { ficha: FichaDoPatrocinado; onTrocarFornecedor: () => void }) {
  const p = ficha.patrocinado;
  const whatsapp = linkDoWhatsapp(p.telefone);
  const vigencia = textoDaVigencia(p.inicio, p.fim);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Bloco titulo="Patrocinado">
        <dl className="space-y-2.5 text-sm">
          <Linha rotulo="O que se patrocina" valor={p.projeto} />
          <Linha rotulo="CPF / CNPJ" valor={p.cpfCnpj} />
          <Linha rotulo="Apoio por mês" valor={p.valorMensal ? formatBRL(p.valorMensal) : null} />
          <Linha rotulo="Vigência" valor={vigencia} />
          <Linha rotulo="Cidade" valor={p.cidade} />
          <Linha rotulo="Observações" valor={p.observacoes} />
        </dl>
      </Bloco>

      <Bloco titulo="Contato">
        <dl className="space-y-2.5 text-sm">
          <Linha rotulo="Responsável" valor={p.responsavel} />
          <Linha
            rotulo="Telefone"
            valor={
              p.telefone && (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="num">{p.telefone}</span>
                  {whatsapp && (
                    <a href={whatsapp} target="_blank" rel="noreferrer" className="text-brand-600 underline underline-offset-2">
                      WhatsApp
                    </a>
                  )}
                </span>
              )
            }
          />
          <Linha
            rotulo="E-mail"
            valor={p.email && <a href={`mailto:${p.email}`} className="text-brand-600 underline underline-offset-2">{p.email}</a>}
          />
          <Linha
            rotulo="Instagram"
            valor={
              p.instagram && (
                <a
                  href={`https://instagram.com/${p.instagram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-600 underline underline-offset-2"
                >
                  {p.instagram}
                </a>
              )
            }
          />
        </dl>
      </Bloco>

      <Bloco
        titulo="Fornecedor no IXC"
        className="lg:col-span-2"
        acao={
          <button onClick={onTrocarFornecedor} className="btn btn-p btn-sutil">
            {p.idFornecedorIxc ? 'Trocar' : 'Ligar a um fornecedor'}
          </button>
        }
      >
        {p.idFornecedorIxc ? (
          <dl className="grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
            <Linha rotulo="Fornecedor" valor={p.fornecedorNome} />
            <Linha rotulo="Código no IXC" valor={<span className="num">{p.idFornecedorIxc}</span>} />
          </dl>
        ) : (
          <p className="text-sm text-tinta-500">Nenhum fornecedor ligado.</p>
        )}
        <p className="ajuda mt-3">
          O pagamento é uma conta a pagar para este fornecedor, lançada pela aba Pagamentos. A chave
          PIX e os dados do banco são os do cadastro dele no IXC.
        </p>
      </Bloco>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-tinta-400">{rotulo}</dt>
      <dd className="min-w-0 flex-1 break-words text-tinta-800">{valor || '—'}</dd>
    </div>
  );
}

/** wa.me só aceita os dígitos, com o 55 do Brasil na frente. */
function linkDoWhatsapp(telefone: string | null, texto?: string): string | null {
  const digitos = (telefone ?? '').replace(/\D/g, '');
  if (digitos.length < 10) return null;
  const numero = digitos.length <= 11 ? `55${digitos}` : digitos;
  return `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

// ---------------------------------------------------------------------------
// Pagamentos — os títulos do fornecedor no IXC
// ---------------------------------------------------------------------------

function AbaPagamentos({ ficha, onPagar }: { ficha: FichaDoPatrocinado; onPagar?: () => void }) {
  const p = ficha.patrocinado;
  return (
    <Bloco
      titulo="O que já se mandou"
      semPadding
      acao={
        p.idFornecedorIxc &&
        onPagar && (
          <button onClick={onPagar} className="btn btn-p btn-pagar">
            Novo pagamento
          </button>
        )
      }
    >
      <div className="overflow-x-auto rolagem-fina">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Vencimento</th>
              <th className="th">Pago em</th>
              <th className="th">Descrição</th>
              <th className="th">Situação</th>
              <th className="th text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {ficha.pagamentos.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <Vazio titulo="Nenhum pagamento ainda">
                    {p.idFornecedorIxc
                      ? `As contas a pagar de ${p.fornecedorNome ?? p.nome} no IXC aparecem aqui sozinhas — as lançadas daqui e as lançadas direto lá.`
                      : 'Ligue o patrocinado ao fornecedor dele no IXC para poder pagá-lo.'}
                  </Vazio>
                </td>
              </tr>
            )}
            {ficha.pagamentos.map((pg) => (
              <tr key={pg.idFnApagar} className="linha">
                <td className="td num text-tinta-600">{pg.vencimento ? formatData(pg.vencimento) : '—'}</td>
                <td className="td num text-tinta-600">{pg.pagoEm ? formatData(pg.pagoEm) : '—'}</td>
                <td className="td text-tinta-800">
                  {pg.descricao || '—'}
                  <div className="num text-xs text-tinta-400">título nº {pg.idFnApagar}</div>
                </td>
                <td className="td">
                  <SeloDoPagamento situacao={pg.situacao} />
                </td>
                <td className="td text-right">
                  <span className="valor">{formatBRL(pg.valor)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

function AbaContrato({ ficha, onMudou }: { ficha: FichaDoPatrocinado; onMudou: () => void }) {
  const p = ficha.patrocinado;
  const qc = useQueryClient();
  const [coletando, setColetando] = useState<ContratoDePatrocinio | null>(null);
  const [escaneando, setEscaneando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const jaAssinado = ficha.contratos.some((c) => c.origem === 'ESCANEADO' || c.assinadoEm);

  const gerar = useMutation({
    mutationFn: async () => (await api.post<ContratoDePatrocinio>(`/patrocinios/${p.id}/contratos/link`)).data,
    onSuccess: (c) => {
      setErro(null);
      // O link renovado reaproveita o mesmo contrato com outro token: sem isto
      // a janela abriria com o token velho guardado, até a próxima pergunta.
      qc.setQueryData(['contrato-patrocinio', c.id], c);
      setColetando(c);
      onMudou();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const remover = useMutation({
    mutationFn: async (c: ContratoDePatrocinio) => (await api.delete(`/patrocinios/contratos/${c.id}`)).data,
    onSuccess: () => {
      setErro(null);
      onMudou();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const abrir = useMutation({
    mutationFn: (c: ContratoDePatrocinio) =>
      abrirArquivo(
        `/patrocinios/contratos/${c.id}/arquivo`,
        c.arquivoNome ?? `contrato-${c.id}.pdf`,
        c.arquivoTipo ?? 'application/pdf',
      ),
    onError: (e) => setErro(mensagemErro(e)),
  });

  function enviarLink() {
    if (
      jaAssinado &&
      !confirm('Este patrocinado já tem contrato assinado. Enviar um contrato novo (uma renovação)? O antigo continua guardado.')
    ) {
      return;
    }
    gerar.mutate();
  }

  return (
    <>
      <Bloco
        titulo="Contratos"
        semPadding
        acao={
          <div className="flex flex-wrap gap-2">
            <button onClick={enviarLink} disabled={gerar.isPending} className="btn btn-p btn-primario">
              {gerar.isPending ? 'Preparando…' : 'Enviar para assinar'}
            </button>
            <button onClick={() => setEscaneando(true)} className="btn btn-p btn-neutro">
              Guardar escaneado
            </button>
          </div>
        }
      >
        {erro && (
          <div className="px-4 pt-4">
            <Aviso tom="erro">{erro}</Aviso>
          </div>
        )}
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Contrato</th>
                <th className="th">Situação</th>
                <th className="th">Assinado por</th>
                <th className="th text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {ficha.contratos.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <Vazio titulo="Nenhum contrato ainda">
                      Patrocínio novo: envie o link para ele assinar no celular. Patrocínio antigo:
                      escaneie o contrato de papel e guarde aqui.
                    </Vazio>
                  </td>
                </tr>
              )}
              {ficha.contratos.map((c) => {
                const vencido = c.origem === 'LINK' && !c.assinadoEm && !!c.expiraEm && new Date(c.expiraEm) < new Date();
                const valendo = c.origem === 'ESCANEADO' || !!c.assinadoEm;
                const podeApagar = !(c.origem === 'LINK' && c.assinadoEm);
                return (
                  <tr key={c.id} className="linha">
                    <td className="td">
                      <div className="font-medium text-tinta-900">
                        {c.origem === 'LINK' ? 'Assinado pelo link' : 'Contrato de papel, escaneado'}
                      </div>
                      <div className="text-xs text-tinta-400">
                        {c.origem === 'ESCANEADO'
                          ? `${c.arquivoNome ?? ''}${c.arquivoTamanho ? ` · ${emMegabytes(c.arquivoTamanho)}` : ''}`
                          : `Enviado em ${formatData(c.createdAt)}`}
                      </div>
                    </td>
                    <td className="td">
                      {valendo ? (
                        <Selo tom="pago" pequeno>
                          {c.assinadoEm ? `assinado em ${formatData(c.assinadoEm)}` : 'assinado'}
                        </Selo>
                      ) : vencido ? (
                        <Selo tom="erro" pequeno>link vencido</Selo>
                      ) : (
                        <Selo tom="atencao" pequeno>aguardando assinatura</Selo>
                      )}
                    </td>
                    <td className="td text-tinta-600">
                      {c.nomeAssinante ?? '—'}
                      {c.modo === 'DIGITADA' && c.assinadoEm && (
                        <div className="text-xs text-tinta-400">assinatura gerada do nome</div>
                      )}
                    </td>
                    <td className="td text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {valendo && (
                          <button onClick={() => abrir.mutate(c)} className="btn btn-p btn-neutro">
                            Ver
                          </button>
                        )}
                        {!valendo && (
                          <button
                            onClick={() => (vencido ? gerar.mutate() : setColetando(c))}
                            className="btn btn-p btn-neutro"
                          >
                            {vencido ? 'Gerar novo link' : 'Ver o link'}
                          </button>
                        )}
                        {podeApagar && (
                          <button
                            onClick={() => {
                              const oQue = c.origem === 'LINK' ? 'Cancelar este link?' : 'Apagar este contrato escaneado?';
                              if (confirm(oQue)) remover.mutate(c);
                            }}
                            className="btn btn-p btn-perigo"
                          >
                            {c.origem === 'LINK' ? 'Cancelar' : 'Apagar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Bloco>

      <p className="ajuda mt-3">
        O link mostra o contrato padrão (menu "Contrato padrão") com o nome, o valor e a vigência deste
        cadastro — confira os dados antes de enviar. Assinado, o contrato fica guardado em PDF e não
        se apaga.
      </p>

      {coletando && (
        <ColetarContrato
          contrato={coletando}
          ficha={ficha}
          onFechar={() => setColetando(null)}
          onAssinou={onMudou}
        />
      )}
      {escaneando && (
        <GuardarEscaneado
          patrocinadoId={p.id}
          onFechar={() => setEscaneando(false)}
          onGuardado={() => {
            setEscaneando(false);
            onMudou();
          }}
        />
      )}
    </>
  );
}

/**
 * O link do contrato, para mandar ou abrir ali mesmo — o mesmo desenho da
 * coleta do recibo da diária. A janela fica perguntando enquanto ninguém
 * assina, e vira comprovante no instante em que a assinatura chega.
 */
function ColetarContrato({
  contrato,
  ficha,
  onFechar,
  onAssinou,
}: {
  contrato: ContratoDePatrocinio;
  ficha: FichaDoPatrocinado;
  onFechar: () => void;
  onAssinou: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const atual = useQuery({
    queryKey: ['contrato-patrocinio', contrato.id],
    queryFn: async () => (await api.get<ContratoDePatrocinio>(`/patrocinios/contratos/${contrato.id}`)).data,
    initialData: contrato,
    refetchInterval: (q) => (q.state.data?.assinadoEm ? false : 4000),
    // Perguntando com a aba no fundo: é enquanto se está no WhatsApp mandando o
    // link que a assinatura chega (ver `ColetarAssinatura`).
    refetchIntervalInBackground: true,
  });

  const c = atual.data;
  const assinado = !!c.assinadoEm;

  const avisou = useRef(false);
  useEffect(() => {
    if (assinado && !avisou.current) {
      avisou.current = true;
      onAssinou();
    }
  }, [assinado, onAssinou]);

  const abrirPdf = useMutation({
    mutationFn: () => abrirArquivo(`/patrocinios/contratos/${c.id}/arquivo`, `contrato-${c.id}.pdf`),
    onError: (e) => setErro(mensagemErro(e)),
  });

  const url = c.token ? `${window.location.origin}/assinar-contrato/${c.token}` : '';
  const mensagem =
    `Olá! Segue o contrato de patrocínio da ILNET para ${ficha.patrocinado.nome}. ` +
    `Leia com calma e assine pelo celular: ${url}`;
  const whatsapp = linkDoWhatsapp(ficha.patrocinado.telefone, mensagem);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setErro('Não deu para copiar sozinho — selecione o endereço e copie.');
    }
  }

  return (
    <Janela titulo="Contrato de patrocínio" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        <div className="rounded-2xl bg-realce p-4 text-sm text-tinta-600">
          Contrato de <span className="font-semibold text-tinta-800">{ficha.patrocinado.nome}</span>
          {ficha.patrocinado.valorMensal && <> · {formatBRL(ficha.patrocinado.valorMensal)} por mês</>}
        </div>

        {assinado ? (
          <div className="mt-5">
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="text-base">✓</span>
              Assinado por {c.nomeAssinante ?? 'o patrocinado'} em {formatDataHora(c.assinadoEm!)}.
            </div>
            {c.assinaturaPng && (
              <div className="mt-4 rounded-2xl border border-tinta-100 p-4">
                <img src={c.assinaturaPng} alt="Assinatura do patrocinado" className="mx-auto max-h-24" />
              </div>
            )}
            <button onClick={() => abrirPdf.mutate()} disabled={abrirPdf.isPending} className="btn btn-primario mt-5 w-full">
              {abrirPdf.isPending ? 'Abrindo…' : 'Ver o contrato em PDF'}
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <div className="rotulo">Link para assinar</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input readOnly value={url} onFocus={(e) => e.target.select()} className="campo num flex-1 text-xs" />
              <button onClick={copiar} className="btn btn-neutro shrink-0">
                {copiado ? 'Copiado!' : 'Copiar link'}
              </button>
            </div>
            {c.expiraEm && <p className="ajuda">Vale até {formatDataHora(c.expiraEm)}.</p>}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noreferrer" className="btn btn-primario flex-1">
                  Mandar pelo WhatsApp
                </a>
              )}
              <a href={url} target="_blank" rel="noreferrer" className="btn btn-neutro flex-1">
                Abrir a tela de assinar agora
              </a>
            </div>
            <p className="ajuda">
              Mande o link para o patrocinado (ou o responsável) assinar do celular, ou abra aqui e passe
              o aparelho. Esta janela avisa quando a assinatura chegar.
            </p>
          </div>
        )}

        {erro && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</p>}

        <div className="mt-6 flex justify-end">
          <button onClick={onFechar} className="btn btn-neutro">
            Fechar
          </button>
        </div>
      </div>
    </Janela>
  );
}

/** O contrato de papel do patrocínio antigo: escaneado (PDF) ou fotografado. */
function GuardarEscaneado({
  patrocinadoId,
  onFechar,
  onGuardado,
}: {
  patrocinadoId: string;
  onFechar: () => void;
  onGuardado: () => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [data, setData] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error('Escolha o arquivo do contrato.');
      if (arquivo.size > LIMITE_BYTES) {
        throw new Error(`O arquivo tem ${emMegabytes(arquivo.size)} e o limite é de 15 MB.`);
      }
      return (
        await api.post(`/patrocinios/${patrocinadoId}/contratos/escaneado`, {
          arquivo: await lerComoDataUrl(arquivo),
          arquivoNome: arquivo.name,
          assinadoEm: data,
        })
      ).data;
    },
    onSuccess: onGuardado,
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <Janela titulo="Guardar contrato escaneado" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        <p className="text-sm text-tinta-600">
          Para o patrocínio que já existia antes do link: escaneie (ou fotografe) o contrato assinado
          no papel e guarde aqui. Ele passa a contar como contrato assinado.
        </p>
        <div className="mt-4">
          <label className="rotulo">Arquivo (PDF ou foto)</label>
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="campo"
          />
        </div>
        <div className="mt-4">
          <label className="rotulo">Data escrita no contrato</label>
          <CampoDeData valor={data} onChange={setData} />
          <p className="ajuda">Se não souber, deixe em branco.</p>
        </div>

        {erro && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button onClick={() => guardar.mutate()} disabled={!arquivo || guardar.isPending} className="btn btn-primario">
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Janela>
  );
}

// ---------------------------------------------------------------------------
// Arquivos
// ---------------------------------------------------------------------------

function AbaArquivos({ ficha, onMudou }: { ficha: FichaDoPatrocinado; onMudou: () => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setErro(null);
    const falhas: string[] = [];
    // Um por vez: são megabytes cada, e o servidor recusa o corpo grande.
    for (const arquivo of Array.from(arquivos)) {
      setEnviando(arquivo.name);
      try {
        if (arquivo.size > LIMITE_BYTES) {
          throw new Error(`tem ${emMegabytes(arquivo.size)} e o limite é de 15 MB`);
        }
        await api.post(`/patrocinios/${ficha.patrocinado.id}/arquivos`, {
          arquivo: await lerComoDataUrl(arquivo),
          arquivoNome: arquivo.name,
        });
      } catch (e) {
        falhas.push(`${arquivo.name}: ${mensagemErro(e)}`);
      }
    }
    setEnviando(null);
    if (entrada.current) entrada.current.value = '';
    if (falhas.length) setErro(falhas.join(' · '));
    onMudou();
  }

  const abrir = useMutation({
    mutationFn: (a: ArquivoDoPatrocinado) =>
      abrirArquivo(`/patrocinios/arquivos/${a.id}`, a.arquivoNome, a.arquivoTipo),
    onError: (e) => setErro(mensagemErro(e)),
  });

  const remover = useMutation({
    mutationFn: async (a: ArquivoDoPatrocinado) => (await api.delete(`/patrocinios/arquivos/${a.id}`)).data,
    onSuccess: onMudou,
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <Bloco
      titulo="Arquivos"
      semPadding
      acao={
        <>
          <input
            ref={entrada}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void enviar(e.target.files)}
          />
          <button onClick={() => entrada.current?.click()} disabled={!!enviando} className="btn btn-p btn-primario">
            {enviando ? `Enviando ${enviando}…` : 'Adicionar arquivos'}
          </button>
        </>
      }
    >
      {erro && (
        <div className="px-4 pt-4">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}
      <div className="overflow-x-auto rolagem-fina">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Arquivo</th>
              <th className="th">Guardado em</th>
              <th className="th text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {ficha.arquivos.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <Vazio titulo="Nenhum arquivo guardado">
                    Fotos dos eventos, prints das publicações do mês, documentos do responsável — PDF,
                    foto, vídeo curto ou planilha, até 15 MB cada.
                  </Vazio>
                </td>
              </tr>
            )}
            {ficha.arquivos.map((a) => (
              <tr key={a.id} className="linha">
                <td className="td">
                  <div className="font-medium text-tinta-900">{a.titulo}</div>
                  <div className="text-xs text-tinta-400">
                    {a.arquivoNome} · {emMegabytes(a.arquivoTamanho)}
                  </div>
                </td>
                <td className="td num text-tinta-500">{formatData(a.createdAt)}</td>
                <td className="td text-right">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button onClick={() => abrir.mutate(a)} className="btn btn-p btn-neutro">
                      Ver
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Apagar "${a.titulo}"?`)) remover.mutate(a);
                      }}
                      className="btn btn-p btn-perigo"
                    >
                      Apagar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

function EditarPatrocinado({
  ficha,
  onFechar,
  onSalvo,
}: {
  ficha: FichaDoPatrocinado;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [form, setForm] = useState<Cadastro>(() => cadastroDe(ficha.patrocinado));
  const [erro, setErro] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: async () => (await api.patch(`/patrocinios/${ficha.patrocinado.id}`, corpoDoCadastro(form))).data,
    onSuccess: onSalvo,
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <Janela titulo="Editar patrocinado" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        <CamposDoPatrocinado form={form} setForm={setForm} />
        {ficha.contratos.some((c) => c.origem === 'LINK' && !c.assinadoEm) && (
          <p className="ajuda mt-3">
            Há um link de contrato aberto. Ele mostra os dados de quando foi gerado — para levar a
            correção, gere o link de novo na aba Contrato.
          </p>
        )}
        {erro && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            onClick={() => salvar.mutate()}
            disabled={form.nome.trim().length < 2 || salvar.isPending}
            className="btn btn-primario"
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Janela>
  );
}

function TrocarFornecedor({
  ficha,
  onFechar,
  onSalvo,
}: {
  ficha: FichaDoPatrocinado;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const p = ficha.patrocinado;
  const [fornecedor, setFornecedor] = useState<FornecedorEscolhido | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/patrocinios/${p.id}`, {
          idFornecedorIxc: fornecedor!.idFornecedor,
          fornecedorNome: fornecedor!.nome,
        })
      ).data,
    onSuccess: onSalvo,
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <Janela titulo="Fornecedor no IXC" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        <p className="text-sm text-tinta-600">
          {p.idFornecedorIxc
            ? `Hoje ${p.nome} recebe por ${p.fornecedorNome ?? `fornecedor nº ${p.idFornecedorIxc}`}. `
            : ''}
          Escolha o fornecedor do IXC por onde este patrocinado recebe. O que já se mandou passa a ser
          lido dos títulos dele.
        </p>
        <div className="mt-4">
          <EscolherFornecedor valor={fornecedor} onChange={setFornecedor} patrocinadoId={p.id} />
        </div>
        {erro && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            onClick={() => salvar.mutate()}
            disabled={!fornecedor || fornecedor.idFornecedor === p.idFornecedorIxc || salvar.isPending}
            className="btn btn-primario"
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Janela>
  );
}

function formatDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
