import { useEffect, useMemo, useRef, useState } from 'react';
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
  const H = ['Symbol', 'Exchange', 'Company', 'Brokerage', 'Shares', 'Avg Cost', 'Total Cost', 'Cur. Price', 'Mkt Value', 'Sector', 'Alt Symbol', 'Referrer', 'Notes', 'Date In'];
  return objectsToCsv(H, rows.map(r => ({
    Symbol: r.symbol ?? '', Exchange: r.exchange ?? '', Company: r.name ?? '', Brokerage: r.brokerage ?? '',
    Shares: r.isCash ? '' : (r.shares ?? ''), 'Avg Cost': r.isCash ? '' : (r.avgCost ?? ''),
    'Total Cost': r.totalCost ?? '', 'Cur. Price': r.isCash ? '' : (r.price ?? ''),
    'Mkt Value': r.marketValue ?? '', Sector: r.sector ?? '', 'Alt Symbol': r.altSymbol ?? '', Referrer: r.referrer ?? '', Notes: r.notes ?? '', 'Date In': r.dateIn ?? ''
  })));
}

function realizedRowsToCsv(rows) {
  const H = ['Date In', 'Date Out', 'Symbol', 'Exchange', 'Company', 'Brokerage', 'Shares', 'Avg Cost', 'Total Cost', 'Avg Sell', 'Fees', 'Total Inflow', 'Gain / Loss', 'G/L %', 'Sector', 'Alt Symbol', 'Referrer', 'Notes'];
  return objectsToCsv(H, rows.map(r => ({
    'Date In': r.dateIn ?? '', 'Date Out': r.dateOut ?? '', Symbol: r.symbol ?? '', Exchange: r.exchange ?? '',
    Company: r.name ?? '', Brokerage: r.brokerage ?? '', Shares: r.shares ?? '',
    'Avg Cost': r.avgCost ?? '', 'Total Cost': r.totalCost ?? '', 'Avg Sell': r.avgSell ?? '',
    'Fees': r.fees ?? 0,
    'Total Inflow': r.totalInflow ?? '', 'Gain / Loss': r.gainLoss ?? '', 'G/L %': r.gainLossPct ?? '',
    Sector: r.sector ?? '', 'Alt Symbol': r.altSymbol ?? '', Referrer: r.referrer ?? '', Notes: r.notes ?? ''
  })));
}

const fmt$ = v => v == null || v === '' ? '—' :
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtN = v => v == null || v === '' ? '—' :
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(v);
const fmtGainPct = v => v == null || v === '' ? '' :
  (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
const fmtTime = d => { const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(); return `${String(h % 12 || 12).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };

function makeCashRow(brokerage, id) {
  return {
    id,
    symbol: 'CASH', exchange: '—', name: 'Cash & Equivalents',
    brokerage,
    shares: null, avgCost: null, price: null,
    totalCost: 0, marketValue: 0,
    gainLoss: 0, gainLossPct: 0,
    dayChangePct: null, dayGainLoss: null, sector: 'Cash',
    altSymbol: '', referrer: '', notes: '', dateIn: null, isCash: true
  };
}

function ensureCashRows(rows) {
  const brokerages = [...new Set(rows.filter(r => !r.isCash).map(r => r.brokerage).filter(Boolean))];
  const cashByBrokerage = new Map(rows.filter(r => r.isCash).map(r => [r.brokerage, r]));
  const nonCash = rows.filter(r => !r.isCash);
  let maxId = rows.length > 0 ? Math.max(...rows.map(r => r.id)) : 0;
  const cashRows = brokerages
    .map(b => cashByBrokerage.get(b) ?? makeCashRow(b, ++maxId))
    .sort((a, b) => (a.brokerage || '').localeCompare(b.brokerage || ''));
  return [...nonCash, ...cashRows];
}

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
      dayChangePct: null, dayGainLoss: null,
      sector: r['Sector'],
      altSymbol: r['Alt Symbol'] || '',
      referrer: r['Referrer'] || '',
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
    const fees = num(r['Fees']) ?? 0;
    const totalCost = num(r['Total Cost']) ?? (shares != null && avgCost != null ? shares * avgCost : null);
    const totalInflow = num(r['Total Inflow']) ?? (shares != null && avgSell != null ? shares * avgSell - fees : null);
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
      shares, avgCost, avgSell, fees,
      totalCost, totalInflow,
      gainLoss, gainLossPct,
      sector: r['Sector'],
      altSymbol: r['Alt Symbol'] || '',
      referrer: r['Referrer'] || '',
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

function EditCell({ value, onChange, type = 'text', className = '' }) {
  return (
    <input
      className={`cell-input ${className}`}
      type={type === 'number' ? 'number' : 'text'}
      value={value ?? ''}
      onChange={e => onChange(type === 'number' ? (e.target.value === '' ? '' : parseFloat(e.target.value)) : e.target.value)}
    />
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

function AddPositionModal({ onClose, onSave }) {
  const [f, setF] = useState({
    symbol: '', exchange: '', altSymbol: '', referrer: '', name: '', brokerage: '',
    shares: '', avgCost: '', price: '', sector: '', notes: '', dateIn: ''
  });
  const set = k => v => setF(p => ({ ...p, [k]: v }));

  const save = () => {
    if (!f.symbol.trim()) return;
    const shares = f.shares ? parseFloat(f.shares) : null;
    const avgCost = f.avgCost ? parseFloat(f.avgCost) : null;
    const price = f.price ? parseFloat(f.price) : null;
    const totalCost = shares != null && avgCost != null ? shares * avgCost : null;
    const marketValue = shares != null && price != null ? shares * price : null;
    const gainLoss = marketValue != null && totalCost != null ? marketValue - totalCost : null;
    const gainLossPct = gainLoss != null && totalCost && totalCost > 0 ? (gainLoss / totalCost) * 100 : null;
    onSave({
      symbol: f.symbol.trim().toUpperCase(), exchange: f.exchange.trim(),
      altSymbol: f.altSymbol.trim(), referrer: f.referrer.trim(), name: f.name.trim(), brokerage: f.brokerage.trim(),
      shares, avgCost, price, totalCost, marketValue, gainLoss, gainLossPct,
      dayChangePct: null, dayGainLoss: null, sector: f.sector.trim(), notes: f.notes.trim(),
      dateIn: f.dateIn || null, isCash: false
    });
    onClose();
  };

  const handleKey = e => { if (e.key === 'Escape') onClose(); };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()} onKeyDown={handleKey}>
      <div className="modal">
        <div className="modal-title">Add Position</div>
        <div className="modal-sub">Enter the details for this holding.</div>
        <div className="form-grid">
          {[
            ['symbol', 'Symbol', 'text'], ['exchange', 'Exchange', 'text'],
            ['altSymbol', 'Alt Symbol', 'text'], ['referrer', 'Referrer', 'text'],
            ['name', 'Company Name', 'text'], ['brokerage', 'Brokerage', 'text'],
            ['shares', 'Shares', 'number'], ['avgCost', 'Avg Cost ($)', 'number'],
            ['price', 'Current Price ($)', 'number'], ['sector', 'Sector', 'text'],
            ['dateIn', 'Date In', 'date'],
          ].map(([k, label, type]) => (
            <div key={k} className={`form-group ${['name', 'brokerage'].includes(k) ? 'full' : ''}`}>
              <label className="form-label">{label}</label>
              <input
                className="form-input" type={type} value={f[k]}
                onChange={e => set(k)(e.target.value)}
                placeholder={type === 'date' ? '' : label}
                autoFocus={k === 'symbol'}
              />
            </div>
          ))}
          <div className="form-group full">
            <label className="form-label">Notes</label>
            <input className="form-input" value={f.notes} onChange={e => set('notes')(e.target.value)} placeholder="Optional notes…" />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!f.symbol.trim()}>Add Position</button>
        </div>
      </div>
    </div>
  );
}

function AddRealizedModal({ onClose, onSave, initialData }) {
  const [f, setF] = useState({
    symbol: initialData?.symbol || '',
    exchange: initialData?.exchange || '',
    altSymbol: initialData?.altSymbol || '',
    referrer: initialData?.referrer || '',
    name: initialData?.name || '',
    brokerage: initialData?.brokerage || '',
    shares: initialData?.shares != null ? String(initialData.shares) : '',
    avgCost: initialData?.avgCost != null ? String(initialData.avgCost) : '',
    avgSell: initialData?.price != null ? String(initialData.price) : '',
    fees: '',
    sector: initialData?.sector || '',
    notes: initialData?.notes || '',
    dateIn: initialData?.dateIn || '',
    dateOut: '',
  });
  const set = k => v => setF(p => ({ ...p, [k]: v }));
  const canSave = !!f.dateOut && !!f.avgSell;

  const save = () => {
    if (!canSave) return;
    const shares = f.shares ? parseFloat(f.shares) : null;
    const avgCost = f.avgCost ? parseFloat(f.avgCost) : null;
    const avgSell = parseFloat(f.avgSell);
    const fees = f.fees ? parseFloat(f.fees) : 0;
    const totalCost = shares != null && avgCost != null ? shares * avgCost : null;
    const totalInflow = shares != null ? shares * avgSell - fees : null;
    const gainLoss = totalInflow != null && totalCost != null ? totalInflow - totalCost : null;
    const gainLossPct = gainLoss != null && totalCost && totalCost > 0 ? (gainLoss / totalCost) * 100 : null;
    onSave({
      symbol: f.symbol, exchange: f.exchange, altSymbol: f.altSymbol, referrer: f.referrer, name: f.name, brokerage: f.brokerage,
      shares, avgCost, avgSell, fees, totalCost, totalInflow, gainLoss, gainLossPct,
      sector: f.sector, notes: f.notes, dateIn: f.dateIn || null, dateOut: f.dateOut,
    });
    onClose();
  };

  const handleKey = e => { if (e.key === 'Escape') onClose(); };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()} onKeyDown={handleKey}>
      <div className="modal">
        <div className="modal-title">Add Realized Position</div>
        <div className="modal-sub">Record a closed / sold position.</div>
        <div className="form-grid">
          {[
            ['symbol', 'Symbol', 'text'], ['exchange', 'Exchange', 'text'],
            ['altSymbol', 'Alt Symbol', 'text'], ['referrer', 'Referrer', 'text'],
            ['name', 'Company Name', 'text'], ['brokerage', 'Brokerage', 'text'],
            ['shares', 'Shares', 'number'], ['avgCost', 'Avg Cost ($)', 'number'],
            ['avgSell', 'Avg Sell Price ($)', 'number'], ['fees', 'Fees ($)', 'number'],
            ['sector', 'Sector', 'text'],
            ['dateIn', 'Date In', 'date'], ['dateOut', 'Date Out', 'date'],
          ].map(([k, label, type]) => {
            const required = k === 'avgSell' || k === 'dateOut';
            return (
              <div key={k} className={`form-group ${['name', 'brokerage'].includes(k) ? 'full' : ''}`}>
                <label className="form-label">{label}{required && <span className="form-required"> *</span>}</label>
                <input
                  className="form-input" type={type} value={f[k]}
                  onChange={e => set(k)(e.target.value)}
                  placeholder={type === 'date' ? '' : label}
                />
              </div>
            );
          })}
          <div className="form-group full">
            <label className="form-label">Notes</label>
            <input className="form-input" value={f.notes} onChange={e => set('notes')(e.target.value)} placeholder="Optional notes…" />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!canSave}>Add Realized Position</button>
        </div>
      </div>
    </div>
  );
}

function PortfolioTable({ rows, setPortfolio, onClose, onDelete, onSave, viewSymbolURL }) {
  const [editingId, setEditingId] = useState(null);
  const [editBuf, setEditBuf] = useState({});
  const [sortCol, setSortCol] = useState('symbol');
  const [sortDir, setSortDir] = useState('asc');
  const [search, setSearch] = useState('');
  const [filterSector, setFilterSector] = useState('');
  const [filterBrokerage, setFilterBrokerage] = useState('');
  const [filterReferrer, setFilterReferrer] = useState('');

  const startEdit = row => { setEditingId(row.id); setEditBuf({ ...row }); };
  const cancelEdit = () => { setEditingId(null); setEditBuf({}); };
  const saveEdit = () => {
    const cash = editBuf.isCash;
    let updated;
    if (cash) {
      const totalCost = Number(editBuf.totalCost) || 0;
      updated = { ...editBuf, totalCost, marketValue: totalCost, gainLoss: 0, gainLossPct: 0 };
    } else {
      const shares = editBuf.shares !== '' ? Number(editBuf.shares) : null;
      const avgCost = editBuf.avgCost !== '' ? Number(editBuf.avgCost) : null;
      const price = editBuf.price !== '' ? Number(editBuf.price) : null;
      const totalCost = shares != null && avgCost != null ? shares * avgCost : null;
      const marketValue = shares != null && price != null ? shares * price : null;
      const gainLoss = marketValue != null && totalCost != null ? marketValue - totalCost : null;
      const gainLossPct = gainLoss != null && totalCost && totalCost > 0 ? (gainLoss / totalCost) * 100 : null;
      updated = { ...editBuf, shares, avgCost, price, totalCost, marketValue, gainLoss, gainLossPct };
    }
    const newRows = rows.map(r => r.id === editingId ? updated : r);
    setPortfolio(newRows);
    onSave(newRows);
    setEditingId(null);
    setEditBuf({});
  };
  const set = key => val => setEditBuf(b => ({ ...b, [key]: val }));

  const sectors = useMemo(() => [...new Set(rows.map(r => r.sector).filter(Boolean))].sort(), [rows]);
  const brokerages = useMemo(() => [...new Set(rows.map(r => r.brokerage).filter(Boolean))].sort(), [rows]);
  const referrers = useMemo(() => [...new Set(rows.map(r => r.referrer).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    let d = rows;
    if (search) {
      const q = search.toLowerCase();
      d = d.filter(r => [r.symbol, r.name, r.brokerage, r.sector, r.notes].some(v => v && v.toLowerCase().includes(q)));
    }
    if (filterSector) d = d.filter(r => r.sector === filterSector);
    if (filterBrokerage) d = d.filter(r => r.brokerage === filterBrokerage);
    if (filterReferrer) d = d.filter(r => r.referrer === filterReferrer);
    return d;
  }, [rows, search, filterSector, filterBrokerage, filterReferrer]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (a.isCash && b.isCash) return (a.brokerage || '').localeCompare(b.brokerage || '');
    if (a.isCash) return 1;
    if (b.isCash) return -1;
    let av = a[sortCol], bv = b[sortCol];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
  }), [filtered, sortCol, sortDir]);

  const totals = useMemo(() => {
    const mv = sorted.reduce((s, r) => s + (r.marketValue || 0), 0);
    const tc = sorted.reduce((s, r) => s + (r.totalCost || 0), 0);
    const gl = mv - tc;
    const glPct = tc > 0 ? (gl / tc) * 100 : 0;
    return { mv, tc, gl, glPct };
  }, [sorted]);

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
          <select className="filter-select" value={filterReferrer} onChange={e => setFilterReferrer(e.target.value)}>
            <option value="">All Referrers</option>
            {referrers.map(r => <option key={r} value={r}>{r}</option>)}
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
            {Th('1-Day G/L', 'dayChangePct')}
            {Th('Sector', 'sector', 'left')}
            {Th('Alt Symbol', 'altSymbol', 'left')}
            {Th('Referrer', 'referrer', 'left')}
            <th style={{ textAlign: 'left' }}>Notes</th>
            {Th('Date In', 'dateIn', 'left')}
            <th style={{ textAlign: 'center', width: 110 }}>Actions</th>
          </tr></thead>
          <tbody>
            {sorted.map(row => {
              const cash = row.isCash;
              const editing = editingId === row.id;
              const buf = editBuf;
              return (
                <tr key={row.id} className={`${cash ? 'cash-row' : ''} ${editing ? 'editing' : ''}`}>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.symbol} onChange={set('symbol')} className="text" /> : (
                      <span
                        className={`symbol-badge ${cash ? 'cash-badge' : ''}`}
                        title={row.notes || undefined}
                        onClick={!cash && viewSymbolURL ? () => window.open(viewSymbolURL + '?symbol=' + row.symbol, '_blank') : undefined}
                        style={!cash && viewSymbolURL ? { cursor: 'pointer' } : undefined}
                      >{row.symbol}</span>
                    )}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.exchange} onChange={set('exchange')} className="text" /> : <span className="exchange-tag">{row.exchange}</span>}
                  </td>
                  <td className="text-col" style={{ maxWidth: 200 }}>
                    {editing ? <EditCell value={buf.name} onChange={set('name')} className="text" /> : <span style={{ fontSize: 13 }}>{row.name}</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.brokerage} onChange={set('brokerage')} className="text" /> : <span style={{ fontSize: 12, color: 'var(--slate)' }}>{row.brokerage}</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {editing && !cash ? <EditCell value={buf.shares} onChange={set('shares')} type="number" /> : (cash ? '—' : fmtN(row.shares))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {editing && !cash ? <EditCell value={buf.avgCost} onChange={set('avgCost')} type="number" /> : (cash ? '—' : fmt$(row.avgCost))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {editing && cash ? <EditCell value={buf.totalCost} onChange={set('totalCost')} type="number" /> : fmt$(row.totalCost)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {editing && !cash ? <EditCell value={buf.price} onChange={set('price')} type="number" /> : (cash ? '—' : fmt$(row.price))}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 400 }}>{fmt$(row.marketValue)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {cash ? '—' : <GainBadge value={row.gainLoss} pct={row.gainLossPct} showPct={false} />}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {cash ? '—' : <GainBadge value={row.gainLoss} pct={row.gainLossPct} showPct={true} />}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {(() => {
                      if (cash || row.dayChangePct == null) return '—';
                      const ref = row.dayGainLoss ?? row.dayChangePct;
                      const cls = ref > 0 ? 'pos' : ref < 0 ? 'neg' : 'zero';
                      const arrow = ref > 0 ? '▲' : ref < 0 ? '▼' : '';
                      const dollar = row.dayGainLoss != null ? fmt$(row.dayGainLoss) : '';
                      return (
                        <span className={`gain-badge ${cls}`}>
                          {arrow} {dollar}{dollar ? ' ' : ''}({fmtGainPct(row.dayChangePct)})
                        </span>
                      );
                    })()}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.sector} onChange={set('sector')} className="text" /> : <span className="sector-pill">{row.sector}</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.altSymbol} onChange={set('altSymbol')} className="text" /> : <span style={{ fontSize: 12, color: 'var(--slate)' }}>{row.altSymbol || <span style={{ opacity: 0.3 }}>—</span>}</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.referrer} onChange={set('referrer')} className="text" /> : <span style={{ fontSize: 12, color: 'var(--slate)' }}>{row.referrer || <span style={{ opacity: 0.3 }}>—</span>}</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.notes} onChange={set('notes')} className="text" /> : <span className="notes-text">{row.notes || <span style={{ opacity: 0.3 }}>—</span>}</span>}
                  </td>
                  <td className="text-col">
                    {editing
                      ? <EditCell value={buf.dateIn ?? ''} onChange={set('dateIn')} className="text" />
                      : (row.dateIn ? <span className="date-text">{fmtDate(row.dateIn)}</span> : <span style={{ opacity: 0.3 }}>—</span>)}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="actions-cell" style={{ justifyContent: 'center' }}>
                      {editing ? (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                          <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>✕</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-icon btn-sm" onClick={() => startEdit(row)} title="Edit">✎</button>
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
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={18} style={{ textAlign: 'center', padding: '40px', color: 'var(--slate)', fontSize: 13 }}>No positions match your filter.</td></tr>}
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

function RealizedTable({ rows, setRealized, onSave, viewSymbolURL }) {
  const [editingId, setEditingId] = useState(null);
  const [editBuf, setEditBuf] = useState({});
  const [sortCol, setSortCol] = useState('dateOut');
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch] = useState('');
  const [filterSector, setFilterSector] = useState('');
  const [filterBrokerage, setFilterBrokerage] = useState('');
  const [filterReferrer, setFilterReferrer] = useState('');

  const sectors = useMemo(() => [...new Set(rows.map(r => r.sector).filter(Boolean))].sort(), [rows]);
  const brokerages = useMemo(() => [...new Set(rows.map(r => r.brokerage).filter(Boolean))].sort(), [rows]);
  const referrers = useMemo(() => [...new Set(rows.map(r => r.referrer).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    let d = rows;
    if (search) {
      const q = search.toLowerCase();
      d = d.filter(r => [r.symbol, r.name, r.brokerage, r.sector, r.notes].some(v => v && v.toLowerCase().includes(q)));
    }
    if (filterSector) d = d.filter(r => r.sector === filterSector);
    if (filterBrokerage) d = d.filter(r => r.brokerage === filterBrokerage);
    if (filterReferrer) d = d.filter(r => r.referrer === filterReferrer);
    return d;
  }, [rows, search, filterSector, filterBrokerage, filterReferrer]);

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

  const startEdit = row => { setEditingId(row.id); setEditBuf({ ...row }); };
  const cancelEdit = () => { setEditingId(null); setEditBuf({}); };
  const saveEdit = () => {
    const shares = Number(editBuf.shares) || 0;
    const avgCost = Number(editBuf.avgCost) || 0;
    const avgSell = Number(editBuf.avgSell) || 0;
    const fees = Number(editBuf.fees) || 0;
    const totalCost = shares * avgCost;
    const totalInflow = shares * avgSell - fees;
    const gainLoss = totalInflow - totalCost;
    const gainLossPct = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
    const newRows = rows.map(r => r.id === editingId
      ? { ...editBuf, shares, avgCost, avgSell, fees, totalCost, totalInflow, gainLoss, gainLossPct }
      : r
    );
    setRealized(newRows);
    onSave(newRows);
    setEditingId(null);
    setEditBuf({});
  };
  const deleteRow = id => {
    const newRows = rows.filter(r => r.id !== id);
    setRealized(newRows);
    onSave(newRows);
    if (editingId === id) cancelEdit();
  };

  const set = key => val => setEditBuf(b => ({ ...b, [key]: val }));

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
          <select className="filter-select" value={filterReferrer} onChange={e => setFilterReferrer(e.target.value)}>
            <option value="">All Referrers</option>
            {referrers.map(r => <option key={r} value={r}>{r}</option>)}
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
            {Th('Fees', 'fees')}
            {Th('Total Inflow', 'totalInflow')}
            {Th('Gain / Loss', 'gainLoss')}
            {Th('G/L %', 'gainLossPct')}
            {Th('Sector', 'sector', 'left')}
            {Th('Alt Symbol', 'altSymbol', 'left')}
            {Th('Referrer', 'referrer', 'left')}
            <th style={{ textAlign: 'left' }}>Notes</th>
            <th style={{ textAlign: 'center', width: 110 }}>Actions</th>
          </tr></thead>
          <tbody>
            {sorted.map(row => {
              const editing = editingId === row.id;
              const buf = editBuf;
              return (
                <tr key={row.id} className={editing ? 'editing' : ''}>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.dateIn} onChange={set('dateIn')} className="text" /> :
                      row.dateIn ? <span className="date-text">{fmtDate(row.dateIn)}</span> : <span style={{ opacity: 0.3 }}>—</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.dateOut} onChange={set('dateOut')} className="text" /> :
                      row.dateOut ? <span className="date-text">{fmtDate(row.dateOut)}</span> : <span style={{ opacity: 0.3 }}>—</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.symbol} onChange={set('symbol')} className="text" /> : (
                      <span
                        className="symbol-badge"
                        onClick={viewSymbolURL ? () => window.open(viewSymbolURL + '?symbol=' + row.symbol, '_blank') : undefined}
                        style={viewSymbolURL ? { cursor: 'pointer' } : undefined}
                      >{row.symbol}</span>
                    )}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.exchange} onChange={set('exchange')} className="text" /> : <span className="exchange-tag">{row.exchange}</span>}
                  </td>
                  <td className="text-col" style={{ maxWidth: 200 }}>
                    {editing ? <EditCell value={buf.name} onChange={set('name')} className="text" /> : <span style={{ fontSize: 13 }}>{row.name}</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.brokerage} onChange={set('brokerage')} className="text" /> : <span style={{ fontSize: 12, color: 'var(--slate)' }}>{row.brokerage}</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {editing ? <EditCell value={buf.shares} onChange={set('shares')} type="number" /> : fmtN(row.shares)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {editing ? <EditCell value={buf.avgCost} onChange={set('avgCost')} type="number" /> : fmt$(row.avgCost)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt$(row.totalCost)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {editing ? <EditCell value={buf.avgSell} onChange={set('avgSell')} type="number" /> : fmt$(row.avgSell)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {editing ? <EditCell value={buf.fees ?? 0} onChange={set('fees')} type="number" /> : fmt$(row.fees ?? 0)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 400 }}>{fmt$(row.totalInflow)}</td>
                  <td style={{ textAlign: 'right' }}><GainBadge value={row.gainLoss} pct={row.gainLossPct} showPct={false} /></td>
                  <td style={{ textAlign: 'right' }}><GainBadge value={row.gainLoss} pct={row.gainLossPct} showPct={true} /></td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.sector} onChange={set('sector')} className="text" /> : <span className="sector-pill">{row.sector}</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.altSymbol} onChange={set('altSymbol')} className="text" /> : <span style={{ fontSize: 12, color: 'var(--slate)' }}>{row.altSymbol || <span style={{ opacity: 0.3 }}>—</span>}</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.referrer} onChange={set('referrer')} className="text" /> : <span style={{ fontSize: 12, color: 'var(--slate)' }}>{row.referrer || <span style={{ opacity: 0.3 }}>—</span>}</span>}
                  </td>
                  <td className="text-col">
                    {editing ? <EditCell value={buf.notes} onChange={set('notes')} className="text" /> : <span className="notes-text">{row.notes || <span style={{ opacity: 0.3 }}>—</span>}</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="actions-cell" style={{ justifyContent: 'center' }}>
                      {editing ? (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                          <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>✕</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-icon btn-sm" onClick={() => startEdit(row)} title="Edit">✎</button>
                          <button className="btn btn-danger" onClick={() => deleteRow(row.id)} title="Delete">✕</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={18} style={{ textAlign: 'center', padding: '40px', color: 'var(--slate)', fontSize: 13 }}>No realized positions yet.</td></tr>}
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [closeRow, setCloseRow] = useState(null);
  const [quoteStatus, setQuoteStatus] = useState('idle');
  const [quotedAt, setQuotedAt] = useState(null);
  const [summaryVisible, setSummaryVisible] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(5);
  const [viewSymbolURL, setViewSymbolURL] = useState('');
  const refreshRef = useRef(null);

  const persistPortfolio = rows => fetch('/savePortfolio', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: portfolioRowsToCsv(rows) }).catch(() => {});
  const persistRealized = rows => fetch('/saveRealized', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: realizedRowsToCsv(rows) }).catch(() => {});

  const handleAddPosition = async newPos => {
    const newId = portfolio.length > 0 ? Math.max(...portfolio.map(r => r.id)) + 1 : 1;
    const pos = { ...newPos, id: newId };
    const nonCash = [...portfolio.filter(r => !r.isCash), pos]
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    const updated = ensureCashRows([...nonCash, ...portfolio.filter(r => r.isCash)]);
    setPortfolio(updated);
    try {
      const csv = portfolioRowsToCsv(updated);
      await fetch('/savePortfolio', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv });
    } catch {
      // save failed silently — data already updated in state
    }
  };

  const handleAddRealized = async realizedData => {
    const newId = realized.length > 0 ? Math.max(...realized.map(r => r.id)) + 1 : 1;
    const updatedRealized = [...realized, { ...realizedData, id: newId }];
    setRealized(updatedRealized);
    try {
      await fetch('/saveRealized', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: realizedRowsToCsv(updatedRealized) });
    } catch {
      // silent fail
    }
  };

  const handleClosePosition = async realizedData => {
    const newId = realized.length > 0 ? Math.max(...realized.map(r => r.id)) + 1 : 1;
    const closedShares = realizedData.shares ?? closeRow.shares ?? 0;
    const positionShares = closeRow.shares ?? 0;
    const isFullClose = closedShares >= positionShares;

    let updatedPortfolio;
    if (isFullClose) {
      updatedPortfolio = portfolio.filter(r => r.id !== closeRow.id);
    } else {
      const remainingShares = +parseFloat((positionShares - closedShares).toPrecision(10));
      const avgCost = closeRow.avgCost;
      const totalCost = avgCost != null ? +(remainingShares * avgCost).toFixed(2) : null;
      const price = closeRow.price;
      const marketValue = price != null ? +(remainingShares * price).toFixed(2) : null;
      const gainLoss = marketValue != null && totalCost != null ? +(marketValue - totalCost).toFixed(2) : null;
      const gainLossPct = gainLoss != null && totalCost && totalCost > 0 ? +((gainLoss / totalCost) * 100).toFixed(4) : null;
      updatedPortfolio = portfolio.map(r => r.id === closeRow.id
        ? { ...r, shares: remainingShares, totalCost, marketValue, gainLoss, gainLossPct }
        : r
      );
    }

    const proceeds = realizedData.totalInflow ?? 0;
    if (proceeds > 0) {
      updatedPortfolio = updatedPortfolio.map(r => {
        if (r.isCash && r.brokerage === closeRow.brokerage) {
          const newBalance = +((r.marketValue || 0) + proceeds).toFixed(2);
          return { ...r, totalCost: newBalance, marketValue: newBalance };
        }
        return r;
      });
    }

    const updatedRealized = [...realized, { ...realizedData, id: newId }];
    setPortfolio(updatedPortfolio);
    setRealized(updatedRealized);
    setCloseRow(null);
    try {
      await Promise.all([
        fetch('/savePortfolio', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: portfolioRowsToCsv(updatedPortfolio) }),
        fetch('/saveRealized', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: realizedRowsToCsv(updatedRealized) }),
      ]);
    } catch {
      // silent fail — state already updated
    }
  };

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

  const handleRefreshPrices = async () => {
    if (!portfolio) return;
    const rows = portfolio.filter(r => !r.isCash && r.symbol);
    if (!rows.length) return;
    const lookupSymbols = [...new Set(rows.map(r => r.altSymbol?.trim() || r.symbol))];
    setQuoteStatus('loading');
    try {
      const res = await fetch(`/api/quotes?symbols=${lookupSymbols.join(',')}`);
      const quotes = await res.json();
      if (!res.ok || quotes.error) throw new Error(quotes.error || `HTTP ${res.status}`);
      setPortfolio(prev => prev.map(r => {
        if (r.isCash) return r;
        const q = quotes[r.altSymbol?.trim() || r.symbol];
        if (!q || q.price == null) return r;
        const price = +q.price.toFixed(2);
        const prevClose = q.prevClose != null ? +q.prevClose.toFixed(2) : null;
        const marketValue = r.shares != null ? +(r.shares * price).toFixed(2) : null;
        const gainLoss = marketValue != null && r.totalCost != null ? +(marketValue - r.totalCost).toFixed(2) : null;
        const gainLossPct = gainLoss != null && r.totalCost > 0 ? +((gainLoss / r.totalCost) * 100).toFixed(4) : null;
        const dayGainLoss = r.shares != null && prevClose != null ? +(r.shares * (price - prevClose)).toFixed(2) : null;
        return { ...r, price, prevClose, marketValue, gainLoss, gainLossPct, dayGainLoss, dayChangePct: q.dayChangePct ?? r.dayChangePct };
      }));
      setQuotedAt(new Date());
      setQuoteStatus('done');
      setTimeout(() => setQuoteStatus('idle'), 3000);
    } catch (e) {
      console.error('Refresh prices failed:', e);
      setQuoteStatus('error');
      setTimeout(() => setQuoteStatus('idle'), 4000);
    }
  };

  useEffect(() => {
    Promise.all([
      fetch('/portfolio.csv').then(r => r.ok ? r.text() : Promise.reject('portfolio.csv not found')),
      fetch('/realized.csv').then(r => r.ok ? r.text() : Promise.reject('realized.csv not found')),
      fetch('/api/settings').then(r => r.ok ? r.json() : { summaryVisible: true }).catch(() => ({ summaryVisible: true }))
    ])
      .then(([p, rz, settings]) => {
        const pRaw = csvToObjects(p);
        const rRaw = csvToObjects(rz);
        setPortfolio(ensureCashRows(parsePortfolio(pRaw.filter(row => !row['Date Out']))));
        setRealized(parseRealized(rRaw));
        setSummaryVisible(settings.summaryVisible ?? true);
        setAutoRefreshMinutes(settings.autoRefreshIntervalMinutes ?? 5);
        setViewSymbolURL(settings.viewSymbolURL ?? '');
      })
      .catch(e => setError(String(e)));
  }, []);

  refreshRef.current = handleRefreshPrices;

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => refreshRef.current(), autoRefreshMinutes * 60 * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, autoRefreshMinutes]);

  const openPositions = useMemo(() => portfolio || [], [portfolio]);
  const positionRows = useMemo(() => openPositions.filter(r => !r.isCash), [openPositions]);
  const cashRows = useMemo(() => openPositions.filter(r => r.isCash), [openPositions]);

  const totals = useMemo(() => {
    const mv = openPositions.reduce((s, r) => s + (r.marketValue || 0), 0);
    const tc = openPositions.reduce((s, r) => s + (r.totalCost || 0), 0);
    const gl = mv - tc;
    const glPct = tc > 0 ? (gl / tc) * 100 : 0;
    const cashTotal = cashRows.reduce((s, r) => s + (r.marketValue || 0), 0);
    return { mv, tc, gl, glPct, positions: positionRows.length, cashCount: cashRows.length, cashTotal };
  }, [openPositions, positionRows, cashRows]);

  const realizedTotals = useMemo(() => {
    if (!realized) return { gl: 0, count: 0 };
    const gl = realized.reduce((s, r) => s + (r.gainLoss || 0), 0);
    return { gl, count: realized.length };
  }, [realized]);

  return (
    <>
      {showAddModal && activeTab === 'portfolio' && <AddPositionModal onClose={() => setShowAddModal(false)} onSave={handleAddPosition} />}
      {showAddModal && activeTab === 'realized' && <AddRealizedModal onClose={() => setShowAddModal(false)} onSave={handleAddRealized} />}
      {closeRow && <AddRealizedModal onClose={() => setCloseRow(null)} onSave={handleClosePosition} initialData={closeRow} />}
      <nav className="nav">
        <div className="nav-brand"><div className="nav-brand-dot" />Portfolio Tracker</div>
        <div className="nav-actions">
          <button className="btn btn-icon btn-sm" onClick={() => alert('Export coming soon')}>Export CSV</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
            {activeTab === 'portfolio' ? '+ Add Position' : '+ Add Realized'}
          </button>
        </div>
      </nav>

      <main className="main">
        <div className="page-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="page-title">Portfolio Overview</div>
              <button
                onClick={() => {
                  const next = !summaryVisible;
                  setSummaryVisible(next);
                  fetch('/saveSettings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ summaryVisible: next })
                  }).catch(() => {});
                }}
                title={summaryVisible ? 'Hide summary' : 'Show summary'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 4, color: 'var(--slate)', fontSize: 16, lineHeight: '32px', transition: 'color 0.15s, background 0.15s', display: 'flex', alignItems: 'center', alignSelf: 'stretch' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#eef2f8'; e.currentTarget.style.color = 'var(--navy)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--slate)'; }}
              >
                {summaryVisible ? '▼' : '▶'}
              </button>
            </div>
            <div className="page-subtitle">
              As of {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        </div>

        {error && <div className="error">Failed to load data: {error}</div>}

        {!error && portfolio && realized && (
          <>
            {summaryVisible && <div className="summary-grid">
              <SummaryCard label="Total Market Value" value={fmt$(totals.mv)} sub={`Cost basis ${fmt$(totals.tc)}`} />
              <SummaryCard
                label="Total Gain / Loss"
                value={<span className={totals.gl >= 0 ? 'gain-pos' : 'gain-neg'}>{fmt$(totals.gl)}</span>}
                sub={fmtGainPct(totals.glPct)}
                subClass={totals.gl >= 0 ? 'gain-pos' : 'gain-neg'}
              />
              <SummaryCard label="Positions" value={totals.positions} sub={`+ ${totals.cashCount} cash position${totals.cashCount !== 1 ? 's' : ''} · ${fmt$(totals.cashTotal)}`} />
              <SummaryCard
                label="Realized G/L"
                value={<span className={realizedTotals.gl >= 0 ? 'gain-pos' : 'gain-neg'}>{fmt$(realizedTotals.gl)}</span>}
                sub={`Across ${realizedTotals.count} closed position${realizedTotals.count !== 1 ? 's' : ''}`}
                subClass={realizedTotals.gl >= 0 ? 'gain-pos' : 'gain-neg'}
              />
            </div>}

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
                  {activeTab === 'portfolio' && (
                    <>
                      {quotedAt && (
                        <span style={{ fontSize: 11, color: 'var(--slate)', alignSelf: 'center' }}>
                          Last refreshed {quotedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} {fmtTime(quotedAt)}
                        </span>
                      )}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleRefreshPrices}
                        disabled={quoteStatus === 'loading' || !portfolio}
                      >
                        {quoteStatus === 'loading' ? 'Fetching…' : quoteStatus === 'error' ? 'Quote Error!' : quoteStatus === 'done' ? 'Updated ✓' : '↻ Refresh Prices'}
                      </button>
                      <button
                        className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => {
                          if (!autoRefresh) handleRefreshPrices();
                          setAutoRefresh(v => !v);
                        }}
                        disabled={!portfolio}
                      >
                        {autoRefresh ? 'Stop Refresh' : 'Auto Refresh'}
                      </button>
                    </>
                  )}
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
                    setPortfolio={setPortfolio}
                    onClose={row => setCloseRow(row)}
                    onDelete={id => {
                      const next = portfolio.filter(r => r.id !== id);
                      setPortfolio(next);
                      persistPortfolio(next);
                    }}
                    onSave={persistPortfolio}
                    viewSymbolURL={viewSymbolURL}
                  />
                : <RealizedTable rows={realized} setRealized={setRealized} onSave={persistRealized} viewSymbolURL={viewSymbolURL} />}
            </div>
          </>
        )}

        {!error && (!portfolio || !realized) && <div className="loading">Loading…</div>}
      </main>
    </>
  );
}
