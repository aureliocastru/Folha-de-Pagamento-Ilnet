import type { ReactNode } from 'react';
import { formatBRL } from '../lib/format';

/**
 * Sequência categórica da casa, na ordem fixa em que as fatias são servidas —
 * nunca ciclada, nunca por ranking. Começa no azul da logo e segue por matizes
 * que se distinguem em daltonismo (protanopia, deuteranopia e tritanopia), com
 * contraste ≥ 3:1 sobre o cartão branco.
 *
 * O turquesa era o primeiro tom quando a marca era turquesa; agora que a marca
 * é o azul da ilnet, ele desceu para terceiro e o azul genérico que ocupava
 * essa posição saiu — dois azuis vizinhos numa mesma barra não se separam.
 *
 * Trocar um valor aqui exige revalidar: cor de gráfico é o que separa uma
 * série da outra para quem lê.
 */
export const PALETA = [
  'var(--serie-1)', // azul da marca
  'var(--serie-2)', // âmbar
  'var(--serie-3)', // turquesa
  'var(--serie-4)', // vermelho
  'var(--serie-5)', // violeta
  'var(--serie-6)', // verde
] as const;

/**
 * O semáforo da conta a pagar, nos mesmos tons em toda a ferramenta. São cores
 * de estado, não de série: nunca servem para "a quarta categoria", e sempre
 * aparecem junto do rótulo em palavras — quem não distingue as cores lê o
 * mesmo que os outros.
 */
export const CORES_DE_ESTADO = {
  vencido: 'var(--estado-vencido)',
  hoje: 'var(--estado-hoje)',
  prazo: 'var(--estado-prazo)',
  semData: 'var(--estado-sem-data)',
} as const;

export interface SerieGrafico {
  /** Campo do objeto de cada mês que guarda o valor desta série. */
  chave: string;
  rotulo: string;
  cor: string;
}

// prettier-ignore
const MES_CURTO = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

export function rotuloMes(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  return m ? `${MES_CURTO[Number(m[2]) - 1]}/${m[1].slice(2)}` : competencia;
}

/**
 * Altura reservada ao rótulo em pé. Doze meses num cartão de um terço da tela
 * dão uns 10px por coluna: "ago/26" deitado não cabe de jeito nenhum, e pular
 * rótulos deixava o eixo mudo em dois terços das barras. Em pé, todo mês tem
 * nome — o que custa é esta faixa embaixo do gráfico.
 */
const ALTURA_ROTULO = 44;

type LinhaDoMes = { competencia: string } & Record<string, number | string>;

/**
 * Barras empilhadas por mês. Cada segmento é uma série; a altura da coluna é a
 * soma delas, então o que se compara entre meses é o total — e dentro de cada
 * mês, a composição.
 *
 * Só o total ganha rótulo fixo: número em cada segmento vira ruído. O resto
 * aparece ao passar o mouse.
 */
export function BarrasEmpilhadas({
  meses,
  series,
  atual,
  altura = 'h-56',
}: {
  meses: LinhaDoMes[];
  series: SerieGrafico[];
  /** Competência em foco, destacada nos rótulos. */
  atual?: string;
  altura?: string;
}) {
  const totais = meses.map((m) => somar(m, series));
  const maior = Math.max(1, ...totais);
  const vazio = totais.every((t) => t === 0);

  // Nada lançado: as barras seriam doze tocos cinzas com um eixo por baixo,
  // ocupando meia tela para dizer "zero". A frase diz o mesmo e se lê de longe.
  if (vazio) {
    return (
      <div className={`flex ${altura} flex-col justify-center`}>
        <p className="text-sm text-tinta-400">
          Nada lançado no período escolhido.
        </p>
        <p className="mt-1 text-xs text-tinta-300">
          {rotuloMes(meses[0].competencia)} a{' '}
          {rotuloMes(meses[meses.length - 1].competencia)}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className={`flex ${altura} items-end gap-2 sm:gap-3`}>
        {meses.map((mes, i) => {
          const total = totais[i];
          const eAtual = mes.competencia === atual;
          return (
            <div
              key={mes.competencia}
              // `h-full` não é enfeite: sem altura definida na coluna, a
              // altura em % da barra não resolve e ela colapsa para nada.
              className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
            >
              <span
                className={`num shrink-0 text-[10px] font-semibold transition ${
                  eAtual ? 'text-tinta-700' : 'text-tinta-400'
                }`}
              >
                {total > 0 ? formatCompacto(total) : ''}
              </span>

              {/* A área das barras fica com o que sobra depois do valor e do
                  rótulo. Antes a barra media 100% da coluna inteira e o flex
                  a encolhia para caber — encolhendo mais a barra maior, que é
                  justamente a que não podia mentir.

                  A barra vai absoluta porque altura em % precisa de um pai com
                  altura resolvida: aqui quem resolve é o `flex-1`, e o encaixe
                  pelo `bottom` é o que a faz crescer de baixo para cima. */}
              <div className="relative w-full min-h-0 flex-1">
                <div
                  className="absolute inset-x-0 bottom-0 flex origin-bottom animate-crescer flex-col-reverse justify-start overflow-hidden rounded-t-md"
                  style={{
                    height: `${Math.max((total / maior) * 100, total > 0 ? 3 : 1)}%`,
                    animationDelay: `${i * 50}ms`,
                  }}
                >
                  {total === 0 ? (
                    <div className="h-full w-full rounded-t-md bg-tinta-100" />
                  ) : (
                    series.map((s) => {
                      const valor = Number(mes[s.chave] ?? 0);
                      if (valor <= 0) return null;
                      return (
                        <div
                          key={s.chave}
                          // A borda branca é o respiro de 2px entre fatias: sem
                          // ela, duas cores vizinhas viram uma mancha só. Fica
                          // embaixo porque a coluna é `flex-col-reverse`: a
                          // primeira série é a de baixo, e ela não separa nada.
                          className="w-full border-b-2 border-white first:border-b-0"
                          style={{
                            height: `${(valor / total) * 100}%`,
                            background: s.cor,
                          }}
                        />
                      );
                    })
                  )}
                </div>
              </div>

              {/* Em pé, para todos os meses caberem lado a lado. A caixa tem
                  altura fixa e o texto gira dentro dela; sem isso o rótulo
                  girado empurraria a coluna e desalinharia o eixo. */}
              <div
                className="flex w-full shrink-0 items-center justify-center"
                style={{ height: ALTURA_ROTULO }}
              >
                <span
                  className={`whitespace-nowrap text-[11px] leading-none ${
                    eAtual ? 'font-semibold text-tinta-800' : 'text-tinta-400'
                  }`}
                  style={{ transform: 'rotate(-90deg)' }}
                >
                  {rotuloMes(mes.competencia)}
                </span>
              </div>

              {total > 0 && (
                <Balao>
                  <p className="mb-1.5 font-semibold text-tinta-100">
                    {rotuloMes(mes.competencia)}
                  </p>
                  {series.map((s) => (
                    <LinhaBalao
                      key={s.chave}
                      cor={s.cor}
                      rotulo={s.rotulo}
                      valor={Number(mes[s.chave] ?? 0)}
                    />
                  ))}
                  <p className="mt-1.5 flex justify-between gap-4 border-t border-tinta-600 pt-1.5 font-semibold text-tinta-100">
                    <span>Total</span>
                    <span className="num">{formatBRL(total)}</span>
                  </p>
                </Balao>
              )}
            </div>
          );
        })}
      </div>

      <Legenda series={series} meses={meses} />
    </div>
  );
}

/**
 * Comparação de valores de um mesmo mês. Barra horizontal em vez de rosca: o
 * olho compara comprimento muito melhor do que ângulo, e aqui o que importa é
 * quanto uma linha é maior que a outra.
 */
export function BarrasComparadas({
  itens,
  onAbrir,
}: {
  itens: { rotulo: string; valor: number; cor: string; detalhe?: string }[];
  /**
   * O que fazer ao clicar numa barra. Dada, a barra vira botão.
   *
   * Um gráfico responde "quanto"; a pergunta seguinte é sempre "quanto do
   * quê" — que contas somam aquilo. Sem o clique, a resposta estava a três
   * telas de distância, e quem olhava o painel voltava a procurar na lista.
   */
  onAbrir?: (rotulo: string) => void;
}) {
  const maior = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <div className="space-y-3">
      {itens.map((item) => {
        const conteudo = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span
                className={
                  onAbrir
                    ? 'text-tinta-700 group-hover:text-brand-700 dark:group-hover:text-brand-300'
                    : 'text-tinta-600'
                }
              >
                {item.rotulo}
              </span>
              <span className="valor text-[13px]">{formatBRL(item.valor)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-tinta-100">
                <div
                  className="h-full animate-crescer rounded-full"
                  style={{
                    width: `${(item.valor / maior) * 100}%`,
                    background: item.cor,
                  }}
                />
              </div>
              {item.detalhe && (
                <span className="w-16 shrink-0 text-right text-[11px] text-tinta-400">
                  {item.detalhe}
                </span>
              )}
            </div>
          </>
        );

        if (!onAbrir) return <div key={item.rotulo}>{conteudo}</div>;
        return (
          <button
            key={item.rotulo}
            type="button"
            onClick={() => onAbrir(item.rotulo)}
            title={`Ver as contas de ${item.rotulo}`}
            className="group -mx-2 block w-full rounded-lg px-2 py-1 text-left transition hover:bg-tinta-50"
          >
            {conteudo}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Legenda com o total de cada série no período. É o que garante que a
 * identidade não dependa só da cor — e serve de leitura em texto de tudo que
 * as barras mostram.
 */
function Legenda({
  series,
  meses,
}: {
  series: SerieGrafico[];
  meses: LinhaDoMes[];
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-tinta-100 pt-4">
      {series.map((s) => {
        const total = meses.reduce(
          (soma, m) => soma + Number(m[s.chave] ?? 0),
          0,
        );
        return (
          <span key={s.chave} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: s.cor }}
            />
            <span className="text-tinta-500">{s.rotulo}</span>
            <span className="valor text-[12px] text-tinta-700">
              {formatBRL(total)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function Balao({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max -translate-x-1/2 scale-95 rounded-xl bg-barra px-3 py-2 text-[11px] leading-relaxed text-white/75 opacity-0 shadow-card-hover transition duration-150 group-hover:scale-100 group-hover:opacity-100">
      {children}
    </div>
  );
}

function LinhaBalao({
  cor,
  rotulo,
  valor,
}: {
  cor: string;
  rotulo: string;
  valor: number;
}) {
  return (
    <p className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-sm"
          style={{ background: cor }}
        />
        {rotulo}
      </span>
      <span className="num">{formatBRL(valor)}</span>
    </p>
  );
}

function somar(mes: LinhaDoMes, series: SerieGrafico[]): number {
  return series.reduce((s, serie) => s + Number(mes[serie.chave] ?? 0), 0);
}

/** "R$ 12,4 mil" — cabe em cima da barra sem virar sopa de dígitos. */
export function formatCompacto(valor: number): string {
  if (valor >= 1000) {
    const mil = valor / 1000;
    return `${mil.toFixed(mil >= 100 ? 0 : 1).replace('.', ',')} mil`;
  }
  return valor.toFixed(0);
}
