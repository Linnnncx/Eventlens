import { create } from 'zustand';
import type { PortfolioState } from '../types/api';

interface AccountState {
  portfolio: PortfolioState | null;
  lastFetchedAt: number | null;
  setPortfolio: (portfolio: PortfolioState) => void;
  clearPortfolio: () => void;
  getPosition: (symbol: string) => PortfolioState['positions'][number] | undefined;
  getCash: () => number;
  getEquity: () => number;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  portfolio: null,
  lastFetchedAt: null,

  setPortfolio: (portfolio) =>
    set({
      portfolio,
      lastFetchedAt: Date.now(),
    }),

  clearPortfolio: () =>
    set({
      portfolio: null,
      lastFetchedAt: null,
    }),

  getPosition: (symbol) => {
    const p = get().portfolio;
    if (!p) return undefined;
    return p.positions.find((pos) => pos.symbol === symbol.toUpperCase());
  },

  getCash: () => get().portfolio?.cash ?? 0,

  getEquity: () => get().portfolio?.equity ?? 0,
}));
