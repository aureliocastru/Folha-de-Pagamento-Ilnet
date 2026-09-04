import { CategoriaItemApr } from '@prisma/client';

/**
 * O formulário da ILNET para trabalho em altura, transcrito do papel.
 *
 * É a semente do módulo, e não a lei dele: o que está aqui entra no banco na
 * primeira vez que alguém abre a Segurança do Trabalho, e a partir daí quem
 * manda é o cadastro. Mexer num risco pela tela não volta atrás no próximo
 * boot — a semente só cria o que ainda não existe. Um item riscado da lista
 * fica riscado.
 *
 * A transcrição é literal. Três observações sobre o papel de origem, porque
 * elas explicam pequenas diferenças entre ele e esta lista:
 *
 * - A grade de riscos repete "Umidade" e "Calor" em colunas diferentes, e
 *   também traz "Quedas de altura" e "Quedas". As repetições literais entraram
 *   uma vez só; "Quedas" e "Quedas de altura" ficaram as duas, porque não são
 *   a mesma coisa (cair do poste e cair no chão).
 * - As orientações de segurança pulam do item 1 para o 3 — não há item 2 no
 *   documento. A numeração foi mantida como está: inventar um "2" seria pôr na
 *   boca da empresa uma instrução que ela não escreveu, e renumerar faria a
 *   APR nova divergir de todas as que já foram assinadas em papel.
 * - As perguntas do relato ganharam o ponto de interrogação que faltava em
 *   duas delas, e nada mais.
 */

export interface ItemSemente {
  categoria: CategoriaItemApr;
  texto: string;
  /** Marcar abre um campo de texto ("Outros, quais?"). */
  pedeDetalhe?: boolean;
  /** Só para o relato: responder "Não" obriga a dizer o que foi feito. */
  exigeProvidencia?: boolean;
  /** Já vem marcado na APR nova, para o técnico conferir em vez de marcar. */
  marcadoPorPadrao?: boolean;
}

export interface ModeloSemente {
  nome: string;
  titulo: string;
  tipoTrabalho: string;
  orientacoes: string;
  planoResgate: string;
  telefonesEmergencia: string;
  itens: ItemSemente[];
}

/** A razão social do papel, para quando a configuração ainda estiver em branco. */
export const EMPRESA_DO_PAPEL = {
  nome: 'M A CASTRO SERVIÇOS DE COMUNICAÇÃO MULTIMÍDIA LTDA',
  cnpj: '86.876.109/0001-02',
};

const NORMAS = ['NR-10', 'NR-35', 'NR-06'];

const ATIVIDADES = [
  'Construção de Rede',
  'Manutenção de Redes',
  'Ativação de Redes',
  'Lançamento de Cabos',
];

/**
 * Os riscos que a APR nova já traz marcados.
 *
 * São os do poste, e o poste é todo serviço da casa: sobe-se de escada, ao
 * lado da rede elétrica, com a chance de cair de lá e de cair no chão. Não é
 * julgamento do dia — é a condição de trabalho, e marcá-los à mão toda vez
 * gasta o único momento em que o técnico está olhando a lista.
 *
 * O que fica de fora é o que muda de serviço para serviço: vento, chuva,
 * trânsito, animais. Esses continuam sendo decisão de quem está lá.
 *
 * "Descarga elétrica" é o contato com a rede; "Descargas atmosféricas" é o
 * raio, que depende do tempo e por isso não entra aqui.
 */
const RISCOS_DE_PARTIDA = [
  'Queimaduras',
  'Choque elétrico',
  'Quedas de altura',
  'Quedas',
  'Descarga elétrica',
];

/**
 * Os riscos, na ordem em que se lê a grade do papel: linha a linha, da
 * esquerda para a direita. A ordem importa — é ela que o técnico decorou.
 */
const RISCOS = [
  'Queimaduras',
  'Colapso de estruturas',
  'Ruído',
  'Umidade',
  'Asfixia',
  'Ritmo excessivo',
  'Choque elétrico',
  'Explosões',
  'Radiação não ionizante',
  'Quedas de altura',
  'Descargas atmosféricas',
  'Tropeções',
  'Superfícies cortantes',
  'Vento forte',
  'Vibração',
  'Chuva',
  'Radiação ionizante',
  'Batida contra',
  'Queda de objetos',
  'Frio',
  'Superfícies frágeis',
  'Picada de insetos',
  'Trânsito de veículos',
  'Incêndio',
  'Prensagem de mãos e dedos',
  'Escorregões',
  'Calor',
  'Fumos metálicos',
  'Iluminação deficiente',
  'Materiais cortantes',
  'Postura inadequada',
  'Animais peçonhentos',
  'Cargas ou objetos em movimento',
  'Insolação',
  'Esmagamento/cortes',
  'Fadiga',
  'Arranjo físico inadequado',
  'Quedas',
  'Monotonia/repetividade',
  'Acesso difícil',
  'Influência externa de terceiros',
  'Manuseio manual de pesos',
  'Descarga elétrica',
  'Piso irregular',
];

const FERRAMENTAS = [
  'Alicate',
  'Maçarico',
  'OTDR',
  'Chaves de fenda, Chave Philips',
  'Vara de manobra',
  'Power meter',
  'Chave catraca',
  'Máquina de fusão',
  'Estilete',
];

/** EPI e EPC de uso obrigatório, na ordem das duas colunas do papel. */
const PROTECOES = [
  'Luva vaqueta',
  'Cordas para linha de vida',
  'Capacete com jugular',
  'Bota PVC C/L',
  'Luva isolante',
  'Escada',
  'Bota de segurança',
  'Dispositivo trava-queda',
  'Fita zebrada',
  'Cones de segurança p/ sinalização de área',
];

/** O relato situacional: as perguntas que se respondem com Sim, Não ou N.A. */
const RELATO = [
  'Área de trabalho está limpa, organizada e sinalizada?',
  'Todos os equipamentos estão inspecionados e liberados para utilização?',
  'A atividade foi comunicada da atividade desenvolvida aos órgãos responsáveis?',
  'A equipe envolvida conhece o sistema de emergência?',
  'O local foi isolado e sinalizado para limitar/impedir o acesso de pessoas e veículos ao local?',
  'As escadas utilizadas estão afastadas da rede elétrica, mantendo distância de segurança?',
  'As condições atmosféricas são favoráveis?',
  'Os executantes da tarefa estão capacitados, habilitados e autorizados para realizar a atividade de trabalho em altura?',
  'Os executantes estão em boas condições físicas e psicológicas?',
  'As escadas utilizadas estão em condições de segurança?',
  'Foram verificadas condições, estabilidade e travamento de escadas?',
  'O piso é resistente e plano, em perfeitas condições de segurança?',
  'Os equipamentos de prevenção de queda estão em perfeitas condições? (Cinto de segurança, travas quedas, cabo-guia/ponto de ancoragem, etc.)',
];

const ORIENTACOES = `1 – Verificar a OS emitida pelo setor de serviços de suporte, analisar o documento verificando se todas as informações estão dentro do escopo do trabalho a ser executado; avaliar o clima, as autorizações para trabalho em altura dos executores da atividade, preenchimento da APR, inspecionar visualmente todos os EPIs: óculos de segurança, EPCs, mosquetões, luvas, capacetes, ferramentas manuais e equipamentos de uso no exercício das atividades.

3 – Confirmar se os executantes da tarefa estão portando crachá e autorização formal para trabalho de risco (NR-10 e NR-35);

4 – Isolamento da área (obrigatório), dispor os cones de segurança em volta da área de trabalho, prender a fita zebrada em todos os cones, fechando totalmente a área de trabalho. É proibido o acesso à área cercada por pessoas não habilitadas e autorizadas, perímetro mínimo de isolamento é de 4 a 5 m.

5 – Revisão no poste para identificação de falhas (fugas de energia);

6 – Amarração da escada em poste;

7 – Acesso ao poste por escada, através da conexão do trava-quedas na corda e ao cinto de segurança antes de iniciar a subida. Subir de frente, sem pular degraus, nem suba nos dois últimos degraus superiores da escada e mantenha as duas mãos nos montantes (longarinas). Ao atingir a altura de trabalho, utilize um talabarte de posicionamento, abraçando o poste e a escada para manter as mãos livres com segurança.

8 – Quando acessar o CTO, colocar talabarte de posicionamento no poste de eletrificação, observando ponto de ancoragem ideal e instituído pela NR-35 como seguro, ou seja, acima da linha da cintura, no poste, não na escada;

9 – Pronto, agora você já poderá executar suas atividades de maneira segura, seguindo todos os parâmetros de segurança obtidos nos treinamentos, POP para trabalho de risco, Ordens de Segurança do Trabalho e Treinamentos.

– Conecte o seu trava-quedas na corda e ao cinto de segurança antes de iniciar a subida.
– Suba de frente para a escada, mantendo as duas mãos nos montantes (longarinas).
– Não pule degraus nem suba nos dois últimos degraus superiores da escada;
– Ao atingir a altura de trabalho, utilize um talabarte de posicionamento abraçando o poste e a escada para manter as mãos livres com segurança, lembrando que o ponto de ancoragem do cinto é acima da linha da cintura, no poste.`;

const PLANO_RESGATE = `Isolamento:
Em caso de contato acidental do cabo com a rede elétrica, mantenha a área isolada e afaste pessoas do local, interrompa todas as atividades e afaste curiosos do local.
– Responsável: Auxiliar de Construção e Manutenção de Redes

Comunicação:
SAMU: 192          BOMBEIROS: 193          POLÍCIA MILITAR: 190
Acione imediatamente a concessionária de energia para o seccionamento, além do resgate e socorro médico, e a empresa no telefone (99) 98476-8237. Quando o socorro se fizer presente, solicitar informações quanto ao destino do atendimento hospitalar e ficar atento sobre o que lhe é solicitado em auxílio à vítima.
– Responsável: Auxiliar de Construção e Manutenção de Redes

Ações de socorro:
– Não tente resgatar a vítima diretamente se houver risco iminente de choque elétrico;
– Até o socorro chegar, tente manter a vítima consciente;
– Não alterar a cena do acidente e relatar de forma concisa e fidedigna os dados que lhe forem solicitados.`;

/**
 * O item "Outros, quais?" da grade de riscos. Fica em separado porque é o
 * único que abre um campo de texto, e porque ele vai no fim da lista mesmo
 * quando alguém cadastrar riscos novos depois.
 */
const OUTROS_RISCOS: ItemSemente = {
  categoria: CategoriaItemApr.RISCO,
  texto: 'Outros, quais?',
  pedeDetalhe: true,
};

export const MODELO_ILNET: ModeloSemente = {
  nome: 'Trabalho em altura',
  titulo: 'ANÁLISE DE RISCO PARA TRABALHO EM ALTURA (NR-35/NR-10)',
  tipoTrabalho: 'Trabalho em altura',
  orientacoes: ORIENTACOES,
  planoResgate: PLANO_RESGATE,
  telefonesEmergencia:
    'SAMU 192 · Bombeiros 193 · Polícia Militar 190 · ILNET (99) 98476-8237',
  itens: [
    // Todas as normas: o trabalho da casa é sempre em altura, na rede, de EPI.
    // Nenhuma das três é escolha de serviço.
    ...simples(CategoriaItemApr.NORMA, NORMAS, 'todos'),
    ...simples(CategoriaItemApr.ATIVIDADE, ATIVIDADES),
    ...simples(CategoriaItemApr.RISCO, RISCOS, RISCOS_DE_PARTIDA),
    OUTROS_RISCOS,
    ...simples(CategoriaItemApr.FERRAMENTA, FERRAMENTAS),
    ...simples(CategoriaItemApr.PROTECAO, PROTECOES),
    ...simples(CategoriaItemApr.RELATO, RELATO),
  ],
};

/**
 * Uma lista de textos virando itens.
 *
 * `marcados` é quem já nasce marcado na APR nova: `'todos'` para a categoria
 * inteira, ou os textos exatos. Casar por texto é de propósito — é o que faz um
 * risco renomeado no papel deixar de vir marcado, em vez de vir marcado
 * silenciosamente com o nome errado.
 */
function simples(
  categoria: CategoriaItemApr,
  textos: readonly string[],
  marcados: readonly string[] | 'todos' = [],
): ItemSemente[] {
  return textos.map((texto) => ({
    categoria,
    texto,
    marcadoPorPadrao: marcados === 'todos' || marcados.includes(texto),
  }));
}
