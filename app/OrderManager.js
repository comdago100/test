"use client";
import { useEffect, useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { validateOrderId } from "../lib/order-utils";
import { ErpRequestStatus,useErpMutation } from "./ErpShared";
import {ProductSummary} from './ProductFields';
import Link from 'next/link';



const blank = () => ({ wo_id: "", client_code:"", item_code:"", target_qty:"", due_date:"", start_date:"", actual_qty:"", unit_weight_kg:"", heat_no:"", casting_material:"", notes:"", routing_code:"" });
const fields = ["wo_id","client_code","item_code","target_qty","due_date","start_date","actual_qty","unit_weight_kg","heat_no","casting_material","notes","routing_code"];
function msg(error) {
  if(error?.code==="23503"&&error?.message?.includes("inspection_reports"))return "검사성적서가 연결된 작업지시는 삭제할 수 없습니다. 성적서와 작업 이력을 보관하고 필요한 입력 내용을 수정하세요.";
  if (error?.code === "23505") return "이미 사용 중인 번호 또는 코드입니다. 다른 값을 입력하세요.";
  if (error?.code === "42501" || error?.message?.includes("관리자 권한")) return "로그인 없는 저장을 위한 DB 권한 설정이 아직 적용되지 않았습니다. 설정 SQL을 실행해 주세요.";
  const text = error?.message || "처리하지 못했습니다. 연결 상태를 확인하세요.";
  if (text.includes("save_production_order") || text.includes("delete_production_order") || text.includes("schema cache")) return "DB 설정이 필요합니다. 관리자에게 데이터베이스 설정을 요청하세요.";
  return text;
}

export default function OrderManager({ mode, order, usage, clients, items, materials, close, onSaved, salesOrder=null, linkedMutation=null }) {
  const [form,setForm] = useState(null);
  const [rows,setRows] = useState([]);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [routes,setRoutes] = useState([]);
  const [routingReady,setRoutingReady] = useState(false);
  const [routingLoading,setRoutingLoading] = useState(true);
  const [routingError,setRoutingError] = useState("");
  const ownMutation=useErpMutation(onSaved),mutation=linkedMutation||ownMutation;
  const detailed=items.some(i=>i.product_details!==undefined)||order?.product_details!==undefined;
  useEffect(() => {
    let active=true;
    async function loadRoutes(){
      try{
        const all=[];
        for(let start=0;;start+=1000){
          const {data,error}=await supabase.from("production_routings").select("*").eq("is_active",true).order("routing_code").range(start,start+999);
          if(error)throw error;
          all.push(...data);if(data.length<1000)break;
        }
        if(!active)return;
        setRoutes(all);setRoutingReady(true);
        setForm(old=>old && mode==="create"?{...old,routing_code:old.routing_code || all[0]?.routing_code || ""}:old);
      }catch(e){if(active && !["42P01","PGRST205"].includes(e.code))setRoutingError("라우팅을 불러오지 못했습니다. 창을 다시 열어 주세요.");}
      finally{if(active)setRoutingLoading(false);}
    }
    if(supabase)loadRoutes();else setRoutingLoading(false);
    return()=>{active=false;};
  },[mode]);
  useEffect(() => {
    if (mode === "create") { setForm({...blank(),product_details:salesOrder?.product_details||{},...(salesOrder?{client_code:salesOrder.client_code,item_code:salesOrder.item_code,target_qty:String(salesOrder.unallocated_qty),due_date:salesOrder.due_date||"",casting_material:salesOrder.product_details?.material||""}:{})}); setRows([]); }
    if (mode === "edit" && order) {
      setForm({...Object.fromEntries(fields.map(k => [k, order[k] ?? ""])),product_details:order.product_details||{}});
      setRows(usage.map(x => ({usage_id:x.usage_id, raw_code:x.raw_code, input_qty:String(x.input_qty)})));
    }
    setError("");
  }, [mode, order, usage, salesOrder]);

  if (!mode) return null;
  if(mode==="create"&&!salesOrder)return <div className="modal-backdrop"><section className="manager-modal" role="dialog" aria-modal="true" aria-label="수주 연결 안내"><h2>수주에서 작업지시를 생성하세요</h2><p>PO·제품정보는 수주에서 입력하고 작업지시는 해당 수주를 연결해 발행합니다.</p><Link className="primary-btn" href="/sales/">수주 관리로 이동</Link><button className="secondary-btn" onClick={close}>닫기</button></section></div>;
  function change(key,value) { setForm(old=>({...old,[key]:value})); }
  function rowChange(index,key,value) { setRows(old => old.map((x,i) => i === index ? {...x,[key]:value} : x)); }
  async function refreshSalesDetails(){
    if(!order?.order_id||busy||mutation.busy||mutation.pending)return;
    setBusy(true);setError("");
    try{
      const {data,error}=await supabase.from('sales_orders').select('order_id,order_no,product_details,due_date').eq('order_id',order.order_id).single();
      if(error)throw error;
      if(!data?.product_details)throw Error('수주 제품정보를 확인할 수 없습니다.');
      setForm(old=>({...old,product_details:data.product_details,casting_material:data.product_details.material||'',due_date:data.due_date||''}));
    }catch(e){setError(msg(e));}finally{setBusy(false);}
  }
  async function save(e) {
    e.preventDefault(); setError("");
    if(mode==="create"&&!salesOrder)return setError("수주 관리에서 수주를 선택한 뒤 작업지시를 생성하세요.");
    const idError = validateOrderId(form.wo_id);
    if (idError) return setError(idError);
    if (!form.client_code || !form.item_code || !Number.isSafeInteger(Number(form.target_qty)) || Number(form.target_qty) <= 0 || Number(form.target_qty) > 2147483647) return setError("거래처, 품목, 목표 수량을 확인하세요.");
    if (form.actual_qty !== "" && Number(form.actual_qty) < 0 || form.unit_weight_kg !== "" && Number(form.unit_weight_kg) < 0) return setError("수량과 중량은 0 이상이어야 합니다.");
    if (rows.some(x => !x.raw_code || !Number.isFinite(Number(x.input_qty)) || Number(x.input_qty) <= 0)) return setError("자재별 원재료와 투입량을 확인하세요.");
    if (form.start_date && form.due_date && form.start_date > form.due_date) return setError("납기일은 작업 시작일보다 빠를 수 없습니다.");
    if (busy || routingLoading || routingError) return;
    if (mode==="create" && routingReady && !form.routing_code) return setError("사용 가능한 라우팅을 먼저 등록하세요.");
    if (salesOrder) {
      if(!routingReady)return setError("라우팅 DB 설정을 먼저 적용하세요.");
      if(Number(form.target_qty)>Number(salesOrder.unallocated_qty))return setError("미지시 수량보다 많이 발행할 수 없습니다.");
      const result=await linkedMutation.run(salesOrder.product_details!==undefined?"create_detailed_sales_work_order":"create_sales_work_order",{p_order_id:salesOrder.order_id,p_expected_revision:salesOrder.revision,p_order:{...form,wo_id:form.wo_id.trim()},p_materials:rows});
      if(result){await onSaved();close();}return;
    }
    if(detailed){const result=await mutation.run('save_detailed_work_order',{p_order:{...form,wo_id:form.wo_id.trim()},p_materials:rows,p_create:mode==='create',p_original_usage_ids:usage.map(x=>String(x.usage_id)),p_expected_revision:order?.details_revision??null});if(result)close();return;}
    setBusy(true);
    const {error} = await supabase.rpc(routingReady ? "save_routed_production_order" : "save_production_order", {p_order:{...form, wo_id:form.wo_id.trim()}, p_materials:rows, p_create:mode==="create", p_original_usage_ids:usage.map(x=>String(x.usage_id))});
    setBusy(false);
    if (error) {setError(msg(error));return;}
    await onSaved(); close();
  }
  async function remove() {
    if (!window.confirm(`[${order.wo_id}] 작업지시와 연결된 자재 투입 내역 및 공정·불량 처리 이력을 영구 삭제합니다. 계속하시겠습니까?`)) return;
    setBusy(true);setError("");
    const {error} = await supabase.rpc("delete_production_order", {p_wo_id:order.wo_id});
    setBusy(false);
    if (error) {setError(msg(error));return;}
    await onSaved(); close();
  }
  return <div className="modal-backdrop" onMouseDown={e => {if(e.target===e.currentTarget && !busy) close();}}><section className="manager-modal" role="dialog" aria-modal="true" aria-labelledby="manager-title">
    <div className="modal-heading"><div><span className="section-kicker">WORK ORDER MANAGEMENT</span><h2 id="manager-title">{mode==="create"?"작업지시 등록":"작업지시 수정"}</h2><p>작업 내용과 실제 투입 자재를 관리합니다.</p></div><button className="icon-btn" onClick={close} aria-label="닫기"><X size={18}/></button></div>
    {!supabase ? <div className="alert">Supabase 연결 설정이 필요합니다.</div> : form && <form onSubmit={save}>
      <p className="registry-hint">PO·제품정보는 수주에서 입력합니다. 여기서는 작업 수량·라우팅·로트·실제 투입 자재를 관리합니다.</p>
      {salesOrder&&<p className="shipment-summary">수주 {salesOrder.order_no}에서 생성합니다. 미지시 {Number(salesOrder.unallocated_qty).toLocaleString()}개 중 이번 작업 수량을 입력하세요.</p>}
      <div className="form-section"><h3>기본 정보</h3><div className="form-grid">
        <label>작업지시 번호 <em>*</em><input value={form.wo_id} onChange={e=>change("wo_id",e.target.value)} readOnly={mode==="edit"} required maxLength={80} placeholder="예: WO-20261030-001"/>{mode==="edit" && <small>등록된 번호는 자재 내역과 연결되어 변경할 수 없습니다.</small>}</label>
        <label>거래처 <em>*</em><select aria-label="거래처" required disabled value={form.client_code} onChange={e=>change("client_code",e.target.value)}><option value="">선택하세요</option>{clients.filter(client=>client.is_active!==false || mode==="edit" && client.client_code===order?.client_code).map(x=><option key={x.client_code} value={x.client_code}>{x.client_name} ({x.client_code})</option>)}</select></label>
        <label>품목 <em>*</em><select aria-label="품목" required disabled value={form.item_code} onChange={e=>change("item_code",e.target.value)}><option value="">선택하세요</option>{items.map(x=><option key={x.item_code} value={x.item_code}>{x.item_name} ({x.item_code})</option>)}</select></label>
        <label>라우팅 {mode==="create" && <em>*</em>}{mode==="edit" ? <><input readOnly value={order.routing_name || "기존 6공정"}/><small>발행 시점의 공정과 이력을 유지합니다.</small></> : <><select aria-label="라우팅" value={form.routing_code} disabled={routingLoading || !routingReady} onChange={e=>change("routing_code",e.target.value)} required={routingReady}><option value="">{routingLoading?"불러오는 중":routingReady?"선택하세요":"기존 6공정 (DB 설정 필요)"}</option>{routes.map(r=><option key={r.routing_code} value={r.routing_code}>{r.routing_name}</option>)}</select><small>{routingError || (!routingReady && !routingLoading ? "라우팅 관리에서 DB 설정 후 새 공정을 선택할 수 있습니다." : routes.find(r=>r.routing_code===form.routing_code)?.steps.map(s=>s.name).join(" → "))}</small></>}</label>
        <label>목표 수량 (개) <em>*</em><input disabled={mutation.busy||Boolean(mutation.pending)} type="number" min="1" step="1" required value={form.target_qty} onChange={e=>change("target_qty",e.target.value)}/></label>
        <label>작업 시작일<input type="date" value={form.start_date} onChange={e=>change("start_date",e.target.value)}/></label>
        <label>납기일<input type="date" readOnly={Boolean(salesOrder)} value={form.due_date} onChange={e=>change("due_date",e.target.value)}/></label>
        <label>검사 완료 수량 (자동)<input type="number" readOnly value={form.actual_qty || 0}/><small>현장 스캐너의 검사 완료 실적에서 자동 계산합니다.</small></label>
        <label>제품 단중 (kg)<input type="number" min="0" step="0.01" value={form.unit_weight_kg} onChange={e=>change("unit_weight_kg",e.target.value)}/></label>
        <label>용해 번호 / 로트<input value={form.heat_no} onChange={e=>change("heat_no",e.target.value)} maxLength={120}/></label>
        {!detailed&&<label>주물 재질<input readOnly value={form.casting_material}/></label>}
      </div><label className="full-label">작업 메모<textarea value={form.notes} onChange={e=>change("notes",e.target.value)} rows="3" maxLength={2000} placeholder="검사 기준, 특이사항 등"/></label></div>
      {detailed&&<div className="form-section"><h3>수주 제품정보</h3><ProductSummary value={form.product_details}/>{salesOrder||order?.order_id?<p className="registry-hint">수주에서 가져온 발행 기준 정보입니다. <Link href={`/sales/?order_id=${encodeURIComponent(salesOrder?.order_id||order.order_id)}`}>연결 수주 보기</Link></p>:<p className="registry-hint">기존 독립 작업지시의 제품정보를 보존합니다. 신규 작업은 수주에서 생성하세요.</p>}{mode==='edit'&&order?.order_id&&<><button type="button" className="secondary-btn" disabled={busy||mutation.busy||Boolean(mutation.pending)} onClick={refreshSalesDetails}>수주 최신정보 가져오기</button><p className="registry-hint">수주에서 PO·사양·납기를 수정했다면 최신정보를 가져온 뒤 작업지시 저장을 누르세요. 이미 발행된 성적서는 유지됩니다.</p></>}</div>}
      <div className="form-section"><div className="section-row"><div><h3>원재료 투입</h3><p>실제로 투입한 자재와 중량을 입력합니다.</p></div><button className="secondary-btn add-material" type="button" onClick={()=>setRows(old=>[...old,{raw_code:"",input_qty:""}])}><Plus size={15}/> 자재 추가</button></div>
        {rows.length === 0 && <p className="no-materials">등록된 투입 내역이 없습니다.</p>}
        {rows.map((row,i)=><div className="material-input-row" key={row.usage_id || `new-${i}`}><select aria-label={`원재료 ${i+1}`} required value={row.raw_code} onChange={e=>rowChange(i,"raw_code",e.target.value)}><option value="">원재료 선택</option>{materials.map(x=><option key={x.raw_code} value={x.raw_code}>{x.raw_name} ({x.raw_code})</option>)}</select><input aria-label={`투입 중량 ${i+1}`} type="number" min="0.01" step="0.01" required value={row.input_qty} onChange={e=>rowChange(i,"input_qty",e.target.value)} placeholder="투입 중량 (kg)"/><button type="button" className="icon-btn" aria-label="자재 삭제" onClick={()=>setRows(old=>old.filter((_,j)=>j!==i))}><X size={17}/></button></div>)}
        <div className="material-total">총 투입 중량 <strong>{rows.reduce((sum,x)=>sum+(Number(x.input_qty)||0),0).toLocaleString("ko-KR",{maximumFractionDigits:2})} kg</strong></div>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      {(detailed||linkedMutation)&&<ErpRequestStatus mutation={mutation} onRetry={async()=>{if(await mutation.retry()){await onSaved();close();}}}/>}
      <div className="form-actions">{mode==="edit" && <button className="delete-btn" type="button" onClick={remove} disabled={busy||mutation.busy||Boolean(mutation.pending)}><Trash2 size={16}/> 삭제</button>}<div/><button className="secondary-btn" type="button" onClick={close}>취소</button><button className="primary-btn" disabled={busy || routingLoading || Boolean(routingError) || Boolean(mutation.busy||mutation.pending)}>{busy||mutation.busy?"저장 중...":"작업지시 저장"}</button></div>
    </form>}
  </section></div>;
}
