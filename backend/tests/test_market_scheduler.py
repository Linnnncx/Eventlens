from scripts.market_scheduler import resolve_symbols


def test_market_warm_order_prioritizes_watchlist_then_core_then_equities():
    universe = [
        {"symbol": "AAPL", "assetType": "equity", "isCore": True},
        {"symbol": "MSFT", "assetType": "equity", "isCore": True},
        {"symbol": "NVDA", "assetType": "equity", "isCore": False},
        {"symbol": "SPY", "assetType": "etf", "isCore": False},
    ]

    assert resolve_symbols(["nvda", "AAPL"], universe, 10) == ["NVDA", "AAPL", "MSFT"]
    assert resolve_symbols(["NVDA"], universe, 2) == ["NVDA", "AAPL"]
