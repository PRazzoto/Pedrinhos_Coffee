// EDITE APENAS ESTE ARQUIVO para trocar o nome da cafeteria e as bebidas.
// Preço é opcional: null = não mostrar preço. IDs precisam ser únicos.
export const cafeName = 'OS PEDRINHOS';
const syrupOptions = { key: 'syrup', label: 'Xarope', values: ['Baunilha', 'Cumaru'] };
export const menu = [
  {
    category: 'Gelados',
    items: [
      {
        id: 'iced-latte',
        name: 'Recomendação da noiva',
        description: 'Iced latte: espresso, leite e gelo.',
        price: null,
        featured: true,
        options: [
          { key: 'temperature', label: 'Temperatura', values: ['Gelado'] },
          syrupOptions,
        ],
      },
    ],
  },
  {
    category: 'Cafés',
    items: [
      { id: 'cappuccino', name: 'Cappuccino', description: 'Cappuccino cremoso finalizado com canela.', price: null },
      {
        id: 'latte',
        name: 'Latte',
        description: 'Espresso com leite e xarope à sua escolha: Baunilha & Cumaru.',
        price: null,
        options: [
          { key: 'temperature', label: 'Temperatura', values: ['Quente', 'Gelado'] },
          syrupOptions,
        ],
      },
      { id: 'americano', name: 'Americano', description: 'Espresso diluído em água quente, para um café leve e aromático.', price: null },
      { id: 'macchiato', name: 'Macchiato', description: '60 ml · Café curto e intenso, com uma pequena quantidade de leite.', price: null },
    ],
  },
];

export const allItems = menu.flatMap((group) => group.items);
