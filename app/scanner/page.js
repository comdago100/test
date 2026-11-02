"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppNav from "../AppNav";
import { ArrowLeft, Camera, CheckCircle2, Factory, Keyboard, ScanLine, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getProgress, getOrderSteps, steps as legacySteps, validateOpening, validateQuantity } from "../../lib/workflow";
import { parseOrderCode } from "../../lib/order-code";

function message(error) {
  if (["PGRST202", "PGRST204", "42P01", "42703"].includes(error?.code)) return "수량 관리 DB 설정이 필요합니다. partial_production.sql을 적용해 주세요.";
  return error?.message || "연결 상태를 확인해 주세요.";
}

export default function Scanner() {
  const [selected, setSelected] = useState(0);
  const [value, setValue] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [order, setOrder] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState("");
  const [opening, setOpening] = useState(legacySteps.map(() => ""));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [camera, setCamera] = useState(false);
  const [pending, setPending] = useState(null);
  const scannerRef = useRef(null);
  const inputRef = useRef(null);
  const quantityRef = useRef(null);
  const stationRef = useRef(null);
  const focusProcessRef = useRef(false);
  const busyRef = useRef(false);
  const pendingRef = useRef(null);
  const mountedRef = useRef(true);
  const initialLookupRef = useRef(false);
  const steps = getOrderSteps(order);
  const progress = order ? getProgress(order) : null;
  const locked = busy || Boolean(pending);

  useEffect(() => {
    if (busy || pending || camera) return;
    if (order?.quantity_confirmed) {
      if (focusProcessRef.current) stationRef.current?.focus();
      else quantityRef.current?.focus();
    }
    else if (!order) inputRef.current?.focus();
  }, [busy, pending, camera, order, selected]);

  function keepPending(next) {
    pendingRef.current = next; setPending(next);
    try {
      if (next) sessionStorage.setItem("foundry.pendingProgress", JSON.stringify(next));
      else sessionStorage.removeItem("foundry.pendingProgress");
    } catch {}
  }
  async function stopCamera() {
    const reader = scannerRef.current;
    scannerRef.current = null;
    if (reader) {
      try { if (reader.isScanning) await reader.stop(); } catch {}
      try { reader.clear(); } catch {}
    }
    if (mountedRef.current) setCamera(false);
  }
  useEffect(() => {
    mountedRef.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem("foundry.pendingProgress") || "null");
      if (saved && ["record_production_progress", "initialize_production_quantities", "reverse_production_progress"].includes(saved.rpc) && saved.args?.p_request_id) {
        pendingRef.current = saved; setPending(saved);
      }
    } catch {}
    const beforeUnload = event => {
      if (pendingRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("beforeunload", beforeUnload);
      const reader = scannerRef.current;
      scannerRef.current = null;
      if (reader?.isScanning) reader.stop().then(() => reader.clear()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (initialLookupRef.current) return;
    initialLookupRef.current = true;
    const id = new URLSearchParams(window.location.search).get("wo_id");
    if (id === null) return;
    setValue(id);
    if (!pendingRef.current) scan(id);
  }, []);

  async function loadHistory(id) {
    try {
      const { data, error } = await supabase.from("production_events").select("*").eq("wo_id", id)
        .order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      setHistory(data || []); setHistoryError("");
    } catch (error) { setHistory([]); setHistoryError(message(error)); }
  }
  async function scan(raw) {
    if (busyRef.current || pendingRef.current) return;
    let id;
    try { id = parseOrderCode(raw); }
    catch (error) {
      setOrder(null); setSelected(0); setHistory([]); setQuantity(""); setNote("");
      setResult({ ok: false, title: "작업지시 코드를 확인해 주세요", detail: error.message });
      return;
    }
    if (!id) return;
    const previousKey = steps[selected]?.key;
    busyRef.current = true; setBusy(true); setResult(null); setOrder(null); setSelected(0); setHistory([]); setHistoryError("");
    setQuantity(""); setNote(""); setOpening(steps.map(() => ""));
    try {
      if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.");
      const { data, error } = await supabase.from("work_orders").select("*").eq("wo_id", id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("일치하는 작업지시가 없습니다.");
      if (data.quantity_confirmed == null) throw new Error("수량 관리 DB 설정이 필요합니다. partial_production.sql을 적용해 주세요.");
      const nextSteps = getOrderSteps(data);
      setSelected(Math.max(0, nextSteps.findIndex(step => step.key === previousKey)));
      setOpening(nextSteps.map(() => ""));
      focusProcessRef.current = true;
      setOrder(data); setValue("");
      await loadHistory(id);
    } catch (error) { setResult({ ok: false, title: "작업지시를 불러오지 못했습니다", detail: message(error) }); }
    finally { setBusy(false); busyRef.current = false; }
  }
  async function save(action) {
    if (busyRef.current) return;
    const request = pendingRef.current || action;
    if (!request) return;
    keepPending(request);
    busyRef.current = true; setBusy(true); setResult(null);
    try {
      const { data, error } = await supabase.rpc(request.rpc, request.args);
      if (error) throw error;
      focusProcessRef.current = false;
      setSelected(old => Math.min(old, getOrderSteps(data).length - 1));
      setOrder(data); keepPending(null); setQuantity(""); setNote("");
      setResult({ ok: true, title: request.title, detail: `${data.wo_id} · 누적 출고 ${getProgress(data).shipped.toLocaleString()}개 / 잔량 ${getProgress(data).remaining.toLocaleString()}개` });
      await loadHistory(data.wo_id);
      quantityRef.current?.focus();
    } catch (error) {
      // Database errors are definitive rollbacks. Transport errors may have committed:
      // preserve the exact request and UUID until the server confirms the result.
      if (error?.code && !["", "PGRST000", "PGRST001", "PGRST002"].includes(error.code)) {
        keepPending(null);
        const id = request.args.p_wo_id || order?.wo_id;
        if (id) {
          try {
            const { data } = await supabase.from("work_orders").select("*").eq("wo_id", id).maybeSingle();
            if (data) { setOrder(data); await loadHistory(id); }
          } catch {}
        }
      }
      setResult({ ok: false, title: pendingRef.current ? "저장 결과를 확인해야 합니다" : "처리하지 못했습니다",
        detail: pendingRef.current ? "연결을 확인한 뒤 아래 재시도 버튼을 누르세요. 같은 기록이 중복 저장되지 않습니다." : message(error) });
    } finally { setBusy(false); busyRef.current = false; }
  }
  function record(event) {
    event.preventDefault();
    if (locked || !order) return;
    const error = validateQuantity(quantity, progress.available[selected]);
    if (error) return setResult({ ok: false, title: "수량을 확인해 주세요", detail: error });
    save({ rpc: "record_production_progress", args: { p_wo_id: order.wo_id, p_step: selected,
      p_quantity: Number(quantity), p_request_id: crypto.randomUUID(), p_note: note.trim() },
      title: `${steps[selected].name} ${Number(quantity).toLocaleString()}개 처리되었습니다` });
  }
  function initialize(event) {
    event.preventDefault();
    if (locked || !order) return;
    const error = validateOpening(opening, order.target_qty, steps);
    if (error) return setResult({ ok: false, title: "누적 수량을 확인해 주세요", detail: error });
    save({ rpc: "initialize_production_quantities", args: { p_wo_id: order.wo_id,
      p_quantities: Object.fromEntries(steps.map((step, i) => [step.key, Number(opening[i])])),
      p_request_id: crypto.randomUUID() }, title: "기존 작업의 누적 수량이 등록되었습니다" });
  }
  function reverse(event) {
    if (locked || !window.confirm(`${steps[event.step].name} ${event.quantity.toLocaleString()}개 처리 기록을 취소할까요? 후속 공정에 사용된 수량은 먼저 취소해야 합니다.`)) return;
    save({ rpc: "reverse_production_progress", args: { p_event_id: event.event_id, p_request_id: crypto.randomUUID() },
      title: "처리 기록을 취소했습니다" });
  }
  async function startCamera() {
    if (busyRef.current || pendingRef.current || scannerRef.current) return;
    setResult(null); setCamera(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      await new Promise(resolve => setTimeout(resolve, 50));
      if (!mountedRef.current) return;
      const reader = new Html5Qrcode("camera-reader");
      scannerRef.current = reader;
      let detected = false;
      await reader.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, async text => {
        if (detected || busyRef.current || pendingRef.current) return;
        detected = true;
        await stopCamera(); await scan(text);
      }, () => {});
    } catch {
      await stopCamera();
      setResult({ ok: false, title: "카메라를 열 수 없습니다", detail: "카메라 권한과 HTTPS 연결을 확인해 주세요." });
    }
  }
  const reversed = new Set(history.filter(event => event.reversal_of).map(event => event.reversal_of));

  return <main className="shell scanner-shell">
    <header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><Factory size={20}/></span><span>FOUNDRY<span className="brand-sub"> 공정 관리</span></span></Link><AppNav/></header>
    <div className="scanner-content">
      <Link href="/" className="back-link"><ArrowLeft size={16}/> 생산 현황으로</Link>
      <div className="eyebrow"><span className="orange-dot"/> SHOP FLOOR</div>
      <h1>현장 공정 스캔</h1><p className="scanner-desc">작업지시를 먼저 조회한 뒤 공정을 선택하고, 이번에 처리한 수량을 기록하세요. 같은 지시서로 여러 번 나눠 작업할 수 있습니다.</p>
      <div className="scanner-panel">
        <div className="panel-title"><div><span className="step-number">01</span><div><h2>작업지시 조회</h2><p>지시번호를 입력하거나 코드를 스캔하세요.</p></div></div></div>
        <div className="manual-label"><Keyboard size={16}/> 바코드 리더기 또는 직접 입력</div>
        <form className="scan-form" onSubmit={e => {e.preventDefault(); scan(value);}}><input ref={inputRef} value={value} disabled={locked || camera} onChange={e=>setValue(e.target.value)} placeholder="작업지시 번호를 입력하세요" autoComplete="off" aria-label="작업지시 번호"/><button className="primary-btn" disabled={locked || camera || !value.trim()}>{busy ? "처리 중" : "작업 조회"}</button></form>
        <div className="scan-area"><div className="scan-icon"><ScanLine size={32}/></div><strong>작업지시서 QR / 바코드</strong><p>휴대폰에서는 카메라로 조회할 수 있습니다.</p>
          {camera ? <><div id="camera-reader"/><button type="button" className="secondary-btn" onClick={stopCamera}>카메라 닫기</button></> : <button className="primary-btn camera-btn" disabled={locked} type="button" onClick={startCamera}><Camera size={18}/> 카메라로 스캔</button>}
        </div>
        {order && <section className="scan-order">
          <div className="section-row"><div><h2>{order.wo_id}</h2><p>{order.routing_name || "기존 6공정"} · {order.item_code} · 목표 {progress.target.toLocaleString()}개</p></div><span className="selected-label">{progress.needsOpening ? "기존 수량 확인 필요" : order.current_step}</span></div>
          <div className="panel-title"><div><span className="step-number">02</span><div><h2>공정 선택</h2><p>조회한 작업의 라우팅에서 이번에 완료한 공정을 선택하세요.</p></div></div><span className="selected-label">{steps[selected].place}</span></div>
          <div className="station-grid">{steps.map((step, i) => <button type="button" key={step.key} ref={selected === i ? stationRef : null} disabled={locked || camera} className={selected === i ? "station selected" : "station"} onClick={() => {focusProcessRef.current = false; setSelected(i); setQuantity(""); setNote(""); setResult(null); quantityRef.current?.focus();}}><span className="station-num">{String(i+1).padStart(2,"0")}</span><strong>{step.name}</strong><small>{step.place}</small></button>)}</div>
          {progress.needsOpening ? <form onSubmit={initialize}>
            <div className="alert">이전 기록은 상태만 있어 실제 수량을 알 수 없습니다. 각 공정을 지금까지 완료한 누적 수량을 입력하세요. 아직 처리하지 않은 공정은 0개로 입력합니다.</div>
            <div className="form-grid">{steps.map((step, i) => <label key={step.name}>{step.name} 누적 완료 (개)<input type="number" min="0" max={i === 0 ? progress.target : Number(opening[i-1]) || 0} step="1" required disabled={locked} value={opening[i]} onChange={e=>setOpening(old=>old.map((x,j)=>j===i?e.target.value:x))}/></label>)}</div>
            <button className="primary-btn record-btn" disabled={locked}>기존 수량 확인 및 시작</button>
          </form> : <>
            <div className="shipment-summary"><span>누적 출고 <strong>{progress.shipped.toLocaleString()}개</strong></span><span>출고 잔량 <strong>{progress.remaining.toLocaleString()}개</strong></span></div>
            <div className="stage-quantities">{steps.map((step,i)=><div key={step.name}><span>{step.name} 완료</span><strong>{progress.completed[i].toLocaleString()}<small> / {progress.target.toLocaleString()}</small></strong></div>)}</div>
            <div className="panel-divider"/>
            <div className="panel-title"><div><span className="step-number">03</span><div><h2>{steps[selected].name} 수량 기록</h2><p>이번 처리 수량이 기존 실적에 추가됩니다.</p></div></div></div>
            <p className="available-quantity">현재 처리 가능 <strong>{progress.available[selected].toLocaleString()}개</strong> · {selected === 0 ? `목표 수량 중 ${steps[selected].name} 미처리 수량` : `${steps[selected-1].name} 완료 수량 중 ${steps[selected].name} 미처리 수량`}</p>
            <form onSubmit={record}>
              <label className="full-label">이번 처리 수량 (개)<input ref={quantityRef} type="number" min="1" max={progress.available[selected]} step="1" required disabled={locked || camera || progress.available[selected] === 0} value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="실제로 처리한 수량을 입력하세요"/></label>
              <label className="full-label">메모 (선택)<input value={note} disabled={locked || camera} maxLength={500} onChange={e=>setNote(e.target.value)} placeholder="출고처, 생산 회차, 특이사항 등"/></label>
              <button className="primary-btn record-btn" disabled={locked || camera || progress.available[selected] === 0 || !quantity}>{steps[selected].name} 수량 기록</button>
            </form>
          </>}
          <div className="process-history"><h3>최근 처리 이력</h3>{historyError ? <p role="alert">{historyError}</p> : !history.length ? <p>처리 기록이 없습니다.</p> : <ul>{history.map(event=><li key={event.event_id}><div><strong>{steps[event.step].name} {event.quantity > 0 ? "+" : ""}{event.quantity.toLocaleString()}개</strong><span>{new Date(event.created_at).toLocaleString("ko-KR")} · {event.kind === "opening" ? "기존 수량 확인" : event.kind === "reversal" ? "취소" : reversed.has(event.event_id) ? "취소된 기록" : "완료"}</span>{event.note && <span>{event.note}</span>}</div>{event.kind === "completion" && !reversed.has(event.event_id) && <button className="edit-btn" disabled={locked || camera} onClick={()=>reverse(event)}>기록 취소</button>}</li>)}</ul>}</div>
        </section>}
        {pending && <div className="alert" role="status">저장 결과 확인이 필요합니다. 같은 요청으로 다시 확인해 주세요.<button type="button" className="secondary-btn" disabled={busy} onClick={()=>save(null)}>같은 기록 확인 / 재시도</button></div>}
        {result && <div role="status" className={result.ok ? "scan-result success" : "scan-result failure"}>{result.ok ? <CheckCircle2/> : <XCircle/>}<div><strong>{result.title}</strong><span>{result.detail}</span></div></div>}
      </div>
      <p className="scanner-note">앞 공정 완료 수량 안에서 순차 처리됩니다. 목표 수량 전부가 출고되어야 출고 완료로 표시됩니다.</p>
    </div>
  </main>;
}
