"use client";
import Pagination,{usePagination} from "../Pagination";
import {useEffect,useState} from "react";
import Link from "next/link";
import ErpShell,{useErpData,useErpMutation} from "../ErpShared";
import {supabase} from "../../lib/supabase";
import {qty,rowQuery,erpRows,erpMessage} from "../../lib/erp-data";
import {erpSheets} from "../../lib/erp-export";
import {downloadWorkbook} from "../../lib/excel-download";
import {exportFilename} from "../../lib/production-export";
const TABLES=["material_inventory","finished_inventory","finished_inventory_orders"];
const timestamp=value=>value?new Date(value).toLocaleString("ko-KR",{timeZone:"Asia/Seoul",hour12:false}):"—";
function bounds(from,to){return {from:from?`${from}T00:00:00+09:00`:null,until:to?new Date(new Date(`${to}T00:00:00+09:00`).valueOf()+86400000).toISOString():null};}
function changeDescription(value,maps){
 if(!value)return "없음";
 if(value.raw_code)return `${maps.materials[value.raw_code]||value.raw_code} · ${qty(value.input_qty??value.quantity)}kg${value.received_on?` · ${value.received_on}`:""}${value.is_void?" · 취소":""}${value.notes?` · ${value.notes}`:""}`;
 if(value.process_quantities)return `${maps.items[value.item_code]||value.item_code} · ${(value.routing_steps||[]).map(s=>`${s.name} ${qty(value.process_quantities[s.key||s.name])}개`).join(" / ")}`;
 return `${qty(value.quantity)}개${value.note?` · ${value.note}`:""}`;
}

function History({selected,maps,close}){
 const [from,setFrom]=useState(""),[to,setTo]=useState(""),[page,setPage]=useState(0),[version,setVersion]=useState(0),[cap,setCap]=useState(null);
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[exporting,setExporting]=useState(false);
 useEffect(()=>{document.querySelector(".erp-history")?.scrollIntoView({behavior:"smooth",block:"start"});},[]);
 const filters=[["stock_kind",selected.kind],[selected.kind==="material"?"raw_code":"item_code",selected.code]];
 const options={filters,order:"occurred_at",...bounds(from,to),maxId:cap};
 useEffect(()=>{let active=true;setLoading(true);setCap(null);setPage(0);setError("");
  async function snapshot(){try{const {data,error}=await rowQuery(supabase,"inventory_movements",{filters,order:"movement_id"}).range(0,0);if(error)throw error;if(active)setCap(data?.[0]?.movement_id||0);}catch(e){if(active){setError(erpMessage(e));setLoading(false);}}}snapshot();return()=>{active=false;};
 },[selected.kind,selected.code,version]);
 useEffect(()=>{if(cap===null)return;let active=true;setLoading(true);setError("");
  async function load(){try{if(from&&to&&from>to)throw Error("조회 종료일은 시작일보다 빠를 수 없습니다.");const {data,error}=await rowQuery(supabase,"inventory_movements",options).range(page*100,page*100+100);if(error)throw error;if(active)setRows(data||[]);}catch(e){if(active)setError(erpMessage(e));}finally{if(active)setLoading(false);}}load();return()=>{active=false;};
 },[cap,page,from,to,selected.kind,selected.code]);
 async function download(){setExporting(true);setError("");try{const all=await erpRows(supabase,"inventory_movements",options);await downloadWorkbook(erpSheets("movements",all,maps),exportFilename("수불이력"));}catch(e){setError(erpMessage(e));}finally{setExporting(false);}}
 return <section className="board erp-history" aria-label="수불 이력"><div className="board-heading"><div><h2>{selected.name} 수불 이력</h2><p>거래 일시와 정정 기록 일시를 함께 보관합니다. 작업지시를 삭제해도 이력은 유지됩니다.</p></div><button className="secondary-btn" type="button" onClick={close}>이력 닫기</button></div>
  <div className="erp-history-tools"><label>조회 시작일<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(0);}}/></label><label>조회 종료일<input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(0);}}/></label><button type="button" className="secondary-btn" disabled={loading} onClick={()=>setVersion(v=>v+1)}>최신 이력 조회</button><button type="button" className="secondary-btn" disabled={loading||exporting||cap===null||Boolean(error)} onClick={download}>{exporting?"자료 준비 중...":"조회 조건 전체 엑셀"}</button></div>
  {error&&<div className="alert" role="alert">{error}</div>}{loading?<div className="empty">이력을 불러오는 중...</div>:error?null:!rows.length?<div className="empty">해당 기간의 이력이 없습니다.</div>:<div className="erp-table-scroll"><table className="registry-table erp-table"><thead><tr>{["거래 일시 (한국시간)","구분","재고 증감","보류 증감","작업지시 / 원본","기록 일시"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(0,100).map(r=><tr key={r.movement_id}><td>{timestamp(r.occurred_at)}</td><td>{r.event_kind}</td><td>{Number(r.quantity_delta)>0?"+":""}{qty(r.quantity_delta)} {selected.kind==="material"?"kg":"개"}</td><td>{selected.kind==="material"?"—":`${Number(r.held_delta)>0?"+":""}${qty(r.held_delta)}개`}</td><td>{r.wo_id?<Link href={`/orders/?wo_id=${encodeURIComponent(r.wo_id)}`}>{r.wo_id}</Link>:r.source_type==="material_receipts"?"입고 내역":"기초 이력"}<small>기록 #{r.movement_id}</small><details><summary>변경 내용</summary><p>변경 전: {changeDescription(r.before_data,maps)}</p><p>변경 후: {changeDescription(r.after_data,maps)}</p></details></td><td>{timestamp(r.recorded_at)}</td></tr>)}</tbody></table></div>}
  <div className="erp-paging"><button type="button" className="secondary-btn" disabled={loading||page===0} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page+1}페이지 · 100건씩</span><button type="button" className="secondary-btn" disabled={loading||Boolean(error)||rows.length<=100} onClick={()=>setPage(p=>p+1)}>다음</button></div>
 </section>;
}

export default function Inventory(){
 const state=useErpData(TABLES),mutation=useErpMutation(state.refresh),[tab,setTab]=useState("material"),[query,setQuery]=useState(""),[selected,setSelected]=useState(null),[opening,setOpening]=useState(null),[counted,setCounted]=useState(""),[note,setNote]=useState(""),[error,setError]=useState(""),[exporting,setExporting]=useState(false);
 useEffect(()=>{if(mutation.success){setOpening(null);setCounted("");setNote("");setError("");}},[mutation.success]);
 useEffect(()=>{if(opening)document.querySelector('[aria-label="기초재고 확인"]')?.scrollIntoView({behavior:"smooth",block:"start"});},[opening]);
 useEffect(()=>{const code=new URLSearchParams(window.location.search).get("raw_code");if(code)setQuery(code);},[]);
 const materials=state.data.material_inventory,products=state.data.finished_inventory,orders=state.data.finished_inventory_orders;
 const maps={materials:Object.fromEntries(materials.map(r=>[r.raw_code,r.raw_name])),items:Object.fromEntries(products.map(r=>[r.item_code,r.item_name]))};
 const filtered=(tab==="material"?materials:products).filter(r=>[r.raw_code,r.raw_name,r.item_code,r.item_name].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
 const disabled=state.loading||Boolean(state.error)||mutation.busy||Boolean(mutation.pending);
 const pager=usePagination(filtered,query+'|'+tab,'inventory');
 async function saveOpening(e){e.preventDefault();if(disabled)return;setError("");if(counted===""||!Number.isFinite(Number(counted))||Number(counted)<0)return setError("실사 수량은 0 이상의 kg 수량으로 입력하세요.");
  const result=await mutation.run("save_material_opening",{p_raw_code:opening.raw_code,p_counted_qty:counted,p_stock_revision:opening.stock_revision,p_note:note});if(result){setOpening(null);setCounted("");setNote("");}
 }
 async function download(){setExporting(true);setError("");try{await downloadWorkbook(erpSheets(tab==="material"?"materials":"products",filtered,maps),exportFilename(tab==="material"?"원재료재고":"완제품재고"));}catch(e){setError(e.message);}finally{setExporting(false);}}
 function history(kind,code,name){setSelected({kind,code,name});}
 return <ErpShell title="재고 현황" kicker="INVENTORY" description="입고·투입·생산·출고 기록으로 현재고를 자동 계산합니다." state={state} mutation={mutation}>
  <section className="erp-card"><div className="erp-tabs" role="group" aria-label="재고 구분">{[["material","원재료 재고"],["product","완제품 재고"]].map(([key,label])=><button key={key} className={tab===key?"primary-btn":"secondary-btn"} aria-pressed={tab===key} onClick={()=>{setTab(key);setQuery("");}}>{label}</button>)}</div>
   <p className="registry-hint">{tab==="material"?"현재고 = 구매 입고 + 기초조정 − 작업지시 원재료 투입. 기존 입고가 미등록된 자재는 실제 보유량을 실사해 기초재고를 확인하세요.":"출고 직전 공정의 완료 수량에서 누적 출고를 차감합니다. 출고 단계 폐기는 실보유에서 제외하고, 불량 보류는 출고 가능 수량에서 추가로 제외합니다."}</p>
   <div className="erp-actions"><input aria-label="재고 검색" placeholder="코드·품목명 검색" value={query} onChange={e=>setQuery(e.target.value)}/><button className="secondary-btn" type="button" disabled={disabled||exporting||!filtered.length} onClick={download}>엑셀 자료받기</button></div>
  </section>
  {opening&&<section className="erp-card" aria-label="기초재고 확인"><h2>{opening.raw_name} 기초재고 확인</h2><p className="registry-hint">현재 계산 재고 {qty(opening.on_hand)}kg와 실제 보유량의 차이를 기초조정으로 반영합니다. 입력 도중 입고·투입이 바뀌면 저장을 막으므로 수량을 다시 확인하세요.</p><form onSubmit={saveOpening}><fieldset className="form-grid" disabled={disabled}><label>실제 보유 수량 (kg)<input required type="number" min="0" step="any" value={counted} onChange={e=>setCounted(e.target.value)}/></label><label>실사 메모<input maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder="실사 기준 또는 확인자"/></label></fieldset><div className="erp-actions"><button className="secondary-btn" type="button" onClick={()=>setOpening(null)}>닫기</button><button className="primary-btn" disabled={disabled}>기초재고 반영</button></div></form></section>}
  {error&&<div className="alert" role="alert">{error}</div>}
  <section className="board"><div className="board-heading"><div><h2>{tab==="material"?"원재료":"완제품"} {filtered.length}종</h2><p>{tab==="material"?"kg 단위 · 음수 재고도 그대로 표시합니다.":"개 단위 · 수량 미확인 작업은 합계에서 제외하고 별도로 표시합니다."}</p></div></div>
   <Pagination pager={pager}/>{state.loading?<div className="empty">재고를 불러오는 중...</div>:!filtered.length?<div className="empty">표시할 품목이 없습니다.</div>:tab==="material"?<div className="erp-table-scroll"><table className="registry-table erp-table"><thead><tr>{["원재료","구매 입고(kg)","기초조정(kg)","투입(kg)","현재고(kg)","관리"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{pager.rows.map(r=><tr key={r.raw_code}><td>{r.raw_name}<small>{r.raw_code} · {r.opening_confirmed?"기초 확인":"기초 미확인"}</small></td><td>{qty(r.purchased_qty)}</td><td>{qty(r.opening_qty)}</td><td>{qty(r.used_qty)}</td><td className={Number(r.on_hand)<0?"erp-negative":"erp-stock"}>{qty(r.on_hand)}</td><td><div className="erp-actions"><button type="button" className="edit-btn" onClick={()=>history("material",r.raw_code,r.raw_name)}>수불 이력</button><button type="button" className="edit-btn" disabled={disabled||r.unit!=="kg"} onClick={()=>{setOpening({...r});setCounted("");setNote("");setError("");}}>기초재고 확인</button></div></td></tr>)}</tbody></table></div>:pager.rows.map(r=><article className="erp-record" key={r.item_code}><div className="section-row"><div><h3>{r.item_name}</h3><p>{r.item_code}</p></div><button type="button" className="secondary-btn" onClick={()=>history("product",r.item_code,r.item_name)}>수불 이력</button></div>
    {Number(r.untracked_count)>0&&<p className="quantity-notice">미확인 작업 {qty(r.untracked_count)}건이 있습니다. 아래 수량은 확인된 작업의 소계이며 전체 재고는 확인이 필요합니다.</p>}
    <div className="erp-metrics">{[["생산 완료",r.produced_qty],["누적 출고",r.shipped_qty],["출고 전 잔량",r.before_quality],["출고 단계 폐기",r.scrapped_qty],["실보유 재고",r.on_hand],["불량 보류",r.held_qty],["출고 가능",r.available_qty]].map(([label,value])=><div key={label}><span>{label}</span><strong>{qty(value)}개</strong></div>)}</div>
    <details className="erp-work-breakdown"><summary>작업지시별 재고 확인</summary>{orders.filter(w=>w.item_code===r.item_code).map(w=><div key={w.wo_id}><Link href={`/orders/?wo_id=${encodeURIComponent(w.wo_id)}`}>{w.wo_id}</Link><span>{w.routing_name}</span>{w.tracked?<span>실보유 {qty(w.on_hand)}개 · 보류 {qty(w.held_qty)}개 · 출고 가능 {qty(w.available_qty)}개</span>:<span className="erp-negative">{w.issue}</span>}</div>)}</details>
   </article>)}
  <Pagination pager={pager} compact/></section>
  {selected&&<History key={`${selected.kind}:${selected.code}`} selected={selected} maps={maps} close={()=>setSelected(null)}/>}
 </ErpShell>;
}
