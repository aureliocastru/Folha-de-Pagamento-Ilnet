import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Aviso, Carregando, Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import type { AlmoxarifadoCadastro, AndamentoDaTransferencia } from '../../lib/types';
import { quantidade } from './ProdutoNoIxc';
import {
  Andamento,
  FicamDeFora,
  identificacao,
  ListaDeItens,
  useAndamento,
  useConteudo,
} from './transferencia-comum';

/**
 * Mover tudo o que um almoxarifado tem para outro — para arrumar o estoque de
 * uma vez. Vai o produto comum (a quantidade inteira), cada peça de
 * patrimônio que está na prateleira (ONU, roteador, com MAC e número) e, se
 * quiserem, o saldo de patrimônio que não tem peça cadastrada, numa
 * transferência só no IXC.
 *
 * Três momentos na mesma janela: **conferir** (o que vai e o que fica, lido
 * agora do IXC), **acompanhar** (roda no servidor, item a item) e o
 * **resultado**.
 */
export function MoverTudo({
  origem,
  almoxarifados,
  onFechar,
  onMudou,
}: {
  origem: AlmoxarifadoCadastro;
  /** Todos — o destino sai dos liberados e ativos. */
  almoxarifados: AlmoxarifadoCadastro[];
  onFechar: () => void;
  /** O saldo mudou no IXC: quem mostra estoque tem de reler. */
  onMudou: () => void;
}) {
  const [para, setPara] = useState('');
  const [observacao, setObservacao] = useState('');
  /**
   * Levar também o saldo de patrimônio sem peça, pela quantidade. Marcado de
   * saída: quem abre "Mover tudo" quer esvaziar o almoxarifado.
   */
  const [levarSemPeca, setLevarSemPeca] = useState(true);
  /** A transferência acompanhada — a primeira, ou a do "tentar de novo". */
  const [aberta, setAberta] = useState<AndamentoDaTransferencia | null>(null);
  const transferenciaId = aberta?.id ?? null;

  const conteudo = useConteudo(transferenciaId ? null : origem.id);
  const andamento = useAndamento(transferenciaId, onMudou);

  const iniciar = useMutation({
    mutationFn: async () =>
      (
        await api.post<AndamentoDaTransferencia>(
          `/almoxarifado/almoxarifados/${origem.id}/mover-tudo`,
          { para: Number(para), observacao: observacao.trim() || undefined, levarSemPeca },
        )
      ).data,
    onSuccess: setAberta,
  });

  const destinos = almoxarifados.filter((a) => a.liberado && a.ativo && a.id !== origem.id);
  const nomeDoDestino = destinos.find((a) => String(a.id) === para)?.descricao ?? '';
  const c = conteudo.data;
  const semPeca = c && levarSemPeca ? c.semPeca.length : 0;
  const total = c ? c.moviveis.length + c.patrimonios.length + semPeca : 0;
  const a = andamento.data?.id === transferenciaId ? andamento.data : aberta;

  return (
    <Janela titulo={`Mover tudo de ${origem.descricao}`} onFechar={onFechar}>
      {!transferenciaId && (
        <>
          {conteudo.isLoading && <Carregando texto="Lendo no IXC o que tem nele…" />}
          {conteudo.isError && <Aviso tom="erro">{mensagemErro(conteudo.error)}</Aviso>}

          {c && total === 0 && (
            <Aviso tom="info">
              {c.deFora.length + c.semPeca.length > 0
                ? `Não tem nada que vá por transferência — só ${c.deFora.length + c.semPeca.length} item(ns) que ficam (abaixo).`
                : 'Este almoxarifado está vazio no IXC.'}
            </Aviso>
          )}

          {c && c.moviveis.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-sm text-tinta-600">
                <strong>{c.moviveis.length}</strong>{' '}
                {c.moviveis.length === 1 ? 'produto' : 'produtos'}, cada um com tudo o que tem
                aqui
              </p>
              <ListaDeItens
                itens={c.moviveis.map((i) => ({
                  chave: i.produtoId,
                  nome: i.descricao,
                  detalhe: `${quantidade(i.saldo)} ${i.unidadeSigla}`,
                }))}
              />
            </div>
          )}

          {c && c.patrimonios.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-sm text-tinta-600">
                <strong>{c.patrimonios.length}</strong>{' '}
                {c.patrimonios.length === 1 ? 'peça' : 'peças'} de patrimônio, cada uma com o
                seu MAC e número
              </p>
              <ListaDeItens
                itens={c.patrimonios.map((p) => ({
                  chave: `p${p.patrimonioId}`,
                  nome: p.descricao,
                  detalhe: identificacao(p),
                }))}
              />
            </div>
          )}

          {c && c.semPeca.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-sm text-tinta-600">
                <strong>{c.semPeca.length}</strong> de patrimônio{' '}
                <span className="text-tinta-400">
                  sem peça cadastrada — o IXC tem a quantidade, mas não o registro com MAC e
                  número
                </span>
              </p>
              <ListaDeItens
                itens={c.semPeca.map((i) => ({
                  chave: `s${i.produtoId}`,
                  nome: i.descricao,
                  detalhe: `${quantidade(i.saldo)} ${i.unidadeSigla}`,
                }))}
              />
              <label className="opcao mt-2 text-[13px]">
                <input
                  type="checkbox"
                  className="marcador"
                  checked={levarSemPeca}
                  onChange={(e) => setLevarSemPeca(e.target.checked)}
                />
                Levar também, pela quantidade
              </label>
            </div>
          )}

          {c && c.deFora.length > 0 && <FicamDeFora itens={c.deFora} />}

          {c && total > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="rotulo" htmlFor="mover-tudo-para">
                  Vai para
                </label>
                <select
                  id="mover-tudo-para"
                  value={para}
                  onChange={(e) => setPara(e.target.value)}
                  className="campo"
                >
                  <option value="">Escolha…</option>
                  {destinos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.descricao}
                    </option>
                  ))}
                </select>
                <p className="ajuda">Só aparecem os ativos e liberados para o sistema.</p>
              </div>
              <div>
                <label className="rotulo" htmlFor="mover-tudo-obs">
                  Observação (vai para o IXC)
                </label>
                <input
                  id="mover-tudo-obs"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value.slice(0, 200))}
                  className="campo"
                  placeholder="Ex.: organização do estoque"
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {iniciar.isError && <Aviso tom="erro">{mensagemErro(iniciar.error)}</Aviso>}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onFechar} className="btn btn-neutro">
              Cancelar
            </button>
            {c && total > 0 && (
              <button
                type="button"
                disabled={!para || iniciar.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `Mover ${total} ${total === 1 ? 'item' : 'itens'} de "${origem.descricao}" ` +
                        `para "${nomeDoDestino}" no IXC?\n\nProduto vai com a quantidade inteira; ` +
                        'patrimônio, peça por peça' +
                        (semPeca > 0 ? '; patrimônio sem peça, pela quantidade' : '') +
                        '. Para desfazer, só movendo de volta.',
                    )
                  ) {
                    iniciar.mutate();
                  }
                }}
                className="btn btn-primario"
              >
                {iniciar.isPending
                  ? 'Abrindo a transferência…'
                  : `Mover ${total} ${total === 1 ? 'item' : 'itens'}`}
              </button>
            )}
          </div>
        </>
      )}

      {transferenciaId && a && (
        <Andamento a={a} erro={andamento.error} onFechar={onFechar} onNova={setAberta} />
      )}
    </Janela>
  );
}
