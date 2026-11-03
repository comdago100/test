"use client";
import Pagination,{usePagination} from "../Pagination";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppNav from "../AppNav";
import { Factory, Plus, ArrowUp, ArrowDown, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { processRoles, validateRouting } from "../../lib/routing-utils";
import { downloadWorkbook } from "../../lib/excel-download";

const blank = () => ({routing_code:"",routing_name:"",description:"",is_active:true,steps:[]});
export default function Routings() {
  const [routes,setRoutes]=useState([]), [form,setForm]=useState(blank), [editing,setEditing]=useState(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[ready,setReady]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[query,setQuery]=useState("");
  const lock=useRef(false);
  async function load() {
    setLoading(true);
    try {
      if(!supabase) throw new Error("Supabase 연결 설정이 필요합니다.");
      const all=[];
      for(let start=0;;start+=1000) {
        const {data,error}=await supabase.from("production_routings").select("*").order("routing_code").range(start,start+999);
        if(error) throw error;
        all.push(...data); if(data.length<1000) break;
      }
      setRoutes(all);setReady(true);setError("");
    } catch(e) {setReady(false);setError(["42P01","PGRST205"].includes(e.code)?"라우팅 DB 설정이 필요합니다. supabase/routing_management.sql을 먼저 적용해 주세요.":e.message);}
    finally {setLoading(false);}
  }
  useEffect(()=>{load();},[]);
  function change(key,value){setForm(old=>({...old,[key]:value}));}
  function updateStep(index,key,value){setForm(old=>({...old,steps:old.steps.map((step,i)=>i===index?{...step,[key]:value}:step)}));}
  function move(index,delta){setForm(old=>{const steps=[...old.steps];[steps[index],steps[index+delta]]=[steps[index+delta],steps[index]];return {...old,steps};});}
  function open(route,copy=false){setEditing(copy?null:route);setForm({...route,routing_code:copy?"":route.routing_code,routing_name:copy?route.routing_name+" 복사":route.routing_name,steps:route.steps.map(s=>({...s}))});setError("");setNotice("");document.getElementById("routing-editor")?.scrollIntoView({behavior:"smooth"});}
  function reset(){setEditing(null);setForm(blank());}
  async function save(e){
    e.preventDefault();if(lock.current)return;
    const message=validateRouting(form);if(message){setError(message);return;}
    lock.current=true;setBusy(true);setError("");setNotice("");
    try {
      const {error}=await supabase.rpc("save_production_routing",{p_route:{...form,routing_name:form.routing_name.trim(),steps:form.steps.map(s=>({...s,name:s.name.trim(),place:s.place.trim()}))},p_create:!editing,p_expected_revision:editing?.revision??null});
      if(error)throw error;reset();await load();setNotice("라우팅을 저장했습니다. 새 작업지시에서 선택할 수 있습니다.");
    }catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}
  }
  async function remove(route){
    if(lock.current || !window.confirm(`${route.routing_name} 라우팅을 삭제할까요? 발행된 작업에 사용 중이거나 기본 호환용이면 사용중지로 보관합니다.`))return;
    lock.current=true;setBusy(true);setError("");setNotice("");
    try{const {data,error}=await supabase.rpc("delete_production_routing",{p_code:route.routing_code,p_expected_revision:route.revision});if(error)throw error;if(editing?.routing_code===route.routing_code)reset();await load();setNotice(data.archived?"기존 작업 이력을 보존하기 위해 사용중지했습니다.":"라우팅을 삭제했습니다.");}
    catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}
  }
  const filtered=routes.filter(r=>[r.routing_code,r.routing_name,r.description,...r.steps.map(s=>s.name)].join(" ").toLowerCase().includes(query.toLowerCase()));
  const pager=usePagination(filtered,query,'routings');
  async function exportRoutes(){
    if(lock.current)return;lock.current=true;setBusy(true);
    try{await downloadWorkbook([{name:"라우팅·공정",columns:["라우팅 코드","라우팅명","사용 상태","설명","순서","공정명","작업장","공정 구분"].map((title,i)=>({title,kind:i===4?"number":"text",width:24})),rows:filtered.flatMap(r=>r.steps.map((s,i)=>[r.routing_code,r.routing_name,r.is_active?"사용 중":"사용중지",r.description,i+1,s.name,s.place,processRoles[s.role]]))}],"라우팅_목록.xlsx");}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}
  }
  return <main className="shell"><header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><Factory size={20}/></span><span>FOUNDRY<span className="brand-sub"> 공정 관리</span></span></Link><AppNav/></header>
    <div className="content"><div className="page-heading"><div className="eyebrow">ROUTING</div><h1>라우팅·공정 관리</h1><p>제품이 거치는 공정과 순서를 정하고, 작업지시마다 선택합니다.</p></div>
    <p className="registry-hint">변경한 공정은 새 작업지시에 적용됩니다. 이미 발행된 작업의 순서·이름·누적 수량은 유지됩니다. 주물 제작 기본안에서 용접보수·가공 등 필요한 공정을 추가하세요.</p>
    {error&&<div className="alert" role="alert">{error}</div>}{notice&&<p role="status">{notice}</p>}
    <section className="routing-card" id="routing-editor"><h2>{editing?"라우팅 수정":"라우팅 등록"}</h2><form onSubmit={save}><fieldset disabled={busy||loading||!ready}>
      <div className="form-grid"><label>라우팅 코드 *<input required maxLength={40} readOnly={Boolean(editing)} value={form.routing_code} onChange={e=>change("routing_code",e.target.value)} placeholder="예: CAST_WELD"/></label><label>라우팅명 *<input required maxLength={100} value={form.routing_name} onChange={e=>change("routing_name",e.target.value)} placeholder="예: 용접보수 포함 주물 제작"/></label><label>사용 상태<select value={String(form.is_active)} onChange={e=>change("is_active",e.target.value==="true")}><option value="true">사용 중</option><option value="false">사용중지</option></select></label><label>설명<input maxLength={1000} value={form.description} onChange={e=>change("description",e.target.value)}/></label></div>
      <h3>공정 순서</h3><p>일반 공정·검사·출고를 구분하세요. 마지막은 출고로 지정합니다. 앞 공정 완료 수량 안에서 다음 공정을 처리합니다.</p>
      {form.steps.map((step,i)=><div className="routing-step" key={step.key}><span className="routing-number">{i+1}</span><label>공정명<input required maxLength={60} aria-label={`공정명 ${i+1}`} value={step.name} onChange={e=>updateStep(i,"name",e.target.value)}/></label><label>작업장<input maxLength={100} aria-label={`작업장 ${i+1}`} value={step.place} onChange={e=>updateStep(i,"place",e.target.value)}/></label><label>공정 구분<select aria-label={`공정 구분 ${i+1}`} value={step.role} onChange={e=>updateStep(i,"role",e.target.value)}>{Object.entries(processRoles).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><div className="routing-step-actions"><button type="button" className="icon-btn" disabled={i===0} onClick={()=>move(i,-1)} aria-label={`${i+1}번 공정 위로`}><ArrowUp size={17}/></button><button type="button" className="icon-btn" disabled={i===form.steps.length-1} onClick={()=>move(i,1)} aria-label={`${i+1}번 공정 아래로`}><ArrowDown size={17}/></button><button type="button" className="icon-btn" onClick={()=>change("steps",form.steps.filter((_,j)=>j!==i))} aria-label={`${i+1}번 공정 삭제`}><X size={17}/></button></div></div>)}
      <div className="routing-actions"><button className="secondary-btn" type="button" disabled={form.steps.length>=30} onClick={()=>change("steps",[...form.steps,{key:crypto.randomUUID(),name:"",place:"",role:"production"}])}><Plus size={16}/> 공정 추가</button><button type="button" className="secondary-btn" onClick={reset}>새로 작성</button><button className="primary-btn">{busy?"저장 중...":"라우팅 저장"}</button></div>
    </fieldset></form></section>
    <section className="routing-card"><div className="section-row"><h2>등록된 라우팅 {filtered.length}건</h2><button className="secondary-btn" type="button" disabled={busy||loading||!filtered.length} onClick={exportRoutes}>엑셀 자료받기</button></div><label className="full-label">라우팅 검색<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="이름, 코드, 공정명"/></label><button type="button" className="secondary-btn" disabled={busy||loading} onClick={load}>새로고침</button>
    <Pagination pager={pager}/>{loading?<p>불러오는 중...</p>:pager.rows.map(route=><article className="routing-list-item" key={route.routing_code}><div><h3>{route.routing_name} <small>{route.routing_code} · {route.is_active?"사용 중":"사용중지"}</small></h3><p>{route.description}</p><ol className="routing-flow">{route.steps.map(s=><li key={s.key}>{s.name}</li>)}</ol></div><div className="routing-actions"><button className="secondary-btn" disabled={busy||!ready} onClick={()=>open(route)}>수정</button><button className="secondary-btn" disabled={busy||!ready} onClick={()=>open(route,true)}>복사 등록</button><button className="delete-btn" disabled={busy||!ready} onClick={()=>remove(route)}>삭제</button></div></article>)}
    {!loading&&!filtered.length&&<p>표시할 라우팅이 없습니다.</p>}<Pagination pager={pager} compact/></section>
    </div></main>;
}
