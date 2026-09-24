import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Pagina,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, hojeEmBrasilia } from '../../lib/format';
import { quantidadeComUnidade, type RelatorioDoMes } from '../../lib/os';

const BOM_UTF8 = String.fromCharCode(0xfeff);

/**
 * O relatório do mês das OS: quanto cada técnico gastou de material, quanto
 * saiu de cada material (e a média por OS — o conector que passa de dois por
 * OS é o que se pergunta), os aparelhos que entraram e saíram, e o porquê de
 * quem passou do normal.
 *
 * Só entra o que foi gravado no IXC, pelo dia em que foi gravado: é o que de
 * fato saiu do estoque. O valor é o preço base do cadastro no dia.
 */
export function Relatorio() {
  const [competencia, setCompetencia] = useState(hojeEmBrasilia().slice(0, 7));

  const relatorio = useQuery({
    queryKey: ['os', 'relatorio', competencia],
    queryFn: async () =>
      (await api.get<RelatorioDoMes>('/os/relatorio', { params: { competencia } })).data,
    enabled: /^\d{4}-\d{2}$/.test(competencia),
  });
  const r = relatorio.data;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Ordens de Serviço"
        titulo="Relatório do mês"
        acoes={
          <>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              className="campo w-auto"
              aria-label="Mês"
            />
            <button
              type="button"
              disabled={!r || r.porTecnico.length === 0}
              onClick={() => r && baixarCsv(r)}
              className="btn btn-neutro"
            >
              Baixar planilha
            </button>
          </>
        }
      />

      {relatorio.isError && <Aviso tom="erro">{mensagemErro(relatorio.error)}</Aviso>}
      {relatorio.isLoading && <Carregando />}

      {r && (
        <>
          <div className="surgir surgir-1 mb-4 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-5">
            <Indicador acento rotulo="Material gasto" valor={formatBRL(r.totais.valorMateriais)} />
            <Indicador rotulo="OS com registro" valor={r.totais.os} />
            <Indicador rotulo="Aparelhos instalados" valor={r.totais.instalados} />
            <Indicador
              rotulo="Aparelhos retirados"
              valor={r.totais.retirados}
              detalhe={r.totais.comDefeito ? `${r.totais.comDefeito} com defeito` : undefined}
            />
            <Indicador
              rotulo="Fora da lista"
              valor={r.totais.divergencias}
              alerta={r.totais.divergencias ? 'conferir no IXC' : undefined}
            />
          </div>

          {r.porTecnico.length === 0 ? (
            <Bloco>
              <Vazio titulo="Nada gravado neste mês">
                O relatório conta o que foi gravado no IXC pelas OS dentro do mês.
              </Vazio>
            </Bloco>
          ) : (
            <div className="space-y-4">
              <Bloco titulo="Por técnico" semPadding>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th">Técnico</th>
                      <th className="th text-right">OS</th>
                      <th className="th text-right">Instalados</th>
                      <th className="th text-right">Retirados</th>
                      <th className="th text-right">Fora da lista</th>
                      <th className="th text-right">Material</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.porTecnico.map((t) => (
                      <tr key={t.tecnicoId} className="linha">
                        <td className="td font-medium text-tinta-900">{t.tecnico}</td>
                        <td className="td num text-right">{t.os}</td>
                        <td className="td num text-right">{t.instalados}</td>
                        <td className="td num text-right">
                          {t.retirados}
                          {t.comDefeito > 0 && (
                            <span className="text-rose-600"> ({t.comDefeito} defeito)</span>
                          )}
                        </td>
                        <td className="td num text-right">{t.divergencias}</td>
                        <td className="td num text-right">{formatBRL(t.valorMateriais)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Bloco>

              <Bloco titulo="Por material" semPadding>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th">Material</th>
                      <th className="th text-right">Quantidade</th>
                      <th className="th text-right">Em OS</th>
                      <th className="th text-right">Média por OS</th>
                      <th className="th text-right">Valor</th>
                      <th className="th">Quem gastou</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.materiais.map((m) => (
                      <tr key={m.produtoId} className="linha">
                        <td className="td font-medium text-tinta-900">{m.descricao}</td>
                        <td className="td num text-right">{quantidadeComUnidade(m.quantidade, m.unidade)}</td>
                        <td className="td num text-right">{m.os}</td>
                        <td className="td num text-right">{quantidadeComUnidade(m.mediaPorOs, m.unidade)}</td>
                        <td className="td num text-right">{formatBRL(m.valor)}</td>
                        <td className="td text-[12px] text-tinta-500">
                          {m.porTecnico
                            .map((p) => `${p.tecnico} ${quantidadeComUnidade(p.quantidade, m.unidade)}`)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Bloco>

              {r.aparelhos.length > 0 && (
                <Bloco titulo="Aparelhos" semPadding>
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="th">Modelo</th>
                        <th className="th text-right">Instalados</th>
                        <th className="th text-right">Retirados</th>
                        <th className="th text-right">Com defeito</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.aparelhos.map((a) => (
                        <tr key={`${a.produtoId}-${a.descricao}`} className="linha">
                          <td className="td font-medium text-tinta-900">{a.descricao}</td>
                          <td className="td num text-right">{a.instalados}</td>
                          <td className="td num text-right">{a.retirados}</td>
                          <td className="td num text-right">{a.comDefeito}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Bloco>
              )}

              {r.justificativas.length > 0 && (
                <Bloco titulo="Acima do normal, com o porquê" semPadding>
                  <ul className="lista-dividida">
                    {r.justificativas.map((j, k) => (
                      <li key={k} className="px-4 py-2.5 text-sm md:px-5">
                        <span className="font-medium text-tinta-900">
                          OS {j.osIxcId} · {j.tecnico}
                        </span>{' '}
                        <span className="text-tinta-500">
                          — {quantidadeComUnidade(j.quantidade, j.unidade)} de {j.descricao}:
                        </span>{' '}
                        <span className="italic text-tinta-700">{j.observacao}</span>
                      </li>
                    ))}
                  </ul>
                </Bloco>
              )}
            </div>
          )}
        </>
      )}
    </Pagina>
  );
}

/** Uma linha por técnico e material — o formato que a tabela dinâmica soma sem esforço. */
function baixarCsv(r: RelatorioDoMes) {
  const colunas = ['Competencia', 'Tecnico', 'OS do tecnico', 'Material', 'Unidade', 'Quantidade', 'Em OS', 'Valor'];
  const linhas = r.porTecnico.flatMap((t) =>
    t.materiais.map((m) => [
      r.competencia,
      t.tecnico,
      String(t.os),
      m.descricao,
      m.unidade ?? '',
      numero(m.quantidade, 3),
      String(m.os),
      numero(m.valor, 2),
    ]),
  );
  const csv = [colunas, ...linhas].map((l) => l.map(escapar).join(';')).join('\r\n');
  const blob = new Blob([BOM_UTF8 + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `material-de-os-${r.competencia}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapar(valor: string): string {
  const limpo = valor.replace(/"/g, '""');
  return /[";\r\n]/.test(limpo) ? `"${limpo}"` : limpo;
}

/** Número com vírgula decimal, como a planilha em português espera. */
function numero(valor: number, casas: number): string {
  return valor.toFixed(casas).replace('.', ',');
}
