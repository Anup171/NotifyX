// Charts: hand-rolled SVG line/area + bar charts with grid + tooltip-on-hover.

const Sparkline = ({ data, w = 88, h = 28, color = 'currentColor' }) => {
  if (!data || data.length < 2) return <svg width={w} height={h} style={{display:'block'}}/>;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i*step, h - ((v-min)/span)*h]);
  const d = pts.map((p, i) => (i===0?'M':'L') + p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const area = d + ` L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:'block'}}>
      <path d={area} fill={color} fillOpacity="0.10" stroke="none"/>
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
};

const AreaChart = ({ series, labels, height = 240 }) => {
  // Guard: need at least 2 labels to draw paths
  const safeLabels = (labels && labels.length >= 2) ? labels : ['00','01'];
  const safeSent      = series?.sent      && series.sent.length      >= 2 ? series.sent      : safeLabels.map(() => 0);
  const safeDelivered = series?.delivered && series.delivered.length >= 2 ? series.delivered : safeLabels.map(() => 0);
  const safeFailed    = series?.failed    && series.failed.length    >= 2 ? series.failed    : safeLabels.map(() => 0);

  const W = 760, H = height, pad = { l: 36, r: 12, t: 16, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const all = [...safeSent, ...safeDelivered];
  const maxRaw = Math.max(...all, 0);
  const max = maxRaw > 0 ? (maxRaw <= 5 ? 5 : maxRaw <= 20 ? 20 : maxRaw <= 100 ? 100 : Math.ceil(maxRaw / 10) * 10) : 10;
  const yTicks = 4;
  const xs = (i) => pad.l + (i / (safeLabels.length - 1)) * iw;
  const ys = (v) => pad.t + ih - (v / max) * ih;

  const linePath = (arr) => arr.map((v, i) => (i===0?'M':'L') + xs(i).toFixed(1)+','+ys(v).toFixed(1)).join(' ');
  const areaPath = (arr) => linePath(arr) + ` L${xs(arr.length-1)},${pad.t+ih} L${xs(0)},${pad.t+ih} Z`;

  const [hover, setHover] = React.useState(null);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    if (x < pad.l || x > pad.l + iw) { setHover(null); return; }
    const ratio = (x - pad.l) / iw;
    const i = Math.min(Math.round(ratio * (safeLabels.length - 1)), safeLabels.length - 1);
    setHover(i);
  };

  // Safe getter to avoid undefined.toLocaleString() crash
  const safeVal = (arr, i) => (arr && arr[i] != null) ? arr[i] : 0;

  return (
    <div style={{position:'relative'}}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="grad-sent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.18 0 0)" stopOpacity="0.10"/>
            <stop offset="100%" stopColor="oklch(0.18 0 0)" stopOpacity="0"/>
          </linearGradient>
          <pattern id="diag" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="oklch(0.18 0 0)" strokeOpacity="0.05" strokeWidth="2"/>
          </pattern>
        </defs>
        {/* y grid */}
        {Array.from({length: yTicks+1}).map((_,i) => {
          const y = pad.t + (ih/yTicks)*i;
          const v = max - (max/yTicks)*i;
          return (
            <g key={i}>
              <line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke="oklch(0.91 0 0)" strokeWidth="1" strokeDasharray={i===yTicks?'':'2 3'}/>
              <text x={pad.l-8} y={y+3} textAnchor="end" fontSize="10" fill="oklch(0.64 0 0)" fontFamily="ui-monospace,monospace">
                {v >= 1000 ? (v/1000).toFixed(1)+'k' : Math.round(v)}
              </text>
            </g>
          );
        })}
        {/* x labels (every 4) */}
        {safeLabels.map((l, i) => i % 4 === 0 ? (
          <text key={i} x={xs(i)} y={H-pad.b+14} textAnchor="middle" fontSize="10" fill="oklch(0.64 0 0)" fontFamily="ui-monospace,monospace">{l}</text>
        ) : null)}
        {/* area + lines */}
        <path d={areaPath(safeSent)} fill="url(#grad-sent)"/>
        <path d={linePath(safeSent)} fill="none" stroke="oklch(0.18 0 0)" strokeWidth="1.5"/>
        <path d={linePath(safeDelivered)} fill="none" stroke="oklch(0.52 0 0)" strokeWidth="1.3" strokeDasharray="3 3"/>
        <path d={linePath(safeFailed)} fill="none" stroke="oklch(0.54 0.16 25)" strokeWidth="1.3"/>

        {/* hover */}
        {hover != null && (
          <g>
            <line x1={xs(hover)} x2={xs(hover)} y1={pad.t} y2={pad.t+ih} stroke="oklch(0.64 0 0)" strokeWidth="1" strokeDasharray="2 3"/>
            <circle cx={xs(hover)} cy={ys(safeVal(safeSent, hover))} r="3.5" fill="oklch(0.18 0 0)" stroke="var(--panel)" strokeWidth="2"/>
            <circle cx={xs(hover)} cy={ys(safeVal(safeDelivered, hover))} r="3" fill="oklch(0.52 0 0)" stroke="var(--panel)" strokeWidth="2"/>
            <circle cx={xs(hover)} cy={ys(safeVal(safeFailed, hover))} r="3" fill="oklch(0.54 0.16 25)" stroke="var(--panel)" strokeWidth="2"/>
          </g>
        )}
      </svg>
      {hover != null && (
        <div style={{
          position:'absolute',
          left: `clamp(8px, calc(${(xs(hover)/W)*100}% + 8px), calc(100% - 180px))`,
          top: 12,
          background:'var(--bg-elev)',
          border:'1px solid var(--border-strong)',
          borderRadius:8, padding:'8px 10px',
          fontSize:11, minWidth:170,
          boxShadow:'var(--shadow-md)',
          pointerEvents:'none',
          fontFamily:'var(--font-mono)',
          zIndex: 10,
        }}>
          <div style={{color:'var(--fg-faint)', marginBottom:6}}>{safeLabels[hover]}</div>
          <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
            <span><span className="legend-dot" style={{background:'oklch(0.68 0.13 245)'}}/>Sent</span>
            <span style={{color:'var(--fg)'}}>{safeVal(safeSent, hover).toLocaleString()}</span>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
            <span><span className="legend-dot" style={{background:'oklch(0.72 0.14 155)'}}/>Delivered</span>
            <span style={{color:'var(--fg)'}}>{safeVal(safeDelivered, hover).toLocaleString()}</span>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', gap:12}}>
            <span><span className="legend-dot" style={{background:'oklch(0.68 0.17 25)'}}/>Failed</span>
            <span style={{color:'var(--fg)'}}>{safeVal(safeFailed, hover).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const RingChart = ({ value, label, color = 'oklch(0.72 0.14 155)' }) => {
  const r = 44, c = 2*Math.PI*r;
  const off = c - (value/100)*c;
  return (
    <div style={{display:'flex', alignItems:'center', gap:16}}>
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="oklch(0.91 0 0)" strokeWidth="8"/>
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="8"
                strokeDasharray={c} strokeDashoffset={off}
                strokeLinecap="round" transform="rotate(-90 60 60)"/>
        <text x="60" y="58" textAnchor="middle" fontSize="22" fontWeight="600" fill="oklch(0.18 0 0)" fontFamily="Inter">
          {value.toFixed(2)}%
        </text>
        <text x="60" y="76" textAnchor="middle" fontSize="10" fill="oklch(0.64 0 0)" fontFamily="ui-monospace,monospace" letterSpacing="0.06em">
          {label.toUpperCase()}
        </text>
      </svg>
    </div>
  );
};

const BarChart = ({ data, labels, color = 'oklch(0.18 0 0)', height = 200, suffix = '' }) => {
  const W = 600, H = height, pad = { l: 40, r: 12, t: 12, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = (Math.ceil(Math.max(...data) * 1.15)) || 10;
  const bw = iw / data.length * 0.62;
  const gap = iw / data.length * 0.38;
  const [hover, setHover] = React.useState(null);
  return (
    <div style={{position:'relative'}}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {Array.from({length:5}).map((_,i)=>{
          const y = pad.t + (ih/4)*i;
          const v = max - (max/4)*i;
          return (
            <g key={i}>
              <line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke="oklch(0.91 0 0)" strokeDasharray={i===4?'':'2 3'}/>
              <text x={pad.l-8} y={y+3} textAnchor="end" fontSize="10" fill="oklch(0.64 0 0)" fontFamily="ui-monospace,monospace">
                {v.toFixed(0)}{suffix}
              </text>
            </g>
          );
        })}
        {data.map((v,i)=>{
          const x = pad.l + i*(bw+gap) + gap/2;
          const h = (v/max)*ih;
          const y = pad.t + ih - h;
          return (
            <g key={i} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}>
              <rect x={x} y={y} width={bw} height={h} rx="1"
                    fill={hover===i? 'oklch(0.32 0 0)' : color} fillOpacity={hover===i?1:0.85}/>
              <text x={x+bw/2} y={H-pad.b+14} textAnchor="middle" fontSize="10" fill="oklch(0.64 0 0)" fontFamily="ui-monospace,monospace">{labels[i]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const Heatmap = ({ rows = 7, cols = 24, data = [] }) => {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return (
    <div>
      <div style={{display:'grid', gridTemplateColumns:`28px repeat(${cols}, 1fr)`, gap:3, alignItems:'center'}}>
        <div></div>
        {Array.from({length:cols}).map((_,i)=>(
          <div key={i} style={{fontFamily:'var(--font-mono)', fontSize:9, color:'var(--fg-faint)', textAlign:'center'}}>{i%4===0?String(i).padStart(2,'0'):''}</div>
        ))}
        {days.map((d, y)=>(
          <React.Fragment key={d}>
            <div style={{fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg-faint)'}}>{d}</div>
            {Array.from({length:cols}).map((_,x)=>{
              const count = data[y]?.[x] || 0;
              const opacity = count > 0 ? Math.min(0.9, 0.2 + count * 0.2) : 0.04;
              return <div key={x} title={`${d} ${x}:00 — ${count} events`}
                          style={{
                            aspectRatio:'1', borderRadius:2,
                            background:`oklch(0.18 0 0 / ${opacity})`,
                            border:'1px solid var(--border)',
                          }}/>;
            })}
          </React.Fragment>
        ))}
      </div>
      <div style={{display:'flex', alignItems:'center', gap:6, marginTop:10, fontSize:10, color:'var(--fg-faint)', fontFamily:'var(--font-mono)'}}>
        <span>less</span>
        {[0.04, 0.25, 0.50, 0.75, 0.95].map((v,i)=>(
          <div key={i} style={{width:12, height:12, borderRadius:2, background:`oklch(0.18 0 0 / ${v})`, border:'1px solid var(--border)'}}/>
        ))}
        <span>more</span>
      </div>
    </div>
  );
};

window.Charts = { Sparkline, AreaChart, RingChart, BarChart, Heatmap };
