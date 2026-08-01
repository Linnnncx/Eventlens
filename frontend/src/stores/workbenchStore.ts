import { create } from 'zustand';
import type { OrderSide, Timeframe } from '../types/api';

export type RightPanelMode = 'news' | 'trade';

interface WorkbenchState {
  symbol: string;
  timeframe: Timeframe;
  selectedEventId: string | null;
  rightPanel: RightPanelMode;
  tradeSide: OrderSide;
  recentSymbols: string[];
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  selectEvent: (eventId: string | null) => void;
  setRightPanel: (mode: RightPanelMode) => void;
  setTradeSide: (side: OrderSide) => void;
  openTrade: (side: OrderSide) => void;
  openNews: (eventId?: string) => void;
  pushRecent: (symbol: string) => void;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  symbol: 'AAPL',
  timeframe: '5Min',
  selectedEventId: null,
  rightPanel: 'news',
  tradeSide: 'buy',
  recentSymbols: [],

  setSymbol: (symbol) => {
    const upper = symbol.toUpperCase();
    set({ symbol: upper });
    get().pushRecent(upper);
  },

  setTimeframe: (timeframe) => set({ timeframe }),

  selectEvent: (eventId) => set({ selectedEventId: eventId, rightPanel: 'news' }),

  setRightPanel: (mode) => set({ rightPanel: mode }),

  setTradeSide: (side) => set({ tradeSide: side }),

  openTrade: (side) => set({ rightPanel: 'trade', tradeSide: side }),

  openNews: (eventId) =>
    set({
      rightPanel: 'news',
      selectedEventId: eventId ?? get().selectedEventId,
    }),

  pushRecent: (symbol) => {
    const upper = symbol.toUpperCase();
    const filtered = get().recentSymbols.filter((s) => s !== upper);
    set({ recentSymbols: [upper, ...filtered].slice(0, 12) });
  },
}));
