"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import ErpShell,{useErpData,useErpMutation} from "../ErpShared";
import OrderManager from "../OrderManager";
import {qty,money} from "../../lib/erp-data";
import {dateText} from "../../lib/workflow";
import {erpSheets} from "../../lib/erp-export";
import {exportFilename} from "../../lib/production-export";
import {downloadWorkbook} from "../../lib/excel-download";
import Pagination,{usePagination} from '../Pagination';
import ProductFields,{ProductSummary} from '../ProductFields';
import {itemDetails,detailsText} from '../../lib/product-details';
const TABLES=["sales_order_progress","clients","items","raw_materials"],EMPTY=[];
const blank=()=>({order_no:"",client_code:"",item_code:"",quantity:"",unit_price:"",due_date:"",notes:"",product_details:{}});
export default function Sales(){
 const state=useErpData(TABLES),mutation=useErpMutation(state.refresh),[form,setForm]=useState(blank),[editing,setEditing]=useState(null),[editor,setEditor]=useState(null);
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("전체"),[error,setError]=useState(""),[exporting,setExporting]=useState(false);
 useEffect(()=>{if(mutation.success){setForm(blank());setEditing(null);setEditor(null);setError("");}},[mutation.success]);
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get("order_id");if(id)setQuery(id);},[]);
 const rows=state.data.sales_order_progress,clients=state.data.clients,items=state.data.items,materials=state.data.raw_materials;
 const names=Object.fromEntries(clients.map(c=>[c.client_code,c.client_name])),itemNames=Object.fromEntries(items.map(i=>[i.item_code,i.item_name]));
 const disabled=state.loading||Boolean(state.error)||mutation.busy||Boolean(mutation.pending);
 const detailed=items.some(i=>i.product_details!==undefined);
 const filtered=rows.filter(r=>(filter==="전체"||r.status===filter)&&[r.order_id,r.order_no,names[r.client_code],r.client_code,itemNames[r.item_code],r.item_code,detailsText(r)].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
 const pager=usePagination(filtered,query+'|'+filter,'sales');
 const change=(key,value)=>setForm(old=>({...old,[key]:value,...(key==='item_code'&&detailed?{product_details:{...itemDetails(items.find(i=>i.item_code===value)),po_no:old.product_details?.po_no||'',po_line:old.product_details?.po_line||''}}:{})}));
 function reset(){setForm(blank());setEditing(null);setError("");}
 async function save(e){e.preventDefault();if(disabled)return;setError("");
  const n=Number(form.quantity);if(!Number.isSafeInteger(n)||n<1||n>2147483647)return setError("수주 수량은 1 이상의 정수로 입력하세요.");
  if(form.unit_price!==""&&(!Number.isFinite(Number(form.unit_price))||Number(form.unit_price)<0))return setError("단가를 확인하세요.");
  const result=await mutation.run(detailed?"save_detailed_sales_order":"save_sales_order",{p_data:form,p_create:!editing,p_expected_revision:editing?.revision??null});if(result)reset();
 }
 async function remove(row){if(disabled||!window.confirm(`${row.order_no} 수주를 삭제할까요? 작업지시가 연결된 수주는 삭제할 수 없습니다.`))return;
  const result=await mutation.run("delete_sales_order",{p_order_id:row.order_id,p_expected_revision:row.revision});if(result&&editing?.order_id===row.order_id)reset();
 }
 async function download(){if(exporting)return;setExporting(true);setError("");try{await downloadWorkbook(erpSheets("sales",filtered,{clients:names,items:itemNames}),exportFilename("수주현황"));}catch(e){setError(e.message);}finally{setExporting(false);}}
 return <ErpShell title="수주 관리" kicker="SALES ORDERS" description="수주를 등록하고 기존 작업지시의 진행·출고 수량을 함께 확인합니다." state={state} mutation={mutation}>
  <section className="erp-card"><h2>{editing?"수주 수정":"수주 등록"}</h2><form onSubmit={save}><fieldset className="form-grid" disabled={disabled}>
   <label>수주번호 *<input required maxLength={80} value={form.order_no} onChange={e=>change("order_no",e.target.value)} placeholder="예: SO-20261103-001"/></label>
   <label>매출처 *<select aria-label="매출처" required disabled={Boolean(editing?.work_order_count>0)} value={form.client_code} onChange={e=>change("client_code",e.target.value)}><option value="">선택하세요</option>{clients.filter(c=>c.is_active!==false&&["customer","both"].includes(c.client_type||"customer")||c.client_code===editing?.client_code).map(c=><option key={c.client_code} value={c.client_code}>{c.client_name} ({c.client_code})</option>)}</select></label>
   <label>수주 품목 *<select aria-label="수주 품목" required disabled={Boolean(editing?.work_order_count>0)} value={form.item_code} onChange={e=>change("item_code",e.target.value)}><option value="">선택하세요</option>{items.map(i=><option key={i.item_code} value={i.item_code}>{i.item_name} ({i.item_code})</option>)}</select></label>
   {!detailed&&<label>수주 수량 (개) *<input required type="number" min="1" max="2147483647" step="1" value={form.quantity} onChange={e=>change("quantity",e.target.value)}/></label>}
   <label>수주 단가 (원/개, 선택)<input type="number" min="0" step="any" value={form.unit_price} onChange={e=>change("unit_price",e.target.value)}/></label>
   <label>수주 납기일 *<input required type="date" value={form.due_date} onChange={e=>change("due_date",e.target.value)}/></label>
   <label className="erp-wide">수주 메모<textarea maxLength={2000} rows={2} value={form.notes} onChange={e=>change("notes",e.target.value)}/></label>
  </fieldset>{detailed&&<ProductFields quantityControl={<label>수주 수량 (개) *<input disabled={disabled} required type="number" min="1" max="2147483647" step="1" value={form.quantity} onChange={e=>change("quantity",e.target.value)}/></label>} value={form.product_details} disabled={disabled} onChange={value=>change('product_details',value)}/>}{editing?.work_order_count>0&&<p className="registry-hint">연결된 작업지시의 거래처·품목은 유지됩니다. 수주 납기·제품정보 수정은 기존 작업지시를 바꾸지 않습니다.</p>}
  <div className="erp-actions">{editing&&<button type="button" className="secondary-btn" disabled={disabled} onClick={reset}>수정 취소</button>}<button className="primary-btn" disabled={disabled}>{editing?"수주 수정 저장":"수주 저장"}</button></div></form></section>
  {error&&<div className="alert" role="alert">{error}</div>}
  <section className="board"><div className="board-heading"><div><h2>등록된 수주 {filtered.length}건</h2><p>출하 수량은 연결된 작업지시의 누적 출고를 합산합니다.</p></div><div className="erp-actions"><input aria-label="수주 검색" placeholder="수주번호·거래처·품목 검색" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="수주 상태 필터" value={filter} onChange={e=>setFilter(e.target.value)}>{["전체","수주 등록","작업 진행","부분 출하","출하 완료","수량 확인 필요"].map(v=><option key={v}>{v}</option>)}</select><button type="button" className="secondary-btn" disabled={disabled||exporting||!filtered.length} onClick={download}>엑셀 자료받기</button></div></div>
   <Pagination pager={pager}/>{state.loading?<div className="empty">수주를 불러오는 중...</div>:!filtered.length?<div className="empty">표시할 수주가 없습니다.</div>:pager.rows.map(row=><article className="erp-record" key={row.order_id}>
    <div className="section-row"><div><h3>{row.order_no}</h3><p>{names[row.client_code]||row.client_code} · {itemNames[row.item_code]||row.item_code}</p></div><span className="selected-label">{row.status}</span></div>
    <div className="erp-metrics">{[["수주",qty(row.quantity)+"개"],["작업지시",qty(row.allocated_qty)+"개"],["미지시",qty(row.unallocated_qty)+"개"],["누적 출고",Number(row.unconfirmed_count)>0?"확인 필요":qty(row.shipped_qty)+"개"],["출고 잔량",Number(row.unconfirmed_count)>0?"확인 필요":qty(row.remaining_qty)+"개"]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <ProductSummary value={row.product_details}/><p className="erp-record-meta">납기 {dateText(row.due_date)} · 단가 {money(row.unit_price)} · 총액 {money(row.amount)} · 연결 작업지시 {qty(row.work_order_count)}건</p>{row.notes&&<p>{row.notes}</p>}
    {row.work_orders?.length>0&&<details className="erp-work-breakdown"><summary>연결 작업의 공정 상태</summary>{row.work_orders.map(w=><div key={w.wo_id}><Link href={`/orders/?wo_id=${encodeURIComponent(w.wo_id)}`}>{w.wo_id}</Link><span>{w.quantity_confirmed?w.current_step||"발행대기":"수량 확인 필요"}</span><span>목표 {qty(w.target_qty)}개 · 출고 {w.shipped_qty==null?"확인 필요":`${qty(w.shipped_qty)}개`}</span></div>)}</details>}
    <div className="erp-actions"><button type="button" className="primary-btn" disabled={disabled||Number(row.unallocated_qty)<=0} onClick={()=>setEditor({...row})}>작업지시 생성</button>{Number(row.work_order_count)>0&&<Link className="secondary-btn" href={`/orders/?order_id=${encodeURIComponent(row.order_id)}`}>연결 작업지시 보기</Link>}<button type="button" className="secondary-btn" disabled={disabled} onClick={()=>{setEditing({...row});setForm({...row,unit_price:row.unit_price??""});setError("");document.querySelector(".erp-card")?.scrollIntoView({behavior:"smooth"});}}>수주 수정</button><button type="button" className="delete-btn" disabled={disabled||Number(row.work_order_count)>0} onClick={()=>remove(row)}>삭제</button></div>
   </article>)}
  <Pagination pager={pager} compact/></section>
  {editor&&<OrderManager mode="create" order={null} usage={EMPTY} clients={clients} items={items} materials={materials} salesOrder={editor} linkedMutation={mutation} close={()=>setEditor(null)} onSaved={async()=>{}}/>}
 </ErpShell>;
}
