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
  /** Clicked price from order book → fills quick order limit */
  bookPrice: number | null;
  /** Chart-drawn price marker for one-click fill in order form */
  markedPrice: number | null;
  /** Floating quick-order box; independent of News/Trade tab */
  quickOrderOpen: boolean;
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  selectEvent: (eventId: string | null) => void;
  setRightPanel: (mode: RightPanelMode) => void;
  setTradeSide: (side: OrderSide) => void;
  openTrade: (side?: OrderSide) => void;
  openNews: (eventId?: string) => void;
  pushRecent: (symbol: string) => void;
  setBookPrice: (price: number | null) => void;
  setMarkedPrice: (price: number | null) => void;
  setQuickOrderOpen: (open: boolean) => void;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  symbol: 'AAPL',
  timeframe: '1Day',
  selectedEventId: null,
  rightPanel: 'news',
  tradeSide: 'buy',
  recentSymbols: [],
  bookPrice: null,
  markedPrice: null,
  quickOrderOpen: false,

  setSymbol: (symbol) => {
    const upper = symbol.toUpperCase();
    if (get().symbol === upper) {
      get().pushRecent(upper);
      return;
    }
    set({
      symbol: upper,
      bookPrice: null,
      markedPrice: null,
      // Entering a symbol always opens on the daily chart
      timeframe: '1Day',
    });
    get().pushRecent(upper);
  },

  setTimeframe: (timeframe) => set({ timeframe }),

  // Selecting an event must not steal the Trade tab
  selectEvent: (eventId) => set({ selectedEventId: eventId }),

  setRightPanel: (mode) => set({ rightPanel: mode }),

  setTradeSide: (side) => set({ tradeSide: side }),

  openTrade: (side) =>
    set({
      rightPanel: 'trade',
      tradeSide: side ?? get().tradeSide,
      quickOrderOpen: true,
    }),

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

  setBookPrice: (price) => set({ bookPrice: price }),

  setMarkedPrice: (price) => set({ markedPrice: price }),

  setQuickOrderOpen: (open) => set({ quickOrderOpen: open }),
}));
