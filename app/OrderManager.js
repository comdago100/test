"use client";
import { useEffect, useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { validateOrderId } from "../lib/order-utils";


const blank = () => ({ wo_id: "", client_code:"", item_code:"", target_qty:"", due_date:"", start_date:"", actual_qty:"", unit_weight_kg:"", heat_no:"", casting_material:"", notes:"" });
const fields = ["wo_id","client_code","item_code","target_qty","due_date","start_date","actual_qty","unit_weight_kg","heat_no","casting_material","notes"];
function msg(error) {
  if (error?.code === "23505") return "이미 사용 중인 번호 또는 코드입니다. 다른 값을 입력하세요.";
  if (error?.code === "42501" || error?.message?.includes("관리자 권한")) return "로그인 없는 저장을 위한 DB 권한 설정이 아직 적용되지 않았습니다. 설정 SQL을 실행해 주세요.";
  const text = error?.message || "처리하지 못했습니다. 연결 상태를 확인하세요.";
  if (text.includes("save_production_order") || text.includes("delete_production_order") || text.includes("schema cache")) return "DB 설정이 필요합니다. 관리자에게 데이터베이스 설정을 요청하세요.";
  return text;
}

export default function OrderManager({ mode, order, usage, clients, items, materials, close, onSaved }) {
  const [form,setForm] = useState(null);
  const [rows,setRows] = useState([]);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [master,setMaster] = useState(null);
  const [masterCode,setMasterCode] = useState("");
  const [masterName,setMasterName] = useState("");

  useEffect(() => {
    if (mode === "create") { setForm(blank()); setRows([]); }
    if (mode === "edit" && order) {
      setForm(Object.fromEntries(fields.map(k => [k, order[k] ?? ""])));
      setRows(usage.map(x => ({usage_id:x.usage_id, raw_code:x.raw_code, input_qty:String(x.input_qty)})));
    }
    setError("");
  }, [mode, order, usage]);

  if (!mode) return null;
  function change(key,value) { setForm(old => ({...old,[key]:value})); }
  function rowChange(index,key,value) { setRows(old => old.map((x,i) => i === index ? {...x,[key]:value} : x)); }
  async function save(e) {
    e.preventDefault(); setError("");
    const idError = validateOrderId(form.wo_id);
    if (idError) return setError(idError);
    if (!form.client_code || !form.item_code || !Number.isFinite(Number(form.target_qty)) || Number(form.target_qty) <= 0) return setError("거래처, 품목, 목표 수량을 확인하세요.");
    if (form.actual_qty !== "" && Number(form.actual_qty) < 0 || form.unit_weight_kg !== "" && Number(form.unit_weight_kg) < 0) return setError("수량과 중량은 0 이상이어야 합니다.");
    if (rows.some(x => !x.raw_code || !Number.isFinite(Number(x.input_qty)) || Number(x.input_qty) <= 0)) return setError("자재별 원재료와 투입량을 확인하세요.");
    if (form.start_date && form.due_date && form.start_date > form.due_date) return setError("납기일은 작업 시작일보다 빠를 수 없습니다.");
    setBusy(true);
    const {error} = await supabase.rpc("save_production_order", {p_order:{...form, wo_id:form.wo_id.trim()}, p_materials:rows, p_create:mode==="create", p_original_usage_ids:usage.map(x=>String(x.usage_id))});
    setBusy(false);
    if (error) {setError(msg(error));return;}
    await onSaved(); close();
  }
  async function addMaster() {
    if (!masterCode.trim() || !masterName.trim()) {setError("코드와 이름을 입력하세요.");return;}
    setBusy(true);setError("");
    const {error} = await supabase.rpc("create_production_master",{p_kind:master,p_code:masterCode.trim(),p_name:masterName.trim()});
    if (error) {setError(msg(error));setBusy(false);return;}
    await onSaved();
    if (master === "client") change("client_code",masterCode.trim());
    if (master === "item") change("item_code",masterCode.trim());
    setMaster(null);setMasterCode("");setMasterName("");setBusy(false);
  }
  async function remove() {
    if (!window.confirm(`[${order.wo_id}] 작업지시와 연결된 자재 투입 내역을 영구 삭제합니다. 계속하시겠습니까?`)) return;
    setBusy(true);setError("");
    const {error} = await supabase.rpc("delete_production_order", {p_wo_id:order.wo_id});
    setBusy(false);
    if (error) {setError(msg(error));return;}
    await onSaved(); close();
  }
  return <div className="modal-backdrop" onMouseDown={e => {if(e.target===e.currentTarget && !busy) close();}}><section className="manager-modal" role="dialog" aria-modal="true" aria-labelledby="manager-title">
    <div className="modal-heading"><div><span className="section-kicker">WORK ORDER MANAGEMENT</span><h2 id="manager-title">{mode==="create"?"작업지시 등록":"작업지시 수정"}</h2><p>작업 내용과 실제 투입 자재를 관리합니다.</p></div><button className="icon-btn" onClick={close} aria-label="닫기"><X size={18}/></button></div>
    {!supabase ? <div className="alert">Supabase 연결 설정이 필요합니다.</div> : form && <form onSubmit={save}>
      <div className="master-tools"><span>기초정보 등록</span>{[["client","거래처"],["item","품목"],["material","원재료"]].map(([kind,label])=><button type="button" key={kind} onClick={()=>{setMaster(kind);setMasterCode("");setMasterName("");setError("");}}><Plus size={13}/> {label}</button>)}</div>
      {master && <div className="master-form"><strong>{master==="client"?"거래처":master==="item"?"품목":"원재료"} 추가</strong><input aria-label="코드" placeholder="코드" value={masterCode} onChange={e=>setMasterCode(e.target.value)}/><input aria-label="이름" placeholder="이름" value={masterName} onChange={e=>setMasterName(e.target.value)}/><button type="button" className="secondary-btn" onClick={addMaster} disabled={busy}>등록</button><button type="button" className="icon-btn" aria-label="기초정보 등록 닫기" onClick={()=>setMaster(null)}><X size={16}/></button></div>}
      <div className="form-section"><h3>기본 정보</h3><div className="form-grid">
        <label>작업지시 번호 <em>*</em><input value={form.wo_id} onChange={e=>change("wo_id",e.target.value)} readOnly={mode==="edit"} required maxLength={80} placeholder="예: WO-20261030-001"/>{mode==="edit" && <small>등록된 번호는 자재 내역과 연결되어 변경할 수 없습니다.</small>}</label>
        <label>거래처 <em>*</em><select required value={form.client_code} onChange={e=>change("client_code",e.target.value)}><option value="">선택하세요</option>{clients.map(x=><option key={x.client_code} value={x.client_code}>{x.client_name} ({x.client_code})</option>)}</select></label>
        <label>품목 <em>*</em><select required value={form.item_code} onChange={e=>change("item_code",e.target.value)}><option value="">선택하세요</option>{items.map(x=><option key={x.item_code} value={x.item_code}>{x.item_name} ({x.item_code})</option>)}</select></label>
        <label>목표 수량 (개) <em>*</em><input type="number" min="1" step="1" required value={form.target_qty} onChange={e=>change("target_qty",e.target.value)}/></label>
        <label>작업 시작일<input type="date" value={form.start_date} onChange={e=>change("start_date",e.target.value)}/></label>
        <label>납기일<input type="date" value={form.due_date} onChange={e=>change("due_date",e.target.value)}/></label>
        <label>실제 생산량 (개)<input type="number" min="0" step="1" value={form.actual_qty} onChange={e=>change("actual_qty",e.target.value)}/></label>
        <label>제품 단중 (kg)<input type="number" min="0" step="0.01" value={form.unit_weight_kg} onChange={e=>change("unit_weight_kg",e.target.value)}/></label>
        <label>용해 번호 / 로트<input value={form.heat_no} onChange={e=>change("heat_no",e.target.value)} maxLength={120}/></label>
        <label>주물 재질<input value={form.casting_material} onChange={e=>change("casting_material",e.target.value)} maxLength={120} placeholder="예: FC250"/></label>
      </div><label className="full-label">작업 메모<textarea value={form.notes} onChange={e=>change("notes",e.target.value)} rows="3" maxLength={2000} placeholder="검사 기준, 특이사항 등"/></label></div>
      <div className="form-section"><div className="section-row"><div><h3>원재료 투입</h3><p>실제로 투입한 자재와 중량을 입력합니다.</p></div><button className="secondary-btn add-material" type="button" onClick={()=>setRows(old=>[...old,{raw_code:"",input_qty:""}])}><Plus size={15}/> 자재 추가</button></div>
        {rows.length === 0 && <p className="no-materials">등록된 투입 내역이 없습니다.</p>}
        {rows.map((row,i)=><div className="material-input-row" key={row.usage_id || `new-${i}`}><select aria-label={`원재료 ${i+1}`} required value={row.raw_code} onChange={e=>rowChange(i,"raw_code",e.target.value)}><option value="">원재료 선택</option>{materials.map(x=><option key={x.raw_code} value={x.raw_code}>{x.raw_name} ({x.raw_code})</option>)}</select><input aria-label={`투입 중량 ${i+1}`} type="number" min="0.01" step="0.01" required value={row.input_qty} onChange={e=>rowChange(i,"input_qty",e.target.value)} placeholder="투입 중량 (kg)"/><button type="button" className="icon-btn" aria-label="자재 삭제" onClick={()=>setRows(old=>old.filter((_,j)=>j!==i))}><X size={17}/></button></div>)}
        <div className="material-total">총 투입 중량 <strong>{rows.reduce((sum,x)=>sum+(Number(x.input_qty)||0),0).toLocaleString("ko-KR",{maximumFractionDigits:2})} kg</strong></div>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="form-actions">{mode==="edit" && <button className="delete-btn" type="button" onClick={remove} disabled={busy}><Trash2 size={16}/> 삭제</button>}<div/><button className="secondary-btn" type="button" onClick={close}>취소</button><button className="primary-btn" disabled={busy}>{busy?"저장 중...":"작업지시 저장"}</button></div>
    </form>}
  </section></div>;
}