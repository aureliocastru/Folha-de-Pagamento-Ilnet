import {
  pedacosDoNome,
  planejarLogins,
  quemTemLogin,
  type LoginExistente,
  type PessoaParaLogin,
} from './login-de-campo';

/**
 * Abrir login em lote é a hora em que dois enganos custam caro: um endereço
 * errado deixa a pessoa sem entrar, e um login repetido dá duas senhas à mesma
 * pessoa — nenhuma das duas sendo a que ela vai lembrar. O que este arquivo
 * protege, com os nomes que estão mesmo no cadastro da casa:
 *
 *  - o primeiro nome basta enquanto for de uma pessoa só;
 *  - repetido, cada um leva o segundo nome (são três Marcos, dois Luans, duas
 *    Marias e dois Antônios);
 *  - quem já tem login não ganha outro, mesmo cadastrado com o nome curto
 *    ("Marco Antonio") ou escrito de outro jeito ("Werick Coast");
 *  - acento, cedilha e as partículas do meio não entram no endereço.
 */

const pessoa = (nome: string): PessoaParaLogin => ({ id: nome, nome });

const JA_TEM: LoginExistente[] = [
  { nome: 'Adailton Vieira Pereira', email: 'adailton@ilnet.com.br' },
  { nome: 'Administrador', email: 'aureliocastru@ilnet.com.br' },
  { nome: 'Cleyson Oliveira Pereira', email: 'cleyson@ilnet.com.br' },
  { nome: 'Luzimeire', email: 'luzimeire@ilnet.com.br' },
  { nome: 'Marco Antonio', email: 'marco@ilnet.com.br' },
  { nome: 'Werick Coast', email: 'werick@ilnet.com.br' },
];

/** O endereço planejado para aquela pessoa, ou o motivo de não haver um. */
function planejar(nomes: string[]) {
  const plano = planejarLogins(nomes.map(pessoa), JA_TEM);
  return new Map(
    plano.map((p) => [p.nome, p.criar ? p.email : `— ${p.motivo}`]),
  );
}

describe('o endereço do login de campo', () => {
  it('é o primeiro nome, quando ele é de uma pessoa só', () => {
    const r = planejar([
      'Bruno Sousa de Almeida',
      'João Pedro Vasconcelos do Nascimento',
      'Renam',
    ]);

    expect(r.get('Bruno Sousa de Almeida')).toBe('bruno@ilnet.com.br');
    expect(r.get('João Pedro Vasconcelos do Nascimento')).toBe(
      'joao@ilnet.com.br',
    );
    expect(r.get('Renam')).toBe('renam@ilnet.com.br');
  });

  it('leva o segundo nome quando o primeiro é de mais de um', () => {
    const r = planejar([
      'Marco Aurelio Sousa Castro',
      'Marco Thalles da Costa e Castro',
      'Marcos Rabelo e Silva',
      'Luan Gomes Martins de Lima',
      'Luan Stefano Pereira',
      'Antonio Cassio Moraes',
      'Antônio Reis Lima dos Santos',
      'Maria Aldeide Rodrigues de Sousa',
      'Maria Angela da Conceição dos Santos',
    ]);

    expect(r.get('Marco Aurelio Sousa Castro')).toBe(
      'marco.aurelio@ilnet.com.br',
    );
    expect(r.get('Marco Thalles da Costa e Castro')).toBe(
      'marco.thalles@ilnet.com.br',
    );
    // "Marcos" não é "Marco": quem não divide o nome fica com ele inteiro.
    expect(r.get('Marcos Rabelo e Silva')).toBe('marcos@ilnet.com.br');

    expect(r.get('Luan Gomes Martins de Lima')).toBe('luan.gomes@ilnet.com.br');
    expect(r.get('Luan Stefano Pereira')).toBe('luan.stefano@ilnet.com.br');

    // O acento não separa duas pessoas: "Antonio" e "Antônio" disputam o mesmo.
    expect(r.get('Antonio Cassio Moraes')).toBe('antonio.cassio@ilnet.com.br');
    expect(r.get('Antônio Reis Lima dos Santos')).toBe(
      'antonio.reis@ilnet.com.br',
    );

    expect(r.get('Maria Aldeide Rodrigues de Sousa')).toBe(
      'maria.aldeide@ilnet.com.br',
    );
    expect(r.get('Maria Angela da Conceição dos Santos')).toBe(
      'maria.angela@ilnet.com.br',
    );
  });

  it('não abre um segundo login para quem já tem', () => {
    const r = planejar([
      'Adailton Vieira Pereira',
      'Marco Antonio Castro',
      'Luzimeire Santos Costa',
      'Werick da Cruz Costa',
    ]);

    // Nome igual, nome curto e nome escrito de outro jeito: os três casos.
    expect(r.get('Adailton Vieira Pereira')).toBe('— já tem login');
    expect(r.get('Marco Antonio Castro')).toBe('— já tem login');
    expect(r.get('Luzimeire Santos Costa')).toBe('— já tem login');
    expect(r.get('Werick da Cruz Costa')).toBe(
      '— já existe login com este endereço',
    );
  });

  it('não repete endereço entre os que estão nascendo agora', () => {
    const plano = planejarLogins(
      [pessoa('Marco Antonio Silva'), pessoa('Marco Antonio Souza')],
      [],
    );

    expect(plano.map((p) => p.email)).toEqual([
      'marco.antonio@ilnet.com.br',
      'marco.antonio.souza@ilnet.com.br',
    ]);
  });

  it('tira acento, cedilha e as partículas do meio do nome', () => {
    expect(pedacosDoNome('Marco Thalles da Costa e Castro')).toEqual([
      'marco',
      'thalles',
      'costa',
      'castro',
    ]);
    expect(pedacosDoNome('Maria Angela da Conceição dos Santos')).toEqual([
      'maria',
      'angela',
      'conceicao',
      'santos',
    ]);
  });
});

/**
 * A mesma identidade, do outro lado: a APR só mostra para escolher quem entra
 * no app, porque escolher alguém arquiva uma cópia na pasta dessa pessoa. Errar
 * aqui é esconder da equipe um colega que trabalha, ou arquivar o documento
 * numa gaveta que ninguém abre.
 */
describe('quem já entra no app', () => {
  it('mostra quem tem login e esconde quem não tem', () => {
    const equipe = [
      pessoa('Adailton Vieira Pereira'),
      pessoa('Werick da Cruz Costa'),
      pessoa('Jonas Batista de Souza'),
    ];

    const tem = quemTemLogin(equipe, JA_TEM);

    expect(tem.has('Adailton Vieira Pereira')).toBe(true);
    // "Werick Coast" e "Werick da Cruz Costa" são a mesma pessoa: o endereço
    // `werick@` é dela, e ela entra no app hoje.
    expect(tem.has('Werick da Cruz Costa')).toBe(true);
    expect(tem.has('Jonas Batista de Souza')).toBe(false);
  });

  it('reconhece quem está no cadastro com o nome curto', () => {
    // O login diz "Marco Antonio"; o cadastro, o nome inteiro.
    const tem = quemTemLogin([pessoa('Marco Antonio Castro')], JA_TEM);
    expect(tem.has('Marco Antonio Castro')).toBe(true);
  });

  it('não conta como login o nome que não vira endereço', () => {
    const tem = quemTemLogin([{ id: 'x', nome: 'de' }], JA_TEM);
    expect(tem.has('x')).toBe(false);
  });

  it('sem login nenhum aberto, não mostra ninguém', () => {
    const equipe = [pessoa('Adailton Vieira Pereira'), pessoa('Luzimeire')];
    expect(quemTemLogin(equipe, []).size).toBe(0);
  });
});
