"use client";
import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import { dateText, getProgress, steps } from "../lib/workflow";

export default function OrderPrint({ order, clientName, itemName, usage, materialNames, close }) {
  const progress = getProgress(order);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    import("qrcode").then(module => (module.default || module).toDataURL(order.wo_id, { width: 280, margin: 2 }))
      .then(url => { if (alive) setQr(url); })
      .catch(() => { if (alive) setError("QR 코드를 만들지 못했습니다."); });
    return () => { alive = false; };
  }, [order.wo_id]);
  return <div className="print-backdrop" role="dialog" aria-modal="true" aria-labelledby="print-title">
    <section className="print-sheet">
      <div className="print-tools"><button className="primary-btn" onClick={() => window.print()} disabled={!qr}><Printer size={17}/> 인쇄 / PDF 저장</button><button className="icon-btn" onClick={close} aria-label="인쇄 미리보기 닫기"><X size={18}/></button></div>
      <h1 id="print-title">작업지시서</h1>
      <div className="print-order-heading"><div><strong>{order.wo_id}</strong><p>발행일 {dateText(order.created_at)}</p></div>{qr ? <img src={qr} width="150" height="150" alt={order.wo_id + " 스캔용 QR 코드"}/> : <p>{error || "QR 생성 중..."}</p>}</div>
      <table className="print-table"><tbody>
        <tr><th>거래처</th><td>{clientName || order.client_code}</td><th>품목</th><td>{itemName || order.item_code}</td></tr>
        <tr><th>목표 수량</th><td>{Number(order.target_qty).toLocaleString()} 개</td><th>제품 단중</th><td>{order.unit_weight_kg == null ? "—" : order.unit_weight_kg + " kg"}</td></tr>
        <tr><th>작업 시작</th><td>{dateText(order.start_date)}</td><th>납기일</th><td>{dateText(order.due_date)}</td></tr>
        <tr><th>용해 / 로트</th><td>{order.heat_no || "—"}</td><th>재질</th><td>{order.casting_material || "—"}</td></tr>
      </tbody></table>
      <h2>원재료 투입 내역</h2><table className="print-table"><thead><tr><th>원재료</th><th>투입 중량</th></tr></thead><tbody>{usage.length ? usage.map((u,i)=><tr key={u.usage_id || i}><td>{materialNames[u.raw_code] || u.raw_code}</td><td>{Number(u.input_qty).toLocaleString()} kg</td></tr>) : <tr><td colSpan="2">등록된 내역 없음</td></tr>}</tbody></table>
      <h2>공정 확인</h2><div className="print-stages">{steps.map((s,i)=><div key={s.name}><strong>{s.name}</strong><span>{progress.needsOpening ? "기존 수량 확인 필요" : `누적 ${progress.completed[i].toLocaleString()}개 완료`}</span><span>처리일 / 이번 수량 / 확인</span></div>)}</div>
      {!progress.needsOpening && <p className="print-footer">인쇄 시점 · 누적 출고 {progress.shipped.toLocaleString()}개 / 출고 잔량 {progress.remaining.toLocaleString()}개</p>}
      <h2>작업 메모</h2><div className="print-memo">{order.notes || " "}</div>
      <p className="print-footer">각 공정에서 QR 코드를 스캔한 뒤 이번에 처리한 수량을 기록하세요. 같은 지시서로 나눠 작업할 수 있습니다.</p>
    </section>
  </div>;
}
