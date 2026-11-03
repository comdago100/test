"use client";
import Pagination,{usePagination} from "../Pagination";
import {useEffect,useState} from "react";
import Link from "next/link";
import ErpShell,{useErpData,useErpMutation} from "../ErpShared";
import {qty,money,koreanToday,receiptAmount} from "../../lib/erp-data";
import {erpSheets} from "../../lib/erp-export";
import {downloadWorkbook} from "../../lib/excel-download";
import {exportFilename} from "../../lib/production-export";
const TABLES=["material_receipts","clients","raw_materials"];
const blank=()=>({client_code:"",raw_code:"",received_on:koreanToday(),quantity:"",unit_price:"",notes:""});
export default function Purchases(){
 const state=useErpData(TABLES),mutation=useErpMutation(state.refresh),[form,setForm]=useState(blank),[editing,setEditing]=useState(null),[query,setQuery]=useState(""),[filter,setFilter]=useState("active"),[error,setError]=useState(""),[exporting,setExporting]=useState(false);
 useEffect(()=>{if(mutation.success){setForm(blank());setEditing(null);setError("");}},[mutation.success]);
 const clients=state.data.clients,materials=state.data.raw_materials,names=Object.fromEntries(clients.map(c=>[c.client_code,c.client_name])),rawNames=Object.fromEntries(materials.map(m=>[m.raw_code,m.raw_name]));
 const disabled=state.loading||Boolean(state.error)||mutation.busy||Boolean(mutation.pending),change=(key,value)=>setForm(old=>({...old,[key]:value}));
 const rows=state.data.material_receipts.filter(r=>(filter==="all"||filter==="active"&&!r.is_void||filter==="void"&&r.is_void)&&[r.client_code,names[r.client_code],r.raw_code,rawNames[r.raw_code],r.notes,r.kind==="opening"?"기초조정":"구매 입고"].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
 const pager=usePagination(rows,query+'|'+filter,'purchases');
 function reset(){setForm(blank());setEditing(null);setError("");}
 async function save(e){e.preventDefault();if(disabled)return;setError("");
  if(!Number.isFinite(Number(form.quantity))||Number(form.quantity)<=0||form.unit_price===""||!Number.isFinite(Number(form.unit_price))||Number(form.unit_price)<0)return setError("입고 수량과 단가를 확인하세요.");
  const result=await mutation.run("save_material_receipt",{p_data:form,p_create:!editing,p_expected_revision:editing?.revision??null});if(result)reset();
 }
 async function cancel(row){if(disabled||!window.confirm("이 입고를 취소할까요? 재고에서 제외되며 원본과 정정 이력은 보존됩니다."))return;
  const result=await mutation.run("void_material_receipt",{p_receipt_id:row.receipt_id,p_expected_revision:row.revision});if(result&&editing?.receipt_id===row.receipt_id)reset();
 }
 async function download(){if(exporting)return;setExporting(true);setError("");try{await downloadWorkbook(erpSheets("receipts",rows,{clients:names,materials:rawNames}),exportFilename("구매입고"));}catch(e){setError(e.message);}finally{setExporting(false);}}
 return <ErpShell title="구매·입고" kicker="PURCHASE RECEIPTS" description="원재료 실입고를 등록하고 작업지시 투입량과 재고를 연결합니다." state={state} mutation={mutation}>
  <section className="erp-card"><h2>{editing?"구매 입고 수정":"구매 입고 등록"}</h2><form onSubmit={save}><fieldset className="form-grid" disabled={disabled}>
   <label>매입처 *<select aria-label="매입처" required value={form.client_code} onChange={e=>change("client_code",e.target.value)}><option value="">선택하세요</option>{clients.filter(c=>c.is_active!==false&&["supplier","both"].includes(c.client_type)||c.client_code===editing?.client_code).map(c=><option key={c.client_code} value={c.client_code}>{c.client_name} ({c.client_code})</option>)}</select></label>
   <label>입고 원재료 *<select aria-label="입고 원재료" required value={form.raw_code} onChange={e=>change("raw_code",e.target.value)}><option value="">선택하세요</option>{materials.filter(m=>m.unit==="kg").map(m=><option key={m.raw_code} value={m.raw_code}>{m.raw_name} ({m.raw_code})</option>)}</select></label>
   <label>구매·입고일 *<input required type="date" value={form.received_on} onChange={e=>change("received_on",e.target.value)}/></label>
   <label>구매 수량 (kg) *<input required type="number" min="0.000001" step="any" value={form.quantity} onChange={e=>change("quantity",e.target.value)}/></label>
   <label>구매 단가 (원/kg) *<input required type="number" min="0" step="any" value={form.unit_price} onChange={e=>change("unit_price",e.target.value)}/></label>
   <label>예상 총액<input readOnly value={receiptAmount(form.quantity,form.unit_price)==null?"—":money(receiptAmount(form.quantity,form.unit_price))}/></label>
   <label className="erp-wide">입고 메모<textarea maxLength={2000} rows={2} value={form.notes} onChange={e=>change("notes",e.target.value)}/></label>
  </fieldset><p className="registry-hint">총액은 kg 수량 × 단가를 원 단위로 반올림합니다. 기초재고는 <Link href="/inventory/">재고 현황</Link>에서 실사 수량으로 등록하세요.</p><div className="erp-actions">{editing&&<button type="button" className="secondary-btn" disabled={disabled} onClick={reset}>수정 취소</button>}<button className="primary-btn" disabled={disabled}>{editing?"입고 수정 저장":"입고 등록"}</button></div></form></section>
  {error&&<div className="alert" role="alert">{error}</div>}
  <section className="board"><div className="board-heading"><div><h2>입고 내역 {rows.length}건</h2><p>입고 수정·취소는 재고에 즉시 반영됩니다.</p></div><div className="erp-actions"><input aria-label="입고 검색" placeholder="매입처·원재료 검색" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="입고 상태 필터" value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">유효 입고</option><option value="all">전체</option><option value="void">취소 입고</option></select><button type="button" className="secondary-btn" disabled={disabled||exporting||!rows.length} onClick={download}>엑셀 자료받기</button></div></div>
  <Pagination pager={pager}/>{state.loading?<div className="empty">입고를 불러오는 중...</div>:!rows.length?<div className="empty">표시할 입고가 없습니다.</div>:<div className="erp-table-scroll"><table className="registry-table erp-table"><thead><tr>{["입고일","구분 / 매입처","원재료","수량(kg)","단가(원/kg)","총액","상태","관리"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{pager.rows.map(row=><tr key={row.receipt_id}><td>{row.received_on}</td><td>{row.kind==="opening"?"기초조정":names[row.client_code]||row.client_code}</td><td>{rawNames[row.raw_code]||row.raw_code}<small>{row.notes}</small></td><td>{qty(row.quantity)}</td><td>{row.kind==="opening"?"—":money(row.unit_price)}</td><td>{row.kind==="opening"?"—":money(row.amount)}</td><td>{row.is_void?"취소":"유효"}</td><td><div className="erp-actions">{row.kind==="opening"?<Link className="edit-btn" href={`/inventory/?raw_code=${encodeURIComponent(row.raw_code)}`}>기초 확인</Link>:<button type="button" className="edit-btn" disabled={disabled||row.is_void} onClick={()=>{setEditing({...row});setForm({...row});document.querySelector(".erp-card")?.scrollIntoView({behavior:"smooth"});}}>입고 수정</button>}<button type="button" className="delete-btn" disabled={disabled||row.is_void} onClick={()=>cancel(row)}>취소 / 삭제</button></div></td></tr>)}</tbody></table></div>}
  <Pagination pager={pager} compact/></section>
 </ErpShell>;
}
