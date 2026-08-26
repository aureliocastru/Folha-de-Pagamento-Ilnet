import { useEffect, useState } from 'react';
import { Janela } from '../../components/ui';
import { formatBRL } from '../../lib/format';

/**
 * O que circula: cédulas de 200 a 2, moedas de 1 real a 5 centavos.
 *
 * A de 1 centavo não entra. Ela ainda é moeda legal, mas não se cunha desde
 * 2005 e não aparece numa gaveta de provedor — e uma linha que fica sempre em
 * zero só atrapalha quem está descendo a lista com o dinheiro na mão.
 */
const CEDULAS = [200, 100, 50, 20, 10, 5, 2];
const MOEDAS = [1, 0.5, 0.25, 0.1, 0.05];

/** Quantas de cada valor, guardado pelo valor em centavos. */
type Contagem = Record<string, string>;

/**
 * Contar a gaveta, cédula por cédula.
 *
 * Bater o caixa termina sempre no mesmo lugar: alguém com o maço na mão
 * somando de cabeça e um número escrito no campo do fechamento. A soma de
 * cabeça é onde o erro entra — e, quando o total não bate, ela se refaz
 * inteira, porque não sobrou registro de quantas notas de cinquenta havia.
 *
 * Aqui a contagem fica de pé: quantas de cada, o subtotal de cada uma, o total
 * e a distância até o que a gaveta deveria ter. E como fica escrito o que há
 * de cada valor, dar troco deixa de ser adivinhação — que é a outra metade do
 * dia de quem opera o caixa.
 */
export function CalculadoraDaGaveta({
  caixaId,
  esperado,
  onFechar,
}: {
  caixaId: number;
  /**
   * O que a gaveta deveria ter, à vista de quem conta. Só isso: a conta daqui
   * não vai para lugar nenhum, e nada aqui julga o que a pessoa contou.
   */
  esperado: number | null;
  onFechar: () => void;
}) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => lerRascunho(caixaId));
  const contagem = rascunho.contagem;

  const setContagem = (proxima: Contagem | ((c: Contagem) => Contagem)) =>
    setRascunho((atual) => ({
      contagem:
        typeof proxima === 'function' ? proxima(atual.contagem) : proxima,
      em: new Date().toISOString(),
    }));

  /*
   * Trocar de caixa recarrega a contagem daquele caixa.
   *
   * A contagem é de uma gaveta, e cada caixa tem a sua. Lendo só na montagem,
   * a da gaveta anterior ficava na tela — e o efeito abaixo a gravava por cima
   * da certa, apagando a contagem do outro caixa sem ninguém pedir.
   */
  const [caixaLido, setCaixaLido] = useState(caixaId);
  if (caixaLido !== caixaId) {
    setCaixaLido(caixaId);
    setRascunho(lerRascunho(caixaId));
  }

  /*
   * A contagem fica guardada até alguém mudá-la.
   *
   * Contar uma gaveta cheia leva minutos, e perder isso porque a tela
   * recarregou é o tipo de coisa que faz ninguém mais usar. Ela não vence: o
   * que protege de tomar a contagem de ontem por atual é a data mostrada ao
   * lado do total, e não apagá-la pelas costas de quem contou.
   */
  useEffect(() => {
    if (caixaLido !== caixaId) return;
    guardarRascunho(caixaId, contagem);
  }, [caixaId, caixaLido, contagem]);

  const totalDe = (valores: number[]) =>
    arredondar(
      valores.reduce((s, v) => s + v * (Number(contagem[chave(v)]) || 0), 0),
    );
  const emCedulas = totalDe(CEDULAS);
  const emMoedas = totalDe(MOEDAS);
  const total = arredondar(emCedulas + emMoedas);
  const contou = Object.values(contagem).some((q) => Number(q) > 0);

  return (
    <Janela titulo="Contar a gaveta" onFechar={onFechar}>
      <div className="grid gap-6 sm:grid-cols-2">
        <Grupo
          titulo="Cédulas"
          valores={CEDULAS}
          contagem={contagem}
          soma={emCedulas}
          onMudar={setContagem}
        />
        <Grupo
          titulo="Moedas"
          valores={MOEDAS}
          contagem={contagem}
          soma={emMoedas}
          onMudar={setContagem}
        />
      </div>

      {/*
        Os dois números, um ao lado do outro, e nenhuma opinião sobre eles.
        
        Isto é papel de rascunho: serve para contar o maço sem somar de cabeça
        e para saber o que há de cada valor na hora de dar troco. O saldo
        esperado aparece porque é o número que se quer ter em vista enquanto se
        conta — não porque a contagem tenha de bater com ele aqui. Quem decide
        se bate é o fechamento, no lugar dele, com a contagem que a pessoa
        escrever lá.
      */}
      <div className="mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-xl border border-tinta-200 bg-tinta-50/60 px-4 py-3">
        <div>
          <span className="rotulo mb-0">Contado na gaveta</span>
          <p className="valor text-xl">{formatBRL(total)}</p>
          {/* De quando é esta contagem.

              É o que substitui o descarte automático: a contagem guardada não
              é apagada pelas costas de quem a fez, e ninguém a toma por atual
              sem querer, porque a data está do lado do número. */}
          {contou && rascunho.em && (
            <p className="text-xs text-tinta-400">
              contado {quandoFoiContado(rascunho.em)}
            </p>
          )}
        </div>
        {esperado !== null && (
          <div className="text-right">
            <span className="rotulo mb-0">A gaveta deve ter</span>
            <p className="num text-lg text-tinta-500">{formatBRL(esperado)}</p>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {/* Limpar é o único jeito de a contagem sumir, e some de verdade: o
            guardado vai junto, senão ela voltaria no próximo F5. */}
        <button
          type="button"
          onClick={() => {
            setRascunho({ contagem: {}, em: null });
            apagarRascunho(caixaId);
          }}
          disabled={!contou}
          className="btn btn-p btn-sutil"
        >
          Limpar
        </button>
      </div>
    </Janela>
  );
}

/** Cédulas ou moedas: a mesma lista, com o subtotal do grupo embaixo. */
function Grupo({
  titulo,
  valores,
  contagem,
  soma,
  onMudar,
}: {
  titulo: string;
  valores: number[];
  contagem: Contagem;
  soma: number;
  onMudar: (f: (atual: Contagem) => Contagem) => void;
}) {
  return (
    <div>
      <p className="rotulo">{titulo}</p>
      <div className="flex flex-col gap-1.5">
        {valores.map((v) => (
          <Linha
            key={v}
            valor={v}
            qtd={contagem[chave(v)] ?? ''}
            onQtd={(q) => onMudar((atual) => ({ ...atual, [chave(v)]: q }))}
            /*
             * O passo lê a quantidade de dentro do estado, e não a que a linha
             * recebeu: dois cliques seguidos no "+" acontecem antes de a tela
             * redesenhar, e os dois partiriam do mesmo número — contando um só.
             */
            onPasso={(quantos) =>
              onMudar((atual) => ({
                ...atual,
                [chave(v)]: String(
                  Math.min(
                    MAX_POR_VALOR,
                    Math.max(0, (Number(atual[chave(v)]) || 0) + quantos),
                  ),
                ),
              }))
            }
          />
        ))}
      </div>
      <div className="mt-2 flex items-baseline justify-between border-t border-tinta-200 pt-2 text-sm">
        <span className="text-tinta-500">em {titulo.toLowerCase()}</span>
        <span className="num text-tinta-700">{formatBRL(soma)}</span>
      </div>
    </div>
  );
}

/** Nunca menos que nenhuma, nunca mais que os quatro dígitos do campo. */
const MAX_POR_VALOR = 9999;

function Linha({
  valor,
  qtd,
  onQtd,
  onPasso,
}: {
  valor: number;
  qtd: string;
  onQtd: (q: string) => void;
  onPasso: (quantos: number) => void;
}) {
  const quantas = Number(qtd) || 0;
  const subtotal = valor * quantas;

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[74px] shrink-0 text-sm font-medium text-tinta-700">
        {formatBRL(valor)}
      </span>
      {/*
        Contar é somar de um em um, e é assim que a mão faz: separa as notas de
        cinquenta em maços e vai batendo. Digitar o número serve para quem já
        contou o maço; o mais e o menos servem para quem está contando agora, e
        para corrigir sem apagar o campo inteiro.
      */}
      <Passo
        sinal="−"
        rotulo={`Menos uma de ${formatBRL(valor)}`}
        onClick={() => onPasso(-1)}
        disabled={quantas === 0}
      />
      <input
        // Só quantidade inteira entra, e o celular abre o teclado numérico.
        inputMode="numeric"
        value={qtd}
        onChange={(e) => onQtd(e.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="0"
        aria-label={`Quantas de ${formatBRL(valor)}`}
        className="campo w-14 px-1 py-1.5 text-center"
      />
      <Passo
        sinal="+"
        rotulo={`Mais uma de ${formatBRL(valor)}`}
        onClick={() => onPasso(1)}
        disabled={quantas >= MAX_POR_VALOR}
      />
      <span className="num ml-auto text-sm text-tinta-500">
        {subtotal ? formatBRL(subtotal) : '—'}
      </span>
    </div>
  );
}

/** Uma nota a mais ou a menos, do tamanho de um dedo. */
function Passo({
  sinal,
  rotulo,
  onClick,
  disabled,
}: {
  sinal: '+' | '−';
  rotulo: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={rotulo}
      title={rotulo}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-tinta-200 text-base leading-none text-tinta-600 transition hover:border-tinta-300 hover:bg-tinta-100 hover:text-tinta-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {sinal}
    </button>
  );
}

/** A chave do rascunho: o valor em centavos, para não depender de vírgula. */
function chave(valor: number): string {
  return String(Math.round(valor * 100));
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function chaveDoRascunho(caixaId: number): string {
  return `folha.gaveta.contagem.${caixaId}`;
}

function hoje(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** O rascunho guardado: a contagem e quando ela foi feita. */
interface Rascunho {
  contagem: Contagem;
  /** Quando a última cédula foi digitada. Vazio = rascunho de antes disto. */
  em: string | null;
}

/**
 * A contagem guardada daquele caixa.
 *
 * Ela não vence mais. Antes o rascunho de outro dia era descartado — a ideia
 * era boa (a contagem de ontem, aberta hoje, é um número errado com cara de
 * certo), mas o remédio jogava fora justamente o que se pediu para guardar. O
 * que resolve os dois é não apagar e **dizer de quando é**: a tela mostra a
 * data da contagem, e quem a vê decide se ainda vale.
 */
function lerRascunho(caixaId: number): Rascunho {
  const vazio: Rascunho = { contagem: {}, em: null };
  try {
    const cru = localStorage.getItem(chaveDoRascunho(caixaId));
    if (!cru) return vazio;
    const guardado = JSON.parse(cru) as {
      dia?: string;
      em?: string;
      contagem?: Contagem;
    };
    return {
      contagem: guardado.contagem ?? {},
      // `dia` é o formato antigo, que só guardava a data. Vale como data.
      em: guardado.em ?? guardado.dia ?? null,
    };
  } catch {
    // Rascunho é conveniência: se o que está guardado não se lê, começa vazio.
    return vazio;
  }
}

function guardarRascunho(caixaId: number, contagem: Contagem) {
  try {
    localStorage.setItem(
      chaveDoRascunho(caixaId),
      JSON.stringify({ em: new Date().toISOString(), contagem }),
    );
  } catch {
    // Sem espaço ou sem permissão, a contagem vale só nesta tela.
  }
}

function apagarRascunho(caixaId: number) {
  try {
    localStorage.removeItem(chaveDoRascunho(caixaId));
  } catch {
    // Não deu para apagar: o "Limpar" já zerou o que está na tela.
  }
}

/** "hoje às 14:32", "ontem às 9:05", "25/08 às 14:32". */
function quandoFoiContado(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const p = (n: number) => String(n).padStart(2, '0');
  const hora = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const dia = `${p(d.getDate())}/${p(d.getMonth() + 1)}`;

  const hojeStr = hoje();
  const daContagem = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (daContagem === hojeStr) return `hoje às ${hora}`;

  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  const ontemStr = `${ontem.getFullYear()}-${p(ontem.getMonth() + 1)}-${p(ontem.getDate())}`;
  if (daContagem === ontemStr) return `ontem às ${hora}`;

  return `${dia} às ${hora}`;
}
