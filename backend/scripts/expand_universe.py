"""Expand symbol_universe.json and tag Dow / S&P / Nasdaq membership."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "symbol_universe.json"

DOW = {
    "AAPL",
    "AMGN",
    "AMZN",
    "AXP",
    "BA",
    "CAT",
    "CRM",
    "CSCO",
    "CVX",
    "DIS",
    "GOOGL",
    "GS",
    "HD",
    "HON",
    "IBM",
    "JNJ",
    "JPM",
    "KO",
    "MCD",
    "MMM",
    "MRK",
    "MSFT",
    "NKE",
    "NVDA",
    "PG",
    "SHW",
    "TRV",
    "UNH",
    "V",
    "WMT",
}

# (symbol, name, exchange, sector, industry)
EXTRA: list[tuple[str, str, str, str, str]] = [
    ("MMM", "3M Company", "NYSE", "Industrials", "Conglomerates"),
    ("SHW", "Sherwin-Williams Co.", "NYSE", "Materials", "Specialty Chemicals"),
    ("TRV", "Travelers Companies Inc.", "NYSE", "Financial Services", "Insurance"),
    ("DOW", "Dow Inc.", "NYSE", "Materials", "Chemicals"),
    ("ACN", "Accenture plc", "NYSE", "Technology", "IT Services"),
    ("ADP", "Automatic Data Processing", "NASDAQ", "Technology", "Software"),
    ("AIG", "American International Group", "NYSE", "Financial Services", "Insurance"),
    ("ALL", "Allstate Corporation", "NYSE", "Financial Services", "Insurance"),
    ("APD", "Air Products and Chemicals", "NYSE", "Materials", "Chemicals"),
    ("APH", "Amphenol Corporation", "NYSE", "Technology", "Electronic Components"),
    ("AZO", "AutoZone Inc.", "NYSE", "Consumer Cyclical", "Specialty Retail"),
    ("BBY", "Best Buy Co. Inc.", "NYSE", "Consumer Cyclical", "Specialty Retail"),
    ("BDX", "Becton Dickinson", "NYSE", "Healthcare", "Medical Instruments"),
    ("BIIB", "Biogen Inc.", "NASDAQ", "Healthcare", "Biotechnology"),
    ("BK", "Bank of New York Mellon", "NYSE", "Financial Services", "Asset Management"),
    ("BR", "Broadridge Financial Solutions", "NYSE", "Technology", "Software"),
    ("BX", "Blackstone Inc.", "NYSE", "Financial Services", "Asset Management"),
    ("CAH", "Cardinal Health Inc.", "NYSE", "Healthcare", "Medical Distribution"),
    ("CARR", "Carrier Global Corporation", "NYSE", "Industrials", "Building Products"),
    ("CCI", "Crown Castle Inc.", "NYSE", "Real Estate", "REIT"),
    ("CDW", "CDW Corporation", "NASDAQ", "Technology", "IT Services"),
    ("CEG", "Constellation Energy", "NASDAQ", "Utilities", "Independent Power"),
    ("CFG", "Citizens Financial Group", "NYSE", "Financial Services", "Banks"),
    ("CHD", "Church & Dwight", "NYSE", "Consumer Defensive", "Household Products"),
    ("CI", "Cigna Group", "NYSE", "Healthcare", "Healthcare Plans"),
    ("CL", "Colgate-Palmolive", "NYSE", "Consumer Defensive", "Household Products"),
    ("CLX", "Clorox Company", "NYSE", "Consumer Defensive", "Household Products"),
    ("CNC", "Centene Corporation", "NYSE", "Healthcare", "Healthcare Plans"),
    ("CPB", "Campbell Soup Company", "NYSE", "Consumer Defensive", "Packaged Foods"),
    ("CPRT", "Copart Inc.", "NASDAQ", "Industrials", "Specialty Business Services"),
    ("CRH", "CRH plc", "NYSE", "Materials", "Building Materials"),
    ("CSX", "CSX Corporation", "NASDAQ", "Industrials", "Railroads"),
    ("CTAS", "Cintas Corporation", "NASDAQ", "Industrials", "Specialty Business Services"),
    ("CTSH", "Cognizant Technology", "NASDAQ", "Technology", "IT Services"),
    ("CTVA", "Corteva Inc.", "NYSE", "Basic Materials", "Agricultural Inputs"),
    ("DAL", "Delta Air Lines", "NYSE", "Industrials", "Airlines"),
    ("DD", "DuPont de Nemours", "NYSE", "Materials", "Chemicals"),
    ("DFS", "Discover Financial Services", "NYSE", "Financial Services", "Credit Services"),
    ("DG", "Dollar General", "NYSE", "Consumer Defensive", "Discount Stores"),
    ("DHI", "D.R. Horton", "NYSE", "Consumer Cyclical", "Residential Construction"),
    ("DHR", "Danaher Corporation", "NYSE", "Healthcare", "Diagnostics"),
    ("DLTR", "Dollar Tree", "NASDAQ", "Consumer Defensive", "Discount Stores"),
    ("DOV", "Dover Corporation", "NYSE", "Industrials", "Specialty Industrial"),
    ("DPZ", "Dominos Pizza", "NYSE", "Consumer Cyclical", "Restaurants"),
    ("DUK", "Duke Energy", "NYSE", "Utilities", "Utilities"),
    ("DVN", "Devon Energy", "NYSE", "Energy", "Oil Gas"),
    ("EBAY", "eBay Inc.", "NASDAQ", "Consumer Cyclical", "Internet Retail"),
    ("ECL", "Ecolab Inc.", "NYSE", "Basic Materials", "Specialty Chemicals"),
    ("ED", "Consolidated Edison", "NYSE", "Utilities", "Utilities"),
    ("EFX", "Equifax Inc.", "NYSE", "Industrials", "Consulting Services"),
    ("EIX", "Edison International", "NYSE", "Utilities", "Utilities"),
    ("EL", "Estee Lauder", "NYSE", "Consumer Defensive", "Household Products"),
    ("EMR", "Emerson Electric", "NYSE", "Industrials", "Specialty Industrial"),
    ("EQIX", "Equinix Inc.", "NASDAQ", "Real Estate", "REIT"),
    ("EQT", "EQT Corporation", "NYSE", "Energy", "Oil Gas"),
    ("ES", "Eversource Energy", "NYSE", "Utilities", "Utilities"),
    ("ESS", "Essex Property Trust", "NYSE", "Real Estate", "REIT"),
    ("EW", "Edwards Lifesciences", "NYSE", "Healthcare", "Medical Devices"),
    ("EXC", "Exelon Corporation", "NASDAQ", "Utilities", "Utilities"),
    ("EXPE", "Expedia Group", "NASDAQ", "Consumer Cyclical", "Travel Services"),
    ("FANG", "Diamondback Energy", "NASDAQ", "Energy", "Oil Gas"),
    ("FAST", "Fastenal Company", "NASDAQ", "Industrials", "Industrial Distribution"),
    ("FCX", "Freeport-McMoRan", "NYSE", "Basic Materials", "Copper"),
    ("FE", "FirstEnergy Corp.", "NYSE", "Utilities", "Utilities"),
    ("FIS", "Fidelity National Information", "NYSE", "Technology", "Software"),
    ("FISV", "Fiserv Inc.", "NYSE", "Technology", "Software"),
    ("FITB", "Fifth Third Bancorp", "NASDAQ", "Financial Services", "Banks"),
    ("FSLR", "First Solar", "NASDAQ", "Technology", "Solar"),
    ("FTV", "Fortive Corporation", "NYSE", "Technology", "Scientific Instruments"),
    ("GEHC", "GE HealthCare", "NASDAQ", "Healthcare", "Health Information"),
    ("GEN", "Gen Digital", "NASDAQ", "Technology", "Software"),
    ("GIS", "General Mills", "NYSE", "Consumer Defensive", "Packaged Foods"),
    ("GLW", "Corning Inc.", "NYSE", "Technology", "Electronic Components"),
    ("GPC", "Genuine Parts", "NYSE", "Consumer Cyclical", "Specialty Retail"),
    ("GPN", "Global Payments", "NYSE", "Financial Services", "Credit Services"),
    ("GRMN", "Garmin Ltd.", "NYSE", "Technology", "Scientific Instruments"),
    ("HAL", "Halliburton", "NYSE", "Energy", "Oil Gas Equipment"),
    ("HAS", "Hasbro Inc.", "NASDAQ", "Consumer Cyclical", "Leisure"),
    ("HBAN", "Huntington Bancshares", "NASDAQ", "Financial Services", "Banks"),
    ("HCA", "HCA Healthcare", "NYSE", "Healthcare", "Medical Care"),
    ("HES", "Hess Corporation", "NYSE", "Energy", "Oil Gas"),
    ("HIG", "Hartford Financial", "NYSE", "Financial Services", "Insurance"),
    ("HLT", "Hilton Worldwide", "NYSE", "Consumer Cyclical", "Lodging"),
    ("HOLX", "Hologic Inc.", "NASDAQ", "Healthcare", "Medical Instruments"),
    ("HPQ", "HP Inc.", "NYSE", "Technology", "Computer Hardware"),
    ("HRL", "Hormel Foods", "NYSE", "Consumer Defensive", "Packaged Foods"),
    ("HSIC", "Henry Schein", "NASDAQ", "Healthcare", "Medical Distribution"),
    ("HSY", "Hershey Company", "NYSE", "Consumer Defensive", "Confectioners"),
    ("HUM", "Humana Inc.", "NYSE", "Healthcare", "Healthcare Plans"),
    ("HWM", "Howmet Aerospace", "NYSE", "Industrials", "Aerospace Defense"),
    ("IDXX", "IDEXX Laboratories", "NASDAQ", "Healthcare", "Diagnostics"),
    ("IEX", "IDEX Corporation", "NYSE", "Industrials", "Specialty Industrial"),
    ("IFF", "International Flavors", "NYSE", "Basic Materials", "Specialty Chemicals"),
    ("ILMN", "Illumina Inc.", "NASDAQ", "Healthcare", "Diagnostics"),
    ("INCY", "Incyte Corporation", "NASDAQ", "Healthcare", "Biotechnology"),
    ("IP", "International Paper", "NYSE", "Basic Materials", "Paper"),
    ("IPG", "Interpublic Group", "NYSE", "Communication Services", "Advertising"),
    ("IQV", "IQVIA Holdings", "NYSE", "Healthcare", "Diagnostics"),
    ("IR", "Ingersoll Rand", "NYSE", "Industrials", "Specialty Industrial"),
    ("IT", "Gartner Inc.", "NYSE", "Technology", "Information Services"),
    ("ITW", "Illinois Tool Works", "NYSE", "Industrials", "Specialty Industrial"),
    ("IVZ", "Invesco Ltd.", "NYSE", "Financial Services", "Asset Management"),
    ("JBHT", "J.B. Hunt Transport", "NASDAQ", "Industrials", "Trucking"),
    ("JBL", "Jabil Inc.", "NYSE", "Technology", "Electronic Components"),
    ("JCI", "Johnson Controls", "NYSE", "Industrials", "Building Products"),
    ("JKHY", "Jack Henry Associates", "NASDAQ", "Technology", "Software"),
    ("K", "Kellanova", "NYSE", "Consumer Defensive", "Packaged Foods"),
    ("KEY", "KeyCorp", "NYSE", "Financial Services", "Banks"),
    ("KEYS", "Keysight Technologies", "NYSE", "Technology", "Scientific Instruments"),
    ("KHC", "Kraft Heinz", "NASDAQ", "Consumer Defensive", "Packaged Foods"),
    ("KMB", "Kimberly-Clark", "NYSE", "Consumer Defensive", "Household Products"),
    ("KMX", "CarMax Inc.", "NYSE", "Consumer Cyclical", "Auto Dealerships"),
    ("KR", "Kroger Co.", "NYSE", "Consumer Defensive", "Grocery Stores"),
    ("L", "Loews Corporation", "NYSE", "Financial Services", "Insurance"),
    ("LEN", "Lennar Corporation", "NYSE", "Consumer Cyclical", "Residential Construction"),
    ("LH", "Labcorp Holdings", "NYSE", "Healthcare", "Diagnostics"),
    ("LHX", "L3Harris Technologies", "NYSE", "Industrials", "Aerospace Defense"),
    ("LIN", "Linde plc", "NASDAQ", "Basic Materials", "Specialty Chemicals"),
    ("LKQ", "LKQ Corporation", "NASDAQ", "Consumer Cyclical", "Auto Parts"),
    ("LNT", "Alliant Energy", "NASDAQ", "Utilities", "Utilities"),
    ("LVS", "Las Vegas Sands", "NYSE", "Consumer Cyclical", "Resorts Casinos"),
    ("LW", "Lamb Weston", "NYSE", "Consumer Defensive", "Packaged Foods"),
    ("LYB", "LyondellBasell", "NYSE", "Basic Materials", "Chemicals"),
    ("LYV", "Live Nation Entertainment", "NYSE", "Communication Services", "Entertainment"),
    ("MAS", "Masco Corporation", "NYSE", "Industrials", "Building Products"),
    ("MCHP", "Microchip Technology", "NASDAQ", "Technology", "Semiconductors"),
    ("MCK", "McKesson Corporation", "NYSE", "Healthcare", "Medical Distribution"),
    ("MCO", "Moodys Corporation", "NYSE", "Financial Services", "Financial Data"),
    ("MET", "MetLife Inc.", "NYSE", "Financial Services", "Insurance"),
    ("MGM", "MGM Resorts", "NYSE", "Consumer Cyclical", "Resorts Casinos"),
    ("MHK", "Mohawk Industries", "NYSE", "Consumer Cyclical", "Furnishings"),
    ("MKC", "McCormick Company", "NYSE", "Consumer Defensive", "Packaged Foods"),
    ("MLM", "Martin Marietta Materials", "NYSE", "Basic Materials", "Building Materials"),
    ("MMC", "Marsh McLennan", "NYSE", "Financial Services", "Insurance Brokers"),
    ("MNST", "Monster Beverage", "NASDAQ", "Consumer Defensive", "Beverages"),
    ("MO", "Altria Group", "NYSE", "Consumer Defensive", "Tobacco"),
    ("MOS", "Mosaic Company", "NYSE", "Basic Materials", "Agricultural Inputs"),
    ("MPWR", "Monolithic Power Systems", "NASDAQ", "Technology", "Semiconductors"),
    ("MSCI", "MSCI Inc.", "NYSE", "Financial Services", "Financial Data"),
    ("MSI", "Motorola Solutions", "NYSE", "Technology", "Communication Equipment"),
    ("MTB", "MT Bank", "NYSE", "Financial Services", "Banks"),
    ("MTCH", "Match Group", "NASDAQ", "Communication Services", "Internet Content"),
    ("MTD", "Mettler-Toledo", "NYSE", "Healthcare", "Diagnostics"),
    ("NDAQ", "Nasdaq Inc.", "NASDAQ", "Financial Services", "Financial Data"),
    ("NEE", "NextEra Energy", "NYSE", "Utilities", "Utilities"),
    ("NEM", "Newmont Corporation", "NYSE", "Basic Materials", "Gold"),
    ("NI", "NiSource Inc.", "NYSE", "Utilities", "Utilities"),
    ("NSC", "Norfolk Southern", "NYSE", "Industrials", "Railroads"),
    ("NTAP", "NetApp Inc.", "NASDAQ", "Technology", "Computer Hardware"),
    ("NTRS", "Northern Trust", "NASDAQ", "Financial Services", "Asset Management"),
    ("NUE", "Nucor Corporation", "NYSE", "Basic Materials", "Steel"),
    ("NVR", "NVR Inc.", "NYSE", "Consumer Cyclical", "Residential Construction"),
    ("NXPI", "NXP Semiconductors", "NASDAQ", "Technology", "Semiconductors"),
    ("ODFL", "Old Dominion Freight", "NASDAQ", "Industrials", "Trucking"),
    ("OKE", "ONEOK Inc.", "NYSE", "Energy", "Oil Gas Midstream"),
    ("OMC", "Omnicom Group", "NYSE", "Communication Services", "Advertising"),
    ("ORLY", "OReilly Automotive", "NASDAQ", "Consumer Cyclical", "Specialty Retail"),
    ("OTIS", "Otis Worldwide", "NYSE", "Industrials", "Specialty Industrial"),
    ("PAYX", "Paychex Inc.", "NASDAQ", "Technology", "Software"),
    ("PCAR", "PACCAR Inc.", "NASDAQ", "Industrials", "Farm Heavy Machinery"),
    ("PCG", "PGE Corporation", "NYSE", "Utilities", "Utilities"),
    ("PEG", "Public Service Enterprise", "NYSE", "Utilities", "Utilities"),
    ("PFG", "Principal Financial", "NASDAQ", "Financial Services", "Insurance"),
    ("PHM", "PulteGroup", "NYSE", "Consumer Cyclical", "Residential Construction"),
    ("PKG", "Packaging Corp of America", "NYSE", "Consumer Cyclical", "Packaging"),
    ("PLD", "Prologis Inc.", "NYSE", "Real Estate", "REIT"),
    ("PM", "Philip Morris International", "NYSE", "Consumer Defensive", "Tobacco"),
    ("PNC", "PNC Financial Services", "NYSE", "Financial Services", "Banks"),
    ("PNR", "Pentair plc", "NYSE", "Industrials", "Specialty Industrial"),
    ("PNW", "Pinnacle West Capital", "NYSE", "Utilities", "Utilities"),
    ("POOL", "Pool Corporation", "NASDAQ", "Consumer Cyclical", "Leisure"),
    ("PPG", "PPG Industries", "NYSE", "Basic Materials", "Specialty Chemicals"),
    ("PPL", "PPL Corporation", "NYSE", "Utilities", "Utilities"),
    ("PRU", "Prudential Financial", "NYSE", "Financial Services", "Insurance"),
    ("PSA", "Public Storage", "NYSE", "Real Estate", "REIT"),
    ("PTC", "PTC Inc.", "NASDAQ", "Technology", "Software"),
    ("PVH", "PVH Corp.", "NYSE", "Consumer Cyclical", "Apparel"),
    ("PWR", "Quanta Services", "NYSE", "Industrials", "Engineering"),
    ("RCL", "Royal Caribbean", "NYSE", "Consumer Cyclical", "Travel Services"),
    ("RF", "Regions Financial", "NYSE", "Financial Services", "Banks"),
    ("RJF", "Raymond James Financial", "NYSE", "Financial Services", "Capital Markets"),
    ("RL", "Ralph Lauren", "NYSE", "Consumer Cyclical", "Apparel"),
    ("RMD", "ResMed Inc.", "NYSE", "Healthcare", "Medical Devices"),
    ("ROK", "Rockwell Automation", "NYSE", "Industrials", "Specialty Industrial"),
    ("ROL", "Rollins Inc.", "NYSE", "Consumer Cyclical", "Personal Services"),
    ("ROP", "Roper Technologies", "NASDAQ", "Technology", "Software"),
    ("ROST", "Ross Stores", "NASDAQ", "Consumer Cyclical", "Apparel Retail"),
    ("RSG", "Republic Services", "NYSE", "Industrials", "Waste Management"),
    ("SBAC", "SBA Communications", "NASDAQ", "Real Estate", "REIT"),
    ("SJM", "J.M. Smucker", "NYSE", "Consumer Defensive", "Packaged Foods"),
    ("SNA", "Snap-on Inc.", "NYSE", "Industrials", "Tools"),
    ("SO", "Southern Company", "NYSE", "Utilities", "Utilities"),
    ("SPG", "Simon Property Group", "NYSE", "Real Estate", "REIT"),
    ("SRE", "Sempra", "NYSE", "Utilities", "Utilities"),
    ("STE", "STERIS plc", "NYSE", "Healthcare", "Medical Instruments"),
    ("STT", "State Street", "NYSE", "Financial Services", "Asset Management"),
    ("STX", "Seagate Technology", "NASDAQ", "Technology", "Computer Hardware"),
    ("STZ", "Constellation Brands", "NYSE", "Consumer Defensive", "Beverages"),
    ("SWK", "Stanley Black Decker", "NYSE", "Industrials", "Tools"),
    ("SWKS", "Skyworks Solutions", "NASDAQ", "Technology", "Semiconductors"),
    ("SYF", "Synchrony Financial", "NYSE", "Financial Services", "Credit Services"),
    ("SYY", "Sysco Corporation", "NYSE", "Consumer Defensive", "Food Distribution"),
    ("TAP", "Molson Coors", "NYSE", "Consumer Defensive", "Beverages"),
    ("TDY", "Teledyne Technologies", "NYSE", "Technology", "Scientific Instruments"),
    ("TEL", "TE Connectivity", "NYSE", "Technology", "Electronic Components"),
    ("TER", "Teradyne Inc.", "NASDAQ", "Technology", "Semiconductors"),
    ("TFC", "Truist Financial", "NYSE", "Financial Services", "Banks"),
    ("TFX", "Teleflex Inc.", "NYSE", "Healthcare", "Medical Instruments"),
    ("TPR", "Tapestry Inc.", "NYSE", "Consumer Cyclical", "Luxury Goods"),
    ("TRMB", "Trimble Inc.", "NASDAQ", "Technology", "Scientific Instruments"),
    ("TROW", "T. Rowe Price", "NASDAQ", "Financial Services", "Asset Management"),
    ("TSCO", "Tractor Supply", "NASDAQ", "Consumer Cyclical", "Specialty Retail"),
    ("TT", "Trane Technologies", "NYSE", "Industrials", "Building Products"),
    ("TTD", "The Trade Desk", "NASDAQ", "Communication Services", "Advertising"),
    ("TXT", "Textron Inc.", "NYSE", "Industrials", "Aerospace Defense"),
    ("TYL", "Tyler Technologies", "NYSE", "Technology", "Software"),
    ("UAL", "United Airlines", "NASDAQ", "Industrials", "Airlines"),
    ("UDR", "UDR Inc.", "NYSE", "Real Estate", "REIT"),
    ("UHS", "Universal Health Services", "NYSE", "Healthcare", "Medical Care"),
    ("ULTA", "Ulta Beauty", "NASDAQ", "Consumer Cyclical", "Specialty Retail"),
    ("URI", "United Rentals", "NYSE", "Industrials", "Rental Leasing"),
    ("USB", "U.S. Bancorp", "NYSE", "Financial Services", "Banks"),
    ("VFC", "VF Corporation", "NYSE", "Consumer Cyclical", "Apparel"),
    ("VICI", "VICI Properties", "NYSE", "Real Estate", "REIT"),
    ("VMC", "Vulcan Materials", "NYSE", "Basic Materials", "Building Materials"),
    ("VRSK", "Verisk Analytics", "NASDAQ", "Industrials", "Consulting Services"),
    ("VRSN", "VeriSign Inc.", "NASDAQ", "Technology", "Software"),
    ("VST", "Vistra Corp.", "NYSE", "Utilities", "Independent Power"),
    ("VTRS", "Viatris Inc.", "NASDAQ", "Healthcare", "Drug Manufacturers"),
    ("WAB", "Wabtec Corporation", "NYSE", "Industrials", "Railroads"),
    ("WAT", "Waters Corporation", "NYSE", "Healthcare", "Diagnostics"),
    ("WBA", "Walgreens Boots Alliance", "NASDAQ", "Healthcare", "Pharmaceutical Retail"),
    ("WDC", "Western Digital", "NASDAQ", "Technology", "Computer Hardware"),
    ("WEC", "WEC Energy Group", "NYSE", "Utilities", "Utilities"),
    ("WELL", "Welltower Inc.", "NYSE", "Real Estate", "REIT"),
    ("WM", "Waste Management", "NYSE", "Industrials", "Waste Management"),
    ("WRB", "W. R. Berkley", "NYSE", "Financial Services", "Insurance"),
    ("WST", "West Pharmaceutical", "NYSE", "Healthcare", "Medical Instruments"),
    ("WTW", "Willis Towers Watson", "NASDAQ", "Financial Services", "Insurance Brokers"),
    ("WY", "Weyerhaeuser", "NYSE", "Real Estate", "REIT"),
    ("WYNN", "Wynn Resorts", "NASDAQ", "Consumer Cyclical", "Resorts Casinos"),
    ("XEL", "Xcel Energy", "NASDAQ", "Utilities", "Utilities"),
    ("XYL", "Xylem Inc.", "NYSE", "Industrials", "Specialty Industrial"),
    ("YUM", "Yum Brands", "NYSE", "Consumer Cyclical", "Restaurants"),
    ("ZBH", "Zimmer Biomet", "NYSE", "Healthcare", "Medical Devices"),
    ("ZBRA", "Zebra Technologies", "NASDAQ", "Technology", "Communication Equipment"),
    ("ZTS", "Zoetis Inc.", "NYSE", "Healthcare", "Drug Manufacturers"),
    ("SOFI", "SoFi Technologies", "NASDAQ", "Financial Services", "Credit Services"),
    ("DKNG", "DraftKings Inc.", "NASDAQ", "Consumer Cyclical", "Gambling"),
    ("AFRM", "Affirm Holdings", "NASDAQ", "Technology", "Software"),
    ("UPST", "Upstart Holdings", "NASDAQ", "Financial Services", "Credit Services"),
    ("PATH", "UiPath Inc.", "NYSE", "Technology", "Software"),
    ("U", "Unity Software", "NYSE", "Technology", "Software"),
    ("CART", "Maplebear Inc.", "NASDAQ", "Consumer Cyclical", "Internet Retail"),
    ("CVNA", "Carvana Co.", "NYSE", "Consumer Cyclical", "Auto Dealerships"),
    ("TOST", "Toast Inc.", "NYSE", "Technology", "Software"),
    ("DUOL", "Duolingo Inc.", "NASDAQ", "Technology", "Software"),
    ("CELH", "Celsius Holdings", "NASDAQ", "Consumer Defensive", "Beverages"),
    ("HIMS", "Hims Hers Health", "NYSE", "Healthcare", "Medical Care"),
    ("OSCR", "Oscar Health", "NYSE", "Healthcare", "Healthcare Plans"),
    ("SOUN", "SoundHound AI", "NASDAQ", "Technology", "Software"),
    ("IONQ", "IonQ Inc.", "NYSE", "Technology", "Computer Hardware"),
    ("RGTI", "Rigetti Computing", "NASDAQ", "Technology", "Computer Hardware"),
    ("ASTS", "AST SpaceMobile", "NASDAQ", "Communication Services", "Telecom"),
    ("RKLB", "Rocket Lab", "NASDAQ", "Industrials", "Aerospace Defense"),
    ("JOBY", "Joby Aviation", "NYSE", "Industrials", "Aerospace Defense"),
    ("ACHR", "Archer Aviation", "NYSE", "Industrials", "Aerospace Defense"),
]


def main() -> None:
    rows = json.loads(PATH.read_text(encoding="utf-8"))
    by_sym = {r["symbol"].upper(): r for r in rows}

    added = 0
    for sym, name, exch, sector, industry in EXTRA:
        sym = sym.upper()
        if sym in by_sym:
            continue
        by_sym[sym] = {
            "symbol": sym,
            "companyName": name,
            "exchange": exch,
            "sector": sector,
            "industry": industry,
            "assetType": "equity",
            "isCore": False,
            "searchKeywords": f"{name.lower()} {sym.lower()}",
        }
        added += 1

    for sym, row in by_sym.items():
        tags: set[str] = set(row.get("indices") or [])
        if row.get("assetType") == "equity":
            if row.get("isCore"):
                tags.add("SPX")
            if row.get("exchange") == "NASDAQ":
                tags.add("IXIC")
            # Liquid large names we just added: treat as SPX-filterable
            if sym in {e[0] for e in EXTRA}:
                tags.add("SPX")
        if tags:
            row["indices"] = sorted(tags)

    missing_dow: list[str] = []
    for sym in sorted(DOW):
        if sym not in by_sym:
            missing_dow.append(sym)
            continue
        tags = set(by_sym[sym].get("indices") or [])
        tags.update({"DJI", "SPX"})
        if by_sym[sym].get("exchange") == "NASDAQ":
            tags.add("IXIC")
        by_sym[sym]["indices"] = sorted(tags)

    ordered: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        s = r["symbol"].upper()
        ordered.append(by_sym[s])
        seen.add(s)
    for s, r in by_sym.items():
        if s not in seen:
            ordered.append(r)
            seen.add(s)

    PATH.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    eq = sum(1 for r in ordered if r.get("assetType") == "equity")
    etf = sum(1 for r in ordered if r.get("assetType") == "etf")
    dji = sum(1 for r in ordered if "DJI" in (r.get("indices") or []))
    spx = sum(1 for r in ordered if "SPX" in (r.get("indices") or []))
    ixic = sum(1 for r in ordered if "IXIC" in (r.get("indices") or []))
    print(f"total={len(ordered)} equity={eq} etf={etf} added={added}")
    print(f"DJI={dji} SPX={spx} IXIC={ixic} missing_dow={missing_dow}")


if __name__ == "__main__":
    main()
