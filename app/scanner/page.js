"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, CheckCircle2, Factory, Keyboard, ScanLine, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { steps } from "../../lib/workflow";

export default function Scanner() {
  const [selected, setSelected] = useState(0);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [camera, setCamera] = useState(false);
  const scannerRef = useRef(null);
  const inputRef = useRef(null);
  const busyRef = useRef(false);
  const selectedRef = useRef(0);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  async function stopCamera() {
    const reader = scannerRef.current;
    scannerRef.current = null;
    if (reader) { try { if (reader.isScanning) await reader.stop(); reader.clear(); } catch {} }
    setCamera(false);
  }
  useEffect(() => () => { const reader = scannerRef.current; if (reader?.isScanning) reader.stop().catch(() => {}); }, []);

  async function submit(raw) {
    const id = raw.trim();
    if (!id || busyRef.current) return;
    busyRef.current = true; setBusy(true); setResult(null);
    const step = steps[selectedRef.current];
    try {
      if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.");
      const { data, error } = await supabase.from("work_orders").update({ current_step: step.value }).eq("wo_id", id).select("wo_id");
      if (error) throw error;
      if (!data?.length) throw new Error("일치하는 작업지시가 없거나 수정 권한이 없습니다.");
      setResult({ ok: true, title: step.label + " 처리되었습니다", detail: id });
    } catch (e) { setResult({ ok: false, title: "처리하지 못했습니다", detail: e.message || "연결 상태를 확인해 주세요." }); }
    finally { setValue(""); setBusy(false); busyRef.current = false; inputRef.current?.focus(); }
  }
  async function startCamera() {
    setResult(null); setCamera(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      await new Promise(resolve => setTimeout(resolve, 50));
      const reader = new Html5Qrcode("camera-reader");
      scannerRef.current = reader;
      await reader.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, async text => {
        if (busyRef.current) return;
        await stopCamera(); await submit(text);
      }, () => {});
    } catch (e) {
      await stopCamera();
      setResult({ ok: false, title: "카메라를 열 수 없습니다", detail: "카메라 권한과 HTTPS 연결을 확인해 주세요." });
    }
  }

  return <main className="shell scanner-shell">
    <header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><Factory size={20}/></span><span>FOUNDRY<span className="brand-sub"> 공정 관리</span></span></Link><nav className="nav"><Link href="/">생산 현황</Link><Link href="/orders/">작업지시 관리</Link><Link href="/scanner/" className="nav-current">현장 스캔</Link></nav></header>
    <div className="scanner-content">
      <Link href="/" className="back-link"><ArrowLeft size={16}/> 생산 현황으로</Link>
      <div className="eyebrow"><span className="orange-dot"/> SHOP FLOOR</div>
      <h1>현장 공정 스캔</h1><p className="scanner-desc">작업 중인 공정을 선택하고 작업지시서를 스캔하세요.</p>
      <div className="scanner-panel">
        <div className="panel-title"><div><span className="step-number">01</span><div><h2>공정 선택</h2><p>현재 작업 위치를 선택해 주세요.</p></div></div><span className="selected-label">{steps[selected].place}</span></div>
        <div className="station-grid">{steps.map((step, i) => <button type="button" key={step.name} className={selected === i ? "station selected" : "station"} onClick={() => {setSelected(i); inputRef.current?.focus();}}><span className="station-num">0{i+1}</span><strong>{step.name}</strong><small>{step.place}</small></button>)}</div>
        <div className="panel-divider"/>
        <div className="panel-title"><div><span className="step-number">02</span><div><h2>작업지시 스캔</h2><p>QR 코드 또는 바코드 리더기로 지시번호를 입력합니다.</p></div></div></div>
        <div className="scan-area"><div className="scan-icon"><ScanLine size={32}/></div><strong>{steps[selected].place} · {steps[selected].label}</strong><p>작업지시서의 코드를 스캔해 주세요</p>
          {camera ? <><div id="camera-reader"/><button className="secondary-btn" onClick={stopCamera}>카메라 닫기</button></> : <button className="primary-btn camera-btn" type="button" onClick={startCamera}><Camera size={18}/> 카메라로 스캔</button>}
        </div>
        <div className="manual-label"><Keyboard size={16}/> 바코드 리더기 또는 직접 입력</div>
        <form className="scan-form" onSubmit={e => {e.preventDefault(); submit(value);}}><input ref={inputRef} value={value} onChange={e=>setValue(e.target.value)} placeholder="작업지시 번호를 입력하세요" autoComplete="off" aria-label="작업지시 번호"/><button className="primary-btn" disabled={busy || !value.trim()}>{busy ? "처리 중" : "완료 처리"}</button></form>
        {result && <div role="status" className={result.ok ? "scan-result success" : "scan-result failure"}>{result.ok ? <CheckCircle2/> : <XCircle/>}<div><strong>{result.title}</strong><span>{result.detail}</span></div></div>}
      </div>
      <p className="scanner-note">공정 선택 후 스캔하면 해당 작업지시의 현재 상태가 갱신됩니다.</p>
    </div>
  </main>;
}