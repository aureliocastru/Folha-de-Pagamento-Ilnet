import { estadoDoVeiculo, veiculoNoMapa, veiculosDosGrupos } from './frota';

describe('o estado do veículo', () => {
  it('offline, andando ou parado, pela velocidade mínima do próprio aparelho', () => {
    expect(estadoDoVeiculo({ online: 'offline', speed: 50 })).toBe('offline');
    expect(estadoDoVeiculo({ online: '', speed: 50 })).toBe('offline');
    expect(estadoDoVeiculo({ online: 'online', speed: 40, device_data: { min_moving_speed: '6' } })).toBe('movimento');
    expect(estadoDoVeiculo({ online: 'online', speed: 3, device_data: { min_moving_speed: '6' } })).toBe('parado');
    expect(estadoDoVeiculo({ online: 'ack', speed: 0 })).toBe('parado');
  });
});

describe('o veículo como o mapa o mostra', () => {
  const dispositivo = {
    id: 1024,
    name: 'Strada 01',
    online: 'online',
    speed: 30.4,
    lat: -2.53,
    lng: -44.3,
    course: '90',
    timestamp: 1762780000,
    driver: '-',
    address: '-',
    stop_duration: '0s',
    engine_status: true,
    tail: '[{"lat":"-2.52","lng":"-44.29"},{"lat":"0","lng":"0"}]',
    device_data: { plate_number: 'ABC1D23', min_moving_speed: '6' },
  };
  const vinculos = new Map([['1024', { tecnicoIxcId: 9, tecnicoNome: 'Nome antigo', equipe: 'Norte' }]]);

  it('lê o rastro em texto, e o técnico vem da ligação feita aqui', () => {
    const v = veiculoNoMapa(dispositivo, 'Ungrouped', vinculos, new Map([[9, 'Pedro Henrique']]))!;
    expect(v).toMatchObject({
      id: '1024',
      nome: 'Strada 01',
      placa: 'ABC1D23',
      grupo: null,
      velocidade: 30,
      curso: 90,
      estado: 'movimento',
      ignicao: true,
      motorista: null,
      endereco: null,
      tecnicoId: 9,
      tecnico: 'Pedro Henrique',
      equipe: 'Norte',
      rastro: [[-2.52, -44.29]],
      horario: new Date(1762780000 * 1000).toISOString(),
    });
  });

  /* O IXC fora do ar não apaga o nome de quem está no carro. */
  it('sem o IXC, fica o nome de quando a ligação foi feita', () => {
    expect(veiculoNoMapa(dispositivo, 'Técnicos', vinculos, new Map())!.tecnico).toBe('Nome antigo');
    expect(veiculoNoMapa(dispositivo, 'Técnicos', new Map(), new Map())!).toMatchObject({
      tecnicoId: null,
      tecnico: null,
      grupo: 'Técnicos',
    });
  });

  it('sem posição e sem id', () => {
    const semPosicao = veiculoNoMapa({ ...dispositivo, lat: 0, lng: 0, tail: [] }, null, new Map(), new Map())!;
    expect([semPosicao.lat, semPosicao.lng, semPosicao.rastro]).toEqual([null, null, []]);
    expect(veiculoNoMapa({ ...dispositivo, id: '' }, null, new Map(), new Map())).toBeNull();
  });

  it('o mesmo aparelho em dois grupos aparece uma vez', () => {
    const veiculos = veiculosDosGrupos(
      [
        { title: 'Técnicos', items: [dispositivo] },
        { title: 'Todos', items: [dispositivo, { ...dispositivo, id: 2048, name: 'Fiorino' }] },
        { title: 'Quebrado', items: 'não é lista' },
      ],
      new Map(),
      new Map(),
    );
    expect(veiculos.map((v) => [v.id, v.grupo])).toEqual([
      ['1024', 'Técnicos'],
      ['2048', 'Todos'],
    ]);
  });
});
