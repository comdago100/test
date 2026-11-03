"use client";
import { useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { buildProductionSheets, exportFilename, historyBounds } from "../lib/production-export";
import { fetchProductionEvents, fetchQualityEvents } from "../lib/production-export-data";
import { downloadWorkbook } from "../lib/excel-download";

export default function ProductionExport({ data, close }) {
  const [scope, setScope] = useState("current");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const busyRef = useRef(false);
  const selected = scope === "current" ? data.currentOrders : data.orders;

  async function download(event) {
    event.preventDefault();
    if (busyRef.current) return;
    setError(""); setSuccess("");
    try { historyBounds(start, end); }
    catch (error) { setError(error.message); return; }
    if (!selected.length) { setError("받을 작업지시가 없습니다. 대상 범위를 변경하세요."); return; }
    busyRef.current = true; setBusy(true);
    try {
      if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.");
      const generatedAt = new Date();
      const options = { start, end, generatedAt, snapshotAt: data.updated, query: scope === "current" ? data.query : "",
        filter: scope === "current" ? data.filter : "전체",
        scopeLabel: scope === "current" ? "현재 조회 결과" : "전체 작업지시" };
      const events = await fetchProductionEvents(supabase, selected.map(order => order.wo_id), options);
      const qualityOrders=selected.filter(order=>order.quality_quantities!=null);
      const qualityEvents=qualityOrders.length?await fetchQualityEvents(supabase,qualityOrders.map(order=>order.wo_id),options):undefined;
      await downloadWorkbook(buildProductionSheets({ ...data, orders: selected, events, qualityEvents }, options), exportFilename("생산자료", generatedAt));
      setSuccess(`작업지시 ${selected.length.toLocaleString()}건과 관련 자료를 엑셀로 받았습니다.`);
    } catch (error) { setError(error.message || "엑셀 파일을 만들지 못했습니다. 다시 시도하세요."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busyRef.current) close(); }}>
    <section className="manager-modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="modal-heading"><div><span className="section-kicker">EXCEL DOWNLOAD</span><h2 id="export-title">생산 자료 엑셀 받기</h2><p>작업지시별 생산·출고·자재 자료를 한 파일로 받습니다.</p></div><button type="button" className="icon-btn" aria-label="엑셀 창 닫기" disabled={busy} onClick={close}><X size={18}/></button></div>
      <form onSubmit={download}>
        <fieldset disabled={busy} className="form-grid export-fields">
          <label className="export-scope">대상 범위<select aria-label="대상 범위" value={scope} onChange={event => {setScope(event.target.value); setSuccess("");}}><option value="current">현재 조회 결과 ({data.currentOrders.length.toLocaleString()}건)</option><option value="all">전체 작업지시 ({data.orders.length.toLocaleString()}건)</option></select></label>
          <label>실적 시작일 (선택)<input type="date" value={start} onChange={event => {setStart(event.target.value); setSuccess("");}}/></label>
          <label>실적 종료일 (선택)<input type="date" value={end} onChange={event => {setEnd(event.target.value); setSuccess("");}}/></label>
        </fieldset>
        <p className="export-note">기간은 한국 시간 기준으로 공정·출고·불량 처리 이력에 적용합니다. 작업·불량 현황과 원재료 투입은 선택한 작업의 전체 누적 자료입니다.</p>
        <div className="export-includes"><strong>포함되는 시트</strong><ul><li>작업지시 현황 · 목표, 납기, 공정별 완료 수량, 출고 잔량</li><li>공정별 수량 · 각 공정의 누적 완료와 현재 처리 가능 수량</li><li>공정 처리 이력 · 완료·취소·기초수량 확인 기록</li><li>출고 이력 · 날짜별 분할 출고와 취소 수량</li><li>원재료 투입 · 작업지시별 원재료와 투입 중량(kg)</li><li>조회조건 · 대상, 기간, 자료 기준 시각과 수량 해석 안내</li></ul></div>
        {error && <div className="alert" role="alert">{error}</div>}
        {data.orders.some(order=>order.quality_quantities!=null)&&<p className="export-note">불량 관리가 적용된 작업은 불량 현황·불량 처리 이력 시트도 포함합니다.</p>}
        {success && <div className="scan-result success" role="status">{success}</div>}
        <div className="form-actions"><div/><button type="button" className="secondary-btn" onClick={close} disabled={busy}>닫기</button><button className="primary-btn" disabled={busy || !selected.length}><Download size={17}/>{busy ? "자료 준비 중…" : "엑셀 파일 받기"}</button></div>
      </form>
    </section>
  </div>;
}
