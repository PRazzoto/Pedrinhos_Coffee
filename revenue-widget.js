import { simulateRevenue, simulationProducts } from './revenue-simulation.js';

const money = (value) => value === null ? '—' : (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const decimal = (value) => value === null ? '' : (value / 100).toFixed(2).replace('.', ',');
const count = (value) => value.toLocaleString('pt-BR');

// Parse decimal inputs directly into cents (or hundredths of a percent).
export function parseDecimal(value) {
  const match = String(value).trim().match(/^(\d{1,8})(?:[.,](\d{1,2}))?$/);
  return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null;
}

export function createRevenueWidget(root) {
  const find = (id) => root.querySelector('#' + id);
  const priceInputs = new Map();
  const costInputs = new Map();
  const productRows = new Map();
  let orders = [];
  let filters = {};
  let current = null;

  function node(tag, text) {
    const element = root.ownerDocument.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function input(label, value = '') {
    const field = node('input');
    field.type = 'text';
    field.inputMode = 'decimal';
    field.maxLength = 11;
    field.placeholder = '0,00';
    field.value = value;
    field.setAttribute('aria-label', label);
    field.addEventListener('input', render);
    return field;
  }

  function ensureRow(product) {
    if (productRows.has(product.key)) return;
    const row = node('tr');
    const label = node('th', product.name);
    label.scope = 'row';
    const quantity = node('td');
    const priceCell = node('td');
    const price = input('Preço em reais: ' + product.name, decimal(product.examplePriceCents));
    priceCell.append(price);
    const total = node('td');
    row.append(label, quantity, priceCell, total);
    find('simulation-price-rows').append(row);
    priceInputs.set(product.key, price);

    const costLabel = node('label');
    costLabel.className = 'simulation-field';
    costLabel.append(node('span', product.name));
    const cost = input('Custo por bebida em reais: ' + product.name);
    costLabel.append(cost);
    find('simulation-cost-inputs').append(costLabel);
    costInputs.set(product.key, cost);
    productRows.set(product.key, { row, quantity, total, costLabel });
  }

  function readInputs(inputs) {
    return Object.fromEntries([...inputs].map(([key, field]) => {
      const value = parseDecimal(field.value);
      field.setAttribute('aria-invalid', String(field.value.trim() !== '' && value === null));
      return [key, value];
    }));
  }

  function render() {
    try {
      const prices = readInputs(priceInputs);
      const costs = readInputs(costInputs);
      const fixedCostsCents = parseDecimal(find('simulation-fixed-cost').value);
      const feeBasisPoints = parseDecimal(find('simulation-fees').value);
      find('simulation-fixed-cost').setAttribute('aria-invalid', String(fixedCostsCents === null));
      find('simulation-fees').setAttribute('aria-invalid', String(feeBasisPoints === null || feeBasisPoints > 10000));
      current = simulateRevenue(orders, {
        ...filters, scope: find('simulation-scope').value,
        prices, costs, fixedCostsCents, feeBasisPoints,
      });
      for (const line of current.lines) ensureRow(line);
      // Rows stay mounted while typing so the caret and focus are preserved.
      const visible = new Set(current.lines.map((line) => line.key));
      for (const [key, elements] of productRows) {
        elements.row.hidden = !visible.has(key);
        elements.costLabel.hidden = !visible.has(key);
      }
      for (const line of current.lines) {
        const elements = productRows.get(line.key);
        elements.quantity.textContent = count(line.quantity);
        elements.total.textContent = line.quantity === 0 ? money(0) : money(line.revenueCents);
        elements.costLabel.hidden = line.quantity === 0;
      }
      const potential = current.scope === 'all';
      find('simulation-revenue-label').textContent = potential ? 'Receita potencial' : 'Receita simulada';
      find('simulation-revenue').textContent = money(current.revenueCents);
      find('simulation-ticket').textContent = money(current.averageOrderCents);
      find('simulation-drink').textContent = money(current.averageDrinkCents);
      const basis = potential ? 'todos os pedidos' : 'pedidos entregues';
      let coverage = count(current.quantity) + ' bebidas em ' + count(current.orderCount) + ' ' + basis + '.';
      if (!current.orderCount) coverage = 'Nenhum pedido ' + (potential ? 'registrado' : 'entregue') + ' neste filtro.';
      if (current.missingPriceQuantity) coverage += ' Informe o preço de ' + count(current.missingPriceQuantity) + ' bebidas para completar o total. Parcial com preço: ' + money(current.knownRevenueCents) + '.';
      if (current.invalidLines) coverage += ' Há ' + count(current.invalidLines) + ' registros com itens ou quantidades inválidos; o total fica indisponível.';
      find('simulation-coverage').textContent = coverage;
      find('simulation-variable-total').textContent = money(current.variableCostCents);
      find('simulation-fee-total').textContent = money(current.feeCents);
      find('simulation-balance').textContent = money(current.balanceCents);
      find('simulation-cost-status').textContent = current.missingCostQuantity
        ? 'Preencha o custo de cada bebida vendida para calcular o saldo. Use 0 se quiser assumir custo zero.'
        : current.balanceCents === null
          ? 'Complete os preços e informe despesas e taxas válidas para calcular o saldo.'
          : 'Saldo = receita − custos das bebidas − despesas do período − taxas. Inclui somente os custos que você informou; não representa lucro líquido apurado.';
    } catch (error) {
      current = null;
      for (const id of ['simulation-revenue', 'simulation-ticket', 'simulation-drink', 'simulation-variable-total', 'simulation-fee-total', 'simulation-balance']) find(id).textContent = '—';
      find('simulation-coverage').textContent = 'Não foi possível calcular este cenário. Confira os valores e as quantidades registradas.';
      console.error(error);
    }
  }

  for (const product of simulationProducts) ensureRow(product);
  find('simulation-scope').addEventListener('change', render);
  find('simulation-fixed-cost').addEventListener('input', render);
  find('simulation-fees').addEventListener('input', render);

  return {
    update(rows, options) { orders = rows; filters = options; render(); },
    csvRows() {
      if (!current) return [];
      const s = current;
      return [
        ['Simulação: premissa', 'Moeda', 'BRL'],
        ['Simulação: premissa', 'Preços', 'Exemplos editáveis; não são vendas ou pagamentos registrados'],
        ['Simulação: premissa', 'Data de criação dos pedidos', filters.date || 'all'],
        ['Simulação: premissa', 'Fuso horário', filters.timeZone || 'America/Sao_Paulo'],
        ['Simulação: premissa', 'Inclui testes', filters.includeTests ? 'Sim' : 'Não'],
        ['Simulação: premissa', 'Base', s.scope === 'all' ? 'Todos os pedidos (potencial)' : 'Pedidos entregues'],
        ['Simulação', 'Pedidos considerados', s.orderCount],
        ['Simulação', 'Bebidas consideradas', s.quantity],
        ['Simulação', 'Bebidas sem preço', s.missingPriceQuantity],
        ['Simulação', 'Bebidas sem custo', s.missingCostQuantity],
        ['Simulação', 'Registros inválidos', s.invalidLines],
        ...s.lines.flatMap((line) => [
          ['Simulação: quantidade', line.name, line.quantity],
          ['Simulação: preço unitário (R$)', line.name, decimal(line.priceCents)],
          ['Simulação: receita (R$)', line.name, line.quantity ? decimal(line.revenueCents) : '0,00'],
          ['Simulação: custo unitário (R$)', line.name, decimal(line.costCents)],
        ]),
        ['Simulação (R$)', 'Receita total', decimal(s.revenueCents)],
        ['Simulação (R$)', 'Receita parcial com preço', decimal(s.knownRevenueCents)],
        ['Simulação (R$)', 'Ticket médio por pedido', decimal(s.averageOrderCents)],
        ['Simulação (R$)', 'Valor médio por bebida', decimal(s.averageDrinkCents)],
        ['Simulação (R$)', 'Custos das bebidas', decimal(s.variableCostCents)],
        ['Simulação (R$)', 'Despesas do período', decimal(s.fixedCostsCents)],
        ['Simulação (%)', 'Taxas sobre a receita', decimal(s.feeBasisPoints)],
        ['Simulação (R$)', 'Valor das taxas', decimal(s.feeCents)],
        ['Simulação (R$)', 'Saldo após custos informados', decimal(s.balanceCents)],
        ['Simulação: premissa', 'Saldo', 'Inclui somente os custos informados; não é lucro líquido apurado'],
      ];
    },
  };
}
