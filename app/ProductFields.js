"use client";
import {Fragment} from 'react';
import {productFields} from '../lib/product-details';
export default function ProductFields({value={},onChange,master=false,disabled=false,quantityControl=null}){
 return <div className="form-grid product-fields">{productFields.filter(([k])=>!master||!['po_no','po_line','item_name'].includes(k)).map(([key,label,max])=><Fragment key={key}><label className={key==='extra'?'erp-wide':undefined}>{label}{key==='extra'?<textarea rows={2} maxLength={max} disabled={disabled} value={value[key]||''} onChange={e=>onChange({...value,[key]:e.target.value})}/>:<input maxLength={max} disabled={disabled} value={value[key]||''} onChange={e=>onChange({...value,[key]:e.target.value})}/>}</label>{key==='material'&&quantityControl}</Fragment>)}</div>;
}
export function ProductSummary({value={}}){return <div className="product-summary">{productFields.filter(([k])=>value[k]).map(([k,label])=><span key={k}>{label} <strong>{value[k]}</strong></span>)}</div>;}
