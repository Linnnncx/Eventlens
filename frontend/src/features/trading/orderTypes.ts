/**
 * Stock trading order-type catalog (broker-style).
 * Used by QuickOrderBox for basic + expanded forms.
 *
 * Categories mirror Futu / Tiger / IBKR / 同花顺 style desks:
 * - basic: immediate market & limit
 * - conditional: trigger-based stops / take-profit / trail
 * - combo: multi-leg linked orders
 * - algo: time/volume slicing
 * - strategy: grid / DCA / event-linked (EventLens)
 */

export type OrderCategory = 'basic' | 'conditional' | 'combo' | 'algo' | 'strategy';

export type AdvancedOrderType =
  | 'market'
  | 'limit'
  | 'stop'
  | 'stop_limit'
  | 'trailing_stop'
  | 'take_profit'
  | 'bracket'
  | 'oco'
  | 'twap'
  | 'vwap'
  | 'iceberg'
  | 'grid'
  | 'dca'
  | 'event_trigger';

export type OrderFieldId =
  | 'side'
  | 'quantity'
  | 'notional'
  | 'limitPrice'
  | 'stopPrice'
  | 'trailAmount'
  | 'trailPercent'
  | 'takeProfitPrice'
  | 'stopLossPrice'
  | 'durationMinutes'
  | 'sliceCount'
  | 'displaySize'
  | 'gridUpper'
  | 'gridLower'
  | 'gridLevels'
  | 'dcaInterval'
  | 'dcaTimes'
  | 'eventNewsId'
  | 'timeInForce';

export interface OrderFieldDef {
  id: OrderFieldId;
  label: string;
  kind: 'number' | 'select' | 'text';
  placeholder?: string;
  step?: string;
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface OrderTypeDef {
  id: AdvancedOrderType;
  category: OrderCategory;
  label: string;
  labelEn: string;
  description: string;
  /** Fields shown beyond side + size */
  fields: OrderFieldId[];
  /** Maps to backend simulate: market | limit */
  execAs: 'market' | 'limit';
}

export const ORDER_CATEGORIES: { id: OrderCategory; label: string }[] = [
  { id: 'basic', label: '基础' },
  { id: 'conditional', label: '条件单' },
  { id: 'combo', label: '组合单' },
  { id: 'algo', label: '算法单' },
  { id: 'strategy', label: '策略单' },
];

export const ORDER_FIELDS: Record<OrderFieldId, OrderFieldDef> = {
  side: { id: 'side', label: '方向', kind: 'select' },
  quantity: { id: 'quantity', label: '数量', kind: 'number', placeholder: '股数', step: '1' },
  notional: { id: 'notional', label: '金额', kind: 'number', placeholder: 'USD', step: '0.01' },
  limitPrice: { id: 'limitPrice', label: '限价', kind: 'number', placeholder: '0.00', step: '0.01' },
  stopPrice: {
    id: 'stopPrice',
    label: '触发价',
    kind: 'number',
    placeholder: '0.00',
    step: '0.01',
    hint: '触及后触发委托',
  },
  trailAmount: {
    id: 'trailAmount',
    label: '追踪金额',
    kind: 'number',
    placeholder: 'USD',
    step: '0.01',
  },
  trailPercent: {
    id: 'trailPercent',
    label: '追踪比例 %',
    kind: 'number',
    placeholder: 'e.g. 2',
    step: '0.1',
  },
  takeProfitPrice: {
    id: 'takeProfitPrice',
    label: '止盈价',
    kind: 'number',
    placeholder: '0.00',
    step: '0.01',
  },
  stopLossPrice: {
    id: 'stopLossPrice',
    label: '止损价',
    kind: 'number',
    placeholder: '0.00',
    step: '0.01',
  },
  durationMinutes: {
    id: 'durationMinutes',
    label: '执行时长(分)',
    kind: 'number',
    placeholder: '30',
    step: '1',
  },
  sliceCount: {
    id: 'sliceCount',
    label: '拆单笔数',
    kind: 'number',
    placeholder: '10',
    step: '1',
  },
  displaySize: {
    id: 'displaySize',
    label: '冰山显示量',
    kind: 'number',
    placeholder: '可见股数',
    step: '1',
  },
  gridUpper: { id: 'gridUpper', label: '网格上限', kind: 'number', placeholder: '0.00', step: '0.01' },
  gridLower: { id: 'gridLower', label: '网格下限', kind: 'number', placeholder: '0.00', step: '0.01' },
  gridLevels: { id: 'gridLevels', label: '网格档位', kind: 'number', placeholder: '5', step: '1' },
  dcaInterval: {
    id: 'dcaInterval',
    label: '定投间隔',
    kind: 'select',
    options: [
      { value: '1d', label: '每日' },
      { value: '1w', label: '每周' },
      { value: '1m', label: '每月' },
    ],
  },
  dcaTimes: { id: 'dcaTimes', label: '定投次数', kind: 'number', placeholder: '12', step: '1' },
  eventNewsId: {
    id: 'eventNewsId',
    label: '关联事件',
    kind: 'text',
    placeholder: '当前选中新闻',
    hint: '事件触发后执行',
  },
  timeInForce: {
    id: 'timeInForce',
    label: '有效期',
    kind: 'select',
    options: [
      { value: 'day', label: '当日有效' },
      { value: 'gtc', label: '撤销前有效 GTC' },
      { value: 'ioc', label: '立即成交剩余取消 IOC' },
    ],
  },
};

export const ORDER_TYPES: OrderTypeDef[] = [
  {
    id: 'market',
    category: 'basic',
    label: '市价单',
    labelEn: 'Market',
    description: '按对手盘最优价尽快成交',
    fields: [],
    execAs: 'market',
  },
  {
    id: 'limit',
    category: 'basic',
    label: '限价单',
    labelEn: 'Limit',
    description: '指定价格或更优价格成交',
    fields: ['limitPrice', 'timeInForce'],
    execAs: 'limit',
  },
  {
    id: 'stop',
    category: 'conditional',
    label: '止损市价',
    labelEn: 'Stop',
    description: '触及触发价后转市价单',
    fields: ['stopPrice'],
    execAs: 'market',
  },
  {
    id: 'stop_limit',
    category: 'conditional',
    label: '止损限价',
    labelEn: 'Stop Limit',
    description: '触及触发价后挂限价单',
    fields: ['stopPrice', 'limitPrice'],
    execAs: 'limit',
  },
  {
    id: 'trailing_stop',
    category: 'conditional',
    label: '追踪止损',
    labelEn: 'Trailing Stop',
    description: '随行情有利方向移动止损线',
    fields: ['trailAmount', 'trailPercent'],
    execAs: 'market',
  },
  {
    id: 'take_profit',
    category: 'conditional',
    label: '止盈单',
    labelEn: 'Take Profit',
    description: '价格达到目标后平仓',
    fields: ['takeProfitPrice'],
    execAs: 'limit',
  },
  {
    id: 'bracket',
    category: 'combo',
    label: '括号单',
    labelEn: 'Bracket',
    description: '入场单 + 止盈 + 止损，联动撤销',
    fields: ['limitPrice', 'takeProfitPrice', 'stopLossPrice'],
    execAs: 'limit',
  },
  {
    id: 'oco',
    category: 'combo',
    label: 'OCO 二选一',
    labelEn: 'OCO',
    description: '止盈与止损二选一，成交一方取消另一方',
    fields: ['takeProfitPrice', 'stopLossPrice'],
    execAs: 'limit',
  },
  {
    id: 'twap',
    category: 'algo',
    label: 'TWAP',
    labelEn: 'TWAP',
    description: '按时间均匀拆单，降低冲击成本',
    fields: ['durationMinutes', 'sliceCount'],
    execAs: 'market',
  },
  {
    id: 'vwap',
    category: 'algo',
    label: 'VWAP',
    labelEn: 'VWAP',
    description: '按成交量曲线拆单，贴近均价',
    fields: ['durationMinutes', 'sliceCount'],
    execAs: 'market',
  },
  {
    id: 'iceberg',
    category: 'algo',
    label: '冰山单',
    labelEn: 'Iceberg',
    description: '只显示部分数量，隐藏真实总量',
    fields: ['limitPrice', 'displaySize'],
    execAs: 'limit',
  },
  {
    id: 'grid',
    category: 'strategy',
    label: '网格交易',
    labelEn: 'Grid',
    description: '区间内低买高卖，自动挂多档',
    fields: ['gridUpper', 'gridLower', 'gridLevels'],
    execAs: 'limit',
  },
  {
    id: 'dca',
    category: 'strategy',
    label: '定投 DCA',
    labelEn: 'DCA',
    description: '固定周期定额买入，平滑成本',
    fields: ['dcaInterval', 'dcaTimes', 'notional'],
    execAs: 'market',
  },
  {
    id: 'event_trigger',
    category: 'strategy',
    label: '事件触发',
    labelEn: 'Event Trigger',
    description: '关联新闻事件后自动下单（EventLens）',
    fields: ['eventNewsId', 'limitPrice'],
    execAs: 'limit',
  },
];

export function orderTypesByCategory(category: OrderCategory): OrderTypeDef[] {
  return ORDER_TYPES.filter((t) => t.category === category);
}

export function getOrderType(id: AdvancedOrderType): OrderTypeDef {
  return ORDER_TYPES.find((t) => t.id === id) ?? ORDER_TYPES[0]!;
}

/** Fields that accept a stock price (get 当下/标记 shortcuts + tick nudge). */
export const PRICE_FIELD_IDS: ReadonlySet<OrderFieldId> = new Set([
  'limitPrice',
  'stopPrice',
  'takeProfitPrice',
  'stopLossPrice',
  'gridUpper',
  'gridLower',
]);

export function isPriceField(id: OrderFieldId): boolean {
  return PRICE_FIELD_IDS.has(id);
}
