import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as TeclaReact,
} from 'react';
import { useLocation } from 'react-router-dom';
import { api, getToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Agenda } from '../lib/types';
import { IconeBloco } from './icones';

const CHAVE = ['agenda'] as const;

/**
 * Quanto tempo depois da última tecla o bloco se grava sozinho.
 *
 * Não há botão de salvar, e é de propósito: um bloco de notas em que se
 * precisa lembrar de salvar é um bloco de notas em que se perde recado. O
 * número é curto o bastante para o fechar da aba quase não o alcançar, e longo
 * o bastante para não mandar uma requisição por letra digitada.
 */
const ESPERA_MS = 800;

/**
 * O ponto que abre cada tarefa.
 *
 * Ele é texto, e não desenho: o bloco guarda uma string, e o dia em que
 * alguém copiar o conteúdo daqui para um e-mail ou para o WhatsApp o ponto vai
 * junto. Uma lista feita de `<li>` viraria um parágrafo emendado nessa
 * viagem.
 */
const PONTO = '• ';

/** Onde começa a linha em que o cursor está. */
function inicioDaLinha(texto: string, cursor: number): number {
  return texto.lastIndexOf('\n', cursor - 1) + 1;
}

/**
 * O bloco de notas do canto da tela.
 *
 * Mora fora das rotas, no `main.tsx`, e por isso acompanha o sistema inteiro:
 * a folha, o caixa, o RH, a segurança, a escolha de módulos e a tela do
 * técnico de campo. Ele não faz parte de tela nenhuma — é o papel que fica na
 * beirada da mesa, e a mesa é a mesma em todas elas.
 *
 * Some no login e na assinatura do recibo pelo caminho mais simples: quem não
 * entrou não tem bloco, porque o bloco é de alguém.
 *
 * E some no portal de pontos mesmo com alguém logado: aquela tela é de quem
 * digita um CPF, e o computador do escritório com o sistema aberto mostraria
 * ao funcionário que consulta os pontos o bloco de quem deixou o login ali.
 */
export function BlocoDeNotas() {
  const { usuario } = useAuth();
  const { pathname } = useLocation();
  if (!usuario || pathname.startsWith('/pontos')) return null;
  return <NoCanto />;
}

function NoCanto() {
  const [aberto, setAberto] = useState(false);
  const queryClient = useQueryClient();

  const consulta = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await api.get<Agenda>('/agenda')).data,
    staleTime: 60_000,
    /*
     * Insiste antes de desistir — a casa inteira tenta uma vez só.
     *
     * A primeira leitura deste bloco é a mais frágil do sistema: ela sai junto
     * com o carregamento da página, e depois de a máquina reiniciar ela pega o
     * servidor frio. Falhando, o bloco abria em branco e a primeira tecla
     * apagava tudo o que estava guardado (ver o `podeGravar`). Hoje o segundo
     * problema não existe mais, mas o primeiro continua sendo uma leitura que
     * vale a pena repetir: sem o texto de lá, o bloco não deixa escrever.
     */
    retry: 3,
  });

  /*
   * O que está sendo digitado agora, ou null enquanto ninguém tocou no campo.
   *
   * Esse `null` é o que resolve a briga entre o texto do servidor e o texto de
   * quem escreve: enquanto ele valer, o campo mostra o que veio do banco e
   * acompanha qualquer recarga; a partir da primeira tecla, quem manda é o
   * rascunho, e uma resposta atrasada do servidor não apaga a frase pela
   * metade que está na tela.
   */
  const [rascunho, setRascunho] = useState<string | null>(null);
  const gravado = consulta.data?.texto ?? '';
  const texto = rascunho ?? gravado;

  /*
   * O bloco só aceita escrita depois de saber o que já está guardado.
   *
   * Este é o conserto de uma perda de recado de verdade, e a ordem dos fatos
   * era esta: o bloco abre junto com a página, a leitura do servidor ainda
   * está a caminho, e até ela chegar o campo mostra vazio — porque `gravado`
   * é `''` enquanto não há resposta. O botão tem `autoFocus`, então quem
   * clicava nele já começava a digitar. Oitocentos milissegundos depois saía
   * um PUT com **só** a frase nova, por cima de tudo o que estava lá. O texto
   * antigo não sumia do banco por acaso: era esta tela que o apagava.
   *
   * A janela para isso acontecer é estreita e abre exatamente quando o
   * usuário é mais rápido que o servidor — o primeiro acesso depois de ligar a
   * máquina, com o container ainda frio. E a leitura que falha de vez (o
   * `retry` acima é novo) deixava a janela aberta para sempre: o bloco ficava
   * em branco a sessão inteira, e qualquer tecla gravava esse branco.
   *
   * `isSuccess` é a única resposta que serve. Nem "não está mais carregando"
   * nem "não deu erro": as duas valem `true` antes da primeira ida ao
   * servidor.
   */
  const carregou = consulta.isSuccess;

  // O servidor apara as pontas do texto antes de guardar. A comparação apara
  // as duas pontas também, senão o Enter no fim da última linha voltaria
  // diferente do que foi mandado, e o bloco gravaria a si mesmo sem parar.
  const porGravar =
    carregou && rascunho !== null && rascunho.trim() !== gravado.trim();

  const salvar = useMutation({
    mutationFn: async (t: string) =>
      (await api.put<Agenda>('/agenda', { texto: t })).data,
    onSuccess: (dados) => queryClient.setQueryData(CHAVE, dados),
  });

  // Em ref para o efeito da espera não reiniciar a contagem a cada render da
  // mutação — senão quem digita sem parar nunca chegaria ao fim dos 800 ms.
  const salvarRef = useRef(salvar.mutate);
  salvarRef.current = salvar.mutate;

  const pendenteRef = useRef({ porGravar, texto });
  pendenteRef.current = { porGravar, texto };

  /** Grava agora, sem esperar — ao fechar o bloco e ao sair do campo. */
  function gravarJa() {
    const { porGravar: pendente, texto: atual } = pendenteRef.current;
    if (pendente) salvarRef.current(atual);
  }

  useEffect(() => {
    if (!porGravar) return;
    const id = setTimeout(() => salvarRef.current(texto), ESPERA_MS);
    return () => clearTimeout(id);
  }, [porGravar, texto]);

  /*
   * Fechar a aba no meio da frase.
   *
   * A espera de 800 ms é curta, mas não é zero, e o que ela não alcança é
   * justamente o gesto de escrever o recado e fechar tudo em seguida. O
   * `keepalive` é o que faz o navegador terminar de mandar a requisição depois
   * de a página já ter ido embora — coisa que o axios, preso ao ciclo de vida
   * dela, não consegue prometer.
   */
  useEffect(() => {
    function aoSair() {
      const { porGravar: pendente, texto: atual } = pendenteRef.current;
      const token = getToken();
      if (!pendente || !token) return;
      void fetch(api.defaults.baseURL + '/agenda', {
        method: 'PUT',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ texto: atual }),
      }).catch(() => {
        // Sem recurso: a página está fechando. Melhor tentar e falhar calado.
      });
    }
    window.addEventListener('pagehide', aoSair);
    return () => window.removeEventListener('pagehide', aoSair);
  }, []);

  // Esc fecha, esteja o cursor onde estiver — inclusive dentro do campo.
  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const { porGravar: pendente, texto: atual } = pendenteRef.current;
      if (pendente) salvarRef.current(atual);
      setAberto(false);
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto]);

  function fechar() {
    gravarJa();
    setAberto(false);
  }

  /*
   * O ponto na frente de cada tarefa.
   *
   * Ele é posto por quem escreve, e não pelo sistema depois — daí o vaivém
   * com o cursor. Duas regras, e as duas existem para o bloco não virar uma
   * armadilha:
   *
   * - Enter numa linha que só tem o ponto apaga o ponto em vez de criar mais
   *   um. É como se acaba uma lista, e sem isso a única saída seria apagar de
   *   trás para a frente.
   * - Backspace logo depois do ponto tira o ponto inteiro, e não meio dele.
   *   Quem não quer marcação numa linha desfaz a marcação numa tecla.
   *
   * Shift+Enter continua quebrando a linha sem marcar nada: é a continuação da
   * mesma tarefa, e não a próxima.
   */
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const cursorRef = useRef<number | null>(null);

  // O cursor tem de ser reposto **depois** do render, ou o React o joga para o
  // fim do texto ao redesenhar o campo — e quem digita no meio de uma linha
  // perde o lugar a cada tecla.
  useLayoutEffect(() => {
    const onde = cursorRef.current;
    if (onde === null) return;
    cursorRef.current = null;
    campoRef.current?.setSelectionRange(onde, onde);
  });

  /*
   * Nada vira rascunho antes de o bloco abrir.
   *
   * O `readOnly` do campo já barra quem digita, e é o que a pessoa vê. Este
   * `if` barra o resto: colar, o corretor do navegador, uma extensão, um
   * teste. Sem ele, um rascunho nascido antes da leitura sobreviveria a ela —
   * e no instante em que a resposta chegasse, esse rascunho de uma palavra
   * passaria a valer contra o texto do servidor e o apagaria. Seria o mesmo
   * bug por outra porta.
   */
  function escrever(novo: string, cursor: number) {
    if (!carregou) return;
    cursorRef.current = cursor;
    setRascunho(novo);
  }

  function teclaNoCampo(e: TeclaReact<HTMLTextAreaElement>) {
    if (!carregou) return;
    const { selectionStart, selectionEnd, value } = e.currentTarget;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const comeco = inicioDaLinha(value, selectionStart);
      const soOPonto = value.slice(comeco, selectionEnd) === PONTO;
      const antes = soOPonto ? value.slice(0, comeco) : value.slice(0, selectionStart);
      const emenda = soOPonto ? '\n' : '\n' + PONTO;
      escrever(antes + emenda + value.slice(selectionEnd), antes.length + emenda.length);
      return;
    }

    if (e.key === 'Backspace' && selectionStart === selectionEnd) {
      const comeco = inicioDaLinha(value, selectionStart);
      const logoDepoisDoPonto =
        selectionStart === comeco + PONTO.length &&
        value.slice(comeco, selectionStart) === PONTO;
      if (logoDepoisDoPonto) {
        e.preventDefault();
        escrever(value.slice(0, comeco) + value.slice(selectionStart), comeco);
      }
    }
  }

  function digitou(valor: string) {
    if (!carregou) return;
    // A primeira letra do bloco em branco já nasce marcada: a primeira tarefa
    // é tarefa como as outras, e ninguém digita o ponto na mão para ela.
    if (texto.trim() === '' && valor.trim() !== '' && !valor.startsWith(PONTO)) {
      escrever(PONTO + valor, PONTO.length + valor.length);
      return;
    }
    setRascunho(valor);
  }

  const temRecado = texto.trim().length > 0;

  return (
    <>
      {/*
        No canto, encostado nas duas bordas — sem margem nenhuma. É o gesto de
        pendurar o bloco na quina do monitor: não disputa lugar com o conteúdo
        da tela e está sempre no mesmo ponto, em qualquer módulo.

        z-40 e não mais: é o mesmo nível da barra lateral, e por isso as janelas
        do sistema (z-50) passam por cima dele. Uma janela é trabalho em
        andamento — um pagamento sendo conferido —, e nada deve flutuar sobre
        ela.
      */}
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Bloco de notas"
        aria-label="Abrir o bloco de notas"
        aria-expanded={aberto}
        className="fixed right-0 top-0 z-40 flex h-11 w-11 items-center justify-center rounded-bl-xl bg-amber-400 text-amber-900 shadow-lg transition hover:bg-amber-300 md:h-9 md:w-9"
      >
        <IconeBloco
          className={`h-[17px] w-[17px] ${temRecado ? 'text-amber-950' : 'text-amber-900/55'}`}
        />
      </button>

      {aberto && (
        <>
          {/*
            Clicar fora fecha. A camada é transparente de propósito: escrever no
            bloco é quase sempre copiar algo que está na tela atrás dele — um
            valor, um nome de fornecedor —, e escurecer ou borrar o fundo
            tiraria justamente o que se foi consultar.
          */}
          <div
            onClick={fechar}
            aria-hidden
            className="fixed inset-0 z-40 cursor-default"
          />

          {/*
            Amarelo, e não a paleta do sistema.

            O resto do app é azul-tinta em qualquer tema, e o bloco tem de se
            achar de relance no meio dele — é o papel colado na quina do
            monitor, e papel colado na quina não tem a cor da parede. Por isso
            as cores aqui são fixas nos dois temas: o amarelo escurecido para
            combinar com o tema escuro deixaria de ser o bilhete e viraria mais
            um cartão do sistema.

            A moldura é que é amarela; o miolo onde se escreve é branco. Letra
            escura sobre amarelo forte não se lê, e o que importa aqui é o que
            está escrito.
          */}
          <div
            role="dialog"
            aria-label="Bloco de notas"
            className="surgir fixed right-2 top-2 z-40 flex h-[min(30rem,calc(100vh-1rem))] w-[min(23rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border-2 border-amber-400 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 bg-amber-400 py-1.5 pl-4 pr-1.5">
              <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em] text-amber-950">
                Bloco de notas
              </h2>
              {/* 44px no celular, como o X das janelas: o "×" de texto de
                  antes era um alvo de 20px na quina da tela. */}
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar"
                title="Fechar"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-amber-950 transition hover:bg-amber-500/50 active:bg-amber-500/50 md:h-9 md:w-9"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/*
              Negrito sempre, e não só no que se marca: o bloco é lido de
              passagem, com a tela cheia de outra coisa atrás dele. Um recado em
              peso de corpo de texto se perde nesse relance.
            */}
            {/*
              `readOnly` enquanto o bloco não abriu, e não `disabled`: o texto
              continua selecionável e copiável, e o campo não fica cinza — o
              que se quer dizer aqui é "espere", não "não é para você".

              A tecla que se perde nesse instante é o preço de não perder o
              recado da semana passada. Ver o `carregou`.
            */}
            <textarea
              autoFocus
              ref={campoRef}
              value={texto}
              readOnly={!carregou}
              onChange={(e) => digitou(e.target.value)}
              onKeyDown={teclaNoCampo}
              onBlur={gravarJa}
              spellCheck={false}
              placeholder={
                carregou
                  ? 'O que não pode ser esquecido.\n\n• Ligar para a contabilidade\n• Guia do INSS vence dia 20'
                  : consulta.isError
                    ? 'Não deu para abrir o bloco.\n\nO que está guardado continua lá — só não dá para escrever antes de ler.'
                    : 'Abrindo o bloco…'
              }
              className="rolagem-fina min-h-0 w-full flex-1 resize-none bg-white px-4 py-3 text-sm font-bold leading-relaxed text-slate-800 placeholder:font-semibold placeholder:text-amber-700/45 focus:outline-none"
            />

            <div className="flex items-center justify-between gap-3 border-t-2 border-amber-400 bg-amber-100 px-4 py-2 text-[11px] font-semibold text-amber-800">
              <span>Só você vê este bloco.</span>
              <Situacao
                carregou={carregou}
                naoAbriu={consulta.isError}
                aoTentarDeNovo={() => void consulta.refetch()}
                salvando={salvar.isPending}
                porGravar={porGravar}
                erro={salvar.isError}
                atualizadoEm={consulta.data?.atualizadoEm ?? null}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * O canto de baixo do bloco, onde se lê se o que está na tela já está guardado.
 *
 * Existe porque não há botão de salvar: sem esta linha, quem escreve um recado
 * e fecha a tela não tem como saber se ele foi. É a única coisa que o bloco
 * conta sobre si mesmo, e por isso ela fala do papel, e não do sistema —
 * "salvo às 10:42", e não "PUT 200".
 */
function Situacao({
  carregou,
  naoAbriu,
  aoTentarDeNovo,
  salvando,
  porGravar,
  erro,
  atualizadoEm,
}: {
  /** Já sabemos o que está guardado no servidor? Antes disso não se escreve. */
  carregou: boolean;
  naoAbriu: boolean;
  aoTentarDeNovo: () => void;
  salvando: boolean;
  porGravar: boolean;
  erro: boolean;
  atualizadoEm: string | null;
}) {
  /*
   * A leitura que falhou tem de aparecer, e com a saída junto.
   *
   * Ela era invisível: o bloco abria em branco e parecia vazio, e não havia
   * como distinguir "você não escreveu nada" de "não consegui ler o que você
   * escreveu". Era a mesma tela para as duas coisas — e a segunda é a que
   * fazia alguém redigitar o recado por cima do que já estava lá.
   */
  if (naoAbriu) {
    return (
      <span className="flex items-center gap-2">
        <span className="font-medium text-rose-500">Não deu para abrir</span>
        <button
          type="button"
          onClick={aoTentarDeNovo}
          className="rounded px-1.5 py-0.5 font-semibold text-amber-900 underline decoration-amber-700/40 underline-offset-2 transition hover:bg-amber-500/30"
        >
          tentar de novo
        </button>
      </span>
    );
  }
  if (!carregou) return <span>Abrindo…</span>;
  if (erro) {
    return (
      <span className="font-medium text-rose-500">
        Não deu para salvar — o texto continua aqui
      </span>
    );
  }
  if (salvando) return <span>Salvando…</span>;
  if (porGravar) return <span>Digitando…</span>;
  if (!atualizadoEm) return null;

  const quando = new Date(atualizadoEm);
  if (Number.isNaN(quando.getTime())) return null;
  return (
    <span>
      Salvo às{' '}
      {quando.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })}
    </span>
  );
}
