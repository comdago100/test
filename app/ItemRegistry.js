"use client";
import {useEffect,useState} from 'react';
import ErpShell,{useErpData,useErpMutation} from './ErpShared';
import MasterRegistry from './MasterRegistry';
import Pagination,{usePagination} from './Pagination';
import ProductFields,{ProductSummary} from './ProductFields';
import {detailsText} from '../lib/product-details';
import {supabase} from '../lib/supabase';
import {downloadWorkbook} from '../lib/excel-download';
import {exportFilename,buildMasterSheets} from '../lib/production-export';
const TABLES=['items'];const blank=()=>({item_code:'',item_name:'',product_details:{}});
export default function ItemRegistry(){
 const state=useErpData(TABLES),mutation=useErpMutation(state.refresh),[ready,setReady]=useState(null),[form,setForm]=useState(blank),[editing,setEditing]=useState(null),[query,setQuery]=useState(''),[error,setError]=useState(''),[exporting,setExporting]=useState(false);
 useEffect(()=>{let active=true;if(supabase)supabase.from('items').select('product_details,profile_revision').limit(0).then(({error})=>{if(active)setReady(!error);});else setReady(false);return()=>{active=false;};},[state.updated]);
 useEffect(()=>{if(mutation.success){setForm(blank());setEditing(null);}},[mutation.success]);
 const filtered=state.data.items.filter(i=>(i.item_code+' '+i.item_name+' '+detailsText(i)).toLowerCase().includes(query.trim().toLowerCase()));const pager=usePagination(filtered,query,'items');
 const disabled=state.loading||!!state.error||mutation.busy||!!mutation.pending;
 async function save(e){e.preventDefault();await mutation.run('save_item_profile',{p_data:form,p_create:!editing,p_expected_revision:editing?.profile_revision??null});}
 async function download(){setExporting(true);setError('');try{await downloadWorkbook(buildMasterSheets('item',filtered),exportFilename('품목목록'));}catch(e){setError(e.message);}finally{setExporting(false);}}
 if(ready===false)return <><div className="deployment-notice">상세 제품정보는 product_inspection.sql 적용 후 사용할 수 있습니다.</div><MasterRegistry kind="item"/></>;
 return <ErpShell title="제품 등록" kicker="PRODUCT INFORMATION" description="제품 기본 사양을 등록합니다. PO와 수량은 수주·작업지시에서 관리합니다." state={state} mutation={mutation} setupFile="product_inspection.sql">
 <section className="erp-card"><h2>{editing?'제품정보 수정':'제품정보 등록'}</h2><form onSubmit={save}><fieldset className="form-grid" disabled={disabled||!ready}><label>품목 코드 *<input required maxLength={80} readOnly={!!editing} value={form.item_code} onChange={e=>setForm({...form,item_code:e.target.value})}/></label><label>품명 *<input required maxLength={200} value={form.item_name} onChange={e=>setForm({...form,item_name:e.target.value})}/></label></fieldset><ProductFields master value={form.product_details} disabled={disabled||!ready} onChange={value=>setForm({...form,product_details:value})}/><p className="registry-hint">사이즈는 실제 치수·호칭, 규격은 적용 표준을 입력합니다. 요구 선급은 고객 요구사항이며 승인 여부를 뜻하지 않습니다. 변경 내용은 새로 선택하는 수주·작업에 적용됩니다.</p><div className="erp-actions">{editing&&<button type="button" className="secondary-btn" onClick={()=>{setEditing(null);setForm(blank());}}>수정 취소</button>}<button className="primary-btn" disabled={disabled||!ready}>제품정보 저장</button></div></form></section>
 {error&&<div className="alert" role="alert">{error}</div>}<section className="board"><div className="board-heading"><h2>품목 목록 {filtered.length}건</h2><div className="erp-actions"><input aria-label="품목 검색" placeholder="코드·품명·사이즈·재질 검색" value={query} onChange={e=>setQuery(e.target.value)}/><button className="secondary-btn" disabled={disabled||exporting||!filtered.length} onClick={download}>엑셀 자료받기</button></div></div><Pagination pager={pager}/>{pager.rows.map(r=><article className="erp-record" key={r.item_code}><div className="section-row"><h3>{r.item_code} · {r.item_name}</h3><button className="edit-btn" disabled={disabled} onClick={()=>{setEditing({...r});setForm({...r,product_details:{...r.product_details}});document.querySelector('.erp-card')?.scrollIntoView({behavior:'smooth'});}}>제품정보 수정</button></div><ProductSummary value={r.product_details}/></article>)}{!filtered.length&&<div className="empty">등록된 품목이 없습니다.</div>}<Pagination pager={pager} compact/></section>
 </ErpShell>;
}
