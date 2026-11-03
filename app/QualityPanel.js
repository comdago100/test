"use client";
import {useEffect,useId,useRef,useState} from "react";
import {supabase} from "../lib/supabase";
import {getProgress,validateQuantity} from "../lib/workflow";
import {defectReasons,qualityKinds,qualityStatus} from "../lib/quality-utils";

export default function QualityPanel({order,selected,locked,onSave}) {
  const [source,setSource]=useState("available"),[quantity,setQuantity]=useState(""),[reason,setReason]=useState(""),[note,setNote]=useState("");
  const [defects,setDefects]=useState([]),[history,setHistory]=useState([]),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState(""),[error,setError]=useState("");
  const [showAll,setShowAll]=useState(false),[resolution,setResolution]=useState(null);
  const generation=useRef(0),reasonsId=useId();
  const p=getProgress(order),step=p.steps[selected],ready=order.quality_quantities!=null;
  const available=source==="completed"?p.defectAvailable[selected]:p.available[selected];
  const disabled=locked||loading||Boolean(loadError);
  async function refresh(){
    if(!ready)return;
    const request=++generation.current;setLoading(true);setLoadError("");
    try{
      const cases=(async()=>{const rows=[];for(let start=0;;start+=1000){const {data,error}=await supabase.from("production_defects").select("*").eq("wo_id",order.wo_id).order("created_at",{ascending:false}).order("defect_id").range(start,start+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}})();
      const [all,events]=await Promise.all([cases,supabase.from("production_quality_events").select("*").eq("wo_id",order.wo_id).order("created_at",{ascending:false}).order("event_id").limit(30)]);
      if(events.error)throw events.error;
      if(request===generation.current){setDefects(all);setHistory(events.data||[]);}
    }catch(e){if(request===generation.current)setLoadError("불량 이력을 불러오지 못했습니다. 새로고침 후 다시 확인하세요.");}
    finally{if(request===generation.current)setLoading(false);}
  }
  useEffect(()=>{refresh();return()=>{generation.current++;};},[order,ready]);
  useEffect(()=>{setQuantity("");setSource("available");setError("");},[selected]);
  async function report(e){
    e.preventDefault();if(disabled)return;setError("");
    const validation=validateQuantity(quantity,available);
    if(validation)return setError(validation);
    if(!reason.trim())return setError("불량 사유를 입력하세요.");
    const ok=await onSave({rpc:"record_production_defect",args:{p_wo_id:order.wo_id,p_step:selected,p_quantity:Number(quantity),p_source:source,p_reason:reason.trim(),p_request_id:crypto.randomUUID(),p_note:note.trim()},title:`${step.name} 불량 ${Number(quantity).toLocaleString()}개를 보류했습니다`});
    if(ok){setQuantity("");setReason("");setNote("");}
  }
  async function dispose(e,defect){
    e.preventDefault();if(disabled)return;setError("");
    const validation=validateQuantity(resolution.quantity,Number(defect.held_qty));if(validation)return setError(validation);
    if(resolution.kind==="cancel"&&!window.confirm("실제 불량 처리가 아닌 잘못 입력한 불량 등록을 취소합니다. 계속할까요?"))return;
    const ok=await onSave({rpc:"resolve_production_defect",args:{p_wo_id:order.wo_id,p_defect_id:defect.defect_id,p_kind:resolution.kind,p_quantity:Number(resolution.quantity),p_request_id:crypto.randomUUID(),p_note:resolution.note.trim()},title:`${qualityKinds[resolution.kind]} ${Number(resolution.quantity).toLocaleString()}개를 기록했습니다`});
    if(ok)setResolution(null);
  }
  async function reverse(event){
    if(disabled||!window.confirm("이 불량 처리 기록을 취소할까요? 재투입 수량을 이미 사용했거나 보충 생산한 경우에는 관련 실적을 먼저 확인해야 합니다."))return;
    await onSave({rpc:"reverse_production_quality",args:{p_wo_id:order.wo_id,p_event_id:event.event_id,p_request_id:crypto.randomUUID(),p_note:"불량 처리 입력 정정"},title:"불량 처리 기록을 취소했습니다"});
  }
  const reversed=new Set(history.filter(e=>e.reversal_of).map(e=>e.reversal_of));
  const visible=showAll?defects:defects.filter(d=>Number(d.held_qty)>0);
  return <section className="quality-panel" aria-labelledby="quality-title"><div className="section-row"><div><h3 id="quality-title">불량 관리</h3><p>불량은 보류로 분리한 뒤 재작업·폐기로 처리합니다.</p></div></div>
    {!ready?<div className="alert" role="status">불량 관리 DB 설정이 필요합니다. <a href="https://github.com/comdago100/test/blob/main/supabase/quality_management.sql" target="_blank" rel="noreferrer">설정 SQL 열기</a></div>:<>
      <div className="quality-summary"><span>불량 보류 <strong>{p.heldTotal.toLocaleString()}개</strong></span><span>확정 폐기 <strong>{p.scrapTotal.toLocaleString()}개</strong></span></div>
      <details className="quality-register"><summary>{step.name} 불량 등록</summary><p>20개 작업 중 3개가 불량이면 양품은 위에서 17개, 불량은 여기서 3개로 기록하세요. 이미 20개를 완료했다면 ‘완료 실적에서 분리’를 선택합니다.</p>
        <form onSubmit={report}><fieldset disabled={disabled} className="form-grid">
          <label>불량 수량 기준<select aria-label="불량 수량 기준" value={source} onChange={e=>{setSource(e.target.value);setQuantity("");}}><option value="available">아직 완료하지 않은 수량</option>{step.role!=="shipment"&&<option value="completed">완료 실적에서 분리</option>}</select></label>
          <label>불량 수량 (개)<input type="number" required min="1" max={available} step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
          <label>불량 사유<input list={reasonsId} required maxLength={100} value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 균열, 기공, 치수 불량"/><datalist id={reasonsId}>{defectReasons.map(r=><option key={r} value={r}/>)}</datalist></label>
          <label>불량 메모<input maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} placeholder="발견 위치, 작업자, 원인 등"/></label>
        </fieldset><p className="quality-help">등록 가능 {available.toLocaleString()}개 · {source==="completed"?"후속 공정에 이미 사용된 수량은 분리할 수 없습니다. 실제 발견한 공정에서 등록하세요.":"보류된 수량은 이번 공정 완료 수량에 포함되지 않습니다."}</p><button type="submit" className="secondary-btn" disabled={disabled||available<=0}>불량 보류 등록</button></form>
      </details>
      <p className="quality-help">재작업 후 재투입은 해당 공정의 처리 대기로 돌아갑니다. 검사 후 위의 수량 기록에서 양품 완료를 다시 입력하세요. 폐기 수량만큼 첫 공정에서 보충 생산할 수 있습니다. 출고한 제품의 반품은 이 기능으로 처리하지 않습니다.</p>
      {loadError&&<div className="alert" role="alert">{loadError}<button type="button" className="secondary-btn" disabled={locked||loading} onClick={refresh}>불량 이력 새로고침</button></div>}
      <div className="section-row"><h4>불량 건 {visible.length}건</h4><label>표시 범위<select aria-label="불량 표시 범위" value={showAll?"all":"held"} onChange={e=>setShowAll(e.target.value==="all")}><option value="held">보류 중</option><option value="all">전체 불량</option></select></label></div>
      {loading?<p>불량 이력을 불러오는 중...</p>:!visible.length?<p className="quality-help">{showAll?"등록된 불량이 없습니다.":"처리할 보류 불량이 없습니다."}</p>:<ul className="quality-cases">{visible.map(d=><li key={d.defect_id}><div className="section-row"><div><strong>{p.steps[d.step]?.name} · {d.reason}</strong><p>{new Date(d.created_at).toLocaleString("ko-KR")} · {qualityStatus(d)}</p></div>{Number(d.held_qty)>0&&<button type="button" className="secondary-btn" disabled={disabled} onClick={()=>setResolution({id:d.defect_id,kind:"rework",quantity:"",note:""})}>이 불량 처리</button>}</div><p>발생 {Number(d.quantity).toLocaleString()}개 · 보류 {Number(d.held_qty).toLocaleString()}개 · 재투입 {Number(d.reworked_qty).toLocaleString()}개 · 폐기 {Number(d.scrapped_qty).toLocaleString()}개 · 등록 취소 {Number(d.cancelled_qty).toLocaleString()}개</p>{d.note&&<p>{d.note}</p>}
        {resolution?.id===d.defect_id&&Number(d.held_qty)>0&&<form className="quality-resolution" onSubmit={e=>dispose(e,d)}><fieldset disabled={disabled} className="form-grid"><label>불량 처리 방법<select aria-label="불량 처리 방법" value={resolution.kind} onChange={e=>setResolution(old=>({...old,kind:e.target.value}))}><option value="rework">재작업 후 재투입</option><option value="scrap">폐기 확정</option><option value="cancel">불량 등록 취소 (입력 정정)</option></select></label><label>불량 처리 수량 (개)<input type="number" required min="1" max={d.held_qty} step="1" value={resolution.quantity} onChange={e=>setResolution(old=>({...old,quantity:e.target.value}))}/></label><label>불량 처리 메모<input maxLength={1000} value={resolution.note} onChange={e=>setResolution(old=>({...old,note:e.target.value}))}/></label></fieldset><div className="quality-actions"><button type="button" className="secondary-btn" onClick={()=>setResolution(null)} disabled={disabled}>닫기</button><button className="primary-btn" disabled={disabled}>불량 처리 저장</button></div></form>}
      </li>)}</ul>}
      <details className="quality-history"><summary>최근 불량 처리 이력</summary><ul>{history.map(event=><li key={event.event_id}><div><strong>{p.steps[event.step]?.name} · {qualityKinds[event.kind]} {Number(event.quantity)>0?"+":""}{Number(event.quantity).toLocaleString()}개</strong><span>{new Date(event.created_at).toLocaleString("ko-KR")}{event.reason&&` · ${event.reason}`}{reversed.has(event.event_id)&&" · 취소됨"}</span>{event.note&&<span>{event.note}</span>}</div>{["rework","scrap","cancel"].includes(event.kind)&&!reversed.has(event.event_id)&&<button type="button" className="edit-btn" disabled={disabled} onClick={()=>reverse(event)}>불량 처리 취소</button>}</li>)}</ul></details>
    </>}{error&&<div className="alert" role="alert">{error}</div>}
  </section>;
}
