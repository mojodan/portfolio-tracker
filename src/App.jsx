import { useEffect, useMemo, useState } from 'react';
import { csvToObjects, num } from './lib/csv.js';

function objectsToCsv(headers, rows) {
  const esc = v => {
    if (v == null || v === '') return '';
    const s = String(v);
    return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.join(','), ...rows.map(row => headers.map(h => esc(row[h])).join(','))].join('\n');
}

function portfolioRowsToCsv(rows) {
  const H = ['Symbol', 'Exchange', 'Company', 'Brokerage', 'Shares', 'Avg Cost', 'Total Cost', 'Cur. Price', 'Mkt Value', 'Sector', 'Notes', 'Date In'];
  return objectsToCsv(H, rows.map(r => ({
    Symbol: r.symbol ?? '', Exchange: r.exchange ?? '', Company: r.name ?? '', Brokerage: r.brokerage ?? '',
    Shares: r.isCash ? '' : (r.shares ?? ''), 'Avg Cost': r.isCash ? '' : (r.avgCost ?? ''),
    'Total Cost': r.totalCost ?? '', 'Cur. Price': r.isCash ? '' : (r.price ?? ''),
    'Mkt Value': r.marketValue ?? '', Sector: r.sector ?? '', Notes: r.notes ?? '', 'Date In': r.dateIn ?? ''
  })));
}

function realizedRowsToCsv(rows) {
  const H = ['Date In', 'Date Out', 'Symbol', 'Exchange', 'Company', 'Brokerage', 'Shares', 'Avg Cost', 'Total Cost', 'Avg Sell', 'Total Inflow', 'Gain / Loss', 'G/L %', 'Sector', 'Notes'];
  return objectsToCsv(H, rows.map(r => ({
    'Date In': r.dateIn ?? '', 'Date Out': r.dateOut ?? '', Symbol: r.symbol ?? '', Exchange: r.exchange ?? '',
    Company: r.name ?? '', Brokerage: r.brokerage ?? '', Shares: r.shares ?? '',
    'Avg Cost': r.avgCost ?? '', 'Total Cost': r.totalCost ?? '', 'Avg Sell': r.avgSell ?? '',
    'Total Inflow': r.totalInflow ?? '', 'Gain / Loss': r.gainLoss ?? '', 'G/L %': r.gainLossPct ?? '',
    Sector: r.sector ?? '', Notes: r.notes ?? ''
  })));
}

const fmt$ = v => v == null || v === '' ? '—' :
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtN = v => v == null || v === '' ? '—' :
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(v);
const fmtGainPct = v => v == null || v === '' ? '' :
  (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

function parsePortfolio(raw) {
  return raw.map((r, i) => {
    const isCash = r['Symbol'] === 'CASH';
    const shares = num(r['Shares']);
    const avgCost = num(r['Avg Cost']);
    const price = num(r['Cur. Price']);
    const storedTotalCost = num(r['Total Cost']);
    const storedMktValue = num(r['Mkt Value']);
    const totalCost = storedTotalCost ?? (shares != null && avgCost != null ? shares * avgCost : null);
    const marketValue = storedMktValue ?? (shares != null && price != null ? shares * price : null);
    const gainLoss = (marketValue != null && totalCost != null && !isCash) ? marketValue - totalCost : (isCash ? 0 : null);
    const gainLossPct = (gainLoss != null && totalCost && totalCost > 0 && !isCash) ? (gainLoss / totalCost) * 100 : (isCash ? 0 : null);
    return {
      id: i,
      symbol: r['Symbol'],
      exchange: r['Exchange'],
      name: r['Company'],
      brokerage: r['Brokerage'],
      shares, avgCost, price,
      totalCost, marketValue,
      gainLoss, gainLossPct,
      dayChangePct: null,
      sector: r['Sector'],
      notes: r['Notes'],
      dateIn: r['Date In'] || null,
      isCash
    };
  });
}

function parseRealized(raw) {
  return raw.map((r, i) => {
    const shares = num(r['Shares']);
    const avgCost = num(r['Avg Cost']);
    const avgSell = num(r['Avg Sell']);
    const totalCost = num(r['Total Cost']) ?? (shares != null && avgCost != null ? shares * avgCost : null);
    const totalInflow = num(r['Total Inflow']) ?? (shares != null && avgSell != null ? shares * avgSell : null);
    const gainLoss = num(r['Gain / Loss']) ?? (totalInflow != null && totalCost != null ? totalInflow - totalCost : null);
    const gainLossPct = num(r['G/L %']) ?? (gainLoss != null && totalCost && totalCost > 0 ? (gainLoss / totalCost) * 100 : null);
    return {
      id: i,
      dateIn: r['Date In'] || null,
      dateOut: r['Date Out'] || null,
      symbol: r['Symbol'],
      exchange: r['Exchange'],
      name: r['Company'],
      brokerage: r['Brokerage'],
      shares, avgCost, avgSell,
      totalCost, totalInflow,
      gainLoss, gainLossPct,
      sector: r['Sector'],
      notes: r['Notes']
    };
  });
}

function GainBadge({ value, pct, showPct }) {
  if (value == null) return <span className="gain-badge zero">—</span>;
  const cls = value > 0 ? 'pos' : value < 0 ? 'neg' : 'zero';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return <span className={`gain-badge ${cls}`}>{arrow} {showPct ? fmtGainPct(pct) : fmt$(value)}</span>;
}

function SummaryCard({ label, value, sub, subClass }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value}</div>
      {sub && <div className={`summary-sub ${subClass || ''}`}>{sub}</div>}
    </div>
  );
}

function SortableTh({ label, col, align = 'right', sortCol, sortDir, onSort, width }) {
  const sorted = sortCol === col;
  return (
    <th style={{ textAlign: align, ...(width ? { width } : {}) }} className={sorted ? 'sorted' : ''} onClick={() => onSort(col)}>
      {label}
      <span className="sort-icon">{sorted ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </th>
  );
}

function PortfolioTable({ rows, onEdit, onClose, onDelete }) {
  const [sortCol, setSortCol] = useState('symbol');
  const [sortDir, setSortDir] = useState('asc');
  const [search, setSearch] = useState('');
  const [filterSector, setFilterSector] = useState('');
  const [filterBrokerage, setFilterBrokerage] = useState('');

  const sectors = useMemo(() => [...new Set(rows.map(r => r.sector).filter(Boolean))].sort(), [rows]);
  const brokerages = useMemo(() => [...new Set(rows.map(r => r.brokerage).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    let d = rows;
    if (search) {
      const q = search.toLowerCase();
      d = d.filter(r => [r.symbol, r.name, r.brokerage, r.sector, r.notes].some(v => v && v.toLowerCase().includes(q)));
    }
    if (filterSector) d = d.filter(r => r.sector === filterSector);
    if (filterBrokerage) d = d.filter(r => r.brokerage === filterBrokerage);
    return d;
  }, [rows, search, filterSector, filterBrokerage]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (a.isCash) return 1;
    if (b.isCash) return -1;
    let av = a[sortCol], bv = b[sortCol];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
  }), [filtered, sortCol, sortDir]);

  const totals = useMemo(() => {
    const mv = rows.reduce((s, r) => s + (r.marketValue || 0), 0);
    const tc = rows.reduce((s, r) => s + (r.totalCost || 0), 0);
    const gl = mv - tc;
    const glPct = tc > 0 ? (gl / tc) * 100 : 0;
    return { mv, tc, gl, glPct };
  }, [rows]);

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const Th = (label, col, align = 'right') => (
    <SortableTh label={label} col={col} align={align} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
  );

  return (
    <>
      <div className="table-toolbar">
        <div className="toolbar-left">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input className="search-input" placeholder="Search holdings…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="filter-select" value={filterSector} onChange={e => setFilterSector(e.target.value)}>
            <option value="">All Sectors</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="filter-select" value={filterBrokerage} onChange={e => setFilterBrokerage(e.target.value)}>
            <option value="">All Brokerages</option>
            {brokerages.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>
            {Th('Symbol', 'symbol', 'left')}
            {Th('Exchange', 'exchange', 'left')}
            {Th('Company', 'name', 'left')}
            {Th('Brokerage', 'brokerage', 'left')}
            {Th('Shares', 'shares')}
            {Th('Avg Cost', 'avgCost')}
            {Th('Total Cost', 'totalCost')}
            {Th('Cur. Price', 'price')}
            {Th('Mkt Value', 'marketValue')}
            {Th('Gain / Loss', 'gainLoss')}
            {Th('G/L %', 'gainLossPct')}
            {Th('1-Day G/L %', 'dayChangePct')}
            {Th('Sector', 'sector', 'left')}
            <th style={{ textAlign: 'left' }}>Notes</th>
            {Th('Date In', 'dateIn', 'left')}
            <th style={{ textAlign: 'center', width: 110 }}>Actions</th>
          </tr></thead>
          <tbody>
            {sorted.map(row => {
              const cash = row.isCash;
              return (
                <tr key={row.id} className={cash ? 'cash-row' : ''}>
                  <td className="text-col"><span className={`symbol-badge ${cash ? 'cash-badge' : ''}`}>{row.symbol}</span></td>
                  <td className="text-col"><span className="exchange-tag">{row.exchange}</span></td>
                  <td className="text-col" style={{ maxWidth: 200 }}><span style={{ fontSize: 13 }}>{row.name}</span></td>
                  <td className="text-col"><span style={{ fontSize: 12, color: 'var(--slate)' }}>{row.brokerage}</span></td>
                  <td style={{ textAlign: 'right' }}>{cash ? '—' : fmtN(row.shares)}</td>
                  <td style={{ textAlign: 'right' }}>{cash ? '—' : fmt$(row.avgCost)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt$(row.totalCost)}</td>
                  <td style={{ textAlign: 'right' }}>{cash ? '—' : fmt$(row.price)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 400 }}>{fmt$(row.marketValue)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {cash ? '—' : <GainBadge value={row.gainLoss} pct={row.gainLossPct} showPct={false} />}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {cash ? '—' : <GainBadge value={row.gainLoss} pct={row.gainLossPct} showPct={true} />}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {cash || row.dayChangePct == null ? '—' : <GainBadge value={row.dayChangePct} pct={row.dayChangePct} showPct={true} />}
                  </td>
                  <td className="text-col"><span className="sector-pill">{row.sector}</span></td>
                  <td className="text-col"><span className="notes-text">{row.notes || <span style={{ opacity: 0.3 }}>—</span>}</span></td>
                  <td className="text-col">
                    {row.dateIn ? <span className="date-text">{fmtDate(row.dateIn)}</span> : <span style={{ opacity: 0.3 }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="actions-cell">
                      <button className="btn btn-icon btn-sm" onClick={() => onEdit(row)} title="Edit">✎</button>
                      {!cash && (
                        <button
                          className="btn btn-icon btn-sm"
                          style={{ color: '#2874ad', borderColor: 'rgba(43,145,223,0.35)' }}
                          onClick={() => onClose(row)}
                          title="Close Position"
                        >C</button>
                      )}
                      {!cash && (
                        <button className="btn btn-danger" onClick={() => onDelete(row.id)} title="Delete">✕</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={16} style={{ textAlign: 'center', padding: '40px', color: 'var(--slate)', fontSize: 13 }}>No positions match your filter.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <div className="footer-count">{sorted.length} position{sorted.length !== 1 ? 's' : ''} shown</div>
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          <div className="footer-total">Total Cost: <strong>{fmt$(totals.tc)}</strong></div>
          <div className="footer-total">Market Value: <strong>{fmt$(totals.mv)}</strong></div>
          <div className="footer-total">Total G/L: <strong className={totals.gl >= 0 ? 'gain-pos' : 'gain-neg'}>{fmt$(totals.gl)} ({fmtGainPct(totals.glPct)})</strong></div>
        </div>
      </div>
    </>
  );
}

function RealizedTable({ rows }) {
  const [sortCol, setSortCol] = useState('dateOut');
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch] = useState('');
  const [filterSector, setFilterSector] = useState('');
  const [filterBrokerage, setFilterBrokerage] = useState('');

  const sectors = useMemo(() => [...new Set(rows.map(r => r.sector).filter(Boolean))].sort(), [rows]);
  const brokerages = useMemo(() => [...new Set(rows.map(r => r.brokerage).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    let d = rows;
    if (search) {
      const q = search.toLowerCase();
      d = d.filter(r => [r.symbol, r.name, r.brokerage, r.sector, r.notes].some(v => v && v.toLowerCase().includes(q)));
    }
    if (filterSector) d = d.filter(r => r.sector === filterSector);
    if (filterBrokerage) d = d.filter(r => r.brokerage === filterBrokerage);
    return d;
  }, [rows, search, filterSector, filterBrokerage]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
  }), [filtered, sortCol, sortDir]);

  const totals = useMemo(() => {
    const tc = rows.reduce((s, r) => s + (r.totalCost || 0), 0);
    const ti = rows.reduce((s, r) => s + (r.totalInflow || 0), 0);
    const gl = ti - tc;
    const glPct = tc > 0 ? (gl / tc) * 100 : 0;
    return { tc, ti, gl, glPct };
  }, [rows]);

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const Th = (label, col, align = 'right') => (
    <SortableTh label={label} col={col} align={align} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
  );

  return (
    <>
      <div className="table-toolbar">
        <div className="toolbar-left">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input className="search-input" placeholder="Search realized positions…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="filter-select" value={filterSector} onChange={e => setFilterSector(e.target.value)}>
            <option value="">All Sectors</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="filter-select" value={filterBrokerage} onChange={e => setFilterBrokerage(e.target.value)}>
            <option value="">All Brokerages</option>
            {brokerages.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>
            {Th('Date In', 'dateIn', 'left')}
            {Th('Date Out', 'dateOut', 'left')}
            {Th('Symbol', 'symbol', 'left')}
            {Th('Exchange', 'exchange', 'left')}
            {Th('Company', 'name', 'left')}
            {Th('Brokerage', 'brokerage', 'left')}
            {Th('Shares', 'shares')}
            {Th('Avg Cost', 'avgCost')}
            {Th('Total Cost', 'totalCost')}
            {Th('Avg Sell', 'avgSell')}
            {Th('Total Inflow', 'totalInflow')}
            {Th('Gain / Loss', 'gainLoss')}
            {Th('G/L %', 'gainLossPct')}
            {Th('Sector', 'sector', 'left')}
            <th style={{ textAlign: 'left' }}>Notes</th>
          </tr></thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.id}>
                <td className="text-col">{row.dateIn ? <span className="date-text">{fmtDate(row.dateIn)}</span> : <span style={{ opacity: 0.3 }}>—</span>}</td>
                <td className="text-col">{row.dateOut ? <span className="date-text">{fmtDate(row.dateOut)}</span> : <span style={{ opacity: 0.3 }}>—</span>}</td>
                <td className="text-col"><span className="symbol-badge">{row.symbol}</span></td>
                <td className="text-col"><span className="exchange-tag">{row.exchange}</span></td>
                <td className="text-col" style={{ maxWidth: 200 }}><span style={{ fontSize: 13 }}>{row.name}</span></td>
                <td className="text-col"><span style={{ fontSize: 12, color: 'var(--slate)' }}>{row.brokerage}</span></td>
                <td style={{ textAlign: 'right' }}>{fmtN(row.shares)}</td>
                <td style={{ textAlign: 'right' }}>{fmt$(row.avgCost)}</td>
                <td style={{ textAlign: 'right' }}>{fmt$(row.totalCost)}</td>
                <td style={{ textAlign: 'right' }}>{fmt$(row.avgSell)}</td>
                <td style={{ textAlign: 'right', fontWeight: 400 }}>{fmt$(row.totalInflow)}</td>
                <td style={{ textAlign: 'right' }}><GainBadge value={row.gainLoss} pct={row.gainLossPct} showPct={false} /></td>
                <td style={{ textAlign: 'right' }}><GainBadge value={row.gainLoss} pct={row.gainLossPct} showPct={true} /></td>
                <td className="text-col"><span className="sector-pill">{row.sector}</span></td>
                <td className="text-col"><span className="notes-text">{row.notes || <span style={{ opacity: 0.3 }}>—</span>}</span></td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={15} style={{ textAlign: 'center', padding: '40px', color: 'var(--slate)', fontSize: 13 }}>No realized positions yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <div className="footer-count">{sorted.length} position{sorted.length !== 1 ? 's' : ''} shown</div>
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          <div className="footer-total">Total Cost: <strong>{fmt$(totals.tc)}</strong></div>
          <div className="footer-total">Total Inflow: <strong>{fmt$(totals.ti)}</strong></div>
          <div className="footer-total">Realized G/L: <strong className={totals.gl >= 0 ? 'gain-pos' : 'gain-neg'}>{fmt$(totals.gl)} ({fmtGainPct(totals.glPct)})</strong></div>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [portfolio, setPortfolio] = useState(null);
  const [realized, setRealized] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('portfolio');
  const [saveStatus, setSaveStatus] = useState('idle');

  const handleSave = async () => {
    setSaveStatus('saving');
    const csv = activeTab === 'portfolio' ? portfolioRowsToCsv(portfolio) : realizedRowsToCsv(realized);
    const endpoint = activeTab === 'portfolio' ? '/savePortfolio' : '/saveRealized';
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv });
      if (!res.ok) throw new Error('Server error');
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  useEffect(() => {
    Promise.all([
      fetch('/portfolio.csv').then(r => r.ok ? r.text() : Promise.reject('portfolio.csv not found')),
      fetch('/realized.csv').then(r => r.ok ? r.text() : Promise.reject('realized.csv not found'))
    ])
      .then(([p, rz]) => {
        const pRaw = csvToObjects(p);
        const rRaw = csvToObjects(rz);
        setPortfolio(parsePortfolio(pRaw.filter(row => !row['Date Out'])));
        setRealized(parseRealized(rRaw));
      })
      .catch(e => setError(String(e)));
  }, []);

  const openPositions = useMemo(() => portfolio || [], [portfolio]);
  const positionRows = useMemo(() => openPositions.filter(r => !r.isCash), [openPositions]);

  const totals = useMemo(() => {
    const mv = openPositions.reduce((s, r) => s + (r.marketValue || 0), 0);
    const tc = openPositions.reduce((s, r) => s + (r.totalCost || 0), 0);
    const gl = mv - tc;
    const glPct = tc > 0 ? (gl / tc) * 100 : 0;
    return { mv, tc, gl, glPct, positions: positionRows.length };
  }, [openPositions, positionRows]);

  const realizedTotals = useMemo(() => {
    if (!realized) return { gl: 0, count: 0 };
    const gl = realized.reduce((s, r) => s + (r.gainLoss || 0), 0);
    return { gl, count: realized.length };
  }, [realized]);

  return (
    <>
      <nav className="nav">
        <div className="nav-brand"><div className="nav-brand-dot" />Portfolio Tracker</div>
        <div className="nav-actions">
          <button className="btn btn-icon btn-sm" onClick={() => alert('Export coming soon')}>Export CSV</button>
          <button className="btn btn-primary btn-sm" onClick={() => alert('Add coming soon')}>
            {activeTab === 'portfolio' ? '+ Add Position' : '+ Add Realized'}
          </button>
        </div>
      </nav>

      <main className="main">
        <div className="page-header">
          <div>
            <div className="page-title">Portfolio Overview</div>
            <div className="page-subtitle">
              As of {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        </div>

        {error && <div className="error">Failed to load data: {error}</div>}

        {!error && portfolio && realized && (
          <>
            <div className="summary-grid">
              <SummaryCard label="Total Market Value" value={fmt$(totals.mv)} sub={`Cost basis ${fmt$(totals.tc)}`} />
              <SummaryCard
                label="Total Gain / Loss"
                value={<span className={totals.gl >= 0 ? 'gain-pos' : 'gain-neg'}>{fmt$(totals.gl)}</span>}
                sub={fmtGainPct(totals.glPct)}
                subClass={totals.gl >= 0 ? 'gain-pos' : 'gain-neg'}
              />
              <SummaryCard label="Positions" value={totals.positions} sub="+ 1 cash position" />
              <SummaryCard
                label="Realized G/L"
                value={<span className={realizedTotals.gl >= 0 ? 'gain-pos' : 'gain-neg'}>{fmt$(realizedTotals.gl)}</span>}
                sub={`Across ${realizedTotals.count} closed position${realizedTotals.count !== 1 ? 's' : ''}`}
                subClass={realizedTotals.gl >= 0 ? 'gain-pos' : 'gain-neg'}
              />
            </div>

            <div className="table-wrap">
              <div className="tabs-bar">
                <div className="tabs-left">
                  <button className={`tab-btn ${activeTab === 'portfolio' ? 'active' : ''}`} onClick={() => setActiveTab('portfolio')}>
                    Portfolio <span className="tab-count">{openPositions.length}</span>
                  </button>
                  <button className={`tab-btn ${activeTab === 'realized' ? 'active' : ''}`} onClick={() => setActiveTab('realized')}>
                    Realized Gains / Losses <span className="tab-count">{realized.length}</span>
                  </button>
                </div>
                <div className="tabs-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleSave}
                    disabled={saveStatus === 'saving'}
                  >
                    {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error!' : 'Save CSV'}
                  </button>
                </div>
              </div>

              {activeTab === 'portfolio'
                ? <PortfolioTable
                    rows={openPositions}
                    onEdit={() => alert('Edit coming soon')}
                    onClose={() => alert('Close position coming soon')}
                    onDelete={id => setPortfolio(rs => rs.filter(r => r.id !== id))}
                  />
                : <RealizedTable rows={realized} />}
            </div>
          </>
        )}

        {!error && (!portfolio || !realized) && <div className="loading">Loading…</div>}
      </main>
    </>
  );
}
