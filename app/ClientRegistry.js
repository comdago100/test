"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Factory, RefreshCw, Search } from "lucide-react";
import AppNav from "./AppNav";
import { supabase } from "../lib/supabase";
import { clientTypes, clientGroups, emptyClient, clientForm, clientMatches, clientPayload, formatBusinessNumber, validateClient } from "../lib/client-utils";
import { buildMasterSheets, exportFilename } from "../lib/production-export";
import { downloadWorkbook } from "../lib/excel-download";

export default function ClientRegistry() {
  const [rows,setRows]=useState([]);
  const [form,setForm]=useState(emptyClient);
  const [editing,setEditing]=useState(null);
  const [query,setQuery]=useState("");
  const [type,setType]=useState("all");
  const [status,setStatus]=useState("all");
  const [ready,setReady]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [loadError,setLoadError]=useState("");
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [exportError,setExportError]=useState("");
  const busyRef=useRef(false);
  const exportRef=useRef(false);
  const version=useRef(0);
  const formRef=useRef(null);

  async function refresh() {
    const request=++version.current;
    setLoading(true);setLoadError("");
    try {
      if(!supabase) throw new Error("Supabase 연결 설정이 필요합니다.");
      const schemaPromise=supabase.from("clients").select("client_type,is_active,client_updated_at").limit(0);
      const allPromise=(async()=>{
        const result=[];
        for(let start=0;;start+=1000) {
          const {data,error}=await supabase.from("clients").select("*").order("client_code").range(start,start+999);
          if(error) throw error;
          result.push(...(data||[]));
          if(!data||data.length<1000) return result;
        }
      })();
      const [schema,all]=await Promise.all([schemaPromise,allPromise]);
      if(schema.error&&!["42703","PGRST204"].includes(schema.error.code)) throw schema.error;
      if(request===version.current) {setRows(all);setReady(!schema.error);}
    } catch(error) {
      if(request===version.current) setLoadError(error.message||"거래처를 불러오지 못했습니다.");
    } finally {if(request===version.current) setLoading(false);}
  }
  useEffect(()=>{refresh();return()=>{version.current++;};},[]);
  function change(key,value) {setForm(old=>({...old,[key]:value}));}
  function reset() {setEditing(null);setForm(emptyClient());setError("");}
  function edit(row) {
    if(busyRef.current) return;
    setEditing(row);setForm(clientForm(row));setError("");setSuccess("");
    formRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  async function save(event) {
    event.preventDefault();
    if(busyRef.current||loading||loadError) return;
    setError("");setSuccess("");
    const validation=validateClient(form,!editing);
    if(validation) {setError(validation);return;}
    busyRef.current=true;setBusy(true);
    try {
      if(!supabase) throw new Error("Supabase 연결 설정이 필요합니다.");
      const {error}=ready
        ? await supabase.rpc("save_production_client",{p_client:clientPayload(form),p_create:!editing,p_expected_updated_at:editing?.client_updated_at||null})
        : await supabase.rpc("create_production_master",{p_kind:"client",p_code:form.client_code.trim(),p_name:form.client_name.trim()});
      if(error) throw error;
      setSuccess(`거래처 '${form.client_name.trim()}' ${editing?"수정":"등록"}이 완료되었습니다.`);
      reset();await refresh();
    } catch(error) {
      setError(error.code==="23505" ? "이미 등록된 거래처 코드입니다. 목록에서 확인하세요."
        :error.code==="PGRST202" ? "거래처 상세정보 저장 설정이 필요합니다. 관리자에게 요청하세요."
        :error.code==="42501" ? "거래처 저장 권한을 확인해 주세요."
        :error.message||"거래처를 저장하지 못했습니다.");
    } finally {busyRef.current=false;setBusy(false);}
  }
  const filtered=rows.filter(row=>clientMatches(row,query,type,status));
  async function exportRows() {
    if(exportRef.current||loading||loadError||!filtered.length) return;
    exportRef.current=true;setExporting(true);setExportError("");
    try {await downloadWorkbook(buildMasterSheets("client",filtered),exportFilename("거래처목록"));}
    catch(error) {setExportError(error.message||"엑셀 파일을 만들지 못했습니다.");}
    finally {exportRef.current=false;setExporting(false);}
  }
  const disabled=busy||loading||Boolean(loadError)||!supabase;
  return <main className="shell">
    <header className="topbar"><Link href="/" className="brand"><span className="brand-icon"><Factory size={20}/></span><span>FOUNDRY<span className="brand-sub"> 공정 관리</span></span></Link><AppNav/></header>
    <div className="content">
      <div className="eyebrow">CLIENT MANAGEMENT</div>
      <section className="intro"><div><h1>거래처 등록</h1><p>담당자, 사업자 정보, 납품 주소와 거래 조건을 함께 관리합니다.</p></div><Link className="secondary-btn" href="/orders/">작업지시 관리로</Link></section>
      {loadError&&<div className="alert" role="alert">{loadError}</div>}
      {!loading&&!loadError&&!ready&&<div className="alert" role="status">상세정보 저장 설정이 아직 적용되지 않았습니다. 지금은 코드·거래처명 등록과 기존 목록 조회가 가능합니다.</div>}
      <section ref={formRef} className="registry-card client-form" aria-labelledby="client-form-title">
        <h2 id="client-form-title">{editing?"거래처 수정":"새 거래처 등록"}</h2><p className="registry-hint">코드와 거래처명만 필수입니다. 나머지는 필요한 항목만 입력하세요.</p>
        <form onSubmit={save}>
          <fieldset disabled={disabled} className="form-grid client-fields">
            <label>거래처 코드 <em>*</em><input required value={form.client_code} readOnly={Boolean(editing)} maxLength={80} onChange={event=>change("client_code",event.target.value)} placeholder="예: C001"/>{editing&&<small>작업지시와 연결되어 코드는 변경할 수 없습니다.</small>}</label>
            <label>거래처명 <em>*</em><input required value={form.client_name} maxLength={200} onChange={event=>change("client_name",event.target.value)}/></label>
            <label>거래처 구분<select aria-label="거래처 구분" disabled={!ready} value={form.client_type} onChange={event=>change("client_type",event.target.value)}>{Object.entries(clientTypes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <label>사용 상태<select aria-label="사용 상태" disabled={!ready} value={form.is_active?"active":"inactive"} onChange={event=>change("is_active",event.target.value==="active")}><option value="active">사용 중</option><option value="inactive">거래중지</option></select><small>거래중지해도 기존 작업지시와 이력은 보존됩니다.</small></label>
          </fieldset>
          {clientGroups.map(group=><details key={(editing?.client_code||"new")+group.title} className="client-section" open={group.title==="연락처·담당자"}>
            <summary>{group.title} <span>선택 입력</span></summary>
            <fieldset disabled={disabled||!ready} className="form-grid client-fields">{group.fields.map(([key,label,max,inputType="text",placeholder])=><label key={key} className={["address","shipping_address","delivery_notes","notes"].includes(key)?"client-wide":""}>{label}{inputType==="textarea"
              ? <textarea value={form[key]} maxLength={max} rows={2} placeholder={placeholder} onChange={event=>change(key,event.target.value)}/>
              : <input type={inputType} inputMode={["postal_code","business_number"].includes(key)?"numeric":undefined} value={form[key]} maxLength={max} placeholder={placeholder} onChange={event=>change(key,event.target.value)}/>}
              {key==="shipping_address"&&<small>입력하지 않으면 사업장 주소를 납품 주소로 사용합니다.</small>}
              {key==="business_number"&&<small>국내 사업자등록번호의 10자리 형식을 확인합니다.</small>}
            </label>)}</fieldset>
          </details>)}
          {editing?.contact_info&&<p className="client-legacy">기존 연락처·메모: {editing.contact_info}</p>}
          {error&&<div className="alert" role="alert">{error}</div>}
          {success&&<p className="scan-result success" role="status">{success}</p>}
          <div className="client-form-actions">{editing&&<button type="button" className="secondary-btn" onClick={reset} disabled={busy}>수정 취소</button>}<button className="primary-btn" disabled={disabled}>{busy?"저장 중…":editing?"거래처 수정 저장":"거래처 등록"}</button></div>
        </form>
      </section>
      <section className="board registry-list" aria-labelledby="client-list-title">
        <div className="board-heading"><div><h2 id="client-list-title">등록된 거래처 <span>{filtered.length}</span></h2><p>이름, 코드, 사업자번호, 담당자와 연락처로 검색합니다.</p></div><div className="board-actions"><div className="search"><Search size={18}/><input aria-label="거래처 검색" value={query} onChange={event=>setQuery(event.target.value)} placeholder="코드·이름·사업자번호·담당자"/></div><button type="button" className="secondary-btn export-btn" onClick={exportRows} disabled={exporting||loading||Boolean(loadError)||!filtered.length}><Download size={16}/>{exporting?"준비 중…":"엑셀 자료받기"}</button><button type="button" className="icon-btn" aria-label="목록 새로고침" onClick={refresh} disabled={loading||busy}><RefreshCw size={18}/></button></div></div>
        <div className="client-filters"><label>구분<select aria-label="거래처 구분 필터" value={type} onChange={event=>setType(event.target.value)}><option value="all">전체</option>{Object.entries(clientTypes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>상태<select aria-label="거래처 상태 필터" value={status} onChange={event=>setStatus(event.target.value)}><option value="all">전체</option><option value="active">사용 중</option><option value="inactive">거래중지</option></select></label></div>
        {exportError&&<div className="alert" role="alert">{exportError}</div>}
        {loading?<div className="empty">거래처를 불러오는 중입니다.</div>:loadError?<div className="empty">목록을 다시 조회해 주세요.</div>:!filtered.length?<div className="empty">{query.trim()?"검색 결과가 없습니다.":"등록된 거래처가 없습니다."}</div>:<div className="client-table-scroll"><table className="registry-table client-table"><thead><tr><th>코드</th><th>거래처</th><th>구분</th><th>담당자·연락처</th><th>사업자등록번호</th><th>상태</th><th>관리</th></tr></thead><tbody>{filtered.map(row=><tr key={row.client_code}><td>{row.client_code}</td><td><strong>{row.client_name}</strong><small>{row.phone||row.contact_info||""}</small></td><td>{clientTypes[row.client_type||"customer"]||row.client_type}</td><td>{row.contact_name||"—"}<small>{row.contact_phone||row.email||""}</small></td><td>{formatBusinessNumber(row.business_number)||"—"}</td><td><span className={row.is_active===false?"client-inactive":"client-active"}>{row.is_active===false?"거래중지":"사용 중"}</span></td><td><button type="button" className="edit-btn" disabled={!ready||busy||loading} onClick={()=>edit(row)}>상세 / 수정</button></td></tr>)}</tbody></table></div>}
      </section>
    </div>
  </main>;
}
