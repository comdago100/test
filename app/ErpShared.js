"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import Link from "next/link";
import {Factory,RefreshCw} from "lucide-react";
import AppNav from "./AppNav";
import {supabase} from "../lib/supabase";
import {erpRows,erpMessage,erpRpcs,missingErp} from "../lib/erp-data";

export function useErpData(tables){
 const key=JSON.stringify(tables),[data,setData]=useState(()=>Object.fromEntries(tables.map(t=>[t,[]])));
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[setup,setSetup]=useState(false),[updated,setUpdated]=useState(null);
 const mounted=useRef(true),inFlight=useRef(false),again=useRef(false);
 const refresh=useCallback(async function load(){
  if(inFlight.current){again.current=true;return;}inFlight.current=true;
  try{if(!supabase)throw Error("Supabase 연결 설정이 필요합니다.");
   const names=JSON.parse(key),rows=await Promise.all(names.map(t=>erpRows(supabase,t,{order:({clients:"client_code",items:"item_code",raw_materials:"raw_code",material_inventory:"raw_code",finished_inventory:"item_code",finished_inventory_orders:"wo_id"})[t]||"created_at",ascending:true})));
   if(mounted.current){setData(Object.fromEntries(names.map((n,i)=>[n,rows[i]])));setError("");setSetup(false);setUpdated(new Date());}
  }catch(e){if(mounted.current){setError(erpMessage(e));setSetup(missingErp(e));}}
  finally{inFlight.current=false;if(mounted.current){setLoading(false);if(again.current){again.current=false;load();}}}
 },[key]);
 useEffect(()=>{mounted.current=true;refresh();const timer=setInterval(refresh,5000);return()=>{mounted.current=false;clearInterval(timer);};},[refresh]);
 return {data,loading,error,setup,updated,refresh};
}
export function useErpMutation(onSuccess){
 const [busy,setBusy]=useState(false),[pending,setPending]=useState(null),[error,setError]=useState(""),[success,setSuccess]=useState("");
 const busyRef=useRef(false),pendingRef=useRef(null),errorRef=useRef(""),callback=useRef(onSuccess);callback.current=onSuccess;
 const keep=request=>{pendingRef.current=request;setPending(request);try{if(request)sessionStorage.setItem("foundry.erpPending",JSON.stringify(request));else sessionStorage.removeItem("foundry.erpPending");}catch{}};
 useEffect(()=>{try{const p=JSON.parse(sessionStorage.getItem("foundry.erpPending")||"null");if(p&&erpRpcs.includes(p.rpc)&&p.args?.p_request_id){pendingRef.current=p;setPending(p);}}catch{}
  const warn=e=>{if(pendingRef.current){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
 },[]);
 async function execute(request){
  if(busyRef.current||request&&pendingRef.current)return null;
  request=request||pendingRef.current;if(!request)return null;
  busyRef.current=true;setBusy(true);setError("");errorRef.current="";setSuccess("");keep(request);
  try{if(!supabase)throw Error("Supabase 연결 설정이 필요합니다.");const {data,error}=await supabase.rpc(request.rpc,request.args);if(error)throw error;
   keep(null);setSuccess("처리가 완료되었습니다.");await callback.current?.();return data;
  }catch(e){const definitive=e?.code&&!["PGRST000","PGRST001","PGRST002"].includes(e.code);if(definitive)keep(null);
   const message=pendingRef.current?"저장 결과를 확인하지 못했습니다. 같은 요청으로 재시도해 주세요.":erpMessage(e);errorRef.current=message;setError(message);return null;
  }finally{busyRef.current=false;setBusy(false);}
 }
 return {busy,pending,pendingRef,error,errorRef,success,run:(rpc,args)=>execute({rpc,args:{...args,p_request_id:crypto.randomUUID()}}),retry:()=>execute(null)};
}
export function ErpRequestStatus({mutation,onRetry}){
 return <>{mutation.pending&&<div className="alert" role="status">저장 결과 확인이 필요합니다. 중복 입력하지 말고 같은 요청을 확인하세요.<button type="button" className="secondary-btn" disabled={mutation.busy} onClick={onRetry||mutation.retry}>저장 결과 확인 / 재시도</button></div>}{mutation.error&&<div className="alert" role="alert">{mutation.error}</div>}{mutation.success&&!mutation.pending&&<p className="scan-result success" role="status">{mutation.success}</p>}</>;
}
export default function ErpShell({title,kicker,description,state,mutation,children,setupFile="light_erp.sql"}){
 return <main className="shell"><header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><Factory size={20}/></span><span>FOUNDRY<span className="brand-sub"> 공정 관리</span></span></Link><AppNav/></header><div className="content">
  <div className="eyebrow">{kicker}</div><section className="intro"><div><h1>{title}</h1><p>{description}</p></div><div className="intro-actions"><span className="last-update">{state.updated?state.updated.toLocaleTimeString("ko-KR"):"조회 중"} · 5초마다 갱신</span><button type="button" className="icon-btn" aria-label="새로고침" onClick={state.refresh}><RefreshCw size={18}/></button></div></section>
  {state.error&&<div className="alert" role="alert">{state.setup?`추가 DB 설정이 필요합니다. ${setupFile}을 적용하세요.`:state.error}{state.setup&&<> <a href={`https://github.com/comdago100/test/blob/main/supabase/${setupFile}`} target="_blank" rel="noreferrer">설정 SQL 열기</a></>}</div>}{mutation&&<ErpRequestStatus mutation={mutation}/>}<div className="erp-content">{children}</div>
 </div></main>;
}
