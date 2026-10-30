"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Boxes, CheckCircle2, Clock3, Factory, Layers3, RefreshCw, ScanLine, Search, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import OrderManager from "./OrderManager";
import OrderPrint from "./OrderPrint";
import { isOverdue } from "../lib/order-utils";
import { dateText, stageIndex, steps } from "../lib/workflow";

async function getAll(table) {
  let rows = [], start = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select("*").range(start, start + 999);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < 1000) return rows;
    start += 1000;
  }
}

export default function Dashboard({ manage = false }) {
  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]);
  const [items, setItems] = useState([]);
  const [usage, setUsage] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("전체");
  const [updated, setUpdated] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabase) { setError("Supabase 연결 설정이 필요합니다. 환경 변수를 확인해 주세요."); setLoading(false); return; }
    try {
      const [wo, c, i, u, m] = await Promise.all(["work_orders", "clients", "items", "material_usage", "raw_materials"].map(getAll));
      setOrders(wo.sort((a,b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))));
      setClients(c); setItems(i); setUsage(u); setMaterials(m);
      setUpdated(new Date()); setError("");
    } catch { setError("데이터를 불러오지 못했습니다. 연결 상태와 Supabase 접근 권한을 확인해 주세요."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, [refresh]);
  const clientNames = useMemo(() => Object.fromEntries(clients.map(x => [x.client_code, x.client_name])), [clients]);
  const itemNames = useMemo(() => Object.fromEntries(items.map(x => [x.item_code, x.item_name])), [items]);
  const materialNames = useMemo(() => Object.fromEntries(materials.map(x => [x.raw_code, x.raw_name])), [materials]);
  const usageByOrder = useMemo(() => {
    const result = {};
    usage.forEach(x => { (result[x.wo_id] ||= []).push(x); });
    return result;
  }, [usage]);
  const filtered = orders.filter(o => {
    const text = [o.wo_id, o.client_code, clientNames[o.client_code], o.item_code, itemNames[o.item_code]].join(" ").toLowerCase();
    const index = stageIndex(o.current_step);
    return text.includes(query.toLowerCase().trim()) && (filter === "전체" || (filter === "대기" ? index === -1 : steps[index]?.name === filter));
  });
  const complete = orders.filter(o => stageIndex(o.current_step) === steps.length - 1).length;
  const progress = orders.filter(o => { const n = stageIndex(o.current_step); return n >= 0 && n < steps.length - 1; }).length;
  const waiting = orders.filter(o => stageIndex(o.current_step) === -1).length;

  return <main className="shell">
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-icon"><Factory size={20}/></span><span>FOUNDRY<span className="brand-sub"> 공정 관리</span></span></Link>
      <nav className="nav"><Link href="/" className={!manage ? "nav-current" : ""}>생산 현황</Link><Link href="/orders/" className={manage ? "nav-current" : ""}>작업지시 관리</Link><Link href="/scanner/">현장 스캔</Link></nav>
      <span className="top-status"><span className={error ? "dot bad" : "dot"}/>{error ? "연결 확인" : "시스템 운영 중"}</span>
    </header>
    <div className="content">
      <div className="eyebrow"><span className="orange-dot"/> {manage ? "WORK ORDER MANAGEMENT" : "PRODUCTION OVERVIEW"}</div>
      <section className="intro">
        <div><h1>{manage ? "작업지시 관리" : "생산 현황"}</h1><p>{manage ? "작업지시와 원재료 투입 내역을 등록하고 관리합니다." : "현장의 공정 흐름을 한눈에 확인하세요."}</p></div>
        <div className="intro-actions"><span className="last-update"><Clock3 size={15}/> {updated ? `마지막 갱신 ${updated.toLocaleTimeString("ko-KR")}` : "연결 대기 중"} · 5초마다 갱신</span><button className="icon-btn" onClick={refresh} aria-label="새로고침"><RefreshCw size={18}/></button><Link className="primary-btn" href="/scanner/"><ScanLine size={18}/> 현장 스캔 <ArrowRight size={16}/></Link></div>
      </section>
      {error && <div className="alert" role="alert">{error}</div>}
      <section className="stats" aria-label="생산 요약">
        {[["전체 작업지시", orders.length, "등록된 작업", <Layers3 key="a"/>], ["진행 중", progress, "공정 진행 중", <Activity key="b"/>], ["작업 대기", waiting, "공정 시작 전", <Clock3 key="c"/>], ["출고 완료", complete, "최종 공정 완료", <CheckCircle2 key="d"/>]].map(([title, count, sub, icon], idx) => <div className="stat" key={title}><div className="stat-top"><span>{title}</span><span className={`stat-icon icon-${idx}`}>{icon}</span></div><div className="stat-number">{count}<small>건</small></div><div className="stat-sub">{sub}</div></div>)}
      </section>
      <section className="board">
        <div className="board-heading"><div><span className="section-kicker">WORK ORDERS</span><h2>작업지시 현황 <span>{filtered.length}</span></h2><p>작업별 진행 상태와 자재 투입 내역을 확인합니다.</p></div><div className="board-actions"><div className="search"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="지시번호, 거래처, 품목 검색" aria-label="작업지시 검색"/></div>{manage && <button className="primary-btn" onClick={() => setEditor({mode:"create", order:null, usage:[]})}><Plus size={17}/> 작업지시 등록</button>}</div></div>
        <div className="filters">{["전체", "대기", ...steps.map(x=>x.name)].map(f => <button key={f} className={filter === f ? "filter active" : "filter"} onClick={() => setFilter(f)}>{f}</button>)}</div>
        <div className="table-head"><span>작업지시 / 거래처</span><span>생산 품목</span><span>공정 진행</span><span>목표 수량</span><span>발행일</span></div>
        {loading ? <div className="empty">작업지시를 불러오는 중입니다.</div> : !filtered.length ? <div className="empty"><Boxes size={26}/><strong>표시할 작업지시가 없습니다</strong><span>검색 조건이나 연결 설정을 확인해 주세요.</span></div> : filtered.map(o => {
          const stage = stageIndex(o.current_step);
          return <article className="order" key={o.wo_id}>
            <div className="order-grid">
              <div className="order-id"><strong>{o.wo_id}</strong>{isOverdue(o) && <span className="overdue-badge">납기 지연</span>}<span>{clientNames[o.client_code] || o.client_code || "거래처 미등록"}</span></div>
              <div className="item-name"><strong>{itemNames[o.item_code] || o.item_code || "품목 미등록"}</strong><span>{o.item_code}</span></div>
              <div className="progress-cell"><div className="progress-track">{steps.map((s, i) => <div key={s.name} className={i <= stage ? "progress-segment done" : "progress-segment"}/>)}</div><span>{o.current_step || "발행대기"}</span></div>
              <div className="quantity"><span className="mobile-label">목표 수량 </span>{Number(o.target_qty || 0).toLocaleString()} <small>개</small></div>
              <div className="date"><span className="mobile-label">발행 </span>{dateText(o.created_at)}</div>
            </div>
            <div className="order-details">{o.start_date && <span>작업 시작<strong>{dateText(o.start_date)}</strong></span>}{o.due_date && <span>납기<strong>{dateText(o.due_date)}</strong></span>}{o.actual_qty != null && <span>실제 생산<strong>{Number(o.actual_qty).toLocaleString()} 개</strong></span>}{o.unit_weight_kg != null && <span>단중<strong>{Number(o.unit_weight_kg).toLocaleString()} kg</strong></span>}{o.heat_no && <span>용해 번호<strong>{o.heat_no}</strong></span>}{o.casting_material && <span>재질<strong>{o.casting_material}</strong></span>}{manage && <button className="edit-btn" onClick={() => setEditor({mode:"edit",order:{...o},usage:(usageByOrder[o.wo_id] || []).map(x=>({...x}))})}>수정 / 삭제</button>}{manage && <button className="edit-btn" onClick={() => setPrintOrder(o)}>지시서 / QR 인쇄</button>}</div><div className="material-line"><Boxes size={14}/><span>자재 투입</span>{usageByOrder[o.wo_id]?.length ? usageByOrder[o.wo_id].map((u, i) => <span className="material-chip" key={u.usage_id || i}>{materialNames[u.raw_code] || u.raw_code} {Number(u.input_qty).toLocaleString()} kg</span>) : <span className="muted">기록 없음</span>}</div>
            {o.notes && <p className="order-note">메모 · {o.notes}</p>}
          </article>;
        })}
      </section>
      <footer>FOUNDRY OPERATIONS <span>현장과 사무실을 하나로</span></footer>
    </div>
    {editor && <OrderManager mode={editor.mode} order={editor.order} usage={editor.usage} clients={clients} items={items} materials={materials} close={() => setEditor(null)} onSaved={refresh}/>}
    {printOrder && <OrderPrint order={printOrder} clientName={clientNames[printOrder.client_code]} itemName={itemNames[printOrder.item_code]} usage={usageByOrder[printOrder.wo_id] || []} materialNames={materialNames} close={() => setPrintOrder(null)}/>}
  </main>;
}